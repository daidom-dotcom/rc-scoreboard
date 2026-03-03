import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { supabase } from '../lib/supabase';
import { fetchLiveGame } from '../lib/api';
import { todayISO } from '../utils/time';
import PasswordModal from '../components/PasswordModal';

export default function GamePage() {
  const { user, isScoreboard } = useAuth();
  const {
    mode,
    quarterIndex,
    totalSeconds,
    running,
    ajusteFinalAtivo,
    teamAName,
    teamBName,
    scoreA,
    scoreB,
    matchId,
    quickMatchNumber,
    settings,
    formatTime,
    startQuick,
    setDateISO,
    askConfirm,
    play,
    pause,
    addPoint,
    finishQuick,
    finishTournamentMatch,
    saveCurrentIfNeeded,
    endLiveGame,
    dateISO,
    clearGameState,
    applyLiveSnapshot
  } = useGame();

  const navigate = useNavigate();
  const label = mode === 'quick' ? `Partida ${quickMatchNumber}` : `Quarter ${quarterIndex + 1}`;

  const canEdit = !!user && isScoreboard;
  const controlsDisabled = !canEdit;
  const [teamEntries, setTeamEntries] = useState({ A: [], B: [] });
  const [liveView, setLiveView] = useState(null);
  const lastLiveAtRef = useRef(0);
  const lastGoodLiveRef = useRef(null);
  const initializedScoreboardRef = useRef(false);
  const [observerNowMs, setObserverNowMs] = useState(Date.now());
  const [passwordState, setPasswordState] = useState({ open: false, message: '', resolve: null });

  function parseTimestampMs(value) {
    if (!value) return 0;
    const raw = String(value).trim();
    if (!raw) return 0;
    const normalized = raw
      .replace(' ', 'T')
      .replace(/([+-]\d{2})$/, '$1:00')
      .replace(/\.(\d{3})\d+/, '.$1')
      .replace(/\+00:00$/, 'Z');
    const ms = Date.parse(normalized);
    if (Number.isFinite(ms)) return ms;
    const fallback = Date.parse(raw);
    return Number.isFinite(fallback) ? fallback : 0;
  }

  function askPassword(message) {
    return new Promise((resolve) => {
      setPasswordState({ open: true, message, resolve });
    });
  }

  function closePasswordModal() {
    if (passwordState.resolve) passwordState.resolve(null);
    setPasswordState({ open: false, message: '', resolve: null });
  }

  function confirmPassword(value) {
    if (passwordState.resolve) passwordState.resolve(value);
    setPasswordState({ open: false, message: '', resolve: null });
  }

  useEffect(() => {
    if (!isScoreboard) return;
    if (initializedScoreboardRef.current) return;
    initializedScoreboardRef.current = true;
    let active = true;
    async function bootstrapScoreboard() {
      const today = todayISO();
      if (dateISO !== today) {
        setDateISO(today);
      }
      try {
        const live = await fetchLiveGame();
        if (!active) return;
        if (live && (live.match_id || live.match_no || live.team_a || live.team_b)) {
          applyLiveSnapshot(live);
          return;
        }
      } catch {
        // fallback inicia quick padrão
      }
      if (active) startQuick();
    }
    bootstrapScoreboard();
    return () => {
      active = false;
    };
  }, [isScoreboard, dateISO, setDateISO, startQuick, applyLiveSnapshot]);

  useEffect(() => {
    if (canEdit) return;
    const t = setInterval(() => setObserverNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [canEdit]);

  useEffect(() => {
    if (canEdit) return;
    let active = true;
    function applyLiveIfNewer(data) {
      if (!data) return;
      const ts = data.updated_at ? parseTimestampMs(data.updated_at) : Date.now();
      if (ts >= lastLiveAtRef.current) {
        lastLiveAtRef.current = ts;
        lastGoodLiveRef.current = data;
        setLiveView(data);
      }
    }
    async function loadLive() {
      try {
        const data = await fetchLiveGame();
        if (active && data) applyLiveIfNewer(data);
      } catch {
        // mantém o último valor para não piscar
      }
    }
    loadLive();
    const t = setInterval(loadLive, 1000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [canEdit]);

  useEffect(() => {
    if (canEdit) return;
    const channel = supabase
      .channel('game-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_game' },
        (payload) => {
          const live = payload?.new;
          if (!live || live.id !== 1) return;
          const ts = live.updated_at ? parseTimestampMs(live.updated_at) : Date.now();
          if (ts >= lastLiveAtRef.current) {
            lastLiveAtRef.current = ts;
            lastGoodLiveRef.current = live;
            setLiveView(live);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [canEdit]);

  useEffect(() => {
    let active = true;
    setTeamEntries({ A: [], B: [] });
    async function loadEntries() {
      const date = dateISO || todayISO();
      let query = supabase.from('player_entries').select('player_name, team_side');

      if (matchId) {
        query = query.eq('match_id', matchId);
      } else if (mode === 'quick' && quickMatchNumber) {
        query = supabase
          .from('player_entries')
          .select('player_name, team_side, matches!inner(match_no,date_iso,mode)')
          .eq('matches.match_no', quickMatchNumber)
          .eq('matches.date_iso', date)
          .eq('matches.mode', 'quick');
      } else {
        if (active) setTeamEntries({ A: [], B: [] });
        return;
      }

      const { data, error } = await query;
      if (error) {
        if (active) setTeamEntries({ A: [], B: [] });
        return;
      }
      const a = [];
      const b = [];
      (data || []).forEach((e) => {
        const first = String(e.player_name || '').trim().split(' ')[0] || e.player_name;
        if (e.team_side === 'A') a.push(first);
        if (e.team_side === 'B') b.push(first);
      });
      if (active) setTeamEntries({ A: a, B: b });
    }
    loadEntries();
    const t = setInterval(loadEntries, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [matchId, mode, quickMatchNumber, dateISO]);

  const safeLive = liveView || lastGoodLiveRef.current;
  const viewTeamA = canEdit ? teamAName : (safeLive?.team_a || teamAName);
  const viewTeamB = canEdit ? teamBName : (safeLive?.team_b || teamBName);
  const viewScoreA = canEdit ? scoreA : (safeLive?.score_a ?? scoreA);
  const viewScoreB = canEdit ? scoreB : (safeLive?.score_b ?? scoreB);
  const syncedObserverTime = useMemo(() => {
    if (!safeLive) return totalSeconds;
    const base = Number(safeLive.time_left ?? totalSeconds);
    if (safeLive.status !== 'running') return base;
    const updatedAtMs = safeLive.updated_at ? parseTimestampMs(safeLive.updated_at) : 0;
    if (!updatedAtMs) return base;
    const elapsed = Math.max(0, Math.floor((observerNowMs - updatedAtMs) / 1000));
    return Math.max(0, base - elapsed);
  }, [safeLive, totalSeconds, observerNowMs]);
  const viewTime = canEdit ? totalSeconds : syncedObserverTime;
  const safeViewTime = Number.isFinite(Number(viewTime)) ? Number(viewTime) : settings.quickDurationSeconds;
  const timerAlert = safeViewTime <= settings.alertSeconds
    && safeViewTime > 0
    && (canEdit ? running : (safeLive?.status === 'running'));
  const viewLabel = canEdit
    ? label
    : (safeLive?.mode === 'tournament'
      ? `Quarter ${safeLive?.quarter || 1}`
      : `Partida ${safeLive?.match_no || 1}`);

  async function handleEndMatch() {
    const senha = await askPassword('Digite a senha para encerrar a partida.');
    if (senha !== '834856') return;
    pause();
    if (mode === 'tournament') {
      const ok = await askConfirm('Deseja encerrar a partida inteira agora?');
      if (!ok) return;
      await finishTournamentMatch(true);
      navigate('/tournament');
    } else {
      const ok = await askConfirm('Deseja encerrar a partida?');
      if (!ok) return;
      await finishQuick();
    }
  }

  async function handleSecondAction() {
    const senha = await askPassword('Digite a senha para encerrar o dia.');
    if (senha !== '834856') return;
    if (mode === 'tournament') {
      navigate('/tournament');
      return;
    }
    const ok = await askConfirm('Deseja encerrar o dia e ver o resumo?');
    if (!ok) return;

    if (scoreA !== 0 || scoreB !== 0) {
      const salvar = await askConfirm('Partida atual não encerrada. Deseja salvar antes de ver o resumo?');
      if (salvar) {
        await saveCurrentIfNeeded();
      }
    }

    pause();
    clearGameState();
    endLiveGame();
    navigate(`/history?summary=1&date=${dateISO}&dateTo=${dateISO}`);
  }


  const enablePoints = running || ajusteFinalAtivo;

  return (
    <div className="game">
      <div className="center" style={{ position: 'relative' }}>
        <div className="topBar">
          <div id="partidaLabel">{viewLabel}</div>
          <div id="timer" className={timerAlert ? 'timer-alert' : ''}>{formatTime(safeViewTime)}</div>
          {canEdit ? (
            <div id="controlesJogos">
              <button className="btn-controle" onClick={play} disabled={!canEdit || running || (totalSeconds === 0 && ajusteFinalAtivo)}>PLAY</button>
              <button className="btn-controle" onClick={pause} disabled={!canEdit || !running}>STOP</button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="placar">
        <div className="frame">
          <div className="nome">{viewTeamA}</div>
          {canEdit ? (
            <div className="botoes-esquerda">
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', 1)}>+1</button>
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', 2)}>+2</button>
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', 3)}>+3</button>
              <button className="btn-ponto minus" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', -1)}>-1</button>
            </div>
          ) : null}
          <div className="pontos">{viewScoreA}</div>
          <div className="placar-checkins">
            {(teamEntries.A || []).length ? teamEntries.A.join(' / ') : 'Sem check-in registrado.'}
          </div>
        </div>

        <div className="frame">
          <div className="nome">{viewTeamB}</div>
          <div className="pontos">{viewScoreB}</div>
          {canEdit ? (
            <div className="botoes-direita">
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', 1)}>+1</button>
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', 2)}>+2</button>
              <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', 3)}>+3</button>
              <button className="btn-ponto minus" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', -1)}>-1</button>
            </div>
          ) : null}
          <div className="placar-checkins">
            {(teamEntries.B || []).length ? teamEntries.B.join(' / ') : 'Sem check-in registrado.'}
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className="encerrarRow">
          <button className="btn-controle" onClick={handleEndMatch} disabled={!canEdit}>ENCERRAR PARTIDA</button>
          <button className="btn-controle" onClick={handleSecondAction}>
            {mode === 'tournament' ? 'VER TORNEIO' : 'ENCERRAR DIA'}
          </button>
        </div>
      ) : null}

      <PasswordModal
        open={passwordState.open}
        title="Senha"
        message={passwordState.message}
        onClose={closePasswordModal}
        onConfirm={confirmPassword}
      />

    </div>
  );
}
