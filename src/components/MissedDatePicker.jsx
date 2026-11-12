import { useState } from 'react';
import { shiftDate } from '../lib/dashboardCalc.js';

/**
 * Modal for declaring a day as missed. A date is selectable iff
 * periodStart <= d < today && d is not in `unavailable` ({ [date]: reason }).
 * <input type="date"> can't grey out single days, so the reason is shown inline
 * and confirm is disabled instead.
 */
export default function MissedDatePicker({ periodStart, today, unavailable, rate, onConfirm, onCancel }) {
  const [date, setDate] = useState('');

  const maxDate = shiftDate(today, -1); // today and future are never judged

  let error = '';
  if (date) {
    if (date < periodStart || date > maxDate) {
      error = 'Pick a past day inside the current billing period.';
    } else if (unavailable[date]) {
      error = unavailable[date];
    }
  }
  const canConfirm = !!date && !error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h2 className="text-base font-bold text-gray-900 mb-2">Mark a day as missed</h2>
        <p className="text-xs text-gray-500 mb-4">
          Only past days in this billing period can be chosen. Days already counted, skipped, or
          collected can&apos;t be chosen. A missed day is charged at ${Number(rate).toFixed(2)}.
        </p>

        <input
          type="date"
          value={date}
          min={periodStart}
          max={maxDate}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-4 py-3 bg-gray-100 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="text-xs text-red-600 mt-2" role="alert">{error}</p>}

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl border border-gray-300 text-sm font-medium text-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canConfirm && onConfirm(date)}
            disabled={!canConfirm}
            className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-40"
          >
            MARK AS MISSED
          </button>
        </div>
      </div>
    </div>
  );
}
