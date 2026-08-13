function getCookies() {
  const stored = localStorage.getItem('wc_session_cookies');
  return stored ? JSON.parse(stored) : {};
}

async function handleResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server error (${res.status}): ${text.slice(0, 300)}`);
  }

  if (data.sessionExpired) {
    localStorage.removeItem('wc_session_cookies');
    window.dispatchEvent(new CustomEvent('session-expired'));
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

async function post(endpoint, body = {}) {
  const cookies = getCookies();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies, ...body }),
  });
  return handleResponse(res);
}

// No cookies needed for login
export async function login(username, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse(res);
}

export const getMeals = (date) => post('/api/meals', { date });

export const getOrders = (page = 1) => post('/api/orders', { page });

// ─── Dashboard user settings ─────────────────────────────────────────────────

const DASHBOARD_SETTINGS_KEY = 'ssip_dashboard_settings';

/**
 * Reads budget/allowance settings from localStorage. Falls back to the same
 * defaults the Android app uses so the dashboard works out of the box without
 * requiring the user to open Settings first.
 */
function getDashboardSettings() {
  const defaults = {
    missedMealRate: 4.50,
    monthlyBudget: 100.00,
    budgetEnabled: true,
    exemptDates: [],
  };
  const stored = localStorage.getItem(DASHBOARD_SETTINGS_KEY);
  if (!stored) return defaults;
  try {
    const p = JSON.parse(stored);
    return {
      missedMealRate: typeof p.missedMealRate === 'number' ? p.missedMealRate : defaults.missedMealRate,
      monthlyBudget:  typeof p.monthlyBudget  === 'number' ? p.monthlyBudget  : defaults.monthlyBudget,
      budgetEnabled:  typeof p.budgetEnabled  === 'boolean'? p.budgetEnabled  : defaults.budgetEnabled,
      exemptDates:    Array.isArray(p.exemptDates)         ? p.exemptDates    : defaults.exemptDates,
    };
  } catch {
    return defaults;
  }
}

export const getDashboard = () => post('/api/dashboard', getDashboardSettings());

export const placeOrder = (productId, date, orderDetails) =>
  post('/api/place-order', { productId, date, orderDetails });

export const cancelOrder = (cancelUrl) => post('/api/cancel-order', { cancelUrl });
