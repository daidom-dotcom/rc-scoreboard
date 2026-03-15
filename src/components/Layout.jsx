import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ConfirmModal from './ConfirmModal';
import AlertModal from './AlertModal';
import PasswordModal from './PasswordModal';
import { useEffect, useState } from 'react';

export default function Layout() {
  const { user, isMaster, isScoreboard, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isGameRoute = location.pathname === '/game';
  const [showNav, setShowNav] = useState(true);
  const [timerScale, setTimerScale] = useState(1);
  const [scoreScale, setScoreScale] = useState(1);
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
    if (user && isScoreboard && location.pathname !== '/game') {
      navigate('/game', { replace: true });
    }
  }, [user, isScoreboard, location.pathname, navigate]);

  useEffect(() => {
    if (!isScoreboard || !isGameRoute) return;
    setTimerScale((v) => (v < 2 ? 2 : v));
    setScoreScale((v) => (v < 2 ? 2 : v));
  }, [isScoreboard, isGameRoute]);

  useEffect(() => {
    document.documentElement.style.setProperty('--timer-scale', String(timerScale));
    document.documentElement.style.setProperty('--score-scale', String(scoreScale));
  }, [timerScale, scoreScale]);

  function adjustFont(delta) {
    setTimerScale((v) => Number(Math.max(MIN_SCALE, v + delta).toFixed(2)));
    setScoreScale((v) => Number(Math.max(MIN_SCALE, v + delta).toFixed(2)));
  }

  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
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
          <div className="brand-sub">Desenvolvido por Daiane Esteves · V.1.1.52</div>
        </div>
        <nav className={`nav ${showNav ? '' : 'nav-hidden'}`} style={isScoreboard ? { display: 'none' } : undefined}>
          {location.pathname !== '/' ? (
            <NavLink to="/" className="nav-link">Home</NavLink>
          ) : null}
          {user ? (
            <NavLink to="/checkin" className="nav-link">Check-in</NavLink>
          ) : null}
          {user && !isMaster && !isScoreboard ? (
            <NavLink to="/game" className="nav-link">🔥 Ao Vivo</NavLink>
          ) : null}
          {user && isMaster ? (
            <>
              <NavLink to="/tournament" className="nav-link">Torneio</NavLink>
              <NavLink to="/game" className="nav-link">Partida Rápida</NavLink>
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
          {user && isMaster && !isScoreboard ? (
            <NavLink to="/settings" className="btn-outline btn-ghost topbar-btn" title="Configurações" aria-label="Configurações">
              ⚙️
            </NavLink>
          ) : null}
          {!isScoreboard ? (
            <button className="btn-outline btn-ghost topbar-btn" onClick={toggleFullScreen} title="Tela cheia" aria-label="Tela cheia">
              ⛶
            </button>
          ) : null}
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
