// ============================================================
// GALLERY FILTERS
// ============================================================
const galleryFilter = {
  period: 'all',
  activity: new Set(), side: new Set(), photoType: new Set(), element: new Set(),
  chFrom: null, chTo: null,        // metres
  text: '', smart: null             // smart: parsed search {chMid, chTol, period, activity, side, text}
};

function matchesFilter(p, f) {
  const period = (f.smart && f.smart.period) || f.period;
  if (!inPeriod(p, period)) return false;
  if (f.activity.size && !f.activity.has(p.activity)) return false;
  if (f.side.size && !f.side.has(p.side)) return false;
  if (f.photoType && f.photoType.size && !f.photoType.has(p.photoType)) return false;
  if (f.element && f.element.size && !f.element.has(p.element)) return false;
  const mid = photoChMid(p);
  if ((f.chFrom != null || f.chTo != null) && mid == null) return false;
  if (f.chFrom != null && mid < f.chFrom) return false;
  if (f.chTo != null && mid > f.chTo) return false;
  const s = f.smart;
  if (s) {
    if (s.chMid != null && (mid == null || Math.abs(mid - s.chMid) > (s.chTol || 250))) return false;
    if (s.activity && !String(p.activity).toLowerCase().includes(s.activity.toLowerCase())) return false;
    if (s.side && p.side !== s.side) return false;
    if (s.dateFrom && p.date < s.dateFrom) return false;
    if (s.dateTo && p.date > s.dateTo) return false;
  }
  const text = s ? s.text : f.text;
  if (text) {
    const hay = [p.activity, p.side, p.element, p.chFrom, p.chTo, p.description, fieldsText(p), p.displayDate, p.photoType,
      p.engineer && p.engineer.name].join(' ').toLowerCase();
    if (!text.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

function getFilteredPhotos() {
  return projectPhotos().filter(p => matchesFilter(p, galleryFilter));
}

function renderGalleryFilters() {
  const per = document.getElementById('gallery-period');
  per.innerHTML = PERIODS.map(([k, label]) =>
    `<button class="chip ${galleryFilter.period === k ? 'active' : ''}" onclick="galleryFilter.period='${k}';renderGallery()">${label}</button>`).join('');
  const fl = document.getElementById('gallery-filters');
  fl.innerHTML = filterButtonsHTML(galleryFilter, 'galleryFilter', 'renderGallery');
  document.getElementById('smart-search-btn').style.display = AI.available() ? '' : 'none';
}

// Shared by the gallery and the chainage strip
function filterButtonsHTML(f, varName, rerender) {
  const label = (set, name) => set.size === 0 ? name : set.size === 1 ? [...set][0] : `${name} (${set.size})`;
  const chLabel = f.chFrom != null || f.chTo != null ? `Ch ${f.chFrom != null ? fmtCh(f.chFrom) : '…'} – ${f.chTo != null ? fmtCh(f.chTo) : '…'}` : 'Chainage';
  const btn = (key, text, on) => `<button class="chip filter ${on ? 'active' : ''}" onclick="openFilterSheet('${key}', ${varName}, ${rerender})">${ic('filter', 13)}${esc(text)}</button>`;
  let html = btn('activity', label(f.activity, 'Activity'), f.activity.size) +
    btn('side', label(f.side, 'Side'), f.side.size) +
    (f.photoType ? btn('photoType', label(f.photoType, 'Type'), f.photoType.size) : '') +
    (usesElements(currentProject) ? btn('element', label(f.element, LAYOUTS_SITE[projectLayout(currentProject)].element), f.element.size) : '') +
    (isLinearLayout(currentProject) || projectLayout(currentProject) === 'bridge' ? btn('chainage', chLabel, f.chFrom != null || f.chTo != null) : '');
  const any = f.activity.size || f.side.size || (f.photoType && f.photoType.size) || (f.element && f.element.size) || f.chFrom != null || f.chTo != null || f.smart;
  if (any) html += `<button class="chip clear" onclick="clearFilters(${varName}, ${rerender})">${ic('x', 13)}Clear</button>`;
  return html;
}

function clearFilters(f, rerender) {
  f.activity.clear(); f.side.clear(); if (f.photoType) f.photoType.clear(); if (f.element) f.element.clear();
  f.chFrom = null; f.chTo = null; f.smart = null;
  if (f === galleryFilter) { f.text = ''; document.getElementById('gallery-search-input').value = ''; }
  rerender();
}

function openFilterSheet(key, f, rerender) {
  const titles = { activity: 'Activity', side: 'Side', photoType: 'Photo type', chainage: 'Chainage range', element: LAYOUTS_SITE[projectLayout(currentProject)].element || 'Location' };
  document.getElementById('filter-sheet-title').textContent = titles[key];
  const chips = document.getElementById('filter-sheet-chips');
  const extra = document.getElementById('filter-sheet-extra');
  extra.innerHTML = '';
  if (key === 'chainage') {
    chips.innerHTML = '';
    extra.innerHTML = `<div class="ch-row">
      <label class="field compact"><span>From</span><input class="input" id="flt-from" inputmode="decimal" placeholder="0+000" value="${f.chFrom != null ? fmtCh(f.chFrom) : ''}"></label>
      <label class="field compact"><span>To</span><input class="input" id="flt-to" inputmode="decimal" placeholder="25+000" value="${f.chTo != null ? fmtCh(f.chTo) : ''}"></label></div>`;
    const apply = () => { f.chFrom = parseCh(document.getElementById('flt-from').value); f.chTo = parseCh(document.getElementById('flt-to').value); rerender(); };
    extra.querySelectorAll('input').forEach(i => { i.oninput = apply; });
  } else {
    // Values in use in this project come first, so custom ones are easy to find
    const used = new Set(projectPhotos().map(p => p[key]).filter(Boolean));
    const isEl = key === 'element';
    const values = isEl ? projectElements(currentProject).concat(currentProject.extraElements || []).filter(e => used.has(e)) : [...new Set([...used, ...getOptions(key)])];
    const draw = () => renderChips(chips, key, f[key], v => {
      if (f[key].has(v)) f[key].delete(v); else f[key].add(v);
      draw(); rerender();
    }, { multi: true, values, others: !isEl, plain: isEl, othersLabel: 'Add a value to the list' });
    draw();
    extra.innerHTML = `<div class="sheet-hint" style="margin-top:12px">Pick one or more. "Others" adds a value that isn't listed; it's saved for next time.</div>`;
  }
  openSheet('filter-sheet');
}

// ============================================================
// SEARCH (plain words; AI understands longer questions when signed in)
// ============================================================
let searchTimer;
function onGallerySearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = document.getElementById('gallery-search-input').value.trim();
    galleryFilter.text = '';
    galleryFilter.smart = q ? parseSearch(q) : null;
    renderGallery();
  }, 200);
}

