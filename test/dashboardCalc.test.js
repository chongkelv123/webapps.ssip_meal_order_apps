import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMissedMealDays,
  calculatePeriodSpend,
  computeBudgetStatus,
  computeActualBalance,
  computeDashboard,
  computeUnavailableMissedDates,
  getBillingPeriod,
  addExemptDate,
  addManualMissedDate,
  removeExemptDate,
  removeManualMissedDate,
  restoreDateMembership,
  sgtDateOf,
} from '../src/lib/dashboardCalc.js';

const START = '2026-10-27';
const TODAY = '2026-11-12';

const booked = (date, price = 4.5) => ({ date, status: 'On-hold', price, mealName: 'Chicken Rice' });
const tapped = (date, price = 4.5) => ({ date, status: 'CompleteMP', price, mealName: 'Chicken Rice' });

test('booked and untapped past day is missed (auto)', () => {
  const r = findMissedMealDays([booked('2026-11-02')], START, TODAY, [], []);
  assert.equal(r.length, 1);
  assert.equal(r[0].date, '2026-11-02');
  assert.equal(r[0].isManual, false);
  assert.equal(r[0].mealName, 'Chicken Rice');
});

test('a tap-in on a booked day means not missed', () => {
  const r = findMissedMealDays([booked('2026-11-02'), tapped('2026-11-02')], START, TODAY, [], []);
  assert.deepEqual(r, []);
});

test('a skipped date is never missed, even if also manual', () => {
  const day = '2026-11-02';
  assert.deepEqual(findMissedMealDays([booked(day)], START, TODAY, [day], []), []);
  assert.deepEqual(findMissedMealDays([booked(day)], START, TODAY, [day], [day]), []);
  assert.deepEqual(findMissedMealDays([], START, TODAY, [day], [day]), []);
});

test('a manual date with no booking becomes a manual missed entry', () => {
  const r = findMissedMealDays([], START, TODAY, [], ['2026-11-03']);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], {
    date: '2026-11-03',
    dayName: 'Tuesday',
    mealName: 'Added manually',
    bookedPrice: 0,
    isManual: true,
  });
});

test('a manual date on a collected day is ignored', () => {
  assert.deepEqual(findMissedMealDays([tapped('2026-11-03')], START, TODAY, [], ['2026-11-03']), []);
});

test('a manual date on a booked-and-untapped day is not duplicated', () => {
  const r = findMissedMealDays([booked('2026-11-03')], START, TODAY, [], ['2026-11-03']);
  assert.equal(r.length, 1);
  assert.equal(r[0].isManual, false);
});

test('manual dates on/after today or before period start are ignored', () => {
  const r = findMissedMealDays([], START, TODAY, [], [TODAY, '2026-11-13', '2026-10-26']);
  assert.deepEqual(r, []);
  // period start itself is inside the window
  assert.equal(findMissedMealDays([], START, TODAY, [], [START]).length, 1);
});

test('today and future bookings are never missed', () => {
  assert.deepEqual(findMissedMealDays([booked(TODAY), booked('2026-11-20')], START, TODAY, [], []), []);
});

test('result is auto + manual sorted by date', () => {
  const r = findMissedMealDays([booked('2026-11-05')], START, TODAY, [], ['2026-11-01', '2026-11-09']);
  assert.deepEqual(r.map((d) => d.date), ['2026-11-01', '2026-11-05', '2026-11-09']);
});

test('period spend, budget missedDayCount and actual balance include manual days', () => {
  const orders = [
    tapped('2026-11-02', 5),
    booked('2026-11-03'),          // auto missed
    booked('2026-11-20', 6),       // upcoming
  ];
  const { start, end, label } = getBillingPeriod(TODAY);
  const spend = calculatePeriodSpend(orders, start, end, TODAY, [], ['2026-11-04']);
  assert.equal(spend.collectedCharges, 5);
  assert.equal(spend.upcomingCommitment, 6);
  assert.equal(spend.missedDays.length, 2);

  const status = computeBudgetStatus(100, spend.collectedCharges, spend.missedDays, 4.5, spend.upcomingCommitment, { start, end, label });
  assert.equal(status.missedDayCount, 2);
  assert.equal(status.missedCharges, 9);
  assert.equal(status.projected, 20);

  assert.equal(computeActualBalance(50, spend.missedDays.length, 4.5), 41);
});

