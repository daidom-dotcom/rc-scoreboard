import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { supabase } from '../lib/supabase';
import { todayISO } from '../utils/time';
import { fetchLiveGame } from '../lib/api';
import PasswordModal from '../components/PasswordModal';

export default function GamePage() {
  const { user, isMaster } = useAuth();
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
  const timerAlert = running && totalSeconds <= settings.alertSeconds && totalSeconds > 0;

  const canEdit = !!user && isMaster;
  const controlsDisabled = !canEdit;
  const [teamEntries, setTeamEntries] = useState({ A: [], B: [] });
  const [liveView, setLiveView] = useState(null);
  const lastLiveAtRef = useRef(0);
  const lastGoodLiveRef = useRef(null);
  const [editorHydrated, setEditorHydrated] = useState(!canEdit);
  const [passwordState, setPasswordState] = useState({ open: false, message: '', resolve: null });

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
    setEditorHydrated(!canEdit);
  }, [canEdit]);

  useEffect(() => {
    if (canEdit && !editorHydrated) return;
    if (mode === 'quick' && teamAName === 'TIME 1' && teamBName === 'TIME 2') {
      startQuick();
    }
  }, [mode, teamAName, teamBName, startQuick, canEdit, editorHydrated]);

  useEffect(() => {
    if (!canEdit || !editorHydrated) return;
    const payload = {
      id: 1,
      status: running ? 'running' : 'paused',
      mode,
      match_id: matchId,
      match_no: mode === 'quick' ? quickMatchNumber : null,
      quarter: quarterIndex + 1,
      time_left: totalSeconds,
      team_a: teamAName,
      team_b: teamBName,
      score_a: scoreA,
      score_b: scoreB
    };
    (async () => {
      try {
        await supabase.from('live_game').upsert(payload);
      } catch {
        // ignore
      }
    })();
  }, [canEdit, editorHydrated, running, totalSeconds, scoreA, scoreB, teamAName, teamBName, matchId, quickMatchNumber, mode, quarterIndex]);

  useEffect(() => {
    if (!canEdit) return;
    let active = true;
    async function syncFromLive() {
      try {
        const live = await fetchLiveGame();
        if (active && live) {
          const ts = live.updated_at ? new Date(live.updated_at).getTime() : Date.now();
          lastLiveAtRef.current = ts;
          lastGoodLiveRef.current = live;
          applyLiveSnapshot(live);
        }
      } catch {
        // ignore
      } finally {
        if (active) setEditorHydrated(true);
      }
    }
    syncFromLive();
    return () => {
      active = false;
    };
  }, [canEdit, applyLiveSnapshot]);

  useEffect(() => {
    if (canEdit) return;
    let active = true;
    function applyLiveIfNewer(data) {
      if (!data) return;
      const ts = data.updated_at ? new Date(data.updated_at).getTime() : Date.now();
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
    const channel = supabase
      .channel('game-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_game' },
        (payload) => {
          const live = payload?.new;
          if (!live || live.id !== 1) return;
          const ts = live.updated_at ? new Date(live.updated_at).getTime() : Date.now();
          if (ts > lastLiveAtRef.current) {
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
  }, []);

  useEffect(() => {
    let active = true;
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
      if (error) return;
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
  const viewTime = canEdit ? totalSeconds : (safeLive?.time_left ?? totalSeconds);
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
          <div id="timer" className={timerAlert ? 'timer-alert' : ''}>{formatTime(viewTime)}</div>
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
          <div className="botoes-esquerda">
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', 1)}>+1</button>
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', 2)}>+2</button>
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', 3)}>+3</button>
              <button className="btn-ponto minus" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', -1)}>-1</button>
          </div>
          <div className="pontos">{viewScoreA}</div>
          <div className="placar-checkins">
            Time: {(teamEntries.A || []).length ? teamEntries.A.join(' / ') : '-'}
          </div>
        </div>

        <div className="frame">
          <div className="nome">{viewTeamB}</div>
          <div className="pontos">{viewScoreB}</div>
          <div className="botoes-direita">
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', 1)}>+1</button>
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', 2)}>+2</button>
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', 3)}>+3</button>
            <button className="btn-ponto minus" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', -1)}>-1</button>
          </div>
          <div className="placar-checkins">
            Time: {(teamEntries.B || []).length ? teamEntries.B.join(' / ') : '-'}
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
