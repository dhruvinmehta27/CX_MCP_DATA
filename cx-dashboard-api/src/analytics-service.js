/**
 * Analytics service — one function per query type.
 * Each function: cache check → fetch all pages from C4C → aggregate → cache.
 * Shared by the REST routes and the Claude-powered dashboard generator.
 */
import {
  fetchQuotes, fetchOpportunities, fetchOpportunityItems, fetchOpportunityItemsByParents, fetchRFQs,
  fetchTasks, fetchVisits, fetchAppointments,
  countQuotes, countOpportunities, countRFQs,
  fetchAccountCountries, fetchOpportunityQuoteReferences, fetchQuoteItems, fetchSalesOrgs,
} from './c4c-client.js';
import { getAccountCountryMap, enrichWithCountry, enrichOpportunitiesWithAccountClassification } from './account-cache.js';
import {
  countBy, sumBy, trendByMonth, pipelineStages, dailySummary,
  quotesByDayThisWeek, isOpenStatus, isWonStatus, isRfqOpen, parseODataDate, toNumber,
  pipelineOverview, funnelSnapshot, oppValue,
} from './aggregations.js';
import { getOrSet } from './cache.js';

const BIZ_TYPE_LABELS = { 11: 'New', 12: 'Follow-up', 13: 'Replacement' };

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function suggestCategories(keywords, items) {
  const uniqueCats = [...new Set(
    items.map((i) => i.ProductCategoryDescription || i.ProductCategoryDescription_SDK || '').filter(Boolean)
  )];
  if (uniqueCats.length === 0) return [];
  return keywords.flatMap((kw) => {
    const scored = uniqueCats
      .map((cat) => {
        const dist = levenshtein(kw, cat.toLowerCase());
        return { cat, sim: 1 - dist / Math.max(kw.length, cat.length) };
      })
      .filter((s) => s.sim > 0.4)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3)
      .map((s) => s.cat);
    return scored.length ? [{ keyword: kw, suggestions: scored }] : [];
  });
}

/**
 * Raw-dataset cache shared by all endpoints of one entity. Keyed only on
 * the base filters, so the six quote endpoints (by-status, trend, list, …)
 * trigger ONE paginated C4C fetch instead of six — combined with in-flight
 * coalescing in getOrSet this prevents the parallel-fetch stampede that
 * exhausted memory on wide date ranges.
 */
function baseFilters(filters = {}) {
  const { salesOrgId, ownerId, dateFrom, dateTo, account, secondaryDateField, secondaryDateFrom, secondaryDateTo, segment, application, marketSegmentGroup, strategicAccount } = filters;
  return { salesOrgId, ownerId, dateFrom, dateTo, account, secondaryDateField, secondaryDateFrom, secondaryDateTo, segment, application, marketSegmentGroup, strategicAccount };
}

// Words too generic to use as an org-matching token on their own (would
// false-match almost any org name/ID).
const ORG_FILLER_WORDS = new Set(['the', 'sales', 'organization', 'organisation', 'org', 'for', 'and', 'in', 'a']);

// Match org by exact ID code (e.g. "TSSGERMANY") OR by name substring (e.g. "CSC Germany").
// Supports comma-separated values for multi-org filtering (e.g. "TSSCANADA,TSSMEXICO").
// Also tolerant of a verbose phrase (e.g. "Hungary sales organization" instead of
// just "Hungary") since the custom-aggregate agent derives this from free text —
// a plain substring check silently matches nothing in that case and produces a
// false "0 records" answer, so we fall back to significant-word matching too.
function matchesOrg(orgId, orgName, filterValue) {
  if (!filterValue) return true;
  const idLower = (orgId || '').toLowerCase();
  const nameLower = (orgName || '').toLowerCase();
  const values = filterValue.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  return values.some((v) => {
    if (idLower === v) return true;
    if (idLower && (idLower.includes(v) || v.includes(idLower))) return true;
    if (nameLower && (nameLower.includes(v) || v.includes(nameLower))) return true;
    const tokens = v.split(/\s+/).filter((t) => t.length >= 3 && !ORG_FILLER_WORDS.has(t));
    return tokens.some((t) => (idLower && idLower.includes(t)) || (nameLower && nameLower.includes(t)));
  });
}

function matchesAccount(accountName, filterValue) {
  if (!filterValue) return true;
  return !!accountName && accountName.toLowerCase().includes(filterValue.trim().toLowerCase());
}

// Business segment (BUS_SEG_CDE) — confirmed real master-data code table
// (not guessed): AER/AUT/HM/IND are the live codes (HEA is disabled, HM
// replaced it). BUS_SEG_CDE_KUT/BUS_SEG_CDE_KUTText are already fetched on
// every opportunity (OPPORTUNITY_FIELDS), so this is a pure in-process
// filter — no new OData call needed.
const BUSINESS_SEGMENTS = {
  AER: 'Aerospace',
  AUT: 'Automotive',
  HM: 'Healthcare & Medical',
  IND: 'Industrial',
};

function matchesSegment(segCode, segText, filterValue) {
  if (!filterValue) return true;
  const v = filterValue.trim().toLowerCase();
  const codeLower = (segCode || '').toLowerCase();
  const textLower = (segText || '').toLowerCase();
  // Resolve the filter term to a known code first (exact code, or a
  // description match/substring against the confirmed table) — falls back to
  // a direct substring check against the record's own text so an unexpected
  // but real value still matches instead of silently excluding everything.
  const matchedCode = Object.entries(BUSINESS_SEGMENTS).find(
    ([code, desc]) => code.toLowerCase() === v || desc.toLowerCase() === v || desc.toLowerCase().includes(v)
  )?.[0];
  if (matchedCode) return codeLower === matchedCode.toLowerCase();
  return textLower.includes(v) || codeLower === v;
}

// Strategic Account classification (StrategicAccount_KUT, on the Account
// entity) — confirmed real master-data code table, including legacy/disabled
// codes (a record saved while a code was active keeps it, so matching still
// needs to recognize e.g. "Hunting" even though it's since been retired).
const STRATEGIC_ACCOUNT_TYPES = {
  101: 'Strategic Prospect',
  111: 'Hunting',
  121: 'Farming',
  131: 'Housed Account',
  141: 'Managed Account',
  151: 'Focus Account',
  161: 'Not Assigned',
};

function matchesCodeTable(code, text, filterValue, table) {
  if (!filterValue) return true;
  const v = filterValue.trim().toLowerCase();
  const codeLower = String(code || '').toLowerCase();
  const textLower = (text || '').toLowerCase();
  const matchedCode = Object.entries(table).find(
    ([c, desc]) => String(c).toLowerCase() === v || desc.toLowerCase() === v || desc.toLowerCase().includes(v)
  )?.[0];
  if (matchedCode) return codeLower === String(matchedCode).toLowerCase();
  return textLower.includes(v) || codeLower === v;
}

