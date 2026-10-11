/* ResumeForge Pro — resume rendering (HTML preview / PDF / Word) and plain-text export */
(function (RC) {
  'use strict';
  const esc = RC.esc;

  const cleanUrl = (u) => String(u || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  const dateRange = (s, e, cur) => {
    const end = cur ? 'Present' : String(e || '').trim();
    s = String(s || '').trim();
    return s && end ? `${s} – ${end}` : (s || end);
  };

  RC.sectionTitles = function (r) {
    return Object.assign({}, RC.DEFAULT_TITLES, RC.MODES[r.mode].titles);
  };

  function row(left, right, cls) {
    return `<div class="r-row ${cls || ''}"><span class="r-left">${left}</span>${right ? `<span class="r-gap"> | </span><span class="r-right">${right}</span>` : ''}</div>`;
  }
  const bulletsHtml = (t) => {
    const ls = RC.lines(t);
    return ls.length ? `<ul class="r-bullets">${ls.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
  };
  const sec = (key, title, body) => (body ? `<section class="r-sec r-sec-${key}"><h2>${esc(title)}</h2><div class="r-sec-body">${body}</div></section>` : '');

  const RENDER = {
    summary: (r, t) => sec('summary', t, r.summary.trim() ? `<p class="r-summary">${esc(r.summary.trim())}</p>` : ''),

    experience: (r, t) => sec('experience', t, r.experience.filter((e) => e.role || e.company || e.bullets).map((e) => `
      <div class="r-entry">
        ${row(`<span class="r-strong">${esc(e.role)}</span>`, `<span class="r-date">${esc(dateRange(e.start, e.end, e.current))}</span>`)}
        ${e.company || e.location ? row(`<span class="r-org">${esc(e.company)}</span>`, esc(e.location), 'r-sub') : ''}
        ${bulletsHtml(e.bullets)}
      </div>`).join('')),

    education: (r, t) => sec('education', t, r.education.filter((e) => e.degree || e.institution).map((e) => `
      <div class="r-entry">
        ${row(`<span class="r-strong">${esc(e.degree)}</span>`, `<span class="r-date">${esc(dateRange(e.start, e.end))}</span>`)}
        ${row(`<span class="r-org">${esc(e.institution)}</span>${e.score ? ` <span class="r-score">· ${esc(e.score)}</span>` : ''}`, esc(e.location), 'r-sub')}
        ${e.details.trim() ? `<div class="r-details">${esc(e.details.trim())}</div>` : ''}
      </div>`).join('')),

    projects: (r, t) => sec('projects', t, r.projects.filter((p) => p.name || p.bullets).map((p) => `
      <div class="r-entry">
        ${row(`<span class="r-strong">${esc(p.name)}</span>${p.tech ? ` <span class="r-tech">| ${esc(p.tech)}</span>` : ''}`,
          [p.link ? `<span class="r-link">${esc(cleanUrl(p.link))}</span>` : '', p.date ? `<span class="r-date">${esc(p.date)}</span>` : ''].filter(Boolean).join(' · '))}
        ${bulletsHtml(p.bullets)}
      </div>`).join('')),

    skills: (r, t) => {
      const rows = r.skills.filter((s) => s.items.trim());
      if (!rows.length) return '';
      if (r.mode === 'executive') {
        return sec('skills', t, rows.map((s) => `<div class="r-skill">${s.category ? `<b>${esc(s.category)}:</b> ` : ''}${s.items.split(',').map((x) => esc(x.trim())).filter(Boolean).join(' &bull; ')}</div>`).join(''));
      }
      return sec('skills', t, rows.map((s) => `<div class="r-skill">${s.category ? `<b>${esc(s.category)}:</b> ` : ''}${esc(s.items.trim())}</div>`).join(''));
    },

    certifications: (r, t) => {
      const c = r.certifications.filter((x) => x.name.trim());
      return sec('certifications', t, c.length ? `<ul class="r-bullets r-compact">${c.map((x) => `<li><b>${esc(x.name)}</b>${x.issuer ? ' — ' + esc(x.issuer) : ''}${x.year ? ` (${esc(x.year)})` : ''}</li>`).join('')}</ul>` : '');
    },

    achievements: (r, t) => {
      const a = r.achievements.filter((x) => x.text.trim());
      return sec('achievements', t, a.length ? `<ul class="r-bullets">${a.map((x) => `<li>${esc(x.text.trim())}</li>`).join('')}</ul>` : '');
    },

    languages: (r, t) => sec('languages', t, r.languages.trim() ? `<div class="r-skill">${esc(r.languages.trim())}</div>` : '')
  };

  RC.contactItems = function (r) {
    const p = r.personal;
    return [p.phone, p.email, p.location, cleanUrl(p.linkedin), cleanUrl(p.github), cleanUrl(p.website)].map((x) => String(x || '').trim()).filter(Boolean);
  };

  RC.renderResume = function (r) {
    const p = r.personal;
    const titles = RC.sectionTitles(r);
    const head = `<header class="r-head">
      <h1 class="r-name">${esc(p.fullName || 'Your Name')}</h1>
      ${p.title ? `<div class="r-headline">${esc(p.title)}</div>` : ''}
      <div class="r-contact">${RC.contactItems(r).map(esc).join('<span class="r-sep"> | </span>')}</div>
    </header>`;
    const body = r.order.filter((k) => !r.hidden.includes(k) && RENDER[k]).map((k) => RENDER[k](r, titles[k])).join('');
    return `<div class="r-body">${head}${body}</div>`;
  };

  /* Plain text — for pasting into job portals (Naukri, Workday, LinkedIn Easy Apply) */
  RC.toText = function (r) {
    const p = r.personal, titles = RC.sectionTitles(r), out = [];
    out.push((p.fullName || '').toUpperCase());
    if (p.title) out.push(p.title);
    out.push(RC.contactItems(r).join(' | '), '');
    const H = (t) => out.push(t.toUpperCase(), '-'.repeat(Math.min(60, t.length + 4)));
    r.order.filter((k) => !r.hidden.includes(k)).forEach((k) => {
      const t = titles[k];
      if (k === 'summary' && r.summary.trim()) { H(t); out.push(r.summary.trim(), ''); }
      if (k === 'experience') {
        const es = r.experience.filter((e) => e.role || e.company);
        if (es.length) { H(t); es.forEach((e) => { out.push(`${e.role}${e.company ? ' — ' + e.company : ''}${e.location ? ', ' + e.location : ''} | ${dateRange(e.start, e.end, e.current)}`); RC.lines(e.bullets).forEach((l) => out.push('• ' + l)); out.push(''); }); }
      }
      if (k === 'education') {
        const es = r.education.filter((e) => e.degree || e.institution);
        if (es.length) { H(t); es.forEach((e) => { out.push(`${e.degree}${e.institution ? ' — ' + e.institution : ''}${e.score ? ' (' + e.score + ')' : ''} | ${dateRange(e.start, e.end)}`); if (e.details) out.push(e.details); }); out.push(''); }
      }
      if (k === 'projects') {
        const ps = r.projects.filter((x) => x.name);
        if (ps.length) { H(t); ps.forEach((x) => { out.push(`${x.name}${x.tech ? ' | ' + x.tech : ''}${x.link ? ' | ' + cleanUrl(x.link) : ''}`); RC.lines(x.bullets).forEach((l) => out.push('• ' + l)); out.push(''); }); }
      }
      if (k === 'skills') {
        const s = r.skills.filter((x) => x.items.trim());
        if (s.length) { H(t); s.forEach((x) => out.push(`${x.category ? x.category + ': ' : ''}${x.items}`)); out.push(''); }
      }
      if (k === 'certifications') {
        const c = r.certifications.filter((x) => x.name);
        if (c.length) { H(t); c.forEach((x) => out.push(`• ${x.name}${x.issuer ? ' — ' + x.issuer : ''}${x.year ? ' (' + x.year + ')' : ''}`)); out.push(''); }
      }
      if (k === 'achievements') {
        const a = r.achievements.filter((x) => x.text.trim());
        if (a.length) { H(t); a.forEach((x) => out.push('• ' + x.text.trim())); out.push(''); }
      }
      if (k === 'languages' && r.languages.trim()) { H(t); out.push(r.languages.trim(), ''); }
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  };

  /* Word-compatible HTML (.doc) — opens and edits in MS Word / Google Docs */
  RC.toWord = function (r) {
    const font = RC.FONTS[r.font].css;
    const css = `body{font-family:${font};font-size:${r.fontSize}pt;color:#111;line-height:1.3}
      .r-head{text-align:${r.template === 'classic' ? 'center' : 'left'};margin-bottom:8pt}
      .r-name{font-size:${r.fontSize * 2}pt;margin:0;color:${r.accent}} .r-headline{font-size:${r.fontSize + 1}pt;font-weight:bold}
      .r-contact{font-size:${r.fontSize - 0.5}pt;color:#333}
      h2{font-size:${r.fontSize + 1}pt;text-transform:uppercase;letter-spacing:1px;color:${r.accent};border-bottom:1px solid ${r.accent};margin:10pt 0 4pt;padding-bottom:1pt}
      .r-entry{margin-bottom:6pt} .r-row{margin:0} .r-strong{font-weight:bold} .r-org{font-style:italic} .r-date{color:#333}
      ul{margin:2pt 0 4pt 16pt;padding:0} li{margin:0 0 1pt} p{margin:0 0 2pt} .r-skill{margin:0 0 2pt}`;
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(r.personal.fullName)} Resume</title><style>${css}</style></head>
<body>${RC.renderResume(r)}</body></html>`;
  };
})(window.RC);
