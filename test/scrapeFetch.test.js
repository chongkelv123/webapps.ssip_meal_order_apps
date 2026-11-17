import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { scrapeFetch, fetchFollowing, BlockedError, BLOCK_KEY, instrument } from '../api/_utils.js';
import * as store from '../api/_store.js';
import meals from '../api/meals.js';
import orders from '../api/orders.js';
import login from '../api/login.js';
import placeOrder from '../api/place-order.js';
import cancelOrder, { cancelSucceeded } from '../api/cancel-order.js';
import dashboard from '../api/dashboard.js';

const BLOCK = '<html><body>Your access to this site has been limited by the site owner</body></html>';
const headers = (cookies = []) => ({ get: () => null, getSetCookie: () => cookies });
const page = (html, status = 200, setCookie = []) => ({ ok: status < 400, status, headers: headers(setCookie), text: async () => html });

let calls;
let respond;
beforeEach(() => {
  store.clear();
  calls = [];
  console.error = () => {};
  console.log = () => {};
  respond = () => page('<html>ok</html>');
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  };
});

const run = async (handler, body) => {
  let out;
  const res = { status(c) { out = { status: c }; return this; }, json(b) { out.body = b; } };
  await handler({ method: 'POST', body }, res);
  return out;
};

// ─── scrapeFetch ─────────────────────────────────────────────────────────────

test('applies browser headers and the cookie jar, and merges Set-Cookie back', async () => {
  respond = () => page('<html>ok</html>', 200, ['fresh=1; path=/']);
  const jar = { s: 'abc' };
  await scrapeFetch('https://x/', { headers: { Referer: 'r' } }, jar);
  const h = calls[0].init.headers;
  assert.ok(h['User-Agent'] && h.Accept && h['Accept-Language']);
  assert.equal(h.Referer, 'r');
  assert.equal(h.Cookie, 's=abc');
  assert.equal(jar.fresh, '1');
});

test('a block page throws BlockedError and starts a 10-minute shared back-off', async () => {
  respond = () => page(BLOCK, 503);
  await assert.rejects(scrapeFetch('https://x/'), (e) => e instanceof BlockedError && e.retryAfterSec > 590 && e.retryAfterSec <= 600);
  const rec = await store.get(BLOCK_KEY);
  assert.equal(rec.strikes, 1);
});

test('while backed off, nothing is sent to the site', async () => {
  respond = () => page(BLOCK, 503);
  await assert.rejects(scrapeFetch('https://x/'));
  respond = () => page('<html>fine now</html>');
  const before = calls.length;
  await assert.rejects(scrapeFetch('https://x/'), BlockedError);
  await assert.rejects(fetchFollowing('https://x/'), BlockedError);
  assert.equal(calls.length, before);
});

test('a block within 6 h of the last one doubles the wait, capped at 60 minutes', async () => {
  respond = () => page(BLOCK, 503);
  await store.set(BLOCK_KEY, { until: Date.now() - 1000, strikes: 1 }, 3600);
  await assert.rejects(scrapeFetch('https://x/'), (e) => e.retryAfterSec > 1190 && e.retryAfterSec <= 1200);

  await store.set(BLOCK_KEY, { until: Date.now() - 1000, strikes: 5 }, 3600);
  await assert.rejects(scrapeFetch('https://x/'), (e) => e.retryAfterSec > 3590 && e.retryAfterSec <= 3600);
});

test('requests already in flight when a block starts do not escalate it', async () => {
  respond = () => page(BLOCK, 503);
  await assert.rejects(scrapeFetch('https://x/'));
  await assert.rejects(scrapeFetch('https://x/', { ignoreBackoff: true }));
  assert.equal((await store.get(BLOCK_KEY)).strikes, 1);
});

test('a bare 403 (e.g. a stale admin-ajax nonce) does not lock everyone out', async () => {
  respond = () => page('-1', 403);
  const { res, text } = await scrapeFetch('https://x/');
  assert.equal(res.status, 403);
  assert.equal(text, '-1');
  assert.equal(await store.get(BLOCK_KEY), null);
});

test('the back-off is read once per handler invocation (saves store calls), fresh per invocation', async () => {
  await instrument('t', async () => {
    await scrapeFetch('https://x/'); // reads the store: no block
    // Another instance records a block mid-invocation; this invocation uses its memo.
    await store.set(BLOCK_KEY, { until: Date.now() + 60000, strikes: 1 }, 600);
    await scrapeFetch('https://x/');
  })();
  assert.equal(calls.length, 2);
  // The next invocation reads the store again and sees the block.
  await assert.rejects(instrument('t', () => scrapeFetch('https://x/'))(), BlockedError);
  assert.equal(calls.length, 2);
});

// ─── Handlers ────────────────────────────────────────────────────────────────

