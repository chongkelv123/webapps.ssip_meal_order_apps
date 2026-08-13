import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDashboard, cancelOrder } from '../lib/api.js';
import { getDailyMessage, getDailyBannerColor } from '../lib/dailyMessages.js';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { format, parseISO } from 'date-fns';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) => `$${Number(n).toFixed(2)}`;

/**
 * Formats a yyyy-MM-dd date string as "MMM D" without using date-fns parseISO,
 * avoiding any timezone-induced day-boundary shift for pure date strings.
 */
function shortDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

// ─── Small reusable sub-components ───────────────────────────────────────────

function SpendTile({ title, amount, sub, bgClass }) {
  return (
    <div className={`${bgClass} rounded-2xl p-4 flex-1`}>
      <p className="text-xs text-gray-500 mb-1">{title}</p>
      <p className="text-2xl font-bold text-gray-900">{amount}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  const norm = status.toLowerCase().replace(/[-\s]/g, '');
  const isCompleted = norm.includes('completemp') || norm.includes('completed');
  return (
    <span
      className={`text-xs px-2 py-1 rounded font-medium text-white ${
        isCompleted ? 'bg-green-500' : 'bg-red-500'
      }`}
    >
      {status}
    </span>
  );
}

function CancelDialog({ meal, onConfirm, onDismiss, isCancelling }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h2 className="text-base font-bold text-gray-900 mb-2">Cancel Order?</h2>
        <p className="text-sm text-gray-600 mb-1">{meal.mealName}</p>
        <p className="text-sm text-gray-400 mb-5">
          {format(parseISO(meal.date), 'MMMM d, yyyy')} &bull;{' '}
          {format(parseISO(meal.date), 'EEEE')}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onDismiss}
            disabled={isCancelling}
            className="flex-1 py-2 rounded-xl border border-gray-300 text-sm font-medium text-gray-700"
          >
            No, Keep
          </button>
          <button
            onClick={onConfirm}
            disabled={isCancelling}
            className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {isCancelling ? 'Cancelling…' : 'Yes, Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BudgetCard ───────────────────────────────────────────────────────────────

/**
 * Planned spend against the user's ceiling for this billing period.
 * Mirrors the Android BudgetCard / BudgetMeter composable in layout and logic.
 *
 *  - UNDER  → yellow/amber background, amber progress bar
 *  - NEAR   → amber background, orange progress bar
 *  - OVER   → red-tinted background, red progress bar + warning header
 */
function BudgetCard({ budgetStatus }) {
  const {
    budget, collectedCharges, missedCharges, missedDayCount,
    missedMealRate, upcoming, projected, remaining, overBy,
    fraction, level, period,
  } = budgetStatus;

  const isOver = level === 'OVER';
  const isNear = level === 'NEAR';

  const bgClass      = isOver ? 'bg-red-50'    : isNear ? 'bg-amber-50'  : 'bg-yellow-50';
  const barClass     = isOver ? 'bg-red-500'   : 'bg-orange-400';
  const captionClass = isOver ? 'text-red-700 font-medium' : 'text-gray-500';
  const titleClass   = isOver ? 'text-red-700' : 'text-gray-700';

  const pct = `${Math.min(fraction * 100, 100).toFixed(1)}%`;

  const breakdownParts = [`${fmt(collectedCharges)} collected`];
  if (missedDayCount > 0) {
    breakdownParts.push(
      `${fmt(missedCharges)} missed (${missedDayCount} × ${fmt(missedMealRate)})`
    );
  }
  if (upcoming > 0) {
    breakdownParts.push(`${fmt(upcoming)} still booked`);
  }

  const caption = isOver
    ? `${fmt(overBy)} over budget for this period`
    : `${fmt(remaining)} left of ${fmt(budget)}`;

  return (
    <div className={`${bgClass} rounded-2xl p-4`}>
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className={`text-sm font-semibold ${titleClass}`}>
            {isOver ? '⚠ Over Budget' : 'Monthly Budget'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{period.label}</p>
        </div>
        <p className="text-sm font-bold text-gray-900">
          {fmt(projected)} / {fmt(budget)}
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
        <div
          className={`${barClass} h-2 rounded-full transition-all duration-300`}
          style={{ width: pct }}
        />
      </div>

      {/* Breakdown and caption */}
      <p className="text-xs text-gray-500 mb-1">{breakdownParts.join(' · ')}</p>
      <p className={`text-xs ${captionClass}`}>{caption}</p>
    </div>
  );
}

// ─── MissedMealsBanner ────────────────────────────────────────────────────────

/**
 * Collapsible warning banner — mirrors the Android MissedMealsCard composable.
 * Collapsed by default so it does not dominate the screen on every load.
 */
function MissedMealsBanner({ missedMeals }) {
  const [expanded, setExpanded] = useState(false);
  const count = missedMeals.length;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className="text-amber-600 text-base">{'⚠'}</span>
        <span className="flex-1 text-sm font-medium text-amber-800">
          {count === 1 ? '1 missed meal this period' : `${count} missed meals this period`}
        </span>
        <span className="text-amber-500 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-2 border-t border-amber-100">
          {missedMeals.map((day) => (
            <div key={day.date} className="pt-2">
              <p className="text-xs font-medium text-amber-600">
                {day.date} &bull; {day.dayName}
              </p>
              <p className="text-sm text-amber-900">{day.mealName}</p>
            </div>
          ))}
          <p className="text-xs text-amber-600 mt-1 pt-2 border-t border-amber-100">
            Booked but not collected &mdash; tap your card at the canteen to complete a meal.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
  });

  const { mutate: doCancel, isPending: isCancelling } = useMutation({
    mutationFn: cancelOrder,
    onSuccess: () => {
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600 text-sm mb-4">{error.message}</p>
        <button onClick={refetch} className="text-blue-600 font-medium text-sm">
          Retry
        </button>
      </div>
    );
  }

  const {
    walletBalance        = 0,
    walletBalanceAvailable = true,
    actualBalance        = 0,
    todaysMeal,
    upcomingMeals        = [],
    plannedSpend         = 0,
    actualSpend          = 0,
    missedMeals          = [],
    missedMealRate       = 4.50,
    budgetStatus         = null,
    billingPeriodStart,
    billingPeriodEnd,
  } = data || {};

  // e.g. "Jul 27 – Aug 26, 2026" — string-split to avoid timezone day-shift.
  const periodDisplay = billingPeriodStart && billingPeriodEnd
    ? `${shortDate(billingPeriodStart)} – ${shortDate(billingPeriodEnd)}, ${billingPeriodEnd.slice(0, 4)}`
    : '';

  const walletAmt  = walletBalanceAvailable ? fmt(walletBalance)  : '—';
  const actualAmt  = walletBalanceAvailable ? fmt(actualBalance)  : '—';
  const missedSub  = missedMeals.length === 0
    ? 'No missed meals'
    : `${missedMeals.length} missed × ${fmt(missedMealRate)}`;

  return (
    <>
      <div className="p-4 flex flex-col gap-4">

        {/* Header */}
        <div className="pt-2">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          {periodDisplay && (
            <p className="text-xs text-gray-400 mt-0.5">Billing period: {periodDisplay}</p>
          )}
        </div>

        {/* Daily motivational banner */}
        <div className={`${getDailyBannerColor()} rounded-2xl px-4 py-3`}>
          <p className="text-white text-sm font-medium leading-snug">{getDailyMessage()}</p>
        </div>

        {/* Planned + Actual spend tiles */}
        <div className="flex gap-3">
          <SpendTile
            title="Planned"
            amount={fmt(plannedSpend)}
            sub="Upcoming Orders"
            bgClass="bg-blue-50"
          />
          <SpendTile
            title="Actual"
            amount={fmt(actualSpend)}
            sub="Completed Orders"
            bgClass="bg-green-50"
          />
        </div>

        {/* Monthly Budget card — only when budgetEnabled in settings */}
        {budgetStatus && <BudgetCard budgetStatus={budgetStatus} />}

        {/* Wallet Balance + Actual Balance tiles */}
        <div className="flex gap-3">
          <SpendTile
            title="Wallet Balance"
            amount={walletAmt}
            sub="Available Funds"
            bgClass="bg-yellow-100"
          />
          <SpendTile
            title="Actual Balance"
            amount={actualAmt}
            sub={missedSub}
            bgClass={missedMeals.length > 0 ? 'bg-red-50' : 'bg-pink-50'}
          />
        </div>

        {/* Missed meals collapsible banner */}
        {missedMeals.length > 0 && (
          <MissedMealsBanner missedMeals={missedMeals} />
        )}

        {/* Today's Meal */}
        {todaysMeal ? (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">Today's Meal</p>
            <p className="font-semibold text-gray-900">{todaysMeal.mealName}</p>
            <p className="text-xs text-gray-500 mt-0.5">{fmt(todaysMeal.price ?? 0)}</p>
            <div className="mt-2">
              <StatusBadge status={todaysMeal.status} />
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
            <p className="text-sm text-gray-400">No meal ordered for today</p>
          </div>
        )}

        {/* Upcoming Meals */}
        {upcomingMeals.length > 0 && (
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-3">
              Upcoming Meals ({upcomingMeals.length})
            </h2>
            <div className="flex flex-col gap-2">
              {upcomingMeals.map((meal, i) => (
                <div key={i} className="bg-gray-100 rounded-2xl p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-blue-600 mb-0.5">
                      {format(parseISO(meal.date), 'MMMM d')} &bull;{' '}
                      {format(parseISO(meal.date), 'EEEE')}
                    </p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{meal.mealName}</p>
                    <p className="text-xs text-gray-500">{fmt(meal.price ?? 0)}</p>
                  </div>
                  {meal.cancelUrl && (
                    <button
                      onClick={() => setCancelTarget(meal)}
                      className="flex-shrink-0 flex items-center gap-1 border border-gray-400 rounded-full px-3 py-1.5 text-xs font-medium text-gray-700"
                    >
                      {'✕'} Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Cancel confirmation dialog */}
      {cancelTarget && (
        <CancelDialog
          meal={cancelTarget}
          isCancelling={isCancelling}
          onConfirm={() => doCancel(cancelTarget.cancelUrl)}
          onDismiss={() => setCancelTarget(null)}
        />
      )}
    </>
  );
}
