/* ═══════════════════════════════════════════════════════
   Coach Controller — orchestrates session lifecycle
   Connects audio, speech, MP, WebSocket, and UI
   ═══════════════════════════════════════════════════════ */

// Guard
if (!requireAuth()) { /* redirect handled */ }

// ── State ──────────────────────────────────────────────
let active = false, sessionId = null, ws = null;
let mediaStream = null;
let sessionStart = null;
let timerIv = null, analysisIv = null, wsSendIv = null;
let scores = { voice: 50, body: 50, overall: 50 };

// ── DOM refs ───────────────────────────────────────────
const vid       = document.getElementById('vid');
const overlay   = document.getElementById('overlay');
const noCamEl   = document.getElementById('noCam');
const loadOvEl  = document.getElementById('loadOv');
const loadTxtEl = document.getElementById('loadTxt');
const scanLine  = document.getElementById('scanLine');
const txEl      = document.getElementById('txText');
const fbStream  = document.getElementById('fbStream');
const timerEl   = document.getElementById('timerDisp');
const mainBtn   = document.getElementById('mainBtn');
const vizEl     = document.getElementById('vizEl');

// ── Boot ───────────────────────────────────────────────
AudioAnalyzer.buildViz(vizEl);

const user = Api.user();
if (user) document.getElementById('hdrUser').textContent = user.name;

// ── Render helpers ──────────────────────────────────────
function setDot(id, s) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('pulse');
  const styles = {
    active: ['var(--green)', '0 0 8px var(--green)'],
    pulse:  ['var(--orange)','0 0 8px var(--orange)'],
    '':     ['var(--text-dim)', 'none'],
  };
  const [bg, sh] = styles[s] || styles[''];
  el.style.background  = bg;
  el.style.boxShadow   = sh;
  if (s === 'pulse') el.classList.add('pulse');
}
function setPill(id, s) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active', 'rec');
  if (s) el.classList.add(s);
}
function bar(fillId, pct, color) {
  const el = document.getElementById(fillId);
  if (!el) return;
  el.style.width      = Math.min(100, pct) + '%';
  el.style.background = color;
}
function metVal(id, v, cls = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = v;
  el.className   = 'mval' + (cls ? ' ' + cls : '');
}

function addFB(text, type = 'info', icon = '💡', ts = null) {
  const ph = fbStream.querySelector('[data-ph]');
  if (ph) ph.remove();
  const elapsed = sessionStart ? Math.floor((Date.now() - sessionStart) / 1000) : 0;
  const tss = ts !== null ? ts : elapsed;
  const d   = document.createElement('div');
  d.className = `fb-msg ${type}`;
  d.innerHTML = `<span class="fb-icon">${icon}</span>${text}<div class="fb-ts">${String(Math.floor(tss/60)).padStart(2,'0')}:${String(tss%60).padStart(2,'0')}</div>`;
  fbStream.appendChild(d);
  fbStream.scrollTop = fbStream.scrollHeight;
  const all = fbStream.querySelectorAll('.fb-msg');
  if (all.length > 24) all[0].remove();
}

// ── Score ring renderer ────────────────────────────────
const RING_C = 119.4;
function renderScores(s) {
  const sc = v => v >= 75 ? 'var(--green)' : v >= 50 ? 'var(--cyan)' : 'var(--orange)';
  document.getElementById('voiceNum').textContent = s ? s.voice : '--';
  document.getElementById('bodyNum').textContent  = s ? s.body  : '--';
  document.getElementById('overallNum').textContent = s ? s.overall : '--';
  document.getElementById('voiceNum').style.color = s ? sc(s.voice)  : 'var(--cyan)';
  document.getElementById('bodyNum').style.color  = s ? sc(s.body)   : 'var(--green)';
  document.getElementById('overallNum').style.color = s ? sc(s.overall) : 'var(--cyan)';
  document.getElementById('voiceRing').style.strokeDashoffset = s ? RING_C - (s.voice  / 100) * RING_C : RING_C;
  document.getElementById('bodyRing').style.strokeDashoffset  = s ? RING_C - (s.body   / 100) * RING_C : RING_C;
  document.getElementById('voiceRing').style.stroke = s ? sc(s.voice) : 'var(--cyan)';
  document.getElementById('bodyRing').style.stroke  = s ? sc(s.body)  : 'var(--green)';
}

