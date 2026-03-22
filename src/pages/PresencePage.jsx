import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { upsertDailyAttendance } from '../lib/api';
import { formatDateBR, todayISOInSaoPaulo } from '../utils/time';
import { preferredDisplayName, preferredShortGreeting } from '../utils/names';

export default function PresencePage() {
  const { user, profile, loading } = useAuth();
  const { showAlert } = useGame();
  const navigate = useNavigate();
  const location = useLocation();
  const [savedName, setSavedName] = useState('');
  const [savedDate, setSavedDate] = useState(todayISOInSaoPaulo());
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
      navigate(`/login?redirect=${redirect}`, { replace: true });
      return;
    }
    let active = true;
    async function registerPresence() {
      try {
        const dateISO = todayISOInSaoPaulo();
        const fullName = preferredDisplayName({ nickname: profile?.nickname, full_name: profile?.full_name, email: user?.email }) || 'Jogador';
        await upsertDailyAttendance({
          user_id: user.id,
          player_name: fullName,
          date_iso: dateISO
        });
        if (!active) return;
        setSavedName(preferredShortGreeting({ nickname: profile?.nickname, full_name: profile?.full_name, email: user?.email }) || fullName);
        setSavedDate(dateISO);
        setDone(true);
      } catch (err) {
        showAlert(err.message || 'Não foi possível registrar presença.');
      }
    }
    registerPresence();
    return () => {
      active = false;
    };
  }, [user, profile, loading, navigate, location.pathname, location.search, showAlert]);

  return (
    <div className="container">
      <div className="panel presence-panel">
        <h1 className="hTitle">Presença</h1>
        {done ? (
          <div className="presence-message">
            Presença de {savedName} registrada em {formatDateBR(savedDate)}.
          </div>
        ) : (
          <div>Registrando presença...</div>
        )}
      </div>
    </div>
  );
}
