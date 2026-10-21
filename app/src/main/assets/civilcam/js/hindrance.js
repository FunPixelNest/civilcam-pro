// ============================================================
// HINDRANCE REGISTER
// Every photo of type "Hindrance" becomes an entry: H-001, H-002 …
// An entry stays open until it is marked cleared, ideally with a
// clearance photo taken at the same spot (see repeat.js).
// photo.hind = { ref, status: 'open' | 'cleared', clearedAt, clearedPhotoId, clearedNote }
// ============================================================
let hindFilter = 'open';

function hindrancePhotos(projectId) {
  return projectPhotos(projectId).filter(p => p.photoType === 'Hindrance');
}

// Gives every hindrance photo a reference number, oldest first
async function ensureHindranceRefs(projectId = currentProject && currentProject.id) {
  if (!projectId) return;
  const list = hindrancePhotos(projectId).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let next = list.reduce((m, p) => Math.max(m, p.hind ? parseInt(String(p.hind.ref).replace(/\D/g, ''), 10) || 0 : 0), 0);
  for (const p of list) {
    if (p.hind && p.hind.ref) continue;
    next++;
    p.hind = Object.assign({ status: 'open', clearedAt: null, clearedPhotoId: '', clearedNote: '' }, p.hind || {}, { ref: 'H-' + String(next).padStart(3, '0') });
    p.updatedAt = Date.now(); p.synced = false;
    await DB.save(p);
  }
}

function hindDays(p) {
  const end = p.hind && p.hind.status === 'cleared' && p.hind.clearedAt ? new Date(p.hind.clearedAt) : new Date();
  return Math.max(0, Math.round((end - new Date(p.timestamp)) / 86400000));
}

function openHindranceCount() {
  return currentProject ? hindrancePhotos().filter(p => !p.hind || p.hind.status !== 'cleared').length : 0;
}

function updateHindranceBadge() {
  const b = document.getElementById('hind-badge');
  if (!b) return;
  const n = openHindranceCount();
  b.textContent = n;
  b.style.display = n ? '' : 'none';
}

async function renderHindrances() {
  if (!currentProject) return;
  await ensureHindranceRefs();
  const all = hindrancePhotos().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const open = all.filter(p => p.hind.status !== 'cleared');
  const cleared = all.filter(p => p.hind.status === 'cleared');
  const oldest = open.reduce((m, p) => Math.max(m, hindDays(p)), 0);
  const avgClear = cleared.length ? Math.round(cleared.reduce((s, p) => s + hindDays(p), 0) / cleared.length) : null;

  document.getElementById('hind-summary').innerHTML = `
    <div class="hs-box ${open.length ? 'warn' : ''}"><b>${open.length}</b><span>open</span></div>
    <div class="hs-box"><b>${cleared.length}</b><span>cleared</span></div>
    <div class="hs-box"><b>${open.length ? oldest : '—'}</b><span>oldest, days</span></div>
    <div class="hs-box"><b>${avgClear ?? '—'}</b><span>avg. days to clear</span></div>`;

  document.getElementById('hind-filter').innerHTML = [['open', `Open · ${open.length}`], ['cleared', `Cleared · ${cleared.length}`], ['all', `All · ${all.length}`]]
    .map(([k, label]) => `<button class="chip ${hindFilter === k ? 'active' : ''}" onclick="hindFilter='${k}';renderHindrances()">${label}</button>`).join('');

  const list = hindFilter === 'open' ? open : hindFilter === 'cleared' ? cleared : all;
  const box = document.getElementById('hind-list');
  if (!all.length) {
    box.innerHTML = `<div class="empty"><div class="empty-ic">${ic('alert', 40)}</div><div class="empty-title">No hindrances recorded</div>
      <div class="empty-sub">In the camera, open the details card and choose the photo type <b>Hindrance</b>. Each such photo gets a number here, with the land owner, phone and survey details.</div></div>`;
    return;
  }
  if (!list.length) { box.innerHTML = `<div class="empty"><div class="empty-title">Nothing here</div></div>`; return; }
  box.innerHTML = list.map(hindCardHTML).join('');
}

