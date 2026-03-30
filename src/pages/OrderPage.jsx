import { useState } from 'react';
import { useQuery, useQueries, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  format, addDays, isWeekend, parseISO,
  startOfWeek, startOfMonth, endOfMonth, eachDayOfInterval,
} from 'date-fns';
import { getMeals, placeOrder } from '../lib/api.js';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useToast } from '../hooks/useToast.jsx';

function getOrderDetails() {
  const stored = localStorage.getItem('user_order_details');
  return stored ? JSON.parse(stored) : null;
}

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

function getWorkingDaysInWeek(dateStr) {
  const mon = startOfWeek(parseISO(dateStr), { weekStartsOn: 1 });
  return Array.from({ length: 5 }, (_, i) => format(addDays(mon, i), 'yyyy-MM-dd'));
}

function getWorkingDaysInMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return eachDayOfInterval({
    start: startOfMonth(new Date(y, m - 1)),
    end: endOfMonth(new Date(y, m - 1)),
  })
    .filter((d) => !isWeekend(d))
    .map((d) => format(d, 'yyyy-MM-dd'));
}

// ── Day Tab ──────────────────────────────────────────────────────────────────

function DayTab() {
  const [date, setDate] = useState(todayStr());

  return (
    <div className="flex flex-col gap-4">
      <input
        type="date"
        value={date}
        min={todayStr()}
        onChange={(e) => setDate(e.target.value)}
        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <PerDayOrderPanel key={date} dates={[date]} />
    </div>
  );
}

// ── Meal Thumbnail ───────────────────────────────────────────────────────────

function MealThumb({ imageUrl, name }) {
  const [imgError, setImgError] = useState(false);
  return (
    <div className="w-12 h-12 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
      {imageUrl && !imgError ? (
        <img
          src={imageUrl}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 text-gray-300">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3.75 3h16.5M4.5 3v18m15-18v18" />
        </svg>
      )}
    </div>
  );
}

// ── Per-Day Order Panel (shared by Week & Month) ─────────────────────────────
// Each day shows its own meal list; user picks one meal per day independently.

