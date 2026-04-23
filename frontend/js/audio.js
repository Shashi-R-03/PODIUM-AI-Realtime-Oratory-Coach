/* ═══════════════════════════════════════════════════════
   Audio Analysis Module
   Handles Web Audio API: volume, pitch, clarity, viz
   ═══════════════════════════════════════════════════════ */

const AudioAnalyzer = (() => {
  let audioCtx = null, analyser = null, audioData = null;
  let volSmooth = 0;
  let speakState = false, silenceAt = null;
  const SPEECH_THRESH = 14;
  const SILENCE_MIN   = 750;

  const state = {
    volume: 0, pitch: 50, clarity: 70,
    speaking: false,
    volHistory: [],
    pauses: 0, avgPauseMs: 0,
  };
  const pauseLog = [];

  // ── Visualiser bars ────────────────────────────────
  const VIZ_N = 44;
  let vizBars = [];

  function buildViz(container) {
    container.innerHTML = '';
    vizBars = Array.from({ length: VIZ_N }, () => {
      const b = document.createElement('div');
      b.className = 'vbar';
      container.appendChild(b);
      return b;
    });
    startIdleWave();
  }

  let idleT = 0, idleRaf = null, active = false;
  function startIdleWave() {
    if (idleRaf) cancelAnimationFrame(idleRaf);
    function frame() {
      if (!active) {
        idleT += 0.04;
        vizBars.forEach((b, i) => {
          const v = (Math.sin(idleT + i * .22) + 1) / 2;
          b.style.height  = Math.max(2, v * 5) + 'px';
          b.style.opacity = '.10';
          b.style.background = 'var(--cyan)';
        });
      }
      idleRaf = requestAnimationFrame(frame);
    }
    idleRaf = requestAnimationFrame(frame);
  }

  function renderViz(data) {
    if (!data || !vizBars.length) return;
    const step = Math.floor(data.length / VIZ_N);
    vizBars.forEach((b, i) => {
      const v = data[i * step] / 255;
      b.style.height     = Math.max(2, v * 52) + 'px';
      b.style.opacity    = (.25 + v * .75).toFixed(2);
      b.style.background = v > .72 ? 'var(--orange)' : 'var(--cyan)';
    });
  }

  // ── Init ───────────────────────────────────────────
  function init(stream) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = .82;
    src.connect(analyser);
    audioData = new Uint8Array(analyser.frequencyBinCount);
    active = true;
  }

  // ── Tick (call every ~80ms) ────────────────────────
  function tick() {
    if (!analyser) { renderViz(null); return; }
    analyser.getByteFrequencyData(audioData);
    renderViz(audioData);

    const raw = audioData.reduce((a, b) => a + b, 0) / audioData.length;
    volSmooth = volSmooth * .86 + raw * .14;
    state.volume = Math.round(volSmooth);

    state.volHistory.push(volSmooth);
    if (state.volHistory.length > 300) state.volHistory.shift();

    // Clarity = stability of volume
    if (state.volHistory.length > 30) {
      const rec = state.volHistory.slice(-30);
      const mn  = rec.reduce((a, b) => a + b, 0) / rec.length;
      const sd  = Math.sqrt(rec.reduce((s, v) => s + (v - mn) ** 2, 0) / rec.length);
      state.clarity = Math.min(100, Math.max(0, Math.round(78 - sd * .6)));
    }

    // Speaking / silence detection
    const now = Date.now();
    const sp  = volSmooth > SPEECH_THRESH;
    state.speaking = sp;

    if (sp && !speakState) {
      // resumed speaking — measure silence gap
      if (silenceAt && (now - silenceAt) > SILENCE_MIN) {
        const dur = now - silenceAt;
        pauseLog.push(dur);
        state.pauses    = pauseLog.length;
        state.avgPauseMs = Math.round(pauseLog.reduce((a, b) => a + b, 0) / pauseLog.length);
      }
    } else if (!sp && speakState) {
      silenceAt = now;
    }
    speakState = sp;

    // Pitch variation (hi/lo frequency energy ratio)
    const lo = audioData.slice(0, Math.floor(audioData.length * .3));
    const hi = audioData.slice(Math.floor(audioData.length * .5));
    const loA = lo.reduce((a, b) => a + b, 0) / lo.length;
    const hiA = hi.reduce((a, b) => a + b, 0) / hi.length;
    const pr  = sp ? Math.min(100, Math.round(hiA / (loA || 1) * 45)) : state.pitch;
    state.pitch = state.pitch * .88 + pr * .12;
  }

  function destroy() {
    active = false;
    if (audioCtx) { try { audioCtx.close(); } catch {} }
    audioCtx = analyser = null;
    volSmooth = 0; speakState = false; silenceAt = null;
    pauseLog.length = 0;
    Object.assign(state, { volume:0, pitch:50, clarity:70, speaking:false, volHistory:[], pauses:0, avgPauseMs:0 });
  }

  return { init, tick, buildViz, state, destroy };
})();