// Application and Market Segment Group have ~100/~50 real codes each (too
// many to usefully hardcode for exact matching) — resolved by substring
// against the account's own description text instead, same pattern as
// matchesAccount. Real, confirmed field names (AccountApplicationCodeText,
// AccountMktSegGrpCodeText) via enrichOpportunitiesWithAccountClassification.
function matchesText(text, filterValue) {
  if (!filterValue) return true;
  return !!text && text.toLowerCase().includes(filterValue.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Org/region master data — replaces letting the custom-aggregate agent guess
// which real org(s) a free-text term like "Europe" or "Hungary" means. The
// org catalog itself comes from C4C (fetchSalesOrgs, real org units); the
// region groupings below are plain world geography (continents don't vary
// per tenant), so hardcoding them is safe — unlike guessing SAP org codes.
// ---------------------------------------------------------------------------

let salesOrgsCache = null; // { expiresAt, promise } — shared across users, no PII
export async function getSalesOrgs(userJwt) {
  if (salesOrgsCache && Date.now() < salesOrgsCache.expiresAt) return salesOrgsCache.promise;
  const promise = fetchSalesOrgs(null, userJwt);
  salesOrgsCache = { promise, expiresAt: Date.now() + 60 * 60_000 }; // 1h — org master data changes rarely
  return promise;
}

const REGION_COUNTRIES = {
  europe: ['germany', 'france', 'italy', 'spain', 'netherlands', 'sweden', 'poland', 'hungary', 'austria', 'belgium', 'switzerland', 'united kingdom', 'uk', 'ireland', 'denmark', 'norway', 'finland', 'portugal', 'czech', 'romania', 'slovakia', 'slovenia', 'croatia', 'greece'],
  emea: ['germany', 'france', 'italy', 'spain', 'netherlands', 'sweden', 'poland', 'hungary', 'austria', 'belgium', 'switzerland', 'united kingdom', 'uk', 'ireland', 'denmark', 'norway', 'finland', 'portugal', 'czech', 'romania', 'slovakia', 'slovenia', 'croatia', 'greece', 'south africa', 'uae', 'saudi'],
  dach: ['germany', 'austria', 'switzerland'],
  nordics: ['sweden', 'norway', 'finland', 'denmark'],
  americas: ['united states', 'usa', 'canada', 'mexico', 'brazil', 'argentina', 'chile', 'colombia'],
  apac: ['china', 'japan', 'india', 'korea', 'australia', 'singapore', 'thailand', 'indonesia', 'malaysia', 'vietnam'],
};

// Resolves a free-text org/region term against the REAL org catalog —
// returning validated org IDs the agent can trust, instead of letting it pass
// an unverified string straight through to matchesOrg (which previously let
// "Europe" silently match whatever single org record happened to contain
// that substring, if any).
async function resolveOrgScope(term, userJwt) {
  const orgs = await getSalesOrgs(userJwt);
  const t = (term || '').trim().toLowerCase();
  if (!t) return { matchType: 'none', orgs: [] };

  // Check BOTH interpretations before deciding anything — some tenants have
  // real orgs literally named after a region (e.g. "TSS Auto Europe", "TSS
  // E-Mobility Europe") that are business-unit-level, NOT a roll-up of every
  // country org. Silently preferring our own geography guess (REGION_COUNTRIES)
  // over real org data would repeat the exact mistake this system exists to
  // prevent — so when both exist and disagree, this is genuinely ambiguous
  // and must be asked, not assumed either way.
  const direct = orgs.filter((o) => matchesOrg(o.id, o.name, t));
  const regionKey = Object.keys(REGION_COUNTRIES).find((k) => k === t || t.includes(k));
  const regionMatched = regionKey
    ? orgs.filter((o) =>
        REGION_COUNTRIES[regionKey].some((c) => o.name.toLowerCase().includes(c) || o.id.toLowerCase().includes(c.replace(/\s+/g, '')))
      )
    : [];

  const directIds = new Set(direct.map((o) => o.id));
  const regionOnlyMatches = regionMatched.filter((o) => !directIds.has(o.id));
  if (direct.length > 0 && regionOnlyMatches.length > 0) {
    return {
      matchType: 'ambiguous',
      note: `"${term}" matches real orgs named after it directly (e.g. business-unit-level orgs) AND separately matches country-level orgs in that geographic region — these are two different real interpretations and the correct scope is not known. Ask the user which they mean.`,
      candidates: [...direct, ...regionOnlyMatches],
      // Kept separate (not just merged into candidates) so the UI can offer
      // one-click options for each real interpretation instead of making the
      // user retype their answer as free text.
      directOrgs: direct,
      regionOrgs: regionOnlyMatches,
    };
  }

  if (direct.length === 1) return { matchType: 'single', orgs: direct };
  if (direct.length > 1) return { matchType: 'multiple', orgs: direct };
  if (regionMatched.length > 0) return { matchType: 'region', region: regionKey, orgs: regionMatched };
  if (regionKey) return { matchType: 'ambiguous', region: regionKey, orgs: [], candidates: orgs };

  // No confident match — surface close-looking candidates (by word overlap) so
  // the agent can ask the user to pick, instead of guessing.
  const words = t.split(/\s+/).filter((w) => w.length > 2);
  const candidates = orgs.filter((o) => words.some((w) => o.name.toLowerCase().includes(w) || o.id.toLowerCase().includes(w)));
  return { matchType: 'none', orgs: [], candidates };
}

export async function resolveOrgScopeTool({ term }, userJwt) {
  return resolveOrgScope(term, userJwt);
}

// Server-side fields that mix per-record transaction currency and have a
// known EUR-converted equivalent — used to enforce currency safety in code
// (not just via prompt instruction) whenever an aggregate spans >1 org.
const CURRENCY_SAFE_FIELD_MAP = {
  ExpectedRevenueAmount: 'ZBaseCurrency_KUTContent_KUT',
};

// Runs aggregateField once per resolved org, with a single consistent
// fieldName/aggregation across all of them (enforced here, not left to the
// agent to get right across repeated calls), returning a per-org breakdown
// plus the total — the server, not the LLM, owns multi-org rollup math.
export async function aggregateByOrgs({ entity, fieldName, aggregation, orgs, filters = {} }, userJwt, userEmail) {
  let effectiveFieldName = fieldName;
  let currencyOverrideApplied = false;
  if (orgs.length > 1 && CURRENCY_SAFE_FIELD_MAP[fieldName]) {
    effectiveFieldName = CURRENCY_SAFE_FIELD_MAP[fieldName];
    currencyOverrideApplied = true;
  }

  const breakdown = [];
  let total = 0;
  let totalRecordsMatched = 0;
  for (const org of orgs) {
    const result = await aggregateField(
      { entity, fieldName: effectiveFieldName, aggregation, filters: { ...filters, salesOrgId: org.id } },
      userJwt,
      userEmail
    );
    breakdown.push({ Org: org.name, Value: result.value, 'Records matched': result.recordsMatched });
    total += result.value || 0;
    totalRecordsMatched += result.recordsMatched || 0;
  }

  return {
    fieldUsed: effectiveFieldName,
    currencyOverrideApplied,
    aggregation: aggregation || 'sum',
    total,
    totalRecordsMatched,
    breakdown,
  };
}

async function rawQuotes(filters, userJwt, userEmail) {
  const base = baseFilters(filters);
  // SalesOrganisationID and BuyerPartyName both fail combined with the
  // date-range filter server-side (ABAP select-option error) — fetch
  // without either (cached on date/owner only) and scope both in-process.
  const extraFields = filters.extraFields || [];
  const fetchKey = { ...base, salesOrgId: undefined, account: undefined, extraFields };
  const [{ data }, countryMap] = await Promise.all([
    getOrSet(userEmail, 'raw:quotes', fetchKey, () => fetchQuotes(fetchKey, userJwt)),
    getAccountCountryMap(() => fetchAccountCountries(userJwt)),
  ]);
  const enriched = enrichWithCountry(data.results, countryMap);
  const results = enriched.filter((q) =>
    matchesOrg(q.SalesOrganisationID, q.SalesOrganisationName, base.salesOrgId) &&
    matchesAccount(q.BuyerPartyName, base.account)
  );
  if (!base.salesOrgId && !base.account) return { ...data, results: enriched };
  return { ...data, results, total: results.length };
}

async function rawOpportunities(filters, userJwt, userEmail) {
  const base = baseFilters(filters);
  // SalesOrganisationID and ProspectPartyName both fail combined with the
  // date-range filter server-side (ABAP select-option error) — fetch
  // without either (cached on date/owner only) and scope both in-process.
  const extraFields = filters.extraFields || [];
  const fetchKey = { ...base, salesOrgId: undefined, account: undefined, extraFields };
  const needsAccountJoin = !!(base.application || base.marketSegmentGroup || base.strategicAccount);
  const [{ data }, accountMap] = await Promise.all([
    getOrSet(userEmail, 'raw:opportunities', fetchKey, () => fetchOpportunities(fetchKey, userJwt)),
    needsAccountJoin ? getAccountCountryMap(() => fetchAccountCountries(userJwt)) : Promise.resolve(null),
  ]);
  const enriched = needsAccountJoin ? enrichOpportunitiesWithAccountClassification(data.results, accountMap) : data.results;
  if (!base.salesOrgId && !base.account && !base.segment && !needsAccountJoin) return data;
  const results = enriched.filter((o) =>
    matchesOrg(o.SalesOrganisationID, o.SalesOrganisationName, base.salesOrgId) &&
    matchesAccount(o.ProspectPartyName, base.account) &&
    matchesSegment(o.BUS_SEG_CDE_KUT, o.BUS_SEG_CDE_KUTText, base.segment) &&
    matchesText(o.AccountApplicationCodeText, base.application) &&
    matchesText(o.AccountMktSegGrpCodeText, base.marketSegmentGroup) &&
    matchesCodeTable(o.AccountStrategicCode, o.AccountStrategicText, base.strategicAccount, STRATEGIC_ACCOUNT_TYPES)
  );
  return { ...data, results, total: results.length };
}

const STATUS_FILTERS = {
  won: (r) => isWonStatus(r.LifeCycleStatusCodeText),
  open: (r) => isOpenStatus(r.LifeCycleStatusCodeText),
  lost: (r) => !isOpenStatus(r.LifeCycleStatusCodeText) && !isWonStatus(r.LifeCycleStatusCodeText),
  all: () => true,
};

/**
 * Generic sum/count/avg of a named field, used by the custom-aggregate agent
 * tool (claude.js) when the user's request doesn't match any pre-built
 * endpoint. fieldName must be a real field the caller has already verified
 * via fetchCollectionFields — this does NOT guess or validate it beyond
 * checking the values actually parse as numbers, so an unverified/wrong
 * field name will just silently return 0 matched values (surfaced to the
 * caller via matchedValueCount so it can detect that case).
 */
export async function aggregateField({ entity, fieldName, aggregation, filters = {} }, userJwt, userEmail) {
  // Defense in depth: even if the agent bypasses aggregateByOrgs and passes a
  // comma-separated salesOrgId straight to a single aggregate call, force the
  // EUR-converted field for any field known to mix per-record transaction
  // currencies — don't rely solely on the agent following the prompt rule.
  let effectiveFieldName = fieldName;
  let currencyOverrideApplied = false;
  if (filters.salesOrgId && filters.salesOrgId.includes(',') && CURRENCY_SAFE_FIELD_MAP[fieldName]) {
    effectiveFieldName = CURRENCY_SAFE_FIELD_MAP[fieldName];
    currencyOverrideApplied = true;
  }
  fieldName = effectiveFieldName;

  const statusFilter = STATUS_FILTERS[filters.status] || STATUS_FILTERS.all;
  const extraFields = [fieldName, filters.secondaryDateField].filter(Boolean);
  const fetchFilters = { ...filters, extraFields };
  const raw = entity === 'quotes'
    ? await rawQuotes(fetchFilters, userJwt, userEmail)
    : await rawOpportunities(fetchFilters, userJwt, userEmail);

  let rows = raw.results.filter(statusFilter);

  // Optional secondary date filter on a field OTHER than CreationDateTime
  // (e.g. "start of production" = ZSOP, confirmed against a live record —
  // NOT ExpectedProcessingEndDate, a different/later date) — applied
  // in-process since combining extra server-side filters already proved
  // unreliable (ABAP select-option errors) on this tenant.
  if (filters.secondaryDateField && (filters.secondaryDateFrom || filters.secondaryDateTo)) {
    const from = filters.secondaryDateFrom ? new Date(filters.secondaryDateFrom) : null;
    const to = filters.secondaryDateTo ? new Date(filters.secondaryDateTo) : null;
    rows = rows.filter((r) => {
      const d = parseODataDate(r[filters.secondaryDateField]);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }

  // NOTE: deliberately not using the shared toNumber() here — it coerces
  // missing/unparsable values to 0, which would make every row "count" as
  // valid data and hide the signal that fieldName doesn't actually exist
  // or is empty. parseFloat + isNaN keeps that distinction visible via
  // valuesFound below.
  const values = rows
    .map((r) => parseFloat(r[fieldName]))
    .filter((v) => !isNaN(v));

  const sum = values.reduce((a, b) => a + b, 0);
  const value = aggregation === 'count' ? rows.length
    : aggregation === 'avg' ? (values.length ? sum / values.length : null)
    : sum; // default: sum

  return {
    value,
    aggregation: aggregation || 'sum',
    fieldName,
    currencyOverrideApplied,
    entity,
    recordsMatched: rows.length,
    valuesFound: values.length, // if 0 while recordsMatched > 0, fieldName is likely wrong/empty
    truncated: !!raw.truncated,
  };
}

let quoteRefsCache = null; // { expiresAt, promise } — shared across users, no PII, cheap to keep warm
async function getQuoteReferences(userJwt) {
  if (quoteRefsCache && Date.now() < quoteRefsCache.expiresAt) return quoteRefsCache.promise;
  const promise = fetchOpportunityQuoteReferences(userJwt);
  quoteRefsCache = { promise, expiresAt: Date.now() + 10 * 60_000 }; // 10 min
  return promise;
}

// Normalizes the various ways C4C represents a boolean flag in OData
// (true/false, 'X'/blank, '1'/'0', 'true'/'false' as strings) to a real
// boolean — ZQuoteExist_KUT's exact representation hasn't been independently
// confirmed yet, so this accepts the common C4C conventions rather than
// assuming one specific format.
function isFlagTrue(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return ['x', 'true', '1', 'yes'].includes(v.trim().toLowerCase());
  return false;
}

/**
 * Counts opportunities that have been converted to a Sales Quote.
 *
 * Primary signal: ZQuoteExist_KUT — a direct flag on the Opportunity header,
 * exposed specifically to make this count simple (no join needed). Used
 * whenever it appears populated in the scoped result set (at least one
 * true AND the field isn't just universally blank), since an all-false
 * result set could genuinely mean zero conversions, not an unpopulated field.
 *
 * Fallback: OpportunityBusinessTransactionDocumentReference (TypeCode=30
 * "Sales Quote", relationship role "Successor") — the original derivation,
 * confirmed against a live record, kept in case ZQuoteExist_KUT isn't
 * populated for a given org/scope (new field, may roll out gradually).
 *
 * Used by the custom-aggregate agent's count_quote_conversions tool.
 */
export async function opportunitiesConvertedToQuote(filters, userJwt, userEmail) {
  const statusFilter = STATUS_FILTERS[filters.status] || STATUS_FILTERS.all;
  const [opps, refs] = await Promise.all([
    rawOpportunities(filters, userJwt, userEmail),
    getQuoteReferences(userJwt),
  ]);

  const scoped = opps.results.filter(statusFilter);

  const flagValues = scoped.map((o) => o.ZQuoteExist_KUT).filter((v) => v !== undefined && v !== null && v !== '');
  const anyTrueViaFlag = scoped.some((o) => isFlagTrue(o.ZQuoteExist_KUT));
  const flagLooksPopulated = flagValues.length > 0 && anyTrueViaFlag;

  let converted, method;
  if (flagLooksPopulated) {
    converted = scoped.filter((o) => isFlagTrue(o.ZQuoteExist_KUT));
    method = 'ZQuoteExist_KUT flag';
  } else {
    const SUCCESSOR_ROLE_CODE = '2';
    const convertedIds = new Set(
      refs.results
        .filter((r) => r.BusinessTransactionDocumentRelationshipRoleCode === SUCCESSOR_ROLE_CODE)
        .map((r) => r.OpportunityID)
    );
    converted = scoped.filter((o) => convertedIds.has(o.ID));
    method = 'OpportunityBusinessTransactionDocumentReference (ZQuoteExist_KUT not populated for this scope)';
  }

  return {
    totalOpportunities: scoped.length,
    convertedCount: converted.length,
    conversionRate: scoped.length ? Math.round((converted.length / scoped.length) * 100) : null,
    method,
    sample: converted.slice(0, 10).map((o) => ({
      'Opportunity ID': o.ID,
      Name: o.Name,
      Customer: o.ProspectPartyName,
      Status: o.LifeCycleStatusCodeText,
    })),
    truncated: !!opps.truncated,
  };
}

/**
 * Counts quote items that have a linked RFQ (RFQ_IDcontent_SDK populated),
 * i.e. RFQs raised FROM quotes — the reverse direction of
 * opportunitiesConvertedToQuote. Scoped by date only (CreationDateTime on
 * the item) — org/account filtering isn't supported yet since that would
 * require joining back to the quote header, not built for v1.
 *
 * CAVEAT: RFQ_IDcontent_SDK is a confirmed real field, but every sample
 * record captured during discovery had it empty — its populated value
 * format has not been independently verified against a real linked
 * record. Results should be treated as provisional until validated
 * against at least one confirmed real RFQ-linked quote item.
 */
export async function rfqsRaisedFromQuotes(filters, userJwt, userEmail) {
  const fetchFilters = { dateFrom: filters.dateFrom || null, dateTo: filters.dateTo || null };
  const { data } = await getOrSet(userEmail, 'quote-items:rfq-linked', fetchFilters, () => fetchQuoteItems(fetchFilters, userJwt));
  const linked = data.results.filter((i) => i.RFQ_IDcontent_SDK);
  const uniqueRFQIds = new Set(linked.map((i) => i.RFQ_IDcontent_SDK));

  return {
    quoteItemsChecked: data.total,
    quoteItemsWithRFQLink: linked.length,
    uniqueRFQCount: uniqueRFQIds.size,
    sample: linked.slice(0, 10).map((i) => ({
      'Quote ID': i.QuoteID,
      'Item ID': i.ItemID,
      'RFQ ID': i.RFQ_IDcontent_SDK,
    })),
    truncated: !!data.truncated,
  };
}

async function rawRFQs(filters, userJwt, userEmail) {
  const base = { ...baseFilters(filters), account: filters.account || null };
  // Account can't be combined with the date-range filter server-side on the
  // custom zrfq service (ABAP select-option error) — fetch without it (cached
  // on date/owner only) and scope by account in-process, same pattern as
  // sales-org scoping on Quotes/Opportunities.
  const fetchKey = { ...base, account: undefined };
  const { data } = await getOrSet(userEmail, 'raw:rfqs', fetchKey, () => fetchRFQs(fetchKey, userJwt));
  if (!base.account) return data;
  const results = data.results.filter((r) => matchesAccount(r.AccountName, base.account));
  return { ...data, results, total: results.length };
}

export async function quotesByStatus(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'quotes/by-status', filters, async () => {
    const { results } = await rawQuotes(filters, userJwt, userEmail);
    const sums = sumBy(results, 'LifeCycleStatusCodeText', 'NetAmount');
    const currency = results.find((r) => r.CurrencyCode)?.CurrencyCode || 'EUR';
    return sums.map(({ label, count, total }) => ({
      status: label, count, totalAmount: total, currency,
    }));
  });
}

export async function quotesBySalesOrg(filters, userJwt, userEmail) {
  const limit = parseInt(filters.limit || '20', 10);
  return getOrSet(userEmail, 'quotes/by-sales-org', { ...filters, limit }, async () => {
    const { results } = await rawQuotes(filters, userJwt, userEmail);
    return sumBy(results, 'SalesOrganisationName', 'NetAmount')
      .slice(0, limit)
      .map(({ label, count, total }) => ({ salesOrg: label, count, totalAmount: total }));
  });
}

export async function quotesTrend(filters, userJwt, userEmail) {
  const months = parseInt(filters.months || '6', 10);
  return getOrSet(userEmail, 'quotes/trend', { ...filters, months }, async () => {
    const from = new Date();
    from.setUTCMonth(from.getUTCMonth() - (months - 1), 1);
    const effective = { ...filters, dateFrom: filters.dateFrom || from.toISOString().slice(0, 10) };
    const { results } = await rawQuotes(effective, userJwt, userEmail);
    return trendByMonth(results, 'CreationDateTime', 'NetAmount', months)
      .map(({ month, count, total }) => ({ month, count, totalAmount: total }));
  });
}

export async function quotesByBizType(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'quotes/by-biz-type', filters, async () => {
    const { results } = await rawQuotes(filters, userJwt, userEmail);
    return sumBy(results, 'ZBIZTYPE', 'NetAmount').map(({ label, count, total }) => ({
      bizType: BIZ_TYPE_LABELS[label] || label,
      count,
      totalAmount: total,
    }));
  });
}

export async function quotesTopCustomers(filters, userJwt, userEmail) {
  const limit = parseInt(filters.limit || '10', 10);
  return getOrSet(userEmail, 'quotes/top-customers', { ...filters, limit }, async () => {
    const { results } = await rawQuotes(filters, userJwt, userEmail);
    return sumBy(results, 'BuyerPartyName', 'NetAmount')
      .slice(0, limit)
      .map(({ label, count, total }) => ({ customer: label, count, totalAmount: total }));
  });
}

export async function quotesList(filters, userJwt, userEmail) {
  const limit = Math.min(parseInt(filters.limit || '500', 10), 2000);
  return getOrSet(userEmail, 'quotes/list', { ...filters, limit }, async () => {
    const { total, results } = await rawQuotes(filters, userJwt, userEmail);
    const rows = [...results]
      .sort((a, b) => (parseODataDate(b.CreationDateTime) || 0) - (parseODataDate(a.CreationDateTime) || 0))
      .slice(0, limit)
      .map((q) => ({
        id: q.ID,
        objectId: q.ObjectID,
        customer: q.BuyerPartyName,
        salesOrg: q.SalesOrganisationName,
        status: q.LifeCycleStatusCodeText,
        amount: toNumber(q.NetAmount),
        currency: q.CurrencyCode,
        created: parseODataDate(q.CreationDateTime)?.toISOString() || null,
        owner: q.EmployeeResponsiblePartyName,
      }));
    return { total, rows };
  });
}

export async function quotesRaw(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'quotes/raw', filters, async () => {
    const { total, results } = await rawQuotes(filters, userJwt, userEmail);
    const rows = [...results]
      .sort((a, b) => (parseODataDate(b.CreationDateTime) || 0) - (parseODataDate(a.CreationDateTime) || 0))
      .map((q) => ({
        'Quote ID': q.ID,
        'Quote Name': q.Name,
        'Status': q.LifeCycleStatusCodeText,
        'Sales Org': q.SalesOrganisationName,
        'Account': q.BuyerPartyName,
        'Account Country': q.BuyerCountry || '',
        'Ship-To Account': q.ProductRecipientPartyName || '',
        'Ship-To Country': q.ShipToCountry || '',
        'Net Amount': toNumber(q.NetAmount),
        'Currency': q.CurrencyCode,
        'Created Date': parseODataDate(q.CreationDateTime)?.toISOString().slice(0, 10) || '',
        'Created By': q.CreatedBy || '',
        'Owner': q.EmployeeResponsiblePartyName || '',
        'Business Type': BIZ_TYPE_LABELS[q.ZBIZTYPE] || q.ZBIZTYPE || '',
      }));
    return { total, rows };
  });
}

export async function opportunitiesPipeline(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'opportunities/pipeline', filters, async () => {
    const { results } = await rawOpportunities(filters, userJwt, userEmail);
    // "Pipeline" = OPEN opportunities only. Won/Lost deals are not pipeline, so
    // they must be excluded — keeps this consistent with the Daily Briefing and
    // the Pipeline Command Center KPIs (which already filter to open).
    return pipelineStages(results.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText)));
  });
}

