// ============================================================
// IMPORT PHOTOS FROM OTHER CAMERA APPS
// GPS Map Camera, Timestamp Camera, the phone's own camera, WhatsApp images ...
// The date, time and GPS saved inside each photo (EXIF) are read and used; the chainage
// can be worked out from nearby photos that already have one. Two ways in:
//   - Pick photos: the system file picker, any number at once
//   - Sync a camera folder: pick e.g. DCIM/GPS Map Camera once; new photos in it are
//     found every time the app opens
// ============================================================
const Importer = { job: '', items: [], skipped: 0, failed: 0, auto: false };

function importSince() { return loadJSON('importSince', {}); }

function importFolders() {
  if (hasAndroidBridge() && typeof window.AndroidBridge.importFolders === 'function') {
    try { return JSON.parse(window.AndroidBridge.importFolders()); } catch (e) { return []; }
  }
  return [];
}

function openImportSheet() {
  if (!currentProject) return;
  document.getElementById('imp-project').textContent = currentProject.name;
  renderImportFolders();
  document.getElementById('imp-folder-block').style.display = hasAndroidBridge() ? '' : 'none';
  openSheet('import-sheet');
}

function renderImportFolders() {
  const list = importFolders();
  const since = importSince();
  document.getElementById('imp-folders').innerHTML = list.length
    ? list.map(f => `<div class="imp-folder">
        <span class="imp-f-ic">${ic('folder', 18)}</span>
        <span class="imp-f-txt"><b>${esc(f.name)}</b><small>${since[f.uri] ? 'Checked up to ' + fmtDate(since[f.uri]) + ' ' + fmtTime(since[f.uri]) : 'Not checked yet'}</small></span>
        <button class="icon-btn" onclick="removeImportFolder('${encodeURIComponent(f.uri)}')" aria-label="Stop syncing ${esc(f.name)}">${ic('x', 16)}</button>
      </div>`).join('')
    : `<div class="note">No folders yet. Add the folder your other camera app saves to, for example <b>DCIM/GPS Map Camera</b> or <b>Pictures/Timestamp Camera</b>.</div>`;
  document.getElementById('imp-sync-btn').style.display = list.length ? '' : 'none';
}

function removeImportFolder(enc) {
  const uri = decodeURIComponent(enc);
  window.AndroidBridge.removeImportFolder(uri);
  const s = importSince(); delete s[uri]; saveJSON('importSince', s);
  renderImportFolders();
}

function newImportJob(auto = false) {
  Importer.job = 'imp' + Date.now();
  Object.assign(Importer, { items: [], skipped: 0, failed: 0, auto });
  return Importer.job;
}

// ---------- 1. pick photos ----------
function importPick() {
  closeSheet('import-sheet');
  if (hasAndroidBridge() && typeof window.AndroidBridge.importPhotos === 'function') {
    window.AndroidBridge.importPhotos(newImportJob());
    return;
  }
  document.getElementById('import-file').click();           // browser: plain file input
}

// ---------- 2. synced camera folders ----------
function importAddFolder() {
  window.AndroidBridge.addImportFolder();
}

// Called when a folder was added (newUri) or the picker was closed
window.onNativeFolders = async function (json, newUri) {
  renderImportFolders();
  if (!newUri) return;
  const choice = await askChoice('Bring in photos from this folder', 'Older photos you choose now go into this project. After this, only new photos are offered.',
    [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'All photos'], ['new', 'Only new ones from now']]);
  const s = importSince();
  s[newUri] = choice === 'all' ? 0 : choice === 'new' || !choice ? Date.now() : Date.now() - (+choice) * 86400000;
  saveJSON('importSince', s);
  renderImportFolders();
  if (choice && choice !== 'new') importScan();
};

function importScan(auto = false) {
  if (!hasAndroidBridge() || typeof window.AndroidBridge.scanImportFolders !== 'function' || !importFolders().length) return;
  if (!auto) { closeSheet('import-sheet'); showLoading('Looking for new photos…', ''); }
  window.AndroidBridge.scanImportFolders(newImportJob(auto), JSON.stringify(importSince()));
}

// Quietly on start-up: offer new photos from synced folders
function autoImportScan() {
  if (currentProject && importFolders().length) importScan(true);
}

// ---------- photos arriving from the phone ----------
window.onNativeImportItem = function (job, json) {
  if (job !== Importer.job) return;
  let it; try { it = JSON.parse(json); } catch (e) { Importer.failed++; return; }
  if (!Importer.auto) {
    if (!document.getElementById('loading-overlay').classList.contains('visible')) showLoading('Reading photos…', '');
    setLoadingSub(`Photo ${it.index + 1} of ${it.total}`);
  }
  addImportItem(it);
};

