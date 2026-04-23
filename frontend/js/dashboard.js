/* ═══════════════════════════════════════════════════════
   Dashboard Controller
   FIX: PDF download via Api.downloadPdf() (proper JWT auth)
   ═══════════════════════════════════════════════════════ */

if (!requireAuth()) { /* redirect */ }

let trendChart = null;
const user = Api.user();

// ── Boot ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const nameEl  = document.getElementById('hdrUser');
  const greetEl = document.getElementById('greetName');
  if (user) {
    if (nameEl)  nameEl.textContent  = user.name;
    if (greetEl) greetEl.textContent = user.name.split(' ')[0];
  }

  document.getElementById('dashLoading').style.display = 'flex';
  try {
    await Promise.all([loadOverview(), loadSessions()]);
  } catch (e) {
    toast('Failed to load dashboard: ' + e.message, 'error');
  }
  document.getElementById('dashLoading').style.display = 'none';
});

// ── Overview (stats + charts) ─────────────────────────
async function loadOverview() {
  const data = await Api.getOverview();

  setText('statSessions', data.total_sessions);
  setText('statBest',     data.best_score);
  setText('statAvg',      data.avg_score);
  const hrs = Math.floor(data.total_duration_s / 3600);
  const min = Math.floor((data.total_duration_s % 3600) / 60);
  setText('statTime', hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
  setText('statWords', data.total_words.toLocaleString());

  buildTrendChart(data.trend || []);
  buildCatAvgs(data.category_avgs || {});
  buildFillerBars(data.filler_totals || {});
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

// ── Trend line chart ──────────────────────────────────
function buildTrendChart(trend) {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;
  if (trendChart) { trendChart.destroy(); }

  if (!trend.length) {
    canvas.parentElement.innerHTML = `<div class="empty-state" style="padding:20px"><div class="big">📈</div>No sessions yet</div>`;
    return;
  }

  const labels  = trend.map(d => d.date);
  const overall = trend.map(d => d.overall);
  const voice   = trend.map(d => d.voice);
  const body    = trend.map(d => d.body);

  trendChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Overall', data: overall,
          borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,.08)',
          borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#00d4ff',
          tension: .3, fill: true,
        },
        {
          label: 'Voice', data: voice,
          borderColor: '#00e87a', borderWidth: 1.5, pointRadius: 2,
          pointBackgroundColor: '#00e87a', tension: .3, fill: false,
        },
        {
          label: 'Body', data: body,
          borderColor: '#ff6b35', borderWidth: 1.5, pointRadius: 2,
          pointBackgroundColor: '#ff6b35', tension: .3, fill: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#3a6580', font: { family: 'Space Mono', size: 9 }, boxWidth: 10 }
        },
        tooltip: {
          backgroundColor: '#07101e', borderColor: '#162438', borderWidth: 1,
          titleFont: { family: 'Orbitron', size: 9 }, bodyFont: { family: 'Space Mono', size: 9 },
          titleColor: '#00d4ff', bodyColor: '#d8ecff',
        }
      },
      scales: {
        x: { ticks: { color:'#3a6580', font:{family:'Space Mono',size:8} }, grid:{color:'rgba(22,36,56,.6)'} },
        y: {
          min: 0, max: 100,
          ticks: { color:'#3a6580', font:{family:'Space Mono',size:8}, stepSize: 25 },
          grid: { color:'rgba(22,36,56,.6)' }
        }
      }
    }
  });
}

// ── Category averages ─────────────────────────────────
function buildCatAvgs(avgs) {
  const wrap = document.getElementById('catAvgs');
  if (!wrap) return;
  const items = [
    ['WPM',        'wpm',           'cyan'],
    ['Volume',     'volume',        'cyan'],
    ['Clarity',    'clarity',       'green'],
    ['Eye Contact','eye_contact',   'green'],
    ['Gestures',   'gesture_freq',  'orange'],
    ['Posture',    'posture',       'cyan'],
    ['Head Still', 'head_stability','green'],
  ];
  wrap.innerHTML = items.map(([label, key, col]) => {
    const v = avgs[key] || 0;
    const color = col === 'green' ? 'var(--green)' : col === 'orange' ? 'var(--orange)' : 'var(--cyan)';
    return `
      <div class="cat-item">
        <div class="cat-name">${label}</div>
        <div class="cat-track">
          <div class="cat-fill" style="width:${Math.min(v,100)}%;background:${color}"></div>
        </div>
        <div class="cat-val" style="color:${color}">${v}</div>
      </div>`;
  }).join('');
}

// ── Filler word bars ──────────────────────────────────
function buildFillerBars(fillers) {
  const wrap = document.getElementById('fillerBars');
  if (!wrap) return;
  const entries = Object.entries(fillers).sort(([,a],[,b]) => b - a).slice(0, 7);
  if (!entries.length) {
    wrap.innerHTML = '<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-dim);letter-spacing:1px;padding:8px 0">No filler data yet</div>';
    return;
  }
  const max = entries[0][1];
  wrap.innerHTML = entries.map(([word, count]) => `
    <div class="mrow">
      <div class="mname" style="min-width:72px">${word}</div>
      <div class="mtrack"><div class="mfill" style="width:${(count/max*100).toFixed(0)}%;background:var(--orange)"></div></div>
      <div class="mval warn">${count}</div>
    </div>`).join('');
}

// ── Session list ──────────────────────────────────────
async function loadSessions() {
  const list = await Api.listSessions();
  const wrap = document.getElementById('sessionList');
  if (!wrap) return;

  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="big">🎤</div>No sessions yet<br>Start your first coaching session</div>`;
    return;
  }

  const sc = v => v >= 75 ? 'var(--green)' : v >= 50 ? 'var(--cyan)' : 'var(--orange)';

  wrap.innerHTML = list.map(s => {
    const d   = new Date(s.started_at);
    const ds  = d.toLocaleDateString() + '  ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const dur = s.duration_s || 0;
    const dm  = Math.floor(dur/60), dsec = String(dur%60).padStart(2,'0');
    const ov  = s.scores?.overall || 0;
    const words = s.audio?.words || 0;
    const title = s.title || 'Untitled Session';
    return `
      <div class="sess-card">
        <div>
          <div class="sess-date">${ds}</div>
          <div class="sess-title">${title}</div>
          <div style="font-family:var(--font-mono);font-size:8.5px;color:var(--text-dim);margin-top:2px">${words} words · ${s.audio?.fillers||0} fillers</div>
        </div>
        <div class="sess-dur">${dm}:${dsec}</div>
        <div class="sess-actions">
          <button class="icon-btn" onclick="downloadSessionPdf('${s.id}', this)" title="Download PDF">⬇</button>
          <button class="icon-btn red" onclick="deleteSession('${s.id}', this)" title="Delete">✕</button>
        </div>
        <div class="sess-score" style="color:${sc(ov)}">${ov}</div>
      </div>`;
  }).join('');
}

// ── PDF download (FIX: use fetch+blob so JWT is sent) ─
async function downloadSessionPdf(id, btn) {
  const orig = btn.textContent;
  btn.textContent = '…';
  btn.disabled = true;
  try {
    await Api.downloadPdf(id);
  } catch (e) {
    toast('PDF failed: ' + e.message, 'error');
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

async function deleteSession(id, btn) {
  if (!confirm('Delete this session?')) return;
  try {
    await Api.deleteSession(id);
    btn.closest('.sess-card').remove();
    toast('Session deleted', 'info');
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
  }
}

function logout() { Api.logout(); }
