import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { formatDateBR, todayISO } from '../utils/time';
import DateWheelField from '../components/DateWheelField';

export default function HomePage() {
  const { user, isMaster, isScoreboard, profile } = useAuth();
  const {
    dateISO,
    setDateISO,
    startQuick,
    showAlert,
  } = useGame();
  const navigate = useNavigate();

  const canEdit = !!user && isMaster;

  useEffect(() => {
    setDateISO(todayISO());
  }, [setDateISO]);

  useEffect(() => {
    if (user && isScoreboard) {
      navigate('/game', { replace: true });
    }
  }, [user, isScoreboard, navigate]);

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

    </div>
  );
}
