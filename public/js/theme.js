/* Applies the light/dark theme before the page paints (loaded synchronously in <head>). */
(function () {
  'use strict';
  var KEY = 'rf-theme';
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function effective() {
    var s = stored();
    if (s === 'light' || s === 'dark') return s;
    return media && media.matches ? 'dark' : 'light';
  }
  function apply() {
    var t = effective();
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0c111c' : '#ffffff');
  }

  window.RFTheme = {
    get: effective,
    toggle: function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch (e) { /* storage blocked: theme lasts this page only */ }
      apply();
      return next;
    }
  };

  apply();
  if (media && media.addEventListener) media.addEventListener('change', function () { if (!stored()) apply(); });
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (b) { e.preventDefault(); window.RFTheme.toggle(); }
  });
})();
