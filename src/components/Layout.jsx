import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ConfirmModal from './ConfirmModal';
import AlertModal from './AlertModal';
import { useEffect, useState } from 'react';

export default function Layout() {
  const { user, isMaster, signOut } = useAuth();
  const location = useLocation();
  const isGameRoute = location.pathname === '/game';
  const [showNav, setShowNav] = useState(true);

  useEffect(() => {
    if (isGameRoute) {
      setShowNav(false);
    } else {
      setShowNav(true);
    }
  }, [isGameRoute]);

  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div>Rachão dos Crias</div>
          <div className="brand-sub">Desenvolvido por Daiane Esteves</div>
        </div>
        <nav className={`nav ${showNav ? '' : 'nav-hidden'}`}>
          <NavLink to="/" className="nav-link">Home</NavLink>
          {user ? (
            <NavLink to="/checkin" className="nav-link">Check-in</NavLink>
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
            <button
              className="btn-outline btn-ghost"
              onClick={() => setShowNav((v) => !v)}
              title={showNav ? 'Ocultar menu' : 'Mostrar menu'}
              aria-label="Mostrar ou ocultar menu"
            >
              {showNav ? '🔼' : '🔽'}
            </button>
          ) : null}
          {user && isMaster ? (
            <NavLink to="/settings" className="btn-outline btn-ghost" title="Configurações" aria-label="Configurações">
              ⚙️
            </NavLink>
          ) : null}
          <button className="btn-outline btn-ghost" onClick={toggleFullScreen} title="Tela cheia" aria-label="Tela cheia">
            ⛶
          </button>
          {user ? (
            <button className="btn-outline" onClick={signOut}>Sair</button>
          ) : (
            <NavLink to="/login" className="btn-outline">Login</NavLink>
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
