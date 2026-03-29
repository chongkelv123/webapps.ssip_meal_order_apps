import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useToast } from '../hooks/useToast.jsx';

const DELIVERY_TIMES = [
  '11:30 - 11:55',
  '12:00 - 12:25',
  '12:30 - 12:55',
];

function getOrderDetails() {
  const stored = localStorage.getItem('user_order_details');
  return stored
    ? JSON.parse(stored)
    : { firstName: '', lastName: '', phone: '', email: '', deliveryTime: '11:30 - 11:55', orderNotes: '' };
}

export default function SettingsPage() {
  const { logout } = useAuth();
  const toast = useToast();

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

  return (
    <div className="p-4 flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-gray-900 pt-2">Settings</h1>

      {/* Order Details Form */}
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

      {/* Logout */}
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

      <p className="text-xs text-center text-gray-400 pb-2">
        SSIP Meal Order App · Internal use only
      </p>
    </div>
  );
}