window.onNativeImportDone = function (job, ok, failed) {
  if (job !== Importer.job) return;
  hideLoading();
  Importer.failed += failed;
  if (!Importer.items.length) {
    if (!Importer.auto) showToast(Importer.skipped ? `Nothing new: ${Importer.skipped} already in the app` : 'No new photos found', '');
    markFoldersChecked();
    return;
  }
  if (Importer.auto) {
    const from = [...new Set(Importer.items.map(i => i.folder).filter(Boolean))].join(', ');
    showToast(`${Importer.items.length} new photo${Importer.items.length === 1 ? '' : 's'} in ${from || 'your camera folder'}`, 'success',
      { label: 'REVIEW', onClick: openImportReview });
  } else {
    openImportReview();
  }
};

function addImportItem(it) {
  if (photos.some(p => p.importKey === it.key)) { Importer.skipped++; return; }
  it.include = true;
  it.when = exifDate(it.taken, it.offset) || (it.modified ? new Date(it.modified) : null);
  if (it.lat != null) it.suggest = suggestChainage(+it.lat, +it.lng);
  Importer.items.push(it);
}

// "2024:05:17 14:03:22" (+ "+05:30") -> Date
function exifDate(s, offset) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${/^[+-]\d{2}:\d{2}$/.test(offset || '') ? offset : ''}`;
  const d = new Date(iso);
  return isNaN(d) || d.getFullYear() < 1995 ? null : d;
}

// ---------- browser fallback (no Android app) ----------
async function onImportFiles(input) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  newImportJob();
  showLoading('Reading photos…', '');
  for (let i = 0; i < files.length; i++) {
    setLoadingSub(`Photo ${i + 1} of ${files.length}`);
    const f = files[i];
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      const it = { key: `file:${f.name}:${f.size}:${f.lastModified}`, name: f.name, folder: '', source: 'Picked', modified: f.lastModified };
      Object.assign(it, readExifJs(dataUrl));
      const small = await shrinkImage(dataUrl, 2048);
      if (!small) throw new Error('not an image');
      it.image = small.data;
      addImportItem(it);
    } catch (e) { Importer.failed++; }
  }
  window.onNativeImportDone(Importer.job, Importer.items.length, 0);
}

function readExifJs(dataUrl) {
  const out = {};
  if (typeof piexif === 'undefined' || !/^data:image\/jpe?g/.test(dataUrl)) return out;
  try {
    const ex = piexif.load(dataUrl);
    const g = ex.GPS || {};
    const deg = v => v ? v[0][0] / v[0][1] + v[1][0] / v[1][1] / 60 + v[2][0] / v[2][1] / 3600 : null;
    const lat = deg(g[piexif.GPSIFD.GPSLatitude]), lng = deg(g[piexif.GPSIFD.GPSLongitude]);
    if (lat != null && lng != null && (lat || lng)) {
      out.lat = (g[piexif.GPSIFD.GPSLatitudeRef] === 'S' ? -1 : 1) * lat;
      out.lng = (g[piexif.GPSIFD.GPSLongitudeRef] === 'W' ? -1 : 1) * lng;
    }
    const alt = g[piexif.GPSIFD.GPSAltitude];
    if (alt) out.alt = alt[0] / alt[1];
    out.taken = (ex.Exif || {})[piexif.ExifIFD.DateTimeOriginal] || (ex['0th'] || {})[piexif.ImageIFD.DateTime];
    out.make = (ex['0th'] || {})[piexif.ImageIFD.Make];
    out.model = (ex['0th'] || {})[piexif.ImageIFD.Model];
  } catch (e) { /* no EXIF */ }
  return out;
}

// ---------- chainage from nearby photos ----------
// Uses photos of this project that have both GPS and a chainage: projects the new point onto the
// line between the two nearest ones. Gives nothing when no known photo is within 500 m.
function suggestChainage(lat, lng) {
  if (!currentProject || !(isLinearLayout(currentProject) || projectLayout(currentProject) === 'bridge')) return null;
  const known = projectPhotos().filter(p => p.location && photoChMid(p) != null);
  if (!known.length) return null;
  const k = Math.cos(lat * Math.PI / 180) * 111320;
  const xy = p => [(+p.location.lng - lng) * k, (+p.location.lat - lat) * 110540];
  const near = known.map(p => { const [x, y] = xy(p); return { p, x, y, d: Math.hypot(x, y), ch: photoChMid(p) }; })
    .filter(o => o.d <= 500).sort((a, b) => a.d - b.d);
  if (!near.length) return null;
  const a = near[0];
  const b = near.find(o => Math.abs(o.ch - a.ch) > 5 && Math.hypot(o.x - a.x, o.y - a.y) > 5);
  if (!b) return a.d <= 150 ? { m: Math.round(a.ch), approx: true, d: Math.round(a.d) } : null;
  // point is at (0,0); project onto the line a -> b
  const vx = b.x - a.x, vy = b.y - a.y;
  const t = Math.max(-0.5, Math.min(1.5, (-a.x * vx - a.y * vy) / (vx * vx + vy * vy)));
  return { m: Math.round(a.ch + t * (b.ch - a.ch)), approx: false, d: Math.round(a.d) };
}

// ---------- review before adding ----------
const importForm = { activity: '', side: '', element: '', photoType: 'General', chMode: 'suggest', chValue: '', description: '', stamp: false };

function openImportReview() {
  const p = currentProject;
  const L = LAYOUTS_SITE[projectLayout(p)];
  Object.assign(importForm, { activity: currentActivity, side: currentSide, element: currentElement, photoType: 'General', description: '' });
  const opt = (list, cur) => list.map(v => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  document.getElementById('imp-act').innerHTML = opt(getOptions('activity'), importForm.activity);
  document.getElementById('imp-side').innerHTML = `<option value="">—</option>` + opt(getOptions('side'), importForm.side);
  document.getElementById('imp-type').innerHTML = opt(getOptions('photoType'), 'General');
  document.getElementById('imp-el-wrap').style.display = L.element ? '' : 'none';
  if (L.element) {
    document.getElementById('imp-el-lbl').textContent = L.element;
    document.getElementById('imp-el').innerHTML = `<option value="">—</option>` + opt(siteElements(p), importForm.element);
  }
  document.getElementById('imp-ch-wrap').style.display = L.linear || projectLayout(p) === 'bridge' ? '' : 'none';
  document.getElementById('imp-desc').value = '';
  document.getElementById('imp-stamp').checked = importForm.stamp;
  renderImportReview();
  openSheet('import-review');
}

function renderImportReview() {
  const its = Importer.items;
  const inc = its.filter(i => i.include);
  const gps = its.filter(i => i.lat != null).length;
  const dated = its.filter(i => i.taken).length;
  const sug = its.filter(i => i.suggest).length;
  document.getElementById('imp-title').textContent = `${its.length} photo${its.length === 1 ? '' : 's'} for ${currentProject.name}`;
  document.getElementById('imp-summary').innerHTML = [
    `<span class="imp-chip ${gps ? 'ok' : ''}">${ic('pin', 13)}${gps} with GPS</span>`,
    `<span class="imp-chip ${dated ? 'ok' : ''}">${ic('clock', 13)}${dated} with date &amp; time</span>`,
    sug ? `<span class="imp-chip ok">${ic('strip', 13)}${sug} chainage from nearby photos</span>` : '',
    Importer.skipped ? `<span class="imp-chip">${Importer.skipped} already in the app</span>` : '',
    Importer.failed ? `<span class="imp-chip bad">${Importer.failed} could not be read</span>` : ''
  ].join('');
  document.getElementById('imp-grid').innerHTML = its.map((it, i) => `
    <button class="imp-item${it.include ? '' : ' off'}" onclick="Importer.items[${i}].include=!Importer.items[${i}].include;renderImportReview()" aria-pressed="${it.include}">
      <img src="${it.image}" alt="">
      <span class="imp-check">${it.include ? ic('check', 14) : ''}</span>
      <span class="imp-meta">${it.when ? esc(fmtDate(it.when)) : 'No date'}${it.lat != null ? ' · GPS' : ''}${it.suggest && importForm.chMode === 'suggest' ? ` · ${fmtCh(it.suggest.m)}${it.suggest.approx ? '≈' : ''}` : ''}</span>
    </button>`).join('');
  document.getElementById('imp-add-btn').textContent = `Add ${inc.length} photo${inc.length === 1 ? '' : 's'}`;
  document.getElementById('imp-add-btn').disabled = !inc.length;
  document.querySelectorAll('#imp-ch-mode button').forEach(b => b.classList.toggle('active', b.dataset.mode === importForm.chMode));
  document.getElementById('imp-ch-value').style.display = importForm.chMode === 'same' ? '' : 'none';
}

function setImportChMode(m) { importForm.chMode = m; renderImportReview(); }

function cancelImport() {
  closeSheet('import-review');
  markFoldersChecked();          // don't offer the same photos again; they can be picked by hand
  Importer.items = [];
}

function markFoldersChecked() {
  const s = importSince();
  const by = {};
  Importer.items.forEach(i => { if (i.folderUri) by[i.folderUri] = Math.max(by[i.folderUri] || 0, i.modified || 0); });
  Object.entries(by).forEach(([u, t]) => { s[u] = Math.max(s[u] || 0, t); });
  if (Importer.job && !Importer.items.length) importFolders().forEach(f => { if (s[f.uri] == null) s[f.uri] = Date.now(); });
  saveJSON('importSince', s);
}

async function commitImport() {
  const p = currentProject;
  const f = importForm;
  f.activity = document.getElementById('imp-act').value;
  f.side = document.getElementById('imp-side').value;
  f.photoType = document.getElementById('imp-type').value;
  f.element = usesElements(p) ? document.getElementById('imp-el').value : '';
  f.chValue = normCh(document.getElementById('imp-ch-value').value);
  f.description = document.getElementById('imp-desc').value.trim();
  f.stamp = document.getElementById('imp-stamp').checked;
  const list = Importer.items.filter(i => i.include);
  closeSheet('import-review');
  showLoading('Adding photos…', '');
  let n = 0;
  for (const it of list) {
    setLoadingSub(`${++n} of ${list.length}`);
    try {
      const ph = await buildImportedPhoto(it, f);
      await DB.save(ph);
      photos.unshift(ph);
    } catch (e) { console.warn('import failed', e); }
  }
  photos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  markFoldersChecked();
  Importer.items = [];
  await ensureHindranceRefs();
  updateHindranceBadge();
  Sync.schedule(); Sync.updateDot();
  hideLoading();
  updateLastThumb();
  if (currentTab === 'gallery') renderGallery(); else switchTab('gallery');
  showToast(`${n} photo${n === 1 ? '' : 's'} added to ${p.name}`, 'success');
}

async function buildImportedPhoto(it, f) {
  const p = currentProject;
  const when = it.when || new Date();
  let chFrom = '';
  if (f.chMode === 'suggest' && it.suggest) chFrom = fmtCh(it.suggest.m);
  else if (f.chMode === 'same') chFrom = f.chValue;
  const photo = normPhoto({
    id: when.getTime() + '-' + Math.random().toString(36).slice(2, 8),
    projectId: p.id, projectName: p.name, projectFullName: p.fullName,
    timestamp: when.toISOString(),
    date: localDateKey(when),
    time: when.toTimeString().slice(0, 8),
    month: `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}`,
    year: String(when.getFullYear()),
    quarter: `${when.getFullYear()}-Q${Math.ceil((when.getMonth() + 1) / 3)}`,
    displayDate: fmtDate(when), displayTime: fmtTime(when),
    location: it.lat != null ? { lat: (+it.lat).toFixed(6), lng: (+it.lng).toFixed(6), accuracy: null, altitude: it.alt != null ? Math.round(it.alt) : null } : null,
    engineer: { name: profile.name, designation: profile.designation, email: profile.email },
    activity: f.activity, side: f.side, photoType: f.photoType, element: f.element,
    chFrom, chTo: '', chFromM: parseCh(chFrom), chToM: null,
    description: [f.description, it.description && !/^[\s?]*$/.test(it.description) ? it.description : ''].filter(Boolean).join(' — '),
    fields: [],
    hasMetadata: f.stamp, sharpness: null,
    imported: { from: it.folder || (it.source === 'Picked' ? 'Picked photos' : it.source), name: it.name || '', camera: [it.make, it.model].filter(Boolean).join(' ') },
    importKey: it.key,
    updatedAt: Date.now(), synced: false
  });
  let img = it.image;
  if (f.stamp) img = await stampImage(img, photo);
  photo.imageData = writeExif(img, photo);
  return photo;
}

function stampImage(dataUrl, photo) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.width; c.height = im.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(im, 0, 0);
      drawStamp(ctx, c.width, c.height, photo);
      res(c.toDataURL('image/jpeg', 0.88));
    };
    im.onerror = () => res(dataUrl);
    im.src = dataUrl;
  });
}

// A small "pick one" sheet built on the existing ask sheet styles
function askChoice(title, hint, options) {
  return new Promise(resolve => {
    document.getElementById('choice-title').textContent = title;
    document.getElementById('choice-hint').textContent = hint || '';
    const box = document.getElementById('choice-list');
    box.innerHTML = '';
    options.forEach(([v, label]) => {
      const b = document.createElement('button');
      b.className = 'btn block'; b.textContent = label;
      b.onclick = () => { closeSheet('choice-sheet'); resolve(v); };
      box.appendChild(b);
    });
    document.getElementById('choice-sheet').onclick = e => { if (e.target.id === 'choice-sheet') { closeSheet('choice-sheet'); resolve(null); } };
    openSheet('choice-sheet');
  });
}
