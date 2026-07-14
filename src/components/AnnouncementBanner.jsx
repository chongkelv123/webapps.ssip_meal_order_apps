import { useState, useEffect } from 'react';

// Bump the id whenever a new notice should ignore prior dismissals.
const NOTICE_ID = 'login-blocked-2026-07-14';
const EXPIRES_AT = new Date('2026-08-01T00:00:00');
const STORAGE_KEY = `notice_dismissed_${NOTICE_ID}`;

export default function AnnouncementBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed && new Date() < EXPIRES_AT) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="bg-amber-50 text-amber-800 text-sm px-4 py-2.5 flex items-center justify-center gap-3">
      <span>⚠️ The cafeteria site is currently blocking sign-in attempts from our web app. This is not a wrong password — we're working on it.</span>
      <button
        onClick={dismiss}
        aria-label="Dismiss notice"
        className="text-amber-600 hover:text-amber-800 shrink-0"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
