import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  format, addDays, isWeekend, parseISO,
  startOfWeek, startOfMonth, endOfMonth, eachDayOfInterval,
} from 'date-fns';
import { getMeals, placeOrder } from '../lib/api.js';
import MealCard from '../components/MealCard.jsx';
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
  const toast = useToast();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [orderingId, setOrderingId] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['meals', date],
    queryFn: () => getMeals(date),
  });

  const mutation = useMutation({
    mutationFn: ({ productId, orderDetails }) => placeOrder(productId, date, orderDetails),
    onSuccess: (result, { mealName }) => {
      if (result.success) {
        toast.success(`Order placed for ${mealName}!`);
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      } else {
        toast.error(result.error || 'Order failed');
      }
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => setOrderingId(null),
  });

  function handleOrder(meal) {
    const orderDetails = getOrderDetails();
    if (!orderDetails?.firstName) {
      toast.error('Please fill in your order details in Settings first');
      return;
    }
    setOrderingId(meal.productId);
    mutation.mutate({ productId: meal.productId, orderDetails, mealName: meal.name });
  }

  const meals = data?.meals || [];
  const grouped = meals.reduce((acc, m) => {
    (acc[m.stall] = acc[m.stall] || []).push(m);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <input
        type="date"
        value={date}
        min={todayStr()}
        onChange={(e) => setDate(e.target.value)}
        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {isLoading && <LoadingSpinner className="py-8" />}
      {isError && <p className="text-red-600 text-sm text-center py-4">{error.message}</p>}
      {!isLoading && !isError && meals.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">No meals available for this date</div>
      )}

      {Object.entries(grouped).map(([stall, stallMeals]) => (
        <div key={stall}>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{stall}</h3>
          <div className="grid grid-cols-2 gap-3">
            {stallMeals.map((meal) => (
              <MealCard
                key={meal.productId}
                meal={meal}
                onOrder={handleOrder}
                ordering={orderingId === meal.productId}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Batch Panel (shared by Week & Month) ─────────────────────────────────────

function BatchPanel({ availableDates, gridCols = 4 }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedDates, setSelectedDates] = useState(availableDates);
  const [mealDate, setMealDate] = useState(availableDates[0] || todayStr());
  const [selectedMeal, setSelectedMeal] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);

  const gridClass = { 4: 'grid-cols-4', 5: 'grid-cols-5' }[gridCols] || 'grid-cols-4';

  const { data: mealsData, isLoading: mealsLoading } = useQuery({
    queryKey: ['meals', mealDate],
    queryFn: () => getMeals(mealDate),
    enabled: !!mealDate,
  });

  const meals = mealsData?.meals || [];

  function toggleDate(d) {
    setSelectedDates((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  }

  function toggleAll() {
    setSelectedDates((prev) =>
      prev.length === availableDates.length ? [] : [...availableDates]
    );
  }

  async function handlePlaceAll() {
    if (!selectedDates.length) return toast.error('Select at least one date');
    if (!selectedMeal) return toast.error('Select a meal');
    const orderDetails = getOrderDetails();
    if (!orderDetails?.firstName) {
      return toast.error('Please fill in your order details in Settings first');
    }

    setRunning(true);
    const sorted = [...selectedDates].sort();
    const results = [];
    setProgress({ current: 0, total: sorted.length, results });

    for (let i = 0; i < sorted.length; i++) {
      const date = sorted[i];
      try {
        const result = await placeOrder(selectedMeal.productId, date, orderDetails);
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
    <div className="flex flex-col gap-4">
      {/* Date chips */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">Select Dates</p>
          <button
            onClick={toggleAll}
            className="text-xs text-blue-600 font-medium"
          >
            {selectedDates.length === availableDates.length ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div className={`grid ${gridClass} gap-2`}>
          {availableDates.map((d) => {
            const sel = selectedDates.includes(d);
            return (
              <button
                key={d}
                onClick={() => toggleDate(d)}
                className={`py-2 px-1 rounded-xl text-xs font-medium border transition-colors
                  ${sel ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200'}`}
              >
                <span className="block font-semibold">{format(parseISO(d), 'EEE')}</span>
                <span className="block">{format(parseISO(d), 'MMM d')}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Meal picker */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">Choose Meal</p>
          <input
            type="date"
            value={mealDate}
            onChange={(e) => { setMealDate(e.target.value); setSelectedMeal(null); }}
            className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {mealsLoading && <LoadingSpinner className="py-4" />}
        {!mealsLoading && meals.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-3">No meals for this date</p>
        )}

        <div className="flex flex-col gap-2">
          {meals.map((meal) => (
            <button
              key={meal.productId}
              onClick={() => setSelectedMeal(meal)}
              className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors
                ${selectedMeal?.productId === meal.productId
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 bg-white'}`}
            >
              <div
                className={`w-4 h-4 rounded-full border-2 flex-shrink-0
                  ${selectedMeal?.productId === meal.productId
                    ? 'border-blue-600 bg-blue-600'
                    : 'border-gray-300'}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{meal.name}</p>
                <p className="text-xs text-gray-500">{meal.stall} · ${meal.price.toFixed(2)}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handlePlaceAll}
        disabled={running || !selectedDates.length || !selectedMeal}
        className="w-full py-3.5 bg-blue-600 text-white font-semibold rounded-xl disabled:opacity-50 active:bg-blue-700 transition-colors"
      >
        {running
          ? `Placing orders… (${progress?.current}/${progress?.total})`
          : `Place ${selectedDates.length || 0} Order${selectedDates.length !== 1 ? 's' : ''}`}
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
      <BatchPanel key={weekDates.join()} availableDates={weekDates} gridCols={5} />
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
      <BatchPanel key={month} availableDates={monthDates} gridCols={4} />
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
