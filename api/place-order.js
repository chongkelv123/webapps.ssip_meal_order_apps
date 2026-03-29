import { load } from 'cheerio';
import {
  BASE_URL,
  USER_AGENT,
  cookieHeader,
  extractCookies,
  dateToUnixTimestamp,
  jsonError,
} from './_utils.js';

const CHECKOUT_URL = `${BASE_URL}/checkout/`;
const CHECKOUT_AJAX_URL = `${BASE_URL}/?wc-ajax=checkout`;

async function addToCart(productId, date, cookies) {
  const formData = new URLSearchParams({
    'add-to-cart': productId,
    quantity: '1',
    deli_date: date,
  });

  const url = `${BASE_URL}/lunch/?menu-date=${date}`;
  const cookieStr = cookieHeader(cookies);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Cookie: cookieStr,
      Origin: BASE_URL,
      Referer: url,
    },
    body: formData.toString(),
    redirect: 'manual',
  });

  // Capture any updated session cookies from WooCommerce
  extractCookies(res, cookies);

  // Success is anything non-5xx (WooCommerce returns 302 redirect on success)
  return res.status < 500;
}

async function checkout(date, orderDetails, cookies) {
  const cookieStr = cookieHeader(cookies);

  // Step 1: Fetch checkout page for hidden fields (_wpnonce, etc.)
  const getRes = await fetch(CHECKOUT_URL, {
    headers: { 'User-Agent': USER_AGENT, Cookie: cookieStr },
    redirect: 'follow',
  });

  extractCookies(getRes, cookies);
  const checkoutHtml = await getRes.text();

  if (checkoutHtml.includes('woocommerce-form-login')) {
    throw new Error('SESSION_EXPIRED');
  }

  const $ = load(checkoutHtml);
  const hiddenFields = {};

  $('form[name=checkout] input[type=hidden]').each((_, el) => {
    const name = $(el).attr('name');
    const value = $(el).attr('value') || '';
    if (name) hiddenFields[name] = value;
  });

  // Step 2: Build and submit checkout form
  const now = new Date();
  const sessionStartTime = now.toISOString();

  const formData = new URLSearchParams({
    wc_order_attribution_source_type: 'typein',
    wc_order_attribution_referrer: '(none)',
    wc_order_attribution_utm_campaign: '(none)',
    wc_order_attribution_utm_source: '(direct)',
    wc_order_attribution_utm_medium: '(none)',
    wc_order_attribution_session_entry: `${BASE_URL}/`,
    wc_order_attribution_session_start_time: sessionStartTime,
    wc_order_attribution_session_pages: '5',
    wc_order_attribution_session_count: '1',
    wc_order_attribution_user_agent: USER_AGENT,
    billing_first_name: orderDetails.firstName,
    billing_last_name: orderDetails.lastName,
    billing_phone: orderDetails.phone,
    billing_email: orderDetails.email,
    exwfood_date_deli: dateToUnixTimestamp(date),
    exwfood_time_deli: orderDetails.deliveryTime || '',
    order_comments: orderDetails.orderNotes || orderDetails.deliveryTime || '',
    payment_method: 'bacs',
    ...hiddenFields,
  });

  const postRes = await fetch(CHECKOUT_AJAX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Cookie: cookieHeader(cookies),
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE_URL,
      Referer: CHECKOUT_URL,
    },
    body: formData.toString(),
  });

  extractCookies(postRes, cookies);

  const text = await postRes.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON from checkout: ' + text.slice(0, 200));
  }

  if (json.result === 'success') {
    return { success: true, orderId: json.order_id || 'unknown' };
  }

  const msg = json.messages
    ? load(json.messages).text().trim()
    : JSON.stringify(json);
  return { success: false, error: msg };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cookies: rawCookies = {}, productId, date, orderDetails } = req.body || {};

  if (!productId || !date || !orderDetails) {
    return jsonError(res, 400, 'productId, date, and orderDetails are required');
  }
  if (!orderDetails.firstName || !orderDetails.lastName || !orderDetails.phone || !orderDetails.email) {
    return jsonError(res, 400, 'Complete order details (name, phone, email) are required');
  }

  // Work on a mutable copy of cookies so we can capture updates
  const cookies = { ...rawCookies };

  try {
    const cartOk = await addToCart(productId, date, cookies);
    if (!cartOk) {
      return res.status(200).json({ success: false, error: 'Failed to add meal to cart' });
    }

    const result = await checkout(date, orderDetails, cookies);
    return res.status(200).json(result);
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') {
      return jsonError(res, 401, 'Session expired', true);
    }
    console.error('[place-order]', err);
    return jsonError(res, 500, 'Server error: ' + err.message);
  }
}
