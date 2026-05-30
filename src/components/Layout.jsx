import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ConfirmModal from './ConfirmModal';
import AlertModal from './AlertModal';
import PasswordModal from './PasswordModal';
import OvertimeModal from './OvertimeModal';
import { useEffect, useState } from 'react';
import { useGame } from '../contexts/GameContext';

export default function Layout() {
  const { user, isMaster, isScoreboard, loading, signOut } = useAuth();
  const { settings } = useGame();
  const location = useLocation();
  const navigate = useNavigate();
  const isGameRoute = location.pathname === '/game';
  const [showNav, setShowNav] = useState(true);
  const [timerScale, setTimerScale] = useState(settings.quickTimerScale || 2);
  const [scoreScale, setScoreScale] = useState(settings.quickScoreScale || 2);
  const [logoutPwdOpen, setLogoutPwdOpen] = useState(false);
  const MIN_FONT_PX = 12;
  const MIN_SCALE = Math.max(MIN_FONT_PX / 86, MIN_FONT_PX / 200);

  useEffect(() => {
    if (isGameRoute) {
      setShowNav(false);
    } else {
      setShowNav(true);
    }
  }, [isGameRoute]);

  useEffect(() => {
    if (loading) return;
    if (user && isScoreboard && location.pathname !== '/game') {
      navigate('/game', { replace: true });
    }
  }, [user, isScoreboard, location.pathname, navigate, loading]);

  useEffect(() => {
    if (loading) return;
    if (user && !isMaster && !isScoreboard && (location.pathname === '/' || location.pathname === '/login')) {
      navigate('/game', { replace: true });
    }
  }, [user, isMaster, isScoreboard, location.pathname, navigate, loading]);

  useEffect(() => {
    if (!isGameRoute) return;
    setTimerScale(Number(settings.quickTimerScale || 2));
    setScoreScale(Number(settings.quickScoreScale || 2));
  }, [isGameRoute, settings.quickTimerScale, settings.quickScoreScale]);

  useEffect(() => {
    document.documentElement.style.setProperty('--timer-scale', String(timerScale));
    document.documentElement.style.setProperty('--score-scale', String(scoreScale));
    document.documentElement.style.setProperty('--logo-scale', String(settings.quickLogoScale || 1));
    document.documentElement.style.setProperty('--match-label-scale', String(settings.quickMatchLabelScale || 1));
    document.documentElement.style.setProperty('--team-name-scale', String(settings.quickTeamNameScale || 1));
    document.documentElement.style.setProperty('--player-name-scale', String(settings.quickPlayerNameScale || 1));
    document.documentElement.style.setProperty('--controls-scale', String(settings.quickControlsScale || 1));
  }, [timerScale, scoreScale, settings.quickLogoScale, settings.quickMatchLabelScale, settings.quickTeamNameScale, settings.quickPlayerNameScale, settings.quickControlsScale]);

  function adjustFont(delta) {
    setTimerScale((v) => Number(Math.max(MIN_SCALE, v + delta).toFixed(2)));
    setScoreScale((v) => Number(Math.max(MIN_SCALE, v + delta).toFixed(2)));
  }

  async function toggleFullScreen() {
    const root = document.documentElement;
    const isFull = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (!isFull) {
        const request = root.requestFullscreen || root.webkitRequestFullscreen;
        if (request) await request.call(root);
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      }
    } catch {
      // Fullscreen must be triggered by the tap gesture; unsupported browsers just ignore it.
    }
  }

  async function handleLogout() {
    if (user && isScoreboard) {
      setLogoutPwdOpen(true);
      return;
    }
    await signOut();
    navigate('/');
  }

  async function confirmLogoutPassword(value) {
    if (value !== '834856') {
      window.alert('Senha incorreta.');
      return;
    }
    setLogoutPwdOpen(false);
    await signOut();
    navigate('/');
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div>Rachão dos Crias</div>
          <div className="brand-sub">Desenvolvido por Daiane Esteves · V.1.2.67</div>
        </div>
        <nav className={`nav ${showNav ? '' : 'nav-hidden'}`} style={isScoreboard ? { display: 'none' } : undefined}>
          {location.pathname !== '/' ? (
            <NavLink to="/" className="nav-link">Home</NavLink>
          ) : null}
          {user ? (
            <NavLink to="/presence" className="nav-link">Presença</NavLink>
          ) : null}
          {user ? (
            <NavLink to="/checkin" className="nav-link">Minhas Partidas</NavLink>
          ) : null}
          {user && !loading && !isMaster && !isScoreboard ? (
            <NavLink to="/game" className="nav-link">🔥 Ao Vivo</NavLink>
          ) : null}
          {user && !loading && isMaster ? (
            <>
              <NavLink to="/tournament" className="nav-link">Torneio</NavLink>
              <NavLink to="/game" className="nav-link">Partida Rápida</NavLink>
              <NavLink to="/settings" className="nav-link">Configurações</NavLink>
            </>
          ) : null}
          {user ? (
            <NavLink to="/history" className="nav-link">Histórico</NavLink>
          ) : null}
        </nav>
        <div className="auth">
          {isGameRoute ? (
            <>
              <button
                className="btn-outline btn-ghost topbar-btn"
                onClick={() => adjustFont(-0.1)}
                title="Diminuir fonte"
                aria-label="Diminuir fonte"
              >
                A-
              </button>
              <button
                className="btn-outline btn-ghost topbar-btn"
                onClick={() => adjustFont(0.1)}
                title="Aumentar fonte"
                aria-label="Aumentar fonte"
              >
                A+
              </button>
            </>
          ) : null}
          {isGameRoute && !isScoreboard ? (
            <button
              className="btn-outline btn-ghost topbar-btn"
              onClick={() => setShowNav((v) => !v)}
              title={showNav ? 'Ocultar menu' : 'Mostrar menu'}
              aria-label="Mostrar ou ocultar menu"
            >
              {showNav ? '🔼' : '🔽'}
            </button>
          ) : null}
          {user && !loading && isMaster && !isScoreboard ? (
            <NavLink to="/settings" className="btn-outline btn-ghost topbar-btn" title="Configurações" aria-label="Configurações">
              ⚙️
            </NavLink>
          ) : null}
          <button className="btn-outline btn-ghost topbar-btn" onClick={toggleFullScreen} title="Tela cheia" aria-label="Tela cheia">
            ⛶
          </button>
          {user ? (
            <button className="btn-outline topbar-btn" onClick={handleLogout}>Sair</button>
          ) : (
            <NavLink to="/login" className="btn-outline topbar-btn">Login</NavLink>
          )}
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <ConfirmModal />
      <OvertimeModal />
      <AlertModal />
      <PasswordModal
        open={logoutPwdOpen}
        title="Confirmar saída"
        message="Digite a senha para sair."
        onClose={() => setLogoutPwdOpen(false)}
        onConfirm={confirmLogoutPassword}
      />
    </div>
  );
}
