// Budget / allowance / skipped / manual-missed settings, stored in localStorage.
// Survives logout (only credentials, cookies and the dashboard cache are cleared).

export const DASHBOARD_SETTINGS_KEY = 'ssip_dashboard_settings';

export const DEFAULT_DASHBOARD_SETTINGS = {
  missedMealRate: 4.5,
  monthlyBudget: 100.0,
  budgetEnabled: true,
  exemptDates: [],
  manualMissedDates: [],
};

/** Reads settings with Android-matching defaults; every field is validated. */
export function loadDashboardSettings() {
  const defaults = { ...DEFAULT_DASHBOARD_SETTINGS, exemptDates: [], manualMissedDates: [] };
  let stored;
  try {
    stored = localStorage.getItem(DASHBOARD_SETTINGS_KEY);
  } catch {
    return defaults;
  }
  if (!stored) return defaults;
  try {
    const p = JSON.parse(stored);
    return {
      missedMealRate: typeof p.missedMealRate === 'number' ? p.missedMealRate : defaults.missedMealRate,
      monthlyBudget: typeof p.monthlyBudget === 'number' ? p.monthlyBudget : defaults.monthlyBudget,
      budgetEnabled: typeof p.budgetEnabled === 'boolean' ? p.budgetEnabled : defaults.budgetEnabled,
      exemptDates: Array.isArray(p.exemptDates) ? p.exemptDates : defaults.exemptDates,
      manualMissedDates: Array.isArray(p.manualMissedDates)
        ? p.manualMissedDates
        : defaults.manualMissedDates,
    };
  } catch {
    return defaults;
  }
}

/** Writes the full settings object (all fields, so none are silently wiped). */
export function saveDashboardSettings(settings) {
  localStorage.setItem(
    DASHBOARD_SETTINGS_KEY,
    JSON.stringify({
      missedMealRate: settings.missedMealRate,
      monthlyBudget: settings.monthlyBudget,
      budgetEnabled: settings.budgetEnabled,
      exemptDates: settings.exemptDates ?? [],
      manualMissedDates: settings.manualMissedDates ?? [],
    })
  );
}
