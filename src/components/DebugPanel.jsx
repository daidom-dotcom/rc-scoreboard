import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';

export default function DebugPanel() {
  const { user, profile, isMaster } = useAuth();
  const { lastError } = useGame();

  return (
    <div className="panel">
      <div className="label">Diagnóstico</div>
      <div className="debug-line">User: {user?.email || '—'}</div>
      <div className="debug-line">UID: {user?.id || '—'}</div>
      <div className="debug-line">Role: {profile?.role || '—'} (isMaster: {String(!!isMaster)})</div>
      <div className="debug-line">Último erro: {lastError?.message || '—'}</div>
      {lastError ? (
        <pre className="debug-pre">{JSON.stringify(lastError, null, 2)}</pre>
      ) : null}
    </div>
  );
}
