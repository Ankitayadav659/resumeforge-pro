/* Account settings */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = RC.esc;
  let user = null;

  function msg(form, text, kind) {
    const m = form.querySelector('.msg');
    m.className = 'msg ' + (kind === 'ok' ? 'form-ok' : 'form-error');
    m.innerHTML = text;
    m.hidden = false;
  }

  function renderUser() {
    $('#userSlot').innerHTML = UI.userMenu(user);
    const f = $('#profileForm').elements;
    f.name.value = user.name;
    f.email.value = user.email;
    $('#emailPwRow').hidden = true;
    $('#memberSince').textContent = 'Member since ' + new Date(user.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  async function renderAI() {
    const cfg = await API.config(true);
    const a = cfg.ai;
    $('#aiStatus').innerHTML = a.enabled
      ? `<div class="ai-state on"><span class="dot"></span><div><b>AI is active</b><p class="muted">Model: ${esc(a.model)}. AI can import resumes, write summaries, rewrite bullets, tailor your resume to a job, review it like a recruiter and write cover letters.</p></div></div>
         ${a.quota ? `<div class="quota"><div class="q-head"><span>Today's AI actions</span><b>${a.quota.used} / ${a.quota.limit}</b></div><div class="bar"><i style="width:${Math.min(100, (a.quota.used / a.quota.limit) * 100)}%"></i></div><p class="small muted">The limit resets on a rolling 24-hour basis.</p></div>` : ''}`
      : `<div class="ai-state off"><span class="dot"></span><div><b>AI features are temporarily unavailable</b>
           <p class="muted">Every other feature works as usual, including the built-in Quick draft, Quick review, Impact Builder and cover-letter template.</p>
           ${user.is_admin ? `<p class="muted"><b>Admin:</b> ${esc(a.reason || '')} See README.md → “Turn on AI”.</p>` : ''}</div></div>`;
  }

  async function renderBilling() {
    const [cfg, hist] = await Promise.all([API.config(true), API.get('/api/billing/history').catch(() => ({ payments: [] }))]);
    const pro = user.plan === 'pro';
    const L = user.limits;
    const until = pro && user.plan_expires_at ? new Date(user.plan_expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const daysLeft = pro ? Math.max(0, Math.ceil((user.plan_expires_at - Date.now()) / 864e5)) : 0;
    $('#billingBox').innerHTML = `
      <div class="bill-plan ${pro ? 'pro' : ''}">
        <div><span class="plan-chip ${pro ? 'pro' : 'free'}">${pro ? '⭐ Pro' : 'Free plan'}</span>
          <p>${pro ? `Active until <b>${esc(until)}</b> (${daysLeft} day${daysLeft === 1 ? '' : 's'} left). No auto-renewal.` : 'Free forever. Upgrade any time for more resumes and AI.'}</p>
          <p class="small muted">${L.resumes} resumes · ${L.ai_daily} AI actions/day · ${L.versions} versions per resume${L.branding ? ' · ResumeForge footer on share links' : ' · no branding'}</p></div>
        <button class="btn primary" id="upBtn">${pro ? 'Extend Pro' : '⭐ Upgrade to Pro'}</button>
      </div>
      ${cfg.payments.enabled && cfg.payments.test_mode ? '<p class="small muted">Payments are in test mode.</p>' : ''}
      <h3 class="bill-h">Payment history</h3>
      ${hist.payments.length ? `<table class="bill-tbl"><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Payment ID</th></tr></thead><tbody>
        ${hist.payments.map((p) => `<tr><td>${new Date(p.paid_at || p.created_at).toLocaleDateString()}</td><td>${esc(p.label)}</td><td>${Billing.rupees(p.amount)}</td><td class="mono">${esc(p.payment_id || '—')}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted small">No payments yet.</p>'}
      <p class="small muted">Need an invoice or a refund? <a href="/contact?topic=Billing">Contact us</a> · <a href="/refund">Refund policy</a></p>`;
    $('#upBtn').addEventListener('click', () => Billing.upgradeModal());
  }

  $('#profileForm').addEventListener('input', (e) => {
    if (e.target.name === 'email') $('#emailPwRow').hidden = e.target.value.trim().toLowerCase() === user.email.toLowerCase();
  });

  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements, btn = e.target.querySelector('button[type=submit]');
    const done = UI.busy(btn, 'Saving…');
    try {
      const res = await API.put('/api/account', { name: f.name.value.trim(), email: f.email.value.trim(), password: f.password.value });
      user = res.user;
      f.password.value = '';
      renderUser();
      msg(e.target, 'Profile saved.', 'ok');
    } catch (ex) { msg(e.target, esc(ex.message)); }
    done();
  });

  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements, btn = e.target.querySelector('button[type=submit]');
    if (f.password.value.length < 8) return msg(e.target, 'New password must be at least 8 characters.');
    if (f.password.value !== f.confirm.value) return msg(e.target, 'The new passwords do not match.');
    const done = UI.busy(btn, 'Updating…');
    try {
      await API.post('/api/account/password', { current: f.current.value, password: f.password.value });
      e.target.reset();
      msg(e.target, 'Password updated. Other devices have been signed out.', 'ok');
    } catch (ex) { msg(e.target, esc(ex.message)); }
    done();
  });

  $('#exportBtn').addEventListener('click', async (e) => {
    const done = UI.busy(e.target, 'Preparing…');
    try {
      const data = await API.get('/api/account/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'resumeforge-export-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      UI.toast(`Exported ${data.resumes.length} resume(s).`);
    } catch (ex) { UI.toast(ex.message); }
    done();
  });

  $('#delForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements, btn = e.target.querySelector('button[type=submit]');
    if (f.confirm.value.trim() !== 'DELETE') return msg(e.target, 'Type DELETE in capital letters to confirm.');
    if (!f.password.value) return msg(e.target, 'Enter your password.');
    if (!confirm('Last check: permanently delete your account and all resumes?')) return;
    const done = UI.busy(btn, 'Deleting…');
    try {
      await API.post('/api/account/delete', { password: f.password.value });
      location.href = '/?deleted=1';
    } catch (ex) { msg(e.target, esc(ex.message)); done(); }
  });

  // highlight the section in view
  const links = [...document.querySelectorAll('.set-nav a')];
  window.addEventListener('scroll', () => {
    let current = links[0];
    links.forEach((a) => { const s = $(a.getAttribute('href')); if (s && s.getBoundingClientRect().top < 140) current = a; });
    links.forEach((a) => a.classList.toggle('on', a === current));
  }, { passive: true });

  (async function boot() {
    user = await API.requireUser();
    renderUser();
    $('#loading').hidden = true;
    $('#content').hidden = false;
    renderAI();
    renderBilling();
    if (location.hash) { const t = $(location.hash); if (t) setTimeout(() => t.scrollIntoView(), 50); }
  })();
})();
