import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { formatDateBR, todayISO } from '../utils/time';
import DateWheelField from '../components/DateWheelField';
import { fetchLiveGame } from '../lib/api';
import { supabase } from '../lib/supabase';

export default function HomePage() {
  const { user, isMaster } = useAuth();
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

  useEffect(() => {
    let active = true;
    async function loadLive() {
      try {
        const data = await fetchLiveGame();
        if (active) setLive(data);
      } catch {
        // ignore
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
      if (!live?.match_id) {
        if (active) setLiveEntries({ A: [], B: [] });
        return;
      }
      const { data, error } = await supabase
        .from('player_entries')
        .select('player_name, team_side')
        .eq('match_id', live.match_id);
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

  const liveActive = live && live.status !== 'ended';
  const liveReset = live?.reset_at ? new Date(live.reset_at).getTime() : null;
  const localHasMovement = totalSeconds > 0 || scoreA > 0 || scoreB > 0;
  const showNow = running || (liveActive && !liveReset);
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
        <div className="welcome-text">Bem-vindo, {user.email}</div>
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

      {showNow ? (
        <div className="home-bottom">
          <div className="now-panel">
            <div className="label now-status">{isLive ? '🔥 Ao Vivo 🔥' : '⏳ Em Breve ⏳'}</div>
          <div className="now-row">
            <div className="now-team">{running ? teamAName : live?.team_a}</div>
            <div className="now-score">{running ? scoreA : live?.score_a}</div>
            <div className="now-vs">x</div>
            <div className="now-score">{running ? scoreB : live?.score_b}</div>
            <div className="now-team">{running ? teamBName : live?.team_b}</div>
          </div>
          {live?.match_id ? (
            <div className="now-checkins">
              <div className="now-list">
                {(liveEntries.A || []).map((n) => <span key={`a-${n}`}>{n}</span>)}
              </div>
              <div className="now-list right">
                {(liveEntries.B || []).map((n) => <span key={`b-${n}`}>{n}</span>)}
              </div>
            </div>
          ) : null}
          <div className="now-meta">
              <span>{running ? matchLabel : liveLabel}</span>
              <span>Tempo restante: {formatTime(running ? totalSeconds : (live?.time_left || 0))}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
