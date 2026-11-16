import { timingSafeEqual } from 'node:crypto';
import { BASE_URL, USER_AGENT, BROWSER_HEADERS, countedFetch, instrument, parseBlockPage, inspectResponse } from './_utils.js';
import * as store from './_store.js';

const CACHE_KEY = 'diag:last';
const CACHE_TTL_SEC = 60;

function tokenOk(given) {
  const expected = process.env.DIAG_TOKEN;
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One unauthenticated GET, no redirects. Never throws. */
async function probe(path, label) {
  try {
    const res = await countedFetch(`${BASE_URL}${path}`, {
      headers: { 'User-Agent': USER_AGENT, ...BROWSER_HEADERS },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const parsed = parseBlockPage(html, res.status);
    if (parsed.blocked) inspectResponse(`diag:${label}`, res.status, html);
    const out = { status: res.status, blocked: parsed.blocked, reason: parsed.reason, blockedIp: parsed.blockedIp };
    if (parsed.blocked) out.rawSnippet = parsed.rawSnippet;
    return out;
  } catch (err) {
    return { status: null, blocked: null, reason: null, blockedIp: null, error: err.message };
  }
}

async function egressIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    return (await res.json()).ip || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/diag?token=<DIAG_TOKEN>
 * On-demand firewall check: one GET to the homepage and one to /my-account/
 * (a login lockout may only show there), cached for 60 s so it can't add load.
 */
async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!tokenOk(req.query?.token)) return res.status(404).json({ error: 'Not found' });

  const cached = await store.get(CACHE_KEY);
  if (cached) return res.status(200).json({ ...cached, cached: true });

  const [home, myAccount, ip] = await Promise.all([probe('/', 'home'), probe('/my-account/', 'my-account'), egressIp()]);

  const payload = {
    region: process.env.VERCEL_REGION || 'local',
    egressIp: ip,
    // Top-level mirror of the homepage result (as originally specced).
    status: home.status,
    blocked: home.blocked,
    reason: home.reason,
    blockedIp: home.blockedIp,
    home,
    myAccount,
    checkedAt: new Date().toISOString(),
  };
  await store.set(CACHE_KEY, payload, CACHE_TTL_SEC);
  return res.status(200).json(payload);
}

export default instrument('diag', handler);
