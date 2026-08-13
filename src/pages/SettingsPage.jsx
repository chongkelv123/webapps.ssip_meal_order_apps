import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { version as appVersion } from '../../package.json';

// ─── Constants ────────────────────────────────────────────────────────────────

const DELIVERY_TIMES = [
  '11:30 - 11:55',
  '12:00 - 12:25',
  '12:30 - 12:55',
];

const DASHBOARD_SETTINGS_KEY = 'ssip_dashboard_settings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrderDetails() {
  const stored = localStorage.getItem('user_order_details');
  return stored
    ? JSON.parse(stored)
    : { firstName: '', lastName: '', phone: '', email: '', deliveryTime: '11:30 - 11:55', orderNotes: '' };
}

/**
 * Reads budget/allowance settings from localStorage. Numeric values are kept
 * as strings so they can be bound directly to text inputs without conversion.
 */
function getDashboardSettings() {
  const stored = localStorage.getItem(DASHBOARD_SETTINGS_KEY);
  if (!stored) {
    return { missedMealRate: '4.50', monthlyBudget: '100.00', budgetEnabled: true, exemptDates: [] };
  }
  try {
    const p = JSON.parse(stored);
    return {
      missedMealRate: String(typeof p.missedMealRate === 'number' ? p.missedMealRate : 4.50),
      monthlyBudget:  String(typeof p.monthlyBudget  === 'number' ? p.monthlyBudget  : 100.00),
      budgetEnabled:  typeof p.budgetEnabled === 'boolean' ? p.budgetEnabled : true,
      exemptDates:    Array.isArray(p.exemptDates) ? p.exemptDates : [],
    };
  } catch {
    return { missedMealRate: '4.50', monthlyBudget: '100.00', budgetEnabled: true, exemptDates: [] };
  }
}

/**
 * Persists dashboard settings. Numeric strings are converted back to numbers
 * so api.js can read them without parsing.
 */
function persistDashboardSettings(settings) {
  const rate   = parseFloat(settings.missedMealRate);
  const budget = parseFloat(settings.monthlyBudget);
  localStorage.setItem(DASHBOARD_SETTINGS_KEY, JSON.stringify({
    missedMealRate: isNaN(rate)   ? 4.50   : rate,
    monthlyBudget:  isNaN(budget) ? 100.00 : budget,
    budgetEnabled:  settings.budgetEnabled,
    exemptDates:    settings.exemptDates || [],
  }));
}

/**
 * Returns the full weekday name for a yyyy-MM-dd date string.
 * Uses UTC noon to prevent any timezone day-boundary shift.
 */
function getDayName(dateStr) {
  try {
    return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long' });
  } catch {
    return '';
  }
}

// ─── Toggle component ─────────────────────────────────────────────────────────

