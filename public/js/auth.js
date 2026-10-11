/* Login, signup, forgot-password and reset-password */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const next = API.safeNext(params.get('next'));
  const resetToken = params.get('token') || '';
  const MODES = ['login', 'signup', 'forgot', 'reset'];
  let mode = location.pathname.replace('/', '');
  if (!MODES.includes(mode)) mode = 'login';
  if (mode === 'reset' && !resetToken) mode = 'forgot';

  const form = document.getElementById('authForm');
  const err = document.getElementById('formError');
  const ok = document.getElementById('formOk');
  const btn = document.getElementById('authBtn');
  const pw = form.elements.password;

  const COPY = {
    login: { title: 'Welcome back', sub: 'Log in to continue working on your resumes.', btn: 'Log in', sw: 'New here? <a href="/signup" data-switch="signup">Create a free account</a>', doc: 'Log in', pw: 'Password' },
    signup: { title: 'Create your account', sub: 'Free to use. Build, save and tailor as many resumes as you need.', btn: 'Create account', sw: 'Already have an account? <a href="/login" data-switch="login">Log in</a>', doc: 'Create account', pw: 'Password' },
    forgot: { title: 'Reset your password', sub: 'Enter the email you signed up with and we will send you a link to choose a new password.', btn: 'Send reset link', sw: 'Remembered it? <a href="/login" data-switch="login">Back to log in</a>', doc: 'Forgot password' },
    reset: { title: 'Choose a new password', sub: 'Pick a strong password you have not used here before. You will be logged in right after.', btn: 'Save new password', sw: '<a href="/login" data-switch="login">Back to log in</a>', doc: 'Reset password', pw: 'New password' }
  };

  function setMode(m, push) {
    mode = m;
    const c = COPY[m];
    document.title = `${c.doc} — ResumeForge Pro`;
    document.getElementById('authTitle').textContent = c.title;
    document.getElementById('authSub').textContent = c.sub;
    btn.textContent = c.btn;
    btn.disabled = false;
    document.getElementById('authSwitch').innerHTML = c.sw;
    if (c.pw) document.getElementById('pwFieldLabel').textContent = c.pw;
    document.querySelectorAll('[data-show]').forEach((el) => { el.hidden = !el.dataset.show.split(' ').includes(m); });
    document.querySelector('.auth-tabs').hidden = !(m === 'login' || m === 'signup');
    document.querySelectorAll('.auth-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    pw.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    err.hidden = true;
    ok.hidden = true;
    form.hidden = false;
    if (push) history.replaceState(null, '', '/' + m + (m === 'reset' ? '?token=' + encodeURIComponent(resetToken) : (params.get('next') ? '?next=' + encodeURIComponent(next) : '')));
    const first = m === 'signup' ? form.elements.name : (m === 'reset' ? pw : form.elements.email);
    setTimeout(() => first.focus(), 0);
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-mode], [data-switch]');
    if (!t) return;
    e.preventDefault();
    setMode(t.dataset.mode || t.dataset.switch, true);
  });

  document.getElementById('pwToggle').addEventListener('click', (e) => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    e.target.textContent = show ? 'Hide' : 'Show';
  });

  pw.addEventListener('input', () => {
    const v = pw.value;
    let s = 0;
    if (v.length >= 8) s++;
    if (v.length >= 12) s++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
    if (/\d/.test(v)) s++;
    if (/[^A-Za-z0-9]/.test(v)) s++;
    const levels = [['', 'Use 8+ characters with a mix of letters, numbers and symbols'], ['#dc2626', 'Weak'], ['#f59e0b', 'Fair'], ['#eab308', 'Good'], ['#10b981', 'Strong'], ['#059669', 'Very strong']];
    const lvl = v ? Math.max(1, s) : 0;
    const bar = document.getElementById('pwBar');
    bar.style.width = lvl * 20 + '%';
    bar.style.background = levels[lvl][0];
    document.getElementById('pwLabel').textContent = levels[lvl][1];
  });

  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

  function validate() {
    const f = form.elements;
    if (mode === 'signup' && !f.name.value.trim()) return 'Please enter your name';
    if (mode !== 'reset' && !isEmail(f.email.value.trim())) return 'Please enter a valid email address';
    if (mode === 'login' && !pw.value) return 'Please enter your password';
    if ((mode === 'signup' || mode === 'reset') && pw.value.length < 8) return 'Password must be at least 8 characters';
    if (mode === 'reset' && pw.value !== f.confirm.value) return 'The two passwords do not match';
    return null;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const problem = validate();
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    const f = form.elements;
    const done = UI.busy(btn, { login: 'Logging in…', signup: 'Creating account…', forgot: 'Sending…', reset: 'Saving…' }[mode]);
    try {
      if (mode === 'forgot') {
        const res = await API.post('/api/auth/forgot', { email: f.email.value.trim() });
        ok.innerHTML = `<b>Check your inbox.</b> If an account exists for ${RC_esc(f.email.value.trim())}, we have sent a link to reset your password. It is valid for 30 minutes.` +
          (res.email_enabled ? '' : '<br><br><span class="small">Email is not set up on this server yet, so the reset link has been printed in the <b>server window</b> (the black start.bat window). Open that link in your browser.</span>');
        ok.hidden = false;
        done();
        btn.textContent = 'Send again';
        return;
      }
      if (mode === 'reset') {
        await API.post('/api/auth/reset', { token: resetToken, password: pw.value });
        location.href = '/dashboard';
        return;
      }
      const body = { email: f.email.value.trim(), password: pw.value };
      if (mode === 'signup') body.name = f.name.value.trim();
      await API.post('/api/auth/' + mode, body);
      location.href = next;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      done();
    }
  });

  function RC_esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  setMode(mode, false);
  if (mode === 'login' || mode === 'signup') API.me().then((u) => { if (u) location.replace(next); }).catch(() => {});
})();
