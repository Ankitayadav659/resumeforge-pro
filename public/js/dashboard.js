/* Dashboard — list, create, duplicate, share and delete resumes */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = RC.esc;
  const PAGE_W = 794;
  const MODE_ICON = { fresher: '🎓', experienced: '💼', executive: '🏛️' };
  let user = null;
  let resumes = [];
  let newMode = 'experienced';

  function scoreOf(data) {
    try { return RC.analyze(RC.normalize(data), { pages: 1 }).score; } catch (e) { return 0; }
  }
  const scoreClass = (s) => (s >= 85 ? 'ok' : s >= 70 ? 'brand' : s >= 50 ? 'warn' : 'bad');

  /* Errors from the API: a 402 opens the upgrade dialog, anything else shows a toast. */
  function fail(e) {
    if (!Billing.handle(e)) UI.toast(e.message);
    else closeModal();
  }

  async function renderPlan() {
    const cfg = await API.config(true);
    const pro = user.plan === 'pro';
    const L = user.limits;
    const used = cfg.usage ? cfg.usage.resumes : resumes.length;
    const ai = cfg.usage ? cfg.usage.ai : { used: 0, limit: L.ai_daily };
    const pct = (a, b) => Math.min(100, Math.round((a / Math.max(1, b)) * 100));
    const until = pro && user.plan_expires_at ? new Date(user.plan_expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    $('#planBox').innerHTML = `
      <div class="pb-top"><span class="plan-chip ${pro ? 'pro' : 'free'}">${pro ? '⭐ Pro' : 'Free plan'}</span>
        ${pro ? `<span class="muted small">until ${until}</span>` : '<button class="btn primary sm" data-action="upgrade">Upgrade</button>'}</div>
      <div class="meter"><div class="m-head"><span>Resumes</span><b>${used} / ${L.resumes}</b></div><div class="m-bar"><i style="width:${pct(used, L.resumes)}%"></i></div></div>
      <div class="meter"><div class="m-head"><span>AI actions today</span><b>${ai.used} / ${ai.limit}</b></div><div class="m-bar"><i style="width:${pct(ai.used, ai.limit)}%"></i></div></div>`;
  }

  function render() {
    const scores = resumes.map((r) => r.score);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const best = scores.length ? Math.max.apply(null, scores) : 0;
    const views = resumes.reduce((a, r) => a + (r.share_slug ? r.share_views : 0), 0);
    $('#stats').innerHTML = [
      ['Resumes', resumes.length, 'of ' + (user ? user.limits.resumes : 3)],
      ['Average score', scores.length ? avg : '—', scores.length ? '/ 100' : ''],
      ['Best score', scores.length ? best : '—', best >= 85 ? 'Interview-ready' : best ? 'Aim for 85+' : ''],
      ['Share-link views', views, resumes.filter((r) => r.share_slug).length + ' link(s) active']
    ].map(([l, v, s]) => `<div class="stat card"><span>${l}</span><b>${v}</b><small>${s}</small></div>`).join('');

    $('#countLabel').textContent = resumes.length ? `${resumes.length} resume${resumes.length > 1 ? 's' : ''}` : '';

    const create = `<button class="r-card create" data-action="new"><span class="plus">+</span><span class="cc-text"><b>Create new resume</b><small>Start blank, from a sample, or upload your old resume</small></span></button>`;
    $('#grid').innerHTML = create + resumes.map((r) => `
      <article class="r-card" data-id="${r.id}">
        <a class="thumb" href="/editor?id=${r.id}" aria-label="Open ${esc(r.name)}"><div class="thumb-page" id="th-${r.id}"></div>
          <span class="score-pill ${scoreClass(r.score)}">${r.score}<small>/100</small></span></a>
        <div class="r-meta">
          <div class="r-title">
            <a href="/editor?id=${r.id}"><b>${esc(r.name)}</b></a>
            <details class="menu card-menu"><summary class="btn ghost sm" aria-label="More actions">⋯</summary>
              <div class="menu-list">
                <a href="/editor?id=${r.id}">Open editor</a>
                <button data-action="rename" data-id="${r.id}">Rename</button>
                <button data-action="duplicate" data-id="${r.id}">Duplicate &amp; tailor</button>
                <button data-action="share" data-id="${r.id}">Share link…</button>
                <button data-action="backup" data-id="${r.id}">Download backup</button>
                <hr><button data-action="delete" data-id="${r.id}" class="danger-text">Delete</button>
              </div></details>
          </div>
          <div class="r-sub">
            <span class="badge">${MODE_ICON[r.mode] || ''} ${esc(RC.MODES[r.mode] ? RC.MODES[r.mode].label : r.mode)}</span>
            ${r.share_slug ? `<span class="badge brand" title="Share link is on">🔗 ${r.share_views} view${r.share_views === 1 ? '' : 's'}</span>` : ''}
          </div>
          <small class="muted">Edited ${UI.ago(r.updated_at)}</small>
        </div>
      </article>`).join('');

    resumes.forEach((r) => {
      const el = document.getElementById('th-' + r.id);
      const d = RC.normalize(r.data);
      el.className = `page resume tpl-${d.template} mode-${d.mode} thumb-page`;
      el.style.setProperty('--accent', d.accent);
      el.style.setProperty('--rfont', RC.FONTS[d.font].css);
      el.style.setProperty('--fs', d.fontSize + 'pt');
      el.innerHTML = RC.renderResume(d);
    });
    fitThumbs();
  }

  function fitThumbs() {
    document.querySelectorAll('.thumb-page').forEach((el) => {
      el.style.transform = `scale(${el.parentElement.clientWidth / PAGE_W})`;
    });
  }

  async function load() {
    const data = await API.get('/api/resumes');
    resumes = data.resumes.map((r) => Object.assign(r, { score: scoreOf(r.data) }));
    render();
    renderPlan().catch(() => {});
  }

  /* ---------- modals ---------- */
  function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
  function closeModal() { $('#modal').hidden = true; }

  function newModal() {
    newMode = 'experienced';
    openModal(`
      <h2>Create a new resume</h2>
      <p class="muted">Choose your career level. The layout, section order and Recruiter Score checks adapt to it.</p>
      <label class="field"><span>Resume name (only you see this)</span><input id="newName" type="text" value="My Resume" maxlength="120" placeholder="e.g. Data Analyst — Deloitte"></label>
      <p class="label">I am a…</p>
      <div class="mode-cards" id="newModes">${Object.entries(RC.MODES).map(([k, m]) => `
        <button class="mode-card ${k === newMode ? 'on' : ''}" data-action="pick-mode" data-mode="${k}"><span class="mc-ico">${MODE_ICON[k]}</span><b>${m.label}</b><small>${m.blurb}</small></button>`).join('')}</div>
      <div class="upload-hint"><span>Already have a resume?</span><button class="btn sm" data-action="upload">⬆ Upload PDF / Word and auto-fill</button></div>
      <div class="modal-actions">
        <button class="btn" data-action="close">Cancel</button>
        <button class="btn" data-action="create" data-sample="1">Start from a sample</button>
        <button class="btn primary" data-action="create">Start blank</button>
      </div>`);
    setTimeout(() => $('#newName').select(), 30);
  }

  /* ---------- upload an existing resume ---------- */
  let imported = null;

  async function uploadModal() {
    imported = null;
    const cfg = await API.config();
    openModal(`
      <h2>Upload your existing resume</h2>
      <p class="muted">We read your resume and fill every section for you, so you can start polishing instead of retyping.</p>
      <div class="dropzone" id="dropzone" data-action="pick-file" tabindex="0" role="button">
        <div class="dz-ico">📄</div>
        <b>Drop your resume here, or click to browse</b>
        <span class="muted small">PDF, Word (.docx) or .txt, up to 6 MB. ResumeForge backups (.json) work too.</span>
      </div>
      <p class="small muted import-mode">${cfg.ai.enabled
        ? '<span class="ai-tag">✨ AI import</span> Claude reads the layout and maps every section accurately.'
        : '<span class="badge">Smart import</span> Sections are detected automatically. Review each one afterwards.'}</p>
      <div id="importProgress" hidden><ul class="steps-list" id="importSteps"></ul></div>
      <div class="form-error" id="importError" hidden></div>
      <div class="modal-actions"><button class="btn" data-action="close">Cancel</button></div>`);
    const dz = $('#dropzone');
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#importFile').click(); } });
  }

  function setSteps(steps, activeIdx) {
    $('#importProgress').hidden = false;
    $('#importSteps').innerHTML = steps.map((s, i) => `<li class="${i < activeIdx ? 'done' : i === activeIdx ? 'active' : ''}"><span class="st"></span>${s}</li>`).join('');
  }

  async function handleFile(file) {
    const name = file.name.toLowerCase();
    $('#importError').hidden = true;
    if (name.endsWith('.json')) return importBackup(file);
    if (!/\.(pdf|docx|txt)$/.test(name)) {
      $('#importError').textContent = name.endsWith('.doc') ? 'Old .doc files are not supported. Open it in Word and "Save As" .docx or PDF.' : 'Please choose a PDF, .docx or .txt file.';
      $('#importError').hidden = false;
      return;
    }
    if (file.size > 6 * 1024 * 1024) { $('#importError').textContent = 'File is too large (max 6 MB).'; $('#importError').hidden = false; return; }
    const cfg = await API.config();
    const steps = ['Reading file', 'Extracting text', cfg.ai.enabled ? 'AI is mapping your sections' : 'Detecting sections', 'Preparing preview'];
    $('#dropzone').hidden = true;
    setSteps(steps, 0);
    try {
      const body = { filename: file.name };
      if (name.endsWith('.txt')) {
        body.text = await file.text();
      } else {
        body.data_b64 = await UI.fileToBase64(file);
      }
      setSteps(steps, 1);
      if (name.endsWith('.pdf')) {
        try { body.text = await PdfText.extract(await file.arrayBuffer()); }
        catch (e) { if (!cfg.ai.enabled) throw new Error('Could not read this PDF: ' + e.message + ' Try uploading a .docx instead.'); }
      }
      setSteps(steps, 2);
      const res = await API.post('/api/import', body);
      setSteps(steps, 3);
      imported = { fields: res.data, method: res.method, filename: file.name };
      showImportPreview();
    } catch (e) {
      $('#importProgress').hidden = true;
      $('#dropzone').hidden = false;
      $('#importError').textContent = e.message;
      $('#importError').hidden = false;
    }
  }

  function showImportPreview() {
    const f = imported.fields, p = f.personal;
    newMode = f.mode;
    const count = (arr) => arr.length;
    const rows = [
      ['Experience', count(f.experience.filter((e) => e.role || e.company)), 'roles'],
      ['Education', count(f.education), 'entries'],
      ['Projects', count(f.projects), 'projects'],
      ['Skills', RC.allSkills(f).length, 'skills'],
      ['Certifications', count(f.certifications), ''],
      ['Achievements', count(f.achievements), '']
    ];
    const defaultName = (p.fullName ? p.fullName.split(' ')[0] + ' — ' : '') + (p.title || 'Imported resume');
    $('#modalBody').innerHTML = `
      <h2>We found your resume ✓</h2>
      <p class="muted">${imported.method === 'ai' ? 'Imported with AI.' : 'Imported with basic detection.'} Check the summary below, then open it in the editor to review every section.</p>
      <div class="import-card">
        <div class="ic-head"><span class="avatar lg">${RC.esc(UI.initials(p.fullName || '?'))}</span>
          <div><b>${RC.esc(p.fullName || 'Name not found')}</b><span>${RC.esc(p.title || 'No headline found')}</span>
          <small class="muted">${RC.esc([p.email, p.phone, p.location].filter(Boolean).join(' · ') || 'No contact details found')}</small></div></div>
        <div class="ic-grid">${rows.map(([l, n, u]) => `<div class="${n ? '' : 'none'}"><b>${n}</b><span>${l}</span></div>`).join('')}</div>
        ${f.summary ? '' : '<p class="small warn-text">No summary found. You can draft one in the editor with a single click.</p>'}
      </div>
      <label class="field"><span>Resume name</span><input id="newName" type="text" maxlength="120" value="${RC.esc(defaultName)}"></label>
      <p class="label">Career level (detected — change it if needed)</p>
      <div class="mode-cards" id="newModes">${Object.entries(RC.MODES).map(([k, m]) => `
        <button class="mode-card ${k === newMode ? 'on' : ''}" data-action="pick-mode" data-mode="${k}"><span class="mc-ico">${MODE_ICON[k]}</span><b>${m.label}</b></button>`).join('')}</div>
      <div class="modal-actions">
        <button class="btn" data-action="upload">Upload a different file</button>
        <button class="btn primary" data-action="create-imported">Create resume &amp; open editor →</button>
      </div>`;
  }

  async function importBackup(file) {
    try {
      const data = RC.normalize(JSON.parse(await file.text()));
      await API.post('/api/resumes', { name: (data.name || 'Imported resume') + ' (imported)', data });
      closeModal();
      await load();
      UI.toast('Backup imported.');
    } catch (err) {
      if (Billing.handle(err)) { closeModal(); return; }
      $('#importError').textContent = err.status ? err.message : 'That file is not a valid ResumeForge backup.';
      $('#importError').hidden = false;
    }
  }

  function shareModal(r) {
    const url = r.share_slug ? `${location.origin}/r/${r.share_slug}` : '';
    openModal(`
      <h2>Share “${esc(r.name)}”</h2>
      <p class="muted">Anyone with the link can view and download this resume. Your target job description stays private.</p>
      ${r.share_slug ? `
        <div class="share-box"><input id="shareUrl" type="text" readonly value="${esc(url)}"><button class="btn primary" data-action="copy-link">Copy link</button></div>
        <p class="small muted">Viewed ${r.share_views} time${r.share_views === 1 ? '' : 's'} · <a href="${esc(url)}" target="_blank" rel="noopener">Open public page ↗</a></p>
        <div class="modal-actions"><button class="btn danger" data-action="share-off" data-id="${r.id}">Turn off link</button><button class="btn" data-action="close">Done</button></div>`
      : `<div class="modal-actions"><button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="share-on" data-id="${r.id}">Create share link</button></div>`}`);
  }

  const find = (id) => resumes.find((r) => r.id === id);

  function download(name, content) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- actions ---------- */
  const actions = {
    new: newModal,
    close: closeModal,
    'pick-mode': (d) => {
      newMode = d.mode;
      document.querySelectorAll('#newModes .mode-card').forEach((b) => b.classList.toggle('on', b.dataset.mode === d.mode));
    },
    create: async (d, btn) => {
      const name = ($('#newName').value.trim() || 'My Resume').slice(0, 120);
      const data = d.sample ? RC.sample(newMode) : RC.blank(newMode);
      btn.disabled = true;
      try {
        const res = await API.post('/api/resumes', { name: d.sample && name === 'My Resume' ? data.name : name, data });
        location.href = '/editor?id=' + res.resume.id + '&new=1';
      } catch (e) { fail(e); btn.disabled = false; }
    },
    rename: async (d) => {
      const r = find(d.id);
      const n = prompt('Rename resume', r.name);
      if (!n || !n.trim() || n.trim() === r.name) return;
      try { await API.put('/api/resumes/' + r.id, { name: n.trim() }); await load(); UI.toast('Renamed.'); }
      catch (e) { fail(e); }
    },
    duplicate: async (d) => {
      try { const res = await API.post(`/api/resumes/${d.id}/duplicate`); await load(); UI.toast(`Created “${res.resume.name}”. Tailor it for a specific job.`); }
      catch (e) { fail(e); }
    },
    delete: async (d) => {
      const r = find(d.id);
      if (!confirm(`Delete “${r.name}”? This cannot be undone.`)) return;
      try { await API.del('/api/resumes/' + r.id); await load(); UI.toast('Resume deleted.'); }
      catch (e) { fail(e); }
    },
    share: (d) => shareModal(find(d.id)),
    'share-on': async (d) => {
      try { const res = await API.post(`/api/resumes/${d.id}/share`, { enabled: true }); find(d.id).share_slug = res.share_slug; shareModal(find(d.id)); render(); }
      catch (e) { fail(e); }
    },
    'share-off': async (d) => {
      try { await API.post(`/api/resumes/${d.id}/share`, { enabled: false }); const r = find(d.id); r.share_slug = null; r.share_views = 0; closeModal(); render(); UI.toast('Share link turned off.'); }
      catch (e) { fail(e); }
    },
    'copy-link': async () => { const ok = await UI.copy($('#shareUrl').value); UI.toast(ok ? 'Link copied.' : 'Copy failed — select the link and copy it manually.'); },
    backup: (d) => { const r = find(d.id); download(r.name.replace(/[^\w-]+/g, '_') + '.resumeforge.json', JSON.stringify(r.data, null, 2)); },
    upload: () => uploadModal(),
    'pick-file': () => $('#importFile').click(),
    'create-imported': async (d, btn) => {
      const base = RC.blank(newMode);
      const f = imported.fields;
      const data = RC.normalize(Object.assign(base, f, {
        mode: newMode,
        order: RC.MODES[newMode].order.slice(),
        template: newMode === 'executive' ? 'executive' : 'classic',
        font: newMode === 'executive' ? 'garamond' : 'sans',
        personal: Object.assign(base.personal, f.personal)
      }));
      ['experience', 'education', 'skills'].forEach((k) => { if (!data[k].length) data[k] = [RC.make[k]()]; });
      const done = UI.busy(btn, 'Creating…');
      try {
        const name = ($('#newName').value.trim() || 'Imported resume').slice(0, 120);
        const res = await API.post('/api/resumes', { name, data });
        location.href = '/editor?id=' + res.resume.id + '&imported=1';
      } catch (e) { fail(e); done(); }
    },
    upgrade: () => Billing.upgradeModal(),
    reload: () => location.reload()
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const fn = actions[b.dataset.action];
    if (!fn) return;
    e.preventDefault();
    const m = b.closest('details.menu');
    if (m) m.open = false;
    fn(b.dataset, b);
  });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('resize', () => { clearTimeout(fitThumbs.t); fitThumbs.t = setTimeout(fitThumbs, 100); });

  $('#importFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!$('#dropzone')) uploadModal().then(() => handleFile(f));
    else handleFile(f);
  });

  (async function boot() {
    user = await API.requireUser();
    $('#userSlot').innerHTML = UI.userMenu(user);
    const h = new Date().getHours();
    $('#greeting').textContent = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${user.name.split(' ')[0]}`;
    try {
      await load();
      $('#loading').hidden = true;
      $('#content').hidden = false;
      fitThumbs();
      if (!resumes.length) newModal();
    } catch (e) {
      $('#loading').innerHTML = `<p>${esc(e.message)}</p><button class="btn" data-action="reload">Retry</button>`;
    }
  })();
})();
