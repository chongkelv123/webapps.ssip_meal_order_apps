import { AsyncLocalStorage } from 'node:async_hooks';

export const BASE_URL ='https://ssip-cafeteria.whew.life';

// Headers a real browser always sends alongside the User-Agent; their absence
// makes server-side requests look like a bot to firewalls.
export const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

export const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * Parse Set-Cookie headers from a fetch Response into a flat cookie object.
 */
export function extractCookies(response, existing = {}) {
  // Node 18+ undici fetch exposes getSetCookie()
  const setCookieList =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];

  // Fallback: raw header string (some environments)
  if (setCookieList.length === 0) {
    const raw = response.headers.get('set-cookie');
    if (raw) {
      // Cookies are comma-separated but values can also contain commas,
      // so split only on ', ' followed by an attribute-free segment
      raw.split(/,(?=[^ ]+=)/).forEach((str) => parseCookieStr(str, existing));
      return existing;
    }
  }

  setCookieList.forEach((str) => parseCookieStr(str, existing));
  return existing;
}

function parseCookieStr(str, cookies) {
  const [nameValue] = str.split(';');
  const eqIdx = nameValue.indexOf('=');
  if (eqIdx > -1) {
    const name = nameValue.substring(0, eqIdx).trim();
    const value = nameValue.substring(eqIdx + 1).trim();
    if (name) cookies[name] = value;
  }
}

/**
 * Build a Cookie header string from a cookie object.
 */
export function cookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Fetch a URL, manually following redirects so we can capture Set-Cookie at
 * every hop. Returns { res, text, cookies }.
 */
export async function fetchFollowing(url, options = {}, cookieJar = {}, maxRedirects = 10) {
  let currentUrl = url;
  let hops = 0;

  while (hops < maxRedirects) {
    const headers = {
      'User-Agent': USER_AGENT,
      ...BROWSER_HEADERS,
      ...options.headers,
    };
    if (Object.keys(cookieJar).length > 0) {
      headers['Cookie'] = cookieHeader(cookieJar);
    }

    const res = await countedFetch(currentUrl, {
      ...options,
      headers,
      redirect: 'manual',
    });

    // Merge cookies from this hop
    extractCookies(res, cookieJar);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) break;
      currentUrl = new URL(location, currentUrl).href;
      hops++;
      // After a redirect, use GET (per browser behaviour for 302/303)
      if ([302, 303].includes(res.status)) {
        options = { ...options, method: 'GET', body: undefined };
      }
      continue;
    }

    const text = await res.text();

    // Diagnostics only: logs [wf-block] / [wf-unrecognised]; behaviour unchanged.
    if (res.status >= 400 || isSecurityBlockPage(text)) inspectResponse(null, res.status, text);

    // Session expiry: WooCommerce redirected us to the login page
    const sessionExpired =
      res.url?.includes('/my-account/') &&
      text.includes('woocommerce-form-login');

    return { res, text, cookies: cookieJar, sessionExpired };
  }

  throw new Error('Too many redirects');
}

/**
 * Parse $ price from text, e.g. "$5.50" → 5.5
 */
