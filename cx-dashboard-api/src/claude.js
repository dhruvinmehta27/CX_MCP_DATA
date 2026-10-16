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

// Tolerant JSON extraction for the custom-aggregate agent's final answer only.
// Unlike parseJsonResponse (used by other prompts), the model here sometimes
// prefixes the JSON with a sentence of preamble, so we search for a fenced
// block or a brace-matched object anywhere in the text instead of requiring
// it to start at position 0.
function extractFinalAnswerJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const VALID_ENDPOINTS = [
  'quotes/raw', 'quotes/by-status', 'quotes/by-sales-org', 'quotes/trend', 'quotes/by-biz-type',
  'opportunities/pipeline', 'opportunities/created-trend', 'opportunities/by-sales-org',
  'opportunities/items',
  'rfqs/by-status', 'rfqs/by-account', 'rfqs/trend', 'rfqs/list',
  'quotes/top-customers', 'quotes/top-creators', 'daily-summary',
  'custom/aggregate',
];

// Keywords that force quotes/top-creators (ranked aggregation by owner/creator).
const TOP_CREATORS_KEYWORDS = [
  'top users', 'top reps', 'top sales rep', 'who created most', 'most quotes',
  'most quote', 'highest quote count', 'by quote count', 'ranked by quote',
  'top creators', 'top 10 users', 'top 5 users', 'top 20 users',
];

function needsTopCreatorsEndpoint(userRequest) {
  const lower = (userRequest || '').toLowerCase();
  return TOP_CREATORS_KEYWORDS.some((k) => lower.includes(k));
}

// Keywords that deterministically force opportunities/items — no LLM override possible.
const ITEMS_KEYWORDS = [
  'product id', 'product category', 'product description', 'line item', 'line-item',
  'oil seal', 'cassette seal', 'glyd ring', 'quantity', 'cost per item', 'unit price',
  'opportunity item', 'opportunity product', 'items in opportunit', 'products in opportunit',
  'dont group', "don't group", 'do not group', 'ungrouped', 'one row per',
];

function needsItemsEndpoint(userRequest) {
  const lower = (userRequest || '').toLowerCase();
  return ITEMS_KEYWORDS.some((k) => lower.includes(k));
}

// Returns true when the user explicitly said they want all orgs / no filter
function userWantsAll(userRequest) {
  const lower = (userRequest || '').toLowerCase();
  return lower.includes('all org') || lower.includes('all sales org') ||
         lower.includes('entire org') || lower.includes('every org') ||
         /\ball\b/.test(lower);
}

// Returns true if any meaningful scope filter is present
function hasScopeFilter(intent, userRequest) {
  const hasOrg = intent.filters?.salesOrgId || userWantsAll(userRequest);
  const hasDate = intent.filters?.dateFrom || intent.filters?.dateTo ||
                  intent.filters?.months || intent.detectedDateFrom ||
                  intent.detectedDateTo || intent.detectedPeriod;
  return { hasOrg, hasDate };
}

function requiresScope(intent) {
  return intent.endpoints.some((e) => ['quotes/raw', 'opportunities/items', 'quotes/top-creators', 'rfqs/list', 'custom/aggregate'].includes(e));
}

export function sanitizeIntent(intent = {}, userRequest = '') {
  intent.endpoints = (intent.endpoints || []).filter((e) => VALID_ENDPOINTS.includes(e));
  if (intent.endpoints.length === 0) intent.endpoints = ['quotes/by-status'];

  // Hard override: product-level keywords always force the line-item endpoint
  if (needsItemsEndpoint(userRequest)) {
    intent.endpoints = ['opportunities/items'];
    intent.chartType = 'table';
  }

  // Hard override: "top N users/reps by quote count" → aggregated endpoint, never raw
  if (needsTopCreatorsEndpoint(userRequest)) {
    intent.endpoints = ['quotes/top-creators'];
    const lower = (userRequest || '').toLowerCase();
    if (lower.includes('table')) intent.chartType = 'table';
    else if (intent.chartType === 'pie') intent.chartType = 'pie';
    else intent.chartType = 'bar';
  }

  // Proactive scope check: for raw/large endpoints, block if no org scoping.
  // Always run this — it overrides any clarificationNeeded the LLM may have set.
  if (requiresScope(intent)) {
    const { hasOrg, hasDate } = hasScopeFilter(intent, userRequest);
    // For opportunities/items, a product category filter is enough scoping even without org
    const hasProductScope = intent.endpoints.includes('opportunities/items') && intent.filters?.productCategory;
    if (!hasOrg && !hasProductScope) {
      intent.clarificationNeeded = true;
      intent.clarificationQuestion = hasDate
        ? 'Which sales org or region should I focus on? — or type "all" to include every org.'
        : 'Which sales org or region, and what time period? (e.g. "TSS India in 2026", "Germany last 3 months") — or type "all" to include everything.';
    } else {
      // Scope is satisfied — clear any clarification the LLM may have incorrectly set
      intent.clarificationNeeded = false;
      intent.clarificationQuestion = null;
    }
  }

  return intent;
}

/**
 * Parse a natural-language analytics request into endpoints + chart config.
 */
