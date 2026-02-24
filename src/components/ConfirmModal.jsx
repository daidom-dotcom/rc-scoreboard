import { useEffect, useState } from 'react';
import { useGame } from '../contexts/GameContext';

export default function ConfirmModal() {
  const { confirmState, resolveConfirm } = useGame();
  if (!confirmState?.open) return null;
  const [secondsLeft, setSecondsLeft] = useState(30);

  useEffect(() => {
    setSecondsLeft(30);
    const t = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(t);
          resolveConfirm(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [confirmState?.open]);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">Aviso</div>
        <div className="confirm-message">{confirmState.message}</div>
        <div className="confirm-countdown">Nova partida em {secondsLeft}s</div>
        <div className="actions">
          <button className="btn-outline" onClick={() => resolveConfirm(false)}>Não</button>
          <button className="btn-controle" onClick={() => resolveConfirm(true)}>Sim</button>
        </div>
      </div>
    </div>
  );
}
