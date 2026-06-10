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

const C4C_DESTINATION = process.env.C4C_DESTINATION || 'C4C_QUA_OBO';
const ODATA_BASE = '/sap/c4c/odata/v1/c4codataapi';
const CUSTOM_BASE = '/sap/c4c/odata/cust/v1';
const PAGE_SIZE = 1000;
// Promise.all in batches — full parallelism across 199 pages would exhaust sockets
const PARALLEL_BATCH = 15;

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
 * Resolve the C4C_QUA_OBO destination for the given user.
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
 * Paginated fetcher — C4C returns max 1000 records per request.
 * 1. First page with $inlinecount=allpages + $select
 * 2. Read __count for the total
 * 3. Fetch remaining pages in parallel ($skip=1000, 2000, ...)
 * 4. Merge and return { total, results }
 */
export async function fetchAllPages(collectionPath, selectFields, filterString, userJwt) {
  const dest = await getDestination(userJwt);
  const baseParams = {
    $format: 'json',
    $select: selectFields.join(','),
    $top: PAGE_SIZE,
  };
  if (filterString) baseParams.$filter = filterString;

  const first = await odataGet(dest, collectionPath, {
    ...baseParams,
    $inlinecount: 'allpages',
  });
  const firstResults = first.results || [];
  const total = first.__count !== undefined ? parseInt(first.__count, 10) : firstResults.length;
  let results = firstResults;

  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages > 1) {
    const skips = [];
    for (let p = 1; p < pages; p++) skips.push(p * PAGE_SIZE);
    for (let i = 0; i < skips.length; i += PARALLEL_BATCH) {
      const batch = skips.slice(i, i + PARALLEL_BATCH);
      const pagesData = await Promise.all(
        batch.map((skip) => odataGet(dest, collectionPath, { ...baseParams, $skip: skip }))
      );
      for (const page of pagesData) results = results.concat(page.results || []);
    }
  }
  return { total, results };
}

// ---------------------------------------------------------------------------
// OData filter helpers
// ---------------------------------------------------------------------------

function odataEscape(value) {
  return String(value).replace(/'/g, "''");
}

function dateFilter(field, dateFrom, dateTo) {
  const parts = [];
  if (dateFrom) parts.push(`${field} ge datetime'${dateFrom}T00:00:00'`);
  if (dateTo) parts.push(`${field} le datetime'${dateTo}T23:59:59'`);
  return parts;
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
      'ObjectID', 'ID', 'Name', 'SalesPhaseCode', 'SalesPhaseCodeText',
      'ExpectedRevenueAmount', 'ExpectedProcessingEndDate',
      'CreationDateTime', 'MainEmployeeResponsiblePartyName',
      'ProspectPartyName', 'LifeCycleStatusCode', 'LifeCycleStatusCodeText',
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
      'DueDateTime', 'PriorityCodeText', 'MainAccountPartyName',
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