function hindCardHTML(p) {
  const h = p.hind, done = h.status === 'cleared';
  const days = hindDays(p);
  const after = done && h.clearedPhotoId ? photos.find(x => x.id === h.clearedPhotoId) : null;
  const facts = (p.fields || []).filter(f => f.value).slice(0, 4)
    .map(f => `<div><span>${esc(f.label)}</span>${esc(f.value)}</div>`).join('');
  return `<div class="hd-card ${done ? 'done' : days > 30 ? 'late' : ''}">
    <div class="hd-pics">
      <button class="hd-pic" onclick="openPhotoModal('${p.id}')" aria-label="Open hindrance photo"><img src="${p.imageData || ''}" alt=""><i>Raised</i></button>
      ${after ? `<button class="hd-pic" onclick="openPhotoModal('${after.id}')" aria-label="Open clearance photo"><img src="${after.imageData || ''}" alt=""><i>Cleared</i></button>` : ''}
    </div>
    <div class="hd-body">
      <div class="hd-top"><b>${esc(h.ref)}</b><span class="hd-pill">${done ? 'Cleared' : 'Open'}</span></div>
      <div class="hd-where">${esc([placeText(p, 'long'), p.side].filter(Boolean).join(' · ') || 'No location')}</div>
      <div class="hd-facts">${facts}</div>
      ${p.description ? `<div class="hd-desc">${esc(p.description)}</div>` : ''}
      <div class="hd-dates">Raised ${esc(p.displayDate)}${done ? ` · cleared ${fmtDate(new Date(h.clearedAt))} · took ${days} days` : ` · <b>${days} days open</b>`}</div>
      ${done && h.clearedNote ? `<div class="hd-desc">${esc(h.clearedNote)}</div>` : ''}
      <div class="hd-actions">
        ${done
          ? `<button class="btn small" onclick="reopenHindrance('${p.id}')">Reopen</button>`
          : `<button class="btn small primary" onclick="openClearSheet('${p.id}')">${ic('check', 16)}Mark cleared</button>`}
        <button class="btn small" onclick="startRepeat('${p.id}')">${ic('camera', 16)}Photo, same spot</button>
      </div>
    </div>
  </div>`;
}

// ---- clearing ----
let clearingId = null;
function openClearSheet(id) {
  clearingId = id;
  const p = photos.find(x => x.id === id);
  document.getElementById('clear-title').textContent = `Clear ${p.hind.ref}`;
  openSheet('clear-sheet');
}

function clearWithPhoto() {
  closeSheet('clear-sheet');
  startRepeat(clearingId, { clearHindrance: clearingId });
}

async function clearWithoutPhoto() {
  closeSheet('clear-sheet');
  const note = await askText('How was it cleared?', 'e.g. Compensation paid, land handed over on site', '');
  if (note === null) return;
  await markHindranceCleared(clearingId, { note });
}

async function markHindranceCleared(id, { photoId = '', note = '' } = {}) {
  const p = photos.find(x => x.id === id);
  if (!p) return;
  await ensureHindranceRefs(p.projectId);
  p.hind = Object.assign({}, p.hind, { status: 'cleared', clearedAt: new Date().toISOString(), clearedPhotoId: photoId, clearedNote: note });
  p.updatedAt = Date.now(); p.synced = false;
  await DB.save(p);
  Sync.schedule();
  updateHindranceBadge();
  showToast(`${p.hind.ref} marked cleared`, 'success');
  if (currentTab === 'hindrance') renderHindrances();
}

async function reopenHindrance(id) {
  const p = photos.find(x => x.id === id);
  if (!p) return;
  p.hind = Object.assign({}, p.hind, { status: 'open', clearedAt: null });
  p.updatedAt = Date.now(); p.synced = false;
  await DB.save(p);
  Sync.schedule();
  updateHindranceBadge();
  renderHindrances();
}

// ---- export: PDF (with before / after photos) and Excel ----
function hindRows() {
  return hindrancePhotos().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map(p => {
    const after = p.hind.clearedPhotoId ? photos.find(x => x.id === p.hind.clearedPhotoId) : null;
    return {
      p, after,
      ref: p.hind.ref,
      ch: [p.element, chainageText(p)].filter(Boolean).join(' · '),
      side: p.side || '',
      details: [fieldsText(p, '; '), p.description].filter(Boolean).join('. '),
      raised: p.displayDate,
      cleared: p.hind.status === 'cleared' && p.hind.clearedAt ? fmtDate(new Date(p.hind.clearedAt)) : '',
      days: hindDays(p),
      status: p.hind.status === 'cleared' ? 'Cleared' : 'Open',
      note: p.hind.clearedNote || ''
    };
  });
}

