import { load } from 'cheerio';
import { BASE_URL, USER_AGENT, cookieHeader, parsePrice, jsonError } from './_utils.js';

// ─── Billing period ──────────────────────────────────────────────────────────

/**
 * Returns the billing period that contains todayStr (yyyy-MM-dd).
 * Periods run from the 27th of one month to the 26th of the next and are
 * labelled by the month they end in (e.g. Jul 27 – Aug 26 → "August 2026").
 *
 * Direct port of DateUtil.getBillingPeriod() / billingPeriodOf() from the
 * Android codebase.
 */
function getBillingPeriod(todayStr) {
  const [year, month, day] = todayStr.split('-').map(Number);
  const CUTOFF = 27;
  const pad = (n) => String(n).padStart(2, '0');

  let startYear, startMonth, endYear, endMonth;

  if (day >= CUTOFF) {
    // Period starts this month on the 27th, ends next month on the 26th.
    startYear  = year;
    startMonth = month;
    endYear    = month === 12 ? year + 1 : year;
    endMonth   = month === 12 ? 1        : month + 1;
  } else {
    // Period started last month on the 27th, ends this month on the 26th.
    startYear  = month === 1 ? year - 1 : year;
    startMonth = month === 1 ? 12       : month - 1;
    endYear    = year;
    endMonth   = month;
  }

  const start = `${startYear}-${pad(startMonth)}-27`;
  const end   = `${endYear}-${pad(endMonth)}-26`;

  // Label is the month the period ends in, e.g. "August 2026".
  const endDate = new Date(Date.UTC(endYear, endMonth - 1, 1));
  const label   = endDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return { start, end, label };
}

// ─── Status helpers (mirrors OrderStatusClassifier.kt) ───────────────────────

const normalizeStatus = (s) => s.toLowerCase().replace(/[-\s]/g, '');
const isOnHold        = (s) => normalizeStatus(s).includes('onhold');
const isCompleteMp    = (s) => normalizeStatus(s).includes('completemp');

// ─── Domain helpers ──────────────────────────────────────────────────────────

/**
 * Days in [periodStart, todayStr) with an on-hold booking but no CompleteMP
 * tap-in, excluding exemptDates.
 *
 * Port of OrderScraper.findMissedMealDays().
 */
