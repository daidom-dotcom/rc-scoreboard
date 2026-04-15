import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';

export default function DebugPanel() {
  const { user, profile, isMaster, isScoreboard, loading, authDebug } = useAuth();
  const { lastError } = useGame();
  const elapsedSeconds = Number(((authDebug?.elapsedMs || 0) / 1000).toFixed(2));

  return (
    <div className="panel">
      <div className="label">Diagnóstico</div>
      <div className="debug-line">User: {user?.email || '—'}</div>
      <div className="debug-line">UID: {user?.id || '—'}</div>
      <div className="debug-line">Loading: {String(!!loading)}</div>
      <div className="debug-line">Profile email: {profile?.email || '—'}</div>
      <div className="debug-line">Role: {profile?.role || '—'} (isMaster: {String(!!isMaster)} | isScoreboard: {String(!!isScoreboard)})</div>
      <div className="debug-line">Ativo: {String(profile?.is_active !== false)}</div>
      <div className="debug-line">Nickname: {profile?.nickname || '—'}</div>
      <div className="debug-line">Auth stage: {authDebug?.stage || '—'}</div>
      <div className="debug-line">Auth lookup: {authDebug?.lookup || '—'}</div>
      <div className="debug-line">Auth error: {authDebug?.error || '—'}</div>
      <div className="debug-line">Auth tempo: {elapsedSeconds}s</div>
      <div className="debug-line">Último erro: {lastError?.message || '—'}</div>
      {lastError ? (
        <pre className="debug-pre">{JSON.stringify(lastError, null, 2)}</pre>
      ) : null}
    </div>
  );
}