// Understands things like "culvert near 14 km last month", "12+300 rhs", "hindrance october"
function parseSearch(q) {
  const out = { text: '', chMid: null, chTol: null, period: null, activity: null, side: null, dateFrom: null, dateTo: null };
  let s = ' ' + q.toLowerCase() + ' ';
  const take = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
  let m;
  if ((m = take(/\b(?:near|at|around|ch\.?|chainage)?\s*(\d+\+\d+)\b/))) { out.chMid = parseCh(m[1]); out.chTol = 100; }
  else if ((m = take(/\b(?:near|at|around)?\s*(\d+(?:\.\d+)?)\s*km\b/))) { out.chMid = Number(m[1]) * 1000; out.chTol = 500; }
  const periods = [[/\btoday\b/, 'today'], [/\bthis week\b/, 'week'], [/\bthis month\b/, 'month'], [/\blast (?:3|three) months\b/, '3months'], [/\bthis year\b/, 'year']];
  for (const [re, k] of periods) if (take(re)) out.period = k;
  if (take(/\blast month\b/)) {
    const n = new Date(); const a = new Date(n.getFullYear(), n.getMonth() - 1, 1); const b = new Date(n.getFullYear(), n.getMonth(), 0);
    out.dateFrom = localDateKey(a); out.dateTo = localDateKey(b);
  }
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  months.forEach((name, i) => {
    if (take(new RegExp('\\b(' + name + '|' + name.slice(0, 3) + ')\\b'))) {
      const n = new Date(); let y = n.getFullYear(); if (i > n.getMonth()) y--;
      out.dateFrom = localDateKey(new Date(y, i, 1)); out.dateTo = localDateKey(new Date(y, i + 1, 0));
    }
  });
  for (const side of getOptions('side')) if (take(new RegExp('\\b' + side.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'))) out.side = side;
  for (const act of getOptions('activity')) {
    const word = act.toLowerCase().split(/[\s/&]+/)[0];
    if (word.length > 3 && take(new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'))) { out.activity = word; break; }
  }
  take(/\b(photos?|pics?|images?|of|in|the|show|me|all|near|at|around)\b/g);
  out.text = s.replace(/\s+/g, ' ').trim();
  return out;
}

async function runSmartSearch() {
  const q = document.getElementById('gallery-search-input').value.trim();
  if (!q || !AI.available()) { onGallerySearch(); return; }
  try {
    showLoading('Understanding your search…');
    const r = await AI.call('search', {
      query: q, today: localDateKey(new Date()),
      activities: getOptions('activity'), sides: getOptions('side')
    });
    galleryFilter.smart = Object.assign(parseSearch(''), r.filter || {}, { text: (r.filter && r.filter.text) || '' });
    renderGallery();
  } catch (e) {
    showToast('AI search unavailable, using simple search', 'danger');
    onGallerySearch();
  } finally { hideLoading(); }
}

// ============================================================
// GRID
// ============================================================
function renderGallery() {
  if (!currentProject) return;
  renderGalleryFilters();
  updateLastThumb();
  const grid = document.getElementById('gallery-grid');
  const filtered = getFilteredPhotos();
  const total = projectPhotos().length;

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty">
      <div class="empty-ic">${ic('image', 40)}</div>
      <div class="empty-title">${total ? 'No photos match' : 'No photos yet'}</div>
      <div class="empty-sub">${total ? 'Try another filter or period.' : 'Photos you take in this project appear here.'}</div></div>`;
    return;
  }

  const groups = {};
  filtered.forEach(p => { (groups[p.date] = groups[p.date] || []).push(p); });
  grid.innerHTML = Object.entries(groups).map(([date, list]) => `
    <div class="gallery-group">
      <div class="gallery-group-header">${fmtDate(date)} <span>${list.length}</span></div>
      <div class="photo-grid">${list.map(thumbHTML).join('')}</div>
    </div>`).join('');
}

function thumbHTML(p) {
  const sel = selectedPhotos.has(p.id);
  const ch = [p.element, chainageText(p, 'short')].filter(Boolean).join(' · ');
  return `<div class="photo-thumb${sel ? ' selected' : ''}" data-id="${p.id}" role="button" tabindex="0" aria-label="Photo ${esc(ch || p.displayDate)}">
    <img src="${p.imageData || ''}" loading="lazy" alt="">
    <div class="select-badge">${ic('check', 14)}</div>
    ${p.photoType === 'Hindrance' ? `<div class="type-badge${p.hind && p.hind.status === 'cleared' ? ' done' : ''}">${ic(p.hind && p.hind.status === 'cleared' ? 'check' : 'alert', 12)}</div>` : ''}
    ${Sync.enabled() && !p.synced && !p.previewOnly ? `<div class="wait-badge" title="Not backed up yet">${ic('cloud', 11)}</div>` : ''}
    ${p.repeatOf ? '<div class="pair-badge">2×</div>' : ''}
    ${takenByOther(p) ? `<div class="by-badge">${esc((p.engineer.name || p.engineer.email).split(/[ @]/)[0])}</div>` : ''}
    ${p.previewOnly ? `<div class="prev-badge" title="Preview: full photo on request">${ic('cloudDown', 11)}</div>` : ''}
    ${ch ? `<div class="meta-badge">${esc(ch)}</div>` : ''}
  </div>`;
}

// Press and hold a photo to start selecting; then tap more photos to add or remove them.
// One set of pointer handlers on the grid: a small finger wobble does not cancel the press, and
// the phone's own long-press menu (which used to undo the selection straight away) is blocked.
const press = { timer: null, id: null, x: 0, y: 0, fired: false };
(function attachThumbPress() {
  const grid = () => document.getElementById('gallery-grid');
  const thumbOf = e => e.target.closest && e.target.closest('.photo-thumb');
  document.addEventListener('pointerdown', e => {
    const t = thumbOf(e);
    if (!t || !grid() || !grid().contains(t)) return;
    clearTimeout(press.timer);
    Object.assign(press, { id: t.dataset.id, x: e.clientX, y: e.clientY, fired: false });
    press.timer = setTimeout(() => {
      press.fired = true;
      toggleSelect(press.id);
      if (navigator.vibrate) navigator.vibrate(25);
    }, 450);
  });
  document.addEventListener('pointermove', e => {
    if (press.timer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) { clearTimeout(press.timer); press.timer = null; }
  });
  ['pointerup', 'pointercancel'].forEach(n => document.addEventListener(n, () => { clearTimeout(press.timer); press.timer = null; }));
  document.addEventListener('contextmenu', e => {
    const t = thumbOf(e);
    if (!t) return;
    e.preventDefault();
    if (!press.fired && e.pointerType !== 'touch' && !('ontouchstart' in window)) toggleSelect(t.dataset.id);   // right-click on a PC
  });
  document.addEventListener('click', e => {
    const t = thumbOf(e);
    if (!t || !grid() || !grid().contains(t)) return;
    if (press.fired) { press.fired = false; return; }
    onThumbClick(t.dataset.id);
  });
  document.addEventListener('keydown', e => {
    const t = thumbOf(e);
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onThumbClick(t.dataset.id); }
  });
})();

function onThumbClick(id) {
  if (selectedPhotos.size > 0) toggleSelect(id); else openPhotoModal(id);
}

function toggleSelect(id) {
  if (selectedPhotos.has(id)) selectedPhotos.delete(id); else selectedPhotos.add(id);
  document.querySelectorAll(`.photo-thumb[data-id="${id}"]`).forEach(el => el.classList.toggle('selected', selectedPhotos.has(id)));
  updateSelectionUI();
}

function selectAllShown() {
  const shown = getFilteredPhotos();
  const all = shown.every(p => selectedPhotos.has(p.id));
  shown.forEach(p => all ? selectedPhotos.delete(p.id) : selectedPhotos.add(p.id));
  renderGallery();
  updateSelectionUI();
}

function clearSelection() {
  selectedPhotos.clear();
  updateSelectionUI();
  renderGallery();
}

function updateSelectionUI() {
  document.getElementById('gallery-action-bar').classList.toggle('visible', selectedPhotos.size > 0);
  document.getElementById('sel-count-lbl').textContent = `${selectedPhotos.size} selected`;
  const shown = currentTab === 'gallery' && currentProject ? getFilteredPhotos() : [];
  const allBtn = document.getElementById('sel-all-btn');
  if (allBtn) allBtn.textContent = shown.length && shown.every(p => selectedPhotos.has(p.id)) ? 'None' : 'All';
}

// ============================================================
// PHOTO VIEWER
// ============================================================
function openPhotoModal(id) {
  const p = photos.find(x => x.id === id);
  if (!p) return;
  currentModalPhoto = p;
  document.getElementById('modal-img').src = p.imageData || '';
  // Full photo kept in someone's Google Drive: offer to open it there
  document.getElementById('drive-btn').style.display = p.previewOnly || p.driveLink ? '' : 'none';
  document.getElementById('drive-btn').innerHTML = p.previewOnly ? ic('cloudDown', 18) + 'Full' : ic('open', 18) + 'Drive';
  document.getElementById('compare-btn').style.display = linkedPhotos(p).length > 1 ? '' : 'none';
  document.getElementById('modal-title').textContent = [p.activity, placeText(p)].filter(Boolean).join(' · ');
  const loc = p.location;
  const item = (label, value, full) => value ? `<div class="meta-item${full ? ' full' : ''}"><div class="meta-item-label">${label}</div><div class="meta-item-value">${esc(value)}</div></div>` : '';
  document.getElementById('modal-meta-grid').innerHTML =
    item('Date', `${p.displayDate}, ${p.displayTime}`) +
    (p.element ? item(LAYOUTS_SITE[projectLayout(currentProject)].element || 'Location', p.element) : '') +
    (chainageText(p) || !p.element ? item('Chainage', chainageText(p) || '—') : '') +
    item('Activity', p.activity) +
    item('Side', p.side) +
    item('Type', p.photoType !== 'General' ? p.photoType : '') +
    item('Hindrance', p.hind ? `${p.hind.ref} · ${p.hind.status === 'cleared' ? 'Cleared ' + fmtDate(p.hind.clearedAt) : 'Open, ' + hindDays(p) + ' days'}` : '') +
    item('Backup', !Sync.enabled() ? '' : p.synced ? (p.driveId ? 'In Google Drive' : 'Backed up') : 'Waiting to upload') +
    item('Engineer', p.engineer && p.engineer.name ? [p.engineer.name, p.engineer.designation].filter(Boolean).join(', ') : '') +
    (p.fields || []).map(f => item(f.label, f.value, true)).join('') +
    item('Place', p.address || '', true) +
    item('Facing', p.heading != null ? headingText(p.heading) : '') +
    item('GPS', loc ? `${loc.lat}, ${loc.lng}${loc.accuracy != null ? ` (±${loc.accuracy} m)` : ''}${loc.altitude != null ? ` · altitude ${loc.altitude} m` : ''}` : '', true) +
    (p.imported ? item('Imported from', [p.imported.from, p.imported.camera].filter(Boolean).join(' · '), true) : '') +
    (p.previewOnly ? item('Photo', `Small preview. The full photo is in ${takenByOther(p) ? (p.engineer.name || p.driveOwner || 'a colleague') + "'s" : 'your'} Google Drive: tap Full photo to save it to this phone or to your Drive.`, true) : '');
  document.getElementById('modal-desc').value = p.description || '';
  document.getElementById('ai-caption-btn').style.display = AI.available() ? '' : 'none';
  document.getElementById('photo-modal').classList.add('visible');
}

async function closePhotoModal() {
  const p = currentModalPhoto;
  if (p) {
    const desc = document.getElementById('modal-desc').value.trim();
    if (desc !== (p.description || '')) {
      p.description = desc;
      p.imageData = writeExif(p.imageData, p);   // keep the file's own metadata in step
      p.updatedAt = Date.now(); p.synced = false;
      await DB.save(p);
      Sync.schedule();
      showToast('Description saved', 'success');
    }
  }
  document.getElementById('photo-modal').classList.remove('visible');
  currentModalPhoto = null;
}

async function aiCaption() {
  const p = currentModalPhoto;
  if (!p) return;
  try {
    showLoading('Describing the photo…', 'You can edit the text before it is saved');
    const r = await AI.call('caption', {
      image: await downscaleDataUrl(p.imageData, 1024),
      activity: p.activity, chainage: placeText(p, 'long'), side: p.side, photoType: p.photoType,
      existing: document.getElementById('modal-desc').value
    });
    const box = document.getElementById('modal-desc');
    box.value = box.value ? box.value + '\n' + r.text : r.text;
  } catch (e) {
    showToast('Could not reach the AI service', 'danger');
  } finally { hideLoading(); }
}

async function deletePhotoFromModal() {
  if (!currentModalPhoto) return;
  const id = currentModalPhoto.id;
  document.getElementById('photo-modal').classList.remove('visible');
  currentModalPhoto = null;
  await deletePhotos([id]);
}

async function deletePhotos(ids, quiet) {
  for (const id of ids) {
    const ph = photos.find(p => p.id === id);
    await DB.delPhoto(id);
    Sync.markDeleted('photos', id, ph ? Sync.photoPath(ph) : '');
  }
  photos = photos.filter(p => !ids.includes(p.id));
  ids.forEach(id => selectedPhotos.delete(id));
  updateSelectionUI();
  if (currentTab === 'gallery') renderGallery();
  updateLastThumb();
  updateHindranceBadge();
  Sync.updateDot();
  showToast(quiet ? 'Photo removed — take it again' : `${ids.length} photo${ids.length === 1 ? '' : 's'} deleted`, 'danger');
}

async function deleteSelected() {
  if (!selectedPhotos.size) return;
  const ok = await askText(`Delete ${selectedPhotos.size} photo(s)?`, 'Type DELETE to confirm.');
  if (ok && ok.toUpperCase() === 'DELETE') deletePhotos([...selectedPhotos]);
}

// ============================================================
// SAVE / SHARE PHOTOS
// ============================================================
async function downloadPhoto(p) {
  if (!p) return;
  let data = p.imageData;
  if (p.previewOnly) {
    try { showLoading('Getting the full photo…'); data = await fullImageOf(p); }
    catch (e) { hideLoading(); showToast(e.message + '. Saving the preview instead.', ''); }
    hideLoading();
  }
  const ok = await saveFile(data, photoFileName(p), 'image/jpeg');
  savedMessage(ok, 'Photo', 'image/jpeg');
}

function shareText(list) {
  if (list.length === 1) {
    const p = list[0];
    return [p.projectName, p.activity, p.element, chainageText(p) ? 'Ch ' + chainageText(p) : '', p.side, fieldsText(p, ', '), p.description].filter(Boolean).join(' | ');
  }
  return `${currentProject.name}: ${list.length} site photos`;
}

async function sharePhotoList(list, app = '') {
  if (!list.length) return;
  const full = await fullImages(list, 'Getting full photos to share…');     // previews of colleagues' photos
  shareFiles(full.map(p => ({ name: photoFileName(p), mime: 'image/jpeg', data: p.imageData })), shareText(full), app);
}

function sharePhoto(p, app = '') { if (p) sharePhotoList([p], app); }
function shareSelected(app = '') { sharePhotoList(photos.filter(p => selectedPhotos.has(p.id)), app); }

function downscaleDataUrl(dataUrl, max) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}
