const TOURNAMENT_KEY = 'rc_current_tournament_v1';

export function loadCurrentTournamentId() {
  return localStorage.getItem(TOURNAMENT_KEY) || null;
}

export function saveCurrentTournamentId(id) {
  if (!id) return;
  localStorage.setItem(TOURNAMENT_KEY, id);
}

export function clearCurrentTournamentId() {
  localStorage.removeItem(TOURNAMENT_KEY);
}