export async function opportunitiesByOwner(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'opportunities/by-owner', filters, async () => {
    const { results } = await rawOpportunities(filters, userJwt, userEmail);
    const open = results.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText));
    return sumBy(open, 'MainEmployeeResponsiblePartyName', oppValue)
      .slice(0, 20)
      .map(({ label, count, total }) => ({ owner: label, count, totalValue: total }));
  });
}

export async function opportunitiesCloseTrend(filters, userJwt, userEmail) {
  const months = parseInt(filters.months || '6', 10);
  return getOrSet(userEmail, 'opportunities/close-trend', { ...filters, months }, async () => {
    const { results } = await rawOpportunities(filters, userJwt, userEmail);
    const open = results.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText));
    const now = new Date();
    // Expected closes look forward, not back
    const future = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months - 1, 1));
    return trendByMonth(open, 'ExpectedProcessingEndDate', oppValue, months, future)
      .map(({ month, count, total }) => ({ month, count, totalValue: total }));
  });
}

export async function opportunitiesList(filters, userJwt, userEmail) {
  // Cap raised to 20k so the Pipeline Command Center can aggregate large
  // pipelines client-side; the Kanban virtualizes cards per column.
  const limit = Math.min(parseInt(filters.limit || '500', 10), 20000);
  return getOrSet(userEmail, 'opportunities/list', { ...filters, limit }, async () => {
    const { total, results, truncated } = await rawOpportunities(filters, userJwt, userEmail);
    const rows = [...results]
      .sort((a, b) => (parseODataDate(b.CreationDateTime) || 0) - (parseODataDate(a.CreationDateTime) || 0))
      .slice(0, limit)
      .map((o) => ({
        id: o.ID,
        objectId: o.ObjectID,
        name: o.Name,
        account: o.ProspectPartyName,
        stage: o.SalesCyclePhaseCodeText,
        stageCode: o.SalesCyclePhaseCode,
        status: o.LifeCycleStatusCodeText,
        expectedValue: oppValue(o),
        probability: toNumber(o.ProbabilityPercent),
        weightedValue: oppValue(o) * (toNumber(o.ProbabilityPercent) / 100),
        expectedClose: parseODataDate(o.ExpectedProcessingEndDate)?.toISOString() || null,
        created: parseODataDate(o.CreationDateTime)?.toISOString() || null,
        lastActivity: parseODataDate(o.EntityLastChangedOn)?.toISOString() || null,
        owner: o.MainEmployeeResponsiblePartyName,
        source: o.OriginTypeCodeText || null,
        oppType: o.OpportunityLevel_KUTText || null,
        territory: o.SalesTerritoryName || null,
        segment: o.BUS_SEG_CDE_KUTText || null,
        subSegment: o.MKT_SEG_CODEText || null,
      }));
    // truncated = the C4C set exceeded the safety cap; rows are a partial view
    return { total, rows, truncated: Boolean(truncated) || total > limit };
  });
}

