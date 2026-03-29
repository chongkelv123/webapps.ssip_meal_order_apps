import { load } from 'cheerio';
import { BASE_URL, USER_AGENT, extractCookies, cookieHeader, fetchFollowing } from './_utils.js';

const LOGIN_URL = `${BASE_URL}/my-account/`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const cookieJar = {};

    // Step 1: GET login page — follow redirects so we always land on the actual form
    const { text: loginHtml } = await fetchFollowing(LOGIN_URL, {
      headers: { 'User-Agent': USER_AGENT },
    }, cookieJar);
    const $ = load(loginHtml);

    const loginForm =
      $('form.woocommerce-form-login').length
        ? $('form.woocommerce-form-login')
        : $('form').first();

    if (!loginForm.length) {
      return res.status(500).json({ error: 'Could not find login form on WooCommerce page' });
    }

    const hiddenFields = {};
    loginForm.find('input[type=hidden]').each((_, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') || '';
      if (name) hiddenFields[name] = value;
    });

    // Step 2: POST credentials + hidden fields
    const formAction = loginForm.attr('action') || LOGIN_URL;
    const formData = new URLSearchParams({
      username,
      password,
      login: 'Log in',
      ...hiddenFields,
    });

    const { text: responseHtml, cookies } = await fetchFollowing(
      formAction,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': BASE_URL,
          'Referer': LOGIN_URL,
        },
        body: formData.toString(),
      },
      cookieJar
    );

    // Verify login success: logged-in page has logout link but no login form
    const loginSuccess =
      (responseHtml.includes('logout') ||
        responseHtml.includes('dashboard') ||
        responseHtml.includes('my-account')) &&
      !responseHtml.includes('woocommerce-form-login');

    if (!loginSuccess) {
      const $resp = load(responseHtml);
      const errorMsg =
        $resp('.woocommerce-error li').first().text().trim() ||
        'Invalid username or password';
      return res.status(401).json({ error: errorMsg });
    }

    return res.status(200).json({ cookies });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
