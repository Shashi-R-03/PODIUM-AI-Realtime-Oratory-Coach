/* ═══════════════════════════════════════════════════════
   Speech Recognition Module
   FIX: Single SpeechRecognition instance, never recreated.
   FIX 2: Interim transcript shown immediately (no regex on interim).
   Mic permission is granted once via getUserMedia upstream.
   ═══════════════════════════════════════════════════════ */

const SpeechEngine = (() => {
  const FILLER_WORDS = [
    'um','uh','like','you know','basically','literally',
    'actually','kind of','sort of','i mean',
  ];

  const state = {
    wpm: 0, words: 0,
    fillers: 0, fillerMap: {},
    transcript: '',
  };

  let recognition  = null;
  let active       = false;
  let wpmLog       = [];
  let fullTx       = '';
  let onUpdateCb   = null;
  let restartTimer = null;

  function hilightFillers(text) {
    let r = text;
    FILLER_WORDS.forEach(f => {
      r = r.replace(new RegExp(`\\b(${f})\\b`, 'gi'), '<span class="filler-hi">$1</span>');
    });
    return r;
  }

  function init(onUpdate) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { console.warn('SpeechRecognition not supported'); return false; }
    onUpdateCb = onUpdate;

    // ─ Create ONCE ─
    recognition = new SR();
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.lang            = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          processFinal(t);
          interim = '';
        } else {
          interim += t;
        }
      }

      // ── FIX: show interim instantly, no regex on it ────────
      // Only run hilightFillers on finalized text (cheap slice).
      // Interim text rendered as plain dimmed+italic span.
      const finalSlice = hilightFillers(fullTx.slice(-400));
      const html = finalSlice +
        (interim
          ? `<span style="opacity:0.45;font-style:italic">${interim}</span>`
          : '');

      if (onUpdateCb) onUpdateCb(state, html);
    };

    recognition.onerror = (e) => {
      if (e.error === 'not-allowed') {
        console.error('Mic permission denied for SpeechRecognition');
      }
      // 'no-speech' is normal — ignore it
    };

    // KEY FIX: restart same instance, never create new one
    recognition.onend = () => {
      if (!active) return;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (!active) return;
        try { recognition.start(); } catch { /* already running */ }
      }, 150); // reduced from 300ms → 150ms for faster resumption
    };

    active = true;
    try { recognition.start(); return true; }
    catch (e) { console.warn('SR start error:', e); return false; }
  }

  function processFinal(text) {
    const ws   = text.trim().split(/\s+/).filter(Boolean);
    state.words += ws.length;

    const now = Date.now();
    wpmLog.push({ t: now, n: ws.length });
    wpmLog = wpmLog.filter(w => now - w.t < 60000);
    const tw  = wpmLog.reduce((s, w) => s + w.n, 0);
    const dur = wpmLog.length > 1 ? (wpmLog[wpmLog.length - 1].t - wpmLog[0].t) / 60000 : 0.1;
    state.wpm = Math.round(tw / Math.max(dur, 0.1));

    // Filler detection
    const lt = text.toLowerCase();
    FILLER_WORDS.forEach(f => {
      const m = lt.match(new RegExp(`\\b${f}\\b`, 'g'));
      if (m) {
        state.fillers += m.length;
        state.fillerMap[f] = (state.fillerMap[f] || 0) + m.length;
      }
    });

    fullTx += text + ' ';
    state.transcript = fullTx.slice(-600);
  }

  function destroy() {
    active = false;
    clearTimeout(restartTimer);
    if (recognition) {
      try { recognition.abort(); } catch {}
      recognition = null;
    }
    wpmLog = []; fullTx = '';
    Object.assign(state, { wpm:0, words:0, fillers:0, fillerMap:{}, transcript:'' });
  }

  return { init, destroy, reset: destroy, state, hilightFillers };
})();
