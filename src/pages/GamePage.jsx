import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { supabase } from '../lib/supabase';
import { todayISO } from '../utils/time';

export default function GamePage() {
  const { user, isMaster } = useAuth();
  const {
    mode,
    quarterIndex,
    totalSeconds,
    running,
    ajusteFinalAtivo,
    teamAName,
    teamBName,
    scoreA,
    scoreB,
    matchId,
    quickMatchNumber,
    settings,
    formatTime,
    startQuick,
    askConfirm,
    play,
    pause,
    addPoint,
    finishQuick,
    finishTournamentMatch,
    saveCurrentIfNeeded,
    endLiveGame,
    dateISO,
    clearGameState
  } = useGame();

  const navigate = useNavigate();
  const label = mode === 'quick' ? `Partida ${quickMatchNumber}` : `Quarter ${quarterIndex + 1}`;
  const timerAlert = running && totalSeconds <= settings.alertSeconds && totalSeconds > 0;

  const canEdit = !!user && isMaster;
  const controlsDisabled = !canEdit;
  const [teamEntries, setTeamEntries] = useState({ A: [], B: [] });

  useEffect(() => {
    if (mode === 'quick' && teamAName === 'TIME 1' && teamBName === 'TIME 2') {
      startQuick();
    }
  }, [mode, teamAName, teamBName, startQuick]);

  useEffect(() => {
    let active = true;
    async function loadEntries() {
      const date = dateISO || todayISO();
      let query = supabase.from('player_entries').select('player_name, team_side');

      if (matchId) {
        query = query.eq('match_id', matchId);
      } else if (mode === 'quick' && quickMatchNumber) {
        query = supabase
          .from('player_entries')
          .select('player_name, team_side, matches!inner(match_no,date_iso,mode)')
          .eq('matches.match_no', quickMatchNumber)
          .eq('matches.date_iso', date)
          .eq('matches.mode', 'quick');
      } else {
        if (active) setTeamEntries({ A: [], B: [] });
        return;
      }

      const { data, error } = await query;
      if (error) return;
      const a = [];
      const b = [];
      (data || []).forEach((e) => {
        const first = String(e.player_name || '').trim().split(' ')[0] || e.player_name;
        if (e.team_side === 'A') a.push(first);
        if (e.team_side === 'B') b.push(first);
      });
      if (active) setTeamEntries({ A: a, B: b });
    }
    loadEntries();
    const t = setInterval(loadEntries, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [matchId, mode, quickMatchNumber, dateISO]);

  async function handleEndMatch() {
    pause();
    if (mode === 'tournament') {
      const ok = await askConfirm('Deseja encerrar a partida inteira agora?');
      if (!ok) return;
      await finishTournamentMatch(true);
      navigate('/tournament');
    } else {
      const ok = await askConfirm('Deseja encerrar a partida?');
      if (!ok) return;
      await finishQuick();
    }
  }

  async function handleSecondAction() {
    if (mode === 'tournament') {
      navigate('/tournament');
      return;
    }
    const ok = await askConfirm('Deseja encerrar o dia e ver o resumo?');
    if (!ok) return;

    if (scoreA !== 0 || scoreB !== 0) {
      const salvar = await askConfirm('Partida atual não encerrada. Deseja salvar antes de ver o resumo?');
      if (salvar) {
        await saveCurrentIfNeeded();
      }
    }

    pause();
    clearGameState();
    endLiveGame();
    navigate(`/history?summary=1&date=${dateISO}&dateTo=${dateISO}`);
  }


  const enablePoints = running || ajusteFinalAtivo;

  return (
    <div className="game">
      <div className="center" style={{ position: 'relative' }}>
        <div className="topBar">
          <div id="partidaLabel">{label}</div>
          <div id="timer" className={timerAlert ? 'timer-alert' : ''}>{formatTime(totalSeconds)}</div>
          <div id="controlesJogos">
            <button className="btn-controle" onClick={play} disabled={!canEdit || running || (totalSeconds === 0 && ajusteFinalAtivo)}>PLAY</button>
            <button className="btn-controle" onClick={pause} disabled={!canEdit || !running}>STOP</button>
          </div>
        </div>
      </div>

      <div className="placar">
        <div className="frame">
          <div className="nome">{teamAName}</div>
          <div className="team-checkins">
            {(teamEntries.A || []).map((n) => <span key={`ga-${n}`}>{n}</span>)}
          </div>
          <div className="botoes-esquerda">
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', 1)}>+1</button>
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', 2)}>+2</button>
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', 3)}>+3</button>
              <button className="btn-ponto minus" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('A', -1)}>-1</button>
          </div>
          <div className="pontos">{scoreA}</div>
        </div>

        <div className="frame">
          <div className="nome">{teamBName}</div>
          <div className="team-checkins right">
            {(teamEntries.B || []).map((n) => <span key={`gb-${n}`}>{n}</span>)}
          </div>
          <div className="pontos">{scoreB}</div>
          <div className="botoes-direita">
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', 1)}>+1</button>
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', 2)}>+2</button>
            <button className="btn-ponto" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', 3)}>+3</button>
            <button className="btn-ponto minus" disabled={controlsDisabled || !enablePoints} onClick={() => addPoint('B', -1)}>-1</button>
          </div>
        </div>
      </div>

      <div className="encerrarRow">
        <button className="btn-controle" onClick={handleEndMatch} disabled={!canEdit}>ENCERRAR PARTIDA</button>
        <button className="btn-controle" onClick={handleSecondAction}>
          {mode === 'tournament' ? 'VER TORNEIO' : 'ENCERRAR DIA'}
        </button>
      </div>
    </div>
  );
}
