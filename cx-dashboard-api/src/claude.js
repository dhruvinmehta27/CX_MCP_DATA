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
    note: 'Confirmed via C4C UI model binding (/Root/ExpectedRevenueAmount/content) — this is a renamed UI label, not a separate field. ExpectedRevenueAmount is in the deal\'s original transaction currency (varies per record). If the user asks for a sum specifically "in EUR"/"in €", use ZBaseCurrency_KUTContent_KUT instead — the already EUR-converted figure — not raw ExpectedRevenueAmount, to avoid mixing currencies in the sum.',
  },
  {
    terms: ['start of production', 'sop', 'sop date', 'production start'],
    entity: 'opportunities',
    fieldName: 'ZSOP',
    note: 'Confirmed real dedicated field for Start of Production. Do NOT use ExpectedProcessingEndDate for this — that is a different, later date ("expected processing end"), a common mix-up. Use ZSOP as secondaryDateField when the user asks about SOP timing.',
  },
  {
    terms: ['quote cost', 'quote item cost', 'cost amount', 'cost estimate'],
    entity: 'quotes',
    fieldName: 'ZItemCostcontent (total) or CostAmountContent_KUT (per-unit) on SalesQuoteItem',
    note: 'PRIMARY SOURCE: use SalesQuoteItem\'s own fields directly (ZItemCostcontent, CostAmountContent_KUT) — this tenant does not use SAP\'s standard pricing procedure, so there is normally no need to query SalesQuotePriceItem condition rows for routine cost/margin questions. CostAmountContent_KUT is a PER-UNIT rate; ZItemCostcontent is the TOTAL for the item (verified: 388.82 × Quantity 5 = 1944.10 = ZItemCostcontent on a live record). IMPORTANT currency warning (confirmed by one-off verification, not something to re-check routinely): CostAmountcurrencyCode_KUT can be mislabeled — on the same verified record it said "EUR" while the real transaction currency was GBP (the quote\'s own/customer currency). Do not trust that currency label; assume cost figures are in the quote\'s own transaction currency (same as NetAmount) unless told otherwise.',
  },
  {
    terms: ['margin', 'quote margin', 'item margin', 'margin bi', 'profit margin'],
    entity: 'quotes',
    fieldName: 'ZItemMarginPercent (%) / ZItemMargincontent (amount) on SalesQuoteItem',
    note: 'PRIMARY SOURCE: use SalesQuoteItem\'s own fields directly — no need to query pricing conditions (this tenant doesn\'t use standard SAP pricing). ZMarginBI_KUT is the same figure as ZItemMarginPercent, just rounded slightly differently — treat as equivalent. These margin fields are in the quote\'s own transaction currency (same as NetAmount), not a fixed currency.',
  },
];

// NOT YET CONFIRMED — the user described "Approval Total" (an aggregate
// where items sharing an AlternativeToItemID group only count their
// highest-value item, otherwise same as the item total) but we have not
// found a real field for this in any collection pulled so far. Do not
// invent one. If a user asks about this, the agent must say it hasn't
// been located yet and ask for the specific field/UI binding, same as
// how Peak Turnover and the Cost Amount currency bug were resolved.


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
    name: 'aggregate',
    description: 'Compute sum, count, or average of ONE real, already-verified field across Opportunities or Quotes, with optional filters. fieldName MUST be a real field name you confirmed via list_fields — passing a guessed or invented field name will just return zero matched values, which you must treat as failure, not as "the value is zero."',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ['opportunities', 'quotes'] },
        fieldName: { type: 'string', description: 'The exact field name as returned by list_fields.' },
        aggregation: { type: 'string', enum: ['sum', 'count', 'avg'] },
        status: { type: 'string', enum: ['won', 'open', 'lost', 'all'], description: 'Filter by opportunity lifecycle outcome. Only meaningful for entity="opportunities". Default "all".' },
        salesOrgId: { type: 'string', description: 'Sales org ID or name substring, if the user specified one.' },
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
        salesOrgId: { type: 'string', description: 'Sales org ID or name substring, if the user specified one.' },
        account: { type: 'string', description: 'Customer/account name substring, if the user specified one.' },
        dateFrom: { type: 'string', description: 'ISO date, filters opportunities on CreationDateTime.' },
        dateTo: { type: 'string', description: 'ISO date, filters opportunities on CreationDateTime.' },
      },
    },
  },
];

const CUSTOM_AGENT_MAX_TURNS = 6;

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

  const systemPrompt = `You are a data analyst for Trelleborg Sealing Solutions' SAP C4C CRM data. The user asked a question that doesn't match any pre-built report — you must verify real data before answering.

KNOWN BUSINESS-TERM ALIASES — check this list FIRST, before calling list_fields. These are confirmed mappings from business language to real field names (found by inspecting the C4C UI's model binding, since OData metadata never exposes custom UI label renames — list_fields cannot discover these on its own):
${glossaryText || '  (none yet)'}
If the user's term matches one of these (even loosely — "peak turnover", "turnover", "estimated peak turnover" are all the same alias), use the mapped field directly — skip list_fields and go straight to aggregate.

AMBIGUOUS TERMS — check this list too, BEFORE assuming any mapping. These are cases where we found multiple real candidate fields and do not know which one the business means:
${ambiguousText || '  (none yet)'}
If the user's term matches one of these, do NOT guess which field to use and do NOT pick the "more obviously named" one. Respond with success: false and a clarificationQuestion-style explanation asking the user to specify which field/number they mean, listing the real candidates you found. Picking wrong here silently is the exact failure this system exists to prevent — asking is always better than guessing.

CRITICAL RULES — these exist because guessing produced confidently wrong answers in production:
1. NEVER invent, guess, or assume a field name exists. If a term isn't in the glossary above and you are not certain, call list_fields first.
2. If after checking list_fields (try multiple relevant collections if the field could be on either) you cannot find a field matching what the user asked for, STOP. Do not substitute a different metric, do not approximate. Report success: false and explain specifically what you looked for and didn't find.
3. aggregate returning valuesFound: 0 while recordsMatched > 0 means the field name was wrong, or empty for every matched record. This is NOT a valid "the answer is 0" result — treat it as failure, try a different field name from list_fields, or give up and report success: false.
4. Your final explanation must describe EXACTLY what the tool(s) you called actually returned — never describe a filter, field, or computation you did not actually execute via a tool call.
5. Already-known filters from the UI (use these as defaults unless the user's question overrides them): ${JSON.stringify(baseFilters)}
6. Today's date: ${new Date().toISOString().slice(0, 10)} — resolve relative/specific periods (e.g. "2026", "start of production in 2026") to ISO dates yourself.

When you have a final answer (or have given up), respond with JSON only, no markdown fences:
{
  "success": boolean,
  "value": number|null,
  "formattedValue": string|null,
  "fieldUsed": string|null,
  "entity": string|null,
  "aggregation": string|null,
  "recordsMatched": number|null,
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
      try {
        return parseJsonResponse(text);
      } catch {
        return { success: false, value: null, formattedValue: null, fieldUsed: null, entity: null, aggregation: null, recordsMatched: null, explanation: text || 'The agent did not return a parseable answer.', caveats: [] };
      }
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