// ── Metric UI refresh (called every 80ms) ──────────────
function renderMetrics() {
  const a = AudioAnalyzer.state;
  const sp = SpeechEngine.state;
  const v  = MPEngine.state;

  // WPM
  const wEl = document.getElementById('wpmNum');
  if (wEl) {
    wEl.textContent  = sp.wpm > 0 ? sp.wpm : '--';
    wEl.style.color  = sp.wpm > 170 ? 'var(--orange)' : sp.wpm >= 115 && sp.wpm <= 158 ? 'var(--green)' : 'var(--cyan)';
  }

  // Audio bars
  bar('volFill', Math.min(100, (a.volume / 55) * 100),
      a.volume < 16 && a.speaking ? 'var(--orange)' : a.volume > 65 ? 'var(--red)' : 'var(--cyan)');
  metVal('volVal',   a.volume || '--', a.volume < 16 && a.speaking ? 'warn' : a.volume > 0 ? 'good' : '');
  bar('pitchFill', Math.min(100, a.pitch), a.pitch < 22 ? 'var(--orange)' : 'var(--cyan)');
  metVal('pitchVal', Math.round(a.pitch) || '--');
  bar('clarFill', a.clarity, a.clarity >= 68 ? 'var(--green)' : a.clarity >= 45 ? 'var(--cyan)' : 'var(--orange)');
  metVal('clarVal', a.clarity, a.clarity >= 68 ? 'good' : a.clarity < 45 ? 'warn' : '');

  // Fillers
  const fn = document.getElementById('fillerNum');
  if (fn) { fn.textContent = sp.fillers; fn.style.color = sp.fillers > 5 ? 'var(--red)' : sp.fillers > 2 ? 'var(--orange)' : 'var(--green)'; }
  const fs = document.getElementById('fillerStrip');
  if (fs) fs.innerHTML = Object.entries(sp.fillerMap).filter(([,n])=>n>0).sort(([,a],[,b])=>b-a).slice(0,6)
    .map(([w,n])=>`<div class="ftag">${w} ×${n}</div>`).join('');

  document.getElementById('pauseVal').textContent    = a.pauses;
  document.getElementById('avgPauseVal').textContent = a.avgPauseMs > 0 ? (a.avgPauseMs / 1000).toFixed(1) + 's' : '--';

  // Body
  bar('eyeFill',  v.eye,     v.eye  >= 70 ? 'var(--green)' : v.eye  >= 40 ? 'var(--cyan)' : 'var(--orange)');
  metVal('eyeVal',  v.totF > 0 ? v.eye + '%' : '--',  v.eye >= 70 ? 'good' : v.eye < 40 && v.totF > 60 ? 'warn' : '');
  bar('gestFill', Math.min(100, v.gesture * 1.8), v.gesture >= 14 ? 'var(--green)' : 'var(--cyan)');
  metVal('gestVal', v.totF > 0 ? v.gesture + '%' : '--', v.gesture >= 14 ? 'good' : '');
  bar('postFill', v.posture, v.posture >= 75 ? 'var(--green)' : v.posture >= 42 ? 'var(--cyan)' : 'var(--orange)');
  metVal('postVal', v.totF > 0 ? v.posture + '%' : '--', v.posture >= 75 ? 'good' : v.posture < 42 ? 'warn' : '');
  bar('headFill', v.head, v.head >= 70 ? 'var(--green)' : 'var(--cyan)');
  metVal('headVal', v.totF > 0 ? v.head + '%' : '--');
  bar('engFill',  v.engage, v.engage >= 70 ? 'var(--green)' : 'var(--cyan)');
  metVal('engVal',  v.totF > 0 ? v.engage + '%' : '--');
}

// ── WebSocket ──────────────────────────────────────────
function openWS(sid) {
  ws = Api.openCoachSocket(sid);
  ws.onopen  = () => console.log('[WS] connected');
  ws.onclose = () => console.log('[WS] closed');
  ws.onerror = (e) => console.warn('[WS] error', e);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'scores' && msg.scores) {
        scores = msg.scores;
        renderScores(scores);
      }
      if (msg.feedback) {
        addFB(msg.feedback.text, msg.feedback.type, msg.feedback.icon, msg.feedback.timestamp_s);
      }
      if (msg.type === 'ended') {
        toast(`Session saved · Score: ${msg.scores.overall}`, 'success', 4000);
      }
    } catch {}
  };
}

function sendMetrics() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const a  = AudioAnalyzer.state;
  const sp = SpeechEngine.state;
  const v  = MPEngine.state;
  ws.send(JSON.stringify({
    type: 'metrics',
    audio: {
      wpm: sp.wpm, volume: a.volume, pitch: Math.round(a.pitch),
      clarity: a.clarity, fillers: sp.fillers, filler_map: sp.fillerMap,
      pauses: a.pauses, avg_pause_ms: a.avgPauseMs, words: sp.words,
      speaking: a.speaking,
    },
    video: {
      eye: v.eye, gesture: v.gesture, posture: v.posture,
      head: v.head, engage: v.engage, frames: v.totF,
      face_on: v.faceOn,
    },
  }));
}

