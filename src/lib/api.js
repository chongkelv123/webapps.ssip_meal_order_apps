import { writeDashboardCache } from './dashboardCache.js';

const COOKIES_KEY = 'wc_session_cookies';
const CREDENTIALS_KEY = 'wc_credentials';

function getCookies() {
  const stored = localStorage.getItem(COOKIES_KEY);
  return stored ? JSON.parse(stored) : {};
}

async function parseResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server error (${res.status}): ${text.slice(0, 300)}`);
  }
  return { res, data };
}

function throwIfFailed({ res, data }) {
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// ─── Silent session recovery ─────────────────────────────────────────────────
//
// When the server reports an expired session we first try to log in again with
// the saved remember-me credentials and retry the request once, so a routine
// expiry never bounces the user through /login. Only if that fails do we drop
// the cookies and send them to the login page.

let reloginInFlight = null;

function readSavedCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(CREDENTIALS_KEY) || 'null');
    if (saved && saved.username && saved.password) return saved;
  } catch {
    /* fall through */
  }
  return null;
}

async function reloginWithSavedCredentials() {
  const creds = readSavedCredentials();
  if (!creds) return false;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: creds.username, password: creds.password }),
    });
    const { data } = await parseResponse(res);
    if (!res.ok || !data.cookies) return false;
    localStorage.setItem(COOKIES_KEY, JSON.stringify(data.cookies));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves true if the session is usable again. `sentCookies` is the cookie
 * string the failed request was sent with: if the stored cookies have since
 * changed, a parallel request already re-logged in, so we just retry.
 * Concurrent callers share one in-flight login.
 */
function recoverSession(sentCookies) {
  if ((localStorage.getItem(COOKIES_KEY) ?? '') !== sentCookies) {
    return Promise.resolve(true);
  }
  if (!reloginInFlight) {
    reloginInFlight = reloginWithSavedCredentials().finally(() => {
      reloginInFlight = null;
    });
  }
  return reloginInFlight;
}

function expireSession() {
  localStorage.removeItem(COOKIES_KEY);
  window.dispatchEvent(new CustomEvent('session-expired'));
  return new Error('Session expired. Please log in again.');
}

async function sendPost(endpoint, body) {
  const sentCookies = localStorage.getItem(COOKIES_KEY) ?? '';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies: getCookies(), ...body }),
  });
  return { ...(await parseResponse(res)), sentCookies };
}

async function post(endpoint, body = {}) {
  let result = await sendPost(endpoint, body);

  if (result.data.sessionExpired) {
    const recovered = await recoverSession(result.sentCookies);
    if (recovered) result = await sendPost(endpoint, body); // retry exactly once
    if (!recovered || result.data.sessionExpired) throw expireSession();
  }

  return throwIfFailed(result);
}

// No cookies needed for login
export async function login(username, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return throwIfFailed(await parseResponse(res));
}

export const getMeals = (date) => post('/api/meals', { date });

export const getOrders = (page = 1) => post('/api/orders', { page });

/**
 * Raw dashboard data: order rows, wallet balance and a clock offset (server
 * time minus device time) so "today" can be derived in the server's SGT date
 * even for cached data or a skewed device clock. Everything else is computed
 * client-side (see dashboardCalc.js). Only a complete scrape is persisted.
 */
export async function getDashboard() {
  const data = await post('/api/dashboard');
  const raw = {
    orders: data.orders ?? [],
    walletBalance: typeof data.walletBalance === 'number' ? data.walletBalance : null,
    clockOffsetMs: typeof data.serverTime === 'number' ? data.serverTime - Date.now() : 0,
    fetchedAt: Date.now(),
  };
  if (data.complete) writeDashboardCache(raw);
  return raw;
}

export const placeOrder = (productId, date, orderDetails) =>
  post('/api/place-order', { productId, date, orderDetails });

export const cancelOrder = (cancelUrl) => post('/api/cancel-order', { cancelUrl });
