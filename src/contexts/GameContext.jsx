import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createMatch, deleteMatch, deletePendingQuickMatch, fetchLiveGame, fetchNextMatchNo, findLatestPendingQuick, findPendingQuickMatch, updateMatch, updateLiveGame, upsertLiveGame, upsertMatchResult } from '../lib/api';
import { formatTime, todayISO } from '../utils/time';
import { loadAppDate, loadSettings, saveAppDate, saveSettings } from '../utils/storage';

const GameContext = createContext(null);

const defaultSettings = {
  quickDurationSeconds: 7 * 60,
  alertSeconds: 20,
  defaultTeamA: 'Com Colete',
  defaultTeamB: 'Sem Colete',
  soundEnabled: true,
  theme: 'dark-green'
};
const QUICK_TEAM_A = 'COM COLETE';
const QUICK_TEAM_B = 'SEM COLETE';

export function GameProvider({ children }) {
  const [settings, setSettings] = useState(() => loadSettings() || defaultSettings);
  const [dateISO, setDateISO] = useState(() => loadAppDate() || todayISO());

  const [mode, setMode] = useState('quick');
  const [matchId, setMatchId] = useState(null);
  const [quarterIndex, setQuarterIndex] = useState(0);
  const [currentDurationSeconds, setCurrentDurationSeconds] = useState(settings.quickDurationSeconds);
  const [totalSeconds, setTotalSeconds] = useState(settings.quickDurationSeconds);
  const [running, setRunning] = useState(false);
  const [ajusteFinalAtivo, setAjusteFinalAtivo] = useState(false);

  const [teamAName, setTeamAName] = useState('TIME 1');
  const [teamBName, setTeamBName] = useState('TIME 2');
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [basketsA, setBasketsA] = useState({ one: 0, two: 0, three: 0 });
  const [basketsB, setBasketsB] = useState({ one: 0, two: 0, three: 0 });
  const [quickMatchNumber, setQuickMatchNumber] = useState(1);
  const [confirmState, setConfirmState] = useState({ open: false, message: '', resolve: null, countdown: false });
  const [alertState, setAlertState] = useState({ open: false, message: '' });
  const [lastError, setLastError] = useState(null);

  const intervalRef = useRef(null);
  const currentMatchRef = useRef(null);
  const beepIntervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastResetRef = useRef(null);
  const remoteResetRef = useRef(false);
  const resettingRef = useRef(false);
  const lastLiveAtRef = useRef(null);
  function pushLiveGame(payload) {
    if (remoteResetRef.current) return;
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
        const next = prev - 1;
        updateLiveGame({
          status: 'running',
          time_left: next
        }).catch(() => {});
        return next;
      });
    }, 1000);

    return () => {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [running]);

  useEffect(() => {
    let active = true;
    async function pollLive() {
      try {
        const live = await fetchLiveGame();
        if (!active || !live) return;
        const updatedAt = live.updated_at ? new Date(live.updated_at).getTime() : Date.now();
        if (!lastLiveAtRef.current || updatedAt > lastLiveAtRef.current) {
          lastLiveAtRef.current = updatedAt;
          applyLiveSnapshot(live);
        }
      } catch {
        // ignore
      }
    }
    pollLive();
    const t = setInterval(pollLive, 1000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const liveTick = setInterval(() => {
      pushLiveGame({
        id: 1,
        status: 'running',
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
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(liveTick);
  }, [running, totalSeconds, mode, quarterIndex, teamAName, teamBName, scoreA, scoreB, matchId, quickMatchNumber]);

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
      match_id: matchId,
      match_no: quickMatchNumber,
      quarter: 1,
      time_left: totalSeconds,
      team_a: teamAName,
      team_b: teamBName,
      score_a: scoreA,
      score_b: scoreB,
      reset_at: null
    }).catch(() => {});
  }, [mode, matchId, quickMatchNumber, running, totalSeconds, teamAName, teamBName, scoreA, scoreB]);

  useEffect(() => {
    const shouldBeep = running && settings.soundEnabled && totalSeconds > 0 && totalSeconds <= settings.alertSeconds;
    if (!shouldBeep) {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current);
        beepIntervalRef.current = null;
      }
      return;
    }

    if (!beepIntervalRef.current) {
      beepIntervalRef.current = setInterval(() => {
        try {
          if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
          }
          const ctx = audioCtxRef.current;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 880;
          gain.gain.value = 0.06;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
        } catch {
          // ignore audio errors
        }
      }, 900);
    }

    return () => {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current);
        beepIntervalRef.current = null;
      }
    };
  }, [running, totalSeconds, settings.soundEnabled, settings.alertSeconds]);

  function askConfirm(message, options = {}) {
    return new Promise((resolve) => {
      setConfirmState({ open: true, message, resolve, countdown: !!options.countdown });
    });
  }

  function resolveConfirm(result) {
    if (confirmState.resolve) confirmState.resolve(result);
    setConfirmState({ open: false, message: '', resolve: null, countdown: false });
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
  }

  async function refreshQuickNumber() {
    try {
      const pending = await findLatestPendingQuick(dateISO || todayISO());
      if (pending?.match_no) {
        setQuickMatchNumber(pending.match_no);
        return pending.match_no;
      }
      const next = await fetchNextMatchNo({ dateISO: dateISO || todayISO(), mode: 'quick' });
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
    setTeamAName(QUICK_TEAM_A);
    setTeamBName(QUICK_TEAM_B);
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
      if (matchId) return;
      const targetNo = desiredNo || quickMatchNumber;
      const existing = await findPendingQuickMatch(dateISO || todayISO(), targetNo);
      if (existing) {
        setMatchId(existing.id);
        currentMatchRef.current = existing;
        if (existing.match_no) setQuickMatchNumber(existing.match_no);
        return;
      }
      const latest = await findLatestPendingQuick(dateISO || todayISO());
      if (latest) {
        await updateMatch(latest.id, { match_no: targetNo });
        setMatchId(latest.id);
        currentMatchRef.current = { ...latest, match_no: targetNo };
        return;
      }
      const nextNo = desiredNo || (await fetchNextMatchNo({ dateISO: dateISO || todayISO(), mode: 'quick' }));
      const match = await createMatch({
        date_iso: dateISO || todayISO(),
        mode: 'quick',
        team_a_name: QUICK_TEAM_A,
        team_b_name: QUICK_TEAM_B,
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
        team_a: QUICK_TEAM_A,
        team_b: QUICK_TEAM_B,
        score_a: scoreA,
        score_b: scoreB,
        reset_at: null
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  function startQuick() {
    setMode('quick');
    setMatchId(null);
    setQuarterIndex(0);
    setTeamAName(QUICK_TEAM_A);
    setTeamBName(QUICK_TEAM_B);
    resetCounters();
    setCurrentDurationSeconds(settings.quickDurationSeconds);
    setTotalSeconds(settings.quickDurationSeconds);
    setAjusteFinalAtivo(false);
    setRunning(false);
    remoteResetRef.current = false;
    refreshQuickNumber().then((nextNo) => {
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
    }).catch(() => {});
  }

  function play() {
    if (totalSeconds === 0 && ajusteFinalAtivo) return;
    if (remoteResetRef.current) {
      remoteResetRef.current = false;
    }
    setAjusteFinalAtivo(false);
    setRunning(true);
    if (mode === 'quick') ensureQuickMatch();
    pushLiveGame({
      id: 1,
      status: 'running',
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
    }).catch(() => {});
  }

  function pause() {
    if (remoteResetRef.current) return;
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
    }).catch(() => {});
  }

  function addPoint(team, value) {
    const canEdit = running || ajusteFinalAtivo;
    if (!canEdit) return;
    if (remoteResetRef.current) return;
    const delta = Number(value) || 0;
    if (mode === 'quick') ensureQuickMatch();

    if (team === 'A') {
      setScoreA((prev) => {
        const nextScore = Math.max(0, prev + delta);
        updateLiveGame({
          status: running ? 'running' : 'paused',
          score_a: nextScore,
          score_b: scoreB
        }).catch(() => {});
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
        return next;
      });
    }

    if (team === 'B') {
      setScoreB((prev) => {
        const nextScore = Math.max(0, prev + delta);
        updateLiveGame({
          status: running ? 'running' : 'paused',
          score_a: scoreA,
          score_b: nextScore
        }).catch(() => {});
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
        return next;
      });
    }
  }

  async function handleTimerEnd() {
    if (mode === 'tournament') {
      const ok = await askConfirm(`Tempo encerrado! Encerrar o Quarter ${quarterIndex + 1}?`, { countdown: true });
      if (ok) await advanceQuarterOrFinish();
      else {
        setAjusteFinalAtivo(true);
        showAlert('Quarter ficou em 00:00. Ajuste o placar se precisar e depois continue.');
      }
    } else {
      const ok = await askConfirm('Tempo encerrado! Deseja encerrar a partida?', { countdown: true });
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
        }).catch(() => {});
      }
    }
  }

  async function finishQuick() {
    try {
      if (scoreA === 0 && scoreB === 0) {
        if (matchId) {
          await deleteMatch(matchId);
        }
        await deletePendingQuickMatch(dateISO || todayISO(), quickMatchNumber).catch(() => {});
        pushLiveGame({
          id: 1,
          status: 'ended',
          mode: 'quick',
          match_id: null,
          match_no: quickMatchNumber,
          quarter: 1,
          time_left: 0,
          team_a: teamAName,
          team_b: teamBName,
          score_a: scoreA,
          score_b: scoreB,
          reset_at: null
        }).catch(() => {});
        await prepareNextQuick();
        return;
      }
      await saveQuickMatch();
      showAlert('Partida (rápida) salva!');
      pushLiveGame({
        id: 1,
        status: 'ended',
        mode: 'quick',
        match_id: matchId,
        match_no: quickMatchNumber,
        quarter: 1,
        time_left: 0,
        team_a: teamAName,
        team_b: teamBName,
        score_a: scoreA,
        score_b: scoreB,
        reset_at: null
      }).catch(() => {});
      await prepareNextQuick();
    } catch (err) {
      setLastError(err);
      showAlert(err.message || 'Erro ao salvar partida rápida.');
    }
  }

  async function prepareNextQuick(resetDay = false) {
    setAjusteFinalAtivo(false);
    setRunning(false);
    setCurrentDurationSeconds(settings.quickDurationSeconds);
    setTotalSeconds(settings.quickDurationSeconds);
    resetCounters();
    const nextNo = await refreshQuickNumber();
    pushLiveGame({
      id: 1,
      status: 'paused',
      mode: 'quick',
      match_id: null,
      match_no: nextNo,
      quarter: 1,
      time_left: settings.quickDurationSeconds,
      team_a: QUICK_TEAM_A,
      team_b: QUICK_TEAM_B,
      score_a: 0,
      score_b: 0,
      reset_at: null
    }).catch(() => {});
    setMatchId(null);
    currentMatchRef.current = null;
  }

  async function saveQuickMatch() {
    try {
      const totalC1 = basketsA.one + basketsB.one;
      const totalC2 = basketsA.two + basketsB.two;
      const totalC3 = basketsA.three + basketsB.three;
      let id = matchId;
      if (!id) {
        const match = await createMatch({
          date_iso: dateISO || todayISO(),
          mode: 'quick',
          team_a_name: QUICK_TEAM_A,
          team_b_name: QUICK_TEAM_B,
          quarters: 1,
          durations: [settings.quickDurationSeconds],
          match_no: quickMatchNumber,
          status: 'done'
        });
        id = match.id;
        setMatchId(id);
      } else {
        await updateMatch(id, { status: 'done', match_no: quickMatchNumber });
      }

      await upsertMatchResult({
        match_id: id,
        score_a: scoreA,
        score_b: scoreB,
        baskets1: totalC1,
        baskets2: totalC2,
        baskets3: totalC3,
        finished_at: new Date().toISOString()
      });
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
    }).catch(() => {});
  }

  function resetTimer() {
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
    }).catch(() => {});
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
    }).catch(() => {});
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
        }).catch(() => {});
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
      await updateMatch(match.id, { status: 'done' });
      await upsertMatchResult({
        match_id: match.id,
        score_a: scoreA,
        score_b: scoreB,
        baskets1: totalC1,
        baskets2: totalC2,
        baskets3: totalC3,
        finished_at: new Date().toISOString()
      });

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
      }).catch(() => {});

      if (!silent) {
        showAlert('Partida salva no Torneio!');
      }
    } catch (err) {
      setLastError(err);
      showAlert(err.message || 'Erro ao salvar partida do torneio.');
    }
  }

  async function saveCurrentIfNeeded() {
    if (scoreA === 0 && scoreB === 0) return;
    if (mode === 'quick') {
      try {
        await saveQuickMatch();
        await prepareNextQuick(true);
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
    setMode(live.mode || 'quick');
    setQuarterIndex(Math.max(0, Number(live.quarter || 1) - 1));
    setTeamAName(live.team_a || QUICK_TEAM_A);
    setTeamBName(live.team_b || QUICK_TEAM_B);
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