// ── Timer ──────────────────────────────────────────────
function tickTimer() {
  if (!sessionStart) return;
  const s = Math.floor((Date.now() - sessionStart) / 1000);
  timerEl.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

// ── Start session ──────────────────────────────────────
async function startSession() {
  mainBtn.disabled = true;
  loadOvEl.style.display = 'flex';

  try {
    loadTxtEl.textContent = 'REQUESTING PERMISSIONS…';
    // Request ONCE — both video+audio together
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width:640, height:480, facingMode:'user' },
      audio: { echoCancellation:true, noiseSuppression:true, sampleRate:44100 },
    });

    vid.srcObject = mediaStream;
    await vid.play();
    noCamEl.style.display = 'none';
    scanLine.style.display = 'block';
    setDot('camDot', 'active'); setPill('camPill', 'active');

    loadTxtEl.textContent = 'INITIALIZING AUDIO…';
    const audioOnlyStream = new MediaStream(mediaStream.getAudioTracks());
    AudioAnalyzer.init(audioOnlyStream);
    setDot('micDot', 'active'); setPill('micPill', 'active');

    loadTxtEl.textContent = 'INITIALIZING SPEECH ENGINE…';
    // Speech recognition uses the same mic permission — no new popup
    SpeechEngine.init((state, htmlTx) => {
      txEl.innerHTML = htmlTx || '<span style="opacity:.4">Listening…</span>';
    });

    loadTxtEl.textContent = 'LOADING AI VISION MODELS…';
    const mpOk = await MPEngine.init(vid);
    if (mpOk) { MPEngine.start(); setDot('camDot','pulse'); setPill('camPill','rec'); }

    loadTxtEl.textContent = 'CREATING SESSION…';
    const { session_id } = await Api.createSession('Session ' + new Date().toLocaleTimeString());
    sessionId = session_id;
    openWS(sessionId);

    active = true; sessionStart = Date.now();
    loadOvEl.style.display = 'none';
    mainBtn.textContent = 'END SESSION';
    mainBtn.className   = 'btn btn-danger';
    mainBtn.disabled    = false;

    setDot('statusDot','pulse'); setPill('statusPill','rec');
    document.getElementById('statusTxt').textContent = 'RECORDING';
    fbStream.innerHTML = '';

    timerIv    = setInterval(tickTimer, 1000);
    analysisIv = setInterval(() => { AudioAnalyzer.tick(); renderMetrics(); }, 80);
    wsSendIv   = setInterval(sendMetrics, 500);

    setTimeout(() => addFB('Session started! Speak naturally — I\'ll coach you in real time.', 'info', '🎤'), 800);

  } catch (err) {
    console.error(err);
    loadOvEl.style.display = 'none';
    mainBtn.disabled = false;
    const msg = err.name === 'NotAllowedError'
      ? 'Camera/microphone permission denied. Please allow access in your browser settings.'
      : err.name === 'NotFoundError' ? 'No camera or microphone found.'
      : err.message;
    toast(msg, 'error', 6000);
  }
}

// ── End session ────────────────────────────────────────
async function endSession() {
  active = false;
  clearInterval(timerIv); clearInterval(analysisIv); clearInterval(wsSendIv);

  // Tell backend session ended
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'end', data: { transcript: SpeechEngine.state.transcript } }));
    await new Promise(r => setTimeout(r, 600));
    ws.close();
  }

  SpeechEngine.destroy();
  MPEngine.destroy();
  AudioAnalyzer.destroy();

  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }

  const dur = sessionStart ? Math.floor((Date.now() - sessionStart) / 1000) : 0;
  const m   = Math.floor(dur/60), s = String(dur%60).padStart(2,'0');
  addFB(`Session complete · ${m}:${s} · Score: ${scores.overall}/100`, 'info', '📊');

  mainBtn.textContent = 'START SESSION';
  mainBtn.className   = 'btn btn-primary';
  mainBtn.disabled    = false;

  setDot('statusDot',''); setPill('statusPill','');
  document.getElementById('statusTxt').textContent = 'READY';
  setDot('micDot',''); setPill('micPill','');
  setDot('camDot',''); setPill('camPill','');
  scanLine.style.display = 'none';

  timerEl.textContent = '00:00';
  renderScores(null);
  sessionStart = null; sessionId = null;
}

function toggleSession() { if (active) endSession(); else startSession(); }

// initial render
renderScores(null);
