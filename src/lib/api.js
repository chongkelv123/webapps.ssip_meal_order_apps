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

export const getDashboard = () => post('/api/dashboard');

export const placeOrder = (productId, date, orderDetails) =>
  post('/api/place-order', { productId, date, orderDetails });

export const cancelOrder = (cancelUrl) => post('/api/cancel-order', { cancelUrl });
