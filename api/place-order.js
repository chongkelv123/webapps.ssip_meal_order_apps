import { load } from 'cheerio';
import {
  BASE_URL,
  USER_AGENT,
  cookieHeader,
  extractCookies,
  fetchFollowing,
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

  // Follow the 302 redirect so we capture any session-cookie updates that
  // WooCommerce sets on the redirect target (not just the 302 itself).
  const { res } = await fetchFollowing(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: BASE_URL,
        Referer: url,
      },
      body: formData.toString(),
    },
    cookies,
  );

  return res.status < 500;
}

async function checkout(date, orderDetails, cookies) {
  // Step 1: Fetch checkout page, following any redirects so every
  // Set-Cookie hop is captured into `cookies`.
  const { text: checkoutHtml } = await fetchFollowing(CHECKOUT_URL, {}, cookies);

  if (checkoutHtml.includes('woocommerce-form-login')) {
    throw new Error('SESSION_EXPIRED');
  }

  const $ = load(checkoutHtml);

  // Guard: if WooCommerce redirected us away from checkout (e.g. cart is empty),
  // the form won't exist and we'd submit without a nonce.
  const $form = $('form[name=checkout], form.woocommerce-checkout').first();
  if (!$form.length) {
    console.error('[place-order] Checkout form not found — cart may be empty. Snippet:', checkoutHtml.slice(0, 300));
    return { success: false, error: 'Could not load checkout page (cart may be empty after add-to-cart)' };
  }

  const hiddenFields = {};

  $form.find('input[type=hidden]').each((_, el) => {
    const name = $(el).attr('name');
    const value = $(el).attr('value') || '';
    if (name) hiddenFields[name] = value;
  });

  // Some themes/plugins place the nonce outside the <form>; search globally as fallback.
  for (const nonceName of ['woocommerce-process-checkout-nonce', '_wpnonce']) {
    if (!hiddenFields[nonceName]) {
      const val = $(`input[name="${nonceName}"]`).first().attr('value');
      if (val) hiddenFields[nonceName] = val;
    }
  }

  console.log('[place-order] Hidden fields:', Object.keys(hiddenFields).join(', ') || '(none)');

  // ── Resolve exwfood delivery date & time ───────────────────────────────────
  const exwfoodDate = dateToUnixTimestamp(date);

  // The exwfood_time_deli <select> is always empty in raw HTML — the plugin fills
  // it via an AJAX call after the user picks a date.  We need to call that same
  // endpoint ourselves to get real option values for the chosen date.
  let exwfoodTime = orderDetails.deliveryTime || '';

  // 1. Find the exwfood AJAX config in inline scripts (wp_localize_script output).
  let exwfAjaxUrl = `${BASE_URL}/wp-admin/admin-ajax.php`;
  let exwfNonce = '';
  let exwfAction = '';

  $('script').each((_, el) => {
    const src = $(el).html() || '';
    if (!src.includes('exwf')) return;
    // Match: var <name> = { ... "ajax_url": "...", "nonce": "..." ... }
    const objMatch = src.match(/var\s+\w+\s*=\s*\{([\s\S]+?)\};/);
    if (!objMatch) return;
    const inner = objMatch[1];
    const urlM = inner.match(/"ajax_url"\s*:\s*"([^"]+)"/);
    const nonceM = inner.match(/"nonce"\s*:\s*"([^"]+)"/);
    const actionM = inner.match(/"action"\s*:\s*"([^"]+)"/);
    if (urlM) exwfAjaxUrl = urlM[1].replace(/\\\//g, '/');
    if (nonceM) exwfNonce = nonceM[1];
    if (actionM) exwfAction = actionM[1];
  });

  console.log('[place-order] exwfood nonce:', exwfNonce || '(not found)', '| action hint:', exwfAction || '(none)');

  // 2. Call the time-slot endpoint, trying common action names.
  const candidateActions = exwfAction
    ? [exwfAction]
    : ['exwfood_check_time', 'exwf_check_time', 'exwfood_get_time', 'exwf_get_time', 'exwfood_get_timeslot'];

  for (const action of candidateActions) {
    try {
      const tsRes = await fetch(exwfAjaxUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Cookie: cookieHeader(cookies),
        },
        body: new URLSearchParams({ action, date: exwfoodDate, security: exwfNonce }).toString(),
      });
      const tsText = await tsRes.text();
      console.log('[place-order] time-slot action=' + action + ' →', tsText.slice(0, 200));

      if (!tsText || tsText === '0' || tsText === '-1') continue;

      // Response is HTML <option> elements; parse them.
      const $opts = load(tsText);
      const timeOpts = [];
      $opts('option').each((_, o) => {
        const v = $opts(o).attr('value');
        const t = $opts(o).text().trim();
        if (v) timeOpts.push({ value: v, text: t });
      });

      if (!timeOpts.length) continue;

      console.log('[place-order] Available time slots:', JSON.stringify(timeOpts));
      const match = timeOpts.find(
        (o) => o.text === orderDetails.deliveryTime || o.value === orderDetails.deliveryTime,
      );
      exwfoodTime = match ? match.value : timeOpts[0].value;
      console.log('[place-order] Using time slot value:', exwfoodTime);
      break;
    } catch (e) {
      console.log('[place-order] action=' + action + ' failed:', e.message);
    }
  }

  console.log('[place-order] Submitting exwfood_date_deli:', exwfoodDate, '| exwfood_time_deli:', exwfoodTime);

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
    payment_method: 'bacs',
    ...hiddenFields,
    // These must come after hiddenFields so they are not overridden by
    // empty default hidden inputs the checkout page may render for these fields.
    billing_first_name: orderDetails.firstName,
    billing_last_name: orderDetails.lastName,
    billing_phone: orderDetails.phone,
    billing_email: orderDetails.email,
    exwfood_date_deli: exwfoodDate,
    exwfood_time_deli: exwfoodTime,
    order_comments: orderDetails.orderNotes || orderDetails.deliveryTime || '',
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
  console.error('[place-order] checkout failed:', msg, '| raw:', JSON.stringify(json).slice(0, 500));
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