function findMissedMealDays(orders, periodStart, todayStr, exemptDates) {
  const inRange = orders.filter(o => o.date >= periodStart && o.date < todayStr);

  const completedDates = new Set(
    inRange.filter(o => isCompleteMp(o.status)).map(o => o.date)
  );

  const bookingsByDate = {};
  for (const o of inRange) {
    if (isOnHold(o.status)) {
      if (!bookingsByDate[o.date]) bookingsByDate[o.date] = [];
      bookingsByDate[o.date].push(o);
    }
  }

  return Object.entries(bookingsByDate)
    .filter(([date]) => !completedDates.has(date) && !exemptDates.has(date))
    .map(([date, bookings]) => {
      // UTC noon avoids any timezone day-boundary shift when deriving the weekday.
      const dayName = new Date(date + 'T12:00:00Z')
        .toLocaleDateString('en-US', { weekday: 'long' });
      return { date, dayName, mealName: bookings[0].mealName, bookedPrice: bookings[0].price };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Classifies the spend for a billing period into three buckets:
 *   collectedCharges  – sum of CompleteMP rows
 *   missedDays        – booked days before today with no tap-in
 *   upcomingCommitment – future on-hold bookings (one booking per day)
 *
 * Port of OrderScraper.calculatePeriodSpend().
 */
function calculatePeriodSpend(orders, start, end, todayStr, exemptDates) {
  const inPeriod = orders.filter(o => o.date >= start && o.date <= end);

  const collectedCharges = inPeriod
    .filter(o => isCompleteMp(o.status))
    .reduce((sum, o) => sum + o.price, 0);

  const missedDays = findMissedMealDays(inPeriod, start, todayStr, exemptDates);

  const completedDates = new Set(
    inPeriod.filter(o => isCompleteMp(o.status)).map(o => o.date)
  );

  // One booking per future day — the same "first wins" rule findMissedMealDays uses.
  const futureByDate = {};
  for (const o of inPeriod) {
    if (isOnHold(o.status) && o.date >= todayStr && !completedDates.has(o.date)) {
      if (!futureByDate[o.date]) futureByDate[o.date] = o;
    }
  }
  const upcomingCommitment = Object.values(futureByDate)
    .reduce((sum, o) => sum + o.price, 0);

  return { collectedCharges, missedDays, upcomingCommitment };
}

/**
 * Budget status for one period. All arithmetic is done in whole cents so the
 * "exactly on budget" boundary never produces a false OVER verdict.
 *
 * Port of BudgetCalculator.status() from the Android codebase.
 */
function computeBudgetStatus(budget, collectedCharges, missedDays, missedMealRate, upcoming, period) {
  const cents  = (n) => Math.round(n * 100);
  const dollars = (c) => c / 100;

  const missedDayCount = missedDays.length;
  const missedCharges  = dollars(missedDayCount * cents(missedMealRate));

  const budgetCents    = cents(budget);
  const projectedCents = cents(collectedCharges) + cents(missedCharges) + cents(upcoming);

  const fraction = budgetCents > 0
    ? projectedCents / budgetCents
    : projectedCents > 0 ? 1.0 : 0.0;

  const NEAR_THRESHOLD = 0.8;
  const level = projectedCents > budgetCents  ? 'OVER'
              : budgetCents <= 0              ? 'UNDER'
              : fraction >= NEAR_THRESHOLD    ? 'NEAR'
                                             : 'UNDER';

  return {
    budget,
    collectedCharges,
    missedCharges,
    missedDayCount,
    missedMealRate,
    upcoming,
    projected: dollars(projectedCents),
    remaining: dollars(Math.max(0, budgetCents - projectedCents)),
    overBy:    dollars(Math.max(0, projectedCents - budgetCents)),
    fraction,
    level,
    isOver: level === 'OVER',
    period,
  };
}

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

// ─── Pagination ──────────────────────────────────────────────────────────────

/**
 * Fetches pages 2+ and stops early once two consecutive pages contain no
 * orders on or after billingPeriodStart.
 *
 * Using billingPeriodStart (the 27th of last month) rather than the calendar
 * month ensures we never stop before we have all the orders the dashboard
 * needs, even when today is only a few days into a new month.
 */
async function fetchRemainingPages(cookies, billingPeriodStart) {
  const allOrders = [];
  let page = 2;
  let consecutiveOutOfRange = 0;
  const MAX_PAGES = 50;
  const cookieStr = Object.keys(cookies).length ? cookieHeader(cookies) : '';

  while (page <= MAX_PAGES) {
    const url = `${BASE_URL}/orders/${page}/`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...(cookieStr ? { Cookie: cookieStr } : {}) },
    });
    if (!res.ok) break;

    const html                    = await res.text();
    const { orders, hasNextPage } = extractOrdersFromHtml(html);
    if (orders.length === 0) break;

    allOrders.push(...orders);

    const hasPeriodOrders = orders.some(o => o.date >= billingPeriodStart);
    consecutiveOutOfRange = hasPeriodOrders ? 0 : consecutiveOutOfRange + 1;
    if (consecutiveOutOfRange >= 2) break;
    if (!hasNextPage) break;
    page++;
  }

  return allOrders;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    cookies        = {},
    missedMealRate = 4.50,
    monthlyBudget  = 100.00,
    budgetEnabled  = true,
    exemptDates    = [],
  } = req.body || {};

  const cookieStr = Object.keys(cookies).length ? cookieHeader(cookies) : '';
  const exemptSet = new Set(exemptDates);

  try {
    // "Today" in SGT (UTC+8) — the cafeteria is in Singapore/Malaysia.
    const nowSGT     = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const today      = nowSGT.toISOString().slice(0, 10);
    const currentMonth = today.slice(0, 7);

    const { start: billingPeriodStart, end: billingPeriodEnd, label: billingPeriodLabel } =
      getBillingPeriod(today);

    // Fetch wallet page and first orders page in parallel.
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

    const walletBalanceRaw       = extractWalletBalance(walletHtml);
    const walletBalance          = walletBalanceRaw ?? 0;
    const walletBalanceAvailable = walletBalanceRaw !== null;

    const { orders: page1Orders, hasNextPage } = extractOrdersFromHtml(ordersHtml);
    let allOrders = [...page1Orders];

    if (hasNextPage) {
      const extra = await fetchRemainingPages(cookies, billingPeriodStart);
      const seen  = new Set(allOrders.map(o => `${o.orderDate}|${o.mealName}`));
      extra.forEach(o => {
        const key = `${o.orderDate}|${o.mealName}`;
        if (!seen.has(key)) { seen.add(key); allOrders.push(o); }
      });
    }

    // ── Period spend classification ────────────────────────────────────────────
    const { collectedCharges, missedDays, upcomingCommitment } = calculatePeriodSpend(
      allOrders, billingPeriodStart, billingPeriodEnd, today, exemptSet
    );

    const plannedSpend = upcomingCommitment; // future on-hold bookings = "Planned"
    const actualSpend  = collectedCharges;   // CompleteMP tap-ins only = "Actual"

    // ── Actual balance ────────────────────────────────────────────────────────
    const centsOf       = (n) => Math.round(n * 100);
    const actualBalance =
      (centsOf(walletBalance) - missedDays.length * centsOf(missedMealRate)) / 100;

    // ── Budget status ─────────────────────────────────────────────────────────
    const budgetStatus = budgetEnabled
      ? computeBudgetStatus(
          monthlyBudget,
          collectedCharges,
          missedDays,
          missedMealRate,
          upcomingCommitment,
          { start: billingPeriodStart, end: billingPeriodEnd, label: billingPeriodLabel }
        )
      : null;

    // ── Today's meal ──────────────────────────────────────────────────────────
    const todaysMeal = allOrders.find(o => o.date === today && isOnHold(o.status)) ?? null;

    // ── Upcoming meals (all future on-hold, any date) ─────────────────────────
    const upcomingMeals = allOrders
      .filter(o => o.date > today && isOnHold(o.status))
      .sort((a, b) => a.date.localeCompare(b.date));

    return res.status(200).json({
      walletBalance,
      walletBalanceAvailable,
      actualBalance,
      todaysMeal,
      upcomingMeals,
      plannedSpend,
      actualSpend,
      missedMeals: missedDays,
      missedMealRate,
      budgetStatus,
      currentMonth,
      billingPeriodStart,
      billingPeriodEnd,
      billingPeriodLabel,
    });
  } catch (err) {
    console.error('[dashboard]', err);
    return jsonError(res, 500, 'Server error: ' + err.message);
  }
}
