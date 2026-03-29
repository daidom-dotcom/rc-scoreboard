import { useRef } from 'react';

function createTone(ctx, {
  start,
  fromFreq,
  toFreq,
  duration,
  gainValue,
  type = 'sawtooth',
  filterType = 'lowpass',
  filterFreq = 1800,
  q = 1
}) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = type;
  osc.frequency.setValueAtTime(fromFreq, start);
  osc.frequency.exponentialRampToValueAtTime(toFreq, start + duration);

  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFreq, start);
  filter.Q.setValueAtTime(q, start);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(gainValue * 0.82, start + duration * 0.55);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

export default function SoundsPage() {
  const audioCtxRef = useRef(null);

  async function ensureAudioReady() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  async function playAlert(option) {
    const ctx = await ensureAudioReady();
    const now = ctx.currentTime + 0.02;

    if (option === 1) {
      createTone(ctx, {
        start: now,
        fromFreq: 900,
        toFreq: 900,
        duration: 0.10,
        gainValue: 0.8,
        type: 'square',
        filterType: 'lowpass',
        filterFreq: 2200,
        q: 0.7
      });
      return;
    }

    if (option === 2) {
      createTone(ctx, {
        start: now,
        fromFreq: 820,
        toFreq: 1120,
        duration: 0.18,
        gainValue: 0.95,
        type: 'sawtooth',
        filterType: 'bandpass',
        filterFreq: 1500,
        q: 0.9
      });
      createTone(ctx, {
        start: now + 0.025,
        fromFreq: 1180,
        toFreq: 900,
        duration: 0.14,
        gainValue: 0.42,
        type: 'square',
        filterType: 'bandpass',
        filterFreq: 1700,
        q: 0.8
      });
      return;
    }

    createTone(ctx, {
      start: now,
      fromFreq: 720,
      toFreq: 1120,
      duration: 0.22,
      gainValue: 0.9,
      type: 'sawtooth',
      filterType: 'bandpass',
      filterFreq: 1450,
      q: 0.9
    });
    createTone(ctx, {
      start: now + 0.025,
      fromFreq: 980,
      toFreq: 760,
      duration: 0.18,
      gainValue: 0.52,
      type: 'square',
      filterType: 'bandpass',
      filterFreq: 1450,
      q: 0.9
    });
  }

  async function playHorn(option) {
    const ctx = await ensureAudioReady();
    const now = ctx.currentTime + 0.02;

    if (option === 1) {
      createTone(ctx, {
        start: now,
        fromFreq: 340,
        toFreq: 320,
        duration: 1.15,
        gainValue: 1.05,
        type: 'sawtooth',
        filterType: 'lowpass',
        filterFreq: 1700,
        q: 1
      });
      createTone(ctx, {
        start: now + 0.02,
        fromFreq: 510,
        toFreq: 480,
        duration: 1.05,
        gainValue: 0.62,
        type: 'triangle',
        filterType: 'lowpass',
        filterFreq: 1600,
        q: 0.9
      });
      return;
    }

    if (option === 2) {
      createTone(ctx, {
        start: now,
        fromFreq: 420,
        toFreq: 380,
        duration: 1.25,
        gainValue: 1.15,
        type: 'square',
        filterType: 'bandpass',
        filterFreq: 1400,
        q: 1.1
      });
      createTone(ctx, {
        start: now + 0.04,
        fromFreq: 620,
        toFreq: 560,
        duration: 1.05,
        gainValue: 0.58,
        type: 'sawtooth',
        filterType: 'lowpass',
        filterFreq: 1800,
        q: 0.8
      });
      return;
    }

    createTone(ctx, {
      start: now,
      fromFreq: 285,
      toFreq: 252,
      duration: 1.55,
      gainValue: 1.45,
      type: 'sawtooth',
      filterType: 'lowpass',
      filterFreq: 1500,
      q: 1.1
    });
    createTone(ctx, {
      start: now + 0.045,
      fromFreq: 430,
      toFreq: 386,
      duration: 1.42,
      gainValue: 1.02,
      type: 'square',
      filterType: 'lowpass',
      filterFreq: 1500,
      q: 1.1
    });
    createTone(ctx, {
      start: now + 0.08,
      fromFreq: 575,
      toFreq: 540,
      duration: 1.18,
      gainValue: 0.44,
      type: 'triangle',
      filterType: 'lowpass',
      filterFreq: 1500,
      q: 1.1
    });
  }

  return (
    <div className="container">
      <h1 className="hTitle">Teste de Sons</h1>

      <div className="panel sound-panel">
        <div className="label">Alertas 20..2</div>
        <div className="sound-grid">
          <button className="btn-outline" onClick={() => playAlert(1)}>Alerta 1</button>
          <button className="btn-outline" onClick={() => playAlert(2)}>Alerta 2</button>
          <button className="btn-outline" onClick={() => playAlert(3)}>Alerta 3</button>
        </div>
        <div className="muted sound-help">1 = beep seco, 2 = eletrônico, 3 = mini sirene</div>
      </div>

      <div className="panel sound-panel">
        <div className="label">Corneta final 00:01</div>
        <div className="sound-grid">
          <button className="btn-outline" onClick={() => playHorn(1)}>Corneta 1</button>
          <button className="btn-outline" onClick={() => playHorn(2)}>Corneta 2</button>
          <button className="btn-outline" onClick={() => playHorn(3)}>Corneta 3</button>
        </div>
        <div className="muted sound-help">1 = ginásio forte, 2 = sirene esportiva, 3 = corneta dupla</div>
      </div>
    </div>
  );
}
