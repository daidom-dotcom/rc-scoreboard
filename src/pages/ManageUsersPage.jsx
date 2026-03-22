import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useGame } from '../contexts/GameContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDateBR } from '../utils/time';
import Modal from '../components/Modal';

export default function ManageUsersPage() {
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('observer');
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [invites, setInvites] = useState([]);
  const { showAlert, askConfirm } = useGame();
  const { isMaster, user } = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const [showMaster, setShowMaster] = useState(true);
  const [showCommon, setShowCommon] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editNickname, setEditNickname] = useState('');

  async function inviteUser() {
    const target = email.trim().toLowerCase();
    if (!target) return;
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke('send-invite', {
        body: { email: target, role: inviteRole }
      });
      if (error) throw error;
      showAlert('Convite enviado. O usuário deve definir a senha no primeiro login.');
      setEmail('');
      await loadInvites();
    } catch (err) {
      showAlert(err.message || 'Falha ao enviar convite');
    } finally {
      setLoading(false);
    }
  }

  async function resendInvite(targetEmail, role) {
    if (!targetEmail) return;
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke('send-invite', {
        body: { email: targetEmail, role: role || 'observer' }
      });
      if (error) throw error;
      showAlert('Convite reenviado.');
      await loadInvites();
    } catch (err) {
      showAlert(err.message || 'Falha ao reenviar convite');
    } finally {
      setLoading(false);
    }
  }

  async function removeInvite(targetEmail) {
    if (!targetEmail) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('remove_invite', { email_input: targetEmail });
      if (error) throw error;
      await loadInvites();
    } catch (err) {
      showAlert(err.message || 'Falha ao remover convite');
    } finally {
      setLoading(false);
    }
  }

  async function loadInvites(profileList = []) {
    try {
      const existing = new Set((profileList || []).map((p) => String(p.email || '').toLowerCase()));
      const { data, error } = await supabase
        .from('master_invites')
        .select('id,email,role,created_at')
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
      let { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id,email,full_name,nickname,role,is_active,must_reset_password')
        .order('created_at', { ascending: true });
      if (profilesError && String(profilesError.message || '').includes('must_reset_password')) {
        const fallback = await supabase
          .from('profiles')
          .select('id,email,full_name,nickname,role,is_active')
          .order('created_at', { ascending: true });
        profiles = (fallback.data || []).map((row) => ({ ...row, must_reset_password: false }));
        profilesError = fallback.error;
      }
      if (profilesError) throw profilesError;

      const { data: entryRows, error: entryError } = await supabase
        .from('player_entries')
        .select('user_id, matches(date_iso)')
        .order('created_at', { ascending: false });
      if (entryError) throw entryError;

      const { data: attendanceRows, error: attendanceError } = await supabase
        .from('daily_attendance')
        .select('user_id,date_iso')
        .order('checked_at', { ascending: false });
      if (attendanceError) throw attendanceError;

      setUsers(profiles || []);
      setEntries(entryRows || []);
      setAttendance(attendanceRows || []);
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

  const attendanceStatsByUser = useMemo(() => {
    const map = new Map();
    attendance.forEach((row) => {
      if (!row.user_id) return;
      const current = map.get(row.user_id) || new Set();
      if (row.date_iso) current.add(row.date_iso);
      map.set(row.user_id, current);
    });
    return map;
  }, [attendance]);

  async function resetUserPassword(targetUser) {
    if (!targetUser?.id || !targetUser?.email) return;
    const ok = await askConfirm(`Resetar a senha de ${targetUser.email}?`);
    if (!ok) return;
    setLoading(true);
    try {
      const { error: markError } = await supabase
        .from('profiles')
        .update({ must_reset_password: true })
        .eq('id', targetUser.id);
      if (markError) throw markError;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(targetUser.email, {
        redirectTo: `${window.location.origin}/login`
      });
      if (resetError) throw resetError;
      showAlert('Email de redefinição enviado.');
      await loadUsers();
    } catch (err) {
      showAlert(err.message || 'Erro ao resetar a senha.');
    } finally {
      setLoading(false);
    }
  }

  async function setUserActive(userId, active) {
    const ok = await askConfirm(active ? 'Ativar este usuário?' : 'Excluir este usuário?', { countdown: false });
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

  async function setUserRole(userId, nextRole) {
    if (!userId) return;
    const ok = await askConfirm(nextRole === 'master' ? 'Promover este usuário a Master?' : 'Rebaixar este usuário para Comum?');
    if (!ok) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('set_user_role', { user_id_input: userId, role_input: nextRole });
      if (error) throw error;
      await loadUsers();
    } catch (err) {
      showAlert(err.message || 'Erro ao atualizar papel do usuário');
    } finally {
      setLoading(false);
    }
  }

  function beginEdit(userRow) {
    const parts = String(userRow.full_name || '').trim().split(/\s+/).filter(Boolean);
    setSelectedUser(userRow);
    setEditFirstName(parts[0] || '');
    setEditLastName(parts.slice(1).join(' '));
    setEditNickname(userRow.nickname || '');
  }

  async function saveUserIdentity(userId) {
    const first = editFirstName.trim();
    const last = editLastName.trim();
    const nick = editNickname.trim();
    if (!first || !last || !nick) {
      showAlert('Informe nome, sobrenome e apelido.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: `${first} ${last}`, nickname: nick })
        .eq('id', userId);
      if (error) throw error;
      setSelectedUser(null);
      await loadUsers();
    } catch (err) {
      showAlert(err.message || 'Erro ao alterar usuário.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel manage-users-panel">
      <div className="label">Convidar Usuário</div>
      <div className="inline-field">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@exemplo.com"
        />
        <select className="invite-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
          <option value="observer">Comum</option>
          <option value="master">Master</option>
        </select>
        <button className="btn-controle" onClick={inviteUser} disabled={loading}>Convidar</button>
      </div>

      {invites.length ? (
        <div className="users-table" style={{ marginTop: 14 }}>
          <div className="users-row users-head">
            <div>Pendentes</div>
            <div>Papel</div>
            <div>Criado em</div>
            <div></div>
          </div>
          {invites.map((inv) => (
            <div className="users-row" key={inv.id}>
              <div className="cell">
                <span className="cell-label">Email</span>
                <span>{inv.email}</span>
              </div>
              <div className="cell">
                <span className="cell-label">Papel</span>
                <span>{inv.role === 'master' ? 'Master' : 'Comum'}</span>
              </div>
              <div className="cell">
                <span className="cell-label">Criado em</span>
                <span>{inv.created_at ? formatDateBR(inv.created_at.slice(0, 10)) : '-'}</span>
              </div>
              <div className="cell">
                <button
                  className="btn-outline btn-small"
                  onClick={() => resendInvite(inv.email, inv.role)}
                  disabled={loading}
                >
                  Reenviar
                </button>
                <button
                  className="btn-outline btn-small"
                  onClick={() => removeInvite(inv.email)}
                  disabled={loading}
                  style={{ marginLeft: 8 }}
                >
                  Remover
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
      <div className="users-mini-list">
        {users.length === 0 ? (
          <div className="users-empty">Nenhum usuário encontrado.</div>
        ) : null}
        {users
          .filter((u) => (showInactive ? true : u.is_active !== false))
          .filter((u) => (u.role === 'master' ? showMaster : showCommon))
          .map((u) => {
          const stats = statsByUser.get(u.id) || { count: 0, last: null };
          const attendanceDays = attendanceStatsByUser.get(u.id)?.size || 0;
          const canToggleRole = isMaster && String(u.email || '').toLowerCase() !== String(user?.email || '').toLowerCase();
          const fullParts = String(u.full_name || '').trim().split(/\s+/).filter(Boolean);
          const firstName = fullParts[0] || '-';
          const surname = fullParts.slice(1).join(' ') || '-';
          return (
            <div className={`users-mini-row ${u.is_active === false ? 'inactive' : ''}`} key={u.id}>
              <div className="users-mini-main">
                <div className="users-mini-name">{u.nickname || firstName} {surname !== '-' ? surname : ''}</div>
                <div className="users-mini-meta">{u.role === 'master' ? 'Master' : 'Comum'} • {stats.count} partidas • {attendanceDays} presenças</div>
              </div>
              {isMaster ? (
                <button
                  className="btn-outline btn-small"
                  onClick={() => beginEdit({ ...u, stats, attendanceDays, canToggleRole, firstName, surname })}
                  disabled={loading}
                >
                  ✏️
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <Modal open={!!selectedUser} onClose={() => setSelectedUser(null)} title="Editar usuário">
        {selectedUser ? (
          <div className="users-modal-body">
            <div className="users-card-grid">
              <div className="users-card-item">
                <span className="cell-label">Nome</span>
                <input type="text" value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} placeholder="Nome" />
              </div>
              <div className="users-card-item">
                <span className="cell-label">Sobrenome</span>
                <input type="text" value={editLastName} onChange={(e) => setEditLastName(e.target.value)} placeholder="Sobrenome" />
              </div>
              <div className="users-card-item">
                <span className="cell-label">Apelido</span>
                <input type="text" value={editNickname} onChange={(e) => setEditNickname(e.target.value)} placeholder="Apelido" />
              </div>
              <div className="users-card-item">
                <span className="cell-label">Partidas</span>
                <span>Partidas: {selectedUser.stats.count}</span>
              </div>
              <div className="users-card-item">
                <span className="cell-label">Presenças</span>
                <span>Presenças: {selectedUser.attendanceDays}</span>
              </div>
              <div className="users-card-item">
                <span className="cell-label">Último jogo</span>
                <span>Último jogo: {selectedUser.stats.last ? formatDateBR(selectedUser.stats.last) : '-'}</span>
              </div>
              <div className="users-card-item users-card-item-wide">
                <span className="cell-label">Email</span>
                <span>{selectedUser.email}</span>
              </div>
              <div className="users-card-item">
                <span className="cell-label">Papel</span>
                <div className="registered-actions">
                  <span className="role-label">{selectedUser.role === 'master' ? 'Master' : 'Comum'}</span>
                  <button
                    className="btn-outline btn-small"
                    disabled={!selectedUser.canToggleRole || loading}
                    onClick={() => setUserRole(selectedUser.id, selectedUser.role === 'master' ? 'observer' : 'master')}
                  >
                    {selectedUser.role === 'master' ? 'Trocar para Comum' : 'Trocar para Master'}
                  </button>
                </div>
              </div>
            </div>
            <div className="registered-actions" style={{ marginTop: 14 }}>
              <button className="btn-controle btn-small" onClick={() => saveUserIdentity(selectedUser.id)} disabled={loading}>Salvar</button>
              <button className="btn-outline btn-small" onClick={() => resetUserPassword(selectedUser)} disabled={loading}>Resetar senha</button>
              <button className="btn-outline btn-small" onClick={() => setUserActive(selectedUser.id, selectedUser.is_active === false)} disabled={loading}>
                {selectedUser.is_active === false ? 'Ativar' : 'Inativar'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
