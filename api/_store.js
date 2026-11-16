/**
 * Tiny shared key-value store with TTL. Phase 0: in-memory only (per warm
 * serverless instance). Phase 1 swaps in Upstash Redis behind the same API.
 */
const mem = new Map();

export async function get(key) {
  const entry = mem.get(key);
  if (!entry) return null;
  if (entry.expires !== null && Date.now() > entry.expires) {
    mem.delete(key);
    return null;
  }
  return entry.value;
}

export async function set(key, value, ttlSec = null) {
  mem.set(key, { value, expires: ttlSec ? Date.now() + ttlSec * 1000 : null });
}

/** Test hook. */
export function clear() { mem.clear(); }
