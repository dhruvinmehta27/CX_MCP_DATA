/**
 * Claude API integration — natural-language intent parsing, Recharts config
 * generation, and self-contained ECharts HTML for Copilot Studio inline mode.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set (cf set-env cx-dashboard-api ANTHROPIC_API_KEY ...)');
    }
    const options = { apiKey };
    // Optional custom endpoint — e.g. the Azure AI Foundry Anthropic passthrough.
    // Point ANTHROPIC_BASE_URL at the prefix the SDK appends `/v1/messages` to,
    // e.g. https://<resource>.services.ai.azure.com/anthropic
    if (process.env.ANTHROPIC_BASE_URL) {
      options.baseURL = process.env.ANTHROPIC_BASE_URL;
    }
    // Some gateways (Azure AI Foundry) authenticate with the `api-key` header
    // rather than Anthropic's default `x-api-key`. Set ANTHROPIC_AUTH_HEADER=api-key
    // to send the key under that header (it is sent in addition to x-api-key, so
    // whichever the gateway reads will match).
    const authHeader = process.env.ANTHROPIC_AUTH_HEADER;
    if (authHeader && authHeader.toLowerCase() !== 'x-api-key') {
      options.defaultHeaders = { [authHeader]: apiKey };
    }
    client = new Anthropic(options);
  }
  return client;
}

function extractText(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function parseJsonResponse(text) {
  // Strip markdown fences if the model added them despite instructions
  const cleaned = text.replace(/^```(?:json|html)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

const VALID_ENDPOINTS = [
  'quotes/by-status', 'quotes/by-sales-org', 'quotes/trend', 'quotes/by-biz-type',
  'opportunities/pipeline', 'rfqs/by-status', 'quotes/top-customers', 'daily-summary',
];

export function sanitizeIntent(intent = {}) {
  intent.endpoints = (intent.endpoints || []).filter((e) => VALID_ENDPOINTS.includes(e));
  if (intent.endpoints.length === 0) intent.endpoints = ['quotes/by-status'];
  return intent;
}

/**
 * Parse a natural-language analytics request into endpoints + chart config.
 */
export async function parseIntent(userRequest, filters = {}) {
  const prompt = `Parse this analytics request and return JSON only, no markdown:
{
  "endpoints": ["quotes/by-status"|"quotes/by-sales-org"|"quotes/trend"|"quotes/by-biz-type"|"opportunities/pipeline"|"rfqs/by-status"|"quotes/top-customers"|"daily-summary"],
  "chartType": "bar"|"line"|"pie"|"area"|"composed"|"funnel",
  "title": string,
  "xKey": string,
  "yKeys": [string],
  "explanation": string,
  "filters": { "salesOrgId": string|null, "ownerId": string|null, "dateFrom": "YYYY-MM-DD"|null, "dateTo": "YYYY-MM-DD"|null, "months": number|null, "limit": number|null }
}
The "explanation" field must be 2-3 sentences in plain English describing what the user asked for, which data sources will be used, and what the report will show. Write it as "I'll..." e.g. "I'll pull your quote pipeline grouped by status..."
IMPORTANT: The user has already selected a date range in the UI (shown in filters below). Do NOT set dateFrom or dateTo in your filters output — always set them to null so the UI range is respected. Only set salesOrgId, ownerId, months, or limit if the request explicitly mentions them.
Current filters from the UI (date range is fixed): ${JSON.stringify(filters)}
Today's date: ${new Date().toISOString().slice(0, 10)}
Request: ${userRequest}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });
  return sanitizeIntent(parseJsonResponse(extractText(response)));
}

/**
 * Turn aggregated data into a Recharts chart config + insights.
 */
export async function generateChartConfig(chartType, data, userRequest) {
  const prompt = `Return Recharts chart config as JSON only, no markdown:
{
  "chartType": string,
  "data": [...],
  "xKey": string,
  "yKeys": [{ "key": string, "color": string, "label": string, "type": string }],
  "title": string,
  "summary": string,
  "insights": [string]
}
Chart type: ${chartType}
Data: ${JSON.stringify(data).slice(0, 30_000)}
Colors available: ["#E4002B","#FF6B6B","#FFB347","#4ECDC4","#45B7D1","#96CEB4"]
User request: ${userRequest}
Rules: keep "data" suitable for direct rendering (flat objects, numeric values as numbers). Provide 2-4 concise business insights.`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });
  return parseJsonResponse(extractText(response));
}

/**
 * Generate 4 complementary chart configs from the same dataset.
 */
export async function generateMultiCharts(data, userRequest) {
  const prompt = `You are a business analytics expert. Given the data below, generate exactly 4 complementary chart configs that together give a complete picture of the analytics request.
Return JSON only, no markdown:
{
  "charts": [
    {
      "chartType": "bar"|"line"|"pie"|"area"|"composed"|"funnel",
      "data": [...],
      "xKey": string,
      "yKeys": [{ "key": string, "color": string, "label": string }],
      "title": string,
      "summary": string
    }
  ],
  "insights": [string],
  "overallTitle": string,
  "overallSummary": string
}
Rules:
- Each chart must show a DIFFERENT angle/dimension of the data (e.g. volume, value, trend, breakdown).
- Use varied chart types across the 4 (not all bars).
- Keep "data" as flat objects with numeric values as numbers.
- Provide 3-5 concise business insights in the "insights" array.
- Colors: ["#E4002B","#FF6B6B","#FFB347","#4ECDC4","#45B7D1","#96CEB4","#A29BFE","#FD79A8"]
Data: ${JSON.stringify(data).slice(0, 30_000)}
User request: ${userRequest}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });
  return parseJsonResponse(extractText(response));
}

