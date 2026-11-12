/**
 * Pure dashboard calculations, shared by the client (recomputed on every render
 * from raw scraped rows + local settings) and by api/dashboard.js (which only
 * needs getBillingPeriod to bound its pagination).
 *
 * No DOM / React / Node-only imports here — keep it that way.
 */

// ─── Dates ───────────────────────────────────────────────────────────────────

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** yyyy-MM-dd of the given instant in SGT (UTC+8) — the cafeteria's timezone. */
export const sgtDateOf = (ms) => new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 10);

/** Shifts a yyyy-MM-dd string by whole days (UTC noon avoids DST/day-boundary shifts). */
export function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Full weekday name for a yyyy-MM-dd string. */
export function getDayName(dateStr) {
  try {
    return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long' });
  } catch {
    return '';
  }
}

/**
 * Billing period containing todayStr. Periods run 27th → 26th and are labelled
 * by the month they end in. Port of DateUtil.getBillingPeriod().
 */
export function getBillingPeriod(todayStr) {
  const [year, month, day] = todayStr.split('-').map(Number);
  const CUTOFF = 27;
  const pad = (n) => String(n).padStart(2, '0');

  let startYear, startMonth, endYear, endMonth;
  if (day >= CUTOFF) {
    startYear = year;
    startMonth = month;
    endYear = month === 12 ? year + 1 : year;
    endMonth = month === 12 ? 1 : month + 1;
  } else {
    startYear = month === 1 ? year - 1 : year;
    startMonth = month === 1 ? 12 : month - 1;
    endYear = year;
    endMonth = month;
  }

  const start = `${startYear}-${pad(startMonth)}-27`;
  const end = `${endYear}-${pad(endMonth)}-26`;
  const endDate = new Date(Date.UTC(endYear, endMonth - 1, 1));
  const label = endDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return { start, end, label };
}

// ─── Status helpers (mirrors OrderStatusClassifier.kt) ───────────────────────

const normalizeStatus = (s) => String(s ?? '').toLowerCase().replace(/[-\s]/g, '');
export const isOnHold = (s) => normalizeStatus(s).includes('onhold');
export const isCompleteMp = (s) => normalizeStatus(s).includes('completemp');

// ─── Missed meals ────────────────────────────────────────────────────────────

export const MANUAL_MEAL_NAME = 'Added manually';

/**
 * Days in [periodStart, todayStr) that count as missed.
 *
 *  - Auto-detected: an on-hold booking, no CompleteMP tap-in, not skipped.
 *  - Manual: a date the user declared missed that is inside the window and is
 *    not already auto-detected, collected (tap-in) or skipped.
 *
 * Precedence: skipped > tap-in > manual. Today and future days are never judged.
 * Port of OrderScraper.findMissedMealDays().
 */
export function findMissedMealDays(
  orders,
  periodStart,
  todayStr,
  exemptDates = [],
  manualMissedDates = []
) {
  const exempt = new Set(exemptDates);
  const inRange = orders.filter((o) => o.date >= periodStart && o.date < todayStr);

  const completedDates = new Set(
    inRange.filter((o) => isCompleteMp(o.status)).map((o) => o.date)
  );

  const bookingsByDate = {};
  for (const o of inRange) {
    if (isOnHold(o.status)) {
      if (!bookingsByDate[o.date]) bookingsByDate[o.date] = [];
      bookingsByDate[o.date].push(o);
    }
  }

  const auto = Object.entries(bookingsByDate)
    .filter(([date]) => !completedDates.has(date) && !exempt.has(date))
    .map(([date, bookings]) => ({
      date,
      dayName: getDayName(date),
      mealName: bookings[0].mealName,
      bookedPrice: bookings[0].price,
      isManual: false,
    }));

  const autoDates = new Set(auto.map((d) => d.date));

  const manual = [...new Set(manualMissedDates)]
    .filter(
      (date) =>
        date >= periodStart &&
        date < todayStr &&
        !autoDates.has(date) &&
        !completedDates.has(date) &&
        !exempt.has(date)
    )
    .map((date) => ({
      date,
      dayName: getDayName(date),
      mealName: MANUAL_MEAL_NAME,
      bookedPrice: 0,
      isManual: true,
    }));

  return [...auto, ...manual].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Spend for a billing period in three buckets: collected (CompleteMP rows),
 * missed days (auto + manual) and upcoming commitment (future on-hold, one per day).
 * Port of OrderScraper.calculatePeriodSpend().
 */
export function calculatePeriodSpend(
  orders,
  start,
  end,
  todayStr,
  exemptDates = [],
  manualMissedDates = []
) {
  const inPeriod = orders.filter((o) => o.date >= start && o.date <= end);

  const collectedCharges = inPeriod
    .filter((o) => isCompleteMp(o.status))
    .reduce((sum, o) => sum + o.price, 0);

  const missedDays = findMissedMealDays(inPeriod, start, todayStr, exemptDates, manualMissedDates);

  const completedDates = new Set(
    inPeriod.filter((o) => isCompleteMp(o.status)).map((o) => o.date)
  );

  const futureByDate = {};
  for (const o of inPeriod) {
    if (isOnHold(o.status) && o.date >= todayStr && !completedDates.has(o.date)) {
      if (!futureByDate[o.date]) futureByDate[o.date] = o;
    }
  }
  const upcomingCommitment = Object.values(futureByDate).reduce((sum, o) => sum + o.price, 0);

  return { collectedCharges, missedDays, upcomingCommitment };
}

/** Wallet balance less missed-day charges, in whole cents to avoid float drift. */
export function computeActualBalance(walletBalance, missedDayCount, missedMealRate) {
  const cents = (n) => Math.round(n * 100);
  return (cents(walletBalance) - missedDayCount * cents(missedMealRate)) / 100;
}

/**
 * Budget status for one period; arithmetic in whole cents so "exactly on budget"
 * never yields a false OVER. Port of BudgetCalculator.status().
 */
export function computeBudgetStatus(
  budget,
  collectedCharges,
  missedDays,
  missedMealRate,
  upcoming,
  period
) {
  const cents = (n) => Math.round(n * 100);
  const dollars = (c) => c / 100;

  const missedDayCount = missedDays.length;
  const missedCharges = dollars(missedDayCount * cents(missedMealRate));

  const budgetCents = cents(budget);
  const projectedCents = cents(collectedCharges) + cents(missedCharges) + cents(upcoming);

  const fraction =
    budgetCents > 0 ? projectedCents / budgetCents : projectedCents > 0 ? 1.0 : 0.0;

  const NEAR_THRESHOLD = 0.8;
  const level =
    projectedCents > budgetCents
      ? 'OVER'
      : budgetCents <= 0
        ? 'UNDER'
        : fraction >= NEAR_THRESHOLD
          ? 'NEAR'
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
    overBy: dollars(Math.max(0, projectedCents - budgetCents)),
    fraction,
    level,
    isOver: level === 'OVER',
    period,
  };
}

