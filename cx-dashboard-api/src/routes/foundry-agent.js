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

    const conversation = await foundryRequest('/openai/v1/conversations', {});
    let response = await foundryRequest('/openai/v1/responses', {
      agent_reference: { type: 'agent_reference', name: FOUNDRY_AGENT_NAME },
      conversation: conversation.id,
      input: [{ role: 'user', content: userRequest }],
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
 * 4. REMAINING -- this file itself has only been edited to match the
 *    curl-verified contract (agent_reference, extractOutputText); it has
 *    NOT yet been run end-to-end. Before trusting it in a user-facing flow:
 *      - npm install in cx-dashboard-api (axios, @azure/identity must
 *        resolve).
 *      - Start the server locally and hit POST /api/foundry/ask with a real
 *        signed-in user's JWT, a userRequest that needs no tool (sanity
 *        check outputText comes back non-null), then one that forces a tool
 *        call (sanity check executeFoundryTool actually runs with the real
 *        user's token and the loop terminates within MAX_TURNS).
 *      - Confirm FOUNDRY_TOKEN_SCOPE ('https://ai.azure.com/.default') is
 *        actually the scope DefaultAzureCredential needs in this app's
 *        deployed identity context (managed identity on BTP/Cloud Foundry,
 *        not the az-cli login used for the curl checks above) -- this has
 *        NOT been separately verified yet.
 */