test('computeDashboard recomputes from raw rows when settings change', () => {
  const raw = { orders: [booked('2026-11-03')], walletBalance: 20 };
  const base = { missedMealRate: 4.5, monthlyBudget: 100, budgetEnabled: true, exemptDates: [], manualMissedDates: [] };

  const a = computeDashboard(raw, base, TODAY);
  assert.equal(a.missedMeals.length, 1);
  assert.equal(a.actualBalance, 15.5);

  const b = computeDashboard(raw, { ...base, manualMissedDates: ['2026-11-05'] }, TODAY);
  assert.equal(b.missedMeals.length, 2);
  assert.equal(b.actualBalance, 11);
  assert.equal(b.budgetStatus.missedDayCount, 2);

  const c = computeDashboard(raw, { ...base, exemptDates: ['2026-11-03'] }, TODAY);
  assert.equal(c.missedMeals.length, 0);
  assert.equal(c.actualBalance, 20);

  // midnight rollover: the same rows judged on a later "today"
  const d = computeDashboard(raw, base, '2026-11-03');
  assert.equal(d.missedMeals.length, 0);
});

test("today's meal is collected only when a CompleteMP row exists for today", () => {
  const base = { missedMealRate: 4.5, monthlyBudget: 100, budgetEnabled: true, exemptDates: [], manualMissedDates: [] };
  const onHold = computeDashboard({ orders: [booked(TODAY)], walletBalance: 10 }, base, TODAY);
  assert.equal(onHold.todaysMeal.date, TODAY);
  assert.equal(onHold.todaysMealCollected, false);

  const paid = computeDashboard({ orders: [booked(TODAY), tapped(TODAY)], walletBalance: 10 }, base, TODAY);
  assert.equal(paid.todaysMeal.date, TODAY); // booking row is still the displayed meal
  assert.equal(paid.todaysMealCollected, true);

  // a tap-in on another day doesn't count
  const other = computeDashboard({ orders: [booked(TODAY), tapped('2026-11-11')], walletBalance: 10 }, base, TODAY);
  assert.equal(other.todaysMealCollected, false);
});

test('unavailable dates carry reasons, later entries override earlier ones', () => {
  const orders = [tapped('2026-11-02'), booked('2026-11-03'), booked('2026-11-04'), booked(TODAY)];
  const exempt = ['2026-11-04'];
  const manual = ['2026-11-05', '2026-11-04'];
  const missed = findMissedMealDays(orders, START, TODAY, exempt, manual);
  const u = computeUnavailableMissedDates(orders, START, TODAY, missed, exempt, manual);
  assert.equal(u['2026-11-02'], 'Collected');
  assert.equal(u['2026-11-03'], 'Already counted as missed');
  assert.equal(u['2026-11-05'], 'Already marked missed');
  assert.equal(u['2026-11-04'], 'Skipped');
  assert.equal(u[TODAY], undefined);
});

test('skipped and manual lists never disagree', () => {
  const s0 = { exemptDates: [], manualMissedDates: [] };
  const s1 = addManualMissedDate(s0, '2026-11-02');
  assert.deepEqual(s1.manualMissedDates, ['2026-11-02']);

  const s2 = addExemptDate(s1, '2026-11-02');
  assert.deepEqual(s2.exemptDates, ['2026-11-02']);
  assert.deepEqual(s2.manualMissedDates, []);

  const s3 = addManualMissedDate(s2, '2026-11-02');
  assert.deepEqual(s3.exemptDates, []);
  assert.deepEqual(s3.manualMissedDates, ['2026-11-02']);

  // removing from one list leaves the other alone
  const both = { exemptDates: ['a'], manualMissedDates: ['b'] };
  assert.deepEqual(removeExemptDate(both, 'a'), { exemptDates: [], manualMissedDates: ['b'] });
  assert.deepEqual(removeManualMissedDate(both, 'b'), { exemptDates: ['a'], manualMissedDates: [] });
});

test('restoreDateMembership undoes a skip that removed a manual entry', () => {
  const before = { inExempt: false, inManual: true };
  const skipped = addExemptDate({ exemptDates: [], manualMissedDates: ['2026-11-02'] }, '2026-11-02');
  assert.deepEqual(restoreDateMembership(skipped, '2026-11-02', before), {
    exemptDates: [],
    manualMissedDates: ['2026-11-02'],
  });
});

test('billing period and SGT date', () => {
  assert.deepEqual(getBillingPeriod('2026-11-12'), { start: '2026-10-27', end: '2026-11-26', label: 'November 2026' });
  assert.equal(getBillingPeriod('2026-12-27').end, '2027-01-26');
  assert.equal(getBillingPeriod('2026-01-05').start, '2025-12-27');
  // 17:00 UTC is already the next day in SGT
  assert.equal(sgtDateOf(Date.UTC(2026, 10, 12, 17, 0, 0)), '2026-11-13');
});
