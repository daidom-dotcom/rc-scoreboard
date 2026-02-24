import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useGame } from '../contexts/GameContext';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [needPasswordSetup, setNeedPasswordSetup] = useState(false);
  const [createObserver, setCreateObserver] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { showAlert } = useGame();

  async function handleLogin() {
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/');
    } catch (err) {
      const { data } = await supabase
        .from('pending_invites')
        .select('email')
        .eq('email', email.trim().toLowerCase())
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

  async function handleSignup() {
    if (!firstName.trim() || !lastName.trim()) {
      showAlert('Informe nome e sobrenome.');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('As senhas devem coincidir.');
      return;
    }
    setLoading(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      await signUp(email, password, fullName);
      await supabase.from('pending_invites').delete().eq('email', email.trim().toLowerCase());
      navigate('/');
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

  return (
    <div className="panel auth-panel">
      <h2>Login</h2>
      {needPasswordSetup || createObserver ? (
        <>
          <label className="label">Nome</label>
          <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />

          <label className="label">Sobrenome</label>
          <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />

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
        {(needPasswordSetup || createObserver) ? (
          <button className="btn-controle" onClick={handleSignup} disabled={loading}>Definir Senha</button>
        ) : (
          <>
            <button className="btn-outline" onClick={() => setCreateObserver(true)} disabled={loading}>Novo Usuário</button>
            <button className="btn-controle" onClick={handleLogin} disabled={loading}>Entrar</button>
          </>
        )}
      </div>
    </div>
  );
}
