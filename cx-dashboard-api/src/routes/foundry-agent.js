/**
 * Drives Azure AI Foundry's AnalyticsAgent (proj-C4C) for a single question,
 * handling its function-tool calls in-process with the REAL calling user's
 * own token — the piece Foundry's own OpenAPI-tool execution structurally
 * cannot do (it runs the tool call itself, server-side, with no way to carry
 * an arbitrary end user's identity). See foundry-tool-executor.js for the
 * actual tool logic; this file only drives the conversation loop.
 *
 * LIVE-VERIFIED 2026-10-28 against AnalyticsAgent version 6 (8 function
 * tools + web_search) via raw curl against FOUNDRY_PROJECT_ENDPOINT:
 *  - POST /openai/v1/conversations (body {}) -> { id: "conv_..." }. No
 *    api-version query param -- the /v1 path rejects it.
 *  - POST /openai/v1/responses targets the agent via a top-level
 *    agent_reference object: { type: "agent_reference", name: "<agent>" },
 *    NOT a plain "agent": "<name>" string (that errors first with "Expected
 *    object, got String", then, once wrapped in an object under the old key
 *    name, with "The 'agent' property is deprecated. Use 'agent_reference'
 *    instead.").
 *  - A turn needing no tool call completes with status "completed" and an
 *    output[] item of type "message" (content[].type "output_text",
 *    content[].text holds the reply). There is no requires_action status in
 *    this API -- that belongs to the older Assistants threads/runs API, not
 *    this one.
 *  - A turn that calls a tool ALSO completes with status "completed"; the
 *    tool call shows up as an output[] item of type "function_call" with
 *    fields id, call_id, name, arguments (a JSON string) -- exactly the
 *    field names this file already assumed in the turn loop below. Confirmed
 *    with list_fields({"collection":"opportunities"}).
 *  - response.output_text (used by some official OpenAI client SDKs as a
 *    convenience getter) is NOT present on the raw REST response in either
 *    case -- see extractOutputText() below.
 */
import { Router } from 'express';
import axios from 'axios';
import { DefaultAzureCredential } from '@azure/identity';
import { executeFoundryTool } from '../foundry-tool-executor.js';

const router = Router();

const FOUNDRY_PROJECT_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT
  || 'https://azr-fou-sc-cx.services.ai.azure.com/api/projects/proj-C4C';
const FOUNDRY_AGENT_NAME = process.env.FOUNDRY_AGENT_NAME || 'AnalyticsAgent';
// Azure AI Foundry's resource-manager-style data-plane scope. This is the
// scope used for Azure AI services access tokens today; verify this is
// actually what the project's OpenAI-compatible endpoint expects before
// trusting it — a wrong scope fails fast and loud (401/403 on the very
// first token-authenticated call), it does not silently misbehave.
const FOUNDRY_TOKEN_SCOPE = process.env.FOUNDRY_TOKEN_SCOPE || 'https://ai.azure.com/.default';

let credential = null;
function getCredential() {
  if (!credential) credential = new DefaultAzureCredential();
  return credential;
}

async function getFoundryAccessToken() {
  const token = await getCredential().getToken(FOUNDRY_TOKEN_SCOPE);
  return token.token;
}

