/**
 * C4C client — Azure AD OBO flow via BTP Destination Service.
 *
 * Auth chain (NO XSUAA exchange):
 *   Azure AD access token (raw, unchanged)
 *     → X-user-token header to BTP Destination Service
 *     → Destination validates via x_user_token.jwks_uri (Azure AD JWKS)
 *     → Destination builds + signs SAML assertion
 *     → C4C OAuth token endpoint issues user-scoped token
 *     → C4C OData called as the real logged-in user
 */
import axios from 'axios';
import { isOpenStatus, isRfqOpen } from './aggregations.js';

const C4C_DESTINATION = process.env.C4C_DESTINATION || 'C4C_PRD_OBO';
const ODATA_BASE = '/sap/c4c/odata/v1/c4codataapi';
const CUSTOM_BASE = '/sap/c4c/odata/cust/v1';
const PAGE_SIZE = 1000;
// Promise.all in batches — full parallelism across 199 pages would exhaust sockets
const PARALLEL_BATCH = 15;
// Hard ceiling on records pulled per query, so a very wide date range can't
// exhaust the instance. Override with C4C_MAX_RECORDS.
const MAX_RECORDS = parseInt(process.env.C4C_MAX_RECORDS || '60000', 10);

function getDestinationServiceCredentials() {
  const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
  const destBinding = (vcap.destination || [])[0];
  if (!destBinding || !destBinding.credentials) {
    throw new Error('Destination service binding not found in VCAP_SERVICES');
  }
  return destBinding.credentials;
}

// Token for the Destination Service itself (client_credentials) — cacheable.
// The per-user C4C token is NOT cached here: the Destination Service caches
// per user token, so we always pass the fresh user JWT per request.
let destSvcToken = null;

