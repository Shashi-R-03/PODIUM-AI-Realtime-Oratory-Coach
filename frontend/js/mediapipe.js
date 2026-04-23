/* ═══════════════════════════════════════════════════════
   MediaPipe Holistic Module
   Face mesh, hand landmarks, pose for body language metrics
   ═══════════════════════════════════════════════════════ */

const MPEngine = (() => {
  let holistic = null, mpCam = null;
  let active   = false;

  const state = {
    eye: 0, gesture: 0, posture: 50, head: 80, engage: 0,
    faceOn: false, handsOn: false,
    eyeF: 0, gestF: 0, totF: 0,
  };

  let noseHist = [], prevNose = null;

  function onResults(r) {
    if (!active) return;
    const cv  = document.getElementById('overlay');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.save(); ctx.clearRect(0, 0, cv.width, cv.height);
    state.totF++;
    state.faceOn  = !!r.faceLandmarks;
    state.handsOn = !!(r.leftHandLandmarks || r.rightHandLandmarks);

    // ── Face / Eye contact ──────────────────────────
    if (r.faceLandmarks) {
      const lm = r.faceLandmarks;
      try {
        if (window.drawConnectors) {
          if (window.FACEMESH_TESSELATION)
            drawConnectors(ctx, lm, FACEMESH_TESSELATION, { color:'rgba(0,212,255,.05)', lineWidth:.4 });
          if (window.FACEMESH_FACE_OVAL)
            drawConnectors(ctx, lm, FACEMESH_FACE_OVAL, { color:'rgba(0,212,255,.22)', lineWidth:1 });
          if (window.FACEMESH_LEFT_EYE) {
            drawConnectors(ctx, lm, FACEMESH_LEFT_EYE,  { color:'rgba(0,232,122,.55)', lineWidth:1.2 });
            drawConnectors(ctx, lm, FACEMESH_RIGHT_EYE, { color:'rgba(0,232,122,.55)', lineWidth:1.2 });
          }
        }
      } catch {}

      // Eye contact: nose offset from face centre
      const nose = lm[1], lc = lm[234], rc = lm[454], chin = lm[152], fore = lm[10];
      const cx   = (lc.x + rc.x) / 2;
      const fw   = Math.abs(rc.x - lc.x);
      const fh   = Math.abs(chin.y - fore.y);
      const hOff = Math.abs(nose.x - cx) / (fw || .1);
      const vOff = Math.abs(nose.y - ((fore.y + chin.y) / 2)) / (fh || .1);
      if (hOff < .16 && vOff < .22) state.eyeF++;
      state.eye = Math.round(state.eyeF / state.totF * 100);

      // Iris dots (refined landmarks)
      if (lm.length > 468) {
        const li = lm[468], ri = lm[473];
        const ir = fw * cv.width * .015;
        ctx.fillStyle = (hOff < .16 && vOff < .22) ? 'rgba(0,232,122,.85)' : 'rgba(0,212,255,.55)';
        ctx.beginPath(); ctx.arc(li.x * cv.width, li.y * cv.height, ir, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(ri.x * cv.width, ri.y * cv.height, ir, 0, Math.PI*2); ctx.fill();
      }

      // Head stability
      const cn = { x: nose.x, y: nose.y };
      if (prevNose) {
        const d = Math.hypot(cn.x - prevNose.x, cn.y - prevNose.y);
        noseHist.push(d);
        if (noseHist.length > 90) noseHist.shift();
      }
      prevNose = cn;
      if (noseHist.length > 15) {
        const avg = noseHist.reduce((a, b) => a + b, 0) / noseHist.length;
        state.head = Math.round(Math.max(0, 1 - avg * 50) * 100);
      }
    } else {
      prevNose = null;
    }

    // ── Hands / Gestures ───────────────────────────
    const hc = (r.leftHandLandmarks ? 1 : 0) + (r.rightHandLandmarks ? 1 : 0);
    if (hc > 0) state.gestF++;
    state.gesture = Math.round(state.gestF / state.totF * 100);

    try {
      if (window.drawConnectors && window.HAND_CONNECTIONS) {
        if (r.leftHandLandmarks) {
          drawConnectors(ctx, r.leftHandLandmarks,  HAND_CONNECTIONS, { color:'rgba(255,107,53,.6)', lineWidth:1.8 });
          drawLandmarks(ctx,  r.leftHandLandmarks,  { color:'rgba(255,107,53,.85)', lineWidth:1, radius:2.5 });
        }
        if (r.rightHandLandmarks) {
          drawConnectors(ctx, r.rightHandLandmarks, HAND_CONNECTIONS, { color:'rgba(255,107,53,.6)', lineWidth:1.8 });
          drawLandmarks(ctx,  r.rightHandLandmarks, { color:'rgba(255,107,53,.85)', lineWidth:1, radius:2.5 });
        }
      }
    } catch {}

    // ── Pose / Posture ─────────────────────────────
    if (r.poseLandmarks) {
      try {
        if (window.drawConnectors && window.POSE_CONNECTIONS)
          drawConnectors(ctx, r.poseLandmarks, POSE_CONNECTIONS, { color:'rgba(0,212,255,.25)', lineWidth:1.5 });
      } catch {}
      const ls = r.poseLandmarks[11], rs = r.poseLandmarks[12];
      if (ls && rs) {
        const sym = 1 - Math.min(Math.abs(ls.y - rs.y) / (Math.abs(ls.x - rs.x) || .1), 1);
        const ht  = Math.max(0, 1 - (((ls.y + rs.y) / 2) - .35) * 3);
        state.posture = Math.round((sym * .65 + ht * .35) * 100);
      }
    }

    // Engagement composite
    state.engage = Math.round([
      state.faceOn ? 1 : 0,
      state.eye / 100,
      Math.min(state.gesture / 25, 1),
      state.posture / 100,
      state.head / 100,
    ].reduce((a, b) => a + b, 0) / 5 * 100);

    ctx.restore();
  }

  async function init(videoEl) {
    if (typeof Holistic === 'undefined') { console.warn('MediaPipe not loaded'); return false; }
    return new Promise(resolve => {
      try {
        holistic = new Holistic({
          locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${f}`
        });
        holistic.setOptions({
          modelComplexity: 1, smoothLandmarks: true,
          refineFaceLandmarks: true, enableSegmentation: false,
          minDetectionConfidence: .5, minTrackingConfidence: .5,
        });
        holistic.onResults(onResults);

        if (typeof Camera !== 'undefined') {
          mpCam = new Camera(videoEl, {
            onFrame: async () => {
              if (holistic && active) {
                const cv = document.getElementById('overlay');
                if (cv) { cv.width = videoEl.videoWidth || 640; cv.height = videoEl.videoHeight || 480; }
                await holistic.send({ image: videoEl });
              }
            },
            width: 640, height: 480,
          });
          mpCam.start().then(() => resolve(true)).catch(() => resolve(false));
        } else {
          resolve(false);
        }
      } catch (e) { console.warn('MP init error:', e); resolve(false); }
    });
  }

  function start() { active = true; }

  function destroy() {
    active = false;
    if (mpCam)    { try { mpCam.stop();    } catch {} mpCam    = null; }
    if (holistic) { try { holistic.close(); } catch {} holistic = null; }
    noseHist = []; prevNose = null;
    Object.assign(state, { eye:0, gesture:0, posture:50, head:80, engage:0,
      faceOn:false, handsOn:false, eyeF:0, gestF:0, totF:0 });
    const cv = document.getElementById('overlay');
    if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  }

  return { init, start, destroy, state };
})();
