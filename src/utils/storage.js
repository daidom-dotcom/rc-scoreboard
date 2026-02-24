const SETTINGS_KEY = 'rc_settings_v1';
const APP_DATE_KEY = 'rc_app_date_v1';
const QUICK_COUNTER_KEY = 'rc_quick_counter_v1';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadAppDate() {
  return localStorage.getItem(APP_DATE_KEY) || null;
}

export function saveAppDate(dateISO) {
  localStorage.setItem(APP_DATE_KEY, dateISO);
}

export function loadQuickCounter() {
  try {
    const raw = localStorage.getItem(QUICK_COUNTER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveQuickCounter(payload) {
  localStorage.setItem(QUICK_COUNTER_KEY, JSON.stringify(payload));
}
