// ============================================================
// PDF REPORT (jsPDF, A4 portrait, millimetres)
// ============================================================
const PDF_FONT_SIZE = { A: 10, B: 9.5, C: 8.5, D: 8, E: 8.5 };

function pdfRGB(hex) { return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]; }

// Lays out "Label: value | Label: value" lines with bold labels, wrapping words.
// Returns the height used; draws only when draw = true.
function pdfRichText(doc, lines, x, y, w, size, draw) {
  const lh = size * 0.42;
  let cy = y + lh * 0.85;
  const space = () => { doc.setFont('helvetica', 'normal'); doc.setFontSize(size); return doc.getTextWidth(' '); };
  lines.forEach(line => {
    const tokens = [];
    line.forEach(([label, value], i) => {
      if (i) tokens.push({ t: '|', sep: true });
      tokens.push({ t: label + ':', b: true });
      String(value).split(/\s+/).filter(Boolean).forEach(word => tokens.push({ t: word }));
    });
    let cx = x;
    tokens.forEach(tok => {
      doc.setFont('helvetica', tok.b ? 'bold' : 'normal');
      doc.setFontSize(size);
      let word = tok.t;
      let tw = doc.getTextWidth(word);
      if (cx > x && cx + tw > x + w) { cx = x; cy += lh; }
      // a single word longer than the line (e.g. a long number) is broken up
      while (tw > w) {
        let cut = word.length - 1;
        while (cut > 1 && doc.getTextWidth(word.slice(0, cut)) > w) cut--;
        if (draw) doc.text(word.slice(0, cut), cx, cy);
        word = word.slice(cut); tw = doc.getTextWidth(word); cx = x; cy += lh;
      }
      if (draw) {
        doc.setTextColor(...pdfRGB(tok.sep ? '8A96A8' : tok.b ? RC.ink : '3C4858'));
        doc.text(word, cx, cy);
      }
      cx += tw + space();
    });
    cy += lh;
  });
  return cy - y - lh * 0.55;
}

async function buildPDF(pages, imgs, meta, opts) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const PW = 210, PH = 297, M = 15;
  const W = PW - 2 * M;
  const size = PDF_FONT_SIZE[meta.layout];
  const L = LAYOUTS[meta.layout];

  // Header: full project name, report title below
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
  const nameLines = doc.splitTextToSize(meta.fullName, W - 10);
  const headH = 9 + nameLines.length * 5.4 + 6;

  const drawHeader = () => {
    doc.setTextColor(...pdfRGB(RC.ink));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
    nameLines.forEach((ln, i) => doc.text(ln, PW / 2, 13 + i * 5.4, { align: 'center' }));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    doc.setTextColor(...pdfRGB('3C4858'));
    doc.text(meta.title, PW / 2, 13 + nameLines.length * 5.4 + 0.6, { align: 'center' });
    doc.setDrawColor(...pdfRGB(RC.navy)); doc.setLineWidth(0.6);
    doc.line(M, headH, PW - M, headH);
  };

  const top = headH + 6, bottom = PH - 17;
  let photoNo = 0;

  pages.forEach((page, pi) => {
    if (pi) doc.addPage();
    drawHeader();
    let y = top;

    if (page.group) {
      const gl = [page.group.header];
      const h = pdfRichText(doc, gl, M + 4, y + 2.5, W - 8, size + 0.5, false) + 6.5 + size * 0.42;
      doc.setFillColor(...pdfRGB('F7F9FB')); doc.setDrawColor(...pdfRGB(RC.line)); doc.setLineWidth(0.25);
      doc.rect(M, y, W, h, 'FD');
      pdfRichText(doc, gl, M + 4, y + 2.5, W - 8, size + 0.5, true);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size - 0.5); doc.setTextColor(...pdfRGB(RC.muted));
      doc.text(page.group.note, M + 4, y + h - 3);
      y += h + 5;
    }

    const rows = Math.ceil(L.perPage / L.cols);
    const gapX = 6, gapY = L.perPage > 2 ? 5 : 7;
    const cellW = (W - gapX * (L.cols - 1)) / L.cols;
    const cellH = (bottom - y - gapY * (rows - 1)) / rows;
    const caps = page.items.map(p => captionLines(p, opts, !!page.group));
    const capH = Math.min(cellH * 0.45, Math.max(...caps.map(c => pdfRichText(doc, c, 0, 0, cellW - 6, size, false))) + 5);
    const boxH = Math.min(cellH - capH, cellW * 0.75);

    page.items.forEach((p, i) => {
      photoNo++;
      const col = i % L.cols, row = Math.floor(i / L.cols);
      const x = M + col * (cellW + gapX);
      const cy = y + row * (boxH + capH + gapY);
      const im = imgs.get(p.id);

      doc.setFillColor(...pdfRGB('E9EDF2'));
      doc.rect(x, cy, cellW, boxH, 'F');
      if (im) {
        const f = fitBox(im.w, im.h, cellW, boxH);
        doc.addImage(im.data, 'JPEG', x + f.dx, cy + f.dy, f.w, f.h, undefined, 'FAST');
      }
      // badge: photo number, or the date in the date-wise layout
      const badge = page.group ? p.displayDate : `Photo ${photoNo}`;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(size - 1);
      const bw = doc.getTextWidth(badge) + 4;
      doc.setFillColor(...pdfRGB(RC.badge));
      doc.rect(x + 2, cy + 2, bw, size * 0.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.text(badge, x + 4, cy + 2 + size * 0.36);

      doc.setFillColor(...pdfRGB('F7F9FB')); doc.setDrawColor(...pdfRGB(RC.line)); doc.setLineWidth(0.25);
      doc.rect(x, cy + boxH, cellW, capH, 'FD');
      doc.rect(x, cy, cellW, boxH, 'S');
      pdfRichText(doc, caps[i], x + 3, cy + boxH + 2, cellW - 6, size, true);
    });
  });

  // Footer on every page: engineer and page numbers
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...pdfRGB(RC.line)); doc.setLineWidth(0.25);
    doc.line(M, PH - 12, PW - M, PH - 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...pdfRGB(RC.muted));
    if (meta.preparedBy) doc.text('Prepared by: ' + meta.preparedBy, M, PH - 7.5);
    doc.text(`Page ${i} of ${total}`, PW - M, PH - 7.5, { align: 'right' });
    if (meta.watermark) {
      // Free version: the CivilCam Pro logo, large and faded across the page, over the photos
      const S = 130;
      doc.addImage(meta.watermark.faded, 'PNG', (PW - S) / 2, (PH - S) / 2, S, S, 'cc-watermark', 'FAST');
      // and a small full-colour logo with the line in the footer
      const label = meta.brand || 'Made with CivilCam Pro';
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...pdfRGB(RC.muted));
      const tw = doc.getTextWidth(label), logo = 5;
      const lx = PW / 2 - (logo + 1.5 + tw) / 2;
      doc.addImage(meta.watermark.small, 'PNG', lx, PH - 10.6, logo, logo, 'cc-logo-small', 'FAST');
      doc.text(label, lx + logo + 1.5, PH - 7.2);
    } else if (meta.brand) { doc.setFontSize(7); doc.text(meta.brand, PW / 2, PH - 4, { align: 'center' }); }
  }

  doc.setProperties({ title: `${meta.fullName} — ${meta.title}`, author: meta.preparedBy || '', creator: 'CivilCam Pro' });
  return doc.output('blob');
}
