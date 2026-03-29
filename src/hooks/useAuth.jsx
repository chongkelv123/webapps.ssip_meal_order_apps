import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { login as apiLogin } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();

  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return !!localStorage.getItem('wc_session_cookies');
  });

  // Listen for session-expired events dispatched by lib/api.js
  useEffect(() => {
    const handler = () => {
      setIsLoggedIn(false);
      navigate('/login', { replace: true });
    };
    window.addEventListener('session-expired', handler);
    return () => window.removeEventListener('session-expired', handler);
  }, [navigate]);

  const login = useCallback(async (username, password, rememberMe) => {
    const data = await apiLogin(username, password);
    localStorage.setItem('wc_session_cookies', JSON.stringify(data.cookies));
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
    setIsLoggedIn(false);
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ isLoggedIn, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
