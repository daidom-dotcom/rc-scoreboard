import { useEffect, useState } from 'react';
import { useGame } from '../contexts/GameContext';

export default function OvertimeModal() {
  const { overtimeState, resolveOvertime } = useGame();
  const [minutes, setMinutes] = useState(10);

  useEffect(() => {
    if (overtimeState?.open) {
      setMinutes(Number(overtimeState.minutes || 10));
    }
  }, [overtimeState]);

  if (!overtimeState?.open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">Prorrogação</div>
        <div className="confirm-message">Deseja jogar a prorrogação?</div>
        <input
          type="number"
          className="modal-input"
          min="1"
          max="99"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          autoFocus
        />
        <div className="confirm-message">Tempo em minutos</div>
        <div className="actions">
          <button className="btn-outline" onClick={() => resolveOvertime(null)}>Fim de Jogo</button>
          <button className="btn-controle" onClick={() => resolveOvertime(Math.max(1, Number(minutes || 10)))}>Prorrogação</button>
        </div>
      </div>
    </div>
  );
}
