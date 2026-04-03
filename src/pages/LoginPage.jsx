import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export default function LoginPage() {
  const { isLoggedIn, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoLogging, setAutoLogging] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (isLoggedIn) navigate('/dashboard', { replace: true });
  }, [isLoggedIn, navigate]);

  // Auto-login if saved credentials exist
  useEffect(() => {
    const saved = localStorage.getItem('wc_credentials');
    if (!saved) return;

    const { username: u, password: p } = JSON.parse(saved);
    if (!u || !p) return;

    setUsername(u);
    setPassword(p);
    setRememberMe(true);
    setAutoLogging(true);

    login(u, p, true)
      .then(() => navigate('/dashboard', { replace: true }))
      .catch((err) => {
        setError(err.message);
        setAutoLogging(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password, rememberMe);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (autoLogging) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-white">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
        <p className="text-gray-500 text-sm">Signing you in…</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-white px-6">
      {/* Logo / Title */}
      <div className="mb-8 text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg viewBox="0 0 24 24" fill="white" className="w-9 h-9">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
            <path d="M11 8h2v8h-2zM7 10.5C7 9.12 8.12 8 9.5 8S12 9.12 12 10.5 10.88 13 9.5 13 7 11.88 7 10.5z" opacity="0"/>
          </svg>
          <span className="text-white text-2xl font-bold">S</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">SSIP Meal Order</h1>
        <p className="text-gray-500 text-sm mt-1">Sign in to your cafeteria account</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Username</label>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="w-full px-4 py-3 bg-gray-100 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            placeholder="Enter your username"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-3 bg-gray-100 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            placeholder="Enter your password"
          />
        </div>

        {/* Remember me */}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setRememberMe((v) => !v)}
              className={`w-10 h-6 rounded-full transition-colors relative ${rememberMe ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${rememberMe ? 'translate-x-5' : 'translate-x-1'}`}
              />
            </div>
            <span className="text-sm text-gray-700">Remember me</span>
          </label>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl disabled:opacity-60 active:bg-blue-700 transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      <div className="flex gap-4 mt-8">
        <Link to="/about" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">About</Link>
        <Link to="/contact" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Contact Us</Link>
      </div>
    </div>
  );
}
