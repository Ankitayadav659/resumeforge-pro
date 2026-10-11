/* Admin panel */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = RC.esc;
  const inr = (paise) => '₹' + Math.round((paise || 0) / 100).toLocaleString('en-IN');
  const date = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' }) : '—');

  async function loadStats() {
    const s = await API.get('/api/admin/stats');
    const k = [
      ['Total users', s.users, `+${s.users_30d} in 30 days`],
      ['Active (30 days)', s.active_30d, 'logged in recently'],
      ['Pro members', s.pro_active, s.users ? Math.round((s.pro_active / s.users) * 100) + '% of users' : ''],
      ['Revenue (30 days)', inr(s.revenue_30d), `${s.payments_30d} payment(s)`],
      ['Revenue (all time)', inr(s.revenue_total), ''],
      ['Resumes', s.resumes, s.users ? (s.resumes / s.users).toFixed(1) + ' per user' : ''],
      ['AI actions (30 days)', s.ai_30d, ''],
      ['Open messages', s.messages_open, s.messages_open ? 'needs reply' : 'all handled']
    ];
    $('#kpis').innerHTML = k.map(([l, v, sub]) => `<div class="card kpi"><span>${l}</span><b>${esc(v)}</b><small>${esc(sub)}</small></div>`).join('');
    const days = [];
    for (let i = 29; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
    const map = Object.fromEntries(s.signups_by_day.map((d) => [d.day, d.n]));
    const max = Math.max(1, ...days.map((d) => map[d] || 0));
    $('#bars').innerHTML = days.map((d) => `<div class="bar-col" title="${d}: ${map[d] || 0}"><i style="height:${((map[d] || 0) / max) * 100}%"></i></div>`).join('');
  }

  async function loadUsers() {
    const q = $('#q').value.trim();
    const res = await API.get('/api/admin/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
    $('#users').innerHTML = res.users.map((u) => `<tr>
      <td><b>${esc(u.name)}</b><br><span class="muted small">${esc(u.email)}</span></td>
      <td><span class="plan-chip ${u.plan}">${u.plan === 'pro' ? '⭐ Pro' : 'Free'}</span>${u.plan === 'pro' ? `<br><span class="muted small">until ${date(u.plan_expires_at)}</span>` : ''}</td>
      <td>${u.resume_count}</td><td>${inr(u.paid_total)}</td><td>${date(u.created_at)}</td><td>${date(u.last_login_at)}</td>
      <td class="acts"><button class="btn sm" data-grant="${u.id}">+30 days Pro</button>${u.plan === 'pro' ? `<button class="btn sm danger" data-revoke="${u.id}">Revoke</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">No users found.</td></tr>';
  }

  async function loadMessages() {
    const res = await API.get('/api/admin/messages');
    $('#messages').innerHTML = res.messages.map((m) => `<div class="msg ${m.handled ? 'done' : ''}">
      <div class="msg-head"><b>${esc(m.topic)}</b> · ${esc(m.name)} &lt;<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>&gt; <span class="muted small">${new Date(m.created_at).toLocaleString()}</span>
        ${m.handled ? '<span class="badge ok">Handled</span>' : `<button class="btn sm" data-done="${m.id}">Mark handled</button>`}</div>
      <p>${esc(m.message).replace(/\n/g, '<br>')}</p></div>`).join('') || '<p class="muted">No messages yet.</p>';
  }

  document.addEventListener('click', async (e) => {
    const g = e.target.closest('[data-grant]'), r = e.target.closest('[data-revoke]'), d = e.target.closest('[data-done]');
    try {
      if (g) { await API.post(`/api/admin/users/${g.dataset.grant}/plan`, { action: 'grant', days: 30 }); UI.toast('Granted 30 days of Pro.'); loadUsers(); loadStats(); }
      if (r && confirm('Revoke Pro for this user now?')) { await API.post(`/api/admin/users/${r.dataset.revoke}/plan`, { action: 'revoke' }); UI.toast('Pro revoked.'); loadUsers(); loadStats(); }
      if (d) { await API.post(`/api/admin/messages/${d.dataset.done}/done`); loadMessages(); loadStats(); }
    } catch (ex) { UI.toast(ex.message); }
  });
  let t;
  $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadUsers, 250); });
  $('#refresh').addEventListener('click', () => { loadStats(); loadUsers(); loadMessages(); });

  (async function boot() {
    const user = await API.requireUser();
    $('#userSlot').innerHTML = UI.userMenu(user);
    if (!user.is_admin) {
      $('#loading').innerHTML = '<h2>Admins only</h2><p class="muted">Add your email to ADMIN_EMAILS in the server settings to use this page.</p><a class="btn" href="/dashboard">Back to my resumes</a>';
      return;
    }
    await Promise.all([loadStats(), loadUsers(), loadMessages()]);
    $('#loading').hidden = true;
    $('#content').hidden = false;
  })();
})();
