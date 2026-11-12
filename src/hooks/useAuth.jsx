import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import posthog from 'posthog-js';
import { useQueryClient } from '@tanstack/react-query';
import { login as apiLogin } from '../lib/api.js';
import { clearDashboardCache } from '../lib/dashboardCache.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return !!localStorage.getItem('wc_session_cookies');
  });

  // Listen for session-expired events dispatched by lib/api.js
  useEffect(() => {
    // Recovery already failed (or no saved credentials): drop the cached figures
    // so the next sign-in, possibly a different account, never sees them.
    const handler = () => {
      clearDashboardCache();
      queryClient.clear();
      setIsLoggedIn(false);
      navigate('/login', { replace: true });
    };
    window.addEventListener('session-expired', handler);
    return () => window.removeEventListener('session-expired', handler);
  }, [navigate, queryClient]);

  const login = useCallback(async (username, password, rememberMe) => {
    const data = await apiLogin(username, password);
    localStorage.setItem('wc_session_cookies', JSON.stringify(data.cookies));
    posthog.identify(username);
    setIsLoggedIn(true);

    if (rememberMe) {
      localStorage.setItem('wc_credentials', JSON.stringify({ username, password }));
    } else {
      localStorage.removeItem('wc_credentials');
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('wc_session_cookies');
    localStorage.removeItem('wc_credentials');
    // Dashboard cache goes; budget / rate / skipped / manual settings stay.
    clearDashboardCache();
    queryClient.clear();
    posthog.reset();
    setIsLoggedIn(false);
    navigate('/login', { replace: true });
  }, [navigate, queryClient]);

  return (
    <AuthContext.Provider value={{ isLoggedIn, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