/**
 * Why each date in [periodStart, todayStr) can't be newly marked as missed.
 * Later entries override earlier ones (so "Skipped" wins).
 */
export function computeUnavailableMissedDates(
  orders,
  periodStart,
  todayStr,
  missedDays,
  exemptDates = [],
  manualMissedDates = []
) {
  const inWindow = (d) => d >= periodStart && d < todayStr;
  const out = {};

  for (const o of orders) {
    if (inWindow(o.date) && isCompleteMp(o.status)) out[o.date] = 'Collected';
  }
  for (const m of missedDays) out[m.date] = 'Already counted as missed';
  for (const d of manualMissedDates) if (inWindow(d)) out[d] = 'Already marked missed';
  for (const d of exemptDates) if (inWindow(d)) out[d] = 'Skipped';
  return out;
}

// ─── Skipped / manual list helpers ───────────────────────────────────────────
// The two lists must never disagree, so every entry point goes through these.

const withDate = (list, date) => (list.includes(date) ? list : [...list, date].sort());
const withoutDate = (list, date) => list.filter((d) => d !== date);

/** Adds to skipped and removes from manual. */
export function addExemptDate(settings, date) {
  return {
    ...settings,
    exemptDates: withDate(settings.exemptDates ?? [], date),
    manualMissedDates: withoutDate(settings.manualMissedDates ?? [], date),
  };
}

/** Adds to manual and removes from skipped. */
export function addManualMissedDate(settings, date) {
  return {
    ...settings,
    manualMissedDates: withDate(settings.manualMissedDates ?? [], date),
    exemptDates: withoutDate(settings.exemptDates ?? [], date),
  };
}

/** Removes from skipped only. */
export function removeExemptDate(settings, date) {
  return { ...settings, exemptDates: withoutDate(settings.exemptDates ?? [], date) };
}

/** Removes from manual only. */
export function removeManualMissedDate(settings, date) {
  return { ...settings, manualMissedDates: withoutDate(settings.manualMissedDates ?? [], date) };
}

/** Puts a date's membership in both lists back exactly as captured (used by Undo). */
export function restoreDateMembership(settings, date, { inExempt, inManual }) {
  return {
    ...settings,
    exemptDates: inExempt
      ? withDate(settings.exemptDates ?? [], date)
      : withoutDate(settings.exemptDates ?? [], date),
    manualMissedDates: inManual
      ? withDate(settings.manualMissedDates ?? [], date)
      : withoutDate(settings.manualMissedDates ?? [], date),
  };
}

// ─── Everything the dashboard screen shows ───────────────────────────────────

/**
 * Derives every dashboard figure from raw scraped rows + current settings.
 * raw: { orders, walletBalance (number|null) }.  today: yyyy-MM-dd (server SGT date).
 */
export function computeDashboard(raw, settings, today) {
  const orders = raw.orders ?? [];
  const { start, end, label } = getBillingPeriod(today);
  const exempt = settings.exemptDates ?? [];
  const manual = settings.manualMissedDates ?? [];

  const { collectedCharges, missedDays, upcomingCommitment } = calculatePeriodSpend(
    orders, start, end, today, exempt, manual
  );

  const walletBalanceAvailable = raw.walletBalance !== null && raw.walletBalance !== undefined;
  const walletBalance = walletBalanceAvailable ? raw.walletBalance : 0;

  const budgetStatus = settings.budgetEnabled
    ? computeBudgetStatus(
        settings.monthlyBudget,
        collectedCharges,
        missedDays,
        settings.missedMealRate,
        upcomingCommitment,
        { start, end, label }
      )
    : null;

  return {
    today,
    walletBalance,
    walletBalanceAvailable,
    actualBalance: computeActualBalance(walletBalance, missedDays.length, settings.missedMealRate),
    todaysMeal: orders.find((o) => o.date === today && isOnHold(o.status)) ?? null,
    upcomingMeals: orders
      .filter((o) => o.date > today && isOnHold(o.status))
      .sort((a, b) => a.date.localeCompare(b.date)),
    plannedSpend: upcomingCommitment,
    actualSpend: collectedCharges,
    missedMeals: missedDays,
    missedMealRate: settings.missedMealRate,
    budgetStatus,
    billingPeriodStart: start,
    billingPeriodEnd: end,
    billingPeriodLabel: label,
    unavailableMissedDates: computeUnavailableMissedDates(
      orders, start, today, missedDays, exempt, manual
    ),
  };
}
