import { useMemo, useState } from 'react';
import Modal from './Modal';
import { todayISO } from '../utils/time';

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export default function DateWheel({ value, onChange, displayValue }) {
  const [open, setOpen] = useState(false);

  const [year, month, day] = useMemo(() => {
    if (!value) return [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];
    const [y, m, d] = value.split('-').map((v) => Number(v));
    return [y, m, d];
  }, [value]);

  const [tmpYear, setTmpYear] = useState(year);
  const [tmpMonth, setTmpMonth] = useState(month);
  const [tmpDay, setTmpDay] = useState(day);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => now - 1 + i);
  }, []);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const days = useMemo(() => Array.from({ length: daysInMonth(tmpYear, tmpMonth) }, (_, i) => i + 1), [tmpYear, tmpMonth]);

  function openModal() {
    setTmpYear(year);
    setTmpMonth(month);
    setTmpDay(day);
    setOpen(true);
  }

  function apply() {
    const y = String(tmpYear).padStart(4, '0');
    const m = String(tmpMonth).padStart(2, '0');
    const d = String(tmpDay).padStart(2, '0');
    onChange(`${y}-${m}-${d}`);
    setOpen(false);
  }

  function setToday() {
    const t = todayISO();
    const [y, m, d] = t.split('-').map((v) => Number(v));
    setTmpYear(y);
    setTmpMonth(m);
    setTmpDay(d);
  }

  return (
    <div className="date-wheel">
      <button className="btn-outline" type="button" onClick={openModal}>
        {displayValue || value}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Selecionar data">
        <div className="wheel-grid">
          <div className="wheel-col">
            <div className="wheel-label">Dia</div>
            <div className="wheel-list">
              {days.map((d) => (
                <button
                  key={`d-${d}`}
                  className={`wheel-item ${d === tmpDay ? 'active' : ''}`}
                  onClick={() => setTmpDay(d)}
                >
                  {String(d).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
          <div className="wheel-col">
            <div className="wheel-label">Mês</div>
            <div className="wheel-list">
              {months.map((m) => (
                <button
                  key={`m-${m}`}
                  className={`wheel-item ${m === tmpMonth ? 'active' : ''}`}
                  onClick={() => {
                    setTmpMonth(m);
                    const maxDay = daysInMonth(tmpYear, m);
                    if (tmpDay > maxDay) setTmpDay(maxDay);
                  }}
                >
                  {String(m).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
          <div className="wheel-col">
            <div className="wheel-label">Ano</div>
            <div className="wheel-list">
              {years.map((y) => (
                <button
                  key={`y-${y}`}
                  className={`wheel-item ${y === tmpYear ? 'active' : ''}`}
                  onClick={() => {
                    setTmpYear(y);
                    const maxDay = daysInMonth(y, tmpMonth);
                    if (tmpDay > maxDay) setTmpDay(maxDay);
                  }}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="btn-outline" onClick={setToday}>Hoje</button>
          <button className="btn-outline" onClick={() => setOpen(false)}>Cancelar</button>
          <button className="btn-controle" onClick={apply}>Aplicar</button>
        </div>
      </Modal>
    </div>
  );
}