export async function parseIntent(userRequest, filters = {}) {
  const prompt = `Parse this analytics request and return JSON only, no markdown:
{
  "endpoints": [one or more from: "quotes/raw"|"quotes/by-status"|"quotes/by-sales-org"|"quotes/trend"|"quotes/by-biz-type"|"opportunities/pipeline"|"opportunities/created-trend"|"opportunities/by-sales-org"|"opportunities/items"|"rfqs/by-status"|"rfqs/by-supplier"|"rfqs/trend"|"rfqs/list"|"quotes/top-customers"|"quotes/top-creators"|"daily-summary"],
  "chartType": "bar"|"line"|"pie"|"area"|"composed"|"funnel"|"table",
  "title": string,
  "xKey": string,
  "yKeys": [string],
  "explanation": string,
  "detectedPeriod": string|null,
  "detectedMonths": number|null,
  "detectedDateFrom": "YYYY-MM-DD"|null,
  "detectedDateTo": "YYYY-MM-DD"|null,
  "detectedOrgName": string|null,
  "detectedOwnerName": string|null,
  "clarificationNeeded": boolean,
  "clarificationQuestion": string|null,
  "filters": { "salesOrgId": string|null, "ownerId": string|null, "dateFrom": "YYYY-MM-DD"|null, "dateTo": "YYYY-MM-DD"|null, "months": number|null, "limit": number|null, "productCategory": string|null, "account": string|null }
}

ENDPOINT SELECTION RULES — pick the most specific match:
CRITICAL — check this FIRST, before anything else: if the user asks for a SUM, COUNT, AVERAGE, or TOTAL of a specific named metric/field that is NOT one of the standard figures covered by the rules below (win rate, pipeline value, quote count, quote status, RFQ status, product quantity/cost/price at the line-item level) — especially if the field name sounds like a custom/business-specific term you don't recognize (e.g. "Estimated Peak Turnover", "SOP value", any term with capitalized Title Case that isn't plainly "revenue" or "amount") — use "custom/aggregate" and set chartType "table". Do NOT guess which endpoint might contain this field, do NOT silently substitute opportunities/items or any other endpoint. This is critical: inventing a field mapping produces a confidently wrong answer, which is worse than asking a specialized agent to verify the field exists first. "custom/aggregate" triggers a separate verification step that checks real C4C field names before computing anything.
ALSO use "custom/aggregate" for "how many opportunities converted to quote", "quote conversion rate", "opportunities that became quotes", or similar — there is no simple field for this, it requires checking a relationship between Opportunities and Quotes that only the custom/aggregate agent knows how to do correctly.
ALSO use "custom/aggregate" for "how many RFQs raised from quotes", "RFQs generated from quotes this quarter", or similar — the reverse direction, same reasoning.
IMPORTANT: If the user asks for product-level detail (Product ID, Product Category, Quantity, Cost, Price, line items, items within opportunities, specific product types like "oil seals"/"cassette seals"/"seals"), ALWAYS use "opportunities/items" — even if the word "pipeline" or "opportunity" appears. Product detail always wins over pipeline/stage views.
- "top N users", "who created most quotes", "top reps by quote count", "most quotes by person", "ranked by quote count" → use "quotes/top-creators" and set chartType "bar". Extract limit N from the request and set filters.limit.
- "list quotes", "show me quotes", "give me all quotes", "export quotes", "raw quote data", "quote details", "quotes with country/owner/created by" → use "quotes/raw" and set chartType "table"
- ANY of: "product ID", "product category", "product description", "line items", "opportunity items", "opportunity products", "items in opportunities", "opportunity line", "show me products", "oil seals", "cassette seals", "glyd ring", "seals", "quantity", "cost per item", "unit price", "net amount per item", "customer details per product", "don't group", "ungrouped", "one row per" → use "opportunities/items" and set chartType "table". Extract any product category keyword the user mentions and set filters.productCategory to it.
- "how many opportunities created", "count of opportunities", "opportunities created in last X" → use "opportunities/created-trend"
- "pipeline by stage", "pipeline health", "stage breakdown", "open pipeline", "weighted pipeline" → use "opportunities/pipeline"
- "opportunities by sales org", "which org has most opportunities", "org performance" → use "opportunities/by-sales-org"
- "quote count", "quote status", "quote value", "open quotes" → use "quotes/by-status"
- "quotes by org", "quote volume by org" → use "quotes/by-sales-org"
- "quote trend", "monthly quotes", "quotes over time" → use "quotes/trend"
- "RFQ by account", "RFQs per account", "RFQ by customer", "which account has most RFQs", "RFQ by supplier" (note: in C4C RFQs are linked to accounts/customers, not vendors) → use "rfqs/by-account" and set chartType "bar". Extract account name and set filters.account if mentioned.
- "RFQ trend", "RFQs over time", "monthly RFQs", "RFQ volume by month" → use "rfqs/trend" and set chartType "line"
- "list RFQs", "show me RFQs", "open RFQs", "overdue RFQs", "RFQ details", "RFQs for account X", "RFQs this quarter" → use "rfqs/list" and set chartType "table". Extract account name and set filters.account if mentioned.
- "RFQ status", "RFQ breakdown", "how many RFQs" → use "rfqs/by-status"
- "daily", "today", "this week summary" → use "daily-summary"
- For broad requests mentioning both quotes and pipeline → use multiple endpoints

DATE PERIOD RULES:
- If user mentions a time period, set detectedPeriod to the human label (e.g. "Q4 2025", "last month").
- detectedMonths: for relative periods only (1=month/30days, 3=quarter, 6=half-year, 12=year). null for specific calendar periods.
- detectedDateFrom / detectedDateTo: for specific calendar periods calculate exact ISO dates. Examples: "Q4 2025" → 2025-10-01/2025-12-31, "Q1 2026" → 2026-01-01/2026-03-31, "H1 2025" → 2025-01-01/2025-06-30, "January 2026" → 2026-01-01/2026-01-31. Set to null if only a relative period (e.g. "last month").
- Do NOT set dateFrom or dateTo in filters — always null. The UI will resolve the conflict.
Today's date for relative period calculation: ${new Date().toISOString().slice(0, 10)}

ORG & OWNER RULES:
- detectedOrgName: if user mentions a specific org/region/country (e.g. "CSC Germany", "Germany", "DACH"), set to the name as mentioned. Also set filters.salesOrgId to the same value.
- If user mentions MULTIPLE orgs (e.g. "Industrial Americas (Canada, US Industrial, Mexico, Brazil)"), set detectedOrgName to a human label (e.g. "Industrial Americas") and set filters.salesOrgId to a comma-separated list of the exact C4C org IDs.
- KNOWN ORG IDs (use these exact values — do NOT guess):
  Industrial Americas = TSSSEGCHETRAOPER,TSSMEXICO,TSSCANADA,TSSBRAZIL
  Canada = TSSCANADA
  Mexico = TSSMEXICO
  Brazil = TSSBRAZIL
  US Industrial / Industrial US / United States Industrial = TSSSEGCHETRAOPER
  India / TSS India = TSSINDIA
  China / TSS China = TSSCHINA
  For any org not in this list, use the name as-is and let in-process filtering handle it.
- detectedOwnerName: if user mentions a specific person, set to their name. Also set filters.ownerId.
- clarificationNeeded: true only if the request is genuinely ambiguous (e.g. "show me data" with no context).
- clarificationQuestion: a single specific question to resolve the ambiguity.

The "explanation" must be 2-3 sentences starting with "I'll..." describing exactly what will be shown, which filters apply, and which data source will be used.

Current UI filters (date range): ${JSON.stringify(filters)}
Today's date: ${new Date().toISOString().slice(0, 10)}
Request: ${userRequest}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });
  return sanitizeIntent(parseJsonResponse(extractText(response)), userRequest);
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
  "detectedOrgKeyword": string|null,
  "detectedOwnerKeyword": string|null,
  "detectedCustomerKeyword": string|null,
  "detectedPeriod": string|null,
  "detectedDateFrom": "YYYY-MM-DD"|null,
  "detectedDateTo": "YYYY-MM-DD"|null,
  "scopeWarning": string|null,
  "clarificationNeeded": boolean,
  "clarificationQuestion": string|null
}

Rules:
- "understanding": 2-3 sentences starting with "I'll..." describing what brief will cover and audience tone. Do NOT mention a data period — the user will confirm that separately.
  IMPORTANT: org/territory scoping has NOT been confirmed yet at this point — a separate lookup happens after this and its result is shown separately in the UI. Never assert "Filters will be applied for Sales Org: X" or other definite language about org scoping. Either phrase it tentatively (e.g. "I'll try to scope this to the org/territory you mentioned") or leave org specifics out of this text entirely and let the org-picker section communicate the actual match result.
- "detectedOrgKeyword": if user mentions a specific org, region, country or division (e.g. "TSS Germany", "Germany", "DACH"), extract the search keyword. Otherwise null.
- "detectedOwnerKeyword": if user mentions a specific person/owner name (sales rep), extract it. Otherwise null.
- "detectedCustomerKeyword": if user mentions a specific CUSTOMER/ACCOUNT name — i.e. the company being sold to, not Trelleborg's own sales org (e.g. "customer Trumpf", "understanding of Trumpf", "brief for Siemens", "our account with Bosch") — extract the customer name. This is especially important for "Customer Meeting" audience briefs, which are usually about ONE specific customer. Otherwise null.
- "detectedPeriod": if user explicitly mentions a time period (e.g. "Q4 2025", "last month", "H1 2026"), set to the human label. Otherwise null.
- "detectedDateFrom" / "detectedDateTo": if user mentions a specific calendar period, calculate the exact ISO dates. Examples: "Q4 2025" → 2025-10-01 / 2025-12-31, "Q1 2026" → 2026-01-01 / 2026-03-31, "last month" from today (${new Date().toISOString().slice(0,10)}) → first/last of previous month, "H1 2025" → 2025-01-01 / 2025-06-30. Set both to null if no specific period mentioned.
- "scopeWarning": if detectedOrgKeyword, detectedOwnerKeyword, or detectedCustomerKeyword is set BUT no matching filter is active yet, warn clearly (name which one). Otherwise null.
- "clarificationNeeded": true when the request is ambiguous and you cannot confidently scope the brief without more information. Examples of ambiguous requests:
  * User mentions a territory code or abbreviation you don't recognise (e.g. "TR2", "DACH East", "Region 5") — you don't know if this maps to a sales org, a country, a team, or something else
  * User mentions a term that could mean multiple things (e.g. "Turkey" could be the country or a specific org unit)
  * User's intent is genuinely unclear even for a general brief
  Do NOT set clarificationNeeded just because an org filter isn't set — that is handled by scopeWarning + the org picker.
- "clarificationQuestion": if clarificationNeeded, ask ONE concise question that will resolve the ambiguity. Be specific about what you didn't understand. Example: "You mentioned 'TR2 Region' — could you clarify what this refers to? Is it a sales territory, a specific sales org, or a country/region name?"
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
  customer: 'Customer Meeting — INTERNAL prep notes for the sales rep before meeting this customer, not a document handed to the customer. Surface win/loss history, open deals to push, stale deals to address, and recency — framed as talking points and things to watch for, not raw internal metrics dumped flatly.',
  team: 'Sales Team — win rates, pipeline health, motivating and energetic tone, celebrate wins.',
  territory: 'Territory Review — sales-org breakdown, geographic performance comparison.',
  investor: 'Investor / Stakeholder — growth story, pipeline momentum, forward-looking confidence with credible numbers.',
};

// Maps focus-area chip ids (picked by the user in the Sales Brief UI) to the
// specific instruction each one adds to the "Talking Points" section —
// keeps the brief scoped to exactly what the rep asked for, instead of a
// fixed list we guessed at.
const FOCUS_AREA_PROMPTS = {
  'win-loss': `Win/loss history with this customer (win rate, won count, lost count/value) — framed as "here's our track record with them," not a bare metrics table.`,
  'relationship-health': `Recency (lastActivityDate in stats) and stale deals (untouched 90+ days) — tell the rep if the relationship is warm or has gone quiet, and flag stale deals as "worth raising in the meeting."`,
  'open-deals': `Open deals currently in motion with this customer that the rep should push toward a decision.`,
  'product-mix': `Product/category patterns from this customer's past quotes and opportunities — a natural cross-sell or up-sell angle to raise.`,
  'risk-flags': `Anything the data suggests the rep should NOT bring up unprompted (e.g. a recent loss) vs. what's safe/positive to lead with.`,
};

