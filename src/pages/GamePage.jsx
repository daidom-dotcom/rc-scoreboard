import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';

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
    saveCurrentIfNeeded
  } = useGame();

  const navigate = useNavigate();
  const label = mode === 'quick' ? `Partida ${quickMatchNumber}` : `Quarter ${quarterIndex + 1}`;
  const timerAlert = running && totalSeconds <= settings.alertSeconds && totalSeconds > 0;

  const canEdit = !!user && isMaster;
  const controlsDisabled = !canEdit;

  useEffect(() => {
    if (mode === 'quick' && teamAName === 'TIME 1' && teamBName === 'TIME 2') {
      startQuick();
    }
  }, [mode, teamAName, teamBName, startQuick]);

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

    navigate('/history?summary=1');
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
