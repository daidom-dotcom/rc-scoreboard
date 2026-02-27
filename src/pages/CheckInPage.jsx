import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGame } from '../contexts/GameContext';
import { useAuth } from '../contexts/AuthContext';
import { fetchLiveGame, fetchMatchesByDate } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatDateBR, todayISO } from '../utils/time';
import SelectField from '../components/SelectField';

export default function CheckInPage() {
  const { dateISO: gameDateISO, showAlert } = useGame();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [dateISO, setDateISO] = useState(gameDateISO || todayISO());
  const [matches, setMatches] = useState([]);
  const [matchId, setMatchId] = useState('');
  const [teamSide, setTeamSide] = useState('A');
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
      const aTime = a.match_results?.[0]?.finished_at || a.created_at;
      const bTime = b.match_results?.[0]?.finished_at || b.created_at;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });
    return list;
  }, [matches]);

  const displayMatches = useMemo(() => {
    const map = new Map();
    orderedMatches.forEach((m) => {
      const key = m.match_no ? `n-${m.match_no}` : `id-${m.id}`;
      if (!map.has(key)) map.set(key, m);
    });
    return Array.from(map.values());
  }, [orderedMatches]);

  const currentMatch = useMemo(() => orderedMatches.find((m) => m.id === matchId), [orderedMatches, matchId]);
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
    if (qDate) setDateISO(qDate);
  }, [location.search]);

  async function loadMatches() {
    setLoading(true);
    try {
      const targetDate = onlyToday ? (dateISO || todayISO()) : dateISO;
      const [data, live] = await Promise.all([
        fetchMatchesByDate(targetDate),
        fetchLiveGame().catch(() => null)
      ]);
      let filtered = data;
      if (live?.mode === 'quick' && live?.match_no) {
        filtered = data.filter((m) => m.mode !== 'quick' || (m.match_no && m.match_no <= live.match_no));
      }
      setMatches(filtered);
      if (filtered.length && !matchId) setMatchId(filtered[0].id);
    } catch (err) {
      showAlert(err.message || 'Erro ao carregar partidas');
    } finally {
      setLoading(false);
    }
  }

  async function loadEntries() {
    if (!user?.id || !dateISO) return;
    const targetDate = onlyToday ? (dateISO || todayISO()) : dateISO;
    const { data, error } = await supabase
      .from('player_entries')
      .select('id, team_side, match_id, matches(id, team_a_name, team_b_name, date_iso)')
      .eq('user_id', user.id)
      .eq('date_iso', targetDate)
      .order('created_at', { ascending: false });
    if (error) return;
    setEntries(data || []);
  }

  async function submit() {
    if (!user?.id) {
      showAlert('Você precisa estar logado para fazer check-in.');
      return;
    }
    if (!matchId) {
      showAlert('Informe a partida.');
      return;
    }

    try {
      const { error } = await supabase
        .from('player_entries')
        .upsert({
          match_id: matchId,
          user_id: user.id,
          player_name: profile?.full_name || user.email,
          team_side: teamSide,
          date_iso: dateISO
        }, { onConflict: 'user_id,match_id' });
      if (error) throw error;
      showAlert('Check-in registrado!');
      await loadEntries();
    } catch (err) {
      showAlert(err.message || 'Erro ao registrar check-in');
    }
  }

  async function removeEntry(entryId) {
    if (!entryId) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('player_entries')
        .delete()
        .eq('id', entryId)
        .eq('user_id', user.id);
      if (error) throw error;
      await loadEntries();
    } catch (err) {
      showAlert(err.message || 'Erro ao excluir check-in');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <h1 className="hTitle">Check‑in</h1>
      <div className="panel">
        <div className="label">Olá, {profile?.full_name || user?.email}.</div>
        <div>Informe em quais partidas você jogou no dia {formatDateBR(dateISO)} e obtenha resultados personalizados.</div>
      </div>

      <div className="panel">
        <div className="label">Partida</div>
        <div className="users-filters">
          <label>
            <input type="checkbox" checked={onlyToday} onChange={(e) => setOnlyToday(e.target.checked)} />
            Apenas partidas do dia atual
          </label>
        </div>
        <SelectField value={matchId} onChange={(e) => setMatchId(e.target.value)}>
          {displayMatches.length === 0 ? (
            <option value="">Nenhuma partida registrada</option>
          ) : null}
          {displayMatches.map((m, idx) => (
            <option key={m.id} value={m.id}>
              Partida {m.match_no || (idx + 1)} · {m.team_a_name} vs {m.team_b_name}
            </option>
          ))}
        </SelectField>

        <div className="label">Vou jogar pelo time... / Joguei pelo time...</div>
        <SelectField value={teamSide} onChange={(e) => setTeamSide(e.target.value)}>
          <option value="A">{currentMatch?.team_a_name || 'Time 1'}</option>
          <option value="B">{currentMatch?.team_b_name || 'Time 2'}</option>
        </SelectField>

        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn-controle" onClick={submit} disabled={loading}>Registrar</button>
        </div>
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
              const number = orderMap.get(e.match_id) || '-';
              return (
              <div className="users-row" key={e.id}>
                <div>Partida {number} · {e.matches?.team_a_name} vs {e.matches?.team_b_name}</div>
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

      <div className="actions" style={{ marginTop: 18 }}>
        <button
          className="btn-controle"
          onClick={() => navigate(`/history?scope=mine&date=${dateISO}&dateTo=${dateISO}`)}
          style={{ textAlign: 'center' }}
        >
          Resultados
        </button>
      </div>
    </div>
  );
}
