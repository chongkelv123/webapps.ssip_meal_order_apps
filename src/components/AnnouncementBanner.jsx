import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Bump the id whenever a new notice should ignore prior dismissals.
const NOTICE_ID = 'maintenance-cafeteria-block-2026-11-17';
const EXPIRES_AT = new Date('2026-12-31T00:00:00');
const STORAGE_KEY = `notice_dismissed_${NOTICE_ID}`;

// Maintenance mode: shown on every page (login included) and not dismissible.
// Set to false, or replace with a normal notice, once the cafeteria block is resolved.
const MAINTENANCE = true;

export default function AnnouncementBanner() {
  const [visible, setVisible] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const dismissed = !MAINTENANCE && localStorage.getItem(STORAGE_KEY);
    if (!dismissed && new Date() < EXPIRES_AT) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;

  if (MAINTENANCE) {
    return (
      <div role="status" className="bg-amber-50 text-amber-900 text-sm px-4 py-2.5 text-center">
        🛠️ Under maintenance: the cafeteria site is currently blocking this app, so login, menus and
        ordering may not work. Please order on the cafeteria website directly for now. Sorry for the trouble.
      </div>
    );
  }

  // Normal notices are shown on the dashboard only.
  if (pathname !== '/dashboard') return null;

  return (
    <div className="bg-emerald-50 text-emerald-800 text-sm px-4 py-2.5 flex items-center justify-center gap-3">
      <span>✅ The server is back and getting faster, and you can now mark missed meals or skip a missed meal.</span>
      <button
        onClick={dismiss}
        aria-label="Dismiss notice"
        className="text-emerald-600 hover:text-emerald-800 shrink-0"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
