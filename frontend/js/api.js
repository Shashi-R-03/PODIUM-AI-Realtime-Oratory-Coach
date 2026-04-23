/* ═══════════════════════════════════════════════════════
   API Client — wraps fetch with JWT and base URL
   FIX 1: "Failed to fetch" → proper "Cannot connect" message
   FIX 2: PDF download via fetch+blob (fixes missing JWT header)
   NEW:   OTP send / forgot-password / reset-password calls
   ═══════════════════════════════════════════════════════ */

const API_BASE = 'http://localhost:8000';
const WS_BASE  = 'ws://localhost:8000';

const Api = {
  // ── Token management ──────────────────────────────
  token: () => localStorage.getItem('podium_token'),
  user:  () => {
    try { return JSON.parse(localStorage.getItem('podium_user') || 'null'); } catch { return null; }
  },
  saveAuth(token, user) {
    localStorage.setItem('podium_token', token);
    localStorage.setItem('podium_user', JSON.stringify(user));
  },
  clearAuth() {
    localStorage.removeItem('podium_token');
    localStorage.removeItem('podium_user');
  },
  isLoggedIn: () => !!localStorage.getItem('podium_token'),

  // ── Base fetch ────────────────────────────────────
  async _fetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...opts.headers };
    const token = Api.token();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    } catch (networkErr) {
      // FIX: TypeError = network failure (backend down / CORS preflight fail)
      // Surface a clear message instead of the raw "Failed to fetch"
      throw new Error('Cannot connect to server. Make sure the backend is running on port 8000.');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
    return data;
  },

  get:    (p)    => Api._fetch(p),
  post:   (p, b) => Api._fetch(p, { method: 'POST',   body: JSON.stringify(b) }),
  delete: (p)    => Api._fetch(p, { method: 'DELETE' }),

  // ── Auth ──────────────────────────────────────────
  async register(name, email, password, otp) {
    const data = await Api.post('/auth/register', { name, email, password, otp });
    Api.saveAuth(data.access_token, data.user);
    return data.user;
  },
  async login(email, password) {
    const data = await Api.post('/auth/login', { email, password });
    Api.saveAuth(data.access_token, data.user);
    return data.user;
  },
  logout() { Api.clearAuth(); window.location.href = 'index.html'; },

  // ── OTP / Forgot Password ─────────────────────────
  sendOtp:       (email, purpose, name = '') => Api.post('/auth/send-otp', { email, purpose, name }),
  resetPassword: (email, otp, new_password)  => Api.post('/auth/reset-password', { email, otp, new_password }),

  // ── Sessions ──────────────────────────────────────
  createSession: (title) => Api.post('/sessions/', { title }),
  listSessions:  ()      => Api.get('/sessions/'),
  getSession:    (id)    => Api.get(`/sessions/${id}`),
  deleteSession: (id)    => Api.delete(`/sessions/${id}`),

  // ── Analytics ─────────────────────────────────────
  getOverview: () => Api.get('/analytics/overview'),

  // ── WebSocket ─────────────────────────────────────
  openCoachSocket(sessionId) {
    const token = Api.token();
    return new WebSocket(`${WS_BASE}/ws/coach/${sessionId}?token=${token}`);
  },

  // ── PDF download (FIX: use fetch+blob so JWT header is sent) ──
  async downloadPdf(sessionId) {
    const token = Api.token();
    let res;
    try {
      res = await fetch(`${API_BASE}/reports/${sessionId}/pdf`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch {
      throw new Error('Cannot connect to server.');
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || `PDF error ${res.status}`);
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `podium-report-${sessionId.slice(-6)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  },
};

// ── Guard: redirect to login if not authenticated ──
function requireAuth() {
  if (!Api.isLoggedIn()) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

// ── Toast helper ──────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  let rack = document.getElementById('toast-rack');
  if (!rack) {
    rack = document.createElement('div');
    rack.id = 'toast-rack';
    document.body.appendChild(rack);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  rack.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 350);
  }, duration);
}
