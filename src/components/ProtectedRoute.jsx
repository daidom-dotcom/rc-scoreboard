import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, loading, isMaster } = useAuth();
  if (loading) return <div className="panel">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isMaster) return <Navigate to="/history" replace />;
  return children;
}
