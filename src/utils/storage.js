const SETTINGS_KEY = 'rc_settings_v1';
const APP_DATE_KEY = 'rc_app_date_v1';
const QUICK_COUNTER_KEY = 'rc_quick_counter_v1';

export function sanitizeQuickTeamName(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const normalized = raw.replace(/\s+/g, ' ');
  if (/^com colete\d+$/i.test(normalized)) return 'Com Colete';
  if (/^sem colete\d+$/i.test(normalized)) return 'Sem Colete';
  return normalized;
}

function sanitizeScale(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(0.4, n));
}

export function sanitizeSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  return {
    ...settings,
    quickMinPlayersPerTeam: Math.max(0, Number(settings.quickMinPlayersPerTeam || 0)),
    defaultTeamA: sanitizeQuickTeamName(settings.defaultTeamA, 'Com Colete'),
    defaultTeamB: sanitizeQuickTeamName(settings.defaultTeamB, 'Sem Colete'),
    quickTimerScale: sanitizeScale(settings.quickTimerScale, 2),
    quickScoreScale: sanitizeScale(settings.quickScoreScale, 2),
    quickLogoScale: sanitizeScale(settings.quickLogoScale, 1),
    quickMatchLabelScale: sanitizeScale(settings.quickMatchLabelScale, 1),
    quickTeamNameScale: sanitizeScale(settings.quickTeamNameScale, 1),
    quickPlayerNameScale: sanitizeScale(settings.quickPlayerNameScale, 1),
    quickControlsScale: sanitizeScale(settings.quickControlsScale, 1),
    scoringPositiveButtonScale: sanitizeScale(settings.scoringPositiveButtonScale, 1),
    scoringNegativeButtonScale: sanitizeScale(settings.scoringNegativeButtonScale, 1)
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
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

export function clearQuickCounter() {
  localStorage.removeItem(QUICK_COUNTER_KEY);
}
