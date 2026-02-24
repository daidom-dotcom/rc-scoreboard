import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { formatDateBR, todayISO } from '../utils/time';
import DateWheelField from '../components/DateWheelField';
import { fetchLiveGame } from '../lib/api';

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
    const t = setInterval(loadLive, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const showNow = running || (live && live.status !== 'ended');
  const matchLabel = mode === 'tournament'
    ? `Quarter ${quarterIndex + 1}`
    : `Partida ${quickMatchNumber}`;
  const liveLabel = live?.mode === 'tournament'
    ? `Quarter ${live.quarter}`
    : `Partida ${live?.quarter || 1}`;

  return (
    <div className="center">
      <h1 className="title-small">Rachão dos Crias</h1>
      <h1 className="title-big">Scoreboard</h1>

      {user ? (
        <div className="welcome-text">Bem-vindo, {user.email}</div>
      ) : null}

      <div className="home-date">
        <label className="label">Data da Partida</label>
        <div className="home-date-spacer" />
        <DateWheelField value={dateISO} onChange={setDateISO} displayValue={formatDateBR(dateISO)} />
      </div>

      {showNow ? (
        <div className="now-panel">
          <div className="label">🔥 Ao Vivo 🔥</div>
          <div className="now-row">
            <div className="now-team">{running ? teamAName : live?.team_a}</div>
            <div className="now-score">{running ? scoreA : live?.score_a}</div>
            <div className="now-vs">x</div>
            <div className="now-score">{running ? scoreB : live?.score_b}</div>
            <div className="now-team">{running ? teamBName : live?.team_b}</div>
          </div>
          <div className="now-meta">
            <span>{running ? matchLabel : liveLabel}</span>
            <span>Tempo restante: {formatTime(running ? totalSeconds : (live?.time_left || 0))}</span>
          </div>
        </div>
      ) : null}

      <div className="actions home-actions">
        {user ? (
          <button className="btn-controle" onClick={handleCheckIn}>Check-in</button>
        ) : null}
        <button className="btn-controle" onClick={handleObserver}>Ver partidas</button>
        {canEdit ? (
          <>
            <button className="btn-controle" onClick={handleTournament}>Modo Torneio</button>
            <button className="btn-controle" onClick={handleQuick}>Início Rápido</button>
          </>
        ) : null}
      </div>
    </div>
  );
}
