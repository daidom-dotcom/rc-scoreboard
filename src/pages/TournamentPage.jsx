import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import { useGame } from '../contexts/GameContext';
import { useAuth } from '../contexts/AuthContext';
import ObserverOnlyNote from '../components/ObserverOnlyNote';
import { createMatch, createTeam, deleteMatch, deleteTeam, fetchTeams } from '../lib/api';
import { formatDateBR, formatTime } from '../utils/time';
import { createTournament, updateTournament, fetchMatchesByTournament } from '../lib/tournaments';
import { loadCurrentTournamentId, saveCurrentTournamentId, clearCurrentTournamentId } from '../utils/tournament';
import DateWheelField from '../components/DateWheelField';

export default function TournamentPage() {
  const { dateISO, settings, startTournamentMatch, showAlert, askConfirm } = useGame();
  const { isMaster } = useAuth();
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [tournamentId, setTournamentId] = useState(null);
  const [tournamentDate, setTournamentDate] = useState(dateISO);

  const [modalOpen, setModalOpen] = useState(false);
  const [teamAId, setTeamAId] = useState('');
  const [teamBId, setTeamBId] = useState('');
  const [quarters, setQuarters] = useState(4);
  const [sameDuration, setSameDuration] = useState(true);
  const [durations, setDurations] = useState([10 * 60, 10 * 60, 10 * 60, 10 * 60]);
  const navigate = useNavigate();

  useEffect(() => {
    setTournamentDate(dateISO);
    initTournament(dateISO);
  }, [dateISO]);

  useEffect(() => {
    setDurations((prev) => {
      const base = prev[0] || 10 * 60;
      if (prev.length >= quarters) return prev.slice(0, quarters);
      return [...prev, ...Array.from({ length: quarters - prev.length }, () => base)];
    });
  }, [quarters]);

  async function initTournament(startDate) {
    setLoading(true);
    try {
      let currentId = loadCurrentTournamentId();
      if (!currentId) {
        const t = await createTournament({
          start_date: startDate,
          status: 'active'
        });
        currentId = t.id;
        saveCurrentTournamentId(currentId);
      }
      setTournamentId(currentId);
      await loadAll(currentId);
    } catch (err) {
      showAlert(err.message || 'Erro ao carregar torneio');
    } finally {
      setLoading(false);
    }
  }

  async function loadAll(currentId = tournamentId) {
    setLoading(true);
    try {
      const [t, m] = await Promise.all([
        fetchTeams(),
        currentId ? fetchMatchesByTournament(currentId) : []
      ]);
      setTeams(t);
      setMatches(m);
    } catch (err) {
      showAlert(err.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddTeam() {
    const name = teamName.trim();
    if (!name) return;
    try {
      await createTeam(name);
      setTeamName('');
      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao criar time');
    }
  }

  async function handleDeleteTeam(id) {
    try {
      await deleteTeam(id);
      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao excluir time');
    }
  }

  function openModal() {
    if (teams.length < 2) {
      showAlert('Cadastre pelo menos 2 times.');
      return;
    }
    setTeamAId(teams[0]?.id || '');
    setTeamBId(teams[1]?.id || '');
    setQuarters(4);
    setSameDuration(true);
    setDurations(Array(4).fill(10 * 60));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function setDurationAt(index, seconds) {
    setDurations((prev) => {
      const next = [...prev];
      next[index] = seconds;
      return next;
    });
  }

  function readDuration(min, sec) {
    const m = Math.max(0, Math.min(99, Number(min || 0)));
    const s = Math.max(0, Math.min(59, Number(sec || 0)));
    return m * 60 + s;
  }

  async function handleCreateMatch() {
    if (!teamAId || !teamBId) return;
    if (teamAId === teamBId) {
      showAlert('Time A e Time B não podem ser iguais.');
      return;
    }

    const teamA = teams.find((t) => t.id === teamAId);
    const teamB = teams.find((t) => t.id === teamBId);

    const finalDurations = sameDuration
      ? Array(quarters).fill(durations[0] || settings.quickDurationSeconds)
      : durations.slice(0, quarters);

    if (finalDurations.some((d) => d <= 0)) {
      showAlert('Duração inválida.');
      return;
    }

    try {
      await createMatch({
        date_iso: tournamentDate || dateISO || new Date().toISOString().slice(0, 10),
        mode: 'tournament',
        tournament_id: tournamentId,
        team_a_id: teamA.id,
        team_b_id: teamB.id,
        team_a_name: teamA.name,
        team_b_name: teamB.name,
        quarters,
        durations: finalDurations,
        status: 'pending'
      });
      closeModal();
      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao criar partida');
    }
  }

  async function handleDeleteMatch(id) {
    try {
      await deleteMatch(id);
      await loadAll();
    } catch (err) {
      showAlert(err.message || 'Erro ao excluir partida');
    }
  }

  function handlePlay(match) {
    startTournamentMatch(match);
    navigate('/game');
  }

  const doneMatches = useMemo(() => matches.filter((m) => m.status === 'done'), [matches]);

  return (
    <div className="container">
      <div className="header-row">
        <h1 className="hTitle">Modo Torneio</h1>
      </div>

      {loading ? <div className="panel">Carregando...</div> : null}
      {!isMaster ? <ObserverOnlyNote /> : null}

      {isMaster ? (
        <div className="panel">
        <div className="label">Cadastrar Times</div>
        <div className="row row-inline">
          <div className="col">
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Nome do time (ex: Sem Colete)"
            />
          </div>
          <div>
            <button className="btn-outline btn-small" onClick={handleAddTeam}>+</button>
          </div>
        </div>
        <div className="team-pills">
          {teams.map((t) => (
            <div key={t.id} className="pill">
              <span>{t.name}</span>
              <button onClick={() => handleDeleteTeam(t.id)} title="Excluir">×</button>
            </div>
          ))}
        </div>
      </div>
      ) : null}

      <div className="panel">
        <div className="label">Data do Torneio</div>
        <DateWheelField value={tournamentDate} onChange={setTournamentDate} displayValue={formatDateBR(tournamentDate)} />
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="label" style={{ margin: 0 }}>Partidas Criadas</div>
          {isMaster ? (
            <button className="btn-controle" onClick={openModal}>Criar nova partida</button>
          ) : null}
        </div>

        <div className="matches-list">
          {!matches.length ? (
            <div className="muted">Nenhuma partida criada ainda.</div>
          ) : (
            matches.map((m) => (
              <div key={m.id} className="match-item">
                <div className="match-meta">
                  <div className="match-title">{m.team_a_name} vs {m.team_b_name}</div>
                  <div className="match-sub">
                    {m.quarters}Q · {m.durations.map((d) => formatTime(d)).join(' / ')} {m.status === 'done' ? '· (finalizada)' : ''}
                  </div>
                </div>
                <div className="match-btns">
                  <button className="btn-controle" disabled={!isMaster || m.status === 'done'} onClick={() => handlePlay(m)}>PLAY</button>
                  {isMaster ? (
                    <button className="btn-outline" onClick={() => handleDeleteMatch(m.id)}>Excluir</button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        {isMaster && doneMatches.length ? (
          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <button
              className="btn-controle"
              onClick={async () => {
                if (!tournamentId) return;
                await updateTournament(tournamentId, { status: 'done', end_date: tournamentDate || dateISO });
                clearCurrentTournamentId();
                navigate(`/history?tournament=${tournamentId}`);
              }}
            >
              Finalizar Torneio
            </button>
          </div>
        ) : null}
      </div>

      <Modal open={modalOpen} onClose={closeModal} title="Criar nova partida">
        <div className="row">
          <div className="col-40">
            <div className="label">Time A</div>
            <select value={teamAId} onChange={(e) => setTeamAId(e.target.value)}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="col-40">
            <div className="label">Time B</div>
            <select value={teamBId} onChange={(e) => setTeamBId(e.target.value)}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="col-30">
            <div className="label">Quarters</div>
            <select value={quarters} onChange={(e) => setQuarters(Number(e.target.value))}>
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q} quarter</option>)}
            </select>
          </div>
        </div>

        <div className="switch-row">
          <div className="switch-text">Mesma duração para todos os quarters</div>
          <button className={`toggle ${sameDuration ? 'on' : ''}`} onClick={() => setSameDuration((v) => !v)} type="button">
            <span className="toggle-knob" />
          </button>
        </div>

        {sameDuration ? (
          <div>
            <div className="label">Duração (mm:ss) — por quarter</div>
            <div className="dur-row">
              <input
                type="number"
                min="0"
                max="99"
                value={Math.floor((durations[0] || 0) / 60)}
                onChange={(e) => setDurationAt(0, readDuration(e.target.value, durations[0] % 60))}
              />
              <div className="colon">:</div>
              <input
                type="number"
                min="0"
                max="59"
                value={durations[0] % 60}
                onChange={(e) => setDurationAt(0, readDuration(Math.floor((durations[0] || 0) / 60), e.target.value))}
              />
            </div>
          </div>
        ) : (
          <div>
            <div className="label">Duração por quarter (mm:ss)</div>
            <div className="qdur-list">
              {Array.from({ length: quarters }).map((_, i) => (
                <div key={`q-${i}`} className="qdur-row">
                  <div className="qtag">Quarter {i + 1}</div>
                  <div className="qinputs">
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={Math.floor((durations[i] || 0) / 60)}
                      onChange={(e) => setDurationAt(i, readDuration(e.target.value, durations[i] % 60))}
                    />
                    <div className="colon">:</div>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={durations[i] % 60}
                      onChange={(e) => setDurationAt(i, readDuration(Math.floor((durations[i] || 0) / 60), e.target.value))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="actions">
          <button className="btn-outline" onClick={closeModal}>Cancelar</button>
          <button className="btn-controle" onClick={handleCreateMatch}>Criar partida</button>
        </div>
      </Modal>
    </div>
  );
}
