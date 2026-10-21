// ============================================================
// REPORTS SCREEN
// ============================================================
const FORMATS = {
  pdf: { name: 'PDF', ext: 'pdf', mime: 'application/pdf', note: 'For submission' },
  word: { name: 'Word', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', note: 'Editable' },
  excel: { name: 'Excel', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', note: 'Photo register' },
  ppt: { name: 'PowerPoint', ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', note: 'For meetings' },
  html: { name: 'Client view', ext: 'html', mime: 'text/html', note: 'Any browser, no app' },
  kml: { name: 'Google Earth', ext: 'kml', mime: 'application/vnd.google-earth.kml+xml', note: 'Photo spots on a map' }
};

const exportState = {
  source: null,             // { kind: 'ids', ids, label } when coming from a chainage group
  period: 'all',
  layout: loadJSON('exportLayout', 'C'),
  format: loadJSON('exportFormat', 'pdf'),
  caption: loadJSON('exportCaption', { date: true, description: true, engineer: false, gps: false }),
  titleTouched: false,
  last: null
};

function exportPhotos() {
  if (exportState.source && exportState.source.kind === 'ids') {
    const ids = new Set(exportState.source.ids);
    return projectPhotos().filter(p => ids.has(p.id));
  }
  if (selectedPhotos.size) return projectPhotos().filter(p => selectedPhotos.has(p.id));
  return projectPhotos().filter(p => inPeriod(p, exportState.period));
}

function defaultReportTitle(list) {
  if (!list.length) return 'Site Progress Photographs';
  const ts = list.map(p => new Date(p.timestamp)).sort((a, b) => a - b);
  const a = ts[0], b = ts[ts.length - 1];
  const month = d => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const span = month(a) === month(b) ? month(a) : `${fmtDate(a)} to ${fmtDate(b)}`;
  return `Site Progress Photographs — ${span}`;
}

function renderExportScreen() {
  if (!currentProject) return;
  const list = exportPhotos();

  // Which photos
  const per = document.getElementById('export-period');
  if (exportState.source) {
    per.innerHTML = `<button class="chip active">${esc(exportState.source.label)}</button><button class="chip clear" onclick="exportState.source=null;renderExportScreen()">${ic('x', 13)}Use period instead</button>`;
  } else if (selectedPhotos.size) {
    per.innerHTML = `<button class="chip active">${selectedPhotos.size} picked in gallery</button><button class="chip clear" onclick="clearSelection();renderExportScreen()">${ic('x', 13)}Use period instead</button>`;
  } else {
    per.innerHTML = PERIODS.map(([k, label]) =>
      `<button class="chip ${exportState.period === k ? 'active' : ''}" onclick="exportState.period='${k}';renderExportScreen()">${label}</button>`).join('');
  }
  document.getElementById('export-photo-count').textContent = list.length;
  document.getElementById('export-count-label').textContent = list.length === 1 ? 'photo in this report' : 'photos in this report';

  const titleEl = document.getElementById('report-heading');
  if (!exportState.titleTouched) titleEl.value = defaultReportTitle(list);
  titleEl.oninput = () => { exportState.titleTouched = true; };
  const prepEl = document.getElementById('report-prepared-by');
  if (!prepEl.value) prepEl.value = [profile.name, profile.designation].filter(Boolean).join(', ');

  // Layouts
  const excel = exportState.format === 'excel', web = exportState.format === 'html' || exportState.format === 'kml';
  document.getElementById('layout-grid').innerHTML = Object.entries(LAYOUTS).map(([k, L]) => `
    <button class="layout-card ${exportState.layout === k ? 'active' : ''} ${excel || web ? 'dim' : ''}" onclick="exportState.layout='${k}';saveJSON('exportLayout','${k}');renderExportScreen()">
      <div class="lc-preview lc-${k}">${layoutPreviewHTML(k)}</div>
      <div class="lc-name">${L.name}</div>
      <div class="lc-desc">${L.desc}</div>
    </button>`).join('') +
    (excel ? `<div class="note full">Excel always uses the photo register: S.No, a large photo cell, and the description as one sentence.</div>` : '') +
    (exportState.format === 'kml' ? `<div class="note full">Google Earth file: one pin per photo that has GPS, grouped by date, with its details. Opens in Google Earth and can be added to Google My Maps. Photos without GPS are left out.</div>` : '') +
    (exportState.format === 'html' ? `<div class="note full">The client view has its own layout: search, activity filters, a chainage strip to drag, and a full-screen photo viewer. Send the file on WhatsApp or e-mail; it opens in any browser.</div>` : '');

  // Caption options
  document.getElementById('caption-toggles').innerHTML =
    `<div class="toggle on fixed"><span>${ic('check', 16)}</span>Activity, Chainage From – To, Side</div>` +
    CAPTION_OPTIONS.map(([k, label]) => `
      <button class="toggle ${exportState.caption[k] ? 'on' : ''}" onclick="exportState.caption['${k}']=!exportState.caption['${k}'];saveJSON('exportCaption',exportState.caption);renderExportScreen()">
        <span>${exportState.caption[k] ? ic('check', 16) : ''}</span>${label}</button>`).join('');

  // Formats
  document.getElementById('format-grid').innerHTML = Object.entries(FORMATS).map(([k, F]) => `
    <button class="format-btn ${exportState.format === k ? 'active' : ''}" onclick="exportState.format='${k}';saveJSON('exportFormat','${k}');renderExportScreen()">
      <div class="format-badge f-${k}">${F.ext.toUpperCase()}</div>
      <div class="format-name">${F.name}</div>
      <div class="format-ext">${F.note}</div>
    </button>`).join('');

  const btn = document.getElementById('export-generate-btn');
  btn.disabled = list.length === 0;
  btn.innerHTML = ic('file') + (exportState.format === 'html' ? 'Create client view' : exportState.format === 'kml' ? 'Create Google Earth file' : `Create ${FORMATS[exportState.format].name} report`);
  if (typeof renderBrandSection === 'function') renderBrandSection();
}

function layoutPreviewHTML(k) {
  const cell = '<i><b></b><s></s></i>';
  if (k === 'A') return cell;
  if (k === 'B') return cell + cell;
  if (k === 'C') return cell.repeat(4);
  if (k === 'D') return cell.repeat(6);
  return '<u></u>' + cell.repeat(4);
}

// ============================================================
// CREATE
// ============================================================
async function generateExport(format = exportState.format) {
  let list = exportPhotos();
  if (!list.length) { showToast('No photos to put in the report', 'danger'); return; }
  // Colleagues' photos are previews on this phone: fetch the full ones for the report
  if (format !== 'kml') list = await fullImages(list, 'Getting full photos for the report…');
  const F = FORMATS[format];
  const layout = exportState.layout;
  const meta = {
    fullName: currentProject.fullName || currentProject.name,
    title: document.getElementById('report-heading').value.trim() || defaultReportTitle(list),
    preparedBy: document.getElementById('report-prepared-by').value.trim(),
    layout,
    brand: reportBrandLine()
  };
  const opts = Object.assign({}, exportState.caption);
  showLoading(`Creating ${F.name} report…`, `Preparing ${list.length} photos`);
  try {
    await new Promise(r => setTimeout(r, 50));
    const maxPx = format === 'excel' ? 800 : format === 'html' ? 1200 : { A: 1600, B: 1400, C: 1100, D: 900, E: 1100 }[layout];
    const imgs = format === 'kml' ? new Map() : await loadReportImages(list, maxPx, (n, t) => setLoadingSub(`Preparing photo ${n} of ${t}`));
    setLoadingSub('Laying out pages');
    let blob;
    if (format === 'pdf') blob = await buildPDF(paginate(list, layout, currentProject), imgs, meta, opts);
    else if (format === 'word') blob = await buildWord(paginate(list, layout, currentProject), imgs, meta, opts);
    else if (format === 'ppt') blob = await buildPPT(paginateSlides(list, layout, currentProject), imgs, meta, opts);
    else if (format === 'html') blob = buildClientView(list, imgs, meta, opts);
    else if (format === 'kml') blob = buildKML(list, meta);
    else {
      const sorted = layout === 'E'
        ? list.slice().sort((a, b) => (photoChMid(a) ?? 1e12) - (photoChMid(b) ?? 1e12) || new Date(a.timestamp) - new Date(b.timestamp))
        : list.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      blob = await buildExcel(sorted, imgs, meta, opts);
    }
    const name = safeFileName(`${currentProject.name}_${meta.title.replace(/Site Progress Photographs\s*—\s*/i, 'Photos_')}.${F.ext}`);
    setLoadingSub('Saving');
    const uri = await saveFile(blob, name, F.mime);
    exportState.last = { blob, name, mime: F.mime, uri, format, count: list.length };
    exportState.noBrandOnce = false;
    hideLoading();
    await adBreak('report');           // free version: an ad between finishing the report and showing it
    showResultSheet();
    renderExportScreen();
  } catch (e) {
    console.error('Export failed', e);
    hideLoading();
    showToast('Could not create the report: ' + e.message, 'danger');
  }
}

function showResultSheet() {
  const r = exportState.last;
  const F = FORMATS[r.format];
  document.getElementById('result-icon').textContent = F.ext.toUpperCase();
  document.getElementById('result-icon').className = 'result-icon f-' + r.format;
  document.getElementById('result-title').textContent = `${F.name} report ready`;
  document.getElementById('result-sub').textContent = `${r.count} photos · ${hasAndroidBridge() ? 'saved in Download/CivilCam' : 'downloaded'} · ${r.name}`;
  document.getElementById('also-row').innerHTML = Object.entries(FORMATS).filter(([k]) => k !== r.format).map(([k, f]) =>
    `<button class="also-btn" onclick="closeSheet('result-sheet');generateExport('${k}')"><span class="format-badge small f-${k}">${f.ext.toUpperCase()}</span>${f.name}</button>`).join('');
  openSheet('result-sheet');
}

function shareResult(app) {
  const r = exportState.last;
  if (!r) return;
  const text = `${currentProject.fullName || currentProject.name} — ${document.getElementById('report-heading').value.trim()}`;
  shareFiles([{ name: r.name, mime: r.mime, data: r.blob }], text, app);
}

function openResult() {
  const r = exportState.last;
  if (!r) return;
  if (hasAndroidBridge() && typeof r.uri === 'string' && r.uri) window.AndroidBridge.openFile(r.uri, r.mime);
  else window.open(URL.createObjectURL(r.blob), '_blank');
}

async function saveResultAgain() {
  const r = exportState.last;
  if (!r) return;
  const uri = await saveFile(r.blob, r.name, r.mime);
  savedMessage(uri, FORMATS[r.format].name + ' report', r.mime);
}


// ============================================================
// GOOGLE EARTH / GOOGLE MAPS (KML): one pin per photo that has GPS, grouped by date.
// Opens in Google Earth, and can be imported into Google My Maps.
// ============================================================
function buildKML(list, meta) {
  const x = v => String(v == null ? '' : v).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const withGps = list.filter(p => p.location && p.location.lat != null).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (!withGps.length) throw new Error('None of these photos has a GPS position');
  const byDay = {};
  withGps.forEach(p => { (byDay[p.date] = byDay[p.date] || []).push(p); });
  const pin = p => {
    const lines = [
      ['Date', `${p.displayDate}, ${p.displayTime}`], ['Activity', p.activity], [elementLabel(), p.element], ['Chainage', chainageText(p)],
      ['Side', p.side], ['Place', p.address], ['Engineer', p.engineer && p.engineer.name], ['Remarks', p.description]
    ].filter(l => l[1]);
    return `    <Placemark>
      <name>${x([p.activity, chainageText(p, 'short') ? 'Ch ' + chainageText(p, 'short') : p.element].filter(Boolean).join(' · '))}</name>
      <TimeStamp><when>${x(new Date(p.timestamp).toISOString())}</when></TimeStamp>
      <styleUrl>#${p.photoType === 'Hindrance' ? 'hind' : 'photo'}</styleUrl>
      <description><![CDATA[${lines.map(l => `<b>${x(l[0])}:</b> ${x(l[1])}`).join('<br>')}]]></description>
      <Point><coordinates>${+p.location.lng},${+p.location.lat}${p.location.altitude != null ? ',' + p.location.altitude : ''}</coordinates></Point>
    </Placemark>`;
  };
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${x(meta.fullName)} — ${x(meta.title)}</name>
  <description>${x(withGps.length)} photo spots${meta.preparedBy ? ' · Prepared by ' + x(meta.preparedBy) : ''} · CivilCam Pro</description>
  <Style id="photo"><IconStyle><color>ff24a5f5</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/camera.png</href></Icon></IconStyle></Style>
  <Style id="hind"><IconStyle><color>ff7171f8</color><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/caution.png</href></Icon></IconStyle></Style>
${Object.keys(byDay).sort().map(d => `  <Folder>
    <name>${x(fmtDate(d))} (${byDay[d].length})</name>
${byDay[d].map(pin).join('\n')}
  </Folder>`).join('\n')}
</Document>
</kml>
`;
  return new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
}
