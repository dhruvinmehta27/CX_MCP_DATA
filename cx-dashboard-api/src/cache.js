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
 * Cache-aside helper with in-flight coalescing: concurrent misses on the
 * same key share one upstream fetch instead of stampeding C4C.
 */
const inflight = new Map();

export async function getOrSet(userEmail, queryType, filters, fn, ttl = DEFAULT_TTL) {
  const key = makeCacheKey(userEmail, queryType, filters);
  const hit = cache.get(key);
  if (hit !== undefined) return { data: hit, cached: true };
  if (inflight.has(key)) return { data: await inflight.get(key), cached: true };
  const promise = (async () => {
    const data = await fn();
    cache.set(key, data, ttl);
    return data;
  })();
  inflight.set(key, promise);
  try {
    return { data: await promise, cached: false };
  } finally {
    inflight.delete(key);
  }
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