/**
 * One-pass aggregate package for the Pipeline Command Center
 * (KPI header + Kanban totals + Funnel + Forecast + derived Flow).
 * When compare=true, also fetches the immediately-preceding period of equal
 * length for the funnel comparison overlay — reuses the shared raw cache.
 */
export async function pipelineOverviewSvc(filters, userJwt, userEmail) {
  const compare = filters.compare === '1' || filters.compare === 'true' || filters.compare === true;
  return getOrSet(userEmail, 'opportunities/pipeline-overview', { ...filters, compare }, async () => {
    const { results } = await rawOpportunities(filters, userJwt, userEmail);
    const overview = pipelineOverview(results, new Date());

    if (compare && filters.dateFrom && filters.dateTo) {
      const from = new Date(filters.dateFrom);
      const to = new Date(filters.dateTo);
      const spanMs = Math.max(to - from, 86_400_000);
      const prevTo = new Date(from.getTime() - 86_400_000);
      const prevFrom = new Date(prevTo.getTime() - spanMs);
      const prevFilters = {
        ...baseFilters(filters),
        dateFrom: prevFrom.toISOString().slice(0, 10),
        dateTo: prevTo.toISOString().slice(0, 10),
      };
      const prev = await rawOpportunities(prevFilters, userJwt, userEmail);
      overview.funnel.previous = funnelSnapshot(prev.results);
      overview.meta.prevPeriod = { from: prevFilters.dateFrom, to: prevFilters.dateTo };
    }
    return overview;
  });
}

