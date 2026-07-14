/**
 * Account country cache — maps AccountID → { countryCode, country }
 * Built from C4C AccountCollection once per TTL and shared across all users.
 * This lets us enrich quotes/opportunities with account country without
 * using $expand (which C4C caps at 100 records per page).
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
