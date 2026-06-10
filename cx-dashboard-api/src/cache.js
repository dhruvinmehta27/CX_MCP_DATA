/**
 * In-memory cache with user-scoped keys (node-cache).
 * Each CF instance has its own cache — acceptable for single-instance.
 */
import NodeCache from 'node-cache';

const DEFAULT_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '900', 10); // 15 min
const cache = new NodeCache({ stdTTL: DEFAULT_TTL, checkperiod: 120, useClones: false });

function sortedFilters(filters = {}) {
  const sorted = {};
  for (const key of Object.keys(filters).sort()) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
      sorted[key] = filters[key];
    }
  }
  return sorted;
}

export function makeCacheKey(userEmail, queryType, filters) {
  return `${userEmail}:${queryType}:${JSON.stringify(sortedFilters(filters))}`;
}

/**
 * Cache-aside helper: hit → return immediately; miss → run fn, store, return.
 */
export async function getOrSet(userEmail, queryType, filters, fn, ttl = DEFAULT_TTL) {
  const key = makeCacheKey(userEmail, queryType, filters);
  const hit = cache.get(key);
  if (hit !== undefined) return { data: hit, cached: true };
  const data = await fn();
  cache.set(key, data, ttl);
  return { data, cached: false };
}

/**
 * Clear all cache entries for one user (per-user data isolation).
 */
export function clearUserCache(userEmail) {
  const prefix = `${userEmail}:`;
  const keys = cache.keys().filter((k) => k.startsWith(prefix));
  cache.del(keys);
  return keys.length;
}

export function cacheStats() {
  return cache.getStats();
}
