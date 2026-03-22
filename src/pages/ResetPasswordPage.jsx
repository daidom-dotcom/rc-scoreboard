import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useGame } from '../contexts/GameContext';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { showAlert } = useGame();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;
    async function initRecovery() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          window.history.replaceState({}, document.title, '/reset-password');
        }
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session && window.location.hash.includes('access_token=')) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!userData?.user?.id) throw new Error('Link inválido ou expirado.');
        if (active) setReady(true);
      } catch (err) {
        if (active) setErrorMessage(err.message || 'Não foi possível validar o link de redefinição.');
      }
    }
    initRecovery();
    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    if (!password || password !== confirmPassword) {
      showAlert('As senhas devem coincidir.');
      return;
    }
    setLoading(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      if (userData?.user?.id) {
        await supabase
          .from('profiles')
          .update({ must_reset_password: false })
          .eq('id', userData.user.id);
      }
      await supabase.auth.signOut();
      showAlert('Nova senha cadastrada com sucesso.');
      navigate('/login', { replace: true });
    } catch (err) {
      showAlert(err.message || 'Não foi possível cadastrar a nova senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel auth-panel">
      <h2>Redefinir Senha</h2>
      {errorMessage ? (
        <div>{errorMessage}</div>
      ) : !ready ? (
        <div>Validando link...</div>
      ) : (
        <>
          <label className="label">Nova Senha</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

          <label className="label">Confirmar Nova Senha</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />

          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn-controle" onClick={handleSave} disabled={loading}>Salvar nova senha</button>
          </div>
        </>
      )}
    </div>
  );
}
