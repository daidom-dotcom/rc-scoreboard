import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useGame } from '../contexts/GameContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDateBR } from '../utils/time';

export default function ManageUsersPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [invites, setInvites] = useState([]);
  const { showAlert, askConfirm } = useGame();
  const { isMaster } = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const [showMaster, setShowMaster] = useState(true);
  const [showCommon, setShowCommon] = useState(true);

  async function inviteMaster() {
    const target = email.trim().toLowerCase();
    if (!target) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('invite_master', { email_input: target });
      if (error) throw error;
      showAlert('Convite criado. O usuário deve definir a senha no primeiro login.');
      setEmail('');
      await loadInvites();
    } catch (err) {
      showAlert(err.message || 'Falha ao criar convite');
    } finally {
      setLoading(false);
    }
  }

  async function resendInvite(targetEmail) {
    if (!targetEmail) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('invite_master', { email_input: targetEmail });
      if (error) throw error;
      showAlert('Convite reenviado.');
      await loadInvites();
    } catch (err) {
      showAlert(err.message || 'Falha ao reenviar convite');
    } finally {
      setLoading(false);
    }
  }

  async function loadInvites(profileList = []) {
    try {
      const existing = new Set((profileList || []).map((p) => String(p.email || '').toLowerCase()));
      const { data, error } = await supabase
        .from('master_invites')
        .select('id,email,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const filtered = (data || []).filter((inv) => !existing.has(String(inv.email || '').toLowerCase()));
      setInvites(filtered);
    } catch {
      // ignore
    }
  }

  async function loadUsers() {
    setLoading(true);
    try {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id,email,full_name,role,is_active')
        .order('created_at', { ascending: true });
      if (profilesError) throw profilesError;

      const { data: entryRows, error: entryError } = await supabase
        .from('player_entries')
        .select('user_id, matches(date_iso)')
        .order('created_at', { ascending: false });
      if (entryError) throw entryError;

      setUsers(profiles || []);
      setEntries(entryRows || []);
      await loadInvites(profiles || []);
    } catch (err) {
      showAlert(err.message || 'Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  const statsByUser = useMemo(() => {
    const map = new Map();
    entries.forEach((e) => {
      if (!e.user_id) return;
      const info = map.get(e.user_id) || { count: 0, last: null };
      info.count += 1;
      const date = e.matches?.date_iso || null;
      if (date && (!info.last || date > info.last)) info.last = date;
      map.set(e.user_id, info);
    });
    return map;
  }, [entries]);

  async function setUserActive(userId, active) {
    const ok = await askConfirm(active ? 'Ativar este usuário?' : 'Excluir este usuário?');
    if (!ok) return;
    setLoading(true);
    try {
      const payload = active ? { is_active: true } : { is_active: false, role: 'observer' };
      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', userId);
      if (error) throw error;
      await loadUsers();
    } catch (err) {
      showAlert(err.message || 'Erro ao atualizar usuário');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="label">Convidar Master</div>
      <div className="inline-field">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@exemplo.com"
        />
        <button className="btn-controle" onClick={inviteMaster} disabled={loading}>Convidar</button>
      </div>

      {invites.length ? (
        <div className="users-table" style={{ marginTop: 14 }}>
          <div className="users-row users-head">
            <div>Pendentes</div>
            <div>Criado em</div>
            <div></div>
          </div>
          {invites.map((inv) => (
            <div className="users-row" key={inv.id}>
              <div>{inv.email}</div>
              <div>{inv.created_at ? formatDateBR(inv.created_at.slice(0, 10)) : '-'}</div>
              <div>
                <button
                  className="btn-outline btn-small"
                  onClick={() => resendInvite(inv.email)}
                  disabled={loading}
                >
                  Reenviar convite
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="label" style={{ marginTop: 18 }}>Usuários</div>
      <div className="users-filters">
        <label>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostrar inativos
        </label>
        <label>
          <input type="checkbox" checked={showMaster} onChange={(e) => setShowMaster(e.target.checked)} />
          Master
        </label>
        <label>
          <input type="checkbox" checked={showCommon} onChange={(e) => setShowCommon(e.target.checked)} />
          Comum
        </label>
      </div>
      <div className="users-table">
        <div className="users-row users-head">
          <div>Nome</div>
          <div>Partidas</div>
          <div>Último jogo</div>
          <div>Email</div>
          <div>Papel</div>
          <div></div>
        </div>

        {users.length === 0 ? (
          <div className="users-empty">Nenhum usuário encontrado.</div>
        ) : null}
        {users
          .filter((u) => (showInactive ? true : u.is_active !== false))
          .filter((u) => (u.role === 'master' ? showMaster : showCommon))
          .map((u) => {
          const stats = statsByUser.get(u.id) || { count: 0, last: null };
          return (
            <div className={`users-row ${u.is_active === false ? 'inactive' : ''}`} key={u.id}>
              <div>{u.full_name || '-'}</div>
              <div>{stats.count}</div>
              <div>{stats.last ? formatDateBR(stats.last) : '-'}</div>
              <div>{u.email}</div>
              <div>{u.role === 'master' ? 'Master' : 'Comum'}</div>
              <div>
                {isMaster ? (
                  <button
                    className="btn-outline btn-small"
                    onClick={() => setUserActive(u.id, u.is_active === false)}
                    disabled={loading}
                  >
                    {u.is_active === false ? 'Ativar' : 'Inativar'}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
