// ============================================================
// EXCEL PHOTO REGISTER (ExcelJS): S.No | Photo | Description
// ============================================================
async function buildExcel(list, imgs, meta, opts) {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.preparedBy || 'CivilCam Pro';
  wb.created = new Date();
  const ws = wb.addWorksheet('Photo Register', {
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: '1:3', horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 }
    },
    headerFooter: {
      oddFooter: `&L&8${(meta.preparedBy ? 'Prepared by: ' + meta.preparedBy : '').replace(/&/g, '&&')}&R&8Page &P of &N`
    }
  });

  // Photo column ~330 px wide, rows ~200 px tall so the picture fills the cell
  const PHOTO_W = 330, ROW_PX = 200;
  ws.columns = [{ width: 7 }, { width: 47 }, { width: 62 }];

  const thin = { style: 'thin', color: { argb: 'FF' + RC.line } };
  const allBorders = { top: thin, bottom: thin, left: thin, right: thin };

  ws.mergeCells('A1:C1');
  const t1 = ws.getCell('A1');
  t1.value = meta.fullName;
  t1.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  t1.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + RC.navy } };
  ws.getRow(1).height = Math.max(30, Math.ceil(meta.fullName.length / 80) * 20);

  ws.mergeCells('A2:C2');
  const t2 = ws.getCell('A2');
  t2.value = meta.title;
  t2.font = { name: 'Calibri', size: 11, color: { argb: 'FFD5DEEA' } };
  t2.alignment = { horizontal: 'center', vertical: 'middle' };
  t2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + RC.navy } };
  ws.getRow(2).height = 20;

  const head = ws.getRow(3);
  head.values = ['S.No', 'Photo', 'Description'];
  head.height = 22;
  head.eachCell(c => {
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF' + RC.ink } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE4EE' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = { top: thin, left: thin, right: thin, bottom: { style: 'medium', color: { argb: 'FF' + RC.navy } } };
  });

  list.forEach((p, i) => {
    const r = i + 4;
    const row = ws.getRow(r);
    row.values = [i + 1, '', captionSentence(p, opts)];
    row.height = ROW_PX * 0.75;        // points
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { vertical: 'middle', wrapText: true };
    row.getCell(1).font = { name: 'Calibri', size: 11 };
    row.getCell(3).font = { name: 'Calibri', size: 11, color: { argb: 'FF' + RC.ink } };
    [1, 2, 3].forEach(c => { row.getCell(c).border = allBorders; });
    if (i % 2) [1, 2, 3].forEach(c => { row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFC' } }; });

    const im = imgs.get(p.id);
    if (im) {
      const pad = 6;
      const f = fitBox(im.w, im.h, PHOTO_W - pad * 2, ROW_PX - pad * 2);
      const id = wb.addImage({ base64: im.data, extension: 'jpeg' });
      // position inside cell B<r>: fractional column/row offsets centre the picture
      ws.addImage(id, {
        tl: { col: 1 + (pad + f.dx) / PHOTO_W, row: r - 1 + (pad + f.dy) / ROW_PX },
        ext: { width: f.w, height: f.h },
        editAs: 'oneCell'
      });
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
