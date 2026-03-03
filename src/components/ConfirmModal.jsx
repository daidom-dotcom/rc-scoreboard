import { useGame } from '../contexts/GameContext';

export default function ConfirmModal() {
  const { confirmState, resolveConfirm } = useGame();
  if (!confirmState?.open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">Aviso</div>
        <div className="confirm-message">{confirmState.message}</div>
        <div className="actions">
          <button className="btn-outline" onClick={() => resolveConfirm(false)}>Não</button>
          <button className="btn-controle" onClick={() => resolveConfirm(true)}>Sim</button>
        </div>
      </div>
    </div>
  );
}
