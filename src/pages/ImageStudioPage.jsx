import { useMemo, useRef, useState } from 'react';
import { formatDateBR, todayISOInSaoPaulo } from '../utils/time';

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

export default function ImageStudioPage() {
  const [frameSrc, setFrameSrc] = useState('');
  const [photoSrc, setPhotoSrc] = useState('');
  const [dateISO, setDateISO] = useState(todayISOInSaoPaulo());
  const [renderedSrc, setRenderedSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef(null);

  const formattedDate = useMemo(() => formatDateBR(dateISO), [dateISO]);

  async function onPickFrame(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFrameSrc(await loadFileAsDataUrl(file));
  }

  async function onPickPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoSrc(await loadFileAsDataUrl(file));
  }

  async function renderImage() {
    if (!frameSrc || !photoSrc) return;
    setBusy(true);
    try {
      const [frameImage, photoImage] = await Promise.all([loadImage(frameSrc), loadImage(photoSrc)]);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const width = frameImage.width || 1080;
      const height = frameImage.height || 1350;
      canvas.width = width;
      canvas.height = height;

      ctx.clearRect(0, 0, width, height);

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
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(frameImage, 0, 0, width, height);

      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = Math.max(4, width * 0.0055);
      ctx.font = `900 ${Math.round(width * 0.058)}px Georgia, serif`;
      ctx.strokeText(formattedDate, width / 2, height - Math.round(height * 0.075));
      ctx.fillText(formattedDate, width / 2, height - Math.round(height * 0.075));
      ctx.restore();

      setRenderedSrc(canvas.toDataURL('image/png'));
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
        <input type="file" accept="image/*" onChange={onPickFrame} />

        <div className="label">Foto do jogador</div>
        <input type="file" accept="image/*" onChange={onPickPhoto} />

        <div className="label">Data</div>
        <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />

        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn-controle" onClick={renderImage} disabled={!frameSrc || !photoSrc || busy}>Gerar PNG</button>
          <button className="btn-outline" onClick={downloadPng} disabled={!renderedSrc}>Download PNG</button>
        </div>
      </div>

      <div className="panel image-preview-panel">
        <div className="label">Prévia</div>
        {renderedSrc ? (
          <img src={renderedSrc} alt="Prévia da arte" className="image-preview" />
        ) : (
          <div className="muted">Suba a moldura e a foto para gerar a arte.</div>
        )}
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}
