// Last complete dashboard scrape, persisted so a reopened app can paint instantly.
//
// Stores RAW data only (order rows, wallet balance, a clock offset and a
// timestamp). Derived figures are recomputed on every render, so a settings
// change or the midnight rollover can never leave stale numbers behind.

export const DASHBOARD_CACHE_KEY = 'ssip_dashboard_cache';
const CACHE_VERSION = 1;

/** Returns the raw dashboard data or null. Never throws. */
export function readDashboardCache() {
  try {
    const stored = localStorage.getItem(DASHBOARD_CACHE_KEY);
    if (!stored) return null;
    const c = JSON.parse(stored);
    if (c?.v !== CACHE_VERSION || !Array.isArray(c.orders) || typeof c.fetchedAt !== 'number') {
      return null;
    }
    return {
      orders: c.orders,
      walletBalance: typeof c.walletBalance === 'number' ? c.walletBalance : null,
      clockOffsetMs: typeof c.clockOffsetMs === 'number' ? c.clockOffsetMs : 0,
      fetchedAt: c.fetchedAt,
    };
  } catch {
    return null;
  }
}

/** Call only with data from a complete scrape. Quota errors are ignored. */
export function writeDashboardCache(raw) {
  try {
    localStorage.setItem(
      DASHBOARD_CACHE_KEY,
      JSON.stringify({
        v: CACHE_VERSION,
        orders: raw.orders,
        walletBalance: raw.walletBalance,
        clockOffsetMs: raw.clockOffsetMs,
        fetchedAt: raw.fetchedAt,
      })
    );
  } catch {
    /* cache is best-effort */
  }
}

export function clearDashboardCache() {
  try {
    localStorage.removeItem(DASHBOARD_CACHE_KEY);
  } catch {
    /* ignore */
  }
}
