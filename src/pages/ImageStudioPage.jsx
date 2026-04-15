import { useMemo, useRef, useState } from 'react';
import { fetchMatchesByDate } from '../lib/api';
import { formatDateBR, todayISOInSaoPaulo } from '../utils/time';

const DEFAULT_FRAME_SRC = '/moldura-padrao.png';

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

export default function ImageStudioPage() {
  const [frameSrc] = useState(DEFAULT_FRAME_SRC);
  const [photoSrc, setPhotoSrc] = useState('');
  const [dateISO, setDateISO] = useState(todayISOInSaoPaulo());
  const [renderedSrc, setRenderedSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef(null);

  const formattedDate = useMemo(() => formatDateBR(dateISO), [dateISO]);

  async function onPickPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoSrc(await loadFileAsDataUrl(file));
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
      const rows = await fetchMatchesByDate(dateISO);
      const safeRows = [...(rows || [])].sort((a, b) => Number(a.match_no || 0) - Number(b.match_no || 0));

      const contentX = Math.round(width * 0.08);
      const contentY = Math.round(height * 0.15);
      const contentW = Math.round(width * 0.84);
      const contentH = Math.round(height * 0.66);
      drawRoundedRect(ctx, contentX, contentY, contentW, contentH, Math.round(width * 0.035), 'rgba(255,255,255,0.96)');

      ctx.save();
      ctx.fillStyle = '#111111';
      ctx.textAlign = 'left';
      ctx.font = `900 ${Math.round(width * 0.06)}px Arial`;
      ctx.fillText('Historico do Dia', contentX + Math.round(width * 0.04), contentY + Math.round(height * 0.055));
      ctx.font = `700 ${Math.round(width * 0.036)}px Arial`;
      ctx.fillStyle = '#333333';
      ctx.fillText(formattedDate, contentX + Math.round(width * 0.04), contentY + Math.round(height * 0.09));

      const topY = contentY + Math.round(height * 0.12);
      const rowHeight = Math.max(Math.round(height * 0.075), 44);
      const maxRows = Math.max(1, Math.floor((contentH - Math.round(height * 0.15)) / rowHeight));
      const visibleRows = safeRows.slice(0, maxRows);

      visibleRows.forEach((match, idx) => {
        const res = Array.isArray(match.match_results) ? match.match_results[0] : match.match_results;
        const rowY = topY + idx * rowHeight;
        drawRoundedRect(ctx, contentX + Math.round(width * 0.03), rowY - Math.round(height * 0.03), contentW - Math.round(width * 0.06), rowHeight - Math.round(height * 0.01), 16, idx % 2 === 0 ? 'rgba(245,245,245,0.96)' : 'rgba(236,236,236,0.96)');

        ctx.fillStyle = '#1a1a1a';
        ctx.font = `900 ${Math.round(width * 0.034)}px Arial`;
        ctx.fillText(formatMatchLabel(match), contentX + Math.round(width * 0.06), rowY);

        ctx.font = `700 ${Math.round(width * 0.03)}px Arial`;
        const scoreText = `${res?.score_a ?? 0} x ${res?.score_b ?? 0}`;
        ctx.textAlign = 'right';
        ctx.fillText(scoreText, contentX + contentW - Math.round(width * 0.08), rowY);

        ctx.textAlign = 'left';
        ctx.font = `700 ${Math.round(width * 0.029)}px Arial`;
        ctx.fillStyle = '#333333';
        drawMultiline(
          ctx,
          `${match.team_a_name || 'Time A'} vs ${match.team_b_name || 'Time B'}`,
          contentX + Math.round(width * 0.06),
          rowY + Math.round(height * 0.03),
          contentW - Math.round(width * 0.22),
          Math.round(height * 0.028),
          2
        );
      });

      if (!visibleRows.length) {
        ctx.fillStyle = '#222222';
        ctx.textAlign = 'center';
        ctx.font = `700 ${Math.round(width * 0.04)}px Arial`;
        ctx.fillText('Nenhuma partida registrada nesta data.', width / 2, contentY + contentH / 2);
      } else if (safeRows.length > visibleRows.length) {
        ctx.fillStyle = '#666666';
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
        <div className="label">Moldura padrão</div>
        <div className="muted">A moldura fixa do amistoso já está salva no app.</div>

        <div className="label">Foto do jogador</div>
        <input type="file" accept="image/*" onChange={onPickPhoto} />

        <div className="label">Data</div>
        <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />

        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn-controle" onClick={renderPhotoImage} disabled={!frameSrc || !photoSrc || busy}>Gerar Foto</button>
          <button className="btn-outline" onClick={renderHistoryImage} disabled={!frameSrc || busy}>Gerar Resumo do Dia</button>
          <button className="btn-outline" onClick={downloadPng} disabled={!renderedSrc}>Download PNG</button>
        </div>
      </div>

      <div className="panel image-preview-panel">
        <div className="label">Prévia</div>
        {renderedSrc ? (
          <img src={renderedSrc} alt="Prévia da arte" className="image-preview" />
        ) : (
          <div className="muted">Você pode gerar uma arte com foto ou um resumo visual do histórico do dia.</div>
        )}
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}
