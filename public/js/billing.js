/* Upgrade modal + Razorpay Checkout, shared by pricing, dashboard, editor and settings. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupees = (paise) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');
  let loading = null;

  function loadCheckout() {
    if (window.Razorpay) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => { loading = null; reject(new Error('Could not load the payment window. Check your internet connection.')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function modalEl() {
    let m = document.getElementById('billingModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'billingModal';
      m.className = 'modal-backdrop';
      m.hidden = true;
      m.innerHTML = '<div class="modal wide-ish" id="billingBody"></div>';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-bclose]')) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.hidden) close(); });
    }
    return m;
  }
  function open(html) { const m = modalEl(); m.querySelector('#billingBody').innerHTML = html; m.hidden = false; }
  function close() { const m = document.getElementById('billingModal'); if (m) m.hidden = true; }

  function passCards(passes, selected) {
    const base = passes[0].amount / passes[0].months;
    return passes.map((p) => {
      const save = Math.round((1 - (p.amount / p.months) / base) * 100);
      return `<label class="pass ${p.code === selected ? 'on' : ''}">
        <input type="radio" name="pass" value="${p.code}" ${p.code === selected ? 'checked' : ''}>
        <span class="pass-name">${p.months === 1 ? '1 month' : p.months + ' months'}</span>
        <span class="pass-price">${rupees(p.amount)}</span>
        <span class="pass-sub">${rupees(p.per_month)}/month${save > 0 ? ` · <b>save ${save}%</b>` : ''}</span>
      </label>`;
    }).join('');
  }

  async function upgradeModal(reason) {
    const cfg = await API.config();
    const p = cfg.plans;
    const L = p.limits;
    open(`
      <div class="up-head"><span class="ai-tag">⭐ ResumeForge Pro</span><h2>Unlock more with Pro</h2>
        ${reason ? `<p class="up-reason">${esc(reason)}</p>` : '<p class="muted">Everything in Free, with higher limits for serious job searches.</p>'}</div>
      <ul class="up-list">
        <li><b>${L.pro.resumes} resumes</b> <span>instead of ${L.free.resumes}, so you can tailor one for every application</span></li>
        <li><b>${L.pro.ai_daily} AI actions a day</b> <span>instead of ${L.free.ai_daily}: summaries, rewrites, tailoring, reviews, cover letters</span></li>
        <li><b>No branding</b> <span>on your public share link</span></li>
        <li><b>${L.pro.versions} saved versions</b> <span>per resume in version history</span></li>
      </ul>
      <div class="passes" id="passes">${passCards(p.passes, 'pro_3m')}</div>
      <p class="small muted center">One-time payment via Razorpay: UPI, cards, netbanking and wallets. No auto-renewal. <a href="/refund" target="_blank">7-day refund policy</a>.</p>
      <div class="form-error" id="payErr" hidden></div>
      <div class="modal-actions"><button class="btn" data-bclose>Not now</button><button class="btn primary" id="payBtn">Continue to payment</button></div>`);
    const body = document.getElementById('billingBody');
    body.querySelectorAll('input[name=pass]').forEach((r) => r.addEventListener('change', () => {
      body.querySelectorAll('.pass').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    }));
    document.getElementById('payBtn').addEventListener('click', async (e) => {
      const code = body.querySelector('input[name=pass]:checked').value;
      try { await checkout(code, e.currentTarget); }
      catch (err) { const pe = document.getElementById('payErr'); pe.textContent = err.message; pe.hidden = false; }
    });
  }

  async function checkout(code, btn) {
    const user = await API.me();
    if (!user) { location.href = '/signup?next=' + encodeURIComponent('/pricing?plan=' + code); return; }
    const cfg = await API.config();
    if (!cfg.payments.enabled) throw new Error('Online payments are being set up. Please contact us to upgrade in the meantime.');
    const done = UI.busy(btn, 'Opening payment…');
    try {
      await loadCheckout();
      const order = await API.post('/api/billing/order', { plan: code });
      await new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: order.name,
          description: order.description,
          image: location.origin + '/img/icon-180.png',
          order_id: order.order_id,
          prefill: order.prefill,
          theme: { color: '#2b4fd8' },
          modal: { ondismiss: () => reject(new Error('Payment was cancelled.')) },
          handler: async (resp) => {
            try {
              const res = await API.post('/api/billing/verify', resp);
              resolve(res);
              success(res.user);
            } catch (err) { reject(err); }
          }
        });
        rz.on('payment.failed', (r) => reject(new Error((r && r.error && r.error.description) || 'Payment failed. No money was taken.')));
        rz.open();
      });
    } finally { done(); }
  }

  function success(user) {
    const until = user.plan_expires_at ? new Date(user.plan_expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    open(`<div class="center pay-ok"><div class="ok-ico">✓</div><h2>Welcome to Pro!</h2>
      <p class="muted">Your Pro pass is active${until ? ' until <b>' + esc(until) + '</b>' : ''}. A receipt is available in Account settings → Billing.</p>
      <div class="modal-actions" style="justify-content:center"><button class="btn primary" data-bclose id="okGo">Continue</button></div></div>`);
    document.getElementById('okGo').addEventListener('click', () => {
      if (/\/pricing/.test(location.pathname)) location.href = '/dashboard';
      else location.reload();
    });
  }

  /* Wraps an API call: if the server says an upgrade is needed (HTTP 402), show the upgrade modal. */
  function handle(err) {
    if (err && err.status === 402) { upgradeModal(err.message); return true; }
    return false;
  }

  window.Billing = { upgradeModal, checkout, handle, rupees, passCards, close };
})();
