import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/dashboard.js';
import * as store from '../api/_store.js';

const BLOCK = '<html><body>Your access to this site has been limited by the site owner</body></html>';
const CHALLENGE = '<html><head><title>Just a moment...</title></head><body>challenge</body></html>';
const WALLET = '<div class="woo-wallet-content-heading"><p><span><bdi>$12.50</bdi></span></p></div>';
const ORDERS = `<table class="woocommerce-orders-table"><tbody><tr>
  <td class="woocommerce-orders-table__cell-order-date_deli">November 12, 2026</td>
  <td class="woocommerce-orders-table__cell-order-date">November 10, 2026</td>
  <td class="woocommerce-orders-table__cell-order-status">On hold</td>
  <td class="woocommerce-orders-table__cell-order-total">$5.50</td>
  <td class="woocommerce-orders-table__cell-order-items"><a>Roasted Chicken Set</a></td>
</tr></tbody></table>`;
const NO_ORDERS = '<div class="woocommerce-info">No order has been made yet.</div>';

let n = 0;
let fetchCalls = [];
const call = async (walletHtml, ordersHtml, ordersStatus = 200) => {
  fetchCalls = [];
  globalThis.fetch = async (url, init) =>
    (fetchCalls.push({ url, headers: init?.headers ?? {} }), url.includes('woo-wallet'))
      ? { ok: true, status: 200, text: async () => walletHtml }
      : { ok: ordersStatus < 400, status: ordersStatus, text: async () => ordersHtml };
  let out;
  const res = { status(c) { out = { status: c }; return this; }, json(b) { out.body = b; } };
  await handler({ method: 'POST', body: { cookies: { s: `k${++n}` } } }, res); // unique cookie => bypass cache
  return out;
};

beforeEach(() => { console.error = () => {}; store.clear(); });

test('a firewall block page is an error, not an empty meal list', async () => {
  const r = await call(WALLET, BLOCK);
  assert.equal(r.status, 503);
  assert.match(r.body.error, /blocking/);
  assert.equal(r.body.blocked, true);
  assert.ok(r.body.retryAfterSec > 0);
});

test('an unexpected page (challenge / error) is an error with diagnostics', async () => {
  const r = await call(WALLET, CHALLENGE);
  assert.equal(r.status, 502);
  assert.equal(r.body.debug.ordersTitle, 'Just a moment...');
});

test('a normal orders page returns raw rows and complete', async () => {
  const r = await call(WALLET, ORDERS);
  assert.equal(r.status, 200);
  assert.equal(r.body.orders.length, 1);
  assert.equal(r.body.orders[0].status, 'On hold');
  assert.equal(r.body.walletBalance, 12.5);
  assert.equal(r.body.complete, true);
});

test('a genuinely empty account is still a valid empty list', async () => {
  const r = await call(WALLET, NO_ORDERS);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.orders, []);
});

test('after a block, further requests are answered without contacting the site', async () => {
  const first = await call(WALLET, BLOCK);
  assert.equal(first.status, 503);
  assert.ok(fetchCalls.length > 0);

  const second = await call(WALLET, ORDERS); // site would now be fine, but we back off
  assert.equal(second.status, 503);
  assert.equal(fetchCalls.length, 0);
});

test('requests to the site carry browser-like headers', async () => {
  await call(WALLET, ORDERS);
  assert.ok(fetchCalls.length >= 2);
  for (const c of fetchCalls) {
    assert.ok(c.headers['Accept']);
    assert.ok(c.headers['Accept-Language']);
    assert.ok(c.headers['User-Agent']);
  }
});