function PerDayOrderPanel({ dates }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedMeals, setSelectedMeals] = useState({}); // { date: meal }
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);

  const queryResults = useQueries({
    queries: dates.map((date) => ({
      queryKey: ['meals', date],
      queryFn: () => getMeals(date),
    })),
  });

  const selectedCount = Object.keys(selectedMeals).length;
  const totalPrice = Object.values(selectedMeals).reduce((sum, m) => sum + m.price, 0);

  function toggleMeal(date, meal) {
    setSelectedMeals((prev) => {
      if (prev[date]?.productId === meal.productId) {
        const next = { ...prev };
        delete next[date];
        return next;
      }
      return { ...prev, [date]: meal };
    });
  }

  async function handlePlaceAll() {
    if (!selectedCount) return toast.error('Select at least one meal');
    const orderDetails = getOrderDetails();
    if (!orderDetails?.firstName) {
      return toast.error('Please fill in your order details in Settings first');
    }

    setRunning(true);
    const sorted = Object.entries(selectedMeals).sort(([a], [b]) => a.localeCompare(b));
    const results = [];
    setProgress({ current: 0, total: sorted.length, results });

    for (let i = 0; i < sorted.length; i++) {
      const [date, meal] = sorted[i];
      try {
        const result = await placeOrder(meal.productId, date, orderDetails);
        results.push({ date, success: result.success, error: result.error });
      } catch (err) {
        results.push({ date, success: false, error: err.message });
      }
      setProgress({ current: i + 1, total: sorted.length, results: [...results] });
      if (i < sorted.length - 1) await new Promise((r) => setTimeout(r, 500));
    }

    setRunning(false);
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    const succeeded = results.filter((r) => r.success).length;
    toast.success(`${succeeded}/${sorted.length} orders placed`);
  }

  return (
    <div className="flex flex-col gap-3">
      {dates.map((date, i) => {
        const result = queryResults[i];
        const meals = result.data?.meals || [];
        const selected = selectedMeals[date];

        return (
          <div key={date} className="bg-white rounded-2xl p-4 shadow-sm">
            {/* Day header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-blue-600">
                  {format(parseISO(date), 'EEE')}
                </span>
                <span className="text-sm text-gray-500">{format(parseISO(date), 'MMM d')}</span>
              </div>
              {selected && (
                <span className="text-xs text-green-600 font-medium">
                  ✓ {selected.name} · ${selected.price.toFixed(2)}
                </span>
              )}
            </div>

            {result.isLoading && <LoadingSpinner />}
            {result.isError && (
              <p className="text-xs text-red-500 py-1">Failed to load meals</p>
            )}
            {!result.isLoading && !result.isError && meals.length === 0 && (
              <p className="text-xs text-gray-400 py-1">No meals available</p>
            )}

            <div className="flex flex-col gap-1.5">
              {meals.map((meal) => (
                <button
                  key={meal.productId}
                  onClick={() => toggleMeal(date, meal)}
                  className={`flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors
                    ${selected?.productId === meal.productId
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200'}`}
                >
                  <MealThumb imageUrl={meal.imageUrl} name={meal.name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{meal.name}</p>
                    <p className="text-xs text-gray-500">{meal.stall} · ${meal.price.toFixed(2)}</p>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex-shrink-0
                      ${selected?.productId === meal.productId
                        ? 'border-blue-600 bg-blue-600'
                        : 'border-gray-300'}`}
                  />
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* Summary bar */}
      {selectedCount > 0 && (
        <div className="bg-blue-50 rounded-2xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">
            {selectedCount} meal{selectedCount !== 1 ? 's' : ''} selected
          </p>
          <p className="text-sm font-bold text-blue-600">Total: ${totalPrice.toFixed(2)}</p>
        </div>
      )}

      <button
        onClick={handlePlaceAll}
        disabled={running || selectedCount === 0}
        className="w-full py-3.5 bg-blue-600 text-white font-semibold rounded-xl disabled:opacity-50 active:bg-blue-700 transition-colors"
      >
        {running
          ? `Placing orders… (${progress?.current}/${progress?.total})`
          : `Place ${selectedCount} Order${selectedCount !== 1 ? 's' : ''}`}
      </button>

      {progress?.results.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {progress.results.map((r) => (
            <div
              key={r.date}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm
                ${r.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
            >
              <span>{r.success ? '✓' : '✕'}</span>
              <span className="flex-1">{format(parseISO(r.date), 'EEE, MMM d')}</span>
              {!r.success && <span className="text-xs truncate max-w-32">{r.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Week Tab ─────────────────────────────────────────────────────────────────

function WeekTab() {
  const [pickedDate, setPickedDate] = useState(todayStr());
  const weekDates = getWorkingDaysInWeek(pickedDate);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Select any day in the week
        </label>
        <input
          type="date"
          value={pickedDate}
          onChange={(e) => setPickedDate(e.target.value)}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">
          Week: {format(parseISO(weekDates[0]), 'MMM d')} – {format(parseISO(weekDates[4]), 'MMM d, yyyy')}
        </p>
      </div>
      <PerDayOrderPanel key={weekDates.join()} dates={weekDates} />
    </div>
  );
}

// ── Month Tab ────────────────────────────────────────────────────────────────

function MonthTab() {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const monthDates = getWorkingDaysInMonth(month);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Select Month</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">{monthDates.length} working days</p>
      </div>
      <PerDayOrderPanel key={month} dates={monthDates} />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

export default function OrderPage() {
  const [tab, setTab] = useState('day');

  return (
    <div className="p-4 flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-gray-900 pt-2">Order Meals</h1>

      <div className="flex bg-gray-100 rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors
              ${tab === t.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'day' && <DayTab />}
      {tab === 'week' && <WeekTab />}
      {tab === 'month' && <MonthTab />}
    </div>
  );
}
