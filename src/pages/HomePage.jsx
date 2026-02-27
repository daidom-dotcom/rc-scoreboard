import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { formatDateBR, todayISO } from '../utils/time';
import DateWheelField from '../components/DateWheelField';
import { fetchLiveGame } from '../lib/api';
import { supabase } from '../lib/supabase';

export default function HomePage() {
  const { user, isMaster, profile } = useAuth();
  const {
    dateISO,
    setDateISO,
    startQuick,
    showAlert,
    running,
    mode,
    teamAName,
    teamBName,
    scoreA,
    scoreB,
    totalSeconds,
    quarterIndex,
    quickMatchNumber,
    matchId,
    formatTime
  } = useGame();
  const navigate = useNavigate();

  const canEdit = !!user && isMaster;

  useEffect(() => {
    setDateISO(todayISO());
  }, [setDateISO]);

  function handleQuick() {
    if (!canEdit) {
      showAlert('Faça login para iniciar e salvar partidas.');
      return;
    }
    startQuick();
    navigate('/game');
  }

  function handleTournament() {
    if (!canEdit) {
      showAlert('Faça login para gerenciar torneios.');
      return;
    }
    navigate('/tournament');
  }

  function handleObserver() {
    navigate('/history');
  }

  function handleCheckIn() {
    if (!user) {
      showAlert('Faça login para fazer check-in.');
      return;
    }
    const targetDate = dateISO || todayISO();
    navigate(`/checkin?date=${targetDate}`);
  }

  const [live, setLive] = useState(null);
  const [liveEntries, setLiveEntries] = useState({ A: [], B: [] });
  const [debugInfo, setDebugInfo] = useState({ lastFetch: null, error: null });
  const debugEnabled = true;

  useEffect(() => {
    let active = true;
    async function loadLive() {
      try {
        const data = await fetchLiveGame();
        if (active) setLive(data);
        if (active) setDebugInfo({ lastFetch: new Date().toISOString(), error: null });
      } catch (err) {
        if (active) setDebugInfo({ lastFetch: new Date().toISOString(), error: err?.message || String(err) });
      }
    }
    loadLive();
    const t = setInterval(loadLive, 1000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadEntries() {
      if (!live) {
        if (active) setLiveEntries({ A: [], B: [] });
        return;
      }

      const activeMatchId = running ? matchId : live.match_id;
      let query = supabase.from('player_entries').select('player_name, team_side');

      if (activeMatchId) {
        query = query.eq('match_id', activeMatchId);
      } else if (live.mode === 'quick' && live.match_no) {
        query = supabase
          .from('player_entries')
          .select('player_name, team_side, matches!inner(match_no,date_iso,mode)')
          .eq('matches.match_no', live.match_no)
          .eq('matches.date_iso', dateISO || todayISO())
          .eq('matches.mode', 'quick');
      } else {
        if (active) setLiveEntries({ A: [], B: [] });
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
      if (active) setLiveEntries({ A: a, B: b });
    }
    loadEntries();
    const t = setInterval(loadEntries, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [live?.match_id]);

  const liveActive = live && (live.status !== 'ended' || live.time_left > 0 || live.score_a > 0 || live.score_b > 0);
  const liveReset = live?.reset_at ? new Date(live.reset_at).getTime() : null;
  const localHasMovement = totalSeconds > 0 || scoreA > 0 || scoreB > 0;
  const showNow = running || (liveActive && (!liveReset || live.time_left > 0 || live.score_a > 0 || live.score_b > 0));
  const isLive = running
    ? localHasMovement
    : (live && (live.status === 'running' || live.score_a > 0 || live.score_b > 0));
  const matchLabel = mode === 'tournament'
    ? `Quarter ${quarterIndex + 1}`
    : `Partida ${quickMatchNumber}`;
  const liveLabel = live?.mode === 'tournament'
    ? `Quarter ${live.quarter}`
    : `Partida ${live?.match_no || 1}`;

  return (
    <div className="center home-wrapper">
      <div className="home-main">
      <h1 className="title-small">Rachão dos Crias</h1>
      <h1 className="title-big">Scoreboard</h1>

      {user ? (
        <div className="welcome-text">
          Bem-vindo, {(() => {
            const name = (profile?.full_name || '').trim();
            if (name) return name.split(' ')[0];
            if (user.email) return user.email.split('@')[0];
            return '';
          })()}
        </div>
      ) : null}

      <div className="home-date">
        <label className="label">Data da Partida</label>
        <div className="home-date-spacer" />
        <div className="home-date-row">
          <DateWheelField value={dateISO} onChange={setDateISO} displayValue={formatDateBR(dateISO)} />
          <button className="btn-icon" onClick={handleObserver} title="Ver partidas" aria-label="Ver partidas">
            ➡️
          </button>
        </div>
      </div>

      <div className="actions home-actions">
        {user ? (
          <button className="btn-controle" onClick={handleCheckIn}>Check-in</button>
        ) : null}
        {canEdit ? (
          <>
            <button className="btn-controle" onClick={handleTournament}>Modo Torneio</button>
            <button className="btn-controle" onClick={handleQuick}>Início Rápido</button>
          </>
        ) : null}
      </div>
      </div>

      {debugEnabled ? (
        <div className="debug-panel">
          <div>Home debug</div>
          <div>lastFetch: {debugInfo.lastFetch || '-'}</div>
          <div>error: {debugInfo.error || '-'}</div>
          <div>live: {JSON.stringify(live)}</div>
        </div>
      ) : null}
    </div>
  );
}
