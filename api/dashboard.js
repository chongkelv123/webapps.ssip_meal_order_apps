import { load } from 'cheerio';
import { BASE_URL, USER_AGENT, BROWSER_HEADERS, cookieHeader, parsePrice, jsonError, isSecurityBlockPage, countedFetch, inspectResponse, instrument } from './_utils.js';
import { getBillingPeriod } from '../src/lib/dashboardCalc.js';

// ─── HTML extraction ─────────────────────────────────────────────────────────

const WALLET_SELECTORS = [
  '.woo-wallet-content-heading p span bdi',
  '.woo-wallet-my-wallet-container bdi',
  '.woo-wallet-balance bdi',
  'bdi',
];

/**
 * Returns the wallet balance as a number, or null when the page did not
 * contain a recognisable balance — null lets callers distinguish "genuinely
 * $0.00" from "we couldn't read it" and render "—" instead.
 */
function extractWalletBalance(html) {
  const $ = load(html);
  for (const sel of WALLET_SELECTORS) {
    let found = null;
    $(sel).each((_, el) => {
      const text = $(el).text();
      if (text.includes('$') && found === null) {
        const p = parsePrice(text);
        if (p !== null) found = p;
      }
    });
    if (found !== null) return found;
  }
  return null;
}

function parseDate(text) {
  const match = text.match(/(\w+ \d+, \d{4})/);
  if (!match) return null;
  const d = new Date(match[1] + ' 12:00 UTC');
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function extractOrdersFromHtml(html) {
  const $ = load(html);
  const orders = [];

  $('table.woocommerce-orders-table tbody tr').each((_, row) => {
    const $row = $(row);

    const deliDateText  = $row.find('td.woocommerce-orders-table__cell-order-date_deli').text().trim();
    const orderDateText = $row.find('td.woocommerce-orders-table__cell-order-date').text().trim();

    const deliveryDate = parseDate(deliDateText) || parseDate(orderDateText);
    if (!deliveryDate) return;

    const orderDate = parseDate(orderDateText) || deliveryDate;
    const status    = $row.find('td.woocommerce-orders-table__cell-order-status').text().trim();
    const price     = parsePrice($row.find('td.woocommerce-orders-table__cell-order-total').text());
    if (price === null) return;

    const $itemsCell = $row.find('td.woocommerce-orders-table__cell-order-items');
    const mealName   =
      $itemsCell.find('a').first().text().trim() ||
      $itemsCell.text().replace(/[×x]\s*[\d.]+/g, '').trim();

    const cancelUrl =
      $row.find('td.woocommerce-orders-table__cell-order-actions a.cancel').attr('href') || null;

    orders.push({ date: deliveryDate, orderDate, status, price, mealName, cancelUrl });
  });

  // This theme uses woocommerce-button--next, not the default "next page-numbers".
  const hasNextPage = $('a.woocommerce-button--next').length > 0;
  return { orders, hasNextPage };
}

/**
 * True when the page looks like the real order list (a table of orders, or
 * WooCommerce's "no orders yet" notice). Anything else (a firewall page, a
 * challenge page, an error page) must not be mistaken for "zero orders", or
 * the client would replace good meals with an empty list.
 */
function looksLikeOrdersPage(html) {
  const $ = load(html);
  return $('table.woocommerce-orders-table').length > 0 || $('.woocommerce-info').length > 0;
}

const BLOCKED_MESSAGE =
  "The cafeteria site is blocking requests from our server right now, so your meals can't be refreshed. Please try again later.";

// ─── Block back-off ──────────────────────────────────────────────────────────
//
// Once the site's firewall has blocked us, every further request (from every
// user's retry) can prolong the block. Remember it and answer straight away
// for a few minutes without contacting the site. Best-effort: per warm instance.
const BLOCK_BACKOFF_MS = 5 * 60 * 1000;
let blockedUntil = 0;

/** Test hook: clears the back-off. */
export function resetBlockBackoff() { blockedUntil = 0; }

// ─── Pagination ──────────────────────────────────────────────────────────────

const MAX_PAGES  = 50;
const BATCH_SIZE = 2; // pages fetched concurrently per wave (kept small: bursts trip the site's firewall)

/**
 * Fetches pages 2+ in concurrent batches (waves of BATCH_SIZE) and stops
 * once two consecutive pages (in page order) contain no orders on or after
 * billingPeriodStart. Fetching a whole wave in parallel turns what used to
 * be one network round-trip per page into one round-trip per batch, which is
 * the dominant cost for accounts with multi-page order history.
 *
 * Using billingPeriodStart (the 27th of last month) rather than the calendar
 * month ensures we never stop before we have all the orders the dashboard
 * needs, even when today is only a few days into a new month.
 */
async function fetchRemainingPages(cookies, billingPeriodStart) {
  const allOrders = [];
  const cookieStr = Object.keys(cookies).length ? cookieHeader(cookies) : '';

  let page = 2;
  let consecutiveOutOfRange = 0;
  let done = false;
  // A scrape is only "complete" if it ended naturally (no more pages / two
  // out-of-range pages). A failed page, a login-form page or hitting MAX_PAGES
  // means the rows may be partial, so the client must not persist them.
  let complete = false;
  let blocked = false;

  while (page <= MAX_PAGES && !done) {
    const batchPages = [];
    for (let p = page; p < page + BATCH_SIZE && p <= MAX_PAGES; p++) batchPages.push(p);

    const batchResults = await Promise.all(
      batchPages.map((p) =>
        countedFetch(`${BASE_URL}/orders/${p}/`, {
          headers: { 'User-Agent': USER_AGENT, ...BROWSER_HEADERS, ...(cookieStr ? { Cookie: cookieStr } : {}) },
        }).then(async (res) => {
          if (res.ok) return { ok: true, html: await res.text() };
          inspectResponse('dashboard', res.status, await res.text()); // diagnostics only
          return { ok: false };
        })
      )
    );

    // Process in page order so the "two consecutive out-of-range pages" stop
    // condition behaves identically to the old one-page-at-a-time loop.
    for (const result of batchResults) {
      if (result.ok && isSecurityBlockPage(result.html)) blocked = true;
      if (!result.ok || result.html.includes('woocommerce-form-login') || isSecurityBlockPage(result.html)) { done = true; break; }

      const { orders, hasNextPage } = extractOrdersFromHtml(result.html);
      if (orders.length === 0) { done = true; complete = true; break; }

      allOrders.push(...orders);

      const hasPeriodOrders = orders.some(o => o.date >= billingPeriodStart);
      consecutiveOutOfRange = hasPeriodOrders ? 0 : consecutiveOutOfRange + 1;
      if (consecutiveOutOfRange >= 2 || !hasNextPage) { done = true; complete = true; break; }
    }

    page += BATCH_SIZE;
  }

  return { orders: allOrders, complete, blocked };
}

// ─── Scrape cache ─────────────────────────────────────────────────────────────
//
// Best-effort cache for the expensive part (wallet balance + full order
// history scrape), keyed by session cookie string. Only helps when Vercel
// reuses a warm lambda instance for a later request, but that's common for
// back-to-back navigations right after login. Only complete scrapes are
// cached. This server returns raw rows only; the client derives every figure.
const scrapeCache  = new Map();
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

function getCachedScrape(key) {
  const entry = scrapeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    scrapeCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedScrape(key, data) {
  scrapeCache.set(key, { data, timestamp: Date.now() });
  if (scrapeCache.size > CACHE_MAX_ENTRIES) {
    scrapeCache.delete(scrapeCache.keys().next().value);
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Returns the raw scrape: order rows, wallet balance, the server's SGT "today"
 * and a `complete` flag. All derived figures (missed days, budget, balances)
 * are computed client-side from these plus the user's local settings.
 */
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cookies = {} } = req.body || {};
  const cookieStr = Object.keys(cookies).length ? cookieHeader(cookies) : '';

  try {
    // "Today" in SGT (UTC+8) — the cafeteria is in Singapore/Malaysia.
    const now   = Date.now();
    const today = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { start: billingPeriodStart } = getBillingPeriod(today);

    const cacheKey = cookieStr || null;
    const cached   = cacheKey ? getCachedScrape(cacheKey) : null;

    if (!cached && Date.now() < blockedUntil) {
      return jsonError(res, 503, BLOCKED_MESSAGE);
    }

    let walletBalanceRaw, allOrders, complete;

    if (cached) {
      ({ walletBalanceRaw, allOrders, complete } = cached);
    } else {
      // Fetch wallet page and first orders page in parallel.
      const [walletRes, ordersRes] = await Promise.all([
        countedFetch(`${BASE_URL}/woo-wallet/`, {
          headers: { 'User-Agent': USER_AGENT, ...BROWSER_HEADERS, ...(cookieStr ? { Cookie: cookieStr } : {}) },
        }),
        countedFetch(`${BASE_URL}/orders/`, {
          headers: { 'User-Agent': USER_AGENT, ...BROWSER_HEADERS, ...(cookieStr ? { Cookie: cookieStr } : {}) },
        }),
      ]);

      if (walletRes.status === 302 || ordersRes.status === 302) {
        return jsonError(res, 401, 'Session expired', true);
      }

      const walletHtml = await walletRes.text();
      const ordersHtml = await ordersRes.text();

      // Diagnostics only: log the block reason / IP, or a snippet of unexpected 4xx/5xx pages.
      for (const [r, h] of [[walletRes, walletHtml], [ordersRes, ordersHtml]]) {
        if (r.status >= 400 || isSecurityBlockPage(h)) inspectResponse('dashboard', r.status, h);
      }

      if (walletHtml.includes('woocommerce-form-login') || ordersHtml.includes('woocommerce-form-login')) {
        return jsonError(res, 401, 'Session expired', true);
      }

      if (isSecurityBlockPage(walletHtml) || isSecurityBlockPage(ordersHtml)) {
        blockedUntil = Date.now() + BLOCK_BACKOFF_MS;
        console.error('[dashboard] firewall block page', { walletStatus: walletRes.status, ordersStatus: ordersRes.status });
        return jsonError(res, 503, BLOCKED_MESSAGE);
      }
      if (!ordersRes.ok || !looksLikeOrdersPage(ordersHtml)) {
        // Surface what we actually got so the cause is visible in the Network tab / Vercel logs.
        const debug = {
          walletStatus: walletRes.status,
          ordersStatus: ordersRes.status,
          ordersBytes: ordersHtml.length,
          ordersTitle: (ordersHtml.match(/<title>([^<]*)<\/title>/i) || [])[1] || null,
        };
        console.error('[dashboard] unexpected orders page', debug);
        return res.status(502).json({
          error: "The cafeteria site returned an unexpected page, so your meals can't be refreshed right now.",
          sessionExpired: false,
          debug,
        });
      }

      walletBalanceRaw = extractWalletBalance(walletHtml);

      const { orders: page1Orders, hasNextPage } = extractOrdersFromHtml(ordersHtml);
      allOrders = [...page1Orders];
      complete  = ordersRes.ok && walletRes.ok && walletBalanceRaw !== null;

      if (hasNextPage) {
        const extra = await fetchRemainingPages(cookies, billingPeriodStart);
        complete = complete && extra.complete;
        if (extra.blocked) blockedUntil = Date.now() + BLOCK_BACKOFF_MS;
        // Keyed on delivery date too, not just orderDate + mealName: a single bulk
        // checkout books the same meal across many delivery dates, so those fields
        // alone collide across every day of that order and would wrongly drop all
        // but the first day seen.
        const seen  = new Set(allOrders.map(o => `${o.date}|${o.orderDate}|${o.mealName}`));
        extra.orders.forEach(o => {
          const key = `${o.date}|${o.orderDate}|${o.mealName}`;
          if (!seen.has(key)) { seen.add(key); allOrders.push(o); }
        });
      }

      if (cacheKey && complete) setCachedScrape(cacheKey, { walletBalanceRaw, allOrders, complete });
    }

    return res.status(200).json({
      orders: allOrders,
      walletBalance: walletBalanceRaw, // number, or null when the page had no readable balance
      today,
      serverTime: now,
      complete,
    });
  } catch (err) {
    console.error('[dashboard]', err);
    return jsonError(res, 500, 'Server error: ' + err.message);
  }
}

export default instrument('dashboard', handler);