const ORDER = { firstName: 'a', lastName: 'b', phone: '1', email: 'e@x' };
const handlers = [
  ['meals', meals, { date: '2026-11-17' }],
  ['orders', orders, {}],
  ['login', login, { username: 'u', password: 'p' }],
  ['place-order', placeOrder, { productId: '1', date: '2026-11-17', orderDetails: ORDER }],
  ['cancel-order', cancelOrder, { cancelUrl: 'https://ssip-cafeteria.whew.life/?cancel_order=true&order=wc_order_k1' }],
  ['dashboard', dashboard, {}],
];

for (const [name, handler, body] of handlers) {
  test(`${name}: a block page returns 503 { blocked, retryAfterSec }`, async () => {
    respond = () => page(BLOCK, 503);
    const r = await run(handler, { cookies: { s: name }, ...body });
    assert.equal(r.status, 503);
    assert.equal(r.body.blocked, true);
    assert.ok(r.body.retryAfterSec > 0);
  });

  test(`${name}: during a back-off it answers without contacting the site`, async () => {
    await store.set(BLOCK_KEY, { until: Date.now() + 120000, strikes: 1 }, 600);
    const r = await run(handler, { cookies: { s: name + '2' }, ...body });
    assert.equal(r.status, 503);
    assert.equal(r.body.blocked, true);
    assert.ok(r.body.retryAfterSec > 100 && r.body.retryAfterSec <= 120);
    assert.equal(calls.length, 0);
  });
}

test('place-order stops guessing admin-ajax actions once blocked', async () => {
  const checkout = '<form name="checkout"><input type="hidden" name="woocommerce-process-checkout-nonce" value="n"></form>';
  respond = (url) => {
    if (url.includes('admin-ajax')) return page(BLOCK, 503);
    if (url.includes('/checkout/')) return page(checkout);
    return page('<html>cart</html>');
  };
  const r = await run(placeOrder, { cookies: { s: 'x' }, productId: '1', date: '2026-11-17', orderDetails: ORDER });
  assert.equal(r.status, 503);
  assert.equal(calls.filter((c) => c.url.includes('admin-ajax')).length, 1);
});

// ─── cancel-order success detection ──────────────────────────────────────────

const URL_K1 = 'https://ssip-cafeteria.whew.life/my-account/?cancel_order=true&order=wc_order_k1&order_id=5';
const table = (links) => `<table class="woocommerce-orders-table"><tbody><tr><td>${links}</td></tr></tbody></table>`;

test('cancel: a cancellation notice is success', () => {
  assert.equal(cancelSucceeded('<div class="woocommerce-message">Your order was cancelled.</div>', URL_K1), true);
});

test('cancel: an error notice is failure even if "cancelled" appears elsewhere', () => {
  const html = '<ul class="woocommerce-error"><li>Your order can no longer be cancelled.</li></ul>' + table('Cancelled');
  assert.equal(cancelSucceeded(html, URL_K1), false);
});

test('cancel: orders table without this order\'s cancel link is success; with it, failure', () => {
  assert.equal(cancelSucceeded(table('<a class="cancel" href="?cancel_order=true&amp;order=wc_order_k2">Cancel</a>'), URL_K1), true);
  assert.equal(cancelSucceeded(table('<a class="cancel" href="?cancel_order=true&amp;order=wc_order_k1">Cancel</a>'), URL_K1), false);
});

test('cancel: an unrelated page is not success (old check said yes for any status < 400)', () => {
  assert.equal(cancelSucceeded('<html><body>Something else; another order Cancelled</body></html>', URL_K1), false);
});

test('cancel-order handler reports failure for a non-confirmation page', async () => {
  respond = () => page('<html>home</html>');
  const r = await run(cancelOrder, { cookies: { s: 'x' }, cancelUrl: URL_K1 });
  assert.deepEqual(r.body, { success: false });
});

// ─── Store: Upstash REST mode ────────────────────────────────────────────────

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

test('store uses Upstash REST commands when configured', async () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example/';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const cmd = JSON.parse(init.body);
    sent.push({ url, auth: init.headers.Authorization, cmd });
    const result = cmd[0] === 'GET' ? JSON.stringify({ a: 1 }) : cmd[0] === 'INCR' ? 1 : 'OK';
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  await store.set('k', { a: 1 }, 30);
  assert.deepEqual(await store.get('k'), { a: 1 });
  assert.equal(await store.incr('n', 60), 1);
  assert.equal(sent[0].url, 'https://redis.example');
  assert.equal(sent[0].auth, 'Bearer tok');
  assert.deepEqual(sent.map((s) => s.cmd), [
    ['SET', 'k', '{"a":1}', 'EX', 30],
    ['GET', 'k'],
    ['INCR', 'n'],
    ['EXPIRE', 'n', 60],
  ]);
});

test('store fails open when Upstash is unreachable', async () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
  globalThis.fetch = async () => { throw new Error('down'); };
  assert.equal(await store.get('k'), null);
  await store.set('k', 1, 10); // no throw
  assert.equal(await store.incr('n', 10), 0);
});

test('in-memory incr keeps its window', async () => {
  assert.equal(await store.incr('w', 60), 1);
  assert.equal(await store.incr('w', 60), 2);
  assert.equal(await store.get('w'), 2);
});
