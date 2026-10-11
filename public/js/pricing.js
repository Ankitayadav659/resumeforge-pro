/* Pricing page: pass selector + checkout */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  let selected = new URLSearchParams(location.search).get('plan') || 'pro_3m';
  let passes = [];
  let user = null;

  function render() {
    const p = passes.find((x) => x.code === selected) || passes[1] || passes[0];
    if (!p) return;
    selected = p.code;
    document.querySelectorAll('.pass-tabs button').forEach((b) => {
      const on = b.dataset.pass === p.code;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
    });
    $('#proAmt').textContent = Billing.rupees(p.amount);
    $('#proPer').textContent = 'for ' + (p.months === 1 ? '1 month' : p.months + ' months');
    const base = passes[0].amount / passes[0].months;
    const save = Math.round((1 - (p.amount / p.months) / base) * 100);
    $('#proSave').innerHTML = p.months > 1 ? `${Billing.rupees(p.per_month)}/month · <b>save ${save}%</b>` : 'Great for a short, focused job hunt';
    if (user && user.plan === 'pro') {
      $('#buyBtn').textContent = 'Extend my Pro pass';
    }
  }

  document.querySelectorAll('.pass-tabs button').forEach((b) => b.addEventListener('click', () => { selected = b.dataset.pass; render(); }));

  $('#buyBtn').addEventListener('click', async (e) => {
    $('#buyErr').hidden = true;
    try { await Billing.checkout(selected, e.currentTarget); }
    catch (err) {
      if (err.message === 'Payment was cancelled.') return;
      $('#buyErr').innerHTML = RC_esc(err.message) + (/set up/.test(err.message) ? ' <a href="/contact">Contact us</a>' : '');
      $('#buyErr').hidden = false;
    }
  });

  function RC_esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  (async function boot() {
    const [cfg, me] = await Promise.all([API.config(), API.me().catch(() => null)]);
    user = me;
    passes = cfg.plans.passes;
    $('#testBanner').hidden = !(cfg.payments.enabled && cfg.payments.test_mode);
    if (user) {
      $('#freeCta').textContent = user.plan === 'pro' ? 'Included in your plan' : 'Your current plan';
      $('#freeCta').href = '/dashboard';
      if (user.plan === 'pro' && user.plan_expires_at) {
        const until = new Date(user.plan_expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        $('.plan-card.pro .plan-top > .muted').innerHTML = `You're on Pro until <b>${until}</b>. Buying again adds time to your pass.`;
      }
    }
    render();
  })();
})();
