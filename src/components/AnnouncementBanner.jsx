import { useState, useEffect } from 'react';

// Bump the id whenever a new notice should ignore prior dismissals.
const NOTICE_ID = 'login-fixed-2026-07-14';
const EXPIRES_AT = new Date('2026-07-28T00:00:00');
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
    <div className="bg-emerald-50 text-emerald-800 text-sm px-4 py-2.5 flex items-center justify-center gap-3">
      <span>✅ Login is working again — the sign-in issue has been fixed. Thanks for your patience!</span>
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
