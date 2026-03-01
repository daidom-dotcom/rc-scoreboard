import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ConfirmModal from './ConfirmModal';
import AlertModal from './AlertModal';
import { useEffect, useState } from 'react';

export default function Layout() {
  const { user, isMaster, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isGameRoute = location.pathname === '/game';
  const [showNav, setShowNav] = useState(true);
  const [timerScale, setTimerScale] = useState(1);
  const [scoreScale, setScoreScale] = useState(1);

  useEffect(() => {
    if (isGameRoute) {
      setShowNav(false);
    } else {
      setShowNav(true);
    }
  }, [isGameRoute]);

  useEffect(() => {
    document.documentElement.style.setProperty('--timer-scale', String(timerScale));
    document.documentElement.style.setProperty('--score-scale', String(scoreScale));
  }, [timerScale, scoreScale]);

  function adjustFont(delta) {
    setTimerScale((v) => Number((v + delta).toFixed(2)));
    setScoreScale((v) => Number((v + delta).toFixed(2)));
  }

  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }

  async function handleLogout() {
    await signOut();
    navigate('/');
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div>Rachão dos Crias</div>
          <div className="brand-sub">Desenvolvido por Daiane Esteves · V.1.0.19</div>
        </div>
        <nav className={`nav ${showNav ? '' : 'nav-hidden'}`}>
          {location.pathname !== '/' ? (
            <NavLink to="/" className="nav-link">Home</NavLink>
          ) : null}
          {user ? (
            <NavLink to="/checkin" className="nav-link">Check-in</NavLink>
          ) : null}
          {user && !isMaster ? (
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
          {isGameRoute ? (
            <button
              className="btn-outline btn-ghost topbar-btn"
              onClick={() => setShowNav((v) => !v)}
              title={showNav ? 'Ocultar menu' : 'Mostrar menu'}
              aria-label="Mostrar ou ocultar menu"
            >
              {showNav ? '🔼' : '🔽'}
            </button>
          ) : null}
          {user && isMaster ? (
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
      <AlertModal />
    </div>
  );
}
