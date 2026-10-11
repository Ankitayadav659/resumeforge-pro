/* Landing page: live template previews + auth-aware navigation */
(function () {
  'use strict';
  const PAGE_W = 794;

  function miniResume(el, r) {
    el.className = `page resume tpl-${r.template} mode-${r.mode} mini-page`;
    el.style.setProperty('--accent', r.accent);
    el.style.setProperty('--rfont', RC.FONTS[r.font].css);
    el.style.setProperty('--fs', r.fontSize + 'pt');
    el.innerHTML = RC.renderResume(r);
    fit(el);
  }

  function fit(el) {
    const box = el.parentElement;
    const s = box.clientWidth / PAGE_W;
    el.style.transform = `scale(${s})`;
    box.style.height = Math.round(Math.min(el.offsetHeight, 1123) * s) + 'px';
  }

  // Hero preview
  const hero = RC.sample('experienced');
  hero.template = 'modern';
  hero.accent = '#2b4fd8';
  miniResume(document.getElementById('heroResume'), hero);

  // Template gallery
  const combos = [
    ['classic', 'experienced', '#1f3a5f', 'serif', 'Banking, consulting, government and traditional corporates.'],
    ['modern', 'fresher', '#0f5e64', 'sans', 'Tech, product, startups and campus placements.'],
    ['executive', 'executive', '#1f3a5f', 'garamond', 'Directors, VPs and CXOs. Leads with career highlights.'],
    ['compact', 'experienced', '#7a1f2b', 'helvetica', 'Dense profiles that need to fit more on each page.']
  ];
  const grid = document.getElementById('tplGrid');
  grid.innerHTML = combos.map(([t], i) => `
    <a class="tpl" href="/signup">
      <div class="tpl-frame"><div id="tpl${i}"></div></div>
      <div class="tpl-meta"><b>${RC.TEMPLATES[t].label}</b><span>${combos[i][4]}</span></div>
    </a>`).join('');
  combos.forEach(([t, mode, accent, font], i) => {
    const r = RC.sample(mode);
    Object.assign(r, { template: t, accent, font });
    miniResume(document.getElementById('tpl' + i), r);
  });

  window.addEventListener('resize', () => {
    clearTimeout(fit.t);
    fit.t = setTimeout(() => document.querySelectorAll('.mini-page').forEach(fit), 100);
  });

  if (new URLSearchParams(location.search).get('deleted')) {
    UI.toast('Your account and all its data have been deleted.');
    history.replaceState(null, '', '/');
  }
  // Signed-in navigation is handled by public.js
})();
