// ============================================================
// EXPORT
// ============================================================
function setExportPeriod(period, el) {
  currentExportPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  updateExportCount();
}

function selectTemplate(tmpl, el) {
  currentTemplate = tmpl;
  document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function selectFormat(fmt, el) {
  currentFormat = fmt;
  document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function getExportPhotos() {
  const now = new Date();
  let sel = [...photos];

  // Use selected photos from gallery if any
  if (selectedPhotos.size > 0) {
    sel = photos.filter(p => selectedPhotos.has(p.id));
  } else {
    // Filter by period
    if (currentExportPeriod !== 'all') {
      sel = sel.filter(p => {
        const d = new Date(p.timestamp);
        if (currentExportPeriod === 'today') return p.date === now.toISOString().split('T')[0];
        if (currentExportPeriod === 'week') return getWeekNumber(d) === getWeekNumber(now);
        if (currentExportPeriod === 'month') return p.month === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        if (currentExportPeriod === 'quarter') { const q = Math.ceil((now.getMonth()+1)/3); return p.quarter === `${now.getFullYear()}-Q${q}`; }
        if (currentExportPeriod === 'year') return p.year === String(now.getFullYear());
        return true;
      });
    }
  }
  return sel;
}

function updateExportCount() {
  const count = getExportPhotos().length;
  document.getElementById('export-photo-count').textContent = count;
  const btn = document.getElementById('export-generate-btn');
  btn.disabled = count === 0;
}

async function generateExport() {
  const exportPhotos = getExportPhotos();
  if (exportPhotos.length === 0) { showToast('No photos to export', 'danger'); return; }

  const heading = document.getElementById('report-heading').value.trim() || 'Site Progress Photographs';
  const prepBy = document.getElementById('report-prepared-by').value.trim() || 'Civil Engineer';

  showLoading('Generating ' + currentFormat.toUpperCase() + '...', `Processing ${exportPhotos.length} photos`);

  try {
    await new Promise(r => setTimeout(r, 100)); // Let UI update

    if (currentFormat === 'pdf') {
      await generatePDF(exportPhotos, heading, prepBy);
    } else if (currentFormat === 'excel') {
      await generateExcel(exportPhotos, heading, prepBy);
    } else if (currentFormat === 'word') {
      await generateWord(exportPhotos, heading, prepBy);
    }
  } catch(e) {
    console.error('Export error:', e);
    showToast('Export failed: ' + e.message, 'danger');
  } finally {
    hideLoading();
  }
}

// ============================================================
// PDF GENERATION
// ============================================================
async function generatePDF(exportPhotos, heading, prepBy) {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { showToast('PDF library not loaded', 'danger'); return; }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297;
  const margin = 14;

  // ---- Cover Page ----
  // Background
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, H, 'F');

  // Header bar
  doc.setFillColor(245, 158, 11);
  doc.rect(0, 0, W, 6, 'F');
  doc.rect(0, H - 6, W, 6, 'F');

  // Left accent bar
  doc.setFillColor(245, 158, 11);
  doc.rect(margin - 2, 20, 4, 60, 'F');

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(245, 158, 11);
  doc.text(heading, margin + 8, 40, {maxWidth: W - margin * 2 - 8});

  doc.setFontSize(14);
  doc.setTextColor(148, 163, 184);
  doc.text(projectName, margin + 8, 60);

  // Stats boxes
  const now = new Date();
  const statsY = 85;
  const boxW = (W - margin * 2 - 8) / 3;
  [
    {label: 'Total Photos', value: String(exportPhotos.length)},
    {label: 'Generated', value: now.toLocaleDateString('en-IN')},
    {label: 'Prepared By', value: prepBy},
  ].forEach((item, i) => {
    const x = margin + i * (boxW + 4);
    doc.setFillColor(30, 41, 59);
    doc.roundedRect(x, statsY, boxW, 24, 3, 3, 'F');
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(245, 158, 11);
    doc.text(item.value, x + boxW / 2, statsY + 12, {align:'center'});
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(item.label, x + boxW / 2, statsY + 19, {align:'center'});
  });

  // Activity breakdown
  const actMap = {};
  exportPhotos.forEach(p => { actMap[p.activity] = (actMap[p.activity] || 0) + 1; });
  let actY = statsY + 34;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(148, 163, 184);
  doc.text('ACTIVITY BREAKDOWN', margin, actY);
  actY += 6;
  Object.entries(actMap).forEach(([act, count]) => {
    doc.setFillColor(30, 41, 59);
    doc.rect(margin, actY, W - margin * 2, 8, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(241, 245, 249);
    doc.text(act, margin + 3, actY + 5.5);
    const barW = ((W - margin * 2 - 40) * count / exportPhotos.length);
    doc.setFillColor(245, 158, 11);
    doc.rect(margin + (W - margin * 2) * 0.55, actY + 1.5, barW * 0.4, 5, 'F');
    doc.setTextColor(245, 158, 11);
    doc.text(String(count), W - margin - 2, actY + 5.5, {align:'right'});
    actY += 10;
    if (actY > H - 30) return;
  });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Generated by CivilCam Pro', margin, H - 10);
  doc.text(now.toLocaleString('en-IN'), W - margin, H - 10, {align:'right'});

  // ---- Photo Pages ----
  if (currentTemplate === 'grid') {
    await pdfGridLayout(doc, exportPhotos, heading, prepBy);
  } else if (currentTemplate === 'inspection') {
    await pdfInspectionLayout(doc, exportPhotos, heading, prepBy);
  } else if (currentTemplate === 'activity') {
    await pdfActivityLayout(doc, exportPhotos, heading, prepBy);
  } else if (currentTemplate === 'table') {
    await pdfTableLayout(doc, exportPhotos, heading, prepBy);
  }

  // Save
  const filename = `${projectName}_${heading}_${now.toISOString().split('T')[0]}.pdf`;
  const ok = await saveFile(doc.output('blob'), filename, 'application/pdf');
  savedMessage(ok, 'PDF', 'application/pdf');
}

async function pdfGridLayout(doc, photos, heading, prepBy) {
  const W = 210, H = 297, margin = 10;
  const photoW = (W - margin * 2 - 6) / 2;
  const photoH = photoW * 0.7;
  const cellH = photoH + 14;
  const cols = 2, rows = 2;
  const perPage = cols * rows;

  for (let page = 0; page < Math.ceil(photos.length / perPage); page++) {
    doc.addPage();
    const pagePhotos = photos.slice(page * perPage, (page + 1) * perPage);

    // Page header
    doc.setFillColor(245, 158, 11);
    doc.rect(0, 0, W, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(projectName, margin, 9);
    doc.text(heading, W / 2, 9, {align:'center'});
    doc.text(`Page ${page + 2}`, W - margin, 9, {align:'right'});

    // Grid
    pagePhotos.forEach((photo, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = margin + col * (photoW + 6);
      const y = 18 + row * (cellH + 6);

      // Photo border box
      doc.setDrawColor(51, 65, 85);
      doc.setLineWidth(0.3);
      doc.rect(x, y, photoW, photoH + 12);

      // Photo
      try {
        doc.addImage(photo.imageData, 'JPEG', x + 0.5, y + 0.5, photoW - 1, photoH - 1);
      } catch(e) {}

      // Caption bar
      doc.setFillColor(15, 23, 42);
      doc.rect(x, y + photoH, photoW, 12, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(245, 158, 11);
      doc.text([photo.activity, siteLabel(photo.chainage, photo.side)].filter(Boolean).join('  |  ').slice(0, 60), x + 2, y + photoH + 5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(photo.displayDate + ' ' + photo.displayTime, x + 2, y + photoH + 10);
      if (photo.remarks) {
        doc.setTextColor(200, 200, 200);
        doc.text(photo.remarks.slice(0, 30), x + photoW / 2, y + photoH + 10, {align:'center'});
      }
    });

    // Page footer
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Prepared by: ${prepBy}  |  ${new Date().toLocaleDateString('en-IN')}  |  CivilCam Pro`, W / 2, H - 6, {align:'center'});
  }
}

async function pdfInspectionLayout(doc, photos, heading, prepBy) {
  const W = 210, H = 297, margin = 12;
  const perPage = 3;

  for (let page = 0; page < Math.ceil(photos.length / perPage); page++) {
    doc.addPage();
    const pagePhotos = photos.slice(page * perPage, (page + 1) * perPage);

    // Header
    doc.setFillColor(245, 158, 11);
    doc.rect(0, 0, W, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(projectName, margin, 9);
    doc.text(heading, W / 2, 9, {align:'center'});
    doc.text(`Page ${page + 2}`, W - margin, 9, {align:'right'});

    let y = 20;
    const itemH = (H - 30 - 20) / perPage;
    const photoW = itemH * 0.85;
    const metaX = margin + photoW + 4;
    const metaW = W - margin - photoW - 4 - margin;

    pagePhotos.forEach(photo => {
      // Box
      doc.setDrawColor(51, 65, 85);
      doc.setLineWidth(0.3);
      doc.rect(margin, y, W - margin * 2, itemH - 3);

      // Photo
      try {
        doc.addImage(photo.imageData, 'JPEG', margin + 1, y + 1, photoW - 2, itemH - 5);
      } catch(e) {}

      // Meta panel
      doc.setFillColor(15, 23, 42);
      doc.rect(metaX, y, metaW, itemH - 3, 'F');

      let my = y + 6;
      const line = (label, value, color = [241, 245, 249]) => {
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(label, metaX + 3, my);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...color);
        doc.text(String(value || '-').slice(0, 24), metaX + 3, my + 4.5);
        my += 10;
      };

      line('ACTIVITY', photo.activity, [245, 158, 11]);
      line('CHAINAGE', photo.chainage || '-');
      line('SIDE', photo.side || '-');
      line('DATE & TIME', `${photo.displayDate} ${photo.displayTime}`);
      if (photo.location) line('GPS COORDINATES', `${photo.location.lat}, ${photo.location.lng}`);
      if (photo.remarks) line('REMARKS', photo.remarks);

      y += itemH;
    });

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Prepared by: ${prepBy}  |  CivilCam Pro`, W / 2, H - 6, {align:'center'});
  }
}

async function pdfActivityLayout(doc, photos, heading, prepBy) {
  const W = 210, H = 297, margin = 12;
  const actMap = {};
  photos.forEach(p => { if (!actMap[p.activity]) actMap[p.activity] = []; actMap[p.activity].push(p); });

  let actPage = 0;
  for (const [activity, actPhotos] of Object.entries(actMap)) {
    const photoW = (W - margin * 2 - 6) / 3;
    const photoH = photoW * 0.75;
    const perPage = 6;

    for (let page = 0; page < Math.ceil(actPhotos.length / perPage); page++) {
      doc.addPage();
      const pagePhotos = actPhotos.slice(page * perPage, (page + 1) * perPage);

      // Header
      doc.setFillColor(245, 158, 11);
      doc.rect(0, 0, W, 14, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      doc.text(projectName, margin, 9);
      doc.text(heading, W / 2, 9, {align:'center'});
      doc.text(`Page ${actPage + 2}`, W - margin, 9, {align:'right'});

      // Activity heading
      doc.setFillColor(30, 41, 59);
      doc.rect(0, 14, W, 12, 'F');
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(245, 158, 11);
      doc.text(`▌ ${activity.toUpperCase()}`, margin, 22);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`${actPhotos.length} photo${actPhotos.length > 1 ? 's' : ''}`, W - margin, 22, {align:'right'});

      // Photos grid (3 cols x 2 rows)
      pagePhotos.forEach((photo, idx) => {
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        const x = margin + col * (photoW + 3);
        const y = 30 + row * (photoH + 16);

        doc.setDrawColor(51, 65, 85);
        doc.setLineWidth(0.3);
        doc.rect(x, y, photoW, photoH + 12);

        try { doc.addImage(photo.imageData, 'JPEG', x + 0.5, y + 0.5, photoW - 1, photoH - 1); } catch(e) {}

        doc.setFillColor(15, 23, 42);
        doc.rect(x, y + photoH, photoW, 12, 'F');
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text([photo.displayDate, siteLabel(photo.chainage, photo.side)].filter(Boolean).join('  ').slice(0, 34), x + 2, y + photoH + 5);
        doc.setTextColor(200, 200, 200);
        if (photo.remarks) doc.text(photo.remarks.slice(0, 16), x + 2, y + photoH + 10);
      });

      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`Prepared by: ${prepBy}  |  CivilCam Pro`, W / 2, H - 6, {align:'center'});
      actPage++;
    }
  }
}

async function pdfTableLayout(doc, photos, heading, prepBy) {
  const W = 210, H = 297, margin = 10;

  // Page with table log
  const perPage = 30;
  for (let page = 0; page < Math.ceil(photos.length / perPage); page++) {
    doc.addPage();
    const pagePhotos = photos.slice(page * perPage, (page + 1) * perPage);

    doc.setFillColor(245, 158, 11);
    doc.rect(0, 0, W, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(projectName, margin, 9);
    doc.text(heading, W / 2, 9, {align:'center'});
    doc.text(`Page ${page + 2}`, W - margin, 9, {align:'right'});

    // Table header
    const cols = [['#','8'],['Date','21'],['Activity','36'],['Chainage','22'],['Side','20'],['GPS','40'],['Remarks','43']];
    let x = margin, y = 20;
    const rowH = 7;

    doc.setFillColor(30, 41, 59);
    doc.rect(margin, y, W - margin * 2, rowH, 'F');
    x = margin;
    cols.forEach(([label, w]) => {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(245, 158, 11);
      doc.text(label, x + 2, y + 5);
      x += parseFloat(w);
    });
    y += rowH;

    pagePhotos.forEach((photo, i) => {
      if (i % 2 === 0) { doc.setFillColor(15, 23, 42); doc.rect(margin, y, W - margin * 2, rowH, 'F'); }
      x = margin;
      const gpsStr = photo.location ? `${photo.location.lat}, ${photo.location.lng}` : '-';
      const values = [String(page * perPage + i + 1), photo.displayDate, photo.activity, photo.chainage || '-', photo.side || '-', gpsStr, photo.remarks || '-'];
      cols.forEach(([, w], ci) => {
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(241, 245, 249);
        doc.text(String(values[ci]).slice(0, Math.floor(parseFloat(w) / 2.5)), x + 2, y + 4.8);
        x += parseFloat(w);
      });
      // Grid lines
      doc.setDrawColor(51, 65, 85);
      doc.setLineWidth(0.1);
      doc.line(margin, y + rowH, W - margin, y + rowH);
      y += rowH;
    });

    // Outer border
    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(0.4);
    doc.rect(margin, 20, W - margin * 2, y - 20);

    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Prepared by: ${prepBy}  |  CivilCam Pro`, W / 2, H - 6, {align:'center'});
  }
}

