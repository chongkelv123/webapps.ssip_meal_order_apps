import { load } from 'cheerio';
import { BASE_URL, USER_AGENT, cookieHeader, jsonError } from './_utils.js';

const MAX_MEALS = 6;
const MIN_PRICE = 2.0;
const MAX_PRICE = 15.0;

function determineStall(name) {
  const n = name.toLowerCase();
  if (n.includes('chinese') || n.includes('economic rice') || n.includes('vegetarian')) return 'Chinese';
  if (n.includes('malay') || n.includes('nasi padang') || n.includes('nasi')) return 'Malay';
  if (n.includes('international') || n.includes('japanese') || n.includes('pasta')) return 'International';
  return 'Other';
}

function parsePrice(text) {
  const match = text.match(/\$(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

function findProductContainer(el, $) {
  let current = el;
  for (let i = 0; i < 8; i++) {
    if (!current) break;
    const cls = $(current).attr('class') || '';
    const tag = (current.tagName || '').toLowerCase();
    if (
      cls.includes('product') ||
      cls.includes('woocommerce-LoopProduct') ||
      (tag === 'li' && cls.includes('type-product'))
    ) {
      return $(current);
    }
    current = current.parent;
  }
  return null;
}

function extractImageUrl($container) {
  const strategies = [
    () => $container.find('a.woocommerce-LoopProduct-link img').first(),
    () => $container.find('.attachment-woocommerce_thumbnail').first(),
    () => $container.find('img[class*=woocommerce]').first(),
    () => $container.find('img').first(),
  ];

  for (const strategy of strategies) {
    const img = strategy();
    if (!img.length) continue;

    const src = img.attr('src') || '';
    const dataSrc = img.attr('data-src') || '';
    const srcset = (img.attr('srcset') || '').split(',')[0]?.trim().split(' ')[0] || '';

    const url =
      (!src.includes('placeholder') && !src.includes('lazy') ? src : '') ||
      dataSrc ||
      srcset;

    if (url) {
      return url.startsWith('http') ? url : `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
    }
  }
  return null;
}

function extractMeals(html) {
  const $ = load(html, { baseURI: BASE_URL });
  const meals = [];

  const buttons = $('button[name="add-to-cart"]');

  buttons.each((_, btn) => {
    const productId = $(btn).attr('value');
    if (!productId) return;

    const container = findProductContainer(btn.parent, $);
    const $container = container || $(btn).closest('li, article, div.product');

    // Extract name — prefer the WooCommerce title element
    let name =
      $container.find('.woocommerce-loop-product__title, .product_title').first().text().trim();

    // Fallback: keyword scan of container text
    if (!name) {
      const text = $container.text().replace(/\s+/g, ' ').trim();
      const keywords = ['STALL', 'SET', 'CHINESE', 'MALAY', 'NASI', 'RICE', 'VEGETARIAN', 'INTERNATIONAL', 'JAPANESE', 'PASTA'];
      for (const kw of keywords) {
        const idx = text.toUpperCase().indexOf(kw);
        if (idx !== -1) {
          name = text.substring(Math.max(0, idx - 20), Math.min(text.length, idx + 60)).trim();
          break;
        }
      }
    }

    if (!name) return;

    // Extract price
    let price = null;
    const priceSpan = $container.find('span.woocommerce-Price-amount bdi').first();
    if (priceSpan.length) {
      price = parsePrice(priceSpan.text());
    }
    if (price === null) {
      price = parsePrice($container.text());
    }
    if (price === null || price < MIN_PRICE || price > MAX_PRICE) return;

    // Extract image
    const imageUrl = extractImageUrl($container);

    meals.push({ productId, name: name.trim(), price, stall: determineStall(name), imageUrl });
  });

  // Deduplicate by name+price
  const seen = new Set();
  return meals
    .filter((m) => {
      const key = `${m.name}|${m.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_MEALS);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cookies = {}, date } = req.body || {};
  if (!date) return jsonError(res, 400, 'date is required');

  try {
    const url = `${BASE_URL}/lunch/?menu-date=${date}`;
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

    // Detect session expiry
    if (html.includes('woocommerce-form-login')) {
      return jsonError(res, 401, 'Session expired', true);
    }

    const meals = extractMeals(html);
    return res.status(200).json({ meals });
  } catch (err) {
    console.error('[meals]', err);
    return jsonError(res, 500, 'Server error: ' + err.message);
  }
}