export function parsePrice(text) {
  const match = text.match(/\$(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Convert YYYY-MM-DD to Unix timestamp (seconds) at midnight UTC+8 (Malaysia).
 */
export function dateToUnixTimestamp(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  // exwfood stores delivery dates as UTC-midnight Unix timestamps (no local offset).
  return Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0) / 1000).toString();
}

/**
 * Standard JSON error response.
 */
export function jsonError(res, status, message, sessionExpired = false) {
  return res.status(status).json({ error: message, sessionExpired });
}

// ─── Block-page detection ────────────────────────────────────────────────────

const BLOCK_STATUSES = new Set([403, 429, 503]);

/** Strip HTML to plain text, keeping line breaks at block/cell boundaries. */
function htmlToLines(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table|ul|ol|dt|dd)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Inspect a response from the cafeteria site and say whether it is a firewall
 * block (Wordfence). Returns { blocked, reason, blockedIp, rawSnippet }.
 *
 * Detection does not depend on one exact sentence: Wordfence's rate-limit and
 * lockout pages word things differently. A page is a block when it has the
 * known banner, or mentions Wordfence / "temporarily limited" on a 403/429/503,
 * or is a bare 403/429/503 (a *possible* block, reason "http-<status>").
 * `reason` / `blockedIp` come from the "Block Technical Data" section when present.
 * rawSnippet is plain text only (no cookies/nonces) so it is safe to log.
 */
export function parseBlockPage(html, status = 0) {
  const lines = htmlToLines(html);
  const text = lines.join('\n');
  const rawSnippet = text.replace(/\s+/g, ' ').slice(0, 300);

  const banner = /access to this site has been (limited|temporarily)/i.test(text);
  const limitedWording = /temporarily limited/i.test(text);
  const wordfence = /wordfence/i.test(text);
  const statusBlock = BLOCK_STATUSES.has(status);

  // A bare 403/429/503 counts too (possible block); Wordfence wording just makes it certain.
  const blocked = banner || statusBlock;
  if (!blocked) return { blocked: false, reason: null, blockedIp: null, rawSnippet };

  // Only trust the Wordfence field labels when the page really looks like a block page.
  const reasonM = text.match(/Block(?:ing)?\s+Reason\s*:?\s*\n?\s*([^\n]+)/i);
  const ipM =
    text.match(/Your\s+IP\s*:?\s*\n?\s*([0-9a-f:.]{3,45})/i) ||
    text.match(/\bIP(?:\s+address)?\s*:\s*\n?\s*([0-9a-f:.]{3,45})/i);

  const reason =
    (reasonM && reasonM[1].trim()) ||
    (statusBlock && !banner && !wordfence && !limitedWording ? `http-${status}` : 'unparsed');

  return { blocked: true, reason, blockedIp: ipM ? ipM[1] : null, rawSnippet };
}

/**
 * Parse a response and log what we found. Blocks -> `[wf-block]`; any other
 * 4xx/5xx page -> `[wf-unrecognised]` with a snippet so the cause is visible
 * in Vercel logs. Returns the parsed result.
 */
export function inspectResponse(endpoint, status, html) {
  const parsed = parseBlockPage(html, status);
  const name = endpoint || currentEndpoint();
  if (parsed.blocked) {
    console.error('[wf-block]', { endpoint: name, status, reason: parsed.reason, blockedIp: parsed.blockedIp });
  } else if (status >= 400) {
    console.error('[wf-unrecognised]', { endpoint: name, status, rawSnippet: parsed.rawSnippet });
  }
  return parsed;
}

/**
 * Detect the WordPress/WooCommerce site's firewall block page (returned
 * instead of the real page when it rejects the request's source IP).
 * Body-only check; HTTP status is not considered here.
 */
export function isSecurityBlockPage(html) {
  return parseBlockPage(html, 0).blocked;
}

// ─── Outbound request counting ───────────────────────────────────────────────

const outboundStore = new AsyncLocalStorage();

function currentEndpoint() {
  return outboundStore.getStore()?.endpoint || 'unknown';
}

/**
 * Wrap an API handler so every request it makes to the cafeteria site (via
 * countedFetch / fetchFollowing) is counted and logged when the handler ends:
 * `[outbound] endpoint=meals count=1`.
 */
export function instrument(endpoint, handler) {
  return async function instrumented(req, res) {
    const store = { endpoint, count: 0 };
    try {
      return await outboundStore.run(store, () => handler(req, res));
    } finally {
      console.log(`[outbound] endpoint=${endpoint} count=${store.count}`);
    }
  };
}

/** Drop-in for fetch() that counts the call toward the current handler's total. */
export function countedFetch(url, options) {
  const store = outboundStore.getStore();
  if (store) store.count++;
  return fetch(url, options);
}
