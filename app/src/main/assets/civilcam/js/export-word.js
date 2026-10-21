// ============================================================
// WORD REPORT (docx.js — a real .docx with header, footer and page numbers)
// ============================================================
const WORD_BOX = { A: [660, 495], B: [640, 330], C: [320, 240], D: [320, 196], E: [320, 240] };   // pixels
const WORD_SIZE = { A: 20, B: 19, C: 17, D: 16, E: 17 };                                            // half-points

function wordCaptionParas(lines, size, D) {
  return lines.map(line => {
    const runs = [];
    line.forEach(([label, value], i) => {
      if (i) runs.push(new D.TextRun({ text: '  |  ', color: '8A96A8', size }));
      runs.push(new D.TextRun({ text: label + ': ', bold: true, color: RC.ink, size }));
      runs.push(new D.TextRun({ text: String(value), color: '3C4858', size }));
    });
    return new D.Paragraph({
      children: runs, spacing: { before: 20, after: 20 },
      shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: 'F7F9FB' }
    });
  });
}

async function buildWord(pages, imgs, meta, opts) {
  const D = window.docx;
  const L = LAYOUTS[meta.layout];
  const [boxW, boxH] = WORD_BOX[meta.layout];
  const size = WORD_SIZE[meta.layout];
  const CONTENT_TW = 11906 - 2 * 850;                 // A4 width minus margins, in twips
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: RC.line };
  const borders = { top: border, bottom: border, left: border, right: border };
  const none = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

  const body = [];
  let photoNo = 0;
  pages.forEach((page, pi) => {
    if (page.group) {
      body.push(new D.Table({
        width: { size: CONTENT_TW, type: D.WidthType.DXA },
        columnWidths: [CONTENT_TW],
        rows: [new D.TableRow({ children: [new D.TableCell({
          borders, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: 'F7F9FB' },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: wordCaptionParas([page.group.header], size + 1, D).concat(
            new D.Paragraph({ children: [new D.TextRun({ text: page.group.note, color: RC.muted, size: size - 1 })] }))
        })] })]
      }));
      body.push(new D.Paragraph({ spacing: { after: 60 }, children: [] }));
    }

    const colTw = Math.floor(CONTENT_TW / L.cols);
    const rows = [];
    for (let r = 0; r < page.items.length; r += L.cols) {
      const cells = [];
      for (let c = 0; c < L.cols; c++) {
        const p = page.items[r + c];
        if (!p) { cells.push(new D.TableCell({ borders: noBorders, children: [new D.Paragraph({})] })); continue; }
        photoNo++;
        const im = imgs.get(p.id);
        const kids = [new D.Paragraph({
          spacing: { after: 40 },
          children: [new D.TextRun({ text: page.group ? p.displayDate : `Photo ${photoNo}`, bold: true, color: 'FFFFFF', size: size - 2, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: RC.badge } })]
        })];
        if (im) {
          const f = fitBox(im.w, im.h, boxW, boxH);
          kids.push(new D.Paragraph({
            alignment: D.AlignmentType.CENTER, spacing: { after: 60 },
            children: [new D.ImageRun({ type: 'jpg', data: dataUrlToBytes(im.data), transformation: { width: Math.round(f.w), height: Math.round(f.h) } })]
          }));
        }
        kids.push(...wordCaptionParas(captionLines(p, opts, !!page.group), size, D));
        cells.push(new D.TableCell({
          borders, width: { size: colTw, type: D.WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: kids
        }));
      }
      rows.push(new D.TableRow({ cantSplit: true, children: cells }));
    }
    body.push(new D.Table({
      width: { size: CONTENT_TW, type: D.WidthType.DXA },
      columnWidths: new Array(L.cols).fill(colTw),
      rows
    }));
    if (pi < pages.length - 1) body.push(new D.Paragraph({ children: [new D.PageBreak()] }));
  });

  const header = new D.Header({ children: [
    new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: meta.fullName, bold: true, size: 24, color: RC.ink })] }),
    new D.Paragraph({
      alignment: D.AlignmentType.CENTER, spacing: { after: 120 },
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: RC.navy, space: 6 } },
      children: [new D.TextRun({ text: meta.title, size: 19, color: '3C4858' })]
    })
  ] });

  const footer = new D.Footer({ children: [new D.Paragraph({
    border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: RC.line, space: 4 } },
    tabStops: [{ type: D.TabStopType.RIGHT, position: CONTENT_TW }],
    children: [
      new D.TextRun({ text: meta.preparedBy ? 'Prepared by: ' + meta.preparedBy : '', size: 17, color: RC.muted }),
      new D.TextRun({ children: ['\tPage ', D.PageNumber.CURRENT, ' of ', D.PageNumber.TOTAL_PAGES], size: 17, color: RC.muted })
    ]
  })].concat(meta.brand ? [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: meta.brand, size: 14, color: RC.muted })] })] : []) });

  const doc = new D.Document({
    creator: meta.preparedBy || 'CivilCam Pro',
    title: `${meta.fullName} — ${meta.title}`,
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 850, left: 850, right: 850, header: 400, footer: 400 } } },
      headers: { default: header },
      footers: { default: footer },
      children: body
    }]
  });
  return D.Packer.toBlob(doc);
}