export async function rfqsByAccount(filters, userJwt, userEmail) {
  const limit = parseInt(filters.limit || '20', 10);
  return getOrSet(userEmail, 'rfqs/by-account', { ...filters, limit }, async () => {
    const { results } = await rawRFQs(filters, userJwt, userEmail);
    return countBy(results, 'AccountName')
      .slice(0, limit)
      .map(({ label, count }) => ({ account: label || 'Unknown', count }));
  });
}

export async function rfqsByStatus(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'rfqs/by-status', filters, async () => {
    const { results } = await rawRFQs(filters, userJwt, userEmail);
    return countBy(results, 'RFQStatusText').map(({ label, count }) => ({
      status: label,
      count,
      open: isRfqOpen(label),
    }));
  });
}

export async function rfqsTrend(filters, userJwt, userEmail) {
  const months = parseInt(filters.months || '6', 10);
  return getOrSet(userEmail, 'rfqs/trend', { ...filters, months }, async () => {
    const { results } = await rawRFQs(filters, userJwt, userEmail);
    return trendByMonth(results, 'CreationDateTime', null, months)
      .map(({ month, count }) => ({ month, count }));
  });
}

export async function rfqsList(filters, userJwt, userEmail) {
  // High cap so All/Closed scopes (which can run to tens of thousands) are fully
  // browsable client-side; the raw set is already fetched, this only slices it.
  const limit = Math.min(parseInt(filters.limit || '500', 10), 20000);
  const scope = filters.scope === 'open' || filters.scope === 'closed' ? filters.scope : 'all';
  return getOrSet(userEmail, 'rfqs/list', { ...filters, limit, scope }, async () => {
    const { results } = await rawRFQs(filters, userJwt, userEmail);

    // De-dupe by ObjectID — backstop against any pagination overlap so counts
    // and the table never double-count the same RFQ.
    const seen = new Set();
    const unique = [];
    for (const r of results) {
      const key = r.ObjectID || `${r.ID}|${r.RFQStatusText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
    }

    // Accurate open/closed + due counts over the FULL de-duped set so the KPIs
    // are correct regardless of the per-scope row cap.
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
    let openCount = 0;
    let closedCount = 0;
    let overdueCount = 0;
    let dueThisWeekCount = 0;
    for (const r of unique) {
      if (isRfqOpen(r.RFQStatusText)) {
        openCount += 1;
        const due = parseODataDate(r.RFQDueDate);
        if (due) {
          if (due < now) overdueCount += 1;
          else if (due <= weekEnd) dueThisWeekCount += 1;
        }
      } else {
        closedCount += 1;
      }
    }

    // Filter to the requested scope BEFORE capping, so "Open" returns open rows
    // (up to the cap) rather than whatever open rows fell into a mixed sample.
    const scoped =
      scope === 'open'
        ? unique.filter((r) => isRfqOpen(r.RFQStatusText))
        : scope === 'closed'
          ? unique.filter((r) => !isRfqOpen(r.RFQStatusText))
          : unique;

    const rows = [...scoped]
      .sort((a, b) => (parseODataDate(a.RFQDueDate) || Infinity) - (parseODataDate(b.RFQDueDate) || Infinity))
      .slice(0, limit)
      .map((r) => ({
        id: r.ID,
        objectId: r.ObjectID,
        name: r.Name,
        account: r.AccountName,
        status: r.RFQStatusText,
        dueDate: parseODataDate(r.RFQDueDate)?.toISOString() || null,
        owner: r.OwnerName,
        created: parseODataDate(r.CreationDateTime)?.toISOString() || null,
        open: isRfqOpen(r.RFQStatusText),
      }));
    return {
      total: unique.length,
      matching: scoped.length,
      scope,
      openCount,
      closedCount,
      overdueCount,
      dueThisWeekCount,
      rows,
    };
  });
}

export async function getDailySummary(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'daily-summary', filters, async () => {
    const today = new Date();
    const recentFrom = new Date(today);
    recentFrom.setUTCDate(recentFrom.getUTCDate() - 7);
    const weekFilters = { ...filters, dateFrom: recentFrom.toISOString().slice(0, 10) };

    // allSettled so one bad collection reports alongside the others
    // instead of masking them one redeploy at a time
    const settled = await Promise.allSettled([
      rawQuotes(filters, userJwt, userEmail),
      rawOpportunities(filters, userJwt, userEmail),
      fetchTasks(filters, userJwt),
      rawRFQs(filters, userJwt, userEmail),
      fetchVisits(weekFilters, userJwt),
      fetchAppointments(weekFilters, userJwt),
    ]);
    const failures = settled.filter((s) => s.status === 'rejected');
    if (failures.length) {
      throw new Error(failures.map((f) => f.reason?.message || String(f.reason)).join(' || '));
    }
    const [quotes, opps, tasks, rfqs, visits, appointments] = settled.map((s) => s.value);

    const summary = dailySummary(
      quotes.results, opps.results, tasks.results,
      rfqs.results, visits.results, appointments.results, today
    );

    // Exact open counts via OData inline count — correct on any range and not
    // limited by the record cap (the fetched results above are only used for
    // sums / lists / the stage chart). Best-effort: keep the sampled counts if
    // a count query fails.
    const [cOpps, cRfqs] = await Promise.allSettled([
      countOpportunities(filters, userJwt),
      countRFQs(filters, userJwt),
    ]);
    if (cOpps.status === 'fulfilled') summary.openOpportunities = cOpps.value.open;
    if (cRfqs.status === 'fulfilled') summary.openRFQs = cRfqs.value.open;

    // Quotes: SalesOrganisationID isn't filterable in C4C, so the cheap inline
    // count can't be scoped to a chosen org. With an org selected, derive the
    // open-quote count from the in-process org-filtered fetch (exact unless that
    // fetch was capped); otherwise use the exact inline count.
    let quotesCountExact;
    if (filters.salesOrgId) {
      summary.openQuotes = quotes.results.filter((q) => isOpenStatus(q.LifeCycleStatusCodeText)).length;
      quotesCountExact = !quotes.truncated;
    } else {
      const cQuotes = await countQuotes(filters, userJwt).then((v) => v, () => null);
      if (cQuotes) summary.openQuotes = cQuotes.open;
      quotesCountExact = !!cQuotes;
    }

    // Per-figure exactness for the fail-closed UI. Counts are exact only if
    // their inline-count query succeeded; record-derived figures (sums, the
    // stage distribution) are exact only if the underlying fetch wasn't capped.
    summary.exact = {
      openQuotes: quotesCountExact,
      openOpportunities: cOpps.status === 'fulfilled',
      openRFQs: cRfqs.status === 'fulfilled',
      pipelineValue: !opps.truncated,
      pipelineByStage: !opps.truncated,
      overdueTasks: !tasks.truncated,
      // visits/appointments use a 7-day window — always within the cap
      meetings: true,
    };

    // Extra payloads so the Daily Briefing renders from a single call
    summary.quotesByDay = quotesByDayThisWeek(quotes.results, today);
    summary.pipeline = pipelineStages(opps.results.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText)));
    summary.recentOpenQuotes = quotes.results
      .filter((q) => isOpenStatus(q.LifeCycleStatusCodeText))
      .sort((a, b) => (parseODataDate(b.CreationDateTime) || 0) - (parseODataDate(a.CreationDateTime) || 0))
      .slice(0, 10)
      .map((q) => ({
        id: q.ID,
        objectId: q.ObjectID,
        customer: q.BuyerPartyName,
        status: q.LifeCycleStatusCodeText,
        amount: toNumber(q.NetAmount),
        currency: q.CurrencyCode,
        created: parseODataDate(q.CreationDateTime)?.toISOString() || null,
      }));
    summary.todaysTasks = tasks.results
      .filter((t) => {
        const due = parseODataDate(t.DueDateTime);
        return due && due.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
      })
      .slice(0, 20)
      .map((t) => ({
        id: t.ID,
        subject: t.Subject,
        status: t.StatusText,
        priority: t.PriorityCodeText,
        due: parseODataDate(t.DueDateTime)?.toISOString() || null,
      }));
    return summary;
  });
}

/**
 * Opportunities created over time (monthly count by CreationDateTime).
 * Use this when users ask "how many opportunities were created", not pipeline/stage breakdown.
 */
export async function opportunitiesCreatedTrend(filters, userJwt, userEmail) {
  const months = parseInt(filters.months || '6', 10);
  return getOrSet(userEmail, 'opportunities/created-trend', { ...filters, months }, async () => {
    const { results } = await rawOpportunities(filters, userJwt, userEmail);
    return trendByMonth(results, 'CreationDateTime', oppValue, months)
      .map(({ month, count, total }) => ({ month, count, totalValue: total }));
  });
}

/**
 * Opportunities grouped by sales organisation (count + value).
 * Use when users ask about performance per sales org / region.
 */
export async function opportunitiesBySalesOrg(filters, userJwt, userEmail) {
  const limit = parseInt(filters.limit || '20', 10);
  return getOrSet(userEmail, 'opportunities/by-sales-org', { ...filters, limit }, async () => {
    const { results } = await rawOpportunities(filters, userJwt, userEmail);
    return sumBy(results, 'SalesOrganisationName', oppValue)
      .slice(0, limit)
      .map(({ label, count, total }) => ({ salesOrg: label, count, totalValue: total }));
  });
}

/**
 * Opportunity line-item detail — joins OpportunityItemCollection to headers.
 * Supports: org filter (header), date filter (header), product category keyword filter.
 * Returns one flat row per item, sorted by OpportunityID.
 */
export async function opportunityItemsRaw(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'opportunities/items', filters, async () => {
    const base = baseFilters(filters);
    // Support multiple keywords separated by "and", "or", or comma — OR-matched
    const productKeywords = (filters.productCategory || '')
      .toLowerCase()
      .split(/\s+and\s+|\s+or\s+|,/)
      .map((k) => k.trim())
      .filter(Boolean);

    // 1. Fetch headers (date + owner filtered server-side).
    const fetchKey = { ...base, salesOrgId: undefined };
    const { data: hdrData } = await getOrSet(
      userEmail, 'raw:opportunities', fetchKey, () => fetchOpportunities(fetchKey, userJwt)
    );

    // 2. Apply org filter in-process.
    const headers = base.salesOrgId
      ? hdrData.results.filter((o) => matchesOrg(o.SalesOrganisationID, o.SalesOrganisationName, base.salesOrgId))
      : hdrData.results;

    // 3. Fetch only items whose ParentObjectID is one of the filtered headers.
    //    This avoids the global 60k cap: we target the exact opportunities we care about.
    const parentObjectIds = headers.map((h) => h.ObjectID).filter(Boolean);
    const itemsData = await fetchOpportunityItemsByParents(parentObjectIds, userJwt);
    const allItems = itemsData.results || [];

    // 4. Build lookup map and apply product keyword filter.
    const headerByObjectId = new Map(headers.map((h) => [h.ObjectID, h]));

    const rows = allItems
      .filter((item) => {
        if (productKeywords.length > 0) {
          const cat = (item.ProductCategoryDescription || item.ProductCategoryDescription_SDK || '').toLowerCase();
          return productKeywords.some((k) =>
            cat.includes(k) || (k.endsWith('s') && cat.includes(k.slice(0, -1)))
          );
        }
        return true;
      })
      .map((item) => {
        const hdr = headerByObjectId.get(item.ParentObjectID);
        return {
          'Opportunity ID': item.OpportunityID,
          'Product ID': item.ProductID || '',
          'Product Description': item.ProductIDDescription || '',
          'Product Category': item.ProductCategoryDescription || item.ProductCategoryDescription_SDK || '',
          'Quantity': toNumber(item.Quantity),
          'Unit': item.QuantityUnitCodeText || '',
          'Net Amount': toNumber(item.NetAmount || item.ExpectedNetAmount),
          'Currency': item.NetAmountCurrencyCode || item.ExpectedNetAmountCurrencyCode || '',
          'Cost': toNumber(item.CostAmountContent_KUT || item.ItemCostcontent),
          'Cost Currency': item.CostAmountcurrencyCode_KUT || item.ItemCostcurrencyCode || '',
          'Item Status': item.LifeCycleStatusCodeText || '',
          'Customer': hdr?.ProspectPartyName || '',
          'Customer ID': hdr?.ProspectPartyID || '',
          'Sales Org': hdr?.SalesOrganisationName || '',
          'Owner': hdr?.MainEmployeeResponsiblePartyName || '',
          'Created Date': parseODataDate(hdr?.CreationDateTime)?.toISOString().slice(0, 10) || '',
        };
      })
      .sort((a, b) => String(a['Opportunity ID']).localeCompare(String(b['Opportunity ID'])));

    const categorySuggestions = rows.length === 0 && productKeywords.length > 0
      ? suggestCategories(productKeywords, allItems)
      : [];

    return {
      total: rows.length,
      rows,
      categorySuggestions,
      _debug: {
        totalHeaders: hdrData.results?.length,
        filteredHeaders: headers.length,
        totalItems: allItems.length,
        productKeywords,
        salesOrgId: base.salesOrgId,
        sampleItemParentObjectID: allItems[0]?.ParentObjectID,
        sampleHeaderObjectID: headers[0]?.ObjectID,
      },
    };
  });
}

export async function quotesTopCreators(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'quotes/top-creators', filters, async () => {
    const { results } = await rawQuotes(filters, userJwt, userEmail);
    const limit = filters.limit || 10;
    const counts = {};
    for (const q of results) {
      const key = q.EmployeeResponsiblePartyName || q.CreatedBy || 'Unknown';
      counts[key] = (counts[key] || 0) + 1;
    }
    const rows = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count], i) => ({ Rank: i + 1, 'Sales Rep / Owner': name, 'Quote Count': count }));
    return { total: rows.length, rows };
  });
}

/**
 * Dispatch table for the Claude-powered dashboard generator.
 */
export const ENDPOINT_HANDLERS = {
  'quotes/raw': quotesRaw,
  'opportunities/items': opportunityItemsRaw,
  'quotes/by-status': quotesByStatus,
  'quotes/by-sales-org': quotesBySalesOrg,
  'quotes/trend': quotesTrend,
  'quotes/by-biz-type': quotesByBizType,
  'quotes/top-customers': quotesTopCustomers,
  'quotes/top-creators': quotesTopCreators,
  'opportunities/pipeline': opportunitiesPipeline,
  'opportunities/created-trend': opportunitiesCreatedTrend,
  'opportunities/by-sales-org': opportunitiesBySalesOrg,
  'rfqs/by-status': rfqsByStatus,
  'rfqs/by-account': rfqsByAccount,
  'rfqs/trend': rfqsTrend,
  'rfqs/list': rfqsList,
  'daily-summary': getDailySummary,
};

/**
 * Headline numbers for the Sales Brief "data included" panel.
 * Stale = open opportunity untouched for 90+ days (EntityLastChangedOn).
 */
export async function briefStats(filters, userJwt, userEmail) {
  return getOrSet(userEmail, 'brief/stats', filters, async () => {
    const [quotes, opps] = await Promise.all([
      rawQuotes(filters, userJwt, userEmail),
      rawOpportunities(filters, userJwt, userEmail),
    ]);
    const now = new Date();
    const in12m = new Date(now);
    in12m.setUTCMonth(in12m.getUTCMonth() + 12);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

    const open = opps.results.filter((o) => isOpenStatus(o.LifeCycleStatusCodeText));
    // Win rate is an OPPORTUNITY outcome (Won/Lost lifecycle) — SalesQuotes have
    // no Won/Lost status, so deriving it from quotes always yielded 0 / "–".
    const won = opps.results.filter((o) => isWonStatus(o.LifeCycleStatusCodeText));
    const lost = opps.results.filter(
      (o) => !isOpenStatus(o.LifeCycleStatusCodeText) && !isWonStatus(o.LifeCycleStatusCodeText)
    );
    const closed = won.length + lost.length;

    // Most recent touch across opps + quotes — recency signal for rep prep
    // ("this relationship's gone quiet" vs "we spoke last week").
    const allDates = [
      ...opps.results.map((o) => parseODataDate(o.EntityLastChangedOn)),
      ...quotes.results.map((q) => parseODataDate(q.CreationDateTime)),
    ].filter(Boolean);
    const lastActivityDate = allDates.length
      ? new Date(Math.max(...allDates.map((d) => d.getTime()))).toISOString().slice(0, 10)
      : null;

    return {
      totalOpportunities: opps.total,
      totalQuotes: quotes.total,
      openDeals: open.length,
      openPipelineValue: open.reduce((a, o) => a + oppValue(o), 0),
      winRate: closed ? Math.round((won.length / closed) * 100) : null,
      wonCount: won.length,
      lostCount: lost.length,
      lostValue: lost.reduce((a, o) => a + oppValue(o), 0),
      lastActivityDate,
      sopNext12MValue: open
        .filter((o) => {
          // ZSOP = Start of Production — the real dedicated field, confirmed
          // against a live record. Previously used ExpectedProcessingEndDate,
          // which is a different (later) date — "expected processing end,"
          // not "start of production."
          const d = parseODataDate(o.ZSOP);
          return d && d >= now && d <= in12m;
        })
        .reduce((a, o) => a + oppValue(o), 0),
      staleCount: open.filter((o) => {
        const d = parseODataDate(o.EntityLastChangedOn);
        return d && d < ninetyDaysAgo;
      }).length,
      orgCount: new Set(quotes.results.map((q) => q.SalesOrganisationName).filter(Boolean)).size,
      ownerCount: new Set(opps.results.map((o) => o.MainEmployeeResponsiblePartyName).filter(Boolean)).size,
      // Fail-closed guardrail: the two totals are exact (C4C __count); the rest
      // are derived from fetched records, so exact only if the fetch wasn't
      // capped. The UI shows "–" for any figure flagged inexact.
      exact: {
        totalOpportunities: true,
        totalQuotes: true,
        openDeals: !opps.truncated,
        openPipelineValue: !opps.truncated,
        winRate: !opps.truncated,
        wonCount: !opps.truncated,
        lostCount: !opps.truncated,
        lostValue: !opps.truncated,
        sopNext12MValue: !opps.truncated,
        staleCount: !opps.truncated,
        orgCount: !quotes.truncated,
        ownerCount: !opps.truncated,
      },
    };
  });
}

/**
 * Full aggregate package the brief is written from — every piece comes out
 * of the shared raw caches, so this adds no extra C4C round trips.
 */
export async function briefData(filters, userJwt, userEmail) {
  const [stats, byStatus, bySalesOrg, trend, customers, pipeline, byOwner, closeTrend, rfqStatus] =
    await Promise.all([
      briefStats(filters, userJwt, userEmail),
      quotesByStatus(filters, userJwt, userEmail),
      quotesBySalesOrg({ ...filters, limit: 15 }, userJwt, userEmail),
      quotesTrend({ ...filters, months: 12 }, userJwt, userEmail),
      quotesTopCustomers({ ...filters, limit: 10 }, userJwt, userEmail),
      opportunitiesPipeline(filters, userJwt, userEmail),
      opportunitiesByOwner(filters, userJwt, userEmail),
      opportunitiesCloseTrend({ ...filters, months: 12 }, userJwt, userEmail),
      rfqsByStatus(filters, userJwt, userEmail),
    ]);
  return {
    stats: stats.data,
    quotesByStatus: byStatus.data,
    quotesBySalesOrg: bySalesOrg.data,
    quoteTrend: trend.data,
    topCustomers: customers.data,
    pipelineStages: pipeline.data,
    pipelineByOwner: byOwner.data,
    expectedCloseByMonth: closeTrend.data,
    rfqsByStatus: rfqStatus.data,
  };
}
