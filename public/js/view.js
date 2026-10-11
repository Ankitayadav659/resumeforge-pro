/* Public, read-only shared resume */
(function () {
  'use strict';
  const PAGE_W = 794;
  const $ = (s) => document.querySelector(s);
  const slug = location.pathname.split('/').pop();
  let R = null;

  function fit() {
    const page = $('#page'), box = $('#scaler');
    const s = Math.min(1, ($('#wrap').clientWidth - 24) / PAGE_W);
    page.style.transform = `scale(${s})`;
    box.style.width = PAGE_W * s + 'px';
    box.style.height = page.offsetHeight * s + 'px';
  }

  function baseName() {
    return ((R.personal.fullName || 'Resume').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'Resume') + '_Resume';
  }

  $('#pdfBtn').addEventListener('click', async (e) => {
    const done = UI.busy(e.currentTarget, 'Creating PDF…');
    try {
      await PdfExport.resume(R, baseName());
    } catch (err) {
      const old = document.title;
      document.title = baseName();
      UI.toast('Choose "Save as PDF" in the print dialog.');
      setTimeout(() => { window.print(); document.title = old; }, 250);
    } finally { done(); }
  });
  $('#txtBtn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([RC.toText(R)], { type: 'text/plain;charset=utf-8' }));
    a.download = baseName() + '.txt';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  window.addEventListener('resize', fit);
  window.addEventListener('beforeprint', () => { $('#page').style.transform = 'none'; });
  window.addEventListener('afterprint', fit);

  API.get('/api/public/' + encodeURIComponent(slug)).then((res) => {
    R = RC.normalize(res.resume.data);
    const page = $('#page');
    page.className = `page resume tpl-${R.template} mode-${R.mode}`;
    page.style.setProperty('--accent', R.accent);
    page.style.setProperty('--rfont', RC.FONTS[R.font].css);
    page.style.setProperty('--fs', R.fontSize + 'pt');
    page.innerHTML = RC.renderResume(R);
    const name = R.personal.fullName || 'Resume';
    document.title = `${name}${R.personal.title ? ' — ' + R.personal.title : ''}`;
    $('#who').textContent = name + (R.personal.title ? ' · ' + R.personal.title : '');
    $('#updated').textContent = 'Updated ' + UI.ago(res.resume.updated_at);
    document.querySelector('.view-foot').hidden = res.resume.branding === false;
    $('#loading').hidden = true;
    $('#wrap').hidden = false;
    $('#pdfBtn').hidden = false;
    $('#txtBtn').hidden = false;
    fit();
  }).catch((e) => {
    $('#loading').innerHTML = `<h2>Resume unavailable</h2><p class="muted">${RC.esc(e.message)}</p><a class="btn" href="/">Go to ResumeForge Pro</a>`;
  });
})();
