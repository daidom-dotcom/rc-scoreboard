import { useEffect, useState } from 'react';

export default function PasswordModal({ open, title, message, onClose, onConfirm }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">{title}</div>
        {message ? <div className="confirm-message">{message}</div> : null}
        <input
          type="password"
          className="modal-input"
          placeholder="Senha"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <div className="actions">
          <button className="btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn-controle" onClick={() => onConfirm(value)}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}
