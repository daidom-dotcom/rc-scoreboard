import { useMemo, useRef, useState } from 'react';
import { fetchMatchesByDate } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatDateBR, todayISOInSaoPaulo } from '../utils/time';
import { preferredDisplayName } from '../utils/names';

const DEFAULT_FRAME_SRC = '/moldura-padrao.png';
const PAPER_WHITE = 'rgba(250,250,250,0.94)';
const CARD_DARK = 'rgba(8,10,8,0.92)';
const CARD_DARK_ALT = 'rgba(15,18,15,0.96)';
const LIME = '#d6ff39';
const LIME_SOFT = '#b8e91b';
const BLACK = '#050505';

function loadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
    image.src = src;
  });
}

function drawDateStamp(ctx, width, height, formattedDate) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';
  ctx.font = `900 ${Math.round(width * 0.05)}px Georgia, serif`;
  ctx.fillText(formattedDate, width / 2, height - Math.round(height * 0.05));
  ctx.restore();
}

function drawRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();
}

function drawMultiline(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });
  if (current) lines.push(current);
  const visible = lines.slice(0, maxLines);
  visible.forEach((line, idx) => {
    ctx.fillText(line, x, y + idx * lineHeight);
  });
  return visible.length;
}

function formatMatchLabel(match) {
  if (match.mode === 'quick') return `Partida ${match.match_no || '—'}`;
  return `Torneio ${match.match_no || '—'}`;
}

function formatModeBadge(mode) {
  return mode === 'quick' ? 'RAPIDO' : 'TORNEIO';
}

function winnerInfo(match) {
  const res = Array.isArray(match.match_results) ? match.match_results[0] : match.match_results;
  const scoreA = Number(res?.score_a || 0);
  const scoreB = Number(res?.score_b || 0);
  if (scoreA === scoreB) return { winner: 'draw', scoreA, scoreB };
  return { winner: scoreA > scoreB ? 'A' : 'B', scoreA, scoreB };
}

async function fetchDayPlayersSummary(dateISO, matches) {
  const matchIds = (matches || []).map((match) => match.id).filter(Boolean);
  const { data: entryRows } = matchIds.length
    ? await supabase.from('player_entries').select('match_id,user_id,player_name').in('match_id', matchIds)
    : { data: [] };
  const { data: basketRows } = matchIds.length
    ? await supabase.from('basket_events').select('match_id,player_name,points').in('match_id', matchIds)
    : { data: [] };
  const { data: attendanceRows } = await supabase
    .from('daily_attendance')
    .select('user_id,player_name')
    .eq('date_iso', dateISO);
  const { data: visitorRows } = await supabase
    .from('daily_visitors')
    .select('player_name')
    .eq('date_iso', dateISO);

  const userIds = [...new Set([
    ...(entryRows || []).map((row) => row.user_id).filter(Boolean),
    ...(attendanceRows || []).map((row) => row.user_id).filter(Boolean),
  ])];
  const { data: profiles } = userIds.length
    ? await supabase.from('profiles').select('id,full_name,nickname,email').in('id', userIds)
    : { data: [] };
  const profileById = new Map((profiles || []).map((profile) => [profile.id, preferredDisplayName(profile)]));

  const aliases = new Map();
  (attendanceRows || []).forEach((row) => {
    const display = profileById.get(row.user_id) || preferredDisplayName(row.player_name);
    const keys = [
      String(row.player_name || '').trim().toLowerCase(),
      String(display || '').trim().toLowerCase(),
      String(display || '').trim().split(/\s+/)[0]?.toLowerCase() || '',
    ].filter(Boolean);
    keys.forEach((key) => aliases.set(key, display));
  });
  (entryRows || []).forEach((row) => {
    const display = profileById.get(row.user_id) || preferredDisplayName(row.player_name);
    const keys = [
      String(row.player_name || '').trim().toLowerCase(),
      String(display || '').trim().toLowerCase(),
      String(display || '').trim().split(/\s+/)[0]?.toLowerCase() || '',
    ].filter(Boolean);
    keys.forEach((key) => aliases.set(key, display));
  });

  const summary = new Map();
  (basketRows || []).forEach((row) => {
    const rawName = String(row.player_name || '').trim();
    const aliasKey = rawName.toLowerCase();
    const display = aliases.get(aliasKey)
      || aliases.get(rawName.split(/\s+/)[0]?.toLowerCase() || '')
      || preferredDisplayName(rawName || 'Outros');
    const current = summary.get(display) || { name: display, baskets: 0, points: 0 };
    current.baskets += 1;
    current.points += Number(row.points || 0);
    summary.set(display, current);
  });

  (visitorRows || []).forEach((row) => {
    const display = preferredDisplayName(row.player_name);
    if (!summary.has(display)) {
      summary.set(display, { name: display, baskets: 0, points: 0 });
    }
  });

  return [...summary.values()].sort((a, b) => (b.points - a.points) || (b.baskets - a.baskets) || a.name.localeCompare(b.name, 'pt-BR'));
}

