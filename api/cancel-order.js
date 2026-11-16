import { load } from 'cheerio';
import { fetchFollowing, jsonError, sendIfBlocked, instrument } from './_utils.js';

/**
 * Decide whether the page WooCommerce lands on after a cancel request shows
 * the order as cancelled. A block page throws earlier (BlockedError), so this
 * only sees real pages. Success needs positive evidence:
 *  - a success/info notice mentioning the cancellation, or
 *  - an orders table that no longer offers the cancel link for this order
 *    (matched by the order key in the cancel URL).
 * Any error notice, or a page that is neither, is a failure. The old check
 * (`status < 400`, or the word "cancelled" anywhere, e.g. another order's
 * status) reported success for pages that proved nothing.
 */
export function cancelSucceeded(html, cancelUrl) {
  const $ = load(html);
  if ($('.woocommerce-error').length) return false;

  const notice = $('.woocommerce-message, .woocommerce-info').text();
  if (/cancel/i.test(notice)) return true;

  if (!$('table.woocommerce-orders-table').length) return false;
  let orderKey = null;
  try {
    orderKey = new URL(cancelUrl).searchParams.get('order');
  } catch { /* invalid URL: no key */ }
  if (!orderKey) return false;
  const stillCancellable = $('a.cancel')
    .toArray()
    .some((a) => ($(a).attr('href') || '').includes(orderKey));
  return !stillCancellable;
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cookies = {}, cancelUrl } = req.body || {};
  if (!cancelUrl) return jsonError(res, 400, 'cancelUrl is required');

  // Basic URL safety check — only allow our WooCommerce domain
  if (!cancelUrl.startsWith('https://ssip-cafeteria.whew.life/')) {
    return jsonError(res, 400, 'Invalid cancel URL');
  }

  try {
    const { res: wcRes, text } = await fetchFollowing(cancelUrl, { method: 'GET' }, { ...cookies });

    if (text.includes('woocommerce-form-login')) {
      return jsonError(res, 401, 'Session expired', true);
    }

    const success = wcRes.ok && cancelSucceeded(text, cancelUrl);
    if (!success) console.error('[cancel-order] no cancellation confirmed', { status: wcRes.status });

    return res.status(200).json({ success });
  } catch (err) {
    if (sendIfBlocked(res, err)) return;
    console.error('[cancel-order]', err);
    return jsonError(res, 500, 'Server error: ' + err.message);
  }
}

export default instrument('cancel-order', handler);
