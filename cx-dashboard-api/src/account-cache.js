/**
 * Account cache — maps AccountID → { countryCode, country, applicationCode,
 * applicationCodeText, mktSegGrpCode, mktSegGrpCodeText, strategicAccountCode,
 * strategicAccountText }. Built from C4C AccountCollection once per TTL and
 * shared across all users. This lets us enrich quotes/opportunities with
 * account-level data (country, classification) without using $expand (which
 * C4C caps at 100 records per page).
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cache = null; // { map: Map<string, {countryCode, country}>, builtAt: number }
let inflight = null; // single in-flight promise to prevent stampede

/**
 * Returns the account country map, building it if stale/missing.
 * @param {Function} fetchFn - async () => { results: [{AccountID, CountryCode, CountryCodeText}] }
 */
export async function getAccountCountryMap(fetchFn) {
  if (cache && Date.now() - cache.builtAt < TTL_MS) return cache.map;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const data = await fetchFn();
      const map = new Map();
      for (const acc of data.results || []) {
        if (acc.AccountID) {
          map.set(acc.AccountID, {
            countryCode: acc.CountryCode || '',
            country: acc.CountryCodeText || acc.CountryCode || '',
            applicationCode: acc.ApplicationCode || '',
            applicationCodeText: acc.ApplicationCodeText || '',
            mktSegGrpCode: acc.MKT_SEG_GRP_CDE || '',
            mktSegGrpCodeText: acc.MKT_SEG_GRP_CDEText || '',
            strategicAccountCode: acc.StrategicAccount_KUT || '',
            strategicAccountText: acc.StrategicAccount_KUTText || '',
          });
        }
      }
      cache = { map, builtAt: Date.now() };
      return map;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Enrich a list of records with BuyerCountry and ShipToCountry
 * using the cached account map.
 */
export function enrichWithCountry(results, countryMap) {
  return results.map((r) => {
    const buyer = countryMap.get(r.BuyerPartyID) || {};
    const shipTo = countryMap.get(r.ProductRecipientPartyID) || {};
    return {
      ...r,
      BuyerCountryCode: buyer.countryCode || '',
      BuyerCountry: buyer.country || '',
      ShipToCountryCode: shipTo.countryCode || '',
      ShipToCountry: shipTo.country || '',
    };
  });
}

/**
 * Enrich Opportunities with account-level classification (Application,
 * Market Segment Group, Strategic Account) via ProspectPartyID → AccountID.
 * Opportunity does NOT carry these fields itself (unlike BUS_SEG_CDE_KUT/
 * MKT_SEG_CODE, which it has its own copy of) — this is the only way to get
 * them without an $expand (capped at 100 records/page on this tenant).
 */
export function enrichOpportunitiesWithAccountClassification(results, accountMap) {
  return results.map((r) => {
    const acc = accountMap.get(r.ProspectPartyID) || {};
    return {
      ...r,
      AccountApplicationCode: acc.applicationCode || '',
      AccountApplicationCodeText: acc.applicationCodeText || '',
      AccountMktSegGrpCode: acc.mktSegGrpCode || '',
      AccountMktSegGrpCodeText: acc.mktSegGrpCodeText || '',
      AccountStrategicCode: acc.strategicAccountCode || '',
      AccountStrategicText: acc.strategicAccountText || '',
    };
  });
}
