import { load } from 'cheerio';
import { BASE_URL, USER_AGENT, cookieHeader, parsePrice, jsonError } from './_utils.js';

function determineStall(name) {
  const n = name.toLowerCase();
  if (n.includes('chinese')) return 'Chinese';
  if (n.includes('malay')) return 'Malay';
  if (n.includes('international')) return 'International';
  return 'Other';
}

function extractOrders(html) {
  const $ = load(html);
  const orders = [];
  const rows = $('table.woocommerce-orders-table tbody tr');

  rows.each((_, row) => {
    const $row = $(row);

    // Date — prefer delivery date column
    const deliDate = $row.find('td.woocommerce-orders-table__cell-order-date_deli').text().trim();
    const orderDate = $row.find('td.woocommerce-orders-table__cell-order-date').text().trim();
    const rawDate = deliDate || orderDate;

    const dateMatch = rawDate.match(/(\w+ \d+, \d{4})/);
    if (!dateMatch) return;

    // Parse "January 15, 2025" → "2025-01-15"
    const parsed = new Date(dateMatch[1]);
    if (isNaN(parsed)) return;
    const date = parsed.toISOString().slice(0, 10);

    const status = $row.find('td.woocommerce-orders-table__cell-order-status').text().trim();
    const totalText = $row.find('td.woocommerce-orders-table__cell-order-total').text();
    const price = parsePrice(totalText);
    if (price === null) return;

    const orderIdEl = $row.find('td.woocommerce-orders-table__cell-order-number a').first();
    const orderId = orderIdEl.text().trim();

    const itemsText = $row
      .find('td.woocommerce-orders-table__cell-order-items')
      .text()
      .replace(/[×x]\s*\d+/g, '')
      .trim();
    const mealName = itemsText || orderId.replace('#', '');

    const cancelUrl =
      $row.find('td.woocommerce-orders-table__cell-order-actions a.cancel').attr('href') || null;

    orders.push({
      orderId,
      date,
      status,
      price,
      mealName,
      stall: determineStall(mealName),
      cancelUrl,
    });
  });

  const hasNextPage = $('a.next.page-numbers').length > 0;
  return { orders, hasNextPage };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cookies = {}, page = 1 } = req.body || {};

  try {
    const url =
      page === 1 ? `${BASE_URL}/orders/` : `${BASE_URL}/orders/${page}/`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        ...(Object.keys(cookies).length ? { Cookie: cookieHeader(cookies) } : {}),
      },
    });

    if (!response.ok) {
      return jsonError(res, 502, `WooCommerce returned ${response.status}`);
    }

    const html = await response.text();

    if (html.includes('woocommerce-form-login')) {
      return jsonError(res, 401, 'Session expired', true);
    }

    const { orders, hasNextPage } = extractOrders(html);
    return res.status(200).json({ orders, hasNextPage, page });
  } catch (err) {
    console.error('[orders]', err);
    return jsonError(res, 500, 'Server error: ' + err.message);
  }
}
