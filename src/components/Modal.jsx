export default function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <button className="modal-close" onClick={onClose} aria-label="Fechar">×</button>
        {title ? <h2 className="modal-title">{title}</h2> : null}
        {children}
      </div>
    </div>
  );
}
