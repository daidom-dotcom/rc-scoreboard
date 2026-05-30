import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createMatch, deleteMatch, deletePendingQuickMatch, fetchAppSettings, fetchLiveGame, fetchNextMatchNo, findLatestPendingQuick, findPendingQuickMatch, sendMatchSummaryEmail, updateMatch, updateLiveGame, upsertLiveGame, upsertMatchResult } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatTime, todayISOInSaoPaulo } from '../utils/time';
import { loadAppDate, loadSettings, sanitizeSettings, saveAppDate, saveSettings } from '../utils/storage';
import { useAuth } from './AuthContext';

const GameContext = createContext(null);

const defaultSettings = {
  quickDurationSeconds: 7 * 60,
  quickMinPlayersPerTeam: 0,
  alertSeconds: 20,
  defaultTeamA: 'Com Colete',
  defaultTeamB: 'Sem Colete',
  quickTimerScale: 2,
  quickScoreScale: 2,
  quickLogoScale: 1,
  quickMatchLabelScale: 1,
  quickTeamNameScale: 1,
  quickPlayerNameScale: 1,
  quickControlsScale: 1,
  soundEnabled: true,
  theme: 'dark-green'
};

export function GameProvider({ children }) {
  const { user, isScoreboard, isMaster } = useAuth();
  const canControlLive = !!user && isScoreboard;
  const [settings, setSettings] = useState(() => loadSettings() || defaultSettings);
  const [dateISO, setDateISO] = useState(() => loadAppDate() || todayISOInSaoPaulo());

  const quickTeamA = (settings.defaultTeamA || 'Com Colete').trim() || 'Com Colete';
  const quickTeamB = (settings.defaultTeamB || 'Sem Colete').trim() || 'Sem Colete';
  const [mode, setMode] = useState('quick');
  const [matchId, setMatchId] = useState(null);
  const [quarterIndex, setQuarterIndex] = useState(0);
  const [currentDurationSeconds, setCurrentDurationSeconds] = useState(settings.quickDurationSeconds);
  const [totalSeconds, setTotalSeconds] = useState(settings.quickDurationSeconds);
  const [running, setRunning] = useState(false);
  const [ajusteFinalAtivo, setAjusteFinalAtivo] = useState(false);

  const [teamAName, setTeamAName] = useState(quickTeamA);
  const [teamBName, setTeamBName] = useState(quickTeamB);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [basketsA, setBasketsA] = useState({ one: 0, two: 0, three: 0 });
  const [basketsB, setBasketsB] = useState({ one: 0, two: 0, three: 0 });
  const [quickMatchNumber, setQuickMatchNumber] = useState(1);
  const [confirmState, setConfirmState] = useState({ open: false, message: '', resolve: null });
  const [alertState, setAlertState] = useState({ open: false, message: '' });
  const [overtimeState, setOvertimeState] = useState({ open: false, minutes: 10, resolve: null });
  const [lastError, setLastError] = useState(null);
  const [debugTrail, setDebugTrail] = useState([]);
  const [currentMatchQuarters, setCurrentMatchQuarters] = useState(1);
  const [overtimeCount, setOvertimeCount] = useState(0);
  const [currentTournamentId, setCurrentTournamentId] = useState(null);
  const [tournamentSummaryTarget, setTournamentSummaryTarget] = useState(null);

  const intervalRef = useRef(null);
  const currentMatchRef = useRef(null);
  const matchIdRef = useRef(null);
  const scoreARef = useRef(0);
  const scoreBRef = useRef(0);
  const basketsARef = useRef({ one: 0, two: 0, three: 0 });
  const basketsBRef = useRef({ one: 0, two: 0, three: 0 });
  const alertPulseAudioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const finalHornAudioRef = useRef(null);
  const lastAlertSecondRef = useRef(null);
  const lastHornSecondRef = useRef(null);
  const lastResetRef = useRef(null);
  const remoteResetRef = useRef(false);
  const resettingRef = useRef(false);
  const startQuickInFlightRef = useRef(null);
  const liveRestoreRef = useRef(false);
  const lastLiveRestoreAtRef = useRef(0);
  const lastAppliedLiveRef = useRef(null);

  function getActiveDateISO() {
    return dateISO || todayISOInSaoPaulo();
  }

  function isActiveLiveGame(live) {
    return !!live?.match_id && live.status !== 'ended';
  }

  function isActiveTournamentLive(live) {
    return isActiveLiveGame(live) && live.mode === 'tournament';
  }

  function parseLiveTimestampMs(value) {
    const parsed = value ? new Date(value).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function numberOrFallback(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  useEffect(() => {
    matchIdRef.current = matchId;
  }, [matchId]);

  useEffect(() => {
    try {
      const alertAudio = new Audio('/alerta-segundos.wav');
      alertAudio.preload = 'auto';
      alertAudio.volume = 1;
      alertAudio.playsInline = true;
      alertPulseAudioRef.current = alertAudio;
    } catch {
      alertPulseAudioRef.current = null;
    }
    try {
      const hornAudio = new Audio('/corneta-final.mp3');
      hornAudio.preload = 'auto';
      hornAudio.volume = 1;
      hornAudio.playsInline = true;
      finalHornAudioRef.current = hornAudio;
    } catch {
      finalHornAudioRef.current = null;
    }
  }, []);

  async function ensureAudioReady() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }

  function getTournamentPeriodLabel(index = quarterIndex) {
    const regularQuarters = Number(currentMatchRef.current?.quarters || currentMatchQuarters || 1);
    return index < regularQuarters
      ? `Quarter ${index + 1}`
      : `Prorrogação ${Math.max(1, index - regularQuarters + 1)}`;
  }

  function logDebug(message, extra = null) {
    const stamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const line = extra == null
      ? `[${stamp}] ${message}`
      : `[${stamp}] ${message} :: ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
    setDebugTrail((prev) => [...prev.slice(-39), line]);
  }

  function clearDebugTrail() {
    setDebugTrail([]);
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms))
    ]);
  }

  function syncQuickMatch(match, fallbackNo = null) {
    if (!match?.id) return null;
    setMatchId(match.id);
    matchIdRef.current = match.id;
    currentMatchRef.current = match;
    const resolvedNo = Number(match.match_no || fallbackNo || quickMatchNumber || 1);
    if (resolvedNo > 0) setQuickMatchNumber(resolvedNo);
    return match;
  }

  async function createQuickMatch(matchNo) {
    const date = getActiveDateISO();
    const targetNo = Number(matchNo || quickMatchNumber || 1);
    logDebug('createQuickMatch.begin', { date, targetNo });
    const match = await createMatch({
      date_iso: date,
      mode: 'quick',
      team_a_name: quickTeamA,
      team_b_name: quickTeamB,
      quarters: 1,
      durations: [settings.quickDurationSeconds],
      match_no: targetNo,
      status: 'pending'
    });
    logDebug('createQuickMatch.success', { id: match?.id, match_no: match?.match_no });
    return syncQuickMatch(match, targetNo);
  }
  async function playAlarmPulse() {
    try {
      const ctx = await ensureAudioReady();
      if (!ctx) {
        const source = alertPulseAudioRef.current;
        if (!source) return;
        const audio = source.cloneNode(true);
        audio.volume = 1;
        audio.playsInline = true;
        await audio.play();
        return;
      }
      const now = ctx.currentTime;
      const makePulse = (start, fromFreq, toFreq, duration, gainValue, type = 'square') => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = type;
        osc.frequency.setValueAtTime(fromFreq, start);
        osc.frequency.exponentialRampToValueAtTime(toFreq, start + duration);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2200, start);
        filter.Q.setValueAtTime(0.7, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.01);
      };
      makePulse(now, 900, 900, 0.10, 0.8, 'square');
    } catch {
      // ignore audio errors
    }
  }

  async function playFinalHorn() {
    try {
      const ctx = await ensureAudioReady();
      if (ctx) {
        const now = ctx.currentTime;
        const makeHorn = (start, fromFreq, toFreq, duration, gainValue, type = 'sawtooth') => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const filter = ctx.createBiquadFilter();
          osc.type = type;
          osc.frequency.setValueAtTime(fromFreq, start);
          osc.frequency.exponentialRampToValueAtTime(toFreq, start + duration);
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1500, start);
          filter.Q.setValueAtTime(1.1, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.03);
          gain.gain.exponentialRampToValueAtTime(gainValue * 0.88, start + duration * 0.38);
          gain.gain.exponentialRampToValueAtTime(gainValue * 0.72, start + duration * 0.72);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + duration + 0.02);
        };
        makeHorn(now, 340, 320, 1.15, 1.05, 'sawtooth');
        makeHorn(now + 0.02, 510, 480, 1.05, 0.62, 'triangle');
        return;
      }
      const source = finalHornAudioRef.current;
      if (!source) return;
      const audio = source.cloneNode(true);
      audio.volume = 1;
      audio.playsInline = true;
      await audio.play();
    } catch {
      // ignore audio errors
    }
  }

  function triggerClockAudio(second) {
    if (!canControlLive || !running || !settings.soundEnabled) return;
    if (second === 1) {
      if (lastHornSecondRef.current !== 1) {
        lastHornSecondRef.current = 1;
        playFinalHorn();
      }
      return;
    }
    if (second > 1 && second <= settings.alertSeconds && lastAlertSecondRef.current !== second) {
      lastAlertSecondRef.current = second;
      playAlarmPulse();
    }
  }
  async function shouldBlockQuickLiveWrite(payload, source) {
    const payloadMode = payload?.mode || mode;
    if (payloadMode !== 'quick') return false;
    const applied = lastAppliedLiveRef.current;
    if (isActiveTournamentLive(applied)) {
      logDebug('liveWrite.blockQuickLocalTournament', {
        source,
        tournamentMatchId: applied.match_id,
        payloadMatchId: payload?.match_id || null
      });
      return true;
    }
    try {
      const remoteLive = await withTimeout(fetchLiveGame(), 1500, 'fetchLiveGame');
      if (isActiveTournamentLive(remoteLive)) {
        lastAppliedLiveRef.current = remoteLive;
        logDebug('liveWrite.blockQuickRemoteTournament', {
          source,
          tournamentMatchId: remoteLive.match_id,
          tournamentScore: `${remoteLive.score_a || 0}x${remoteLive.score_b || 0}`,
          payloadMatchId: payload?.match_id || null
        });
        return true;
      }
    } catch (err) {
      logDebug('liveWrite.remoteCheckFailed', { source, error: err?.message || 'unknown' });
      return true;
    }
    return false;
  }

  async function guardedUpsertLiveGame(payload, source = 'liveUpsert') {
    if (await shouldBlockQuickLiveWrite(payload, source)) return null;
    return upsertLiveGame(payload);
  }

  async function guardedUpdateLiveGame(payload, source = 'liveUpdate') {
    if (await shouldBlockQuickLiveWrite(payload, source)) return null;
    return updateLiveGame(payload);
  }

  function buildLivePayload(overrides = {}) {
    const applied = lastAppliedLiveRef.current;
    const activeTournament = isActiveTournamentLive(applied);
    const effectiveMode = activeTournament ? 'tournament' : mode;
    const effectiveMatchId = effectiveMode === 'tournament'
      ? (applied?.match_id || currentMatchRef.current?.id || matchId)
      : matchId;
    const effectiveMatchNo = effectiveMode === 'quick'
      ? quickMatchNumber
      : (applied?.match_no || currentMatchRef.current?.match_no || null);
    const effectiveQuarter = effectiveMode === 'tournament'
      ? (mode === 'tournament' ? quarterIndex + 1 : numberOrFallback(applied?.quarter, quarterIndex + 1))
      : quarterIndex + 1;
    const effectiveTeamA = effectiveMode === 'tournament'
      ? (applied?.team_a || teamAName)
      : teamAName;
    const effectiveTeamB = effectiveMode === 'tournament'
      ? (applied?.team_b || teamBName)
      : teamBName;
    const effectiveTimeLeft = totalSeconds;
    return {
      id: 1,
      status: running ? 'running' : 'paused',
      mode: effectiveMode,
      match_id: effectiveMatchId || null,
      match_no: effectiveMatchNo,
      quarter: effectiveQuarter,
      time_left: effectiveTimeLeft,
      team_a: effectiveTeamA,
      team_b: effectiveTeamB,
      score_a: scoreARef.current,
      score_b: scoreBRef.current,
      reset_at: null,
      ...overrides
    };
  }

  async function pushLiveGame(payload) {
    if (!canControlLive) return null;
    if (remoteResetRef.current) return null;
    if (liveRestoreRef.current) return null;
    // Never overwrite quick live with null match_id.
    if (payload?.mode === 'quick' && !payload?.match_id) return null;
    const applied = lastAppliedLiveRef.current;
    const payloadScoreA = numberOrFallback(payload?.score_a, 0);
    const payloadScoreB = numberOrFallback(payload?.score_b, 0);
    const payloadLooksZero = payloadScoreA === 0 && payloadScoreB === 0;
    const appliedScoreA = numberOrFallback(applied?.score_a, 0);
    const appliedScoreB = numberOrFallback(applied?.score_b, 0);
    const appliedHadScore = appliedScoreA !== 0 || appliedScoreB !== 0;
    const appliedIsActive = !!applied?.match_id && applied.status !== 'ended';
    const payloadIsDifferentGame = !!payload?.match_id && !!applied?.match_id && payload.match_id !== applied.match_id;
    const payloadIsSameGame = !!payload?.match_id && !!applied?.match_id && payload.match_id === applied.match_id;
    const justRestoredLive = Date.now() - lastLiveRestoreAtRef.current < 5000;

    if (appliedIsActive && applied.mode === 'tournament' && payload?.mode !== 'tournament') {
      logDebug('pushLiveGame.skipQuickOverTournament', {
        appliedMatchId: applied.match_id,
        payloadMode: payload.mode || null
      });
      return null;
    }

    if (appliedIsActive && payloadIsDifferentGame && payloadLooksZero && payload.status !== 'ended') {
      logDebug('pushLiveGame.skipStaleZeroOverwrite', {
        appliedMode: applied.mode,
        appliedMatchId: applied.match_id,
        payloadMode: payload.mode,
        payloadMatchId: payload.match_id
      });
      return null;
    }

    if (appliedIsActive && payloadIsSameGame && justRestoredLive && payloadLooksZero && appliedHadScore && payload.status !== 'ended') {
      logDebug('pushLiveGame.skipPostRestoreZeroOverwrite', {
        mode: applied.mode,
        matchId: applied.match_id,
        appliedScoreA,
        appliedScoreB
      });
      return null;
    }

    try {
      const written = await guardedUpsertLiveGame(payload, 'pushLiveGame');
      if (written) {
        lastAppliedLiveRef.current = written;
        logDebug('pushLiveGame.written', {
          mode: written.mode,
          match_id: written.match_id || null,
          quarter: written.quarter || null,
          score: `${written.score_a || 0}x${written.score_b || 0}`,
          time_left: written.time_left ?? null
        });
      }
      return written;
    } catch (err) {
      logDebug('pushLiveGame.error', err?.message || 'unknown');
      return null;
    }
  }

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let active = true;
    async function loadRemoteSettings() {
      try {
        const remote = await fetchAppSettings();
        if (!active || !remote) return;
        const merged = sanitizeSettings({
          ...defaultSettings,
          ...settings,
          quickDurationSeconds: Number(remote.quick_duration_seconds ?? settings.quickDurationSeconds ?? defaultSettings.quickDurationSeconds),
          quickMinPlayersPerTeam: Number(remote.quick_min_players_per_team ?? settings.quickMinPlayersPerTeam ?? defaultSettings.quickMinPlayersPerTeam),
          alertSeconds: Number(remote.alert_seconds ?? settings.alertSeconds ?? defaultSettings.alertSeconds),
          soundEnabled: remote.sound_enabled ?? settings.soundEnabled ?? defaultSettings.soundEnabled,
          defaultTeamA: remote.default_team_a ?? settings.defaultTeamA ?? defaultSettings.defaultTeamA,
          defaultTeamB: remote.default_team_b ?? settings.defaultTeamB ?? defaultSettings.defaultTeamB,
          quickTimerScale: Number(remote.quick_timer_scale ?? settings.quickTimerScale ?? defaultSettings.quickTimerScale),
          quickScoreScale: Number(remote.quick_score_scale ?? settings.quickScoreScale ?? defaultSettings.quickScoreScale),
          quickLogoScale: Number(remote.quick_logo_scale ?? settings.quickLogoScale ?? defaultSettings.quickLogoScale),
          quickMatchLabelScale: Number(remote.quick_match_label_scale ?? settings.quickMatchLabelScale ?? defaultSettings.quickMatchLabelScale),
          quickTeamNameScale: Number(remote.quick_team_name_scale ?? settings.quickTeamNameScale ?? defaultSettings.quickTeamNameScale),
          quickPlayerNameScale: Number(remote.quick_player_name_scale ?? settings.quickPlayerNameScale ?? defaultSettings.quickPlayerNameScale),
          quickControlsScale: Number(remote.quick_controls_scale ?? settings.quickControlsScale ?? defaultSettings.quickControlsScale)
        });
        setSettings(merged);
      } catch {
        // fallback local
      }
    }
    loadRemoteSettings();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    saveAppDate(dateISO);
  }, [dateISO]);

  useEffect(() => {
    refreshQuickNumber();
  }, [dateISO]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setTotalSeconds((prev) => {
        if (prev <= 1) {
          triggerClockAudio(1);
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          setRunning(false);
          setTimeout(() => handleTimerEnd(), 0);
          return 0;
        }
        const nextSecond = prev - 1;
        triggerClockAudio(nextSecond);
        return nextSecond;
      });
    }, 1000);

    return () => {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [running]);

  useEffect(() => {
    let active = true;
    async function pollReset() {
      try {
        const live = await fetchLiveGame();
        const resetAt = live?.reset_at ? new Date(live.reset_at).getTime() : null;
        if (resetAt && (!lastResetRef.current || resetAt > lastResetRef.current)) {
          lastResetRef.current = resetAt;
          applyRemoteReset();
        }
      } catch {
        // ignore
      }
    }
    pollReset();
    const t = setInterval(pollReset, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [settings.quickDurationSeconds]);

  useEffect(() => {
    if (mode !== 'quick') return;
    if (!matchId) return;
    pushLiveGame({
      id: 1,
      status: running ? 'running' : 'paused',
      mode: 'quick',
      match_id: matchId || null,
      match_no: quickMatchNumber,
      quarter: 1,
      time_left: totalSeconds,
      team_a: teamAName,
      team_b: teamBName,
      score_a: scoreARef.current,
      score_b: scoreBRef.current,
      reset_at: null
    });
  }, [canControlLive, mode, matchId, quickMatchNumber, running, totalSeconds, teamAName, teamBName, scoreA, scoreB]);

  useEffect(() => {
    let active = true;
    async function hydrateTournamentMatch() {
      if (mode !== 'tournament' || !matchId) return;
      if (currentMatchRef.current?.id === matchId && Number(currentMatchRef.current?.quarters || 0) > 0) return;
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .maybeSingle();
      if (!active || error || !data?.id) return;
      currentMatchRef.current = data;
      setCurrentMatchQuarters(Number(data.quarters || 1));
      setTeamAName(data.team_a_name || data.teamA || 'TIME 1');
      setTeamBName(data.team_b_name || data.teamB || 'TIME 2');
      const currentIndex = Math.max(0, Number(quarterIndex || 0));
      const currentSeconds = Number(data.durations?.[currentIndex] || totalSeconds || settings.quickDurationSeconds);
      setCurrentDurationSeconds(currentSeconds);
    }
    hydrateTournamentMatch();
    return () => {
      active = false;
    };
  }, [mode, matchId, quarterIndex, running, totalSeconds, settings.quickDurationSeconds]);

  useEffect(() => {
    if (running && totalSeconds > 0) return;
    lastAlertSecondRef.current = null;
    lastHornSecondRef.current = null;
  }, [running, totalSeconds, mode, matchId, quarterIndex]);

  function askConfirm(message) {
    return new Promise((resolve) => {
      setConfirmState({ open: true, message, resolve });
    });
  }

  function resolveConfirm(result) {
    if (confirmState.resolve) confirmState.resolve(result);
    setConfirmState({ open: false, message: '', resolve: null });
  }

  function showAlert(message) {
    setAlertState({ open: true, message });
  }

  function askOvertime(defaultMinutes = 10) {
    return new Promise((resolve) => {
      setOvertimeState({ open: true, minutes: defaultMinutes, resolve });
    });
  }

  function resolveOvertime(result) {
    overtimeState.resolve?.(result);
    setOvertimeState({ open: false, minutes: 10, resolve: null });
  }

  function closeAlert() {
    setAlertState({ open: false, message: '' });
  }

  function resetCounters() {
    setScoreA(0);
    setScoreB(0);
    setBasketsA({ one: 0, two: 0, three: 0 });
    setBasketsB({ one: 0, two: 0, three: 0 });
    scoreARef.current = 0;
    scoreBRef.current = 0;
    basketsARef.current = { one: 0, two: 0, three: 0 };
    basketsBRef.current = { one: 0, two: 0, three: 0 };
  }

  async function normalizePendingQuick(date) {
    const { data, error } = await supabase
      .from('matches')
      .select('id,match_no,created_at')
      .eq('date_iso', date)
      .eq('mode', 'quick')
      .eq('status', 'pending')
      .order('match_no', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) return null;
    const list = data || [];
    if (!list.length) return null;
    const keep = list[0];
    const removeIds = list.slice(1).map((m) => m.id);
    if (removeIds.length) {
      await supabase.from('matches').delete().in('id', removeIds);
    }
    return keep;
  }

  async function settlePreviousPendingQuick(date, nextNo) {
    const { data: pendings, error } = await supabase
      .from('matches')
      .select('id,match_no')
      .eq('date_iso', date)
      .eq('mode', 'quick')
      .eq('status', 'pending')
      .lt('match_no', Number(nextNo || 0));
    if (error) return;
    const list = pendings || [];
    if (!list.length) return;
    const ids = list.map((m) => m.id);
    const { data: results } = await supabase
      .from('match_results')
      .select('match_id')
      .in('match_id', ids);
    const doneIds = new Set((results || []).map((r) => r.match_id));
    const toDone = ids.filter((id) => doneIds.has(id));
    const toDelete = ids.filter((id) => !doneIds.has(id));
    if (toDone.length) {
      await supabase.from('matches').update({ status: 'done' }).in('id', toDone);
    }
    if (toDelete.length) {
      await supabase.from('matches').delete().in('id', toDelete);
    }
  }

  async function refreshQuickNumber() {
    try {
      const date = getActiveDateISO();
      logDebug('refreshQuickNumber.begin', { date });
      const live = await withTimeout(fetchLiveGame(), 2500, 'fetchLiveGame').catch(() => null);
      if (isActiveTournamentLive(live)) {
        logDebug('refreshQuickNumber.skipActiveTournament', {
          match_id: live.match_id,
          status: live.status || null
        });
        return Number(quickMatchNumber || 1);
      }
      if (isActiveLiveGame(live)) {
        logDebug('refreshQuickNumber.skipActiveLive', {
          mode: live.mode || null,
          match_id: live.match_id || null,
          status: live.status || null
        });
        if (live.mode === 'quick' && live.match_no) {
          setQuickMatchNumber(Number(live.match_no));
        }
        return Number(live?.match_no || quickMatchNumber || 1);
      }
      if (live?.mode === 'quick' && !live?.match_id) {
        logDebug('refreshQuickNumber.invalidateLiveWithoutMatch', {
          live_match_no: live.match_no || null,
          live_status: live.status || null
        });
        await guardedUpsertLiveGame({
          id: 1,
          status: 'ended',
          mode: 'quick',
          match_id: null,
          match_no: null,
          quarter: 1,
          time_left: 0,
          team_a: '',
          team_b: '',
          score_a: 0,
          score_b: 0,
          reset_at: null
        });
      }
      const pending = await normalizePendingQuick(date) || await findLatestPendingQuick(date);
      if (pending?.match_no) {
        syncQuickMatch(pending, pending.match_no);
        logDebug('refreshQuickNumber.pendingFound', { id: pending.id, match_no: pending.match_no });
        return pending.match_no;
      }
      const next = await fetchNextMatchNo({ dateISO: date, mode: 'quick' });
      setQuickMatchNumber(next);
      logDebug('refreshQuickNumber.nextCalculated', { next });
      return next;
    } catch {
      setQuickMatchNumber(1);
      logDebug('refreshQuickNumber.fallbackTo1');
      return 1;
    }
  }

  function applyRemoteReset() {
    if (resettingRef.current) return;
    resettingRef.current = true;
    remoteResetRef.current = true;
    setRunning(false);
    setAjusteFinalAtivo(false);
    setMode('quick');
    setQuarterIndex(0);
    setTeamAName(quickTeamA);
    setTeamBName(quickTeamB);
    resetCounters();
    setCurrentDurationSeconds(settings.quickDurationSeconds);
    setTotalSeconds(settings.quickDurationSeconds);
    setMatchId(null);
    currentMatchRef.current = null;
    setQuickMatchNumber(1);
    setTimeout(() => {
      resettingRef.current = false;
    }, 1000);
  }

  async function ensureQuickMatch(desiredNo) {
    try {
      if (remoteResetRef.current) return;
      const targetNo = Number(desiredNo || quickMatchNumber || 1);
      logDebug('ensureQuickMatch.begin', {
        targetNo,
        matchId: matchIdRef.current,
        currentMatchNo: currentMatchRef.current?.match_no || null,
        date: getActiveDateISO()
      });
      if (
        matchIdRef.current &&
        currentMatchRef.current?.id === matchIdRef.current &&
        Number(currentMatchRef.current?.match_no || 0) === targetNo
      ) {
        logDebug('ensureQuickMatch.usingCurrent', { matchId: matchIdRef.current, targetNo });
        return currentMatchRef.current;
      }
      const date = getActiveDateISO();
      const normalizedPending = await normalizePendingQuick(date);
      if (normalizedPending) {
        if (targetNo && Number(normalizedPending.match_no || 0) !== targetNo) {
          logDebug('ensureQuickMatch.deleteMismatchedPending', { id: normalizedPending.id, pendingNo: normalizedPending.match_no, targetNo });
          await deleteMatch(normalizedPending.id);
        } else {
          logDebug('ensureQuickMatch.useNormalizedPending', { id: normalizedPending.id, match_no: normalizedPending.match_no });
          return syncQuickMatch(normalizedPending, targetNo);
        }
      }
      const existing = await findPendingQuickMatch(date, targetNo);
      if (existing) {
        logDebug('ensureQuickMatch.useExistingPending', { id: existing.id, match_no: existing.match_no });
        return syncQuickMatch(existing, targetNo);
      }
      const nextNo = targetNo || (await fetchNextMatchNo({ dateISO: date, mode: 'quick' }));
      const match = await createQuickMatch(nextNo);
      logDebug('ensureQuickMatch.created', { id: match?.id, match_no: nextNo });
      pushLiveGame({
        id: 1,
        status: running ? 'running' : 'paused',
        mode: 'quick',
        match_id: match?.id || null,
        match_no: nextNo,
        quarter: 1,
        time_left: totalSeconds,
        team_a: quickTeamA,
        team_b: quickTeamB,
        score_a: scoreARef.current,
        score_b: scoreBRef.current,
        reset_at: null
      });
      return match;
    } catch (err) {
      logDebug('ensureQuickMatch.error', err?.message || 'unknown');
      return null;
    }
  }

  async function startQuick() {
    if (startQuickInFlightRef.current) {
      logDebug('startQuick.reuseInFlight');
      return startQuickInFlightRef.current;
    }
    const run = (async () => {
    clearDebugTrail();
    logDebug('startQuick.begin', { dateISO: getActiveDateISO() });
    let live = null;
    try {
      live = await withTimeout(fetchLiveGame(), 2500, 'fetchLiveGame');
    } catch (err) {
      logDebug('startQuick.liveCheckFailedAbortQuick', err?.message || 'unknown');
      return null;
    }
    if (isActiveTournamentLive(live)) {
      logDebug('startQuick.restoreActiveTournamentInstead', {
        match_id: live.match_id,
        match_no: live.match_no || null,
        status: live.status || null
      });
      applyLiveSnapshot(live);
      return live;
    }
    if (isActiveLiveGame(live) && live.mode === 'quick') {
      logDebug('startQuick.restoreActiveQuickInstead', {
        match_id: live.match_id,
        match_no: live.match_no || null,
        status: live.status || null
      });
      applyLiveSnapshot(live);
      return live;
    }
    setMode('quick');
    setMatchId(null);
    setQuarterIndex(0);
    setTeamAName(quickTeamA);
    setTeamBName(quickTeamB);
    resetCounters();
    setCurrentDurationSeconds(settings.quickDurationSeconds);
    setTotalSeconds(settings.quickDurationSeconds);
    setAjusteFinalAtivo(false);
    setRunning(false);
    remoteResetRef.current = false;
    try {
      const nextNo = await refreshQuickNumber();
      setQuickMatchNumber(nextNo);
      logDebug('startQuick.nextNo', { nextNo });
      const nextMatch = await ensureQuickMatch(nextNo);
      if (nextMatch?.id) {
        logDebug('startQuick.matchReady', { id: nextMatch.id, match_no: nextNo });
        await guardedUpsertLiveGame({
          id: 1,
          status: 'paused',
          mode: 'quick',
          match_id: nextMatch.id,
          match_no: nextNo,
          quarter: 1,
          time_left: settings.quickDurationSeconds,
          team_a: quickTeamA,
          team_b: quickTeamB,
          score_a: 0,
          score_b: 0,
          reset_at: null
        }, 'startQuick.liveReadyUpsert');
        logDebug('startQuick.liveReady', { match_id: nextMatch.id, match_no: nextNo });
      } else {
        logDebug('startQuick.matchMissingAfterEnsure');
      }
    } catch (err) {
      setLastError(err);
      logDebug('startQuick.error', err?.message || 'unknown');
      throw err;
    }
    })();
    startQuickInFlightRef.current = run;
    try {
      return await run;
    } finally {
      startQuickInFlightRef.current = null;
    }
  }

  async function startTournamentMatch(match) {
    if (!match?.id) return;
    try {
      const live = await withTimeout(fetchLiveGame(), 1500, 'fetchLiveGame').catch(() => null);
      if (isActiveTournamentLive(live)) {
        currentMatchRef.current = live.match_id === match.id ? match : currentMatchRef.current;
        setCurrentTournamentId((live.match_id === match.id ? match.tournament_id : currentMatchRef.current?.tournament_id) || null);
        logDebug('startTournamentMatch.restoreActiveLive', {
          requestedMatchId: match.id,
          liveMatchId: live.match_id,
          liveQuarter: live.quarter,
          liveScore: `${live.score_a || 0}x${live.score_b || 0}`
        });
        applyLiveSnapshot(live);
        return;
      }
    } catch (err) {
      logDebug('startTournamentMatch.liveCheckFailed', err?.message || 'unknown');
    }

    setMode('tournament');
    if (match.date_iso) {
      setDateISO(match.date_iso);
    }
    setCurrentTournamentId(match.tournament_id || null);
    setMatchId(match.id);
    setQuarterIndex(0);
    setCurrentMatchQuarters(Number(match.quarters || 1));
    setOvertimeCount(0);
    currentMatchRef.current = match;
    setTeamAName(match.team_a_name || match.teamA || 'TIME 1');
    setTeamBName(match.team_b_name || match.teamB || 'TIME 2');
    resetCounters();
    const initial = match.durations?.[0] || settings.quickDurationSeconds;
    setCurrentDurationSeconds(initial);
    setTotalSeconds(initial);
    setAjusteFinalAtivo(false);
    setRunning(false);
    remoteResetRef.current = false;
    const tournamentLivePayload = {
      id: 1,
      status: 'paused',
      mode: 'tournament',
      match_id: match.id,
      match_no: match.match_no || null,
      quarter: 1,
      time_left: initial,
      team_a: match.team_a_name || match.teamA || 'TIME 1',
      team_b: match.team_b_name || match.teamB || 'TIME 2',
      score_a: 0,
      score_b: 0,
      reset_at: null
    };
    if (user && (isScoreboard || isMaster)) {
      const live = await upsertLiveGame(tournamentLivePayload);
      lastAppliedLiveRef.current = live || tournamentLivePayload;
    }
  }

  async function play() {
    if (!canControlLive) return;
    if (totalSeconds === 0 && ajusteFinalAtivo) return;
    if (remoteResetRef.current) {
      remoteResetRef.current = false;
    }
    setAjusteFinalAtivo(false);
    setRunning(true);
    // Unlock only the WebAudio context on user gesture; do not prime HTMLAudio here.
    // Priming the horn pauses Apple Music on iPad.
    ensureAudioReady().catch(() => {});
    let ensuredQuick = null;
    const restoringTournament = isActiveTournamentLive(lastAppliedLiveRef.current) || mode === 'tournament';
    if (mode === 'quick' && !restoringTournament) {
      ensuredQuick = await ensureQuickMatch();
      if (!ensuredQuick?.id && !matchId) return;
    }
    if (ensuredQuick?.id) {
      setMatchId(ensuredQuick.id);
      matchIdRef.current = ensuredQuick.id;
    }
    pushLiveGame(buildLivePayload({
      status: 'running',
      match_id: restoringTournament
        ? (lastAppliedLiveRef.current?.match_id || currentMatchRef.current?.id || matchId)
        : (ensuredQuick?.id || matchId),
      score_a: scoreARef.current,
      score_b: scoreBRef.current,
      time_left: totalSeconds
    }));
  }

  function pause() {
    if (!canControlLive) return;
    if (remoteResetRef.current) return;
    if (mode === 'quick' && !matchId) return;
    setRunning(false);
    pushLiveGame(buildLivePayload({
      status: 'paused',
      score_a: scoreARef.current,
      score_b: scoreBRef.current,
      time_left: totalSeconds
    }));
  }

  function addPoint(team, value) {
    if (!canControlLive) return;
    const delta = Number(value) || 0;
    const canEdit = running || ajusteFinalAtivo || delta < 0;
    if (!canEdit) return;
    if (remoteResetRef.current) return;

    if (team === 'A') {
      setScoreA((prev) => {
        const nextScore = Math.max(0, prev + delta);
        scoreARef.current = nextScore;
        pushLiveGame(buildLivePayload({
          score_a: nextScore,
          score_b: scoreBRef.current
        }));
        return nextScore;
      });
      setBasketsA((prev) => {
        const next = { ...prev };
        if (delta === 1) next.one += 1;
        if (delta === 2) next.two += 1;
        if (delta === 3) next.three += 1;
        if (delta === -1) {
          if (next.three > 0) next.three -= 1;
          else if (next.two > 0) next.two -= 1;
          else if (next.one > 0) next.one -= 1;
        }
        if (delta === -2 && next.two > 0) next.two -= 1;
        if (delta === -3 && next.three > 0) next.three -= 1;
        basketsARef.current = next;
        return next;
      });
    }

    if (team === 'B') {
      setScoreB((prev) => {
        const nextScore = Math.max(0, prev + delta);
        scoreBRef.current = nextScore;
        pushLiveGame(buildLivePayload({
          score_a: scoreARef.current,
          score_b: nextScore
        }));
        return nextScore;
      });
      setBasketsB((prev) => {
        const next = { ...prev };
        if (delta === 1) next.one += 1;
        if (delta === 2) next.two += 1;
        if (delta === 3) next.three += 1;
        if (delta === -1) {
          if (next.three > 0) next.three -= 1;
          else if (next.two > 0) next.two -= 1;
          else if (next.one > 0) next.one -= 1;
        }
        if (delta === -2 && next.two > 0) next.two -= 1;
        if (delta === -3 && next.three > 0) next.three -= 1;
        basketsBRef.current = next;
        return next;
      });
    }
  }

  async function handleTimerEnd() {
    if (mode === 'tournament') {
      const ok = await askConfirm(`Tempo encerrado! Encerrar ${getTournamentPeriodLabel()}?`);
      if (ok) await advanceQuarterOrFinish();
      else {
        setAjusteFinalAtivo(true);
        showAlert(`${getTournamentPeriodLabel()} ficou em 00:00. Ajuste o placar se precisar e depois continue.`);
      }
    } else {
      const ok = await askConfirm('Tempo encerrado! Deseja encerrar a partida?');
      if (ok) await finishQuick();
      else {
        setAjusteFinalAtivo(true);
        showAlert('Cronômetro ficou em 00:00. Ajuste o placar se precisar e clique em ENCERRAR PARTIDA.');
        pushLiveGame({
          id: 1,
          status: 'paused',
          mode,
          match_id: mode === 'tournament' ? currentMatchRef.current?.id : matchId,
          match_no: mode === 'quick' ? quickMatchNumber : (currentMatchRef.current?.match_no || null),
          quarter: quarterIndex + 1,
          time_left: totalSeconds,
          team_a: teamAName,
          team_b: teamBName,
          score_a: scoreA,
          score_b: scoreB,
          reset_at: null
        });
      }
    }
  }

  async function finishQuick() {
    try {
      logDebug('finishQuick.begin', {
        matchId,
        quickMatchNumber,
        scoreA: Number(scoreARef.current || 0),
        scoreB: Number(scoreBRef.current || 0)
      });
      let ensuredMatch = null;
      if (mode === 'quick' && !matchId) {
        ensuredMatch = await ensureQuickMatch(quickMatchNumber);
      }
      const snapshotScoreA = Number(scoreARef.current || 0);
      const snapshotScoreB = Number(scoreBRef.current || 0);
      const hasNonZeroScore = snapshotScoreA !== 0 || snapshotScoreB !== 0;
      const closingMatchNo = quickMatchNumber;
      const closingMatchId = ensuredMatch?.id || matchId || matchIdRef.current || null;
      const carryEntries = await fetchQuickEntriesForCarry(closingMatchId);

      if (hasNonZeroScore) {
        const savedMatchId = await saveQuickMatch(ensuredMatch?.id || null, {
          scoreA: snapshotScoreA,
          scoreB: snapshotScoreB,
          basketsA: basketsARef.current,
          basketsB: basketsBRef.current
        });
        logDebug('finishQuick.saved', { savedMatchId });
        await trySendSummaryEmail(savedMatchId);
      } else if (matchId) {
        // 0x0 should not pollute history/results: discard the open quick match.
        await deleteMatch(matchId);
        logDebug('finishQuick.deletedZeroZero', { matchId });
        setMatchId(null);
        matchIdRef.current = null;
        currentMatchRef.current = null;
      }

      await guardedUpdateLiveGame({
        status: 'ended',
        match_no: closingMatchNo,
        time_left: 0,
        score_a: snapshotScoreA,
        score_b: snapshotScoreB
      });
      await prepareNextQuick(false, closingMatchNo + 1, carryEntries);
      logDebug('finishQuick.nextPrepared', { nextNo: closingMatchNo + 1 });
    } catch (err) {
      setLastError(err);
      logDebug('finishQuick.error', err?.message || 'unknown');
      showAlert(err.message || 'Erro ao salvar partida rápida.');
    }
  }

  async function fetchQuickEntriesForCarry(sourceMatchId) {
    if (!sourceMatchId) return [];
    try {
      const { data, error } = await supabase
        .from('player_entries')
        .select('user_id,player_name,team_side')
        .eq('match_id', sourceMatchId);
      if (error) throw error;
      return data || [];
    } catch (err) {
      logDebug('quickEntriesCarry.readError', err?.message || 'unknown');
      return [];
    }
  }

  async function copyQuickEntriesToMatch(entries, targetMatchId, targetDate) {
    if (!targetMatchId || !entries?.length) return;
    try {
      const seen = new Set();
      const payload = entries
        .filter((entry) => {
          const key = entry.user_id ? `user:${entry.user_id}` : `guest:${String(entry.player_name || '').trim().toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((entry) => ({
          match_id: targetMatchId,
          user_id: entry.user_id || null,
          player_name: entry.player_name,
          team_side: entry.team_side,
          date_iso: targetDate
        }));
      if (!payload.length) return;
      const { error } = await supabase.from('player_entries').insert(payload);
      if (error) throw error;
      logDebug('quickEntriesCarry.copied', { count: payload.length, targetMatchId });
    } catch (err) {
      logDebug('quickEntriesCarry.copyError', err?.message || 'unknown');
    }
  }

  async function prepareNextQuick(resetDay = false, forcedNextNo = null, carryEntries = []) {
    setAjusteFinalAtivo(false);
    setRunning(false);
    setCurrentDurationSeconds(settings.quickDurationSeconds);
    setTotalSeconds(settings.quickDurationSeconds);
    resetCounters();
    const dbNext = resetDay
      ? 1
      : await fetchNextMatchNo({ dateISO: getActiveDateISO(), mode: 'quick' });
    const localNext = forcedNextNo || (quickMatchNumber + 1);
    // When a match has just been finalized, trust the explicit n+1 to avoid
    // jumping to n+2 if a temporary pending row was already observed.
    const nextNo = resetDay ? 1 : (forcedNextNo || Math.max(localNext, dbNext));
    const date = getActiveDateISO();
    if (!resetDay && nextNo > 1) {
      await settlePreviousPendingQuick(date, nextNo);
    }
    // Guarantee a fresh match_id per new quick match number.
    await deletePendingQuickMatch(date, nextNo).catch(() => {});
    setQuickMatchNumber(nextNo);
    setMatchId(null);
    matchIdRef.current = null;
    currentMatchRef.current = null;
    const nextMatch = await ensureQuickMatch(nextNo);
    if (!nextMatch?.id) return;
    await copyQuickEntriesToMatch(carryEntries, nextMatch.id, date);
    guardedUpdateLiveGame({
      status: 'paused',
      match_id: nextMatch.id,
      match_no: nextNo,
      time_left: settings.quickDurationSeconds,
      score_a: 0,
      score_b: 0
    });
  }

  async function saveQuickMatch(forcedMatchId = null, snapshot = null) {
    try {
      const sA = Number(snapshot?.scoreA ?? scoreARef.current ?? scoreA ?? 0);
      const sB = Number(snapshot?.scoreB ?? scoreBRef.current ?? scoreB ?? 0);
      const bA = snapshot?.basketsA || basketsARef.current || basketsA;
      const bB = snapshot?.basketsB || basketsBRef.current || basketsB;
      const totalC1 = Number(bA.one || 0) + Number(bB.one || 0);
      const totalC2 = Number(bA.two || 0) + Number(bB.two || 0);
      const totalC3 = Number(bA.three || 0) + Number(bB.three || 0);
      let id = forcedMatchId || matchId;
      if (!id) {
        const match = await createQuickMatch(quickMatchNumber);
        id = match.id;
      }

      await upsertMatchResult({
        match_id: id,
        score_a: sA,
        score_b: sB,
        baskets1: totalC1,
        baskets2: totalC2,
        baskets3: totalC3,
        finished_at: new Date().toISOString()
      });

      await updateMatch(id, { status: 'done', match_no: quickMatchNumber });
      return id;
    } catch (err) {
      setLastError(err);
      throw err;
    }
  }

  async function trySendSummaryEmail(matchIdToSend) {
    if (!matchIdToSend) return;
    try {
      await sendMatchSummaryEmail(matchIdToSend);
    } catch (err) {
      setLastError(err);
    }
  }

  async function advanceQuarterOrFinish() {
    const match = currentMatchRef.current;
    if (!match) return;

    const regularQuarters = Number(match.quarters || currentMatchQuarters || 1);
    const isRegularQuarter = quarterIndex < regularQuarters;
    const isLastRegularQuarter = quarterIndex === (regularQuarters - 1);

    if (!isRegularQuarter || isLastRegularQuarter) {
      const overtimeMinutes = await askOvertime(10);
      if (!overtimeMinutes) {
        await finishTournamentMatch(true);
        return;
      }
      const overtimeSeconds = Math.max(60, Number(overtimeMinutes) * 60);
      const nextIndex = quarterIndex + 1;
      setQuarterIndex(nextIndex);
      setOvertimeCount(Math.max(1, nextIndex - regularQuarters + 1));
      currentMatchRef.current = {
        ...match,
        durations: [...(match.durations || []), overtimeSeconds]
      };
      await updateMatch(match.id, { durations: currentMatchRef.current.durations });
      setCurrentDurationSeconds(overtimeSeconds);
      setTotalSeconds(overtimeSeconds);
      setAjusteFinalAtivo(false);
      const nextLive = {
        id: 1,
        status: 'paused',
        mode,
        match_id: currentMatchRef.current?.id,
        match_no: currentMatchRef.current?.match_no || null,
        quarter: nextIndex + 1,
        time_left: overtimeSeconds,
        team_a: teamAName,
        team_b: teamBName,
        score_a: scoreARef.current,
        score_b: scoreBRef.current,
        reset_at: null
      };
      lastAppliedLiveRef.current = { ...(lastAppliedLiveRef.current || {}), ...nextLive };
      pushLiveGame(nextLive);
      return;
    }

    const nextIndex = quarterIndex + 1;
    setQuarterIndex(nextIndex);
    const nextDur = match.durations?.[nextIndex] || settings.quickDurationSeconds;
    setCurrentDurationSeconds(nextDur);
    setTotalSeconds(nextDur);
    setAjusteFinalAtivo(false);
    const nextLive = {
      id: 1,
      status: 'paused',
      mode,
      match_id: mode === 'tournament' ? currentMatchRef.current?.id : matchId,
      match_no: mode === 'quick' ? quickMatchNumber : (currentMatchRef.current?.match_no || null),
      quarter: nextIndex + 1,
      time_left: nextDur,
      team_a: teamAName,
      team_b: teamBName,
      score_a: scoreARef.current,
      score_b: scoreBRef.current,
      reset_at: null
    };
    lastAppliedLiveRef.current = { ...(lastAppliedLiveRef.current || {}), ...nextLive };
    pushLiveGame(nextLive);
  }

  function resetTimer() {
    if (!canControlLive) return;
    setRunning(false);
    setAjusteFinalAtivo(false);
    setTotalSeconds(currentDurationSeconds);
    pushLiveGame({
      id: 1,
      status: 'paused',
      mode,
      match_id: mode === 'tournament' ? currentMatchRef.current?.id : matchId,
      match_no: mode === 'quick' ? quickMatchNumber : (currentMatchRef.current?.match_no || null),
      quarter: quarterIndex + 1,
      time_left: currentDurationSeconds,
      team_a: teamAName,
      team_b: teamBName,
      score_a: scoreA,
      score_b: scoreB,
      reset_at: null
    });
  }

  function endLiveGame() {
    pushLiveGame({
      id: 1,
      status: 'ended',
      mode,
      match_id: mode === 'tournament' ? currentMatchRef.current?.id : matchId,
      match_no: mode === 'quick' ? quickMatchNumber : (currentMatchRef.current?.match_no || null),
      quarter: quarterIndex + 1,
      time_left: 0,
      team_a: teamAName,
      team_b: teamBName,
      score_a: scoreA,
      score_b: scoreB,
      reset_at: null
    });
  }

  async function prepareNextTournamentMatch() {
    const currentMatch = currentMatchRef.current;
    const tournamentId = currentMatch?.tournament_id || null;
    if (!tournamentId) return false;
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .eq('status', 'pending')
      .order('match_no', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data?.id) return false;
    await startTournamentMatch(data);
    return true;
  }

  async function finishTournamentMatch(silent = false) {
    const match = currentMatchRef.current;
    if (!match) return;
    const finalScoreA = Number(scoreARef.current ?? scoreA ?? 0);
    const finalScoreB = Number(scoreBRef.current ?? scoreB ?? 0);
    const finalBasketsA = basketsARef.current || basketsA;
    const finalBasketsB = basketsBRef.current || basketsB;

    if (finalScoreA === 0 && finalScoreB === 0) {
      try {
        await deleteMatch(match.id);
        pushLiveGame({
          id: 1,
          status: 'ended',
          mode,
          match_id: null,
          match_no: mode === 'quick' ? quickMatchNumber : (currentMatchRef.current?.match_no || null),
          quarter: quarterIndex + 1,
          time_left: 0,
          team_a: teamAName,
          team_b: teamBName,
          score_a: finalScoreA,
          score_b: finalScoreB,
          reset_at: null
        });
        if (!silent) showAlert('Partida 0x0 removida.');
        const startedNext = await prepareNextTournamentMatch();
        if (!startedNext && match.tournament_id) setTournamentSummaryTarget(match.tournament_id);
        return startedNext;
      } catch (err) {
        setLastError(err);
        showAlert(err.message || 'Erro ao remover partida 0x0.');
      }
      return false;
    }

    const totalC1 = Number(finalBasketsA.one || 0) + Number(finalBasketsB.one || 0);
    const totalC2 = Number(finalBasketsA.two || 0) + Number(finalBasketsB.two || 0);
    const totalC3 = Number(finalBasketsA.three || 0) + Number(finalBasketsB.three || 0);

    try {
      await upsertMatchResult({
        match_id: match.id,
        score_a: finalScoreA,
        score_b: finalScoreB,
        baskets1: totalC1,
        baskets2: totalC2,
        baskets3: totalC3,
        finished_at: new Date().toISOString()
      });
      await updateMatch(match.id, { status: 'done' });
      await trySendSummaryEmail(match.id);

      pushLiveGame({
        id: 1,
        status: 'ended',
        mode,
        match_id: mode === 'tournament' ? currentMatchRef.current?.id : matchId,
        match_no: mode === 'quick' ? quickMatchNumber : (currentMatchRef.current?.match_no || null),
        quarter: quarterIndex + 1,
        time_left: 0,
        team_a: teamAName,
        team_b: teamBName,
        score_a: finalScoreA,
        score_b: finalScoreB,
        reset_at: null
      });

      if (!silent) {
        showAlert('Partida salva no Torneio!');
      }
      const startedNext = await prepareNextTournamentMatch();
      if (!startedNext && match.tournament_id) setTournamentSummaryTarget(match.tournament_id);
      return startedNext;
    } catch (err) {
      setLastError(err);
      showAlert(err.message || 'Erro ao salvar partida do torneio.');
    }
    return false;
  }

  async function saveCurrentIfNeeded() {
    if (Number(scoreARef.current || 0) === 0 && Number(scoreBRef.current || 0) === 0) return;
    if (mode === 'quick') {
      try {
        const ensuredMatch = matchId ? null : await ensureQuickMatch(quickMatchNumber);
        const savedMatchId = await saveQuickMatch(ensuredMatch?.id || null, {
          scoreA: Number(scoreARef.current || 0),
          scoreB: Number(scoreBRef.current || 0),
          basketsA: basketsARef.current,
          basketsB: basketsBRef.current
        });
        await trySendSummaryEmail(savedMatchId);
      } catch (err) {
        setLastError(err);
        showAlert(err.message || 'Erro ao salvar partida.');
      }
    } else {
      await finishTournamentMatch(true);
    }
  }

  function clearGameState() {
    setRunning(false);
    setAjusteFinalAtivo(false);
    setTotalSeconds(currentDurationSeconds);
    setOvertimeCount(0);
    resetCounters();
  }

  function applyLiveSnapshot(live) {
    if (!live) return;
    if (live.reset_at) return;
    liveRestoreRef.current = true;
    lastLiveRestoreAtRef.current = Date.now();
    lastAppliedLiveRef.current = live;

    const liveMode = live.mode || 'quick';
    const isQuick = liveMode === 'quick';
    const period = Math.max(1, numberOrFallback(live.quarter, 1));
    const periodIndex = period - 1;
    const liveScoreA = numberOrFallback(live.score_a, 0);
    const liveScoreB = numberOrFallback(live.score_b, 0);
    const baseTimeLeft = numberOrFallback(live.time_left, settings.quickDurationSeconds);
    const elapsedSinceWrite = live.status === 'running'
      ? Math.max(0, Math.floor((Date.now() - parseLiveTimestampMs(live.updated_at)) / 1000))
      : 0;
    const restoredTimeLeft = Math.max(0, baseTimeLeft - elapsedSinceWrite);
    const matchDuration = numberOrFallback(
      currentMatchRef.current?.durations?.[periodIndex],
      numberOrFallback(currentDurationSeconds, Math.max(restoredTimeLeft, settings.quickDurationSeconds))
    );
    const durationForPeriod = isQuick ? settings.quickDurationSeconds : Math.max(matchDuration, restoredTimeLeft);

    setMode(liveMode);
    setQuarterIndex(periodIndex);
    const regularQuarters = Number(currentMatchRef.current?.quarters || currentMatchQuarters || 1);
    setCurrentMatchQuarters(regularQuarters);
    setOvertimeCount(isQuick ? 0 : Math.max(0, period - regularQuarters));
    const fallbackA = isQuick ? quickTeamA : (currentMatchRef.current?.team_a_name || currentMatchRef.current?.teamA || teamAName || 'TIME 1');
    const fallbackB = isQuick ? quickTeamB : (currentMatchRef.current?.team_b_name || currentMatchRef.current?.teamB || teamBName || 'TIME 2');
    // In quick mode, names are fixed and must never fallback to TIME 1/TIME 2.
    setTeamAName(isQuick ? quickTeamA : (live.team_a || fallbackA));
    setTeamBName(isQuick ? quickTeamB : (live.team_b || fallbackB));
    setScoreA(liveScoreA);
    setScoreB(liveScoreB);
    scoreARef.current = liveScoreA;
    scoreBRef.current = liveScoreB;
    setTotalSeconds(restoredTimeLeft);
    setCurrentDurationSeconds(durationForPeriod);
    setMatchId(live.match_id || null);
    matchIdRef.current = live.match_id || null;
    if (live.match_no != null) setQuickMatchNumber(Number(live.match_no));
    setAjusteFinalAtivo(false);
    setRunning(live.status === 'running');
    setTimeout(() => {
      liveRestoreRef.current = false;
    }, 1500);
  }

  const value = useMemo(() => ({
    settings,
    setSettings,
    dateISO,
    setDateISO,
    mode,
    matchId,
    quarterIndex,
    currentMatchQuarters,
    overtimeCount,
    currentTournamentId,
    tournamentSummaryTarget,
    totalSeconds,
    running,
    ajusteFinalAtivo,
    teamAName,
    teamBName,
    scoreA,
    scoreB,
    basketsA,
    basketsB,
    quickMatchNumber,
    formatTime,
    startQuick,
    startTournamentMatch,
    play,
    pause,
    addPoint,
    resetTimer,
    finishQuick,
    finishTournamentMatch,
    advanceQuarterOrFinish,
    endLiveGame,
    clearGameState,
    applyRemoteReset,
    applyLiveSnapshot,
    saveCurrentIfNeeded,
    confirmState,
    askConfirm,
    resolveConfirm,
    overtimeState,
    resolveOvertime,
    alertState,
    showAlert,
    closeAlert,
    setTournamentSummaryTarget,
    lastError,
    debugTrail,
    logDebug,
    clearDebugTrail
  }), [
    settings,
    dateISO,
    mode,
    matchId,
    quarterIndex,
    totalSeconds,
    running,
    ajusteFinalAtivo,
    teamAName,
    teamBName,
    scoreA,
    scoreB,
    basketsA,
    basketsB,
    quickMatchNumber,
    currentDurationSeconds,
    confirmState,
    alertState,
    lastError,
    debugTrail,
    applyRemoteReset,
    applyLiveSnapshot
  ]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  return useContext(GameContext);
}
