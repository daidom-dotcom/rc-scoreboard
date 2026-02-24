import { useGame } from '../contexts/GameContext';

export default function AlertModal() {
  const { alertState, closeAlert } = useGame();
  if (!alertState?.open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">Aviso</div>
        <div className="confirm-message">{alertState.message}</div>
        <div className="actions">
          <button className="btn-controle" onClick={closeAlert}>OK</button>
        </div>
      </div>
    </div>
  );
}
