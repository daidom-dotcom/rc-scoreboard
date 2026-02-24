import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ConfirmModal from './ConfirmModal';
import AlertModal from './AlertModal';

export default function Layout() {
  const { user, isMaster, signOut } = useAuth();

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
        <nav className="nav">
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
          <NavLink to="/history" className="nav-link">Histórico</NavLink>
          {user && isMaster ? (
            <NavLink to="/settings" className="nav-link gear" title="Configurações" aria-label="Configurações">
              ⚙️
            </NavLink>
          ) : null}
        </nav>
        <div className="auth">
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
