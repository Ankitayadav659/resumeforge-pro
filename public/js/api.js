/* ResumeForge Pro — tiny API client + shared UI helpers */
(function () {
  'use strict';

  async function req(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-RF': '1' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try { res = await fetch(url, opts); }
    catch (e) { const err = new Error('Cannot reach the server. Is it running?'); err.status = 0; throw err; }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const safeNext = (n) => (n && /^\/(?!\/)[\w\-/?=&.%]*$/.test(n) ? n : '/dashboard');

  window.API = {
    get: (u) => req('GET', u),
    post: (u, b) => req('POST', u, b || {}),
    put: (u, b) => req('PUT', u, b || {}),
    del: (u) => req('DELETE', u),
    safeNext,

    /* Returns the logged-in user or null (never redirects). */
    async me() {
      try { return (await req('GET', '/api/auth/me')).user; }
      catch (e) { if (e.status === 401) return null; throw e; }
    },

    /* Returns the user, or sends them to /login and comes back afterwards. */
    async requireUser() {
      const u = await this.me();
      if (!u) {
        location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
        return new Promise(() => {});
      }
      return u;
    },

    async logout() {
      try { await req('POST', '/api/auth/logout', {}); } finally { location.href = '/'; }
    },

    /* Server capabilities: { ai: {enabled, model?, reason?, quota?}, email_enabled } */
    _config: null,
    async config(force) {
      if (!this._config || force) {
        try { this._config = await req('GET', '/api/config'); }
        catch (e) { this._config = { ai: { enabled: false, reason: e.message }, email_enabled: false }; }
      }
      return this._config;
    }
  };

  window.UI = {
    initials(name) {
      return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    },
    ago(ts) {
      const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
      if (s < 60) return 'just now';
      const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
      const h = Math.round(m / 60); if (h < 24) return h + ' hr ago';
      const d = Math.round(h / 24); if (d < 30) return d + ' day' + (d > 1 ? 's' : '') + ' ago';
      return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    },
    toast(msg) {
      let t = document.getElementById('toast');
      if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(UI.toast.t);
      UI.toast.t = setTimeout(() => t.classList.remove('show'), 3400);
    },
    userMenu(user, extra) {
      const e = window.RC ? RC.esc : (s) => s;
      const pro = user.plan === 'pro';
      return `<details class="user-menu"><summary><span class="avatar ${pro ? 'pro' : ''}">${e(UI.initials(user.name))}</span><span class="um-name">${e(user.name.split(' ')[0])}</span></summary>
        <div class="menu-list"><div class="who"><b>${e(user.name)} <span class="plan-chip ${pro ? 'pro' : 'free'}">${pro ? '⭐ Pro' : 'Free'}</span></b><span>${e(user.email)}</span></div>
        <a href="/dashboard">My resumes</a><a href="/settings">Account settings</a>
        <a href="/settings#billing">${pro ? 'Billing' : '⭐ Upgrade to Pro'}</a>${user.is_admin ? '<a href="/admin">Admin panel</a>' : ''}${extra || ''}
        <button data-theme-toggle class="menu-theme"><span class="t-light">🌙 Dark mode</span><span class="t-dark">☀️ Light mode</span></button>
        <hr><button data-logout>Log out</button></div></details>`;
    },
    fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = () => reject(new Error('Could not read the file'));
        fr.readAsDataURL(file);
      });
    },
    /* Spinner markup for buttons while an AI request runs */
    busy(btn, label) {
      if (!btn) return () => {};
      const old = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spin"></span>${label || 'Working…'}`;
      return () => { btn.disabled = false; btn.innerHTML = old; };
    },
    async copy(text) {
      try { await navigator.clipboard.writeText(text); return true; }
      catch (e) {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch (er) { /* ignore */ }
        ta.remove(); return ok;
      }
    }
  };

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-logout]')) { e.preventDefault(); API.logout(); }
    // close open dropdowns when clicking elsewhere
    document.querySelectorAll('details.user-menu[open], details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });
})();
