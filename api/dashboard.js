import { load } from 'cheerio';
import { BASE_URL, USER_AGENT, cookieHeader, parsePrice, jsonError } from './_utils.js';

// Wallet balance selectors (primary → fallbacks)
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

function extractOrdersFromHtml(html) {
  const $ = load(html);
  const orders = [];
  $('table.woocommerce-orders-table tbody tr').each((_, row) => {
    const $row = $(row);
    const deliDate = $row.find('td.woocommerce-orders-table__cell-order-date_deli').text().trim();
    const orderDate = $row.find('td.woocommerce-orders-table__cell-order-date').text().trim();
    const rawDate = deliDate || orderDate;
    const dateMatch = rawDate.match(/(\w+ \d+, \d{4})/);
    if (!dateMatch) return;
    const parsed = new Date(dateMatch[1] + ' 12:00 UTC');
    if (isNaN(parsed)) return;
    const date = parsed.toISOString().slice(0, 10);

    const status = $row.find('td.woocommerce-orders-table__cell-order-status').text().trim();
    const totalText = $row.find('td.woocommerce-orders-table__cell-order-total').text();
    const price = parsePrice(totalText);
    if (price === null) return;

    const mealName = $row
      .find('td.woocommerce-orders-table__cell-order-items')
      .text()
      .replace(/[×x]\s*\d+/g, '')
      .trim();

    const cancelUrl =
      $row.find('td.woocommerce-orders-table__cell-order-actions a.cancel').attr('href') || null;

    orders.push({ date, status, price, mealName, cancelUrl });
  });

  const hasNextPage = $('a.next.page-numbers').length > 0;
  return { orders, hasNextPage };
}

async function fetchAllOrdersForMonth(cookies, month) {
  const allOrders = [];
  let page = 1;
  let consecutiveEmpty = 0;
  const MAX_PAGES = 50;
  const cookieStr = Object.keys(cookies).length ? cookieHeader(cookies) : '';

  while (page <= MAX_PAGES) {
    const url = page === 1 ? `${BASE_URL}/orders/` : `${BASE_URL}/orders/${page}/`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...(cookieStr ? { Cookie: cookieStr } : {}) },
    });
    if (!res.ok) break;
    const html = await res.text();
    const { orders, hasNextPage } = extractOrdersFromHtml(html);
    if (orders.length === 0) break;

    allOrders.push(...orders);
    const hasMonthOrders = orders.some((o) => o.date.startsWith(month));
    if (!hasMonthOrders) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) break;
    } else {
      consecutiveEmpty = 0;
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
    // Fetch wallet and first orders page in parallel
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

    // Collect enough orders for the current month
    // Use SGT (UTC+8) for "today"
    const nowSGT = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const today = nowSGT.toISOString().slice(0, 10);
    const currentMonth = today.slice(0, 7); // "YYYY-MM"

    // Start with the first page already fetched, then fetch more if needed
    const { orders: page1Orders, hasNextPage } = extractOrdersFromHtml(ordersHtml);

    let allOrders = [...page1Orders];
    if (hasNextPage) {
      const extra = await fetchAllOrdersForMonth(cookies, currentMonth);
      // Merge without duplicates (by date+mealName combo)
      const seen = new Set(allOrders.map((o) => `${o.date}|${o.mealName}`));
      extra.forEach((o) => {
        const key = `${o.date}|${o.mealName}`;
        if (!seen.has(key)) {
          seen.add(key);
          allOrders.push(o);
        }
      });
    }

    // Today's meal
    const todaysMeal = allOrders.find((o) => o.date === today) || null;

    // Upcoming meals: next 7 days (excluding today) with orders
    const in7Days = new Date();
    in7Days.setDate(in7Days.getDate() + 7);
    const max7 = in7Days.toISOString().slice(0, 10);
    const upcomingMeals = allOrders
      .filter((o) => o.date > today && o.date <= max7)
      .sort((a, b) => a.date.localeCompare(b.date));

    // Monthly spend stats
    const normalize = (s) => s.toLowerCase().replace(/[-\s]/g, '');
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