async function exportHindrances(format) {
  await ensureHindranceRefs();
  const rows = hindRows();
  if (!rows.length) { showToast('No hindrances to export', 'danger'); return; }
  showLoading('Creating hindrance register…', `${rows.length} entries`);
  try {
    const imgs = await loadReportImages(rows.flatMap(r => [r.p, r.after]).filter(Boolean), 600, () => {});
    const title = `Hindrance Register as on ${fmtDate(new Date())}`;
    const name = safeFileName(`${currentProject.name}_Hindrance_Register_${localDateKey(new Date())}.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
    const blob = format === 'pdf' ? await hindPDF(rows, imgs, title) : await hindExcel(rows, imgs, title);
    const mime = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    hideLoading();
    savedMessage(await saveFile(blob, name, mime), 'Hindrance register', mime);
  } catch (e) {
    hideLoading();
    showToast('Could not create the register: ' + e.message, 'danger');
  }
}

async function hindPDF(rows, imgs, title) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, H = 210, M = 10;
  const cols = [['Ref', 16], [usesElements(currentProject) ? 'Location' : 'Chainage', 30], ['Side', 18], ['Details', 70], ['Raised', 22], ['Cleared', 22], ['Days', 12], ['Status', 17], ['Raised photo', 35], ['Cleared photo', 35]];
  const rowH = 27, headH = 8;
  let y = 0, page = 0;
  const header = () => {
    page++;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(doc.splitTextToSize(currentProject.fullName || currentProject.name, W - 2 * M)[0], W / 2, M + 4, { align: 'center' });
    doc.setFontSize(11); doc.text(title, W / 2, M + 10, { align: 'center' });
    doc.setLineWidth(0.4); doc.line(M, M + 13, W - M, M + 13);
    y = M + 16;
    let x = M;
    doc.setFontSize(8);
    cols.forEach(([label, w]) => { doc.rect(x, y, w, headH); doc.text(label, x + 1.5, y + 5.3); x += w; });
    y += headH;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Page ${page}`, W - M, H - 5, { align: 'right' });
  };
  header();
  for (const r of rows) {
    if (y + rowH > H - 10) { doc.addPage(); header(); }
    let x = M;
    const values = [r.ref, r.ch, r.side, [r.details, r.note ? 'Cleared: ' + r.note : ''].filter(Boolean).join('\n'), r.raised, r.cleared, String(r.days), r.status];
    cols.forEach(([, w], i) => {
      doc.setLineWidth(0.2); doc.rect(x, y, w, rowH);
      if (i < values.length) {
        doc.setFont('helvetica', i === 0 || i === 7 ? 'bold' : 'normal');
        doc.text(doc.splitTextToSize(values[i] || '-', w - 3).slice(0, 7), x + 1.5, y + 4);
      } else {
        const ph = i === 8 ? r.p : r.after;
        const im = ph && imgs.get(ph.id);
        if (im) {
          const f = fitBox(im.w, im.h, w - 2, rowH - 2);
          try { doc.addImage(im.data, 'JPEG', x + 1 + f.dx, y + 1 + f.dy, f.w, f.h, undefined, 'FAST'); } catch (e) { /* skip */ }
        }
      }
      x += w;
    });
    y += rowH;
  }
  return doc.output('blob');
}

async function hindExcel(rows, imgs, title) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hindrance Register', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [10, 16, 10, 50, 12, 12, 8, 10, 30, 30].map(width => ({ width }));
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  ws.mergeCells('A1:J1'); ws.getCell('A1').value = currentProject.fullName || currentProject.name;
  ws.getCell('A1').font = { bold: true, size: 14 }; ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.mergeCells('A2:J2'); ws.getCell('A2').value = title;
  ws.getCell('A2').font = { bold: true, size: 12 }; ws.getCell('A2').alignment = { horizontal: 'center' };
  const head = ws.getRow(4);
  head.values = ['Ref', usesElements(currentProject) ? 'Location' : 'Chainage', 'Side', 'Details', 'Raised', 'Cleared', 'Days', 'Status', 'Raised photo', 'Cleared photo'];
  head.eachCell(c => { c.font = { bold: true }; c.border = border; c.alignment = { horizontal: 'center', vertical: 'middle' }; });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.values = [r.ref, r.ch, r.side, [r.details, r.note ? 'Cleared: ' + r.note : ''].filter(Boolean).join('\n'), r.raised, r.cleared, r.days, r.status, '', ''];
    row.height = 110;
    for (let c = 1; c <= 10; c++) { row.getCell(c).border = border; row.getCell(c).alignment = { vertical: 'middle', wrapText: true }; }
    [[r.p, 8], [r.after, 9]].forEach(([ph, col]) => {
      const im = ph && imgs.get(ph.id);
      if (!im) return;
      const f = fitBox(im.w, im.h, 205, 140);
      ws.addImage(wb.addImage({ base64: im.data, extension: 'jpeg' }), { tl: { col: col + 0.03, row: 4 + i + 0.04 }, ext: { width: f.w, height: f.h }, editAs: 'oneCell' });
    });
  });
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
