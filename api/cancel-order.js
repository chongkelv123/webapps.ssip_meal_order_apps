import { USER_AGENT, cookieHeader, fetchFollowing, jsonError } from './_utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cookies = {}, cancelUrl } = req.body || {};
  if (!cancelUrl) return jsonError(res, 400, 'cancelUrl is required');

  // Basic URL safety check — only allow our WooCommerce domain
  if (!cancelUrl.startsWith('https://ssip-cafeteria.whew.life/')) {
    return jsonError(res, 400, 'Invalid cancel URL');
  }

  try {
    const { res: wcRes, text } = await fetchFollowing(
      cancelUrl,
      { method: 'GET', headers: { 'User-Agent': USER_AGENT } },
      { ...cookies }
    );

    if (text.includes('woocommerce-form-login')) {
      return jsonError(res, 401, 'Session expired', true);
    }

    // WooCommerce shows a success notice after cancellation
    const success =
      text.includes('cancelled') ||
      text.includes('Order cancelled') ||
      wcRes.status < 400;

    return res.status(200).json({ success });
  } catch (err) {
    console.error('[cancel-order]', err);
    return jsonError(res, 500, 'Server error: ' + err.message);
  }
}
