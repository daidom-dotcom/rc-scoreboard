import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createMatch, deleteMatch, deletePendingQuickMatch, fetchNextMatchNo, findLatestPendingQuick, findPendingQuickMatch, updateMatch, upsertLiveGame, upsertMatchResult } from '../lib/api';
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
  const [confirmState, setConfirmState] = useState({ open: false, message: '', resolve: null });
  const [alertState, setAlertState] = useState({ open: false, message: '' });
  const [lastError, setLastError] = useState(null);

  const intervalRef = useRef(null);
  const currentMatchRef = useRef(null);
  const beepIntervalRef = useRef(null);
  const audioCtxRef = useRef(null);

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
    if (!running) return;
    const liveTick = setInterval(() => {
      upsertLiveGame({
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
        score_b: scoreB
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(liveTick);
  }, [running, totalSeconds, mode, quarterIndex, teamAName, teamBName, scoreA, scoreB, matchId, quickMatchNumber]);

  useEffect(() => {
    if (mode !== 'quick') return;
    if (!matchId) return;
    upsertLiveGame({
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
      score_b: scoreB
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
  }

  async function refreshQuickNumber() {
    try {
      const next = await fetchNextMatchNo({ dateISO: dateISO || todayISO(), mode: 'quick' });
      setQuickMatchNumber(next);
    } catch {
      setQuickMatchNumber(1);
    }
  }

  async function ensureQuickMatch() {
    try {
      if (matchId) return;
      const existing = await findPendingQuickMatch(dateISO || todayISO(), quickMatchNumber);
      if (existing) {
        setMatchId(existing.id);
        currentMatchRef.current = existing;
        if (existing.match_no) setQuickMatchNumber(existing.match_no);
        return;
      }
      const latest = await findLatestPendingQuick(dateISO || todayISO());
      if (latest) {
        await updateMatch(latest.id, { match_no: quickMatchNumber });
        setMatchId(latest.id);
        currentMatchRef.current = { ...latest, match_no: quickMatchNumber };
        return;
      }
      const nextNo = await fetchNextMatchNo({ dateISO: dateISO || todayISO(), mode: 'quick' });
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
      upsertLiveGame({
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
        score_b: scoreB
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
    refreshQuickNumber();
    ensureQuickMatch();
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
    upsertLiveGame({
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
      score_b: 0
    }).catch(() => {});
  }

  function play() {
    if (totalSeconds === 0 && ajusteFinalAtivo) return;
    setAjusteFinalAtivo(false);
    setRunning(true);
    if (mode === 'quick') ensureQuickMatch();
    upsertLiveGame({
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
      score_b: scoreB
    }).catch(() => {});
  }

  function pause() {
    setRunning(false);
    upsertLiveGame({
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
      score_b: scoreB
    }).catch(() => {});
  }

  function addPoint(team, value) {
    const canEdit = running || ajusteFinalAtivo;
    if (!canEdit) return;
    const delta = Number(value) || 0;

    if (team === 'A') {
      setScoreA((prev) => Math.max(0, prev + delta));
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
      setScoreB((prev) => Math.max(0, prev + delta));
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
    setTimeout(() => {
      upsertLiveGame({
        id: 1,
        status: running ? 'running' : 'paused',
        mode,
        match_id: mode === 'tournament' ? currentMatchRef.current?.id : matchId,
        match_no: mode === 'quick' ? quickMatchNumber : (currentMatchRef.current?.match_no || null),
        quarter: quarterIndex + 1,
        time_left: totalSeconds,
        team_a: teamAName,
        team_b: teamBName,
        score_a: team === 'A' ? Math.max(0, scoreA + delta) : scoreA,
        score_b: team === 'B' ? Math.max(0, scoreB + delta) : scoreB
      }).catch(() => {});
    }, 0);
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
        upsertLiveGame({
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
          score_b: scoreB
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
        upsertLiveGame({
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
          score_b: scoreB
        }).catch(() => {});
        prepareNextQuick();
        return;
      }
      await saveQuickMatch();
      showAlert('Partida (rápida) salva!');
      upsertLiveGame({
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
        score_b: scoreB
      }).catch(() => {});
      prepareNextQuick();
    } catch (err) {
      setLastError(err);
      showAlert(err.message || 'Erro ao salvar partida rápida.');
    }
  }

  function prepareNextQuick(resetDay = false) {
    setAjusteFinalAtivo(false);
    setRunning(false);
    setCurrentDurationSeconds(settings.quickDurationSeconds);
    setTotalSeconds(settings.quickDurationSeconds);
    resetCounters();
    if (resetDay) {
      refreshQuickNumber();
    } else {
      setQuickMatchNumber((prev) => prev + 1);
    }
    setMatchId(null);
    currentMatchRef.current = null;
    upsertLiveGame({
      id: 1,
      status: 'paused',
      mode: 'quick',
      match_id: null,
      match_no: resetDay ? null : (quickMatchNumber + 1),
      quarter: 1,
      time_left: settings.quickDurationSeconds,
      team_a: QUICK_TEAM_A,
      team_b: QUICK_TEAM_B,
      score_a: 0,
      score_b: 0
    }).catch(() => {});
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
    upsertLiveGame({
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
      score_b: scoreB
    }).catch(() => {});
  }

  function resetTimer() {
    setRunning(false);
    setAjusteFinalAtivo(false);
    setTotalSeconds(currentDurationSeconds);
    upsertLiveGame({
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
      score_b: scoreB
    }).catch(() => {});
  }

  function endLiveGame() {
    upsertLiveGame({
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
      score_b: scoreB
    }).catch(() => {});
  }

  async function finishTournamentMatch(silent = false) {
    const match = currentMatchRef.current;
    if (!match) return;

    if (scoreA === 0 && scoreB === 0) {
      try {
        await deleteMatch(match.id);
        upsertLiveGame({
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
          score_b: scoreB
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

      upsertLiveGame({
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
        score_b: scoreB
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
        prepareNextQuick(true);
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
    lastError
  ]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  return useContext(GameContext);
}
