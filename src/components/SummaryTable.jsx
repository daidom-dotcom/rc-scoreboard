import { formatDateBR } from '../utils/time';

function pct(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function cellCestas(count, total) {
  const p = pct(count, total);
  return (
    <div className="cell-cestas">
      <div>{count}</div>
      <div className="cell-pct">({p}%)</div>
    </div>
  );
}

function nameWithTrophy(name, winner) {
  return (
    <div className="time-left">
      <span className="time-nome">{name}</span>
      {winner ? <span className="trofeu">🏆</span> : null}
    </div>
  );
}

export default function SummaryTable({ title, subtitle, dateISO, partidas }) {
  return (
    <div className="summary">
      {title ? <h2>{title}</h2> : <h2>Resumo de <b>{formatDateBR(dateISO)}</b></h2>}
      {subtitle ? (
        <div className="subtitulo-block">
          {subtitle.split('\n').map((line, idx) => (
            <div className="subtitulo" key={`${line}-${idx}`}>{line}</div>
          ))}
        </div>
      ) : (
        <p className="subtitulo">Rachão dos Crias</p>
      )}

      {!partidas?.length ? (
        <div className="panel">Nenhuma partida finalizada neste dia.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="col-partida">Tipo/#</th>
              <th className="col-jogos">Jogos</th>
              <th className="col-cestas">1pt</th>
              <th className="col-cestas">2pt</th>
              <th className="col-cestas">3pt</th>
              <th className="col-cestas">Tot</th>
            </tr>
          </thead>
          <tbody>
            {partidas.map((p, i) => {
              const typeMark = p.mode === 'tournament' ? 'T' : 'Q';
              const n1 = p.team_a_name || p.time1_nome || 'Time 1';
              const n2 = p.team_b_name || p.time2_nome || 'Time 2';
              const s1 = Number(p.score_a ?? p.time1_placar ?? 0);
              const s2 = Number(p.score_b ?? p.time2_placar ?? 0);
              const t1Venceu = s1 > s2;
              const t2Venceu = s2 > s1;
              const c1 = Number(p.baskets1 ?? p.cestas1 ?? 0);
              const c2 = Number(p.baskets2 ?? p.cestas2 ?? 0);
              const c3 = Number(p.baskets3 ?? p.cestas3 ?? 0);
              const total = c1 + c2 + c3;

              return (
                <tr key={`${n1}-${n2}-${i}`}>
                  <td className="col-partida">[{typeMark}] {i + 1}</td>
                  <td className="col-jogos">
                    <div className="jogos-card">
                      <div className="time-row">
                        {nameWithTrophy(n1, t1Venceu)}
                        <div className="time-pontos">{s1}</div>
                      </div>
                      <div className="time-row">
                        {nameWithTrophy(n2, t2Venceu)}
                        <div className="time-pontos">{s2}</div>
                      </div>
                    </div>
                  </td>
                  <td className="col-cestas">{cellCestas(c1, total)}</td>
                  <td className="col-cestas">{cellCestas(c2, total)}</td>
                  <td className="col-cestas">{cellCestas(c3, total)}</td>
                  <td className="col-cestas">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