function Toggle({ id, checked, onChange }) {
  return (
    <label htmlFor={id} className="relative inline-flex items-center cursor-pointer flex-shrink-0">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div
        className="w-11 h-6 bg-gray-200 rounded-full peer
          peer-checked:bg-blue-600
          after:content-[''] after:absolute after:top-0.5 after:left-0.5
          after:bg-white after:border after:border-gray-300 after:rounded-full
          after:h-5 after:w-5 after:transition-all
          peer-checked:after:translate-x-5 peer-checked:after:border-white"
      />
    </label>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { logout } = useAuth();
  const toast = useToast();

  // ── Order details (unchanged) ──────────────────────────────────────────────
  const [form, setForm] = useState(getOrderDetails);
  const [saved, setSaved] = useState(false);

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function handleSave(e) {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.phone || !form.email) {
      toast.error('Please fill in all required fields');
      return;
    }
    localStorage.setItem('user_order_details', JSON.stringify(form));
    setSaved(true);
    toast.success('Settings saved');
  }

  // ── Budget & allowance settings ────────────────────────────────────────────
  const [dashSettings, setDashSettings] = useState(getDashboardSettings);
  const [budgetSaved, setBudgetSaved] = useState(false);

  // Show/hide the inline date-input for adding a skipped date.
  const [showAddDate, setShowAddDate] = useState(false);
  const [newExemptDate, setNewExemptDate] = useState('');

  /**
   * Saves the numeric/text fields only (rate + budget amount).
   * Toggle and exempt-dates changes are committed immediately on change.
   */
  function handleBudgetSave(e) {
    e.preventDefault();
    const rate   = parseFloat(dashSettings.missedMealRate);
    const budget = parseFloat(dashSettings.monthlyBudget);

    if (isNaN(rate) || rate < 0) {
      toast.error('Enter a valid missed-meal rate (e.g. 4.50)');
      return;
    }
    if (dashSettings.budgetEnabled && (isNaN(budget) || budget <= 0)) {
      toast.error('Enter a budget amount above zero (e.g. 100.00)');
      return;
    }

    persistDashboardSettings(dashSettings);
    setBudgetSaved(true);
    toast.success('Allowance settings saved');
  }

  /** Budget toggle commits immediately (mirrors Android behaviour). */
  function handleBudgetToggle(enabled) {
    const updated = { ...dashSettings, budgetEnabled: enabled };
    setDashSettings(updated);
    persistDashboardSettings(updated);
    setBudgetSaved(false);
  }

  /** Adding a skipped date commits immediately (mirrors Android's "ADD" action). */
  function handleAddExemptDate() {
    if (!newExemptDate) return;
    if (dashSettings.exemptDates.includes(newExemptDate)) {
      toast.error('That date is already skipped');
      return;
    }
    const updated = {
      ...dashSettings,
      exemptDates: [...dashSettings.exemptDates, newExemptDate].sort(),
    };
    setDashSettings(updated);
    persistDashboardSettings(updated);
    setNewExemptDate('');
    setShowAddDate(false);
  }

  /** Removing a skipped date commits immediately (mirrors Android's "REMOVE" action). */
  function handleRemoveExemptDate(date) {
    const updated = {
      ...dashSettings,
      exemptDates: dashSettings.exemptDates.filter((d) => d !== date),
    };
    setDashSettings(updated);
    persistDashboardSettings(updated);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-gray-900 pt-2">Settings</h1>

      {/* ── Order Details ──────────────────────────────────────────────────── */}
      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-gray-800">Order Details</h2>
        <p className="text-xs text-gray-500 -mt-2">
          These details are used when placing orders via the WooCommerce checkout.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              className="w-full px-4 py-3 bg-gray-100 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="First"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              className="w-full px-4 py-3 bg-gray-100 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Last"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Phone <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            className="w-full px-4 py-3 bg-gray-100 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="+60 12-345 6789"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            className="w-full px-4 py-3 bg-gray-100 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Delivery Time</label>
          <select
            value={form.deliveryTime}
            onChange={(e) => set('deliveryTime', e.target.value)}
            className="w-full px-4 py-3 bg-gray-100 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
          >
            {DELIVERY_TIMES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Order Notes</label>
          <input
            type="text"
            value={form.orderNotes}
            onChange={(e) => set('orderNotes', e.target.value)}
            className="w-full px-4 py-3 bg-gray-100 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Less spicy, no onion"
          />
        </div>

        <button
          type="submit"
          className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl active:bg-blue-700 transition-colors"
        >
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </form>

      {/* ── Monthly Budget ─────────────────────────────────────────────────── */}
      <form onSubmit={handleBudgetSave} className="flex flex-col gap-4">
        <div className="border-t border-gray-100 pt-2">
          <h2 className="text-base font-semibold text-gray-800">Monthly Budget</h2>
          <p className="text-xs text-gray-500 mt-1">
            Warn me when I go over budget. Counts meals collected plus missed-meal
            charges, with bookings still ahead shown as a forecast. Measured per
            billing period (27th of one month to 26th of the next).
          </p>
        </div>

        {/* Toggle row */}
        <div className="flex items-center justify-between gap-4">
          <label
            htmlFor="budget-toggle"
            className="text-sm font-medium text-gray-700 cursor-pointer"
          >
            Enable budget tracking
          </label>
          <Toggle
            id="budget-toggle"
            checked={dashSettings.budgetEnabled}
            onChange={handleBudgetToggle}
          />
        </div>

        {/* Budget amount — shown only when enabled */}
        {dashSettings.budgetEnabled && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Budget per period
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={dashSettings.monthlyBudget}
                onChange={(e) =>
                  setDashSettings((prev) => ({ ...prev, monthlyBudget: e.target.value }))
                }
                className="w-full pl-8 pr-4 py-3 bg-gray-100 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="100.00"
              />
            </div>
          </div>
        )}

        {/* ── Meal Allowance ──────────────────────────────────────────────── */}
        <div className="border-t border-gray-100 pt-2">
          <h2 className="text-base font-semibold text-gray-800">Meal Allowance</h2>
          <p className="text-xs text-gray-500 mt-1">
            Actual Balance = Wallet Balance &minus; (missed meals &times; rate). A meal counts as
            missed when it was booked but the card was never tapped at the canteen.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Charge per missed meal
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={dashSettings.missedMealRate}
              onChange={(e) =>
                setDashSettings((prev) => ({ ...prev, missedMealRate: e.target.value }))
              }
              className="w-full pl-8 pr-4 py-3 bg-gray-100 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="4.50"
            />
          </div>
        </div>

        {/* Save button for numeric fields */}
        <button
          type="submit"
          className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl active:bg-blue-700 transition-colors"
        >
          {budgetSaved ? '✓ Saved' : 'Save Allowance Settings'}
        </button>

        {/* ── Skipped dates ───────────────────────────────────────────────── */}
        <div className="border-t border-gray-100 pt-2">
          <p className="text-sm font-semibold text-gray-800">Skipped Dates</p>
          <p className="text-xs text-gray-500 mt-1">
            Dates listed here never count as missed. Use this for a cafeteria
            shutdown announced after you had already booked.
          </p>
        </div>

        {/* List of skipped dates with Remove buttons — mirrors Android's exempt-date list */}
        {dashSettings.exemptDates.length === 0 ? (
          <p className="text-sm text-gray-400">None</p>
        ) : (
          <div className="flex flex-col gap-2">
            {dashSettings.exemptDates.map((date) => {
              const dayName = getDayName(date);
              return (
                <div
                  key={date}
                  className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5"
                >
                  <span className="text-sm text-gray-700">
                    {date}&nbsp;&bull;&nbsp;{dayName}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveExemptDate(date)}
                    className="text-sm font-medium text-red-500 ml-4 flex-shrink-0"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add Skipped Date — clicking reveals an inline date input + Add button */}
        {showAddDate ? (
          <div className="flex gap-2 items-center">
            <input
              type="date"
              value={newExemptDate}
              onChange={(e) => setNewExemptDate(e.target.value)}
              className="flex-1 px-4 py-3 bg-gray-100 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={handleAddExemptDate}
              disabled={!newExemptDate}
              className="px-4 py-3 bg-blue-600 text-white font-semibold rounded-xl disabled:opacity-40 active:bg-blue-700 transition-colors flex-shrink-0"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setShowAddDate(false); setNewExemptDate(''); }}
              className="px-3 py-3 border border-gray-300 rounded-xl text-sm text-gray-600 flex-shrink-0"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddDate(true)}
            className="w-full py-3 border border-gray-300 text-gray-700 font-medium rounded-xl active:bg-gray-50 transition-colors text-sm"
          >
            + Add Skipped Date
          </button>
        )}
      </form>

      {/* ── Info links ─────────────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 pt-4 flex flex-col gap-2">
        <Link
          to="/about"
          className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl text-gray-700 active:bg-gray-100 transition-colors"
        >
          <span className="text-sm font-medium">About</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
        <Link
          to="/contact"
          className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl text-gray-700 active:bg-gray-100 transition-colors"
        >
          <span className="text-sm font-medium">Contact Us</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* ── Sign Out ────────────────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 pt-4">
        <button
          onClick={() => {
            if (confirm('Sign out of your account?')) logout();
          }}
          className="w-full py-3 border border-red-200 text-red-600 font-semibold rounded-xl active:bg-red-50 transition-colors"
        >
          Sign Out
        </button>
      </div>

      <div className="flex flex-col items-center gap-0.5 pb-2">
        <p className="text-base text-gray-400">SSIP Meal Order App · v{appVersion}</p>
        <p className="text-base text-gray-400">© 2026 Kelvin Chong. All rights reserved.</p>
      </div>
    </div>
  );
}
