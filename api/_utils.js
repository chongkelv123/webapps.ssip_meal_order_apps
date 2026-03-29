export const BASE_URL = 'https://ssip-cafeteria.whew.life';

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
      ...options.headers,
    };
    if (Object.keys(cookieJar).length > 0) {
      headers['Cookie'] = cookieHeader(cookieJar);
    }

    const res = await fetch(currentUrl, {
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
  // Malaysia is UTC+8; midnight local = 16:00 previous day UTC
  const utcMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  const malaysiaOffsetMs = 8 * 60 * 60 * 1000;
  return Math.floor((utcMs - malaysiaOffsetMs) / 1000).toString();
}

/**
 * Standard JSON error response.
 */
export function jsonError(res, status, message, sessionExpired = false) {
  return res.status(status).json({ error: message, sessionExpired });
}