/**
 * Write a structured, print-ready sales brief tailored to the audience.
 */
export async function generateBrief({ audience, intent, data, preparedBy, period, customerName, focusAreas = [] }) {
  let customerContext = '';
  if (customerName) {
    customerContext = `\nThis brief is scoped to ONE specific customer: "${customerName}". All data below is already filtered to this customer's opportunities, quotes, and RFQs.`;
    const activeFocusPrompts = focusAreas.map((id) => FOCUS_AREA_PROMPTS[id]).filter(Boolean);
    if (activeFocusPrompts.length > 0) {
      customerContext += `\nInclude a "Talking Points" section covering exactly these points (the rep explicitly chose these focus areas — do not add others):\n` +
        activeFocusPrompts.map((p) => `  - ${p}`).join('\n') +
        `\nThis section is for the REP's eyes only — it will not be shown to the customer.`;
    }
  }
  const prompt = `Write a sales brief for Trelleborg Sealing Solutions (industrial sealing manufacturer) based on live CRM data.
Audience: ${AUDIENCE_TONES[audience] || audience}${customerContext}
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
- "title": if this brief is scoped to one customer, include the customer name in the title (e.g. "Trumpf Account Review" not a generic title).
- 4-6 keyMetrics with values formatted for slides (e.g. "€45.1M", "33%", "592").
- 3-5 sections; each body is 1-2 short paragraphs of flowing prose; bullets optional (max 4).
- 3-5 keyTakeaways, each a single punchy sentence.
- Every number must come from the data below — never invent figures.
- Currency is EUR unless the data says otherwise.
- IMPORTANT: The official data period is "${period}". Use ONLY this label in the subtitle and anywhere you reference the time range. Do NOT calculate or invent an alternative period label from the data.
Data: ${JSON.stringify(data).slice(0, 40_000)}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });
  return parseJsonResponse(extractText(response));
}

// ---------------------------------------------------------------------------
// Custom aggregate agent — handles requests that mention a specific metric/
// field not covered by any pre-built endpoint. Instead of guessing which
// endpoint/field to use (the failure mode that produced confidently wrong
// answers), this runs a tool-calling loop: the agent can look up real field
// names (list_fields) before computing anything (aggregate), and the system
// prompt forbids it from claiming success unless a tool call actually
// confirmed the field and returned real matched values.
// ---------------------------------------------------------------------------

// Known business-term -> real-field mappings, confirmed by hand (e.g. via
// C4C's "View Model Attributes" UI panel showing the model binding behind a
// screen label). list_fields can NEVER discover these on its own — OData
// metadata only exposes technical field names, not custom UI label renames,
// so a term like "Estimated Peak Turnover" (a renamed label for
// ExpectedRevenueAmount in this tenant's UI) has no way to be found by
// searching field names alone. Add entries here as more are confirmed.
const BUSINESS_TERM_GLOSSARY = [
  {
    terms: ['estimated peak turnover', 'peak turnover', 'expected peak turnover'],
    entity: 'opportunities',
    fieldName: 'ExpectedRevenueAmount',
    displayLabel: 'Estimated Peak Turnover',
    note: 'Confirmed via C4C UI model binding (/Root/ExpectedRevenueAmount/content) — this is a renamed UI label, not a separate field. ExpectedRevenueAmount is in the deal\'s original transaction currency (varies per record). Use ZBaseCurrency_KUTContent_KUT (the already EUR-converted figure) instead of raw ExpectedRevenueAmount whenever: (a) the user asks for a sum specifically "in EUR"/"in €", OR (b) the sum spans more than one sales org/country/region (e.g. "Europe", "all orgs", multiple named countries) — summing ExpectedRevenueAmount across different orgs silently mixes currencies (EUR, GBP, SEK, CHF, ...) into one meaningless number even if the user never said "€". Only use raw ExpectedRevenueAmount for a single-org query where the user did not ask for EUR specifically.',
  },
  {
    terms: ['start of production', 'sop', 'sop date', 'production start'],
    entity: 'opportunities',
    fieldName: 'ZSOP',
    displayLabel: 'Start of Production',
    note: 'Confirmed real dedicated field for Start of Production. Do NOT use ExpectedProcessingEndDate for this — that is a different, later date ("expected processing end"), a common mix-up. Use ZSOP as secondaryDateField when the user asks about SOP timing.',
  },
  {
    terms: ['quote cost', 'quote item cost', 'cost amount', 'cost estimate'],
    entity: 'quotes',
    fieldName: 'ZItemCostcontent (total) or CostAmountContent_KUT (per-unit) on SalesQuoteItem',
    displayLabel: 'Quote Item Cost',
    note: 'PRIMARY SOURCE: use SalesQuoteItem\'s own fields directly (ZItemCostcontent, CostAmountContent_KUT) — this tenant does not use SAP\'s standard pricing procedure, so there is normally no need to query SalesQuotePriceItem condition rows for routine cost/margin questions. CostAmountContent_KUT is a PER-UNIT rate; ZItemCostcontent is the TOTAL for the item (verified: 388.82 × Quantity 5 = 1944.10 = ZItemCostcontent on a live record). IMPORTANT currency warning (confirmed by one-off verification, not something to re-check routinely): CostAmountcurrencyCode_KUT can be mislabeled — on the same verified record it said "EUR" while the real transaction currency was GBP (the quote\'s own/customer currency). Do not trust that currency label; assume cost figures are in the quote\'s own transaction currency (same as NetAmount) unless told otherwise.',
  },
  {
    terms: ['margin', 'quote margin', 'item margin', 'margin bi', 'profit margin'],
    entity: 'quotes',
    fieldName: 'ZItemMarginPercent (%) / ZItemMargincontent (amount) on SalesQuoteItem',
    displayLabel: 'Quote Item Margin',
    note: 'PRIMARY SOURCE: use SalesQuoteItem\'s own fields directly — no need to query pricing conditions (this tenant doesn\'t use standard SAP pricing). ZMarginBI_KUT is the same figure as ZItemMarginPercent, just rounded slightly differently — treat as equivalent. These margin fields are in the quote\'s own transaction currency (same as NetAmount), not a fixed currency.',
  },
  {
    terms: ['approval total'],
    entity: 'quotes',
    fieldName: 'ApprovalTotal_19b842e8f51f440c90d08cb9eb677b1b',
    displayLabel: 'Approval Total',
    note: 'Confirmed via C4C UI model binding (/Root/ApprovalTotal_19b842e8f51f440c90d08cb9eb677b1b/content). This is a GUID-suffixed Key User Extensibility custom field — SAP\'s naming pattern for fields added via the UI "add field" wizard, NOT a hand-coded KUT/SDK field. Before using it in aggregate, call list_fields on "quotes" first to confirm this exact name is exposed in the OData service — GUID-suffixed extension fields sometimes differ slightly between the UI binding name and the actual OData property name, unlike the other entries in this glossary which are already verified end-to-end. Likely semantics (per business description, not yet independently verified): for opportunities/quotes with alternative item groups (AlternativeToItemID), only the highest-value item per group counts; otherwise equal to the item/quote total.',
  },
  {
    terms: ['approval margin', 'approval margin percent'],
    entity: 'quotes',
    fieldName: 'ApprovalMarginPercent_106549400b2441d384f3008d5acf863e',
    displayLabel: 'Approval Margin %',
    note: 'Confirmed via C4C UI model binding. Same caveat as ApprovalTotal above: GUID-suffixed Key User Extensibility field — verify via list_fields on "quotes" before using in aggregate, do not assume it matches the UI binding name exactly.',
  },
];

// Human-readable label for a raw field name, for display in the UI — raw
// names like ZBaseCurrency_KUTContent_KUT mean nothing to a business user.
// Looked up server-side (not trusted from the LLM) so it's always correct
// for known fields; falls back to a humanized version of the raw name for
// anything not yet in the glossary, so the UI never shows a hard "unknown".
export function getFieldDisplayLabel(fieldName) {
  if (!fieldName) return fieldName;
  const entry = BUSINESS_TERM_GLOSSARY.find((g) => g.fieldName === fieldName);
  if (entry?.displayLabel) return entry.displayLabel;
  if (fieldName === 'ZBaseCurrency_KUTContent_KUT') return 'Estimated Peak Turnover (EUR)';
  return fieldName
    .replace(/_KUT.*$|_SDK.*$|content$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^Z/, '')
    .trim();
}

// Fields we've been told are coming soon but are NOT YET LIVE in the
// system. If a user asks about one of these, the agent should explain
// it's planned but not yet available — NOT silently fail, NOT guess a
// substitute, and NOT assume it's already deployed just because it's in
// this list. Move an entry to BUSINESS_TERM_GLOSSARY once confirmed live
// via list_fields.
const PENDING_FIELDS = [
  {
    terms: ['lost total', 'quote lost total', 'total lost'],
    entity: 'quotes',
    fieldName: 'ZLostTotal_SDK_e660a65186d74f1fa49c5c15c52392a9',
    note: 'Confirmed field name via UI model binding (/Root/ZLostTotal_SDK_e660a65186d74f1fa49c5c15c52392a9/content), but NOT YET LIVE — announced as coming soon, not yet deployed to the system as of this writing. Likely represents the total value of lost quote items/lines, based on the name, but this has not been confirmed. When this comes up, call list_fields on "quotes" to check if it now exists — if not found, tell the user it\'s planned but not yet available rather than failing silently or guessing a substitute metric.',
  },
  {
    terms: ['open total', 'quote open total', 'total open'],
    entity: 'quotes',
    fieldName: 'ZOpenTotal_SDK_dd2271b3b5214c838c51b902b5a1ee6f',
    note: 'Confirmed field name via UI model binding (/Root/ZOpenTotal_SDK_dd2271b3b5214c838c51b902b5a1ee6f/content), but NOT YET LIVE — same status as ZLostTotal_SDK above (coming soon, not yet deployed). Likely represents the total value of open/not-yet-decided quote items/lines, based on the name, but not confirmed. Check list_fields on "quotes" when this comes up; if not found, tell the user it\'s planned but not yet available.',
  },
];


// Entries where we found TWO candidate fields for the same business term and
// genuinely do not know which one the business means — confirmed by hand,
// not a guess. Unlike BUSINESS_TERM_GLOSSARY, the agent must ASK the user
// to clarify rather than picking one, since picking wrong here is exactly
// the failure mode this whole system exists to prevent.
const AMBIGUOUS_TERMS = [
  {
    terms: ['quote probability', 'probability', 'win probability', 'order probability'],
    entity: 'quotes',
    note: 'TWO different fields exist on SalesQuoteCollection with different values on the same real record: ProbabilityPercent (e.g. 100%) and OrderProbability_KUT (e.g. 30%, displayed as "35%" in OrderProbability_KUTText — note even the raw value and its own text can disagree). We have not confirmed which one the business means by "probability." Do NOT pick one — ask the user to clarify which field they mean before computing anything.',
  },
];


const CUSTOM_AGENT_TOOLS = [
  {
    name: 'list_fields',
    description: 'List all real field names available on a C4C collection. Use this BEFORE aggregate whenever you are not 100% certain a field name exists exactly as the user described it — never guess or invent a field name.',
    input_schema: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          enum: ['opportunities', 'opportunity-items', 'quotes', 'quote-items', 'rfqs'],
          description: 'Which collection to inspect. Use "opportunities" or "quotes" for header-level fields, the "-items" variants for line-item fields.',
        },
      },
      required: ['collection'],
    },
  },
  {
    name: 'resolve_org_scope',
    description: 'Resolves a free-text org/country/region term (e.g. "Hungary", "Europe", "DACH") against the REAL sales org catalog in C4C. ALWAYS call this before using any org/region term as a filter — never pass a region name straight into aggregate\'s salesOrgId yourself. Returns matchType: "single" (one real org, safe to use directly), "multiple" (more than one real org matched the term directly), "region" (a recognized region resolved to its member country-level orgs — use the returned orgs list, do not invent the country list yourself), "ambiguous" or "none" (no confident match, OR a genuine naming collision — e.g. the tenant has real orgs literally named after the region, like "TSS Auto Europe", which is a DIFFERENT real scope than "every country org in that region" and we do not know which one the user means). On "ambiguous", read the "note" field if present (it explains WHY it\'s ambiguous) and report success: false, quoting the real candidate org names from "candidates" so the user can pick — never silently default to one interpretation.',
    input_schema: {
      type: 'object',
      properties: {
        term: { type: 'string', description: 'The org/country/region text exactly as the user said it, e.g. "Hungary" or "Europe".' },
      },
      required: ['term'],
    },
  },
  {
    name: 'aggregate_by_org',
    description: 'Computes a per-org breakdown AND total of sum/count/avg for a field across MULTIPLE orgs in one call — use this whenever the user asks about more than one org/country/region (e.g. a region rollup from resolve_org_scope, or several named countries), instead of calling aggregate once per org yourself. This guarantees the SAME field/currency is used consistently across every org (it automatically switches to the EUR-converted field when summing a currency-amount field across >1 org, same as aggregate does) and returns a proper per-org breakdown table instead of one flattened number — this is the correct way to answer a rollup question, and keeps a 0-result org visible instead of silently folded into the total.',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ['opportunities', 'quotes'] },
        fieldName: { type: 'string', description: 'The exact field name (from the glossary or list_fields). May be auto-upgraded to the EUR-converted equivalent for currency safety.' },
        aggregation: { type: 'string', enum: ['sum', 'count', 'avg'] },
        orgs: {
          type: 'array',
          description: 'The exact org list from a resolve_org_scope result (its "orgs" array) — do not hand-build this list.',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            required: ['id', 'name'],
          },
        },
        status: { type: 'string', enum: ['won', 'open', 'lost', 'all'], description: 'Default "all".' },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        secondaryDateField: { type: 'string' },
        secondaryDateFrom: { type: 'string' },
        secondaryDateTo: { type: 'string' },
      },
      required: ['entity', 'fieldName', 'aggregation', 'orgs'],
    },
  },
  {
    name: 'aggregate',
    description: 'Compute sum, count, or average of ONE real, already-verified field across Opportunities or Quotes, with optional filters, scoped to AT MOST ONE org. fieldName MUST be a real field name you confirmed via list_fields — passing a guessed or invented field name will just return zero matched values, which you must treat as failure, not as "the value is zero." For more than one org, use aggregate_by_org instead, after resolve_org_scope.',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ['opportunities', 'quotes'] },
        fieldName: { type: 'string', description: 'The exact field name as returned by list_fields.' },
        aggregation: { type: 'string', enum: ['sum', 'count', 'avg'] },
        status: { type: 'string', enum: ['won', 'open', 'lost', 'all'], description: 'Filter by opportunity lifecycle outcome. Only meaningful for entity="opportunities". Default "all".' },
        salesOrgId: { type: 'string', description: 'Sales org ID or country/region name only (e.g. "Hungary", not "Hungary sales organization"), if the user specified one. Keep it to the bare name/code — extra words weaken the match.' },
        account: { type: 'string', description: 'Customer/account name substring, if the user specified one.' },
        dateFrom: { type: 'string', description: 'ISO date, filters on CreationDateTime.' },
        dateTo: { type: 'string', description: 'ISO date, filters on CreationDateTime.' },
        secondaryDateField: { type: 'string', description: 'A different date field to also filter on, e.g. ZSOP for "start of production" (see glossary). Must be a real field confirmed via list_fields or the glossary.' },
        secondaryDateFrom: { type: 'string' },
        secondaryDateTo: { type: 'string' },
      },
      required: ['entity', 'fieldName', 'aggregation'],
    },
  },
  {
    name: 'count_quote_conversions',
    description: 'Counts opportunities that have been converted to a Sales Quote (i.e. have a successor Sales Quote document). Use this for any question about "opportunities converted to quote", "quote conversion rate", "which opportunities became quotes", etc. There is NO boolean flag for this on the Opportunity header — it is derived from the OpportunityBusinessTransactionDocumentReference relationship data, which this tool already handles internally. Do not try to answer quote-conversion questions via aggregate/list_fields — use this tool directly.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['won', 'open', 'lost', 'all'], description: 'Filter opportunities by lifecycle outcome before checking conversion. Default "all".' },
        salesOrgId: { type: 'string', description: 'Sales org ID or country/region name only (e.g. "Hungary", not "Hungary sales organization"), if the user specified one. Keep it to the bare name/code — extra words weaken the match.' },
        account: { type: 'string', description: 'Customer/account name substring, if the user specified one.' },
        dateFrom: { type: 'string', description: 'ISO date, filters opportunities on CreationDateTime.' },
        dateTo: { type: 'string', description: 'ISO date, filters opportunities on CreationDateTime.' },
      },
    },
  },
  {
    name: 'count_rfqs_from_quotes',
    description: 'Counts RFQs that have been raised FROM quotes (the reverse direction of count_quote_conversions) — i.e. quote line items that reference an RFQ they generated. Use this for "how many RFQs have been raised from quotes this quarter", "RFQs generated from quotes", etc. There is no boolean flag for this — it is derived from RFQ_IDcontent_SDK on SalesQuoteItem, which this tool handles internally. CAVEAT you must pass on to the user if the result is 0 or looks surprising: this field has not been seen populated in any sample record during development — if the count is 0, say that plainly rather than treating it as a confident "no RFQs were raised," since it could also mean this field isn\'t actually being populated by the current process. Only supports date filtering (no org/account filter yet).',
    input_schema: {
      type: 'object',
      properties: {
        dateFrom: { type: 'string', description: 'ISO date, filters quote items on CreationDateTime.' },
        dateTo: { type: 'string', description: 'ISO date, filters quote items on CreationDateTime.' },
      },
    },
  },
];

// Raised from 6 to 10: the "retry without creation-date filter on a
// false-zero" rule adds a round trip on top of normal exploration
// (list_fields + aggregate + possible retries), and 6 was observed to be
// too tight — a real, resolvable query hit the ceiling and reported
// "could not resolve" instead of finishing.
const CUSTOM_AGENT_MAX_TURNS = 10;

/**
 * Runs the tool-calling loop for a custom-metric request. `executeTool` is
 * injected by the caller (routes/dashboard.js) so this file stays free of
 * direct C4C/analytics-service imports — it owns the Anthropic conversation
 * mechanics only; actual data access is delegated.
 */
export async function runCustomAggregateAgent({ userRequest, baseFilters = {}, executeTool }) {
  const glossaryText = BUSINESS_TERM_GLOSSARY
    .map((g) => `  - "${g.terms.join('" / "')}" → entity: ${g.entity}, fieldName: ${g.fieldName}. ${g.note}`)
    .join('\n');
  const ambiguousText = AMBIGUOUS_TERMS
    .map((a) => `  - "${a.terms.join('" / "')}" (entity: ${a.entity}): ${a.note}`)
    .join('\n');
  const pendingText = PENDING_FIELDS
    .map((p) => `  - "${p.terms.join('" / "')}" → entity: ${p.entity}, fieldName: ${p.fieldName}. ${p.note}`)
    .join('\n');

  const systemPrompt = `You are a data analyst for Trelleborg Sealing Solutions' SAP C4C CRM data. The user asked a question that doesn't match any pre-built report — you must verify real data before answering.

KNOWN BUSINESS-TERM ALIASES — check this list FIRST, before calling list_fields. These are confirmed mappings from business language to real field names (found by inspecting the C4C UI's model binding, since OData metadata never exposes custom UI label renames — list_fields cannot discover these on its own):
${glossaryText || '  (none yet)'}
If the user's term matches one of these (even loosely — "peak turnover", "turnover", "estimated peak turnover" are all the same alias), use the mapped field directly — skip list_fields and go straight to aggregate, UNLESS that entry's own note tells you to verify via list_fields first (this applies to GUID-suffixed custom extension fields, where the UI binding name is not guaranteed to exactly match the OData property name).

PENDING FIELDS — known field names that are NOT YET LIVE (coming soon). If the user's term matches one of these, call list_fields to check if it has gone live yet. If not found, tell the user it's planned but not yet available — do not guess a substitute or fail silently:
${pendingText || '  (none yet)'}

AMBIGUOUS TERMS — check this list too, BEFORE assuming any mapping. These are cases where we found multiple real candidate fields and do not know which one the business means:
${ambiguousText || '  (none yet)'}
If the user's term matches one of these, do NOT guess which field to use and do NOT pick the "more obviously named" one. Respond with success: false and a clarificationQuestion-style explanation asking the user to specify which field/number they mean, listing the real candidates you found. Picking wrong here silently is the exact failure this system exists to prevent — asking is always better than guessing.

CRITICAL RULES — these exist because guessing produced confidently wrong answers in production:
1. NEVER invent, guess, or assume a field name exists. If a term isn't in the glossary above and you are not certain, call list_fields first.
2. If after checking list_fields (try multiple relevant collections if the field could be on either) you cannot find a field matching what the user asked for, STOP. Do not substitute a different metric, do not approximate. Report success: false and explain specifically what you looked for and didn't find.
3. aggregate returning valuesFound: 0 while recordsMatched > 0 means the field name was wrong, or empty for every matched record. This is NOT a valid "the answer is 0" result — treat it as failure, try a different field name from list_fields, or give up and report success: false.
4. Your final explanation must describe EXACTLY what the tool(s) you called actually returned — never describe a filter, field, or computation you did not actually execute via a tool call.
5. Already-known filters from the UI (use these as defaults unless the user's question overrides them): ${JSON.stringify(baseFilters)}
   IMPORTANT: these UI filters' dateFrom/dateTo apply to CreationDateTime. If the user's question is about a DIFFERENT date concept (e.g. "start of production", resolved via secondaryDateField), do NOT also pass the UI's dateFrom/dateTo as the aggregate call's dateFrom/dateTo unless the user ALSO explicitly wants creation-date scoping — stacking both silently over-restricts the result (an opportunity created in 2025 with 2026 SOP would be wrongly excluded by also requiring CreationDateTime in 2026) and can produce a false "0 records" answer that looks like a real zero. When in doubt, leave dateFrom/dateTo unset and use only secondaryDateFrom/secondaryDateTo for the date concept the user actually asked about.
6. If a call returns recordsMatched: 0 and you passed BOTH dateFrom/dateTo AND secondaryDateField/secondaryDateFrom/secondaryDateTo, retry the SAME call with dateFrom/dateTo removed before concluding the answer is really 0 — this isolates whether the creation-date default caused the false zero. Only report a confident "0" after this retry also returns 0, and say in your explanation that you checked this.
7. Today's date: ${new Date().toISOString().slice(0, 10)} — resolve relative/specific periods (e.g. "2026", "start of production in 2026") to ISO dates yourself.
8. formattedValue must contain ONLY the formatted number (e.g. "€10,351,526") — never append a parenthetical, caveat, or "(see...)" note to it. Anything the user needs to understand about the number (which filter was used, what's missing, what's uncertain) belongs in explanation or caveats, never jammed into formattedValue — it is rendered as a standalone number in the UI and breaks visually if it isn't one.
9. A region or country name the user mentions (e.g. "Europe", "APAC", "Hungary") is NOT itself a verified salesOrgId — NEVER pass it straight into aggregate's salesOrgId and trust whatever it happens to match. ALWAYS call resolve_org_scope(term) first. Then: matchType "single" → safe to use that one org directly (aggregate or aggregate_by_org with one org). matchType "multiple" or "region" → the user's term covers more than one real org — use aggregate_by_org with the exact orgs array resolve_org_scope returned (never hand-build or guess an org list yourself, even for a region you think you recognize). matchType "ambiguous" or "none" → report success: false and ask the user to pick from the "candidates" resolve_org_scope returned — do not guess.
10. If a per-org call inside an aggregate_by_org breakdown returns 0 while others succeed (e.g. one country in a multi-country sum didn't match), that org still appears as its own row in the breakdown — do not omit it or explain it away as unimportant; mention in your explanation if a 0 looks surprising (e.g. "United Kingdom returned 0 records — verify this org has data for the period asked").

When you have a final answer (or have given up), respond with JSON only, no markdown fences. If you used aggregate_by_org (more than one org), set "breakdown" to its breakdown array and "value"/"recordsMatched" to its total/totalRecordsMatched; otherwise leave "breakdown" null:
{
  "success": boolean,
  "value": number|null,
  "formattedValue": string|null,
  "fieldUsed": string|null,
  "entity": string|null,
  "aggregation": string|null,
  "recordsMatched": number|null,
  "breakdown": [{"Org": string, "Value": number, "Records matched": number}]|null,
  "explanation": string,
  "caveats": [string]
}`;

  const messages = [{ role: 'user', content: userRequest }];
  const client = getClient();

  for (let turn = 0; turn < CUSTOM_AGENT_MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      tools: CUSTOM_AGENT_TOOLS,
      messages,
    });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0) {
      const text = extractText(response);
      const parsed = extractFinalAnswerJson(text);
      if (parsed) return parsed;
      return { success: false, value: null, formattedValue: null, fieldUsed: null, entity: null, aggregation: null, recordsMatched: null, explanation: text || 'The agent did not return a parseable answer.', caveats: [] };
    }

    messages.push({ role: 'assistant', content: response.content });
    const toolResults = [];
    for (const tu of toolUses) {
      let result;
      try {
        result = await executeTool(tu.name, tu.input);
      } catch (err) {
        result = { error: err.message };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return {
    success: false, value: null, formattedValue: null, fieldUsed: null, entity: null, aggregation: null, recordsMatched: null,
    explanation: `Could not resolve this within ${CUSTOM_AGENT_MAX_TURNS} verification steps — the field or computation may not be supported yet.`,
    caveats: [],
  };
}
