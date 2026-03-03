import { useMemo } from 'react';

function getSundays(year) {
  const start = new Date(year, 3, 1); // 01/abr
  const end = new Date(year, 11, 31); // 31/dez
  const days = [];

  const cursor = new Date(start);
  const offset = (7 - cursor.getDay()) % 7;
  cursor.setDate(cursor.getDate() + offset);

  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  return days;
}

function buildSpiralBoard(values) {
  const size = Math.ceil(Math.sqrt(values.length));
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  let top = 0;
  let left = 0;
  let right = size - 1;
  let bottom = size - 1;
  let i = 0;

  while (top <= bottom && left <= right && i < values.length) {
    for (let col = left; col <= right && i < values.length; col += 1) {
      grid[top][col] = values[i++];
    }
    top += 1;

    for (let row = top; row <= bottom && i < values.length; row += 1) {
      grid[row][right] = values[i++];
    }
    right -= 1;

    for (let col = right; col >= left && i < values.length; col -= 1) {
      grid[bottom][col] = values[i++];
    }
    bottom -= 1;

    for (let row = bottom; row >= top && i < values.length; row -= 1) {
      grid[row][left] = values[i++];
    }
    left += 1;
  }

  return { size, grid };
}

function fmt(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

export default function BoardPage() {
  const year = new Date().getFullYear();
  const sundays = useMemo(() => getSundays(year), [year]);
  const board = useMemo(() => buildSpiralBoard(sundays), [sundays]);

  return (
    <div className="container">
      <h1 className="hTitle">Tabuleiro</h1>
      <div className="panel board-panel">
        <div className="board-subtitle">
          Domingos de 01/04 a 31/12 ({year}) - {sundays.length} casas
        </div>
        <div className="court-wrap">
          <div className="court-line midline" />
          <div className="court-circle" />
          <div className="paint left" />
          <div className="paint right" />
          <div
            className="real-board"
            style={{ gridTemplateColumns: `repeat(${board.size}, 1fr)` }}
          >
            {board.grid.reduce((acc, row) => acc.concat(row), []).map((cell, idx) => (
              <div key={idx} className={`board-cell ${cell ? 'active' : 'empty'}`}>
                {cell ? (
                  <>
                    <div className="board-cell-title">Domingo</div>
                    <div className="board-cell-date">{fmt(cell)}</div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
