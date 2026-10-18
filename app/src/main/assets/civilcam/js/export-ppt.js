// ============================================================
// POWERPOINT (PptxGenJS, 16:9 slides — inches)
// ============================================================
const PPT_GRID = { A: [1, 1], B: [2, 1], C: [4, 1], D: [3, 2], E: [4, 1] };   // [columns, rows]
const PPT_SIZE = { A: 13, B: 11, C: 9.5, D: 8.5, E: 9.5 };

function pptRuns(lines, size) {
  const runs = [];
  lines.forEach((line, li) => {
    line.forEach(([label, value], i) => {
      if (i) runs.push({ text: '  |  ', options: { color: '8A96A8', fontSize: size } });
      runs.push({ text: label + ': ', options: { bold: true, color: RC.ink, fontSize: size } });
      runs.push({ text: String(value), options: { color: '3C4858', fontSize: size } });
    });
    if (li < lines.length - 1) runs.push({ text: '', options: { breakLine: true } });
  });
  // pptxgenjs breaks a line after a run that has breakLine; move it onto the last run of each line
  const out = [];
  runs.forEach(r => {
    if (r.options.breakLine && out.length) { out[out.length - 1].options.breakLine = true; return; }
    out.push(r);
  });
  return out;
}

async function buildPPT(slidesPages, imgs, meta, opts) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';                // 10 × 5.625 in
  pptx.author = meta.preparedBy || 'CivilCam Pro';
  pptx.title = `${meta.fullName} — ${meta.title}`;
  const SW = 10, SH = 5.625, M = 0.4;
  const [cols, rows] = PPT_GRID[meta.layout];
  const size = PPT_SIZE[meta.layout];
  const total = slidesPages.length;
  let photoNo = 0;

  slidesPages.forEach((page, si) => {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addText(meta.fullName, { x: M, y: 0.12, w: SW - 2 * M, h: 0.42, fontSize: 15, bold: true, color: RC.ink, align: 'center', valign: 'middle', fit: 'shrink', fontFace: 'Calibri' });
    s.addText(meta.title, { x: M, y: 0.52, w: SW - 2 * M, h: 0.26, fontSize: 10.5, color: '3C4858', align: 'center', valign: 'middle', fontFace: 'Calibri' });
    s.addShape(pptx.ShapeType.line, { x: M, y: 0.84, w: SW - 2 * M, h: 0, line: { color: RC.navy, width: 2 } });
    s.addText(meta.preparedBy ? 'Prepared by: ' + meta.preparedBy : '', { x: M, y: SH - 0.34, w: 5, h: 0.24, fontSize: 8.5, color: RC.muted, fontFace: 'Calibri' });
    s.addText(`Slide ${si + 1} of ${total}`, { x: SW - M - 3, y: SH - 0.34, w: 3, h: 0.24, fontSize: 8.5, color: RC.muted, align: 'right', fontFace: 'Calibri' });

    let top = 1.0;
    if (page.group) {
      s.addText(pptRuns([page.group.header], size + 1).concat([{ text: '   ' + page.group.note, options: { color: RC.muted, fontSize: size - 1, italic: true } }]),
        { x: M, y: top, w: SW - 2 * M, h: 0.36, fill: { color: 'F7F9FB' }, line: { color: RC.line, width: 0.75 }, valign: 'middle', margin: 4, fit: 'shrink', fontFace: 'Calibri' });
      top += 0.46;
    }
    const bottom = SH - 0.42;
    const gap = 0.16;
    const cellW = (SW - 2 * M - gap * (cols - 1)) / cols;
    const cellH = (bottom - top - gap * (rows - 1)) / rows;
    const capLines = cols >= 3 ? 4 : 2.6;
    const capH = Math.min(cellH * 0.42, size / 72 * 1.25 * capLines + 0.12);
    const boxH = cellH - capH;

    page.items.forEach((p, i) => {
      photoNo++;
      const c = i % cols, r = Math.floor(i / cols);
      const x = M + c * (cellW + gap), y = top + r * (cellH + gap);
      s.addShape(pptx.ShapeType.rect, { x, y, w: cellW, h: boxH, fill: { color: 'E9EDF2' }, line: { color: RC.line, width: 0.75 } });
      const im = imgs.get(p.id);
      if (im) {
        const f = fitBox(im.w, im.h, cellW, boxH);
        s.addImage({ data: im.data, x: x + f.dx, y: y + f.dy, w: f.w, h: f.h });
      }
      const badge = page.group ? p.displayDate : `Photo ${photoNo}`;
      s.addText(badge, { x: x + 0.06, y: y + 0.06, w: Math.min(cellW - 0.12, 0.12 + badge.length * size * 0.0085), h: size / 72 * 1.5, fontSize: size - 1.5, bold: true, color: 'FFFFFF', fill: { color: RC.badge }, margin: 2, fontFace: 'Calibri' });
      s.addText(pptRuns(captionLines(p, opts, !!page.group), size),
        { x, y: y + boxH, w: cellW, h: capH, fill: { color: 'F7F9FB' }, line: { color: RC.line, width: 0.75 }, valign: 'top', margin: 4, fit: 'shrink', fontFace: 'Calibri' });
    });
  });

  return pptx.write({ outputType: 'blob' });
}

// Slides hold a different number of photos than pages, so they are grouped separately
function paginateSlides(list, layoutKey, project) {
  const [cols, rows] = PPT_GRID[layoutKey];
  const per = cols * rows;
  const savedPer = LAYOUTS[layoutKey].perPage;
  LAYOUTS[layoutKey].perPage = per;
  try { return paginate(list, layoutKey, project); } finally { LAYOUTS[layoutKey].perPage = savedPer; }
}
