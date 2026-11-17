/**
 * Tiny shared key-value store with TTL: get / set / incr.
 *
 * - With UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set, it uses Upstash
 *   Redis over its REST API (plain fetch, no SDK), so every serverless instance
 *   sees the same values. That is what makes the firewall back-off global.
 * - Without them (local dev, tests) it falls back to an in-memory Map, which is
 *   per warm instance only.
 *
 * Values are JSON-encoded. The store never throws: if Upstash is unreachable we
 * log and behave as "no value" (fail open), so a store outage can't take the
 * app down. Store calls never go to the cafeteria site and aren't counted.
 */
const mem = new Map();

function upstash() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

/** Run one Redis command, e.g. ['SET', 'k', 'v', 'EX', 60]. Returns `result`, or undefined on failure. */
async function redis(cfg, command) {
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(2000),
    });
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
    return body.result;
  } catch (err) {
    console.error('[store]', command[0], err.message);
    return undefined;
  }
}

// ─── In-memory fallback ──────────────────────────────────────────────────────

function memGet(key) {
  const entry = mem.get(key);
  if (!entry) return null;
  if (entry.expires !== null && Date.now() > entry.expires) {
    mem.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key, value, ttlSec) {
  mem.set(key, { value, expires: ttlSec ? Date.now() + ttlSec * 1000 : null });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function get(key) {
  const cfg = upstash();
  if (!cfg) return memGet(key);
  const raw = await redis(cfg, ['GET', key]);
  if (raw === undefined || raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function set(key, value, ttlSec = null) {
  const cfg = upstash();
  if (!cfg) return memSet(key, value, ttlSec);
  const cmd = ['SET', key, JSON.stringify(value)];
  if (ttlSec) cmd.push('EX', Math.max(1, Math.ceil(ttlSec)));
  await redis(cfg, cmd);
}

/**
 * Increment a counter. The TTL is applied when the key is created, so the
 * counter is a fixed window starting at the first increment. Returns the new
 * value (or 0 if the store is unreachable).
 */
export async function incr(key, ttlSec = null) {
  const cfg = upstash();
  if (!cfg) {
    const next = (Number(memGet(key)) || 0) + 1;
    const entry = mem.get(key);
    if (entry && next > 1) entry.value = next; // keep the original expiry
    else memSet(key, next, ttlSec);
    return next;
  }
  const n = await redis(cfg, ['INCR', key]);
  if (n === undefined) return 0;
  if (n === 1 && ttlSec) await redis(cfg, ['EXPIRE', key, Math.max(1, Math.ceil(ttlSec))]);
  return n;
}

/** Test hook (in-memory only). */
export function clear() { mem.clear(); }
