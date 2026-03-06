import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useGame } from '../contexts/GameContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDateBR } from '../utils/time';

function formatTimeBR(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function RegisteredMatchesPage() {
  const { isMaster } = useAuth();
  const { showAlert, askConfirm } = useGame();
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState([]);
  const [entriesByMatch, setEntriesByMatch] = useState(new Map());
  const [eventsByMatch, setEventsByMatch] = useState(new Map());
  const [resultsByMatch, setResultsByMatch] = useState(new Map());

  async function loadAll() {
    setLoading(true);
    try {
      const { data: matchesData, error: mErr } = await supabase
        .from('matches')
        .select('id,date_iso,mode,match_no,status,team_a_name,team_b_name,created_at')
        .order('date_iso', { ascending: false })
        .order('match_no', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (mErr) throw mErr;

      const ids = (matchesData || []).map((m) => m.id).filter(Boolean);
      if (!ids.length) {
        setMatches([]);
        setEntriesByMatch(new Map());
        setEventsByMatch(new Map());
        setResultsByMatch(new Map());
        return;
      }

      const [entriesRes, eventsRes, resultsRes] = await Promise.all([
        supabase
          .from('player_entries')
          .select('id,match_id,player_name,team_side,created_at')
          .in('match_id', ids)
          .order('created_at', { ascending: true }),
        supabase
          .from('basket_events')
          .select('id,match_id,team_side,player_name,points,created_at')
          .in('match_id', ids)
          .order('created_at', { ascending: true }),
        supabase
          .from('match_results')
          .select('match_id,score_a,score_b')
          .in('match_id', ids)
      ]);

      if (entriesRes.error) throw entriesRes.error;
      if (eventsRes.error) throw eventsRes.error;
      if (resultsRes.error) throw resultsRes.error;

      const nextEntries = new Map();
      (entriesRes.data || []).forEach((e) => {
        const arr = nextEntries.get(e.match_id) || [];
        arr.push(e);
        nextEntries.set(e.match_id, arr);
      });

      const nextEvents = new Map();
      (eventsRes.data || []).forEach((e) => {
        const arr = nextEvents.get(e.match_id) || [];
        arr.push(e);
        nextEvents.set(e.match_id, arr);
      });

      const nextResults = new Map();
      (resultsRes.data || []).forEach((r) => {
        nextResults.set(r.match_id, r);
      });

      setMatches(matchesData || []);
      setEntriesByMatch(nextEntries);
      setEventsByMatch(nextEvents);
      setResultsByMatch(nextResults);
    } catch (err) {
      showAlert(err.message || 'Erro ao carregar partidas cadastradas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const groupedByDate = useMemo(() => {
    const map = new Map();
    matches.forEach((m) => {
      const date = m.date_iso || 'sem-data';
      const arr = map.get(date) || [];
      arr.push(m);
      map.set(date, arr);
    });
    return Array.from(map.entries());
  }, [matches]);

  async function removeMatch(matchId) {
    const ok = await askConfirm('Excluir a partida inteira, com check-ins e cestas?');
    if (!ok) return;
    setLoading(true);
    try {
      await supabase.from('basket_events').delete().eq('match_id', matchId);
      await supabase.from('player_entries').delete().eq('match_id', matchId);
      await supabase.from('match_results').delete().eq('match_id', matchId);
      const { error } = await supabase.from('matches').delete().eq('id', matchId);
      if (error) throw error;
      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao excluir partida.');
      setLoading(false);
    }
  }

  async function removeEntry(entryId) {
    const ok = await askConfirm('Excluir este check-in?');
    if (!ok) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('player_entries').delete().eq('id', entryId);
      if (error) throw error;
      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao excluir check-in.');
      setLoading(false);
    }
  }

  async function removeEvent(eventId) {
    const ok = await askConfirm('Excluir esta cesta?');
    if (!ok) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('basket_events').delete().eq('id', eventId);
      if (error) throw error;
      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao excluir cesta.');
      setLoading(false);
    }
  }

  async function removeDay(dateISO) {
    const ok = await askConfirm(`Excluir toda a atividade de ${formatDateBR(dateISO)}?`);
    if (!ok) return;
    setLoading(true);
    try {
      const { data: dayMatches, error: matchErr } = await supabase
        .from('matches')
        .select('id')
        .eq('date_iso', dateISO);
      if (matchErr) throw matchErr;
      const ids = (dayMatches || []).map((m) => m.id).filter(Boolean);

      if (ids.length) {
        await supabase.from('basket_events').delete().in('match_id', ids);
        await supabase.from('player_entries').delete().in('match_id', ids);
        await supabase.from('match_results').delete().in('match_id', ids);
      }

      await supabase.from('player_entries').delete().eq('date_iso', dateISO).is('match_id', null);
      const { error: delMatchesErr } = await supabase.from('matches').delete().eq('date_iso', dateISO);
      if (delMatchesErr) throw delMatchesErr;

      const { data: live } = await supabase.from('live_game').select('id,match_id').eq('id', 1).maybeSingle();
      if (live?.id && live.match_id && ids.includes(live.match_id)) {
        await supabase.from('live_game').update({
          status: 'ended',
          mode: 'quick',
          match_id: null,
          match_no: 1,
          quarter: 1,
          time_left: 0,
          team_a: '',
          team_b: '',
          score_a: 0,
          score_b: 0,
          updated_at: new Date().toISOString()
        }).eq('id', 1);
      }

      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao excluir atividade do dia.');
      setLoading(false);
    }
  }

  if (!isMaster) {
    return (
      <div className="panel">
        <div className="muted">Apenas usuários Master podem visualizar esta área.</div>
      </div>
    );
  }

  return (
    <div className="panel manage-users-panel">
      <div className="label">Partidas cadastradas</div>
      {loading ? <div className="muted">Carregando...</div> : null}

      {!loading && groupedByDate.length === 0 ? (
        <div className="users-empty">Nenhuma partida cadastrada.</div>
      ) : null}

      {groupedByDate.map(([dateISO, dateMatches]) => (
        <details className="registered-date-block" key={dateISO}>
          <summary className="registered-date-title">
            <div className="registered-date-head">
              <span>{formatDateBR(dateISO)} ({dateMatches.length})</span>
              <button
                type="button"
                className="btn-outline btn-small"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeDay(dateISO);
                }}
              >
                Excluir dia
              </button>
            </div>
          </summary>
          <div className="registered-date-list">
            {dateMatches.map((m) => {
              const entries = entriesByMatch.get(m.id) || [];
              const events = eventsByMatch.get(m.id) || [];
              const res = resultsByMatch.get(m.id);
              return (
                <details className="registered-match-card" key={m.id}>
                  <summary className="registered-match-head">
                    <div className="registered-match-title">
                      [{m.mode === 'tournament' ? 'T' : 'P'}] Partida {m.match_no || '-'} | {m.team_a_name} vs {m.team_b_name}
                    </div>
                    <div className="registered-match-meta">
                      <span>Status: {m.status || '-'}</span>
                      <span>Placar: {res ? `${res.score_a} x ${res.score_b}` : '-'}</span>
                      <button
                        type="button"
                        className="btn-outline btn-small"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeMatch(m.id);
                        }}
                      >
                        Excluir partida
                      </button>
                    </div>
                  </summary>

                  <div className="registered-section">
                    <div className="registered-subtitle">Check-ins ({entries.length})</div>
                    {!entries.length ? (
                      <div className="muted">Sem check-in.</div>
                    ) : (
                      <div className="registered-list">
                        {entries.map((e) => (
                          <div className="registered-row" key={e.id}>
                            <span>{e.player_name} | Time {e.team_side}</span>
                            <span>{formatTimeBR(e.created_at)}</span>
                            <button className="btn-outline btn-small" onClick={() => removeEntry(e.id)}>Excluir</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="registered-section">
                    <div className="registered-subtitle">Cestas ({events.length})</div>
                    {!events.length ? (
                      <div className="muted">Sem cestas registradas.</div>
                    ) : (
                      <div className="registered-list">
                        {events.map((e) => (
                          <div className="registered-row" key={e.id}>
                            <span>{formatTimeBR(e.created_at)} | {e.points}pt | {e.player_name || 'Sem nome'} | Time {e.team_side}</span>
                            <button className="btn-outline btn-small" onClick={() => removeEvent(e.id)}>Excluir</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
