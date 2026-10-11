/*
 * One-click PDF download with real, selectable text (ATS-friendly — not an image).
 * Uses jsPDF (loaded on demand from cdnjs) and lays the resume out natively in PDF,
 * mirroring the four on-screen templates.
 */
(function () {
  'use strict';
  const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  let loading = null;

  function load() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.crossOrigin = 'anonymous';
      s.onload = () => (window.jspdf ? resolve(window.jspdf) : reject(new Error('PDF engine failed to load')));
      s.onerror = () => { loading = null; reject(new Error('PDF engine could not be downloaded. Check your internet connection.')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // Built-in PDF fonts use Windows-1252; replace characters they cannot draw.
  const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/₹\s?/g, 'Rs. ')
      .replace(/[→⟶]/g, '->').replace(/[←]/g, '<-')
      .replace(/[✓✔]/g, '')
      .replace(/[    ]/g, ' ')
      .replace(/[‐‑−]/g, '-')
      .split('').filter((c) => c.charCodeAt(0) < 256 || CP1252_EXTRA.includes(c)).join('');
  }
  const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16)); };
  const lines = (t) => String(t || '').split('\n').map((s) => s.replace(/^\s*[-•*·▪●]\s*/, '').trim()).filter(Boolean);
  const cleanUrl = (u) => String(u || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  const dateRange = (s, e, cur) => { const end = cur ? 'Present' : String(e || '').trim(); s = String(s || '').trim(); return s && end ? `${s} – ${end}` : (s || end); };

  /* ------------------------------------------------------------------ layout engine */
  function Writer(doc, opts) {
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const M = { l: 45, r: 45, t: 40, b: 40 };
    const INK = [26, 26, 26], SUB = [64, 64, 64], MUTED = [110, 110, 110];
    const w = {
      doc, W, H, M, INK, SUB, MUTED, y: M.t, family: opts.family, fs: opts.fs, lh: opts.fs * 1.32,
      left: M.l, right: W - M.r,
      font(style, size, color) { doc.setFont(this.family, style); doc.setFontSize(size); doc.setTextColor(...(color || INK)); },
      ensure(h) { if (this.y + h > H - M.b) { doc.addPage(); this.y = M.t; return true; } return false; },
      width(text, style, size) { doc.setFont(this.family, style); doc.setFontSize(size); return doc.getTextWidth(clean(text)); },
      /* word-wraps runs of differently styled text: [{t, s:'normal'|'bold'|'italic'|'bolditalic', c:[r,g,b]}] */
      rich(segs, x, width, size, opts2) {
        size = size || this.fs;
        const lh = size * 1.32;
        const toks = [];
        segs.forEach((sg) => clean(sg.t).split(/(\s+)/).forEach((t) => { if (t) toks.push({ t, s: sg.s || 'normal', c: sg.c }); }));
        const out = [[]];
        let lw = 0;
        toks.forEach((tok) => {
          doc.setFont(this.family, tok.s); doc.setFontSize(size);
          const space = /^\s+$/.test(tok.t);
          const tw = doc.getTextWidth(space ? ' ' : tok.t);
          if (space) { if (lw > 0) { out[out.length - 1].push({ t: ' ', s: tok.s, tw }); lw += tw; } return; }
          if (lw + tw > width && lw > 0) {
            const cur = out[out.length - 1];
            while (cur.length && cur[cur.length - 1].t === ' ') cur.pop();
            out.push([]); lw = 0;
          }
          if (tw > width) { // a single very long token (e.g. URL): hard-split it
            let chunk = '';
            for (const ch of tok.t) {
              if (doc.getTextWidth(chunk + ch) > width && chunk) { out[out.length - 1].push({ t: chunk, s: tok.s, c: tok.c, tw: doc.getTextWidth(chunk) }); out.push([]); chunk = ''; }
              chunk += ch;
            }
            const cw = doc.getTextWidth(chunk);
            out[out.length - 1].push({ t: chunk, s: tok.s, c: tok.c, tw: cw }); lw = cw;
            return;
          }
          out[out.length - 1].push({ t: tok.t, s: tok.s, c: tok.c, tw }); lw += tw;
        });
        const align = (opts2 && opts2.align) || 'left';
        out.forEach((ln) => {
          if (!ln.length) return;
          this.ensure(lh);
          const total = ln.reduce((a, b) => a + b.tw, 0);
          let cx = align === 'center' ? x + (width - total) / 2 : x;
          ln.forEach((tok) => {
            doc.setFont(this.family, tok.s); doc.setFontSize(size); doc.setTextColor(...(tok.c || INK));
            if (tok.t !== ' ') doc.text(tok.t, cx, this.y + size * 0.8);
            cx += tok.tw;
          });
          this.y += lh;
        });
      }
    };
    return w;
  }

  /* ------------------------------------------------------------------ resume */
  async function resumePdf(r) {
    const { jsPDF } = await load();
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const family = (r.font === 'serif' || r.font === 'garamond') ? 'times' : 'helvetica';
    const fs = Math.max(8.5, Math.min(12.5, Number(r.fontSize) || 10.5));
    const w = Writer(doc, { family, fs });
    const A = rgb(r.accent || '#1f3a5f');
    const tpl = r.template;
    const p = r.personal;
    const titles = RC.sectionTitles(r);
    const contact = RC.contactItems(r).map(clean).join('  |  ');
    const compact = tpl === 'compact';
    const headW = compact ? fs * 7.4 : 0;
    const bodyL = compact ? w.left + headW + fs : w.left;
    const bodyW = w.right - bodyL;

    /* ---- header ---- */
    const name = clean(p.fullName || 'Your Name');
    if (tpl === 'executive') {
      const pad = 14, nameSize = fs * 2.3;
      doc.setFont(family, 'normal'); doc.setFontSize(fs * 0.93);
      const cLines = doc.splitTextToSize(contact, w.right - w.left - pad * 2);
      const bandH = pad + nameSize * 1.1 + (p.title ? fs * 1.08 * 1.35 : 0) + cLines.length * fs * 0.93 * 1.3 + pad * 0.8;
      doc.setFillColor(...A);
      doc.rect(w.left, w.y, w.right - w.left, bandH, 'F');
      let y = w.y + pad;
      w.font('bold', nameSize, [255, 255, 255]); doc.text(name, w.left + pad, y + nameSize * 0.8); y += nameSize * 1.1;
      if (p.title) { w.font('normal', fs * 1.08, [255, 255, 255]); doc.text(clean(p.title), w.left + pad, y + fs * 0.9); y += fs * 1.08 * 1.35; }
      w.font('normal', fs * 0.93, [235, 238, 245]);
      cLines.forEach((l) => { doc.text(l, w.left + pad, y + fs * 0.8); y += fs * 0.93 * 1.3; });
      w.y += bandH + fs * 1.0;
    } else {
      const center = tpl === 'classic';
      const nameSize = tpl === 'classic' ? fs * 1.95 : tpl === 'modern' ? fs * 2.3 : fs * 2.0;
      const nameColor = tpl === 'modern' ? A : [17, 17, 17];
      w.font('bold', nameSize, nameColor);
      const nm = tpl === 'classic' ? name.toUpperCase() : name;
      const opts = tpl === 'classic' ? { charSpace: nameSize * 0.08 } : {};
      if (center) {
        const nw = doc.getTextWidth(nm) + (opts.charSpace || 0) * (nm.length - 1);
        doc.text(nm, (w.W - nw) / 2, w.y + nameSize * 0.8, opts);
      } else doc.text(nm, w.left, w.y + nameSize * 0.8, opts);
      w.y += nameSize * 1.15;
      if (p.title) w.rich([{ t: p.title, s: 'bold', c: tpl === 'modern' ? [51, 51, 51] : A }], w.left, w.right - w.left, fs * 1.08, { align: center ? 'center' : 'left' });
      w.rich([{ t: contact, c: [58, 58, 58] }], w.left, w.right - w.left, fs * 0.93, { align: center ? 'center' : 'left' });
      if (tpl === 'modern' || tpl === 'compact') {
        w.y += fs * 0.35;
        doc.setDrawColor(...A); doc.setLineWidth(tpl === 'modern' ? 2.2 : 1.6);
        doc.line(w.left, w.y, w.right, w.y);
        w.y += fs * 0.5;
      } else w.y += fs * 0.6;
    }

    /* ---- sections ---- */
    function heading(key) {
      const t = clean(titles[key]).toUpperCase();
      const size = fs * (compact ? 0.88 : 1.02);
      w.y += fs * (compact ? 0.65 : 0.8);
      w.ensure(fs * 4.5);
      if (compact) {
        w.font('bold', size, A);
        const hl = doc.splitTextToSize(t, headW);
        const top = w.y;
        hl.forEach((l, i) => doc.text(l, w.left, top + size * 0.85 + i * size * 1.25, { charSpace: 0.6 }));
        return; // content starts at the same y in the right column
      }
      const color = tpl === 'executive' ? [17, 17, 17] : A;
      w.font('bold', size, color);
      doc.text(t, w.left, w.y + size * 0.8, { charSpace: size * 0.09 });
      w.y += size * 1.25;
      doc.setLineWidth(tpl === 'executive' ? 1.6 : tpl === 'modern' ? 0.5 : 0.75);
      doc.setDrawColor(...(tpl === 'modern' ? [213, 217, 223] : A));
      doc.line(w.left, w.y, w.right, w.y);
      w.y += fs * 0.45;
    }

    function rowWithRight(leftSegs, rightText, size, rightStyle) {
      size = size || fs;
      const rt = clean(rightText || '');
      const rw = rt ? w.width(rt, rightStyle || 'bold', size) : 0;
      w.ensure(size * 1.32);
      const top = w.y;
      w.rich(leftSegs, bodyL, bodyW - (rw ? rw + 12 : 0), size);
      if (rt) {
        w.font(rightStyle || 'bold', size, [51, 51, 51]);
        doc.text(rt, w.right, top + size * 0.8, { align: 'right' });
      }
    }

    function bullets(text, isAch) {
      lines(text).forEach((l) => {
        w.ensure(w.lh);
        const top = w.y;
        w.font('bold', fs, A);
        doc.text('•', bodyL + 3, top + fs * 0.8);
        w.rich([{ t: l, s: isAch ? 'bold' : 'normal' }], bodyL + 13, bodyW - 13, fs);
        w.y += fs * 0.12;
      });
    }

    const RENDER = {
      summary() {
        if (!r.summary.trim()) return false;
        heading('summary');
        w.rich([{ t: r.summary.trim() }], bodyL, bodyW, fs);
        return true;
      },
      experience() {
        const es = r.experience.filter((e) => e.role || e.company || e.bullets);
        if (!es.length) return false;
        heading('experience');
        es.forEach((e, i) => {
          if (i) w.y += fs * 0.5;
          w.ensure(fs * 5);
          rowWithRight([{ t: e.role, s: 'bold' }], dateRange(e.start, e.end, e.current));
          if (e.company || e.location) rowWithRight([{ t: e.company, s: 'italic', c: [51, 51, 51] }], e.location, fs, 'normal');
          w.y += fs * 0.15;
          bullets(e.bullets);
        });
        return true;
      },
      education() {
        const es = r.education.filter((e) => e.degree || e.institution);
        if (!es.length) return false;
        heading('education');
        es.forEach((e, i) => {
          if (i) w.y += fs * 0.45;
          w.ensure(fs * 3.5);
          rowWithRight([{ t: e.degree, s: 'bold' }], dateRange(e.start, e.end));
          const sub = [{ t: e.institution, s: 'italic', c: [51, 51, 51] }];
          if (e.score) sub.push({ t: '  ·  ' + e.score, c: [51, 51, 51] });
          rowWithRight(sub, e.location, fs, 'normal');
          if (e.details.trim()) w.rich([{ t: e.details.trim(), c: [51, 51, 51] }], bodyL, bodyW, fs);
        });
        return true;
      },
      projects() {
        const ps = r.projects.filter((x) => x.name || x.bullets);
        if (!ps.length) return false;
        heading('projects');
        ps.forEach((x, i) => {
          if (i) w.y += fs * 0.45;
          w.ensure(fs * 4);
          const left = [{ t: x.name, s: 'bold' }];
          if (x.tech) left.push({ t: '  |  ' + x.tech, s: 'italic', c: [85, 85, 85] });
          rowWithRight(left, [cleanUrl(x.link), x.date].filter(Boolean).join('  ·  '), fs, 'normal');
          bullets(x.bullets);
        });
        return true;
      },
      skills() {
        const rows = r.skills.filter((s) => s.items.trim());
        if (!rows.length) return false;
        heading('skills');
        rows.forEach((s) => {
          const items = r.mode === 'executive' ? s.items.split(',').map((t) => t.trim()).filter(Boolean).join('  •  ') : s.items.trim();
          w.rich((s.category ? [{ t: s.category + ': ', s: 'bold' }] : []).concat([{ t: items }]), bodyL, bodyW, fs);
          w.y += fs * 0.12;
        });
        return true;
      },
      certifications() {
        const c = r.certifications.filter((x) => x.name.trim());
        if (!c.length) return false;
        heading('certifications');
        c.forEach((x) => {
          w.ensure(w.lh);
          const top = w.y;
          w.font('bold', fs, A); doc.text('•', bodyL + 3, top + fs * 0.8);
          w.rich([{ t: x.name, s: 'bold' }, { t: (x.issuer ? ' — ' + x.issuer : '') + (x.year ? ` (${x.year})` : '') }], bodyL + 13, bodyW - 13, fs);
        });
        return true;
      },
      achievements() {
        const a = r.achievements.filter((x) => x.text.trim());
        if (!a.length) return false;
        heading('achievements');
        bullets(a.map((x) => x.text).join('\n'), r.mode === 'executive');
        return true;
      },
      languages() {
        if (!r.languages.trim()) return false;
        heading('languages');
        w.rich([{ t: r.languages.trim() }], bodyL, bodyW, fs);
        return true;
      }
    };

    r.order.filter((k) => !r.hidden.includes(k) && RENDER[k]).forEach((k) => RENDER[k]());

    const skills = RC.allSkills(r).slice(0, 25).join(', ');
    doc.setProperties({
      title: `${clean(p.fullName || 'Resume')} — Resume`,
      subject: clean(p.title || 'Resume'),
      author: clean(p.fullName || ''),
      keywords: clean(skills),
      creator: 'ResumeForge Pro'
    });
    return doc;
  }

  /* ------------------------------------------------------------------ cover letter */
  async function letterPdf(r, letter) {
    const { jsPDF } = await load();
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const family = (r.font === 'serif' || r.font === 'garamond') ? 'times' : 'helvetica';
    const fs = 11;
    const w = Writer(doc, { family, fs });
    w.M.l = w.left = 60; w.M.r = 60; w.right = w.W - 60; w.M.t = w.y = 56;
    const A = rgb(r.accent || '#1f3a5f');
    const p = r.personal;
    w.font('bold', 20, A); doc.text(clean(p.fullName || ''), w.left, w.y + 16); w.y += 26;
    if (p.title) w.rich([{ t: p.title, s: 'bold', c: [51, 51, 51] }], w.left, w.right - w.left, 11);
    w.rich([{ t: [p.phone, p.email, p.location, cleanUrl(p.linkedin)].filter(Boolean).join('  |  '), c: [80, 80, 80] }], w.left, w.right - w.left, 9.5);
    w.y += 6; doc.setDrawColor(...A); doc.setLineWidth(1.6); doc.line(w.left, w.y, w.right, w.y); w.y += 22;
    w.rich([{ t: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), c: [60, 60, 60] }], w.left, w.right - w.left, fs);
    w.y += 12;
    String(letter || '').trim().split(/\n\s*\n/).forEach((para) => {
      para.split('\n').forEach((ln) => w.rich([{ t: ln }], w.left, w.right - w.left, fs));
      w.y += fs * 0.8;
    });
    doc.setProperties({ title: `${clean(p.fullName || '')} — Cover Letter`, author: clean(p.fullName || ''), creator: 'ResumeForge Pro' });
    return doc;
  }

  window.PdfExport = {
    async resume(r, filename) { const doc = await resumePdf(r); doc.save(filename + '.pdf'); },
    async letter(r, text, filename) { const doc = await letterPdf(r, text); doc.save(filename + '.pdf'); },
    async resumeBlob(r) { return (await resumePdf(r)).output('blob'); },
    clean
  };
})();