function aggregateTeams(matches) {
  const totals = new Map();
  (matches || []).forEach((match) => {
    const res = Array.isArray(match.match_results) ? match.match_results[0] : match.match_results;
    const scoreA = Number(res?.score_a || 0);
    const scoreB = Number(res?.score_b || 0);
    const nameA = String(match.team_a_name || 'Time A').trim() || 'Time A';
    const nameB = String(match.team_b_name || 'Time B').trim() || 'Time B';
    totals.set(nameA, (totals.get(nameA) || 0) + scoreA);
    totals.set(nameB, (totals.get(nameB) || 0) + scoreB);
  });
  return [...totals.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
}

export default function ImageStudioPage() {
  const [frameSrc, setFrameSrc] = useState(DEFAULT_FRAME_SRC);
  const [photoSrc, setPhotoSrc] = useState('');
  const [renderedSrc, setRenderedSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeMode, setActiveMode] = useState('photo');
  const canvasRef = useRef(null);
  const frameInputRef = useRef(null);

  const effectiveDateISO = todayISOInSaoPaulo();
  const formattedDate = useMemo(() => formatDateBR(effectiveDateISO), [effectiveDateISO]);

  async function onPickPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoSrc(await loadFileAsDataUrl(file));
  }

  async function onPickFrame(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFrameSrc(await loadFileAsDataUrl(file));
  }

  async function prepareCanvas() {
    const frameImage = await loadImage(frameSrc);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = frameImage.width || 1080;
    const height = frameImage.height || 1350;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    return { frameImage, canvas, ctx, width, height };
  }

  async function renderPhotoImage() {
    if (!frameSrc || !photoSrc) return;
    setBusy(true);
    try {
      const [{ frameImage, ctx, width, height }, photoImage] = await Promise.all([prepareCanvas(), loadImage(photoSrc)]);

      const photoRatio = photoImage.width / photoImage.height;
      const canvasRatio = width / height;
      let drawWidth = width;
      let drawHeight = height;
      let dx = 0;
      let dy = 0;

      if (photoRatio > canvasRatio) {
        drawHeight = height;
        drawWidth = height * photoRatio;
        dx = (width - drawWidth) / 2;
      } else {
        drawWidth = width;
        drawHeight = width / photoRatio;
        dy = (height - drawHeight) / 2;
      }

      ctx.drawImage(photoImage, dx, dy, drawWidth, drawHeight);
      ctx.drawImage(frameImage, 0, 0, width, height);
      drawDateStamp(ctx, width, height, formattedDate);
      setRenderedSrc(canvasRef.current.toDataURL('image/png'));
    } finally {
      setBusy(false);
    }
  }

  async function renderHistoryImage() {
    if (!frameSrc) return;
    setBusy(true);
    try {
      const { frameImage, ctx, width, height } = await prepareCanvas();
      const rows = await fetchMatchesByDate(effectiveDateISO);
      const safeRows = [...(rows || [])].sort((a, b) => Number(a.match_no || 0) - Number(b.match_no || 0));

      const contentX = Math.round(width * 0.08);
      const contentY = Math.round(height * 0.15);
      const contentW = Math.round(width * 0.84);
      const contentH = Math.round(height * 0.66);
      drawRoundedRect(ctx, contentX, contentY, contentW, contentH, Math.round(width * 0.035), CARD_DARK);

      ctx.save();
      ctx.fillStyle = LIME;
      ctx.textAlign = 'left';
      ctx.font = `900 ${Math.round(width * 0.06)}px Arial`;
      ctx.fillText('Partidas', contentX + Math.round(width * 0.04), contentY + Math.round(height * 0.055));
      ctx.font = `700 ${Math.round(width * 0.036)}px Arial`;
      ctx.fillStyle = LIME_SOFT;
      ctx.fillText(formattedDate, contentX + Math.round(width * 0.04), contentY + Math.round(height * 0.09));

      const topY = contentY + Math.round(height * 0.12);
      const rowHeight = Math.max(Math.round(height * 0.064), 38);
      const maxRows = Math.max(1, Math.floor((contentH - Math.round(height * 0.15)) / rowHeight));
      const visibleRows = safeRows.slice(0, maxRows);

      visibleRows.forEach((match, idx) => {
        const { winner, scoreA, scoreB } = winnerInfo(match);
        const rowY = topY + idx * rowHeight;
        drawRoundedRect(ctx, contentX + Math.round(width * 0.03), rowY - Math.round(height * 0.028), contentW - Math.round(width * 0.06), rowHeight - Math.round(height * 0.008), 16, idx % 2 === 0 ? CARD_DARK_ALT : 'rgba(18,22,18,0.96)');

        ctx.fillStyle = LIME;
        ctx.font = `900 ${Math.round(width * 0.03)}px Arial`;
        ctx.fillText(formatMatchLabel(match), contentX + Math.round(width * 0.06), rowY);

        const badgeText = formatModeBadge(match.mode);
        const badgeX = contentX + contentW - Math.round(width * 0.3);
        const badgeY = rowY - Math.round(height * 0.024);
        const badgeW = Math.round(width * 0.18);
        const badgeH = Math.round(height * 0.03);
        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 10, 'rgba(214,255,57,0.14)');
        ctx.textAlign = 'center';
        ctx.font = `900 ${Math.round(width * 0.018)}px Arial`;
        ctx.fillStyle = LIME_SOFT;
        ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH * 0.7);

        ctx.font = `900 ${Math.round(width * 0.03)}px Arial`;
        const scoreText = `${scoreA} x ${scoreB}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(scoreText, contentX + contentW - Math.round(width * 0.08), rowY);

        ctx.textAlign = 'left';
        ctx.font = `700 ${Math.round(width * 0.024)}px Arial`;
        ctx.fillStyle = '#ebebeb';
        const teamLine = winner === 'A'
          ? `🏆 ${match.team_a_name || 'Time A'} vs ${match.team_b_name || 'Time B'}`
          : winner === 'B'
            ? `${match.team_a_name || 'Time A'} vs 🏆 ${match.team_b_name || 'Time B'}`
            : `${match.team_a_name || 'Time A'} vs ${match.team_b_name || 'Time B'} 🤝`;
        drawMultiline(
          ctx,
          teamLine,
          contentX + Math.round(width * 0.06),
          rowY + Math.round(height * 0.024),
          contentW - Math.round(width * 0.22),
          Math.round(height * 0.022),
          2
        );
      });

      if (!visibleRows.length) {
        ctx.fillStyle = '#f1f1f1';
        ctx.textAlign = 'center';
        ctx.font = `700 ${Math.round(width * 0.04)}px Arial`;
        ctx.fillText('Nenhuma partida registrada nesta data.', width / 2, contentY + contentH / 2);
      } else if (safeRows.length > visibleRows.length) {
        ctx.fillStyle = LIME_SOFT;
        ctx.textAlign = 'center';
        ctx.font = `700 ${Math.round(width * 0.028)}px Arial`;
        ctx.fillText(`+ ${safeRows.length - visibleRows.length} partida(s)`, width / 2, contentY + contentH - Math.round(height * 0.03));
      }

      ctx.restore();
      ctx.drawImage(frameImage, 0, 0, width, height);
      drawDateStamp(ctx, width, height, formattedDate);
      setRenderedSrc(canvasRef.current.toDataURL('image/png'));
    } finally {
      setBusy(false);
    }
  }

  async function renderPlayersImage() {
    if (!frameSrc) return;
    setBusy(true);
    try {
      const { frameImage, ctx, width, height } = await prepareCanvas();
      const matches = [...((await fetchMatchesByDate(effectiveDateISO)) || [])].sort((a, b) => Number(a.match_no || 0) - Number(b.match_no || 0));
      const players = await fetchDayPlayersSummary(effectiveDateISO, matches);
      const teamTotals = aggregateTeams(matches);
      const leftTeam = teamTotals[0] || { name: 'Time 1', score: 0 };
      const rightTeam = teamTotals[1] || { name: 'Time 2', score: 0 };
      const maxBaskets = Math.max(0, ...players.map((player) => player.baskets));
      const maxPoints = Math.max(0, ...players.map((player) => player.points));

      const contentX = Math.round(width * 0.08);
      const contentY = Math.round(height * 0.15);
      const contentW = Math.round(width * 0.84);
      const contentH = Math.round(height * 0.66);
      drawRoundedRect(ctx, contentX, contentY, contentW, contentH, Math.round(width * 0.035), CARD_DARK);

      ctx.save();
      ctx.fillStyle = LIME;
      ctx.textAlign = 'left';
      ctx.font = `900 ${Math.round(width * 0.056)}px Arial`;
      ctx.fillText('Jogadores do Dia', contentX + Math.round(width * 0.04), contentY + Math.round(height * 0.055));
      ctx.font = `800 ${Math.round(width * 0.032)}px Arial`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`[${leftTeam.name}] ${leftTeam.score} x [${rightTeam.name}] ${rightTeam.score}`, contentX + Math.round(width * 0.04), contentY + Math.round(height * 0.1));

      const tableX = contentX + Math.round(width * 0.04);
      const tableY = contentY + Math.round(height * 0.145);
      const tableW = contentW - Math.round(width * 0.08);
      const rowHeight = Math.max(Math.round(height * 0.055), 36);
      const maxRows = Math.max(1, Math.floor((contentH - Math.round(height * 0.19)) / rowHeight));
      const visiblePlayers = players.slice(0, maxRows);

      drawRoundedRect(ctx, tableX, tableY - Math.round(height * 0.028), tableW, rowHeight, 14, 'rgba(214,255,57,0.12)');
      ctx.fillStyle = LIME_SOFT;
      ctx.font = `900 ${Math.round(width * 0.024)}px Arial`;
      ctx.fillText('Participante', tableX + Math.round(width * 0.03), tableY);
      ctx.textAlign = 'center';
      ctx.fillText('Cestas', tableX + Math.round(tableW * 0.72), tableY);
      ctx.fillText('Pontos', tableX + Math.round(tableW * 0.89), tableY);

      visiblePlayers.forEach((player, idx) => {
        const rowY = tableY + rowHeight + idx * rowHeight;
        drawRoundedRect(ctx, tableX, rowY - Math.round(height * 0.028), tableW, rowHeight - 4, 14, idx % 2 === 0 ? CARD_DARK_ALT : 'rgba(18,22,18,0.96)');
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.round(width * 0.025)}px Arial`;
        drawMultiline(ctx, player.name, tableX + Math.round(width * 0.03), rowY, Math.round(tableW * 0.56), Math.round(height * 0.02), 1);

        ctx.textAlign = 'center';
        ctx.fillStyle = player.baskets === maxBaskets && player.baskets > 0 ? LIME : '#ffffff';
        ctx.fillText(`${player.baskets}${player.baskets === maxBaskets && player.baskets > 0 ? ' 🏆' : ''}`, tableX + Math.round(tableW * 0.72), rowY);
        ctx.fillStyle = player.points === maxPoints && player.points > 0 ? LIME : '#ffffff';
        ctx.fillText(`${player.points}${player.points === maxPoints && player.points > 0 ? ' 🏆' : ''}`, tableX + Math.round(tableW * 0.89), rowY);
      });

      if (!visiblePlayers.length) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f1f1f1';
        ctx.font = `700 ${Math.round(width * 0.038)}px Arial`;
        ctx.fillText('Nenhuma cesta registrada nesta data.', width / 2, contentY + contentH / 2);
      } else if (players.length > visiblePlayers.length) {
        ctx.textAlign = 'center';
        ctx.fillStyle = LIME_SOFT;
        ctx.font = `700 ${Math.round(width * 0.028)}px Arial`;
        ctx.fillText(`+ ${players.length - visiblePlayers.length} participante(s)`, width / 2, contentY + contentH - Math.round(height * 0.03));
      }

      ctx.restore();
      ctx.drawImage(frameImage, 0, 0, width, height);
      drawDateStamp(ctx, width, height, formattedDate);
      setRenderedSrc(canvasRef.current.toDataURL('image/png'));
    } finally {
      setBusy(false);
    }
  }

  function downloadPng() {
    if (!renderedSrc) return;
    const link = document.createElement('a');
    link.href = renderedSrc;
    link.download = `arte-rachao-${dateISO}.png`;
    link.click();
  }

  return (
    <div className="container">
      <h1 className="hTitle">Gerador de Arte</h1>
      <div className="panel image-studio-panel">
        <div className="image-studio-frame-card">
          <div>
            <div className="label">Moldura Padrão</div>
            <div className="muted">A moldura do amistoso fica salva aqui e pode ser trocada quando você quiser.</div>
          </div>
          <button className="btn-outline" onClick={() => frameInputRef.current?.click()}>Alterar</button>
          <input ref={frameInputRef} type="file" accept="image/*" onChange={onPickFrame} style={{ display: 'none' }} />
        </div>

        <div className="image-studio-mode-row">
          <button className={`btn-outline ${activeMode === 'photo' ? 'active' : ''}`} onClick={() => setActiveMode('photo')}>Upload de Foto</button>
          <button className={`btn-outline ${activeMode === 'matches' ? 'active' : ''}`} onClick={() => setActiveMode('matches')}>Partidas do Dia</button>
          <button className={`btn-outline ${activeMode === 'players' ? 'active' : ''}`} onClick={() => setActiveMode('players')}>Cestas do Dia</button>
        </div>

        {activeMode === 'photo' ? (
          <div className="image-studio-section">
            <div className="label">Foto do jogador</div>
            <input type="file" accept="image/*" onChange={onPickPhoto} />
          </div>
        ) : null}

        <div className="actions" style={{ marginTop: 14 }}>
          {activeMode === 'photo' ? (
            <button className="btn-controle" onClick={renderPhotoImage} disabled={!frameSrc || !photoSrc || busy}>Gerar Foto</button>
          ) : null}
          {activeMode === 'matches' ? (
            <button className="btn-controle" onClick={renderHistoryImage} disabled={!frameSrc || busy}>Gerar Partidas</button>
          ) : null}
          {activeMode === 'players' ? (
            <button className="btn-controle" onClick={renderPlayersImage} disabled={!frameSrc || busy}>Gerar Cestas</button>
          ) : null}
          <button className="btn-outline" onClick={downloadPng} disabled={!renderedSrc}>Download PNG</button>
        </div>
      </div>

      <div className="panel image-preview-panel">
        <div className="label">Prévia</div>
        {renderedSrc ? (
          <img src={renderedSrc} alt="Prévia da arte" className="image-preview" />
        ) : (
          <div className="muted">Escolha uma das três opções acima para gerar a arte.</div>
        )}
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}
