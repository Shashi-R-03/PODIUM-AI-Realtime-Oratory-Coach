/* ═══════════════════════════════════════════════════════
   Auth Page Controller — Login / Register / Forgot Password
   ═══════════════════════════════════════════════════════ */

// If already logged in, go to dashboard
if (Api.isLoggedIn()) { window.location.href = 'dashboard.html'; }

// ── Tab switching ──────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.form-pane').forEach(p => p.classList.remove('active'));
  const tabBtn = document.querySelector(`.auth-tab[data-tab="${tab}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  document.getElementById(tab + 'Pane').classList.add('active');
  clearErrors();
}

function switchToForgot() {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.form-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('forgotPane').classList.add('active');
  clearErrors();
}

function clearErrors() {
  document.querySelectorAll('.form-error').forEach(e => e.textContent = '');
  document.querySelectorAll('input').forEach(i => i.classList.remove('err'));
}

function setError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function setFieldErr(inputId, errId, msg) {
  const inp = document.getElementById(inputId);
  const err = document.getElementById(errId);
  if (inp) inp.classList.add('err');
  if (err) err.textContent = msg;
}

// ── LOGIN ──────────────────────────────────────────────
async function handleLogin() {
  clearErrors();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  let valid = true;

  if (!email)    { setFieldErr('loginEmail',    'loginEmailErr', 'Email is required');    valid = false; }
  if (!password) { setFieldErr('loginPassword', 'loginPassErr',  'Password is required'); valid = false; }
  if (!valid) return;

  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'SIGNING IN…';

  try {
    await Api.login(email, password);
    window.location.href = 'dashboard.html';
  } catch (e) {
    setError('loginGlobalErr', e.message);
    btn.disabled = false; btn.textContent = 'SIGN IN';
  }
}

// ── REGISTER — Step 1: send OTP ────────────────────────
async function handleSendRegisterOtp(resend = false) {
  if (!resend) clearErrors();

  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm  = document.getElementById('regConfirm').value;
  let valid = true;

  if (!name || name.length < 2) { setFieldErr('regName',     'regNameErr',    'Name must be at least 2 characters'); valid = false; }
  if (!email || !email.includes('@')) { setFieldErr('regEmail', 'regEmailErr', 'Enter a valid email'); valid = false; }
  if (!password || password.length < 6) { setFieldErr('regPassword', 'regPassErr', 'Password must be at least 6 characters'); valid = false; }
  if (password !== confirm) { setFieldErr('regConfirm', 'regConfirmErr', 'Passwords do not match'); valid = false; }
  if (!valid) return;

  const btn = document.getElementById('sendOtpBtn');
  btn.disabled = true; btn.textContent = 'SENDING…';

  try {
    await Api.sendOtp(email, 'register', name);
    // Show step 2
    document.getElementById('regStep1').style.display = 'none';
    document.getElementById('regStep2').style.display = 'block';
    document.getElementById('regEmailDisplay').textContent = email;
    document.getElementById('regOtp').focus();
    if (resend) toast('New code sent!', 'success', 2500);
  } catch (e) {
    setError('regGlobalErr', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'SEND VERIFICATION CODE';
  }
}

function backToRegStep1() {
  document.getElementById('regStep2').style.display = 'none';
  document.getElementById('regStep1').style.display = 'block';
  document.getElementById('regOtp').value = '';
  clearErrors();
}

// ── REGISTER — Step 2: verify OTP + create account ────
async function handleRegister() {
  clearErrors();
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const otp      = document.getElementById('regOtp').value.trim();

  if (!otp || otp.length !== 6) {
    setFieldErr('regOtp', 'regOtpErr', 'Enter the 6-digit code');
    return;
  }

  const btn = document.getElementById('regBtn');
  btn.disabled = true; btn.textContent = 'CREATING ACCOUNT…';

  try {
    await Api.register(name, email, password, otp);
    window.location.href = 'dashboard.html';
  } catch (e) {
    setError('regStep2GlobalErr', e.message);
    btn.disabled = false; btn.textContent = 'CREATE ACCOUNT';
  }
}

// ── FORGOT PASSWORD — Step 1: send reset OTP ──────────
async function handleSendResetOtp(resend = false) {
  if (!resend) clearErrors();
  const email = document.getElementById('forgotEmail').value.trim();
  if (!email || !email.includes('@')) {
    setFieldErr('forgotEmail', 'forgotEmailErr', 'Enter a valid email');
    return;
  }

  const btn = document.getElementById('sendResetBtn');
  btn.disabled = true; btn.textContent = 'SENDING…';

  try {
    await Api.sendOtp(email, 'reset');
    document.getElementById('forgotStep1').style.display = 'none';
    document.getElementById('forgotStep2').style.display = 'block';
    document.getElementById('forgotEmailDisplay').textContent = email;
    document.getElementById('resetOtp').focus();
    if (resend) toast('New code sent!', 'success', 2500);
  } catch (e) {
    setError('forgotGlobalErr', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'SEND RESET CODE';
  }
}

function backToForgotStep1() {
  document.getElementById('forgotStep2').style.display = 'none';
  document.getElementById('forgotStep1').style.display = 'block';
  document.getElementById('resetOtp').value = '';
  clearErrors();
}

// ── FORGOT PASSWORD — Step 2: verify + set new password
async function handleResetPassword() {
  clearErrors();
  const email      = document.getElementById('forgotEmail').value.trim();
  const otp        = document.getElementById('resetOtp').value.trim();
  const newPass    = document.getElementById('newPassword').value;
  const newConfirm = document.getElementById('newPasswordConfirm').value;
  let valid = true;

  if (!otp || otp.length !== 6) { setFieldErr('resetOtp', 'resetOtpErr', 'Enter the 6-digit code'); valid = false; }
  if (!newPass || newPass.length < 6) { setFieldErr('newPassword', 'newPassErr', 'Password must be at least 6 characters'); valid = false; }
  if (newPass !== newConfirm) { setFieldErr('newPasswordConfirm', 'newPassConfirmErr', 'Passwords do not match'); valid = false; }
  if (!valid) return;

  const btn = document.getElementById('resetBtn');
  btn.disabled = true; btn.textContent = 'RESETTING…';

  try {
    await Api.resetPassword(email, otp, newPass);
    toast('Password reset! Please sign in.', 'success', 4000);
    // Go back to login
    document.getElementById('forgotStep2').style.display = 'none';
    document.getElementById('forgotStep1').style.display = 'block';
    switchTab('login');
  } catch (e) {
    setError('resetGlobalErr', e.message);
    btn.disabled = false; btn.textContent = 'RESET PASSWORD';
  }
}

// ── Enter key support ──────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const active = document.querySelector('.form-pane.active');
  if (!active) return;
  if (active.id === 'loginPane')  handleLogin();
  if (active.id === 'registerPane') {
    const step2Visible = document.getElementById('regStep2').style.display !== 'none';
    if (step2Visible) handleRegister();
    else handleSendRegisterOtp();
  }
  if (active.id === 'forgotPane') {
    const step2Visible = document.getElementById('forgotStep2').style.display !== 'none';
    if (step2Visible) handleResetPassword();
    else handleSendResetOtp();
  }
});
