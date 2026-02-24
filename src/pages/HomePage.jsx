import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { formatDateBR, todayISO } from '../utils/time';
import DateWheelField from '../components/DateWheelField';

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

  const showNow = running;
  const matchLabel = mode === 'tournament' ? `Quarter ${quarterIndex + 1}` : `Partida ${quickMatchNumber}`;

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
        <div className="panel now-panel">
          <div className="label">Acontecendo agora...</div>
          <div className="now-row">
            <div className="now-team">{teamAName}</div>
            <div className="now-score">{scoreA}</div>
            <div className="now-vs">x</div>
            <div className="now-score">{scoreB}</div>
            <div className="now-team">{teamBName}</div>
          </div>
          <div className="now-meta">
            <span>{matchLabel}</span>
            <span>Tempo restante: {formatTime(totalSeconds)}</span>
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
