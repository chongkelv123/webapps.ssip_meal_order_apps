import { load } from 'cheerio';
import { BASE_URL, USER_AGENT, cookieHeader, parsePrice, jsonError } from './_utils.js';

const WALLET_SELECTORS = [
  '.woo-wallet-content-heading p span bdi',
  '.woo-wallet-my-wallet-container bdi',
  '.woo-wallet-balance bdi',
  'bdi',
];

function extractWalletBalance(html) {
  const $ = load(html);
  for (const sel of WALLET_SELECTORS) {
    const els = $(sel);
    let found = null;
    els.each((_, el) => {
      const text = $(el).text();
      if (text.includes('$') && found === null) {
        const p = parsePrice(text);
        if (p !== null) found = p;
      }
    });
    if (found !== null) return found;
  }
  return 0;
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

    // Delivery date — used for upcoming meals detection
    const deliDateText = $row.find('td.woocommerce-orders-table__cell-order-date_deli').text().trim();
    // Order placed date — used for monthly stats and today's meal
    const orderDateText = $row.find('td.woocommerce-orders-table__cell-order-date').text().trim();

    const deliveryDate = parseDate(deliDateText) || parseDate(orderDateText);
    if (!deliveryDate) return;

    const orderDate = parseDate(orderDateText) || deliveryDate;

    const status = $row.find('td.woocommerce-orders-table__cell-order-status').text().trim();
    const totalText = $row.find('td.woocommerce-orders-table__cell-order-total').text();
    const price = parsePrice(totalText);
    if (price === null) return;

    // Prefer the product link text; fall back to stripping quantity (handles decimals like × 0.80)
    const $itemsCell = $row.find('td.woocommerce-orders-table__cell-order-items');
    const mealName =
      $itemsCell.find('a').first().text().trim() ||
      $itemsCell.text().replace(/[×x]\s*[\d.]+/g, '').trim();

    const cancelUrl =
      $row.find('td.woocommerce-orders-table__cell-order-actions a.cancel').attr('href') || null;

    orders.push({ date: deliveryDate, orderDate, status, price, mealName, cancelUrl });
  });

  // This theme uses woocommerce-button--next, not the default "next page-numbers"
  const hasNextPage = $('a.woocommerce-button--next').length > 0;
  return { orders, hasNextPage };
}

// Fetch pages 2+ (page 1 already fetched by caller)
async function fetchRemainingPages(cookies, currentMonth) {
  const allOrders = [];
  let page = 2;
  let consecutiveNoMonth = 0;
  const MAX_PAGES = 50;
  const cookieStr = Object.keys(cookies).length ? cookieHeader(cookies) : '';

  while (page <= MAX_PAGES) {
    const url = `${BASE_URL}/orders/${page}/`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...(cookieStr ? { Cookie: cookieStr } : {}) },
    });
    if (!res.ok) break;
    const html = await res.text();
    const { orders, hasNextPage } = extractOrdersFromHtml(html);
    if (orders.length === 0) break;

    allOrders.push(...orders);

    // Stop early if 2 consecutive pages have no orders for this month (by order date)
    const hasMonthOrders = orders.some((o) => o.date.startsWith(currentMonth));
    if (!hasMonthOrders) {
      consecutiveNoMonth++;
      if (consecutiveNoMonth >= 2) break;
    } else {
      consecutiveNoMonth = 0;
    }

    if (!hasNextPage) break;
    page++;
  }
  return allOrders;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cookies = {} } = req.body || {};
  const cookieStr = Object.keys(cookies).length ? cookieHeader(cookies) : '';

  try {
    const [walletRes, ordersRes] = await Promise.all([
      fetch(`${BASE_URL}/woo-wallet/`, {
        headers: { 'User-Agent': USER_AGENT, ...(cookieStr ? { Cookie: cookieStr } : {}) },
      }),
      fetch(`${BASE_URL}/orders/`, {
        headers: { 'User-Agent': USER_AGENT, ...(cookieStr ? { Cookie: cookieStr } : {}) },
      }),
    ]);

    if (walletRes.status === 302 || ordersRes.status === 302) {
      return jsonError(res, 401, 'Session expired', true);
    }

    const walletHtml = await walletRes.text();
    const ordersHtml = await ordersRes.text();

    if (walletHtml.includes('woocommerce-form-login')) {
      return jsonError(res, 401, 'Session expired', true);
    }

    const walletBalance = extractWalletBalance(walletHtml);

    const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const today = nowSGT.toISOString().slice(0, 10);
    const currentMonth = today.slice(0, 7);

    const { orders: page1Orders, hasNextPage } = extractOrdersFromHtml(ordersHtml);

    let allOrders = [...page1Orders];
    if (hasNextPage) {
      const extra = await fetchRemainingPages(cookies, currentMonth);
      const seen = new Set(allOrders.map((o) => `${o.orderDate}|${o.mealName}`));
      extra.forEach((o) => {
        const key = `${o.orderDate}|${o.mealName}`;
        if (!seen.has(key)) {
          seen.add(key);
          allOrders.push(o);
        }
      });
    }

    const normalize = (s) => s.toLowerCase().replace(/[-\s]/g, '');

    // Today's meal: on-hold order with delivery date = today (matches Android behaviour)
    const todaysMeal =
      allOrders.find((o) => o.date === today && normalize(o.status).includes('onhold')) ?? null;

    // Upcoming meals: on-hold orders delivered in the remaining days of the current month
    const lastDayOfMonth = new Date(Date.UTC(
      parseInt(currentMonth.slice(0, 4)),
      parseInt(currentMonth.slice(5, 7)), // month+1 → day 0 = last day of current month
      0
    ));
    const endOfMonth = lastDayOfMonth.toISOString().slice(0, 10);
    const upcomingMeals = allOrders
      .filter((o) => o.date > today && o.date <= endOfMonth && normalize(o.status).includes('onhold'))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Monthly spend stats — filter by delivery date month (matches Android behaviour)
    const plannedSpend = allOrders
      .filter((o) => o.date.startsWith(currentMonth) && normalize(o.status).includes('onhold'))
      .reduce((sum, o) => sum + o.price, 0);

    const actualSpend = allOrders
      .filter(
        (o) =>
          o.date.startsWith(currentMonth) &&
          (normalize(o.status).includes('completemp') || normalize(o.status).includes('completed'))
      )
      .reduce((sum, o) => sum + o.price, 0);

    return res.status(200).json({
      walletBalance,
      todaysMeal,
      upcomingMeals,
      plannedSpend,
      actualSpend,
      currentMonth,
    });
  } catch (err) {
    console.error('[dashboard]', err);
    return jsonError(res, 500, 'Server error: ' + err.message);
  }
}
