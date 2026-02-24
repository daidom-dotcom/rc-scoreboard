import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import SummaryTable from '../components/SummaryTable';
import { fetchMatchesByDate, fetchMatchesByRange, fetchTeams } from '../lib/api';
import { formatDateBR, todayISO } from '../utils/time';
import { useGame } from '../contexts/GameContext';
import { supabase } from '../lib/supabase';
import DateWheelField from '../components/DateWheelField';
import SelectField from '../components/SelectField';
import { useAuth } from '../contexts/AuthContext';

function toCsv(rows) {
  const headers = ['data', 'modo', 'time_a', 'time_b', 'score_a', 'score_b', 'cestas1', 'cestas2', 'cestas3'];
  const lines = [headers.join(',')];
  rows.forEach((r) => {
    const match = r;
    const res = r.match_results?.[0];
    lines.push([
      match.date_iso,
      match.mode,
      match.team_a_name,
      match.team_b_name,
      res?.score_a ?? 0,
      res?.score_b ?? 0,
      res?.baskets1 ?? 0,
      res?.baskets2 ?? 0,
      res?.baskets3 ?? 0
    ].join(','));
  });
  return lines.join('\n');
}

function normalizeDate(input) {
  if (!input) return input;
  const raw = String(input).trim();
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // dd-mm-yyyy or dd/mm/yyyy
  const m = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (m) {
    const [, d, mm, y] = m;
    return `${y}-${mm}-${d}`;
  }
  return raw;
}

