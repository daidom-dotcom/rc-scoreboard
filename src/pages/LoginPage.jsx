import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useGame } from '../contexts/GameContext';

export default function LoginPage() {
  const { signIn, signUp, resetPassword, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [needPasswordSetup, setNeedPasswordSetup] = useState(false);
  const [createObserver, setCreateObserver] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { showAlert } = useGame();
  const redirectTo = new URLSearchParams(location.search).get('redirect') || '/';
  const isRecoveryMode = location.hash.includes('type=recovery') || location.hash.includes('access_token=');

  async function handleLogin() {
    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('email,must_reset_password')
        .eq('email', normalizedEmail)
        .maybeSingle();
      if (profileRow?.must_reset_password) {
        await resetPassword(normalizedEmail);
        showAlert('Sua senha foi resetada. Enviamos um email para você cadastrar uma nova senha sem informar a anterior.');
        return;
      }
      await signIn(normalizedEmail, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const { data } = await supabase
        .from('pending_invites')
        .select('email')
        .eq('email', normalizedEmail)
        .maybeSingle();
      if (data) {
        setNeedPasswordSetup(true);
        setConfirmPassword('');
        showAlert('Sua senha ainda não foi cadastrada. Defina uma senha para usar o Placar do Rachão.');
      } else {
        showAlert(err.message || 'Falha no login');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      showAlert('Informe seu email para recuperar a senha.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(normalizedEmail);
      showAlert('Enviamos um email para redefinição de senha.');
    } catch (err) {
      showAlert(err?.message || 'Não foi possível enviar o email de recuperação.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    if (!firstName.trim() || !lastName.trim() || !nickname.trim()) {
      showAlert('Informe nome, sobrenome e como gostaria de ser chamado.');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('As senhas devem coincidir.');
      return;
    }
    setLoading(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      await signUp(email, password, fullName, nickname.trim());
      await supabase.from('pending_invites').delete().eq('email', email.trim().toLowerCase());
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const msg = err?.message || '';
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
        showAlert('Usuário já existe.');
      } else {
        showAlert(msg || 'Falha ao criar conta');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRecoveryPassword() {
    if (!password || password !== confirmPassword) {
      showAlert('As senhas devem coincidir.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      if (user?.id) {
        await supabase
          .from('profiles')
          .update({ must_reset_password: false })
          .eq('id', user.id);
      }
      showAlert('Nova senha cadastrada com sucesso.');
      navigate('/', { replace: true });
    } catch (err) {
      showAlert(err.message || 'Não foi possível cadastrar a nova senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel auth-panel">
      <h2>Login</h2>
      {isRecoveryMode ? (
        <>
          <label className="label">Nova Senha</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

          <label className="label">Confirmar Nova Senha</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </>
      ) : (needPasswordSetup || createObserver) ? (
        <>
          <label className="label">Nome</label>
          <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />

          <label className="label">Sobrenome</label>
          <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />

          <label className="label">Como gostaria de ser chamado?</label>
          <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} required />

          <label className="label">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

          <label className="label">Senha</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

          <label className="label">Confirmar Senha</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </>
      ) : (
        <>
          <label className="label">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

          <label className="label">Senha</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </>
      )}

      <div className="actions" style={{ marginTop: 12 }}>
        {isRecoveryMode ? (
          <button className="btn-controle" onClick={handleRecoveryPassword} disabled={loading}>Salvar nova senha</button>
        ) : (needPasswordSetup || createObserver) ? (
          <button className="btn-controle" onClick={handleSignup} disabled={loading}>Definir Senha</button>
        ) : (
          <>
            <button className="btn-outline" onClick={() => setCreateObserver(true)} disabled={loading}>Novo Usuário</button>
            <button className="btn-controle" onClick={handleLogin} disabled={loading}>Entrar</button>
            <button className="btn-outline" onClick={handleForgotPassword} disabled={loading}>Esqueci minha senha</button>
          </>
        )}
      </div>
    </div>
  );
}