async function foundryRequest(path, body) {
  const accessToken = await getFoundryAccessToken();
  const { data } = await axios.post(`${FOUNDRY_PROJECT_ENDPOINT}${path}`, body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  return data;
}

const MAX_TURNS = 10; // same ceiling as the in-process claude.js agent loop

// response.output_text is NOT a field the raw REST API returns -- confirmed
// live on 2026-10-28 against version 6 of AnalyticsAgent (neither a
// no-tool-call nor a tool-call response included an output_text key at the
// top level). It's a convenience getter some official OpenAI client SDKs
// compute on the client side; since this file calls the endpoint directly
// with axios, we have to pull the text out of response.output ourselves.
function extractOutputText(response) {
  const messageItem = (response.output || []).find((item) => item.type === 'message');
  if (!messageItem) return null;
  const textPart = (messageItem.content || []).find((part) => part.type === 'output_text');
  return textPart?.text ?? null;
}

router.post('/ask', async (req, res, next) => {
  try {
    const { userRequest } = req.body || {};
    if (!userRequest) return res.status(400).json({ error: 'userRequest is required' });

    // req.userJwt/req.userEmail come from authMiddleware — the real signed-in
    // user's own token, exactly what every tool call below needs to reach
    // C4C with the right visibility. This is the whole point of this route.
    const { userJwt, userEmail } = req;

    // AnalyticsAgent's instructions are static text pasted into Foundry once
    // -- they can't carry a live date the way claude.js's system prompt does
    // (rebuilt fresh on every request with today's real date interpolated
    // in). Confirmed live: without this, the agent defaulted "this year" to
    // 2025 on a request made in November 2026. Same fix as claude.js's rule
    // 7, applied here instead since this is the one place per request we
    // control.
    const todayIso = new Date().toISOString().slice(0, 10);
    const dateQualifiedRequest = `Today's date is ${todayIso}. Resolve any relative time period in the question below (e.g. "this year", "this quarter") against that real date, not an assumed one.\n\n${userRequest}`;

    const conversation = await foundryRequest('/openai/v1/conversations', {});
    let response = await foundryRequest('/openai/v1/responses', {
      agent_reference: { type: 'agent_reference', name: FOUNDRY_AGENT_NAME },
      conversation: conversation.id,
      input: [{ role: 'user', content: dateQualifiedRequest }],
    });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const functionCalls = (response.output || []).filter((item) => item.type === 'function_call');
      if (functionCalls.length === 0) break;

      const outputs = [];
      for (const call of functionCalls) {
        let result;
        try {
          const args = JSON.parse(call.arguments || '{}');
          result = await executeFoundryTool(call.name, args, userJwt, userEmail);
        } catch (err) {
          // A tool error still lets the turn continue (the agent sees
          // { error } and can explain the failure in its answer), so this
          // was previously invisible in CF logs -- a swallowed tool failure
          // looked identical to a 200 success at the router level. Logged
          // explicitly here so it actually shows up in `cf logs`.
          console.error(`[foundry-agent] tool ${call.name} failed:`, err.message);
          result = { error: err.message };
        }
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
      }

      response = await foundryRequest('/openai/v1/responses', {
        agent_reference: { type: 'agent_reference', name: FOUNDRY_AGENT_NAME },
        conversation: conversation.id,
        input: outputs,
      });
    }

    res.json({
      outputText: extractOutputText(response),
      raw: response, // kept for debugging while this path is unverified; drop once confirmed stable
    });
  } catch (err) {
    next(err);
  }
});

export default router;

/*
 * Manual verification checklist before wiring this into any user-facing UI:
 *
 * 1. DONE 2026-10-28 -- token scope + REST paths confirmed via raw curl
 *    against the live endpoint (see the module comment above for the exact
 *    contract found).
 *
 * 2. DONE 2026-10-28 -- no-tool-call round trip against AnalyticsAgent
 *    version 6 completed cleanly (status "completed", a message item in
 *    output[], no schema errors).
 *
 * 3. DONE 2026-10-28 -- a real tool-triggering question confirmed the
 *    function_call item shape (id, call_id, name, arguments) matches what
 *    the turn loop above assumes.
 *
 * 4. DONE 2026-11-05 -- full end-to-end run against the deployed CF app,
 *    with a real signed-in user's own token (captured from the dashboard
 *    session, never logged/printed), confirmed on the live tenant:
 *      - A no-tool question ("What can you help me with?") returned a real
 *        outputText in ~17s.
 *      - A tool-triggering question (opportunities converted to quote for
 *        TSS Germany) returned a real, org-scoped breakdown (CSC Germany,
 *        TMS LS/MD Germany) -- proof executeFoundryTool actually ran with
 *        the real user's token and reached C4C correctly.
 *      - A second, different tool (aggregate, total Estimated Peak
 *        Turnover) returned a consistent answer -- its per-org record
 *        counts matched the first question's exactly, a real cross-check
 *        that both tool calls hit the same live data correctly.
 *      - FOUNDRY_TOKEN_SCOPE ('https://ai.azure.com/.default') is confirmed
 *        working under cx-dashboard-api's actual deployed identity
 *        (ARZ-TSS-SAPBTP-MCP via AZURE_CLIENT_ID/SECRET/TENANT env vars on
 *        Cloud Foundry, granted the Foundry User role on AZR-FOU-SC-CX) --
 *        not just the az-cli login used for the earlier curl checks.
 *      - Also caught and fixed live: the agent defaulted "this year" to
 *        2025 on a November 2026 request, since its static instructions
 *        have no way to know the real date -- fixed by prepending today's
 *        real date to every request (see above).
 *
 * This route is now considered verified for real per-user use. Remaining
 * open items, not blockers: the `raw` debug field below should come out
 * before any UI consumes this directly, and a swallowed tool-level error
 * (an { error } result that still lets the turn "succeed") is now logged
 * via console.error but hasn't been deliberately triggered/tested.
 */