/**
 * Generate a complete self-contained ECharts HTML page for Copilot Studio.
 */
export async function generateInlineHtml(data, userRequest, chartType) {
  const prompt = `Generate a complete self-contained HTML page with an ECharts chart.
Use CDN: https://cdn.jsdelivr.net/npm/echarts/dist/echarts.min.js
Style: dark bg #1D1D1B, accent #E4002B, white text, chart fills the viewport.
Chart type hint: ${chartType || 'choose the best fit'}
Data: ${JSON.stringify(data).slice(0, 30_000)}
Request: ${userRequest}
Return ONLY the HTML, nothing else.`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });
  let html = extractText(response).trim();
  html = html.replace(/^```html?\s*/i, '').replace(/```\s*$/, '').trim();

  // Short title/summary for the chat card around the iframe
  const metaResponse = await getClient().messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Return JSON only, no markdown: { "title": string, "summary": string } — a short chart title and one-sentence summary for this analytics request: ${userRequest}\nData sample: ${JSON.stringify(data).slice(0, 2000)}`,
    }],
  });
  let meta = { title: 'Analytics Chart', summary: '' };
  try {
    meta = parseJsonResponse(extractText(metaResponse));
  } catch {
    // non-fatal — keep defaults
  }
  return { html, title: meta.title, summary: meta.summary };
}

/**
 * Short title + one-line summary for a chart (used by the Copilot inline-image
 * endpoint, which builds the chart deterministically and only needs the text).
 */
export async function generateChartMeta(data, userRequest) {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Return JSON only, no markdown: { "title": string, "summary": string } — a short chart title and one-sentence summary for this analytics request: ${userRequest || 'chart of the data'}\nData sample: ${JSON.stringify(data).slice(0, 2000)}`,
      }],
    });
    return parseJsonResponse(extractText(response));
  } catch {
    return { title: 'Analytics Chart', summary: '' };
  }
}

/**
 * Parse a Sales Brief intent to surface AI understanding and flag ambiguities
 * (e.g. user mentions a specific org/region but no salesOrgId filter is set).
 */
export async function parseBriefIntent({ audience, intent, availableFilters = {} }) {
  const prompt = `A user is generating a sales brief for Trelleborg Sealing Solutions.
Audience: ${audience}
User message (optional intent/focus): "${intent || ''}"
Current data filters applied: ${JSON.stringify(availableFilters)}

Analyze the user's message and return JSON only, no markdown:
{
  "understanding": string,
  "scopeWarning": string|null,
  "clarificationNeeded": boolean,
  "clarificationQuestion": string|null
}

Rules:
- "understanding": 1-2 sentences starting with "I'll..." describing what brief will be created and for whom.
- "scopeWarning": if the user mentions a specific org, region, country, division, or owner name BUT no salesOrgId/ownerId filter is set, set this to a warning like "You mentioned 'TSS Germany' but no org filter is active — the brief will cover ALL 59 sales orgs. I'll include Germany-specific commentary where the data allows." Otherwise null.
- "clarificationNeeded": true only if the request is genuinely ambiguous and needs clarification before proceeding.
- "clarificationQuestion": if clarificationNeeded, a single clear question to ask the user. Otherwise null.
`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });
  return parseJsonResponse(extractText(response));
}

const AUDIENCE_TONES = {
  board: 'Board / Executive — strategic overview, revenue focus. Concise, confident, no operational minutiae.',
  regional: 'Regional Manager — operational detail, owner performance, bottlenecks, concrete next actions.',
  customer: 'Customer Meeting — value-oriented, opportunity focused. NEVER include internal-only figures (win rates, loss counts, stale-deal counts, owner performance).',
  team: 'Sales Team — win rates, pipeline health, motivating and energetic tone, celebrate wins.',
  territory: 'Territory Review — sales-org breakdown, geographic performance comparison.',
  investor: 'Investor / Stakeholder — growth story, pipeline momentum, forward-looking confidence with credible numbers.',
};

/**
 * Write a structured, print-ready sales brief tailored to the audience.
 */
export async function generateBrief({ audience, intent, data, preparedBy, period }) {
  const prompt = `Write a sales brief for Trelleborg Sealing Solutions (industrial sealing manufacturer) based on live CRM data.
Audience: ${AUDIENCE_TONES[audience] || audience}
${intent ? `The presenter specifically wants to communicate: "${intent}"` : 'No specific message given — provide a balanced full overview.'}
Prepared by: ${preparedBy}. Data period: ${period}.
Return JSON only, no markdown fences:
{
  "title": string,
  "subtitle": string,
  "keyMetrics": [{ "label": string, "value": string }],
  "sections": [{ "heading": string, "body": string, "bullets": [string] }],
  "keyTakeaways": [string]
}
Rules:
- 4-6 keyMetrics with values formatted for slides (e.g. "€45.1M", "33%", "592").
- 3-5 sections; each body is 1-2 short paragraphs of flowing prose; bullets optional (max 4).
- 3-5 keyTakeaways, each a single punchy sentence.
- Every number must come from the data below — never invent figures.
- Currency is EUR unless the data says otherwise.
Data: ${JSON.stringify(data).slice(0, 40_000)}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });
  return parseJsonResponse(extractText(response));
}
