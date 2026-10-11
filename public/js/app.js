/* ResumeForge Pro — editor controller (server-backed autosave) */
(function (RC) {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = RC.esc;
  const PAGE_W = 794, PAGE_H = 1123; // A4 at 96 dpi

  let R = null;            // the resume being edited
  let meta = {};           // server fields: share_slug, share_views
  const ui = { tab: 'personal', improve: null, pages: 1, xyzTarget: null, ai: false, aiReason: '', aiSummary: null, aiBullets: null, tailorSnap: false };
  const ph = (t) => esc(t).replace(/\[[^\]]{1,40}\]/g, (m) => `<span class="ph">${m}</span>`);
  let renderTimer = null, saveTimer = null;
  const sync = { inFlight: false, dirty: false, failed: false };
  const active = () => R;

  /* ---------------- autosave ---------------- */
  function flash(text, kind) {
    const el = $('#saved');
    el.textContent = text;
    el.className = 'saved ' + (kind || '');
  }

  function queueSave() {
    sync.dirty = true;
    flash('Saving…', '');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }

  async function saveNow() {
    if (sync.inFlight) return; // the running save re-checks `dirty` when it finishes
    if (!sync.dirty) return;
    sync.inFlight = true;
    sync.dirty = false;
    try {
      const res = await API.put('/api/resumes/' + R.id, { name: R.name, data: R });
      R.updatedAt = res.resume.updated_at;
      sync.failed = false;
      if (!sync.dirty) flash('All changes saved', 'ok');
    } catch (e) {
      sync.dirty = true;
      sync.failed = true;
      flash(e.status === 401 ? 'Session expired — log in again' : 'Not saved — retrying…', 'err');
      if (e.status !== 401) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 4000); }
    } finally {
      sync.inFlight = false;
      if (sync.dirty && !sync.failed) saveNow();
    }
  }

  function schedule() {
    queueSave();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { renderPreview(); renderLens(); }, 150);
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  }

  /* ---------------- field helpers ---------------- */
  const input = (path, label, value, ph, cls) =>
    `<label class="field ${cls || ''}"><span>${esc(label)}</span><input type="text" data-path="${path}" value="${esc(value)}" placeholder="${esc(ph || '')}"></label>`;
  const area = (path, label, value, ph, rows, extra) =>
    `<label class="field full"><span>${esc(label)}</span><textarea data-path="${path}" rows="${rows || 4}" placeholder="${esc(ph || '')}" ${extra || ''}>${esc(value)}</textarea></label>`;
  const tip = (html) => `<div class="tip">${html}</div>`;

  /* ---------------- tabs & editor ---------------- */
  function tabs() {
    const r = active();
    return [
      ['personal', 'Profile', '👤'], ['summary', 'Summary', '📝'],
      ['experience', r.mode === 'fresher' ? 'Internships' : 'Experience', '💼'],
      ['education', 'Education', '🎓'], ['projects', 'Projects', '🛠️'], ['skills', 'Skills', '⚡'],
      ['extras', r.mode === 'executive' ? 'Highlights' : 'More', '🏆'], ['design', 'Design', '🎨']
    ];
  }

  function renderTabs() {
    $('#tabs').innerHTML = tabs().map(([k, l, i]) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-action="tab" data-tab="${k}"><span class="ti">${i}</span>${l}</button>`).join('');
  }

  const LIST_CFG = {
    experience: {
      noun: 'role', bullets: true, current: true,
      fields: [['role', 'Job title', 'Senior Software Engineer'], ['company', 'Company', 'Company name'], ['location', 'Location', 'Bengaluru, India'], ['start', 'Start', 'Jan 2022'], ['end', 'End', 'Mar 2024']],
      title: (e) => [e.role, e.company].filter(Boolean).join(' · ')
    },
    education: {
      noun: 'education',
      fields: [['degree', 'Degree / Class', 'B.Tech in Computer Science'], ['institution', 'Institution', 'University / College'], ['location', 'Location', 'City'], ['start', 'Start', '2021'], ['end', 'End', '2025'], ['score', 'CGPA / %', '8.7/10 CGPA']],
      extra: ['details', 'Coursework, honours, thesis (optional)', 'Relevant coursework: DSA, DBMS, OS'],
      title: (e) => [e.degree, e.institution].filter(Boolean).join(' · ')
    },
    projects: {
      noun: 'project', bullets: true,
      fields: [['name', 'Project name', 'Smart Attendance System'], ['tech', 'Tech / tools', 'Python, OpenCV, Flask'], ['link', 'Link', 'github.com/you/project'], ['date', 'Date', '2024']],
      title: (e) => e.name
    },
    skills: {
      noun: 'skill group',
      fields: [['category', 'Category', 'Languages'], ['items', 'Skills (comma separated)', 'Python, SQL, React', 'wide']],
      title: (e) => e.category || e.items.split(',')[0]
    },
    certifications: {
      noun: 'certification',
      fields: [['name', 'Certification', 'AWS Certified Solutions Architect', 'wide'], ['issuer', 'Issuer', 'Amazon Web Services'], ['year', 'Year', '2024']],
      title: (e) => e.name
    },
    achievements: {
      noun: 'achievement',
      fields: [['text', 'Achievement (with a number)', 'Ranked 3rd among 500+ teams in a national hackathon', 'full']],
      title: (e) => e.text.slice(0, 50)
    }
  };

  function statLine(key, i, e) {
    const s = RC.bulletStats(e.bullets, !!e.current);
    if (!s.count) return 'No bullets yet';
    const cls = (a, b) => (a / b >= 0.6 ? 'good' : 'meh');
    return `${s.count} bullet${s.count > 1 ? 's' : ''} · <span class="${cls(s.strong, s.count)}">${s.strong} strong verbs</span> · <span class="${cls(s.num, s.count)}">${s.num} quantified</span>`;
  }

  function improvePanel(key, i, e) {
    const raw = String(e.bullets || '').split('\n');
    const rows = raw.map((l, idx) => ({ l, idx })).filter((x) => x.l.trim());
    if (!rows.length) return `<div class="improve">${tip('Write a few bullets first, then run Recruiter Review.')}</div>`;
    let anyChange = false;
    const items = rows.map(({ l, idx }) => {
      const a = RC.improveBullet(l, !!e.current);
      if (a.changed) anyChange = true;
      const ok = !a.changed && !a.advice.length;
      return `<div class="imp ${ok ? 'imp-ok' : ''}">
        <div class="imp-orig">${esc(a.original)}</div>
        ${a.changed ? `<div class="imp-new"><span>Suggested</span> ${esc(a.improved)} <button class="mini" data-action="apply-line" data-list="${key}" data-idx="${i}" data-line="${idx}">Apply</button></div>` : ''}
        ${a.notes.length ? `<div class="imp-notes">${a.notes.map(esc).join(' · ')}</div>` : ''}
        ${a.advice.length ? `<ul class="imp-adv">${a.advice.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${ok ? '<div class="imp-notes good">✓ Recruiter-ready</div>' : ''}
      </div>`;
    }).join('');
    return `<div class="improve"><div class="improve-head"><b>✨ Recruiter Review</b>${anyChange ? `<button class="mini" data-action="apply-all" data-list="${key}" data-idx="${i}">Apply all rewrites</button>` : ''}</div>
      <p class="muted small">Rewrites fix the wording only. The numbers have to come from you, so never invent metrics.</p>${items}</div>`;
  }

  function aiBulletsPanel(key, i) {
    const res = ui.aiBullets.result;
    const items = (res.bullets || []).map((b, j) => {
      const same = b.improved.trim() === b.original.trim();
      return `<div class="imp ${same ? 'imp-ok' : ''}">
        <div class="imp-orig">${esc(b.original)}</div>
        ${same ? '<div class="imp-notes good">✓ Already strong</div>' : `
        <div class="imp-new ai"><span>AI</span> ${ph(b.improved)} <button class="mini" data-action="ai-bullet-apply" data-list="${key}" data-idx="${i}" data-j="${j}">Apply</button></div>
        ${b.change ? `<div class="imp-notes">${esc(b.change)}</div>` : ''}`}
      </div>`;
    }).join('');
    const hasPh = (res.bullets || []).some((b) => /\[[^\]]+\]/.test(b.improved));
    return `<div class="improve ai-panel"><div class="improve-head"><b>✨ AI rewrite</b>
        <span class="bar-btns"><button class="mini accent" data-action="ai-bullet-apply-all" data-list="${key}" data-idx="${i}">Apply all</button>
        <button class="icon" data-action="ai-bullets-dismiss" title="Close">✕</button></span></div>
      ${hasPh ? '<p class="small muted">Replace the <span class="ph">[highlighted]</span> placeholders with your real numbers before sending. The AI never makes up metrics.</p>' : ''}
      ${items}
      ${(res.tips || []).length ? `<div class="ai-tips"><b>What this entry is missing</b><ul>${res.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    </div>`;
  }

  function listEditor(key) {
    const r = active(), cfg = LIST_CFG[key], items = r[key];
    const html = items.map((e, i) => {
      const k = `${key}.${i}`;
      return `<div class="entry">
        <div class="entry-head">
          <strong>${esc(cfg.title(e) || 'New ' + cfg.noun)}</strong>
          <div class="entry-tools">
            <button class="icon" title="Move up" data-action="move" data-list="${key}" data-idx="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon" title="Move down" data-action="move" data-list="${key}" data-idx="${i}" data-dir="1" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon danger" title="Remove" data-action="remove" data-list="${key}" data-idx="${i}">✕</button>
          </div>
        </div>
        <div class="grid">
          ${cfg.fields.map(([f, l, ph, c]) => input(`${k}.${f}`, l, e[f], ph, c)).join('')}
          ${cfg.current ? `<label class="check"><input type="checkbox" data-path="${k}.current" ${e.current ? 'checked' : ''}> I currently work here</label>` : ''}
        </div>
        ${cfg.extra ? area(`${k}.${cfg.extra[0]}`, cfg.extra[1], e[cfg.extra[0]], cfg.extra[2], 2) : ''}
        ${cfg.bullets ? `
          ${area(`${k}.bullets`, 'Achievements — one per line', e.bullets, 'Reduced report generation time by 60% by automating Excel workflows with Python\nLed a team of 4 to launch …', 5, `data-stats="${k}"`)}
          <div class="bullet-bar">
            <span class="stats" id="stats-${key}-${i}">${statLine(key, i, e)}</span>
            <span class="bar-btns">
              <button class="mini" data-action="xyz" data-list="${key}" data-idx="${i}">＋ Impact Builder</button>
              <button class="mini" data-action="improve" data-list="${key}" data-idx="${i}">${ui.improve === k ? 'Hide review' : 'Quick review'}</button>
              <button class="mini ai-btn" data-action="ai-bullets" data-list="${key}" data-idx="${i}">✨ AI rewrite</button>
            </span>
          </div>
          ${ui.improve === k ? improvePanel(key, i, e) : ''}
          ${ui.aiBullets && ui.aiBullets.key === k ? aiBulletsPanel(key, i) : ''}` : ''}
      </div>`;
    }).join('');
    return html + `<button class="btn add" data-action="add" data-list="${key}">+ Add ${cfg.noun}</button>`;
  }

  const MODE_TIPS = {
    experience: {
      fresher: 'Internships, part-time jobs, freelance work, research assistantships and volunteer roles all count. Use <b>action verb + what you did + measurable result</b>.',
      experienced: 'Put your most recent role first. Give recent roles 4–6 bullets and older ones 2–3. Recruiters at large companies look for <b>scope</b> (team, users, budget) and <b>results</b> (%, ₹, time).',
      executive: 'Open every role with its scope (team size, budget, P&L, geographies), then add 3–4 strategic outcomes. Leave out day-to-day tasks.'
    },
    summary: {
      fresher: 'Keep it to 2–3 lines: degree, key skills, your best proof (a project or internship result) and the role you want. Skip "seeking a challenging position".',
      experienced: 'Keep it to 3–4 lines: title, years of experience, domain expertise, 1–2 quantified wins and what you are known for.',
      executive: 'Use 3–5 lines covering leadership scope, industries, signature transformations with numbers, and the value you bring to a board or CEO.'
    }
  };

  function renderEditor() {
    const r = active(), p = r.personal;
    let h = '';
    switch (ui.tab) {
      case 'personal':
        h = `<h3>Personal details</h3>
          <div class="grid">
            ${input('personal.fullName', 'Full name', p.fullName, 'Priya Mehta', 'wide')}
            ${input('personal.title', 'Target job title / headline', p.title, 'Senior Data Analyst | SQL · Python · Power BI', 'wide')}
            ${input('personal.email', 'Email', p.email, 'firstname.lastname@gmail.com')}
            ${input('personal.phone', 'Phone', p.phone, '+91 98765 43210')}
            ${input('personal.location', 'City, Country', p.location, 'Pune, India')}
            ${input('personal.linkedin', 'LinkedIn URL', p.linkedin, 'linkedin.com/in/yourname')}
            ${input('personal.github', 'GitHub (tech roles)', p.github, 'github.com/yourname')}
            ${input('personal.website', 'Portfolio / website', p.website, 'yourname.dev')}
          </div>
          ${tip('<b>What top recruiters expect:</b> a professional email, a customised LinkedIn URL and your city only. Leave out your full address, photo, date of birth, marital status and religion; global companies avoid these details to prevent bias.')}`;
        break;
      case 'summary': {
        const wc = r.summary.trim() ? r.summary.trim().split(/\s+/).length : 0;
        h = `<h3>${esc(RC.sectionTitles(r).summary)}</h3>
          ${area('summary', 'Summary', r.summary, 'Data Analyst with 4+ years of experience in SQL, Python and Power BI…', 6, 'data-live="summary"')}
          <div class="bullet-bar"><span class="stats" id="sumCount">${wc} words</span>
            <span class="bar-btns"><button class="mini" data-action="draft-summary">Quick draft</button>
            <button class="mini ai-btn" data-action="ai-summary">✨ Write with AI</button></span></div>
          ${ui.aiSummary ? `<div class="ai-box">
            <div class="ai-box-head"><span class="ai-tag">✨ AI suggestion</span><button class="icon" data-action="ai-summary-dismiss" title="Dismiss">✕</button></div>
            <p class="ai-text">${ph(ui.aiSummary.summary)}</p>
            ${ui.aiSummary.why ? `<p class="small muted">${esc(ui.aiSummary.why)}</p>` : ''}
            ${ui.aiSummary.headline ? `<div class="ai-headline"><span class="small muted">Suggested headline</span><b>${esc(ui.aiSummary.headline)}</b></div>` : ''}
            <div class="ai-actions">
              <button class="mini accent" data-action="ai-summary-use">Use this summary</button>
              ${ui.aiSummary.headline ? '<button class="mini" data-action="ai-headline-use">Use headline</button>' : ''}
              <button class="mini" data-action="ai-summary">Try again</button>
            </div></div>` : ''}
          ${tip(MODE_TIPS.summary[r.mode])}
          ${tip('<b>Avoid</b> words like hardworking, team player, passionate, go-getter and self-motivated. Show those qualities with evidence instead.')}`;
        break;
      }
      case 'experience':
        h = `<h3>${esc(RC.sectionTitles(r).experience)}</h3>${tip(MODE_TIPS.experience[r.mode])}${listEditor('experience')}`;
        break;
      case 'education':
        h = `<h3>Education</h3>${tip(r.mode === 'fresher' ? 'Put your highest qualification first. Include your CGPA or percentage if it is 7+/10 or 70%+, plus relevant coursework.' : 'Keep it short: degree, institution and year. Drop Class X/XII once you have a degree and work experience.')}${listEditor('education')}`;
        break;
      case 'projects':
        h = `<h3>${esc(RC.sectionTitles(r).projects)}</h3>${tip(r.mode === 'fresher' ? 'For freshers, projects are your experience. For each one, cover the problem, what you built (your stack) and a result such as users, accuracy, speed or rank.' : 'This section is optional for experienced profiles. Use it for flagship initiatives that are not obvious from your roles.')}${listEditor('projects')}`;
        break;
      case 'skills':
        h = `<h3>${esc(RC.sectionTitles(r).skills)}</h3>${tip('Group your skills into categories. Copy the exact wording from the job description (for example "Power BI", not "PowerBI") so ATS keyword filters match. Avoid rating bars and percentages.')}${listEditor('skills')}`;
        break;
      case 'extras':
        h = `${r.mode === 'executive' ? `<h3>Career Highlights</h3>${tip('Add 3–5 board-level wins with numbers. They appear right below your profile.')}${listEditor('achievements')}` : ''}
          <h3>Certifications</h3>${listEditor('certifications')}
          ${r.mode !== 'executive' ? `<h3>${esc(RC.sectionTitles(r).achievements)}</h3>${tip('Add hackathons, ranks, scholarships, awards and leadership roles. Give each one a number: rank, team size or number of participants.')}${listEditor('achievements')}` : ''}
          <h3>Languages</h3><div class="grid">${input('languages', 'Languages', r.languages, 'English (Fluent), Hindi (Native)', 'full')}</div>`;
        break;
      case 'design':
        h = designTab(r);
        break;
    }
    $('#editor').innerHTML = h;
  }

  function designTab(r) {
    const titles = RC.sectionTitles(r);
    const rec = r.mode === 'executive' ? 'executive' : RC.TARGETS[r.target].template;
    return `<h3>Career level</h3>
      <div class="mode-cards">${Object.entries(RC.MODES).map(([k, m]) => `
        <button class="mode-card ${r.mode === k ? 'on' : ''}" data-action="set-mode" data-mode="${k}"><b>${m.label}</b><small>${m.blurb}</small></button>`).join('')}</div>
      <h3>Target industry</h3>
      <div class="grid"><label class="field full"><span>Recruiter Lens tailors its checks to this industry</span>
        <select data-design="target">${Object.entries(RC.TARGETS).map(([k, t]) => `<option value="${k}" ${r.target === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label></div>
      <h3>Template</h3>
      <div class="tpl-cards">${Object.entries(RC.TEMPLATES).map(([k, t]) => `
        <button class="tpl-card ${r.template === k ? 'on' : ''}" data-action="set-template" data-tpl="${k}">
          <span class="tpl-thumb tpl-thumb-${k}"><i></i><i></i><i></i><i></i></span>
          <b>${t.label}${k === rec ? ' <em>Recommended</em>' : ''}</b><small>${t.note}</small></button>`).join('')}</div>
      <p class="muted small">Every template is single-column with real text. Applicant tracking systems such as Workday, Taleo, Greenhouse and Naukri RMS read this format most reliably.</p>
      <h3>Typography</h3>
      <div class="grid">
        <label class="field"><span>Font</span><select data-design="font">${Object.entries(RC.FONTS).map(([k, f]) => `<option value="${k}" ${r.font === k ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
        <label class="field"><span>Font size: <b id="fsVal">${r.fontSize}pt</b></span><input type="range" min="9" max="12" step="0.25" value="${r.fontSize}" data-design="fontSize"></label>
      </div>
      <h3>Accent colour</h3>
      <div class="swatches">${RC.ACCENTS.map((c) => `<button class="swatch ${r.accent === c ? 'on' : ''}" style="background:${c}" data-action="set-accent" data-color="${c}" title="${c}"></button>`).join('')}</div>
      <h3>Section order</h3>
      <ul class="order">${r.order.map((k, i) => `
        <li class="${r.hidden.includes(k) ? 'off' : ''}">
          <span>${esc(titles[k])}</span>
          <span class="entry-tools">
            <button class="icon" data-action="order" data-idx="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon" data-action="order" data-idx="${i}" data-dir="1" ${i === r.order.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="mini" data-action="toggle-section" data-sec="${k}">${r.hidden.includes(k) ? 'Show' : 'Hide'}</button>
          </span></li>`).join('')}</ul>
      <button class="btn sm" data-action="reset-order">Reset to recommended order</button>`;
  }

  /* ---------------- preview ---------------- */
  function renderPreviewBar() {
    const r = active();
    $('#previewBar').innerHTML = `
      <div class="pb-group">${Object.entries(RC.TEMPLATES).map(([k, t]) => `<button class="chip ${r.template === k ? 'on' : ''}" data-action="set-template" data-tpl="${k}">${t.label}</button>`).join('')}</div>
      <div class="pb-group">${RC.ACCENTS.slice(0, 5).map((c) => `<button class="swatch sm ${r.accent === c ? 'on' : ''}" style="background:${c}" data-action="set-accent" data-color="${c}" title="${c}"></button>`).join('')}</div>
      <span class="pages" id="pageCount"></span>
      <button class="btn primary sm pb-dl" data-action="export-pdf">⬇ Download PDF</button>`;
  }

  function renderPreview() {
    const r = active(), page = $('#page');
    page.className = `page resume tpl-${r.template} mode-${r.mode}`;
    page.style.setProperty('--accent', r.accent);
    page.style.setProperty('--rfont', RC.FONTS[r.font].css);
    page.style.setProperty('--fs', r.fontSize + 'pt');
    page.style.minHeight = '';
    page.innerHTML = RC.renderResume(r);

    const cs = getComputedStyle(page);
    const pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
    const usable = PAGE_H - pt - pb;
    const bodyH = $('.r-body', page).offsetHeight;
    const pages = Math.max(1, Math.ceil((bodyH - 2) / usable));
    ui.pages = pages;
    page.style.minHeight = pages * PAGE_H + 'px';
    for (let k = 1; k < pages; k++) {
      const m = document.createElement('div');
      m.className = 'pbreak';
      m.style.top = pt + k * usable + 'px';
      m.innerHTML = `<span>Page ${k + 1} starts here</span>`;
      page.appendChild(m);
    }
    const pc = $('#pageCount');
    if (pc) pc.textContent = `${pages} page${pages > 1 ? 's' : ''} · A4`;
    fitPreview();
  }

  function fitPreview() {
    const wrap = $('#previewWrap'), page = $('#page'), box = $('#scaler');
    if (!wrap.clientWidth) return;
    const s = Math.min(1, (wrap.clientWidth - 40) / PAGE_W);
    page.style.transform = `scale(${s})`;
    box.style.width = PAGE_W * s + 'px';
    box.style.height = page.offsetHeight * s + 'px';
  }

  /* ---------------- Recruiter Lens ---------------- */
  function renderLensShell() {
    $('#lens').innerHTML = `
      <div id="lensScore"></div>
      <div class="card lens-card">
        <h4>🎯 Match a job description</h4>
        <p class="muted small">Paste the job description you are applying to. We pull out the keywords ATS filters and recruiters will search for.</p>
        <textarea id="jdInput" rows="6" placeholder="Paste the full job description here…">${esc(active().jd)}</textarea>
        <button class="btn ai sm block jd-ai" data-action="ai-tailor">✨ Tailor my resume to this job</button>
        <div id="jdResult"></div>
      </div>
      <div id="lensChecks"></div>`;
  }

  function grade(s) {
    if (s >= 85) return ['Interview-ready', 'g-a'];
    if (s >= 70) return ['Strong — polish a few items', 'g-b'];
    if (s >= 50) return ['Needs work', 'g-c'];
    return ['Getting started', 'g-d'];
  }

  function renderLens() {
    const r = active();
    const a = RC.analyze(r, { pages: ui.pages });
    const [gl, gc] = grade(a.score);
    const msb = document.getElementById('msScore');
    if (msb) { msb.textContent = a.score; msb.className = 'ms-badge ' + gc; }
    const latest = r.experience.find((e) => e.role || e.company);
    const ed = r.education.find((e) => e.degree || e.institution);
    const skills = RC.allSkills(r).slice(0, 6);
    const firstSentence = (r.summary.match(/^[^.!?]+[.!?]?/) || [''])[0];
    const counts = { pass: 0, warn: 0, fail: 0 };
    a.checks.forEach((c) => counts[c.status]++);

    $('#lensScore').innerHTML = `
      <div class="card score-card">
        <div class="ring ${gc}" style="--v:${a.score}"><div><b>${a.score}</b><small>/100</small></div></div>
        <div class="score-text"><div class="score-label">Recruiter Score</div><div class="grade ${gc}">${gl}</div>
          <div class="score-pills"><span class="badge ok">${counts.pass} passed</span><span class="badge warn">${counts.warn} to polish</span>${counts.fail ? `<span class="badge bad">${counts.fail} missing</span>` : ''}</div></div>
      </div>
      <div class="card lens-card six">
        <h4>👁️ Recruiter's 6-second scan</h4>
        <p class="muted small">Recruiters often decide in seconds. This is what they take away from your resume:</p>
        <dl>
          <dt>Who</dt><dd>${esc(r.personal.fullName || '—')}${r.personal.title ? ' — ' + esc(r.personal.title) : ' <em class="bad">no headline</em>'}</dd>
          <dt>${r.mode === 'fresher' ? 'Education' : 'Now'}</dt><dd>${r.mode === 'fresher'
            ? (ed ? esc([ed.degree, ed.institution, ed.score].filter(Boolean).join(', ')) : '<em class="bad">missing</em>')
            : (latest ? esc([latest.role, latest.company].filter(Boolean).join(' at ')) : '<em class="bad">missing</em>')}</dd>
          ${r.mode !== 'fresher' ? `<dt>Experience</dt><dd>${a.years ? a.years + '+ years' : '<em class="bad">dates unclear</em>'}</dd>` : ''}
          <dt>Skills</dt><dd>${skills.length ? esc(skills.join(', ')) : '<em class="bad">none listed</em>'}</dd>
          <dt>Hook</dt><dd>${firstSentence ? esc(firstSentence) : '<em class="bad">no summary</em>'}</dd>
        </dl>
      </div>`;

    const order = { fail: 0, warn: 1, pass: 2 };
    const icon = { fail: '✕', warn: '!', pass: '✓' };
    const sorted = a.checks.slice().sort((x, y) => order[x.status] - order[y.status]);
    const fixes = counts.warn + counts.fail;
    $('#lensChecks').innerHTML = `<div class="card lens-card"><h4>✅ Checklist <span class="muted small">${fixes ? fixes + ' to improve' : 'all clear'}</span></h4>
      <ul class="checks">${sorted.map((c) => `<li class="chk s-${c.status}"><span class="ico">${icon[c.status]}</span><div><b>${esc(c.label)}</b><p>${esc(c.detail)}</p>
        ${c.tips.length ? `<ul>${c.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div></li>`).join('')}</ul></div>`;

    const jd = a.jd;
    $('#jdResult').innerHTML = !jd ? '' : `
      <div class="jd-head"><b>${jd.pct}% keyword match</b><span class="muted">${jd.matched.length}/${jd.keywords.length}</span></div>
      <div class="bar ${jd.pct >= 70 ? 'good' : ''}"><i style="width:${jd.pct}%"></i></div>
      ${jd.missing.length ? `<p class="muted small">Missing keywords. Click one to add it to Skills, <b>but only if you genuinely have it</b>. You can also work it into a bullet.</p>
        <div class="chips">${jd.missing.map((k) => `<button class="kw miss" data-action="add-kw" data-kw="${esc(k)}">+ ${esc(k)}</button>`).join('')}</div>` : ''}
      ${jd.matched.length ? `<p class="muted small">Already on your resume:</p><div class="chips">${jd.matched.map((k) => `<span class="kw hit">${esc(k)}</span>`).join('')}</div>` : ''}
      <p class="muted small">Aim for 70% or more, and make your headline match the job title in the posting.</p>`;
  }

  function renderAll() {
    $('#resumeName').value = R.name;
    document.title = `${R.name} — ResumeForge Pro`;
    renderTabs();
    renderEditor();
    renderPreviewBar();
    renderPreview();
    renderLensShell();
    renderLens();
  }

  /* ---------------- modals ---------------- */
  function openModal(html, size) {
    const m = $('#modalBody');
    m.className = 'modal' + (size ? ' ' + size : '');
    m.innerHTML = html;
    $('#modal').hidden = false;
    m.scrollTop = 0;
  }
  function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }

  function xyzModal(list, idx) {
    ui.xyzTarget = { list, idx };
    const groups = Object.entries(RC.ACTION_VERBS).map(([g, vs]) => `<optgroup label="${g}">${vs.map((v) => `<option>${v}</option>`).join('')}</optgroup>`).join('');
    openModal(`
      <h2>Impact Builder</h2>
      <p class="muted">Use the formula recruiters at top companies recommend: <b>accomplished [X], as measured by [Y], by doing [Z]</b>.</p>
      <div class="grid">
        <label class="field"><span>1. Action verb</span><select id="xVerb">${groups}</select></label>
        <label class="field"><span>2. What did you impact?</span><input id="xWhat" type="text" placeholder="page load time of the checkout app"></label>
        <label class="field"><span>3. Measurable result</span><input id="xRes" type="text" placeholder="by 45% (3.2s → 1.7s)"></label>
        <label class="field"><span>4. How did you do it?</span><input id="xHow" type="text" placeholder="implementing lazy loading and CDN caching"></label>
      </div>
      <div class="xyz-preview" id="xPrev">Your bullet will appear here…</div>
      <div class="modal-actions"><button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" data-action="xyz-insert">Add bullet</button></div>`);
    $('#xVerb').value = 'Reduced';
  }

  function xyzText() {
    const v = $('#xVerb').value, w = $('#xWhat').value.trim(), y = $('#xRes').value.trim(), z = $('#xHow').value.trim();
    if (!w) return '';
    let howPart = '';
    if (z) howPart = /^(by|through|using|via|with)\b/i.test(z) ? ' ' + z : ' by ' + z;
    return `${v} ${w}${y ? ' ' + y : ''}${howPart}`.replace(/\s+/g, ' ');
  }

  function shareModal() {
    const url = meta.share_slug ? `${location.origin}/r/${meta.share_slug}` : '';
    openModal(`
      <h2>Share your resume</h2>
      <p class="muted">Anyone with the link can view and download this resume as a PDF. Your target job description stays private.</p>
      ${meta.share_slug ? `
        <div class="share-box"><input id="shareUrl" type="text" readonly value="${esc(url)}"><button class="btn primary" data-action="copy-link">Copy link</button></div>
        <p class="small muted">Viewed ${meta.share_views} time${meta.share_views === 1 ? '' : 's'} · <a href="${esc(url)}" target="_blank" rel="noopener">Open public page ↗</a></p>
        <div class="modal-actions"><button class="btn danger" data-action="share-off">Turn off link</button><button class="btn" data-action="close-modal">Done</button></div>`
      : `<div class="modal-actions"><button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" data-action="share-on">Create share link</button></div>`}`);
  }

  /* ---------------- AI ---------------- */
  function aiUnavailableModal() {
    openModal(`
      <h2>AI is temporarily unavailable</h2>
      <p class="muted">Please try again a little later. Your resume is saved.</p>
      <div class="tip">All the built-in tools keep working without AI: <b>Quick draft</b> for summaries, <b>Quick review</b> for bullets, the <b>Impact Builder</b>, the keyword matcher and the cover-letter template.</div>
      ${ui.isAdmin ? `<p class="small muted"><b>Admin:</b> ${esc(ui.aiReason || '')} Add the Anthropic API key to the server settings and restart. See README.md → “Turn on AI”.</p>` : ''}
      <div class="modal-actions"><button class="btn primary" data-action="close-modal">Got it</button></div>`);
  }

  async function aiCall(path, body, btn, label) {
    if (!ui.ai) { aiUnavailableModal(); return null; }
    await flushSave();
    const done = UI.busy(btn, label || 'AI is working…');
    try {
      const res = await API.post('/api/ai/' + path, Object.assign({ resume: R }, body || {}));
      ui.quota = res.quota;
      return res.result;
    } catch (e) {
      if (e.status === 503) { ui.ai = false; ui.aiReason = e.message; aiUnavailableModal(); }
      else if (!Billing.handle(e)) UI.toast(e.message);
      return null;
    } finally { done(); }
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    if (sync.dirty) await saveNow();
    while (sync.inFlight) await new Promise((r) => setTimeout(r, 80));
  }

  async function snapshotVersion(reason) {
    try { await flushSave(); await API.post(`/api/resumes/${R.id}/versions`, { reason }); } catch (e) { /* non-blocking */ }
  }

  const normLine = (s) => String(s).replace(/^\s*[-•*·▪●]\s*/, '').trim().toLowerCase();

  function replaceBullet(original, improved) {
    const target = normLine(original);
    for (const list of ['experience', 'projects']) {
      for (const e of R[list]) {
        const ls = String(e.bullets || '').split('\n');
        const idx = ls.findIndex((l) => normLine(l) === target);
        if (idx >= 0) { ls[idx] = improved; e.bullets = ls.join('\n'); return true; }
      }
    }
    return false;
  }

  function reviewModal(res) {
    const s = Math.max(0, Math.min(100, res.score | 0));
    const [gl, gc] = grade(s);
    const pri = { high: 'bad', medium: 'warn', low: 'brand' };
    openModal(`
      <div class="ai-modal-head"><span class="ai-tag">✨ AI recruiter review</span></div>
      <div class="rev-top">
        <div class="ring ${gc}" style="--v:${s}"><div><b>${s}</b><small>/100</small></div></div>
        <div><div class="grade ${gc}">${gl}</div><p>${esc(res.verdict)}</p></div>
      </div>
      <div class="rev-block"><h4>👁️ First impression</h4><p>${esc(res.first_impression)}</p></div>
      ${(res.strengths || []).length ? `<div class="rev-block"><h4>✅ What works</h4><ul>${res.strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="rev-block"><h4>🛠️ Fix these first</h4>
        <ol class="fix-list">${(res.fixes || []).map((f) => `<li><span class="badge ${pri[f.priority] || ''}">${esc(f.priority)}</span><div><b>${esc(f.issue)}</b><p>${ph(f.fix)}</p></div></li>`).join('')}</ol></div>
      <div class="rev-block odds"><h4>🎯 Shortlist odds</h4><p>${esc(res.shortlist_odds)}</p></div>
      <div class="modal-actions">${quotaNote()}<button class="btn primary" data-action="close-modal">Done</button></div>`, 'wide');
  }

  function tailorModal(res) {
    ui.tailorSnap = false;
    ui.tailorRes = res;
    const s = Math.max(0, Math.min(100, res.match_score | 0));
    openModal(`
      <div class="ai-modal-head"><span class="ai-tag">✨ Tailored to this job</span></div>
      <div class="rev-top">
        <div class="ring ${s >= 75 ? 'g-a' : s >= 55 ? 'g-b' : 'g-c'}" style="--v:${s}"><div><b>${s}</b><small>match</small></div></div>
        <div><p>${esc(res.verdict)}</p></div>
      </div>
      ${res.headline ? `<div class="sug"><div class="sug-head"><b>Headline</b><button class="mini accent" data-action="tailor-apply" data-what="headline">Apply</button></div><p>${esc(res.headline)}</p></div>` : ''}
      ${res.summary ? `<div class="sug"><div class="sug-head"><b>Summary</b><button class="mini accent" data-action="tailor-apply" data-what="summary">Apply</button></div><p>${ph(res.summary)}</p></div>` : ''}
      ${(res.skills_to_add || []).length ? `<div class="sug"><div class="sug-head"><b>Skills you seem to have but haven't listed</b></div>
        <div class="chips">${res.skills_to_add.map((k) => `<button class="kw miss" data-action="add-kw" data-kw="${esc(k)}">+ ${esc(k)}</button>`).join('')}</div></div>` : ''}
      ${(res.keywords_missing || []).length ? `<div class="sug"><div class="sug-head"><b>Requirements with no evidence on your resume</b></div>
        <p class="small muted">Only add these if they are true for you, ideally as a bullet that proves them.</p>
        <div class="chips">${res.keywords_missing.map((k) => `<span class="kw gap">${esc(k)}</span>`).join('')}</div></div>` : ''}
      ${(res.bullet_changes || []).length ? `<div class="sug"><div class="sug-head"><b>Bullets to reword for this job</b><button class="mini" data-action="tailor-apply" data-what="all-bullets">Apply all</button></div>
        ${res.bullet_changes.map((b, j) => `<div class="imp" id="tb-${j}"><div class="imp-orig">${esc(b.original)}</div>
          <div class="imp-new ai"><span>New</span> ${ph(b.suggested)} <button class="mini" data-action="tailor-apply" data-what="bullet" data-j="${j}">Apply</button></div>
          <div class="imp-notes">${esc(b.reason)}</div></div>`).join('')}</div>` : ''}
      ${(res.tips || []).length ? `<div class="sug"><div class="sug-head"><b>Next steps</b></div><ul class="tips-ul">${res.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      <div class="modal-actions">${quotaNote()}<button class="btn primary" data-action="close-modal">Done</button></div>`, 'wide');
  }

  function quotaNote() {
    return ui.quota ? `<span class="quota-note">${ui.quota.remaining} AI actions left today</span>` : '';
  }

  async function beforeTailorChange() {
    if (!ui.tailorSnap) { ui.tailorSnap = true; await snapshotVersion('Before AI tailoring'); }
  }

  /* ---------------- cover letter ---------------- */
  function clState() {
    if (!R.coverLetter || typeof R.coverLetter !== 'object') R.coverLetter = { company: '', role: '', manager: '', tone: 'professional', subject: '', body: '' };
    return R.coverLetter;
  }

  function coverLetterModal() {
    const c = clState();
    const hasJd = !!R.jd.trim();
    openModal(`
      <h2>Cover letter</h2>
      <p class="muted">A tailored cover letter built from your resume${hasJd ? ' and the job description in Recruiter Lens' : ''}. It saves with this resume.</p>
      <div class="grid">
        <label class="field"><span>Company</span><input type="text" data-cl="company" value="${esc(c.company)}" placeholder="e.g. Deloitte India"></label>
        <label class="field"><span>Role</span><input type="text" data-cl="role" value="${esc(c.role || R.personal.title)}" placeholder="e.g. Senior Data Analyst"></label>
        <label class="field"><span>Addressed to</span><input type="text" data-cl="manager" value="${esc(c.manager)}" placeholder="Hiring Manager"></label>
        <label class="field"><span>Tone</span><select data-cl="tone">
          ${[['professional', 'Professional'], ['enthusiastic', 'Enthusiastic'], ['concise', 'Short & direct']].map(([v, l]) => `<option value="${v}" ${c.tone === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <p class="small ${hasJd ? 'ok-text' : 'muted'} cl-jd">${hasJd ? '✓ Using the job description from Recruiter Lens.' : 'Tip: paste the job description in Recruiter Lens (the Score panel) for a much more targeted letter.'}</p>
      <div class="cl-gen">
        <button class="btn ai" data-action="cl-ai">✨ Write with AI</button>
        <button class="btn" data-action="cl-template">Use template</button>
      </div>
      ${c.subject ? `<p class="small muted cl-subject">Email subject: <b>${esc(c.subject)}</b></p>` : ''}
      <label class="field full"><span>Letter (you can edit it)</span><textarea id="clBody" data-cl="body" rows="14" placeholder="Click “Write with AI” or “Use template” to generate a first draft…">${esc(c.body)}</textarea></label>
      <div class="modal-actions">
        <button class="btn ghost" data-action="close-modal">Close</button>
        <span class="spacer"></span>
        <button class="btn" data-action="cl-copy">Copy</button>
        <button class="btn" data-action="cl-doc">Word</button>
        <button class="btn" data-action="cl-txt">Text</button>
        <button class="btn primary" data-action="cl-pdf">Download PDF</button>
      </div>`, 'wide');
  }

  function letterHtml() {
    const c = clState(), p = R.personal;
    const contact = [p.phone, p.email, p.location, (p.linkedin || '').replace(/^https?:\/\//, '')].filter(Boolean).map(esc).join(' | ');
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const paras = String(c.body || '').trim().split(/\n\s*\n/).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
    return `<div class="lt-head"><h1>${esc(p.fullName || '')}</h1>${p.title ? `<div class="lt-title">${esc(p.title)}</div>` : ''}<div class="lt-contact">${contact}</div></div>
      <div class="lt-date">${date}</div><div class="lt-body">${paras}</div>`;
  }

  /* ---------------- version history ---------------- */
  const REASON_LABEL = { autosave: 'Auto-saved version' };

  async function historyModal() {
    openModal(`<h2>Version history</h2><p class="muted">Snapshots are saved automatically while you edit (at most every 10 minutes) and before AI changes or restores. The latest 40 are kept.</p>
      <div class="loader small-loader"><div class="spinner"></div></div>`, 'wide');
    await flushSave();
    try {
      const res = await API.get(`/api/resumes/${R.id}/versions`);
      const list = res.versions;
      $('#modalBody').innerHTML = `
        <h2>Version history</h2>
        <p class="muted">Snapshots are saved automatically while you edit (at most every 10 minutes) and before AI changes or restores. The latest 40 are kept.</p>
        <div class="hist">
          <div class="hist-list">
            <div class="hist-item current"><b>Current version</b><span class="small muted">Edited ${UI.ago(R.updatedAt || Date.now())}</span></div>
            ${list.length ? list.map((v) => `
              <div class="hist-item" data-vid="${v.id}">
                <div><b>${esc(REASON_LABEL[v.reason] || v.reason)}</b><span class="small muted">${new Date(v.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${UI.ago(v.created_at)}</span></div>
                <span class="hist-btns"><button class="mini" data-action="hist-preview" data-vid="${v.id}">Preview</button><button class="mini accent" data-action="hist-restore" data-vid="${v.id}">Restore</button></span>
              </div>`).join('') : '<p class="small muted empty-hist">No earlier versions yet. Keep editing and they will appear here.</p>'}
          </div>
          <div class="hist-preview" id="histPreview"><div class="muted small center-msg">Select “Preview” to see an earlier version here.</div></div>
        </div>
        <div class="modal-actions"><button class="btn" data-action="hist-save">Save a named version now</button><button class="btn primary" data-action="close-modal">Close</button></div>`;
    } catch (e) { UI.toast(e.message); closeModal(); }
  }

  /* ---------------- exports ---------------- */
  function fileBase(r) {
    return ((r.personal.fullName || r.name || 'Resume').trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_') || 'Resume') + '_Resume';
  }
  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function printPdf() {
    const old = document.title;
    document.title = fileBase(R);
    UI.toast('In the print dialog, choose "Save as PDF", set paper to A4 and margins to Default, and turn off headers & footers.');
    setTimeout(() => { window.print(); document.title = old; }, 300);
  }

  async function exportPdf(btn) {
    const done = UI.busy(btn && btn.closest('.menu-list') ? null : btn, 'Creating PDF…');
    try {
      await PdfExport.resume(R, fileBase(R));
      UI.toast('PDF downloaded. Its text is selectable, so ATS systems can read it.');
    } catch (e) {
      UI.toast(e.message + ' Opening the print dialog instead.');
      printPdf();
    } finally { done(); }
  }

  /* ---------------- actions ---------------- */
  const actions = {
    tab: (d) => { ui.tab = d.tab; ui.improve = null; renderTabs(); renderEditor(); $('#editor').scrollTop = 0; },
    add: (d) => { active()[d.list].push(RC.make[d.list]()); renderEditor(); schedule(); },
    remove: (d) => {
      const list = active()[d.list], e = list[+d.idx];
      const filled = Object.entries(e).some(([k, v]) => k !== 'id' && typeof v === 'string' && v.trim());
      if (filled && !confirm('Remove this entry?')) return;
      list.splice(+d.idx, 1);
      ui.improve = null;
      renderEditor(); schedule();
    },
    move: (d) => {
      const list = active()[d.list], i = +d.idx, j = i + +d.dir;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      ui.improve = null;
      renderEditor(); schedule();
    },
    improve: (d) => { const k = `${d.list}.${d.idx}`; ui.improve = ui.improve === k ? null : k; renderEditor(); },
    'apply-line': (d) => {
      const e = active()[d.list][+d.idx];
      const ls = String(e.bullets).split('\n');
      ls[+d.line] = RC.improveBullet(ls[+d.line], !!e.current).improved;
      e.bullets = ls.join('\n');
      renderEditor(); schedule();
    },
    'apply-all': (d) => {
      const e = active()[d.list][+d.idx];
      e.bullets = String(e.bullets).split('\n').map((l) => (l.trim() ? RC.improveBullet(l, !!e.current).improved : l)).join('\n');
      renderEditor(); schedule();
      UI.toast('Wording improved. Now add real numbers wherever the review asks for them.');
    },
    xyz: (d) => xyzModal(d.list, d.idx),
    'xyz-insert': () => {
      const t = xyzText();
      if (!t) { UI.toast('Fill in at least "What did you impact?"'); return; }
      const e = active()[ui.xyzTarget.list][+ui.xyzTarget.idx];
      e.bullets = (String(e.bullets).trim() ? String(e.bullets).replace(/\s+$/, '') + '\n' : '') + t;
      closeModal(); renderEditor(); schedule();
    },
    'draft-summary': () => {
      const r = active();
      if (r.summary.trim() && !confirm('Replace your current summary with a new draft?')) return;
      r.summary = RC.draftSummary(r);
      renderEditor(); schedule();
      UI.toast('Draft created from your resume. Fill in any [brackets] and make it your own.');
    },
    'set-template': (d) => { active().template = d.tpl; renderPreviewBar(); if (ui.tab === 'design') renderEditor(); schedule(); },
    'set-accent': (d) => { active().accent = d.color; renderPreviewBar(); if (ui.tab === 'design') renderEditor(); schedule(); },
    'set-mode': (d) => {
      const r = active();
      if (r.mode === d.mode) return;
      r.mode = d.mode;
      r.order = RC.MODES[d.mode].order.slice();
      r.hidden = [];
      if (d.mode === 'executive') r.template = 'executive';
      else if (r.template === 'executive') r.template = RC.TARGETS[r.target].template;
      renderAll(); schedule();
      UI.toast('Switched to ' + RC.MODES[d.mode].label + '. Sections are reordered for this level.');
    },
    order: (d) => {
      const o = active().order, i = +d.idx, j = i + +d.dir;
      if (j < 0 || j >= o.length) return;
      [o[i], o[j]] = [o[j], o[i]];
      renderEditor(); schedule();
    },
    'toggle-section': (d) => {
      const h = active().hidden, i = h.indexOf(d.sec);
      if (i >= 0) h.splice(i, 1); else h.push(d.sec);
      renderEditor(); schedule();
    },
    'reset-order': () => { const r = active(); r.order = RC.MODES[r.mode].order.slice(); r.hidden = []; renderEditor(); schedule(); },
    'add-kw': (d) => {
      const r = active();
      let row = r.skills[r.skills.length - 1];
      if (!row) { row = RC.make.skills(); r.skills.push(row); }
      row.items = row.items.trim() ? row.items.replace(/[,\s]+$/, '') + ', ' + d.kw : d.kw;
      if (ui.tab === 'skills') renderEditor();
      schedule();
      UI.toast(`Added "${d.kw}" to Skills. Remove it if it does not genuinely apply to you.`);
    },
    share: () => shareModal(),
    'share-on': async () => {
      try { const res = await API.post(`/api/resumes/${R.id}/share`, { enabled: true }); meta.share_slug = res.share_slug; meta.share_views = 0; shareModal(); }
      catch (e) { UI.toast(e.message); }
    },
    'share-off': async () => {
      try { await API.post(`/api/resumes/${R.id}/share`, { enabled: false }); meta.share_slug = null; closeModal(); UI.toast('Share link turned off.'); }
      catch (e) { UI.toast(e.message); }
    },
    'copy-link': async () => { const ok = await UI.copy($('#shareUrl').value); UI.toast(ok ? 'Link copied.' : 'Copy failed. Select the link and copy it manually.'); },
    'export-pdf': (d, btn) => exportPdf(btn),
    'print-pdf': () => printPdf(),
    'export-doc': () => { download(fileBase(R) + '.doc', RC.toWord(R), 'application/msword'); UI.toast('Word file downloaded. It opens in MS Word and Google Docs.'); },
    'export-txt': () => { download(fileBase(R) + '.txt', RC.toText(R), 'text/plain;charset=utf-8'); UI.toast('Plain-text version downloaded. Paste it into job portal forms.'); },
    'export-json': () => { download(fileBase(R) + '.resumeforge.json', JSON.stringify(R, null, 2), 'application/json'); UI.toast('Backup downloaded.'); },
    /* --- AI: summary --- */
    'ai-summary': async (d, btn) => {
      const res = await aiCall('summary', { jd: R.jd }, btn, 'Writing…');
      if (res) { ui.aiSummary = res; renderEditor(); }
    },
    'ai-summary-use': async () => {
      await snapshotVersion('Before AI summary');
      R.summary = ui.aiSummary.summary;
      ui.aiSummary = null;
      renderEditor(); schedule();
      UI.toast('Summary updated. Replace any [placeholders] with real numbers.');
    },
    'ai-headline-use': () => {
      R.personal.title = ui.aiSummary.headline;
      UI.toast('Headline updated.');
      schedule();
    },
    'ai-summary-dismiss': () => { ui.aiSummary = null; renderEditor(); },
    'ai-summary-tab': () => {
      ui.tab = 'summary'; renderTabs(); renderEditor();
      actions.view({ view: 'edit' });
      const b = document.querySelector('[data-action="ai-summary"]');
      if (b) b.click();
    },

    /* --- AI: bullets --- */
    'ai-bullets': async (d, btn) => {
      const e = R[d.list][+d.idx];
      if (!RC.lines(e.bullets).length) { UI.toast('Write a few bullets first. Even rough notes work, and the AI will polish them.'); return; }
      const header = d.list === 'experience' ? `${e.role} at ${e.company}` : `${e.name} (${e.tech})`;
      const res = await aiCall('bullets', { entry: header + '\n' + RC.lines(e.bullets).map((l) => '- ' + l).join('\n'), current: !!e.current, section: d.list }, btn, 'Rewriting…');
      if (res) { ui.aiBullets = { key: `${d.list}.${d.idx}`, result: res }; ui.improve = null; renderEditor(); }
    },
    'ai-bullet-apply': (d) => {
      const e = R[d.list][+d.idx];
      const b = ui.aiBullets.result.bullets[+d.j];
      const ls = String(e.bullets).split('\n');
      const idx = ls.findIndex((l) => normLine(l) === normLine(b.original));
      if (idx >= 0) ls[idx] = b.improved; else ls.push(b.improved);
      e.bullets = ls.join('\n');
      b.original = b.improved;
      renderEditor(); schedule();
    },
    'ai-bullet-apply-all': async (d) => {
      await snapshotVersion('Before AI bullet rewrite');
      const e = R[d.list][+d.idx];
      const ls = String(e.bullets).split('\n');
      ui.aiBullets.result.bullets.forEach((b) => {
        const idx = ls.findIndex((l) => normLine(l) === normLine(b.original));
        if (idx >= 0) ls[idx] = b.improved;
      });
      e.bullets = ls.join('\n');
      ui.aiBullets = null;
      renderEditor(); schedule();
      UI.toast('Bullets rewritten. Fill in any [placeholders] with your real numbers.');
    },
    'ai-bullets-dismiss': () => { ui.aiBullets = null; renderEditor(); },

    /* --- AI: tailor & review --- */
    'ai-tailor': async (d, btn) => {
      if (R.jd.trim().length < 80) { UI.toast('Paste the full job description into the box first.'); $('#jdInput').focus(); return; }
      const res = await aiCall('tailor', { jd: R.jd }, btn, 'Tailoring…');
      if (res) tailorModal(res);
    },
    'tailor-apply': async (d, btn) => {
      const res = ui.tailorRes;
      await beforeTailorChange();
      if (d.what === 'headline') { R.personal.title = res.headline; UI.toast('Headline updated.'); }
      if (d.what === 'summary') { R.summary = res.summary; UI.toast('Summary updated.'); }
      if (d.what === 'bullet' || d.what === 'all-bullets') {
        const idxs = d.what === 'bullet' ? [+d.j] : res.bullet_changes.map((_, j) => j);
        let n = 0;
        idxs.forEach((j) => {
          const b = res.bullet_changes[j];
          if (b.applied) return;
          if (replaceBullet(b.original, b.suggested)) { b.applied = true; n++; const el = document.getElementById('tb-' + j); if (el) el.classList.add('applied'); }
        });
        UI.toast(n ? `${n} bullet${n > 1 ? 's' : ''} updated.` : 'Those bullets were already changed or could not be found.');
      }
      if (btn && d.what !== 'all-bullets') { btn.textContent = 'Applied ✓'; btn.disabled = true; }
      renderEditor(); schedule();
    },
    'ai-review': async (d, btn) => {
      const res = await aiCall('review', { target: RC.TARGETS[R.target].label }, btn, 'Reviewing…');
      if (res) reviewModal(res);
    },

    /* --- cover letter --- */
    'cover-letter': () => coverLetterModal(),
    'cl-ai': async (d, btn) => {
      const c = clState();
      const res = await aiCall('cover-letter', { jd: R.jd, company: c.company, role: c.role || R.personal.title, manager: c.manager, tone: c.tone }, btn, 'Writing your letter…');
      if (res) {
        c.body = res.letter; c.subject = res.subject;
        queueSave();
        coverLetterModal();
      }
    },
    'cl-template': () => {
      const c = clState();
      if (c.body.trim() && !confirm('Replace the current letter with the template?')) return;
      c.body = RC.draftCoverLetter(R, c);
      c.subject = `Application for ${c.role || R.personal.title || 'the role'}${c.company ? ' at ' + c.company : ''} — ${R.personal.fullName}`;
      queueSave();
      coverLetterModal();
    },
    'cl-copy': async () => { const ok = await UI.copy(clState().body); UI.toast(ok ? 'Letter copied.' : 'Copy failed. Select the text and copy it manually.'); },
    'cl-txt': () => { download(fileBase(R).replace('_Resume', '_Cover_Letter') + '.txt', clState().body, 'text/plain;charset=utf-8'); },
    'cl-doc': () => {
      const html = `<html><head><meta charset="utf-8"><style>body{font-family:Calibri,Arial;font-size:11pt;line-height:1.45}h1{font-size:18pt;margin:0;color:${R.accent}}.lt-contact,.lt-title{color:#333}.lt-date{margin:18pt 0 12pt}p{margin:0 0 10pt}</style></head><body>${letterHtml()}</body></html>`;
      download(fileBase(R).replace('_Resume', '_Cover_Letter') + '.doc', html, 'application/msword');
    },
    'cl-pdf': async (d, btn) => {
      if (!clState().body.trim()) { UI.toast('Generate or write the letter first.'); return; }
      const done = UI.busy(btn, 'Creating PDF…');
      try {
        await PdfExport.letter(R, clState().body, fileBase(R).replace('_Resume', '_Cover_Letter'));
        done();
        return;
      } catch (e) { done(); UI.toast(e.message + ' Opening the print dialog instead.'); }
      const lp = $('#letterPrint');
      lp.style.setProperty('--accent', R.accent);
      lp.style.setProperty('--rfont', RC.FONTS[R.font].css);
      lp.innerHTML = letterHtml();
      document.body.classList.add('print-letter');
      const old = document.title;
      document.title = fileBase(R).replace('_Resume', '_Cover_Letter');
      setTimeout(() => { window.print(); document.title = old; document.body.classList.remove('print-letter'); }, 200);
    },

    /* --- version history --- */
    history: () => historyModal(),
    'hist-preview': async (d) => {
      document.querySelectorAll('.hist-item').forEach((el) => el.classList.toggle('sel', el.dataset.vid === d.vid));
      const box = $('#histPreview');
      box.innerHTML = '<div class="loader small-loader"><div class="spinner"></div></div>';
      try {
        const res = await API.get(`/api/resumes/${R.id}/versions/${d.vid}`);
        const v = RC.normalize(res.version.data);
        box.innerHTML = `<div class="hp-scale"><article class="page resume tpl-${v.template}" id="hpPage"></article></div>`;
        const pg = $('#hpPage');
        pg.style.setProperty('--accent', v.accent);
        pg.style.setProperty('--rfont', RC.FONTS[v.font].css);
        pg.style.setProperty('--fs', v.fontSize + 'pt');
        pg.innerHTML = RC.renderResume(v);
        const s = box.clientWidth / PAGE_W;
        pg.style.transform = `scale(${s})`;
        pg.parentElement.style.height = Math.ceil(pg.offsetHeight * s) + 'px';
      } catch (e) { box.innerHTML = `<p class="small muted">${esc(e.message)}</p>`; }
    },
    'hist-restore': async (d, btn) => {
      if (!confirm('Restore this version? Your current version is saved in history first, so you can undo this.')) return;
      const done = UI.busy(btn, 'Restoring…');
      try {
        await flushSave();
        const res = await API.post(`/api/resumes/${R.id}/versions/${d.vid}/restore`);
        R = RC.normalize(Object.assign(res.resume.data, { id: res.resume.id, name: res.resume.name }));
        R.updatedAt = res.resume.updated_at;
        ui.aiBullets = null; ui.aiSummary = null; ui.improve = null;
        closeModal(); renderAll();
        UI.toast('Version restored.');
      } catch (e) { UI.toast(e.message); done(); }
    },
    'hist-save': async (d, btn) => {
      const label = prompt('Name this version (e.g. "Sent to Google")', 'Saved manually');
      if (label === null) return;
      const done = UI.busy(btn, 'Saving…');
      await snapshotVersion(label.trim().slice(0, 80) || 'Saved manually');
      done();
      historyModal();
    },

    'close-modal': () => closeModal(),
    view: (d) => {
      document.body.dataset.view = d.view;
      document.querySelectorAll('.mobile-switch button').forEach((b) => b.classList.toggle('on', b.dataset.view === d.view));
      if (d.view === 'preview') fitPreview();
    }
  };

  /* ---------------- events ---------------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled || !R) return;
    const fn = actions[b.dataset.action];
    if (fn) { e.preventDefault(); fn(b.dataset, b); }
    const menu = b.closest('details.menu');
    if (menu) menu.open = false;
  });

  document.addEventListener('input', (e) => {
    const t = e.target, r = active();
    if (!r) return;
    if (t.dataset.path) {
      setPath(r, t.dataset.path, t.type === 'checkbox' ? t.checked : t.value);
      if (t.dataset.stats) {
        const [key, i] = t.dataset.stats.split('.');
        const el = document.getElementById(`stats-${key}-${i}`);
        if (el) el.innerHTML = statLine(key, +i, r[key][+i]);
      }
      if (t.dataset.live === 'summary') {
        const wc = t.value.trim() ? t.value.trim().split(/\s+/).length : 0;
        $('#sumCount').textContent = wc + ' words';
      }
      schedule();
    } else if (t.id === 'jdInput') {
      r.jd = t.value; schedule();
    } else if (t.id === 'resumeName') {
      if (t.value.trim()) { r.name = t.value.trim().slice(0, 120); document.title = `${r.name} — ResumeForge Pro`; queueSave(); }
    } else if (t.dataset.design) {
      r[t.dataset.design] = t.type === 'range' ? parseFloat(t.value) : t.value;
      if (t.dataset.design === 'fontSize') $('#fsVal').textContent = t.value + 'pt';
      if (t.dataset.design === 'target' && r.mode !== 'executive') { r.template = RC.TARGETS[r.target].template; renderPreviewBar(); renderEditor(); }
      schedule();
    } else if (t.dataset.cl) {
      clState()[t.dataset.cl] = t.value;
      queueSave();
    } else if (t.closest('#modal') && ['xVerb', 'xWhat', 'xRes', 'xHow'].includes(t.id)) {
      $('#xPrev').textContent = xyzText() || 'Your bullet will appear here…';
    }
  });

  $('#resumeName').addEventListener('blur', (e) => { if (!e.target.value.trim() && R) e.target.value = R.name; });
  $('#resumeName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); clearTimeout(saveTimer); saveNow(); }
  });
  window.addEventListener('resize', () => { clearTimeout(fitPreview.t); fitPreview.t = setTimeout(fitPreview, 80); });
  window.addEventListener('beforeprint', () => { $('#page').style.transform = 'none'; });
  window.addEventListener('afterprint', fitPreview);
  window.addEventListener('beforeunload', (e) => {
    if (sync.dirty || sync.inFlight) { saveNow(); e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------- boot ---------------- */
  (async function boot() {
    const user = await API.requireUser();
    ui.isAdmin = !!user.is_admin;
    $('#userSlot').innerHTML = UI.userMenu(user);
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) { location.replace('/dashboard'); return; }
    try {
      const res = await API.get('/api/resumes/' + encodeURIComponent(id));
      meta = { share_slug: res.resume.share_slug, share_views: res.resume.share_views };
      R = RC.normalize(Object.assign(res.resume.data, { id: res.resume.id, name: res.resume.name }));
      R.updatedAt = res.resume.updated_at;
    } catch (e) {
      $('#loading').innerHTML = `<p>${esc(e.status === 404 ? 'This resume was not found. It may have been deleted.' : e.message)}</p><a class="btn" href="/dashboard">Back to my resumes</a>`;
      return;
    }
    const cfg = await API.config();
    ui.ai = !!cfg.ai.enabled;
    ui.aiReason = cfg.ai.reason || '';
    ui.quota = cfg.ai.quota || null;
    document.body.classList.toggle('no-ai', !ui.ai);
    $('#loading').hidden = true;
    $('#layout').hidden = false;
    flash('All changes saved', 'ok');
    renderAll();
    if (params.get('new') || params.get('imported')) {
      history.replaceState(null, '', '/editor?id=' + R.id);
      UI.toast(params.get('imported')
        ? 'Resume imported. Check each tab and use the Recruiter Score on the right to polish it.'
        : 'Resume created. Your changes save automatically.');
    }
  })();
})(window.RC);