export async function fetchDestinationToken() {
  if (destSvcToken && Date.now() < destSvcToken.expiresAt - 60_000) {
    return destSvcToken.token;
  }
  const creds = getDestinationServiceCredentials();
  const resp = await axios.post(
    `${creds.url}/oauth/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientid,
      client_secret: creds.clientsecret,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    }
  );
  destSvcToken = {
    token: resp.data.access_token,
    expiresAt: Date.now() + resp.data.expires_in * 1000,
  };
  return destSvcToken.token;
}

/**
 * Resolve the C4C_PRD_OBO destination for the given user.
 * Passes the raw Azure AD access token as X-user-token; the Destination
 * Service returns the destination config including a user-scoped C4C token.
 */
async function getDestination(userJwt) {
  const creds = getDestinationServiceCredentials();
  const svcToken = await fetchDestinationToken();
  let resp;
  try {
    resp = await axios.get(
      `${creds.uri}/destination-configuration/v1/destinations/${C4C_DESTINATION}`,
      {
        headers: {
          Authorization: `Bearer ${svcToken}`,
          'X-user-token': userJwt,
        },
        timeout: 30_000,
      }
    );
  } catch (err) {
    throw new Error(
      `Destination lookup '${C4C_DESTINATION}' failed (HTTP ${err.response?.status ?? '?'}): ` +
        `${JSON.stringify(err.response?.data ?? err.message).slice(0, 400)}`
    );
  }
  const dest = resp.data;
  const authToken = dest.authTokens && dest.authTokens[0];
  if (authToken?.error) {
    if (authToken.error.includes('expired')) {
      throw new Error('Your session has expired. Please sign in again to continue.');
    }
    throw new Error(`Authentication error: ${authToken.error}`);
  }
  if (!authToken?.value) {
    throw new Error(`No auth token returned from destination ${C4C_DESTINATION}`);
  }
  return {
    url: (dest.destinationConfiguration?.URL || '').replace(/\/+$/, ''),
    authHeader: `${authToken.type || 'Bearer'} ${authToken.value}`,
  };
}

async function odataGet(dest, path, params) {
  let resp;
  try {
    resp = await axios.get(`${dest.url}${path}`, {
      headers: {
        Authorization: dest.authHeader,
        Accept: 'application/json',
      },
      params,
      timeout: 120_000,
    });
  } catch (err) {
    throw new Error(
      `C4C call failed (HTTP ${err.response?.status ?? '?'}) on ${dest.url}${path}: ` +
        `${JSON.stringify(err.response?.data ?? err.message).slice(0, 400)}`
    );
  }
  // OData v2 JSON shape: { d: { results: [...], __count: "N" } }
  return resp.data && resp.data.d ? resp.data.d : { results: [] };
}

/**
 * Generic single C4C OData request as the logged-in user.
 */
export async function c4cRequest(path, userJwt, params = {}) {
  const dest = await getDestination(userJwt);
  return odataGet(dest, path, { $format: 'json', ...params });
}

/**
 * Minimal C4C round trip ($top=1) used by GET /api/analytics/whoami to verify
 * the signed-in user actually has C4C access via the OBO flow. Throws when the
 * destination/OBO denies the user (no C4C authorization) so the UI can show a
 * friendly "no access" screen instead of a shell full of empty widgets.
 */
export async function probeC4CAccess(userJwt) {
  await c4cRequest(`${ODATA_BASE}/OpportunityCollection`, userJwt, {
    $top: 1,
    $select: 'ObjectID',
  });
  return true;
}

/**
 * Paginated fetcher — C4C returns max 1000 records per request.
 * 1. First page with $inlinecount=allpages + $select
 * 2. Read __count for the total
 * 3. Fetch remaining pages in parallel ($skip strided by the page size the
 *    server ACTUALLY returned — some tenants cap below the requested $top,
 *    and assuming 1000 would silently skip records between pages)
 * 4. Merge and return { total, results }
 * Falls back to sequential paging when the server omits __count.
 */
export async function fetchAllPages(collectionPath, selectFields, filterString, userJwt) {
  const dest = await getDestination(userJwt);
  const baseParams = {
    $format: 'json',
    $select: selectFields.join(','),
    $top: PAGE_SIZE,
    // Stable sort on the entity key so $skip pages never overlap or skip rows.
    // Without this, collections with no default order return duplicate records
    // across pages (seen on the custom RFQ collection).
    $orderby: 'ObjectID',
  };
  if (filterString) baseParams.$filter = filterString;

  const first = await odataGet(dest, collectionPath, {
    ...baseParams,
    $inlinecount: 'allpages',
  });
  const firstResults = first.results || [];
  let results = firstResults;
  const pageSize = firstResults.length;
  if (pageSize === 0) return { total: 0, results: [] };

  if (first.__count !== undefined) {
    const total = parseInt(first.__count, 10);
    // Safety cap: never pull more than MAX_RECORDS into memory in one query.
    // A wide range ("All Time") on a big collection (e.g. 200k+ quotes) would
    // otherwise exhaust the instance and drop every request. We fetch up to the
    // cap, report the real total, and flag the result as truncated.
    const target = Math.min(total, MAX_RECORDS);
    if (target > pageSize) {
      const skips = [];
      for (let skip = pageSize; skip < target; skip += pageSize) skips.push(skip);
      for (let i = 0; i < skips.length; i += PARALLEL_BATCH) {
        const batch = skips.slice(i, i + PARALLEL_BATCH);
        const pagesData = await Promise.all(
          batch.map((skip) => odataGet(dest, collectionPath, { ...baseParams, $skip: skip }))
        );
        for (const page of pagesData) results = results.concat(page.results || []);
      }
    }
    return { total, results: results.slice(0, MAX_RECORDS), truncated: total > MAX_RECORDS };
  }

  // No inline count — page sequentially until a short page signals the end
  let skip = pageSize;
  while (results.length < MAX_RECORDS) {
    const page = await odataGet(dest, collectionPath, { ...baseParams, $skip: skip });
    const rows = page.results || [];
    results = results.concat(rows);
    if (rows.length < pageSize) break;
    skip += rows.length;
  }
  return { total: results.length, results: results.slice(0, MAX_RECORDS), truncated: results.length > MAX_RECORDS };
}

// ---------------------------------------------------------------------------
// OData filter helpers
// ---------------------------------------------------------------------------

function odataEscape(value) {
  return String(value).replace(/'/g, "''");
}

// C4C system datetime fields (CreationDateTime, DueDateTime, Start/EndDateTime)
// are Edm.DateTimeOffset — a plain datetime'' literal fails with
// "Invalid parametertype used at function 'ge'".
function dateFilter(field, dateFrom, dateTo) {
  const parts = [];
  if (dateFrom) parts.push(`${field} ge datetimeoffset'${dateFrom}T00:00:00Z'`);
  if (dateTo) parts.push(`${field} le datetimeoffset'${dateTo}T23:59:59Z'`);
  return parts;
}

// ---------------------------------------------------------------------------
// Exact counts via OData inline count ($inlinecount=allpages) — returns the
// real __count of a filtered query WITHOUT fetching the records, so counts are
// exact and immune to the record cap. Used for the headline KPI counts where
// pulling tens of thousands of rows to count client-side was both slow and
// (under the cap) wrong.
// ---------------------------------------------------------------------------

async function odataCountFiltered(dest, collectionPath, filterString, selectField) {
  const data = await odataGet(dest, collectionPath, {
    $format: 'json',
    $select: selectField,
    $top: 1,
    $inlinecount: 'allpages',
    ...(filterString ? { $filter: filterString } : {}),
  });
  return parseInt(data.__count, 10) || 0;
}

/**
 * Exact { total, open } for a collection by date/owner/org filter.
 * 1. Sample one page to discover the status codes actually present.
 * 2. Classify each via isOpen(text), then sum exact inline counts of the open
 *    codes. Total comes from a single unfiltered-by-status inline count.
 */
async function countByStatus(collectionPath, codeField, textField, isOpen, filterString, userJwt) {
  const dest = await getDestination(userJwt);
  const sample = await odataGet(dest, collectionPath, {
    $format: 'json',
    $select: `${codeField},${textField}`,
    $top: 1000,
    $orderby: 'ObjectID',
    ...(filterString ? { $filter: filterString } : {}),
  });
  const statuses = new Map(); // code -> text
  for (const r of sample.results || []) {
    const code = r[codeField];
    if (code != null && code !== '' && !statuses.has(String(code))) statuses.set(String(code), r[textField]);
  }
  const total = await odataCountFiltered(dest, collectionPath, filterString, codeField);
  let open = 0;
  for (const [code, text] of statuses) {
    if (!isOpen(text)) continue;
    const f = filterString ? `${filterString} and ${codeField} eq '${odataEscape(code)}'` : `${codeField} eq '${odataEscape(code)}'`;
    open += await odataCountFiltered(dest, collectionPath, f, codeField);
  }
  return { total, open };
}

function quoteFilter(filters = {}) {
  const parts = [];
  if (filters.salesOrgId) parts.push(`SalesOrganisationID eq '${odataEscape(filters.salesOrgId)}'`);
  if (filters.ownerId) parts.push(`substringof('${odataEscape(filters.ownerId)}',EmployeeResponsiblePartyName)`);
  parts.push(...dateFilter('CreationDateTime', filters.dateFrom, filters.dateTo));
  return parts.join(' and ');
}
function opportunityFilter(filters = {}) {
  const parts = [];
  if (filters.ownerId) parts.push(`substringof('${odataEscape(filters.ownerId)}',MainEmployeeResponsiblePartyName)`);
  parts.push(...dateFilter('CreationDateTime', filters.dateFrom, filters.dateTo));
  return parts.join(' and ');
}
function rfqFilter(filters = {}) {
  const parts = [];
  if (filters.ownerId) parts.push(`substringof('${odataEscape(filters.ownerId)}',OwnerName)`);
  parts.push(...dateFilter('CreationDateTime', filters.dateFrom, filters.dateTo));
  return parts.join(' and ');
}

export function countQuotes(filters, userJwt) {
  return countByStatus(`${ODATA_BASE}/SalesQuoteCollection`, 'LifeCycleStatusCode', 'LifeCycleStatusCodeText', isOpenStatus, quoteFilter(filters), userJwt);
}
export function countOpportunities(filters, userJwt) {
  return countByStatus(`${ODATA_BASE}/OpportunityCollection`, 'LifeCycleStatusCode', 'LifeCycleStatusCodeText', isOpenStatus, opportunityFilter(filters), userJwt);
}
export function countRFQs(filters, userJwt) {
  return countByStatus(`${CUSTOM_BASE}/zrfq/RFQRootCollection`, 'RFQStatus', 'RFQStatusText', isRfqOpen, rfqFilter(filters), userJwt);
}

// ---------------------------------------------------------------------------
// Collection fetchers — always $select only the fields needed for aggregation
// ---------------------------------------------------------------------------

export async function fetchQuotes(filters = {}, userJwt) {
  const parts = [];
  if (filters.salesOrgId) parts.push(`SalesOrganisationID eq '${odataEscape(filters.salesOrgId)}'`);
  if (filters.ownerId) parts.push(`substringof('${odataEscape(filters.ownerId)}',EmployeeResponsiblePartyName)`);
  parts.push(...dateFilter('CreationDateTime', filters.dateFrom, filters.dateTo));
  return fetchAllPages(
    `${ODATA_BASE}/SalesQuoteCollection`,
    [
      'ObjectID', 'ID', 'LifeCycleStatusCode', 'LifeCycleStatusCodeText',
      'NetAmount', 'CurrencyCode', 'SalesOrganisationID', 'SalesOrganisationName',
      'CreationDateTime', 'ValidToDate', 'BuyerPartyName',
      'EmployeeResponsiblePartyName', 'ZBIZTYPE',
    ],
    parts.join(' and '),
    userJwt
  );
}

export async function fetchOpportunities(filters = {}, userJwt) {
  const parts = [];
  if (filters.ownerId) parts.push(`substringof('${odataEscape(filters.ownerId)}',MainEmployeeResponsiblePartyName)`);
  parts.push(...dateFilter('CreationDateTime', filters.dateFrom, filters.dateTo));
  return fetchAllPages(
    `${ODATA_BASE}/OpportunityCollection`,
    [
      'ObjectID', 'ID', 'Name', 'SalesCyclePhaseCode', 'SalesCyclePhaseCodeText',
      'ExpectedRevenueAmount', 'ProbabilityPercent', 'ExpectedProcessingEndDate',
      'CreationDateTime', 'EntityLastChangedOn', 'MainEmployeeResponsiblePartyName',
      'ProspectPartyName', 'ProspectPartyID', 'LifeCycleStatusCode', 'LifeCycleStatusCodeText',
      // Value in group/base currency (EUR) — avoids mixing transaction currencies
      'ZBaseCurrency_KUTContent_KUT', 'ZBaseCurrency_KUTcurrencyCode_KUT',
      // Pipeline Command Center filter dimensions (confirmed from tenant payload):
      'OriginTypeCode', 'OriginTypeCodeText',            // Opportunity Source
      'OpportunityLevel_KUT', 'OpportunityLevel_KUTText', // Opportunity Type (level)
      'SalesTerritoryID', 'SalesTerritoryName',          // Sales Region / Team
      'BUS_SEG_CDE_KUT', 'BUS_SEG_CDE_KUTText',          // Industry — business segment
      'MKT_SEG_CODE', 'MKT_SEG_CODEText',                // Industry — market sub-segment
    ],
    parts.join(' and '),
    userJwt
  );
}

export async function fetchRFQs(filters = {}, userJwt) {
  const parts = [];
  if (filters.ownerId) parts.push(`substringof('${odataEscape(filters.ownerId)}',OwnerName)`);
  parts.push(...dateFilter('CreationDateTime', filters.dateFrom, filters.dateTo));
  return fetchAllPages(
    `${CUSTOM_BASE}/zrfq/RFQRootCollection`,
    [
      'ObjectID', 'ID', 'Name', 'RFQStatus', 'RFQStatusText',
      'AccountName', 'RFQDueDate', 'OwnerName', 'CreationDateTime',
    ],
    parts.join(' and '),
    userJwt
  );
}

export async function fetchTasks(filters = {}, userJwt) {
  const parts = [];
  parts.push(...dateFilter('DueDateTime', filters.dateFrom, filters.dateTo));
  return fetchAllPages(
    `${ODATA_BASE}/TasksCollection`,
    [
      'ObjectID', 'ID', 'Subject', 'Status', 'StatusText',
      'DueDateTime', 'PriorityCodeText',
    ],
    parts.join(' and '),
    userJwt
  );
}

export async function fetchVisits(filters = {}, userJwt) {
  const parts = [];
  parts.push(...dateFilter('StartDateTime', filters.dateFrom, filters.dateTo));
  return fetchAllPages(
    `${ODATA_BASE}/VisitCollection`,
    [
      'ObjectID', 'ID', 'Subject', 'Status', 'StatusText',
      'StartDateTime', 'EndDateTime', 'AccountPartyName',
    ],
    parts.join(' and '),
    userJwt
  );
}

export async function fetchAppointments(filters = {}, userJwt) {
  const parts = [];
  parts.push(...dateFilter('StartDate', filters.dateFrom, filters.dateTo));
  return fetchAllPages(
    `${ODATA_BASE}/AppointmentCollection`,
    [
      'ObjectID', 'ID', 'Subject', 'LifeCycleStatusCode',
      'StartDate', 'EndDate', 'AccountName',
    ],
    parts.join(' and '),
    userJwt
  );
}

/**
 * Sales org lookup for the FilterBar — custom OData service
 * cust/v1/orgidnamesandfunc, filtered server-side on SalesIndicator + name.
 */
export async function fetchSalesOrgs(search, userJwt) {
  const parts = ['SalesIndicator eq true'];
  if (search) parts.push(`substringof('${odataEscape(search)}',Name)`);
  const data = await c4cRequest(
    `${CUSTOM_BASE}/orgidnamesandfunc/OrganisationalUnitCollection`,
    userJwt,
    {
      $select: 'ObjectID,ID,Name,SalesIndicator',
      $filter: parts.join(' and '),
      $top: 50,
      $inlinecount: 'allpages',
    }
  );
  return (data.results || []).map((o) => ({ id: o.ID, name: o.Name }));
}
