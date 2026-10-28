/**
 * Drives Azure AI Foundry's AnalyticsAgent (proj-C4C) for a single question,
 * handling its function-tool calls in-process with the REAL calling user's
 * own token — the piece Foundry's own OpenAPI-tool execution structurally
 * cannot do (it runs the tool call itself, server-side, with no way to carry
 * an arbitrary end user's identity). See foundry-tool-executor.js for the
 * actual tool logic; this file only drives the conversation loop.
 *
 * NOT YET LIVE-VERIFIED. Built from:
 *  - The real "Continue in code" snippet Cowork pulled for AnalyticsAgent
 *    (confirms: project endpoint, DefaultAzureCredential-style auth, and the
 *    conversations.create() + responses.create() shape — this is the OpenAI
 *    Responses API, not the older Assistants threads/runs API).
 *  - The well-documented, stable OpenAI Responses API tool-calling contract
 *    (function_call items in response.output; continue the turn by posting
 *    function_call_output items back) for the parts the snippet didn't show
 *    (the snippet was a no-tools "Hi" smoke test, not a tool-call example).
 * The exact Foundry REST path for the OpenAI-compatible endpoint under
 * FOUNDRY_PROJECT_ENDPOINT is inferred, not confirmed from a live call —
 * verify this against a real request (see the curl check in the module
 * comment below) before trusting it in a user-facing flow.
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
      agent: FOUNDRY_AGENT_NAME,
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
        agent: FOUNDRY_AGENT_NAME,
        conversation: conversation.id,
        input: outputs,
      });
    }

    res.json({
      outputText: response.output_text ?? null,
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
 * 1. Confirm the token scope and REST paths with a raw curl first:
 *      TOKEN=$(az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv)
 *      curl -s -X POST "$FOUNDRY_PROJECT_ENDPOINT/openai/v1/conversations" \
 *        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
 *    If this 404s, the path is wrong, not the auth -- check the agent's
 *    "Continue in code" snippet's actual outbound network call (e.g. via a
 *    proxy/mitm, or by reading the azure-ai-projects SDK source for the path
 *    it builds) rather than guessing a second path.
 *
 * 2. If step 1 works, confirm a no-tool-call round trip (ask AnalyticsAgent
 *    something that needs no tools) before testing the function_call loop.
 *
 * 3. Only then test a real question that triggers a tool call, and confirm
 *    the shape of a function_call item in response.output matches what this
 *    file assumes (type, name, arguments, call_id field names) -- these are
 *    assumed from the stable public OpenAI Responses API and may differ if
 *    Foundry's Agent Service wraps them differently.
 */
