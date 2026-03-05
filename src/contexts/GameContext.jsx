import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createMatch, deleteMatch, fetchLiveGame, fetchNextMatchNo, findLatestPendingQuick, findPendingQuickMatch, updateMatch, updateLiveGame, upsertLiveGame, upsertMatchResult } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatTime, todayISO } from '../utils/time';
import { loadAppDate, loadSettings, saveAppDate, saveSettings } from '../utils/storage';
import { useAuth } from './AuthContext';

const GameContext = createContext(null);

const defaultSettings = {
  quickDurationSeconds: 7 * 60,
  alertSeconds: 20,
  defaultTeamA: 'Com Colete',
  defaultTeamB: 'Sem Colete',
  soundEnabled: true,
  theme: 'dark-green'
};
export function GameProvider({ children }) {
  const { user, isScoreboard } = useAuth();
  const canControlLive = !!user && isScoreboard;
  const [settings, setSettings] = useState(() => loadSettings() || defaultSettings);
  const [dateISO, setDateISO] = useState(() => loadAppDate() || todayISO());

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
  const [lastError, setLastError] = useState(null);

  const intervalRef = useRef(null);
  const currentMatchRef = useRef(null);
  const scoreARef = useRef(0);
  const scoreBRef = useRef(0);
  const basketsARef = useRef({ one: 0, two: 0, three: 0 });
  const basketsBRef = useRef({ one: 0, two: 0, three: 0 });
  const beepIntervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastAlertSecondRef = useRef(null);
  const lastResetRef = useRef(null);
  const remoteResetRef = useRef(false);
  const resettingRef = useRef(false);
  const repairingMatchIdRef = useRef(false);
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
  function pushLiveGame(payload) {
    if (!canControlLive) return Promise.resolve(null);
    if (remoteResetRef.current) return Promise.resolve(null);
    // Never overwrite quick live with null match_id.
    if (payload?.mode === 'quick' && !payload?.match_id) return Promise.resolve(null);
    return upsertLiveGame(payload).catch(() => {});
  }

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

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
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          setRunning(false);
          setTimeout(() => handleTimerEnd(), 0);
          return 0;
        }
        return prev - 1;
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
      score_a: scoreA,
      score_b: scoreB,
      reset_at: null
    });
  }, [canControlLive, mode, matchId, quickMatchNumber, running, totalSeconds, teamAName, teamBName, scoreA, scoreB]);

  useEffect(() => {
    if (!canControlLive) return;
    if (mode !== 'quick') return;
    if (matchId) return;
    if (!quickMatchNumber) return;
    if (repairingMatchIdRef.current) return;
    let active = true;
    repairingMatchIdRef.current = true;
    async function repairQuickMatchId() {
      try {
        const date = dateISO || todayISO();
        let found = await findPendingQuickMatch(date, quickMatchNumber);
        if (!found) {
          found = await findLatestPendingQuick(date);
        }
        if (!active || !found?.id) return;
        setMatchId(found.id);
        currentMatchRef.current = found;
        if (found.match_no) setQuickMatchNumber(found.match_no);
        await updateLiveGame({
          id: 1,
          mode: 'quick',
          match_id: found.id,
          match_no: found.match_no || quickMatchNumber,
          status: running ? 'running' : 'paused',
          quarter: 1,
          time_left: totalSeconds,
          team_a: quickTeamA,
          team_b: quickTeamB,
          score_a: scoreARef.current,
          score_b: scoreBRef.current,
          reset_at: null
        });
      } catch {
        // ignore repair noise
      } finally {
        repairingMatchIdRef.current = false;
      }
    }
    repairQuickMatchId();
    return () => {
      active = false;
      repairingMatchIdRef.current = false;
    };
  }, [canControlLive, mode, matchId, quickMatchNumber, dateISO, running, totalSeconds, quickTeamA, quickTeamB]);

  useEffect(() => {
    const shouldBeep = canControlLive && running && totalSeconds > 0 && totalSeconds <= settings.alertSeconds;
    if (!shouldBeep) {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current);
        beepIntervalRef.current = null;
      }
      lastAlertSecondRef.current = null;
      return;
    }

    const playAlarmPulse = async () => {
      try {
        const ctx = await ensureAudioReady();
        if (!ctx) return;
        const now = ctx.currentTime;
        const makeHorn = (start, freq, duration, gainValue) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(gainValue * 0.8, start + (duration * 0.5));
          gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + duration + 0.01);
        };
        // Louder layered horn.
        makeHorn(now, 460, 0.50, 0.85);
        makeHorn(now, 690, 0.50, 0.62);
        makeHorn(now + 0.06, 920, 0.38, 0.36);
      } catch {
        // ignore audio errors
      }
    };

    // Ensure immediate trigger exactly when entering alert window.
    if (lastAlertSecondRef.current !== totalSeconds) {
      lastAlertSecondRef.current = totalSeconds;
      playAlarmPulse();
    }

    if (!beepIntervalRef.current) {
      beepIntervalRef.current = setInterval(() => {
        playAlarmPulse();
      }, 1000);
    }

    return () => {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current);
        beepIntervalRef.current = null;
      }
    };
  }, [canControlLive, running, totalSeconds, settings.alertSeconds]);

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
      const date = dateISO || todayISO();
      const pending = await normalizePendingQuick(date) || await findLatestPendingQuick(date);
      if (pending?.match_no) {
        setQuickMatchNumber(pending.match_no);
        return pending.match_no;
      }
      const next = await fetchNextMatchNo({ dateISO: date, mode: 'quick' });
      setQuickMatchNumber(next);
      return next;
    } catch {
      setQuickMatchNumber(1);
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
      if (matchId) {
        return currentMatchRef.current || { id: matchId, match_no: quickMatchNumber };
      }
      const date = dateISO || todayISO();
      const normalizedPending = await normalizePendingQuick(date);
      if (normalizedPending) {
        if (desiredNo && Number(normalizedPending.match_no || 0) < Number(desiredNo)) {
          await deleteMatch(normalizedPending.id);
        } else {
          setMatchId(normalizedPending.id);
          currentMatchRef.current = normalizedPending;
          if (normalizedPending.match_no) setQuickMatchNumber(normalizedPending.match_no);
          return normalizedPending;
        }
      }
      const targetNo = desiredNo || quickMatchNumber;
      const existing = await findPendingQuickMatch(date, targetNo);
      if (existing) {
        setMatchId(existing.id);
        currentMatchRef.current = existing;
        if (existing.match_no) setQuickMatchNumber(existing.match_no);
        return existing;
      }
      const nextNo = desiredNo || (await fetchNextMatchNo({ dateISO: date, mode: 'quick' }));
      const match = await createMatch({
        date_iso: date,
        mode: 'quick',
        team_a_name: quickTeamA,
        team_b_name: quickTeamB,
        quarters: 1,
        durations: [settings.quickDurationSeconds],
        match_no: nextNo,
        status: 'pending'
      });
      setQuickMatchNumber(nextNo);
      setMatchId(match.id);
      currentMatchRef.current = match;
      pushLiveGame({
        id: 1,
        status: running ? 'running' : 'paused',
        mode: 'quick',
        match_id: match.id,
        match_no: nextNo,
        quarter: 1,
        time_left: totalSeconds,
        team_a: quickTeamA,
        team_b: quickTeamB,
        score_a: scoreA,
        score_b: scoreB,
        reset_at: null
      });
      return match;
    } catch {
      // ignore
      return null;
    }
  }

  function startQuick() {
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
    refreshQuickNumber().then((nextNo) => {
      setQuickMatchNumber(nextNo);
      ensureQuickMatch(nextNo);
    });
  }

  function startTournamentMatch(match) {
    setMode('tournament');
    setMatchId(match.id);
    setQuarterIndex(0);
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
    pushLiveGame({
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
    });
  }

  async function play() {
    if (!canControlLive) return;
    if (totalSeconds === 0 && ajusteFinalAtivo) return;
    if (remoteResetRef.current) {
      remoteResetRef.current = false;
    }
    setAjusteFinalAtivo(false);
    setRunning(true);
    // Unlock audio on user gesture to guarantee alarm playback.
    ensureAudioReady().catch(() => {});
    let ensuredQuick = null;
    if (mode === 'quick') {
      ensuredQuick = await ensureQuickMatch();
      if (!ensuredQuick?.id && !matchId) return;
    }
    pushLiveGame({
      id: 1,
      status: 'running',
      mode,
      match_id: mode === 'tournament' ? currentMatchRef.current?.id : (ensuredQuick?.id || matchId),
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

  function pause() {
    if (!canControlLive) return;
    if (remoteResetRef.current) return;
    if (mode === 'quick' && !matchId) return;
    setRunning(false);
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

  function addPoint(team, value) {
    if (!canControlLive) return;
    const delta = Number(value) || 0;
    const canEdit = running || ajusteFinalAtivo || delta < 0;
    if (!canEdit) return;
    if (remoteResetRef.current) return;
    if (mode === 'quick') ensureQuickMatch();

    if (team === 'A') {
      setScoreA((prev) => {
        const nextScore = Math.max(0, prev + delta);
        scoreARef.current = nextScore;
        pushLiveGame({
          id: 1,
          status: running ? 'running' : 'paused',
          mode,
          match_id: mode === 'tournament' ? currentMatchRef.current?.id : matchId,
          match_no: mode === 'quick' ? quickMatchNumber : (currentMatchRef.current?.match_no || null),
          quarter: quarterIndex + 1,
          time_left: totalSeconds,
          team_a: teamAName,
          team_b: teamBName,
          score_a: nextScore,
          score_b: scoreB,
          reset_at: null
        });
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
        pushLiveGame({
          id: 1,
          status: running ? 'running' : 'paused',
          mode,
          match_id: mode === 'tournament' ? currentMatchRef.current?.id : matchId,
          match_no: mode === 'quick' ? quickMatchNumber : (currentMatchRef.current?.match_no || null),
          quarter: quarterIndex + 1,
          time_left: totalSeconds,
          team_a: teamAName,
          team_b: teamBName,
          score_a: scoreA,
          score_b: nextScore,
          reset_at: null
        });
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
      const ok = await askConfirm(`Tempo encerrado! Encerrar o Quarter ${quarterIndex + 1}?`);
      if (ok) await advanceQuarterOrFinish();
      else {
        setAjusteFinalAtivo(true);
        showAlert('Quarter ficou em 00:00. Ajuste o placar se precisar e depois continue.');
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
      let ensuredMatch = null;
      if (mode === 'quick' && !matchId) {
        ensuredMatch = await ensureQuickMatch(quickMatchNumber);
      }
      const snapshotScoreA = Number(scoreARef.current || 0);
      const snapshotScoreB = Number(scoreBRef.current || 0);
      const hasNonZeroScore = snapshotScoreA !== 0 || snapshotScoreB !== 0;
      const closingMatchNo = quickMatchNumber;

      if (hasNonZeroScore) {
        await saveQuickMatch(ensuredMatch?.id || null, {
          scoreA: snapshotScoreA,
          scoreB: snapshotScoreB,
          basketsA: basketsARef.current,
          basketsB: basketsBRef.current
        });
      } else if (matchId) {
        // 0x0 should not pollute history/results: discard the open quick match.
        await deleteMatch(matchId);
        setMatchId(null);
        currentMatchRef.current = null;
      }

      await updateLiveGame({
        status: 'ended',
        match_no: closingMatchNo,
        time_left: 0,
        score_a: snapshotScoreA,
        score_b: snapshotScoreB
      });
      await prepareNextQuick(false, closingMatchNo + 1);
    } catch (err) {
      setLastError(err);
      showAlert(err.message || 'Erro ao salvar partida rápida.');
    }
  }

  async function prepareNextQuick(resetDay = false, forcedNextNo = null) {
    setAjusteFinalAtivo(false);
    setRunning(false);
    setCurrentDurationSeconds(settings.quickDurationSeconds);
    setTotalSeconds(settings.quickDurationSeconds);
    resetCounters();
    const dbNext = resetDay
      ? 1
      : await fetchNextMatchNo({ dateISO: dateISO || todayISO(), mode: 'quick' });
    const localNext = forcedNextNo || (quickMatchNumber + 1);
    const nextNo = resetDay ? 1 : Math.max(localNext, dbNext);
    const date = dateISO || todayISO();
    if (!resetDay && nextNo > 1) {
      await settlePreviousPendingQuick(date, nextNo);
    }
    setQuickMatchNumber(nextNo);
    setMatchId(null);
    currentMatchRef.current = null;
    const nextMatch = await ensureQuickMatch(nextNo);
    if (!nextMatch?.id) return;
    updateLiveGame({
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
        const match = await createMatch({
          date_iso: dateISO || todayISO(),
          mode: 'quick',
          team_a_name: quickTeamA,
          team_b_name: quickTeamB,
          quarters: 1,
          durations: [settings.quickDurationSeconds],
          match_no: quickMatchNumber,
          status: 'pending'
        });
        id = match.id;
        setMatchId(id);
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
    } catch (err) {
      setLastError(err);
      throw err;
    }
  }

  async function advanceQuarterOrFinish() {
    const match = currentMatchRef.current;
    if (!match) return;

    const last = quarterIndex >= (match.quarters - 1);
    if (last) {
      await finishTournamentMatch(true);
      return;
    }

    const nextIndex = quarterIndex + 1;
    setQuarterIndex(nextIndex);
    const nextDur = match.durations?.[nextIndex] || settings.quickDurationSeconds;
    setCurrentDurationSeconds(nextDur);
    setTotalSeconds(nextDur);
    setAjusteFinalAtivo(false);
    pushLiveGame({
      id: 1,
      status: 'paused',
      mode,
      match_id: mode === 'tournament' ? currentMatchRef.current?.id : matchId,
      match_no: mode === 'quick' ? quickMatchNumber : (currentMatchRef.current?.match_no || null),
      quarter: nextIndex + 1,
      time_left: nextDur,
      team_a: teamAName,
      team_b: teamBName,
      score_a: scoreA,
      score_b: scoreB,
      reset_at: null
    });
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

  async function finishTournamentMatch(silent = false) {
    const match = currentMatchRef.current;
    if (!match) return;

    if (scoreA === 0 && scoreB === 0) {
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
          score_a: scoreA,
          score_b: scoreB,
          reset_at: null
        });
        if (!silent) showAlert('Partida 0x0 removida.');
      } catch (err) {
        setLastError(err);
        showAlert(err.message || 'Erro ao remover partida 0x0.');
      }
      return;
    }

    const totalC1 = basketsA.one + basketsB.one;
    const totalC2 = basketsA.two + basketsB.two;
    const totalC3 = basketsA.three + basketsB.three;

    try {
      await upsertMatchResult({
        match_id: match.id,
        score_a: scoreA,
        score_b: scoreB,
        baskets1: totalC1,
        baskets2: totalC2,
        baskets3: totalC3,
        finished_at: new Date().toISOString()
      });
      await updateMatch(match.id, { status: 'done' });

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

      if (!silent) {
        showAlert('Partida salva no Torneio!');
      }
    } catch (err) {
      setLastError(err);
      showAlert(err.message || 'Erro ao salvar partida do torneio.');
    }
  }

  async function saveCurrentIfNeeded() {
    if (Number(scoreARef.current || 0) === 0 && Number(scoreBRef.current || 0) === 0) return;
    if (mode === 'quick') {
      try {
        const ensuredMatch = matchId ? null : await ensureQuickMatch(quickMatchNumber);
        await saveQuickMatch(ensuredMatch?.id || null, {
          scoreA: Number(scoreARef.current || 0),
          scoreB: Number(scoreBRef.current || 0),
          basketsA: basketsARef.current,
          basketsB: basketsBRef.current
        });
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
    resetCounters();
  }

  function applyLiveSnapshot(live) {
    if (!live) return;
    if (live.reset_at) return;
    const liveMode = live.mode || 'quick';
    setMode(liveMode);
    setQuarterIndex(Math.max(0, Number(live.quarter || 1) - 1));
    const isQuick = liveMode === 'quick';
    const fallbackA = isQuick ? quickTeamA : 'TIME 1';
    const fallbackB = isQuick ? quickTeamB : 'TIME 2';
    // In quick mode, names are fixed and must never fallback to TIME 1/TIME 2.
    setTeamAName(isQuick ? quickTeamA : (live.team_a || fallbackA));
    setTeamBName(isQuick ? quickTeamB : (live.team_b || fallbackB));
    setScoreA(Number(live.score_a || 0));
    setScoreB(Number(live.score_b || 0));
    setTotalSeconds(Number(live.time_left || settings.quickDurationSeconds));
    setCurrentDurationSeconds(Number(live.time_left || settings.quickDurationSeconds));
    setMatchId(live.match_id || null);
    if (live.match_no) setQuickMatchNumber(live.match_no);
    setAjusteFinalAtivo(false);
    setRunning(live.status === 'running');
  }

  const value = useMemo(() => ({
    settings,
    setSettings,
    dateISO,
    setDateISO,
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
    alertState,
    showAlert,
    closeAlert,
    lastError
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
    applyRemoteReset,
    applyLiveSnapshot
  ]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  return useContext(GameContext);
}
