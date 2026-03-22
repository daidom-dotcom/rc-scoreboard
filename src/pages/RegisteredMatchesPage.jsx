import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useGame } from '../contexts/GameContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDateBR } from '../utils/time';
import { preferredDisplayName } from '../utils/names';

function formatTimeBR(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildAliases(rawName) {
  const raw = String(rawName || '').trim();
  if (!raw) return [];
  const first = raw.split(/\s+/)[0] || '';
  return Array.from(new Set([raw.toLowerCase(), first.toLowerCase()].filter(Boolean)));
}

export default function RegisteredMatchesPage() {
  const { isMaster } = useAuth();
  const { showAlert, askConfirm } = useGame();
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState([]);
  const [entriesByMatch, setEntriesByMatch] = useState(new Map());
  const [eventsByMatch, setEventsByMatch] = useState(new Map());
  const [resultsByMatch, setResultsByMatch] = useState(new Map());
  const [attendanceByDate, setAttendanceByDate] = useState(new Map());
  const [editEvent, setEditEvent] = useState(null);

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

      const [attendanceRes, entriesRes, eventsRes, resultsRes] = await Promise.all([
        supabase
          .from('daily_attendance')
          .select('id,user_id,player_name,date_iso,checked_at')
          .order('date_iso', { ascending: false })
          .order('checked_at', { ascending: true }),
        supabase
          .from('player_entries')
          .select('id,match_id,player_name,team_side,created_at,user_id')
          .in('match_id', (matchesData || []).map((m) => m.id).filter(Boolean).length ? (matchesData || []).map((m) => m.id).filter(Boolean) : ['00000000-0000-0000-0000-000000000000'])
          .order('created_at', { ascending: true }),
        supabase
          .from('basket_events')
          .select('id,match_id,team_side,player_name,points,created_at')
          .in('match_id', (matchesData || []).map((m) => m.id).filter(Boolean).length ? (matchesData || []).map((m) => m.id).filter(Boolean) : ['00000000-0000-0000-0000-000000000000'])
          .order('created_at', { ascending: true }),
        supabase
          .from('match_results')
          .select('match_id,score_a,score_b')
          .in('match_id', (matchesData || []).map((m) => m.id).filter(Boolean).length ? (matchesData || []).map((m) => m.id).filter(Boolean) : ['00000000-0000-0000-0000-000000000000'])
      ]);

      if (attendanceRes.error) throw attendanceRes.error;
      if (entriesRes.error) throw entriesRes.error;
      if (eventsRes.error) throw eventsRes.error;
      if (resultsRes.error) throw resultsRes.error;

      const profileIds = Array.from(new Set([
        ...(attendanceRes.data || []).map((row) => row.user_id),
        ...(entriesRes.data || []).map((row) => row.user_id)
      ].filter(Boolean)));
      const { data: profiles, error: profilesError } = profileIds.length
        ? await supabase.from('profiles').select('id,full_name,nickname,email').in('id', profileIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;

      const displayById = new Map((profiles || []).map((profile) => [profile.id, preferredDisplayName(profile)]));
      const aliasByDate = new Map();
      const aliasByMatch = new Map();

      const nextAttendanceByDate = new Map();
      (attendanceRes.data || []).forEach((row) => {
        const displayName = displayById.get(row.user_id) || preferredDisplayName(row.player_name);
        const normalized = { ...row, player_name: displayName };
        const dayList = nextAttendanceByDate.get(row.date_iso) || [];
        dayList.push(normalized);
        nextAttendanceByDate.set(row.date_iso, dayList);
        const dayAliasMap = aliasByDate.get(row.date_iso) || new Map();
        buildAliases(row.player_name).forEach((alias) => dayAliasMap.set(alias, displayName));
        buildAliases(displayName).forEach((alias) => dayAliasMap.set(alias, displayName));
        aliasByDate.set(row.date_iso, dayAliasMap);
      });

      const nextEntriesByMatch = new Map();
      (entriesRes.data || []).forEach((row) => {
        const match = (matchesData || []).find((m) => m.id === row.match_id);
        const displayName = displayById.get(row.user_id) || preferredDisplayName(row.player_name);
        const normalized = { ...row, player_name: displayName };
        const list = nextEntriesByMatch.get(row.match_id) || [];
        list.push(normalized);
        nextEntriesByMatch.set(row.match_id, list);
        const matchAliasMap = aliasByMatch.get(row.match_id) || new Map();
        buildAliases(row.player_name).forEach((alias) => matchAliasMap.set(alias, displayName));
        buildAliases(displayName).forEach((alias) => matchAliasMap.set(alias, displayName));
        aliasByMatch.set(row.match_id, matchAliasMap);
        if (match?.date_iso) {
          const dayAliasMap = aliasByDate.get(match.date_iso) || new Map();
          buildAliases(row.player_name).forEach((alias) => dayAliasMap.set(alias, displayName));
          buildAliases(displayName).forEach((alias) => dayAliasMap.set(alias, displayName));
          aliasByDate.set(match.date_iso, dayAliasMap);
        }
      });

      const nextEventsByMatch = new Map();
      (eventsRes.data || []).forEach((row) => {
        const match = (matchesData || []).find((m) => m.id === row.match_id);
        const matchAliasMap = aliasByMatch.get(row.match_id) || new Map();
        const dayAliasMap = match?.date_iso ? (aliasByDate.get(match.date_iso) || new Map()) : new Map();
        const displayName = matchAliasMap.get(String(row.player_name || '').trim().toLowerCase())
          || dayAliasMap.get(String(row.player_name || '').trim().toLowerCase())
          || preferredDisplayName(row.player_name);
        const list = nextEventsByMatch.get(row.match_id) || [];
        list.push({ ...row, player_name: displayName });
        nextEventsByMatch.set(row.match_id, list);
      });

      const nextResultsByMatch = new Map();
      (resultsRes.data || []).forEach((row) => nextResultsByMatch.set(row.match_id, row));

      setMatches(matchesData || []);
      setAttendanceByDate(nextAttendanceByDate);
      setEntriesByMatch(nextEntriesByMatch);
      setEventsByMatch(nextEventsByMatch);
      setResultsByMatch(nextResultsByMatch);
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
    matches.forEach((match) => {
      const list = map.get(match.date_iso) || [];
      list.push(match);
      map.set(match.date_iso, list);
    });
    attendanceByDate.forEach((attendance, dateISO) => {
      if (!map.has(dateISO)) map.set(dateISO, []);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [matches, attendanceByDate]);

  function getDayPlayerOptions(dateISO, dateMatches) {
    const map = new Map();
    (attendanceByDate.get(dateISO) || []).forEach((row) => {
      map.set(row.player_name, row.player_name);
    });
    dateMatches.forEach((match) => {
      (entriesByMatch.get(match.id) || []).forEach((entry) => {
        map.set(entry.player_name, entry.player_name);
      });
    });
    map.set('Outros', 'Outros');
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function getDayBasketStats(dateMatches) {
    const stats = new Map();
    dateMatches.forEach((match) => {
      (eventsByMatch.get(match.id) || []).forEach((event) => {
        const name = event.player_name || 'Outros';
        const current = stats.get(name) || { name, one: 0, two: 0, three: 0, total: 0 };
        if (Number(event.points) === 1) current.one += 1;
        if (Number(event.points) === 2) current.two += 1;
        if (Number(event.points) === 3) current.three += 1;
        current.total += Number(event.points || 0);
        stats.set(name, current);
      });
    });
    return Array.from(stats.values()).sort((a, b) => b.total - a.total || (b.one + b.two + b.three) - (a.one + a.two + a.three));
  }

  async function removeAttendance(attendanceId) {
    const ok = await askConfirm('Excluir esta presença?');
    if (!ok) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('daily_attendance').delete().eq('id', attendanceId);
      if (error) throw error;
      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao excluir presença.');
      setLoading(false);
    }
  }

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
      const target = Array.from(eventsByMatch.values()).flat().find((event) => event.id === eventId);
      if (!target) throw new Error('Cesta não encontrada.');
      const delta = Number(target.points || 0);
      const scoreColumn = target.team_side === 'A' ? 'score_a' : 'score_b';
      const matchResult = resultsByMatch.get(target.match_id);
      if (matchResult) {
        const currentScore = Number(matchResult[scoreColumn] || 0);
        const { error: updateScoreError } = await supabase
          .from('match_results')
          .update({ [scoreColumn]: Math.max(0, currentScore - delta) })
          .eq('match_id', target.match_id);
        if (updateScoreError) throw updateScoreError;
      }
      const { error } = await supabase.from('basket_events').delete().eq('id', eventId);
      if (error) throw error;
      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao excluir cesta.');
      setLoading(false);
    }
  }

  async function saveEditedEvent(match, originalEvent) {
    const newPoints = Number(editEvent?.points || 0);
    const newPlayer = String(editEvent?.player_name || '').trim();
    if (![1, 2, 3].includes(newPoints)) {
      showAlert('Escolha 1, 2 ou 3 pontos.');
      return;
    }
    if (!newPlayer) {
      showAlert('Escolha o jogador.');
      return;
    }
    setLoading(true);
    try {
      const { error: eventError } = await supabase
        .from('basket_events')
        .update({ points: newPoints, player_name: newPlayer })
        .eq('id', originalEvent.id);
      if (eventError) throw eventError;

      if (newPoints !== Number(originalEvent.points || 0)) {
        const diff = newPoints - Number(originalEvent.points || 0);
        const scoreColumn = originalEvent.team_side === 'A' ? 'score_a' : 'score_b';
        const matchResult = resultsByMatch.get(match.id);
        if (matchResult) {
          const currentScore = Number(matchResult[scoreColumn] || 0);
          const { error: updateScoreError } = await supabase
            .from('match_results')
            .update({ [scoreColumn]: Math.max(0, currentScore + diff) })
            .eq('match_id', match.id);
          if (updateScoreError) throw updateScoreError;
        }
      }
      setEditEvent(null);
      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao alterar cesta.');
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

      await supabase.from('daily_attendance').delete().eq('date_iso', dateISO);
      await supabase.from('player_entries').delete().eq('date_iso', dateISO).is('match_id', null);
      const { error: delMatchesErr } = await supabase.from('matches').delete().eq('date_iso', dateISO);
      if (delMatchesErr) throw delMatchesErr;
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
        <div className="users-empty">Nenhuma atividade cadastrada.</div>
      ) : null}

      {groupedByDate.map(([dateISO, dateMatches]) => {
        const dayAttendance = attendanceByDate.get(dateISO) || [];
        const dayPlayerOptions = getDayPlayerOptions(dateISO, dateMatches);
        const dayStats = getDayBasketStats(dateMatches);
        return (
          <details className="registered-date-block" key={dateISO}>
            <summary className="registered-date-title">
              <div className="registered-date-head">
                <span>{formatDateBR(dateISO)} ({dateMatches.length} jogos)</span>
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
              <details className="registered-match-card">
                <summary className="registered-match-head">
                  <div className="registered-match-title">Participantes ({dayAttendance.length})</div>
                </summary>
                <div className="registered-section">
                  {!dayAttendance.length ? (
                    <div className="muted">Sem presença registrada.</div>
                  ) : (
                    <div className="registered-list">
                      {dayAttendance.map((person) => (
                        <div className="registered-row" key={person.id}>
                          <span>{person.player_name}</span>
                          <span>{formatTimeBR(person.checked_at)}</span>
                          <button className="btn-outline btn-small" onClick={() => removeAttendance(person.id)}>Excluir</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>

              <details className="registered-match-card">
                <summary className="registered-match-head">
                  <div className="registered-match-title">Jogos ({dateMatches.length})</div>
                </summary>
                <div className="registered-section">
                  {!dateMatches.length ? (
                    <div className="muted">Sem jogos neste dia.</div>
                  ) : (
                    <div className="registered-date-list">
                      {dateMatches.map((match) => {
                        const entries = entriesByMatch.get(match.id) || [];
                        const entriesA = entries.filter((entry) => entry.team_side === 'A');
                        const entriesB = entries.filter((entry) => entry.team_side === 'B');
                        const events = eventsByMatch.get(match.id) || [];
                        const result = resultsByMatch.get(match.id);
                        return (
                          <details className="registered-match-card" key={match.id}>
                            <summary className="registered-match-head">
                              <div className="registered-match-title">
                                [{match.mode === 'tournament' ? 'T' : 'P'}] Partida {match.match_no || '-'} | {match.team_a_name} vs {match.team_b_name}
                              </div>
                              <div className="registered-match-meta">
                                <span>Status: {match.status || '-'}</span>
                                <span>Placar: {result ? `${result.score_a} x ${result.score_b}` : '-'}</span>
                                <button
                                  type="button"
                                  className="btn-outline btn-small"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    removeMatch(match.id);
                                  }}
                                >
                                  Excluir partida
                                </button>
                              </div>
                            </summary>

                            <div className="registered-section">
                              <div className="registered-subtitle">Time A ({match.team_a_name})</div>
                              {!entriesA.length ? <div className="muted">Sem jogadores.</div> : (
                                <div className="registered-list">
                                  {entriesA.map((entry) => (
                                    <div className="registered-row" key={entry.id}>
                                      <span>{entry.player_name}</span>
                                      <span>{formatTimeBR(entry.created_at)}</span>
                                      <button className="btn-outline btn-small" onClick={() => removeEntry(entry.id)}>Excluir</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="registered-section">
                              <div className="registered-subtitle">Time B ({match.team_b_name})</div>
                              {!entriesB.length ? <div className="muted">Sem jogadores.</div> : (
                                <div className="registered-list">
                                  {entriesB.map((entry) => (
                                    <div className="registered-row" key={entry.id}>
                                      <span>{entry.player_name}</span>
                                      <span>{formatTimeBR(entry.created_at)}</span>
                                      <button className="btn-outline btn-small" onClick={() => removeEntry(entry.id)}>Excluir</button>
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
                                  {events.map((event) => {
                                    const isEditing = editEvent?.id === event.id;
                                    return (
                                      <div className="registered-row registered-row-edit" key={event.id}>
                                        <span>{formatTimeBR(event.created_at)} | {event.points}pt | {event.player_name} | Time {event.team_side}</span>
                                        <div className="registered-actions">
                                          <button className="btn-outline btn-small" onClick={() => removeEvent(event.id)}>Excluir</button>
                                          <button
                                            className="btn-outline btn-small"
                                            onClick={() => setEditEvent(isEditing ? null : { id: event.id, player_name: event.player_name, points: event.points })}
                                          >
                                            Alterar
                                          </button>
                                        </div>
                                        {isEditing ? (
                                          <div className="registered-edit-box">
                                            <select value={editEvent.player_name} onChange={(e) => setEditEvent((prev) => ({ ...prev, player_name: e.target.value }))}>
                                              {dayPlayerOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                                            </select>
                                            <select value={editEvent.points} onChange={(e) => setEditEvent((prev) => ({ ...prev, points: Number(e.target.value) }))}>
                                              <option value={1}>1 ponto</option>
                                              <option value={2}>2 pontos</option>
                                              <option value={3}>3 pontos</option>
                                            </select>
                                            <button className="btn-controle btn-small" onClick={() => saveEditedEvent(match, event)}>Salvar</button>
                                            <button className="btn-outline btn-small" onClick={() => setEditEvent(null)}>Cancelar</button>
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  )}
                </div>
              </details>

              <details className="registered-match-card">
                <summary className="registered-match-head">
                  <div className="registered-match-title">Cestas ({dayStats.length} jogadores)</div>
                </summary>
                <div className="registered-section">
                  {!dayStats.length ? (
                    <div className="muted">Nenhuma cesta registrada.</div>
                  ) : (
                    <div className="registered-list">
                      {dayStats.map((row, index) => (
                        <div className="registered-row" key={`${row.name}-${index}`}>
                          <span>{index + 1}. {row.name}</span>
                          <span>{row.total} pts | {row.one}x1 | {row.two}x2 | {row.three}x3</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </div>
          </details>
        );
      })}
    </div>
  );
}
