/* Extracts plain text from a PDF in the browser using PDF.js (loaded on demand from cdnjs). */
(function () {
  'use strict';
  const VER = '3.11.174';
  const BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VER}/`;
  let loading = null;

  function loadLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = BASE + 'pdf.min.js';
      s.crossOrigin = 'anonymous';
      s.onload = () => {
        if (!window.pdfjsLib) return reject(new Error('PDF reader failed to load'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { loading = null; reject(new Error('PDF reader could not be downloaded (are you offline?)')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /* Groups text items into lines by their vertical position, top to bottom. */
  async function pdfToText(arrayBuffer) {
    const lib = await loadLib();
    const doc = await lib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
    const out = [];
    const pages = Math.min(doc.numPages, 10);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const rows = [];
      content.items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        const x = it.transform[4], y = it.transform[5];
        let row = rows.find((r) => Math.abs(r.y - y) < 3);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, w: it.width || 0, s: it.str });
      });
      rows.sort((a, b) => b.y - a.y);
      rows.forEach((r) => {
        r.items.sort((a, b) => a.x - b.x);
        let line = '', lastEnd = null;
        r.items.forEach((it) => {
          if (lastEnd !== null) line += it.x - lastEnd > 18 ? '   ' : (it.x - lastEnd > 1 ? ' ' : '');
          line += it.s;
          lastEnd = it.x + it.w;
        });
        out.push(line.replace(/\s+$/, ''));
      });
      out.push('');
    }
    return out.join('\n');
  }

  window.PdfText = { extract: pdfToText };
})();
