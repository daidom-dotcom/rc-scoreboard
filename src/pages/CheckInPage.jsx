import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useGame } from '../contexts/GameContext';
import { useAuth } from '../contexts/AuthContext';
import { fetchMatchesByDate } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatDateBR, todayISOInSaoPaulo } from '../utils/time';
import { preferredDisplayName } from '../utils/names';

export default function CheckInPage() {
  const { showAlert } = useGame();
  const { user, profile } = useAuth();
  const [dateISO, setDateISO] = useState(todayISOInSaoPaulo());
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState([]);
  const [onlyToday, setOnlyToday] = useState(true);

  useEffect(() => {
    if (!dateISO) return;
    loadMatches();
    loadEntries();
  }, [dateISO, onlyToday]);

  const orderedMatches = useMemo(() => {
    const list = [...matches];
    list.sort((a, b) => {
      if (a.match_no && b.match_no) return a.match_no - b.match_no;
      const aTime = a.match_results?.[0]?.finished_at_sp || a.match_results?.[0]?.finished_at || a.created_at;
      const bTime = b.match_results?.[0]?.finished_at_sp || b.match_results?.[0]?.finished_at || b.created_at;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });
    return list;
  }, [matches]);

  const orderMap = useMemo(() => new Map(orderedMatches.map((m, idx) => [m.id, idx + 1])), [orderedMatches]);

  const orderedEntries = useMemo(() => {
    const list = [...entries];
    list.sort((a, b) => {
      const aOrder = orderMap.get(a.match_id) || 9999;
      const bOrder = orderMap.get(b.match_id) || 9999;
      return aOrder - bOrder;
    });
    return list;
  }, [entries, orderMap]);

  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qDate = params.get('date');
    if (qDate && !onlyToday) setDateISO(qDate);
  }, [location.search, onlyToday]);

  async function loadMatches() {
    setLoading(true);
    try {
      const targetDate = onlyToday ? todayISOInSaoPaulo() : dateISO;
      const data = await fetchMatchesByDate(targetDate);
      setMatches(data || []);
    } catch (err) {
      showAlert(err.message || 'Erro ao carregar partidas');
    } finally {
      setLoading(false);
    }
  }

  async function loadEntries() {
    if (!user?.id || !dateISO) return;
    const targetDate = onlyToday ? todayISOInSaoPaulo() : dateISO;
    const { data, error } = await supabase
      .from('player_entries')
      .select('id, team_side, match_id, matches(id, match_no, team_a_name, team_b_name, date_iso)')
      .eq('user_id', user.id)
      .eq('date_iso', targetDate)
      .order('created_at', { ascending: false });
    if (error) return;
    setEntries(data || []);
  }

  async function removeEntry(entryId) {
    if (!entryId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('player_entries')
        .delete()
        .select('id')
        .eq('id', entryId)
        .eq('user_id', user.id);
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Sem permissão para excluir este check-in.');
      }
      await loadEntries();
    } catch (err) {
      showAlert(err.message || 'Erro ao excluir check-in');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <h1 className="hTitle">Minhas Partidas</h1>
      <div className="panel">
        <div className="label">Olá, {preferredDisplayName({ nickname: profile?.nickname, full_name: profile?.full_name, email: user?.email }) || user?.email}.</div>
        <div>Aqui você acompanha em quais partidas jogou no dia {formatDateBR(dateISO)}.</div>
      </div>

      <div className="panel">
        <div className="label">Filtro</div>
        <div className="users-filters">
          <label>
            <input type="checkbox" checked={onlyToday} onChange={(e) => setOnlyToday(e.target.checked)} />
            Apenas partidas do dia atual
          </label>
        </div>
        <div>{loading ? 'Carregando...' : `${matches.length} partidas encontradas no dia.`}</div>
      </div>

      <div className="panel">
        <div className="label">Meus check-ins do dia</div>
        {entries.length === 0 ? (
          <div>Nenhum check-in registrado.</div>
        ) : (
          <div className="users-table checkin-table">
            <div className="users-row users-head">
              <div>Partida</div>
              <div>Time</div>
              <div></div>
            </div>
            {orderedEntries.map((e) => {
              const number = e.matches?.match_no || orderMap.get(e.match_id) || '-';
              return (
              <div className="users-row" key={e.id}>
                <div>Partida - {number} | {e.matches?.team_a_name} vs {e.matches?.team_b_name}</div>
                <div>{e.team_side === 'A' ? e.matches?.team_a_name : e.matches?.team_b_name}</div>
                <div>
                  <button className="btn-outline btn-small" onClick={() => removeEntry(e.id)} disabled={loading}>
                    Excluir
                  </button>
                </div>
              </div>
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
}
