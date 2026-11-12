import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser stubs so src/lib/api.js can run under node:test.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const events = [];
globalThis.window = { dispatchEvent: (e) => events.push(e.type) };

const { getMeals, getDashboard } = await import('../src/lib/api.js');
const { readDashboardCache, writeDashboardCache, clearDashboardCache } = await import('../src/lib/dashboardCache.js');
const { loadDashboardSettings, saveDashboardSettings } = await import('../src/lib/dashboardSettings.js');

const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

let loginCalls;
let fetchImpl;
beforeEach(() => {
  store.clear();
  events.length = 0;
  loginCalls = 0;
  store.set('wc_session_cookies', JSON.stringify({ s: 'old' }));
  globalThis.fetch = (url, init) => fetchImpl(url, JSON.parse(init.body));
});

/** Server stub: data endpoints demand cookie s=new; /api/login hands it out. */
function server({ loginOk = true } = {}) {
  fetchImpl = async (url, body) => {
    if (url === '/api/login') {
      loginCalls++;
      await new Promise((r) => setTimeout(r, 10)); // keep it in flight so parallel callers overlap
      return loginOk ? json(200, { cookies: { s: 'new' } }) : json(401, { error: 'Invalid username or password' });
    }
    if (body.cookies.s !== 'new') return json(401, { error: 'Session expired', sessionExpired: true });
    return json(200, { ok: true, url });
  };
}

test('expired session with saved creds recovers in place', async () => {
  store.set('wc_credentials', JSON.stringify({ username: 'u', password: 'p' }));
  server();
  const data = await getMeals('2026-11-12');
  assert.equal(data.ok, true);
  assert.equal(loginCalls, 1);
  assert.deepEqual(JSON.parse(store.get('wc_session_cookies')), { s: 'new' });
  assert.deepEqual(events, []); // never sent to /login
});

test('no saved creds: cookies removed and session-expired fired', async () => {
  server();
  await assert.rejects(getMeals('2026-11-12'), /Session expired/);
  assert.equal(loginCalls, 0);
  assert.equal(store.has('wc_session_cookies'), false);
  assert.deepEqual(events, ['session-expired']);
});

test('bad password: redirects to login', async () => {
  store.set('wc_credentials', JSON.stringify({ username: 'u', password: 'wrong' }));
  server({ loginOk: false });
  await assert.rejects(getMeals('2026-11-12'), /Session expired/);
  assert.equal(loginCalls, 1);
  assert.equal(store.has('wc_session_cookies'), false);
  assert.deepEqual(events, ['session-expired']);
});

test('empty username or password counts as no saved creds', async () => {
  store.set('wc_credentials', JSON.stringify({ username: 'u', password: '' }));
  server();
  await assert.rejects(getMeals('2026-11-12'), /Session expired/);
  assert.equal(loginCalls, 0);
});

test('retry happens exactly once even if the retry is still rejected', async () => {
  store.set('wc_credentials', JSON.stringify({ username: 'u', password: 'p' }));
  let dataCalls = 0;
  fetchImpl = async (url) => {
    if (url === '/api/login') { loginCalls++; return json(200, { cookies: { s: 'new' } }); }
    dataCalls++;
    return json(401, { error: 'Session expired', sessionExpired: true });
  };
  await assert.rejects(getMeals('2026-11-12'), /Session expired/);
  assert.equal(loginCalls, 1);
  assert.equal(dataCalls, 2); // original + one retry
  assert.deepEqual(events, ['session-expired']);
});

test('parallel expired requests trigger only one login', async () => {
  store.set('wc_credentials', JSON.stringify({ username: 'u', password: 'p' }));
  server();
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => getMeals('2026-11-12')));
  assert.equal(results.length, 5);
  assert.equal(loginCalls, 1);
  assert.deepEqual(events, []);
});

test('a straggler sent with old cookies reuses the fresh login', async () => {
  store.set('wc_credentials', JSON.stringify({ username: 'u', password: 'p' }));
  server();
  await getMeals('2026-11-12'); // refreshes cookies
  // Simulate a request that was sent before the refresh and fails afterwards.
  let first = true;
  const inner = fetchImpl;
  fetchImpl = async (url, body) => {
    if (first && url !== '/api/login') {
      first = false;
      store.set('wc_session_cookies', JSON.stringify({ s: 'new' }));
      return json(401, { error: 'Session expired', sessionExpired: true });
    }
    return inner(url, body);
  };
  store.set('wc_session_cookies', JSON.stringify({ s: 'old' }));
  await getMeals('2026-11-12');
  assert.equal(loginCalls, 1); // no second login
});

test('dashboard: only a complete scrape is cached; stored data is raw only', async () => {
  const body = (complete) => ({ orders: [{ date: '2026-11-02' }], walletBalance: 12.5, today: '2026-11-12', serverTime: Date.now(), complete });

  fetchImpl = async () => json(200, body(false));
  const partial = await getDashboard();
  assert.equal(partial.orders.length, 1);
  assert.equal(readDashboardCache(), null);

  fetchImpl = async () => json(200, body(true));
  await getDashboard();
  const cached = readDashboardCache();
  assert.equal(cached.walletBalance, 12.5);
  assert.deepEqual(Object.keys(JSON.parse(store.get('ssip_dashboard_cache'))).sort(),
    ['clockOffsetMs', 'fetchedAt', 'orders', 'v', 'walletBalance']);
});

test('clearing the dashboard cache (logout) keeps skipped and manual settings', () => {
  saveDashboardSettings({
    missedMealRate: 5, monthlyBudget: 90, budgetEnabled: true,
    exemptDates: ['2026-11-01'], manualMissedDates: ['2026-11-02'],
  });
  writeDashboardCache({ orders: [], walletBalance: 1, clockOffsetMs: 0, fetchedAt: Date.now() });
  clearDashboardCache();
  assert.equal(readDashboardCache(), null);
  const s = loadDashboardSettings();
  assert.deepEqual(s.exemptDates, ['2026-11-01']);
  assert.deepEqual(s.manualMissedDates, ['2026-11-02']);
});

test('settings default manualMissedDates to [] and validate with Array.isArray', () => {
  assert.deepEqual(loadDashboardSettings().manualMissedDates, []);
  store.set('ssip_dashboard_settings', JSON.stringify({ missedMealRate: 4, manualMissedDates: 'nope' }));
  assert.deepEqual(loadDashboardSettings().manualMissedDates, []);
});
