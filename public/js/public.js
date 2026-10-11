/* Public pages: auth-aware navigation and mobile menu behaviour */
(function () {
  'use strict';
  // Close the mobile menu after a link is chosen or when tapping outside it
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.mnav[open]').forEach((d) => {
      if (!d.contains(e.target) || e.target.closest('.mnav-panel a')) d.open = false;
    });
  });

  // Signed-in visitors go straight to their dashboard
  API.me().then((user) => {
    if (!user) return;
    const nav = document.getElementById('navAuth');
    if (nav) nav.innerHTML = '<a class="btn primary" href="/dashboard">My resumes</a>';
    document.querySelectorAll('[data-auth-cta]').forEach((a) => {
      a.href = '/dashboard';
      if (/free|start|create|build/i.test(a.textContent) && !a.dataset.keepText) a.textContent = 'Open my resumes';
    });
  }).catch(() => { /* offline or server down: keep public links */ });
})();
