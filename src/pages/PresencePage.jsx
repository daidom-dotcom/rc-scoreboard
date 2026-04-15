import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { createDailyVisitor, deleteDailyVisitor, fetchDailyAttendance, upsertDailyAttendance } from '../lib/api';
import { formatDateBR, todayISOInSaoPaulo } from '../utils/time';
import { preferredDisplayName, preferredShortGreeting } from '../utils/names';

export default function PresencePage() {
  const { user, profile, loading, isMaster } = useAuth();
  const { showAlert } = useGame();
  const navigate = useNavigate();
  const location = useLocation();
  const [savedName, setSavedName] = useState('');
  const [savedDate, setSavedDate] = useState(todayISOInSaoPaulo());
  const [done, setDone] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestList, setGuestList] = useState([]);

  async function loadGuests(targetDate = todayISOInSaoPaulo()) {
    try {
      const data = await fetchDailyAttendance(targetDate);
      setGuestList((data || []).filter((row) => row.source === 'guest'));
    } catch {
      setGuestList([]);
    }
  }

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
        if (isMaster) await loadGuests(dateISO);
      } catch (err) {
        showAlert(err.message || 'Não foi possível registrar presença.');
      }
    }
    registerPresence();
    return () => {
      active = false;
    };
  }, [user, profile, loading, navigate, location.pathname, location.search, showAlert, isMaster]);

  async function addGuest() {
    const playerName = String(guestName || '').trim();
    if (!playerName) {
      showAlert('Informe o nome do visitante.');
      return;
    }
    try {
      await createDailyVisitor({
        player_name: playerName,
        date_iso: savedDate || todayISOInSaoPaulo()
      });
      setGuestName('');
      await loadGuests(savedDate || todayISOInSaoPaulo());
    } catch (err) {
      showAlert(err.message || 'Não foi possível registrar visitante.');
    }
  }

  async function removeGuest(id) {
    try {
      await deleteDailyVisitor(id);
      await loadGuests(savedDate || todayISOInSaoPaulo());
    } catch (err) {
      showAlert(err.message || 'Não foi possível remover visitante.');
    }
  }

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

        {done && isMaster ? (
          <div className="presence-guest-box">
            <div className="label">Adicionar visitante do dia</div>
            <div className="actions actions-left">
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Nome do visitante"
              />
              <button className="btn-controle" onClick={addGuest}>Adicionar</button>
            </div>
            {guestList.length ? (
              <div className="registered-list" style={{ marginTop: 12, textAlign: 'left' }}>
                {guestList.map((guest) => (
                  <div className="registered-row" key={guest.id}>
                    <span>{guest.player_name}</span>
                    <button className="btn-outline btn-small" onClick={() => removeGuest(guest.id)}>Excluir</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 10 }}>Nenhum visitante registrado hoje.</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