export default function HistoryPage() {
  const { dateISO: gameDateISO, showAlert, askConfirm } = useGame();
  const [dateISO, setDateISO] = useState(gameDateISO || todayISO());
  const [dateTo, setDateTo] = useState(gameDateISO || todayISO());
  const [mode, setMode] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [teams, setTeams] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showMine, setShowMine] = useState(false);
  const [userEntriesMap, setUserEntriesMap] = useState(new Map());
  const { isMaster, user, profile } = useAuth();

  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const showSummary = true;
  const tournamentId = params.get('tournament');
  const scopeParam = params.get('scope');
  const dateParam = params.get('date');
  const dateToParam = params.get('dateTo');

  useEffect(() => {
    loadTeams();
    if (tournamentId) {
      loadTournament(tournamentId);
    } else {
      loadDay();
    }
  }, []);

  useEffect(() => {
    if (dateParam) setDateISO(dateParam);
    if (dateToParam) setDateTo(dateToParam);
    if (scopeParam === 'mine') setShowMine(true);
  }, [dateParam, dateToParam, scopeParam]);

  useEffect(() => {
    if (!user) {
      setShowMine(false);
      setUserEntriesMap(new Map());
    }
  }, [user]);

  useEffect(() => {
    if (!gameDateISO) return;
    if (tournamentId) return;
    setDateISO(gameDateISO);
    setDateTo(gameDateISO);
    loadDay(gameDateISO);
  }, [gameDateISO]);

  async function loadTournament(id) {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('matches')
        .select('*, match_results(*)')
        .eq('tournament_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []).map((m) => ({
        ...m,
        match_results: m.match_results && !Array.isArray(m.match_results) ? [m.match_results] : (m.match_results || [])
      }));
      setRows(rows);
    } catch (err) {
      showAlert(err.message || 'Erro ao carregar torneio');
    } finally {
      setLoading(false);
    }
  }

  async function loadTeams() {
    try {
      const t = await fetchTeams();
      setTeams(t);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadDay(targetDate = dateISO) {
    setLoading(true);
    try {
      const data = await fetchMatchesByDate(normalizeDate(targetDate));
      setRows(data);
      await ensureResultsLoaded(data);
      if (showMine && user?.id) {
        await loadUserMatchIds(normalizeDate(targetDate), normalizeDate(targetDate));
      }
    } catch (err) {
      showAlert(err.message || 'Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  }

  async function applyFilters() {
    setLoading(true);
    try {
      const data = await fetchMatchesByRange({
        dateFrom: normalizeDate(dateISO),
        dateTo: normalizeDate(dateTo),
        mode,
        team: teamFilter
      });
      setRows(data);
      await ensureResultsLoaded(data);
      if (showMine && user?.id) {
        await loadUserMatchIds(normalizeDate(dateISO), normalizeDate(dateTo));
      }
    } catch (err) {
      showAlert(err.message || 'Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  }

  async function handleScopeChange(scope) {
    const mine = scope === 'mine';
    setShowMine(mine);
    if (mine && user?.id) {
      await loadUserMatchIds(normalizeDate(dateISO), normalizeDate(dateTo));
    } else {
      setUserEntriesMap(new Map());
    }
  }

  async function loadUserMatchIds(dateFrom, dateEnd) {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('player_entries')
      .select('match_id,team_side,date_iso')
      .eq('user_id', user.id)
      .gte('date_iso', dateFrom)
      .lte('date_iso', dateEnd);
    if (error) return;
    const map = new Map();
    (data || []).forEach((r) => {
      if (r.match_id) map.set(r.match_id, r.team_side);
    });
    setUserEntriesMap(map);
  }

  async function ensureResultsLoaded(data) {
    const missing = (data || []).filter((m) => !m.match_results || m.match_results.length === 0).map((m) => m.id);
    if (!missing.length) return;
    const { data: results, error } = await supabase
      .from('match_results')
      .select('*')
      .in('match_id', missing);
    if (error) {
      showAlert(`Erro ao carregar resultados: ${error.message}`);
      return;
    }
    const map = new Map((results || []).map((r) => [r.match_id, r]));
    setRows((prev) => prev.map((m) => ({
      ...m,
      match_results: m.match_results?.length ? m.match_results : (map.get(m.id) ? [map.get(m.id)] : [])
    })));
  }

  function handleExport() {
    const csv = toCsv(filteredRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `historico-${dateISO}.csv`;
    link.click();
  }

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const aTime = a.match_results?.[0]?.finished_at || a.created_at;
      const bTime = b.match_results?.[0]?.finished_at || b.created_at;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });
    return list;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!showMine || !user?.id) return sortedRows;
    return sortedRows.filter((m) => userEntriesMap.has(m.id));
  }, [sortedRows, showMine, user?.id, userEntriesMap]);

  const doneMatches = useMemo(() => filteredRows
    .filter((m) => m.status === 'done' && m.match_results?.length)
    .map((m) => ({
      mode: m.mode,
      team_a_name: m.team_a_name,
      team_b_name: m.team_b_name,
      score_a: m.match_results[0].score_a,
      score_b: m.match_results[0].score_b,
      baskets1: m.match_results[0].baskets1,
      baskets2: m.match_results[0].baskets2,
      baskets3: m.match_results[0].baskets3
    })), [filteredRows]);

  const userStats = useMemo(() => {
    if (!showMine || !user?.id) return null;
    let wins = 0;
    let total = 0;
    filteredRows.forEach((m) => {
      const res = m.match_results?.[0];
      if (!res) return;
      const side = userEntriesMap.get(m.id);
      const winner = res.score_a > res.score_b ? 'A' : (res.score_b > res.score_a ? 'B' : 'draw');
      total += 1;
      if (winner !== 'draw' && side === winner) wins += 1;
    });
    const pct = total ? Math.round((wins / total) * 100) : 0;
    return { wins, total, pct };
  }, [filteredRows, showMine, user?.id, userEntriesMap]);

  const teamOptions = useMemo(() => {
    const names = new Set();
    teams.forEach((t) => names.add(t.name));
    sortedRows.forEach((m) => {
      if (m.team_a_name) names.add(m.team_a_name);
      if (m.team_b_name) names.add(m.team_b_name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [teams, sortedRows]);

  return (
    <div className="container">
      <div className="history-header">
        <h1 className="hTitle">Histórico</h1>
        {user ? (
          <div className="history-toggle">
            <div className="switch-text">{showMine ? 'Somente meus resultados' : 'Todos os resultados'}</div>
            <button
              className={`toggle ${showMine ? 'on' : ''}`}
              onClick={() => handleScopeChange(showMine ? 'all' : 'mine')}
              type="button"
            >
              <span className="toggle-knob" />
            </button>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="row">
          <div className="col">
            <div className="label">Data início</div>
            <DateWheelField value={dateISO} onChange={setDateISO} displayValue={formatDateBR(dateISO)} />
          </div>
          <div className="col">
            <div className="label">Data fim</div>
            <DateWheelField value={dateTo} onChange={setDateTo} displayValue={formatDateBR(dateTo)} />
          </div>
          <div className="col">
            <div className="label">Tipo</div>
            <SelectField value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="all">Todos</option>
              <option value="quick">Quick</option>
              <option value="tournament">Torneio</option>
            </SelectField>
          </div>
          <div className="col">
            <div className="label">Time</div>
            <SelectField value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="all">Todos</option>
              {teamOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </SelectField>
          </div>
        </div>
        <div className="actions actions-left history-actions">
          <button className="btn-controle" onClick={applyFilters}>Filtrar</button>
          <button className="btn-controle" onClick={handleExport}>Exportar CSV</button>
        </div>
      </div>

      {showSummary ? (
        <SummaryTable
          title={
            showMine
              ? `Aproveitamento de ${profile?.full_name || user?.email} em ${formatDateBR(dateISO)}`
              : `Resumo de ${formatDateBR(dateISO)}`
          }
          subtitle={
            showMine
              ? `Você participou de ${userStats?.wins || 0} (${userStats?.pct || 0}%) dos times vencedores.\nRachão dos Crias`
              : 'Rachão dos Crias'
          }
          dateISO={dateISO}
          partidas={doneMatches}
        />
      ) : null}

      {!showSummary ? (
        <div className="panel">
          <div className="label">Partidas ({filteredRows.length})</div>
          {loading ? (
            <div>Carregando...</div>
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                <th>Tipo/#</th>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Time 1</th>
                  <th>vs</th>
                  <th>Time 2</th>
                <th className="col-cestas">C1</th>
                <th className="col-cestas">C2</th>
                <th className="col-cestas">C3</th>
                {isMaster ? <th>Ações</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((m, idx) => {
                  const res = m.match_results?.[0];
                  const leftScore = res ? res.score_a : '-';
                  const rightScore = res ? res.score_b : '-';
                  const leftWinner = res && Number(res.score_a) > Number(res.score_b);
                  const rightWinner = res && Number(res.score_b) > Number(res.score_a);
                  return (
                  <tr key={m.id}>
                    <td>
                      {(m.mode || 'NA').toUpperCase()} {idx + 1}
                    </td>
                      <td>{formatDateBR(m.date_iso)}</td>
                      <td>{m.mode}</td>
                      <td>
                        <div className={`placar-side ${leftWinner ? 'winner' : ''}`}>
                          <span className="placar-team">{m.team_a_name}</span>
                          <span className="score-box">[{leftScore}]</span>
                        </div>
                      </td>
                      <td className="placar-vs">vs</td>
                      <td>
                        <div className={`placar-side right ${rightWinner ? 'winner' : ''}`}>
                          <span className="score-box">[{rightScore}]</span>
                          <span className="placar-team">{m.team_b_name}</span>
                        </div>
                      </td>
                    <td className="col-cestas">{res ? res.baskets1 : '-'}</td>
                    <td className="col-cestas">{res ? res.baskets2 : '-'}</td>
                    <td className="col-cestas">{res ? res.baskets3 : '-'}</td>
                    {isMaster ? (
                      <td>
                        <button
                          className="btn-outline btn-small"
                          onClick={async () => {
                            const ok = await askConfirm('Excluir esta partida?');
                            if (!ok) return;
                            await supabase.from('matches').delete().eq('id', m.id);
                            loadDay(dateISO);
                          }}
                        >
                          Excluir
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}
