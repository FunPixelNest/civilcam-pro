// ============================================================
// GALLERY
// ============================================================
function getFilteredPhotos() {
  const now = new Date();
  let filtered = [...photos];

  // Time filter
  if (currentTimePeriod !== 'all' && currentTimePeriod !== 'activity') {
    filtered = filtered.filter(p => {
      const d = new Date(p.timestamp);
      if (currentTimePeriod === 'today') {
        return p.date === now.toISOString().split('T')[0];
      } else if (currentTimePeriod === 'week') {
        return getWeekNumber(d) === getWeekNumber(now);
      } else if (currentTimePeriod === 'month') {
        return p.month === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      } else if (currentTimePeriod === 'quarter') {
        const q = Math.ceil((now.getMonth() + 1) / 3);
        return p.quarter === `${now.getFullYear()}-Q${q}`;
      } else if (currentTimePeriod === 'year') {
        return p.year === String(now.getFullYear());
      }
      return true;
    });
  }

  // Activity filter
  if (currentTimePeriod === 'activity' && currentGalleryActivity !== 'all') {
    filtered = filtered.filter(p => p.activity === currentGalleryActivity);
  }

  // Search
  if (gallerySearchText) {
    const q = gallerySearchText.toLowerCase();
    filtered = filtered.filter(p =>
      (p.activity || '').toLowerCase().includes(q) ||
      (p.remarks || '').toLowerCase().includes(q) ||
      (p.chainage || '').toLowerCase().includes(q) ||
      (p.side || '').toLowerCase().includes(q) ||
      (p.displayDate || '').includes(q)
    );
  }

  return filtered;
}

function getGroupKey(photo) {
  if (currentTimePeriod === 'today') return photo.displayDate;
  if (currentTimePeriod === 'week') return photo.weekNum;
  if (currentTimePeriod === 'month') return photo.displayDate;
  if (currentTimePeriod === 'quarter') return photo.monthLabel;
  if (currentTimePeriod === 'year') return photo.monthLabel;
  if (currentTimePeriod === 'activity') return photo.activity;
  // all: group by month
  return photo.monthLabel;
}

function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  const filtered = getFilteredPhotos();

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="gallery-empty">
        <div class="gallery-empty-icon">📷</div>
        <div class="gallery-empty-text">No photos yet</div>
        <div class="gallery-empty-sub">Switch to Camera tab and capture your first photo</div>
      </div>`;
    return;
  }

  // Group photos
  const groups = {};
  filtered.forEach(p => {
    const key = getGroupKey(p);
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  let html = '';
  Object.entries(groups).forEach(([groupKey, groupPhotos]) => {
    html += `<div class="gallery-group">
      <div class="gallery-group-header">${groupKey} <span style="color:var(--text3);font-weight:400">(${groupPhotos.length})</span></div>
      <div class="photo-grid">`;
    groupPhotos.forEach(p => {
      const sel = selectedPhotos.has(p.id);
      html += `<div class="photo-thumb${sel?' selected':''}" data-id="${p.id}"
        onclick="onThumbClick('${p.id}')" oncontextmenu="onThumbLongPress(event,'${p.id}')">
        <img src="${p.imageData}" loading="lazy" alt="">
        <div class="select-badge">✓</div>
        ${p.chainage ? `<div class="meta-badge">Ch ${p.chainage}</div>` : ''}
      </div>`;
    });
    html += `</div></div>`;
  });

  grid.innerHTML = html;
}

function onThumbClick(id) {
  if (selectedPhotos.size > 0) {
    toggleSelect(id);
  } else {
    openPhotoModal(id);
  }
}

function onThumbLongPress(e, id) {
  e.preventDefault();
  toggleSelect(id);
}

function toggleSelect(id) {
  if (selectedPhotos.has(id)) selectedPhotos.delete(id);
  else selectedPhotos.add(id);
  updateSelectionUI();
  renderGallery();
}

function clearSelection() {
  selectedPhotos.clear();
  updateSelectionUI();
  renderGallery();
}

function updateSelectionUI() {
  const bar = document.getElementById('gallery-action-bar');
  const lbl = document.getElementById('sel-count-lbl');
  bar.classList.toggle('visible', selectedPhotos.size > 0);
  lbl.textContent = `${selectedPhotos.size} selected`;
}

function filterGallery() {
  gallerySearchText = document.getElementById('gallery-search-input').value;
  renderGallery();
}

function clearSearch() {
  document.getElementById('gallery-search-input').value = '';
  gallerySearchText = '';
  renderGallery();
}

function setTimePeriod(period, el) {
  currentTimePeriod = period;
  document.querySelectorAll('.time-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');

  // Show/hide activity filter row
  const actRow = document.getElementById('gallery-activity-filter');
  if (period === 'activity') {
    actRow.style.display = 'flex';
    buildGalleryActivityFilter();
  } else {
    actRow.style.display = 'none';
  }
  currentGalleryActivity = 'all';
  renderGallery();
}

function buildGalleryActivityFilter() {
  const row = document.getElementById('gallery-activity-filter');
  row.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'act-chip active';
  all.textContent = 'All Activities';
  all.onclick = () => { currentGalleryActivity = 'all'; setActiveChip(row, all); renderGallery(); };
  row.appendChild(all);

  ACTIVITIES.forEach(a => {
    const c = document.createElement('button');
    c.className = 'act-chip';
    c.textContent = a;
    c.onclick = () => { currentGalleryActivity = a; setActiveChip(row, c); renderGallery(); };
    row.appendChild(c);
  });
}

function setActiveChip(row, active) {
  row.querySelectorAll('.act-chip').forEach(c => c.classList.remove('active'));
  active.classList.add('active');
}

// ============================================================
// PHOTO MODAL
// ============================================================
function openPhotoModal(id) {
  const photo = photos.find(p => p.id === id);
  if (!photo) return;
  currentModalPhoto = photo;
  document.getElementById('modal-img').src = photo.imageData;
  document.getElementById('modal-title').textContent =
    `${photo.activity}${photo.chainage ? ' — Ch ' + photo.chainage : ''} — ${photo.displayDate}`;

  const metaGrid = document.getElementById('modal-meta-grid');
  const loc = photo.location;
  metaGrid.innerHTML = `
    <div class="meta-item"><div class="meta-item-label">Date</div><div class="meta-item-value">${photo.displayDate}</div></div>
    <div class="meta-item"><div class="meta-item-label">Time</div><div class="meta-item-value">${photo.displayTime}</div></div>
    <div class="meta-item"><div class="meta-item-label">Activity</div><div class="meta-item-value">${photo.activity}</div></div>
    <div class="meta-item"><div class="meta-item-label">Chainage</div><div class="meta-item-value">${photo.chainage || '-'}</div></div>
    <div class="meta-item"><div class="meta-item-label">Side</div><div class="meta-item-value">${photo.side || '-'}</div></div>
    <div class="meta-item"><div class="meta-item-label">Project</div><div class="meta-item-value">${photo.projectName}</div></div>
    <div class="meta-item"><div class="meta-item-label">Metadata on Photo</div><div class="meta-item-value">${photo.hasMetadata ? '✅ Yes' : '❌ No'}</div></div>
    ${loc ? `<div class="meta-item full"><div class="meta-item-label">GPS Location</div><div class="meta-item-value">${loc.lat}°N, ${loc.lng}°E (±${loc.accuracy}m)</div></div>` : ''}
    ${photo.remarks ? `<div class="meta-item full"><div class="meta-item-label">Remarks</div><div class="meta-item-value">${photo.remarks}</div></div>` : ''}
  `;
  document.getElementById('photo-modal').classList.add('visible');
}

function closePhotoModal() {
  document.getElementById('photo-modal').classList.remove('visible');
  currentModalPhoto = null;
}

async function deletePhotoFromModal() {
  if (!currentModalPhoto) return;
  await DB.del(currentModalPhoto.id);
  photos = photos.filter(p => p.id !== currentModalPhoto.id);
  closePhotoModal();
  renderGallery();
  updateExportCount();
  showToast('Photo deleted', 'danger');
}

async function deleteSelected() {
  if (selectedPhotos.size === 0) return;
  for (const id of selectedPhotos) {
    await DB.del(id);
    photos = photos.filter(p => p.id !== id);
  }
  showToast(`${selectedPhotos.size} photos deleted`, 'danger');
  selectedPhotos.clear();
  updateSelectionUI();
  renderGallery();
  updateExportCount();
}

// ============================================================
// DOWNLOAD / SHARE
// ============================================================
async function downloadPhoto(photo) {
  if (!photo) return;
  const ok = await saveFile(photo.imageData, photoFileName(photo), 'image/jpeg');
  savedMessage(ok, 'Photo', 'image/jpeg');
}

async function sharePhotoList(list) {
  if (!list.length) return;
  // Android app: hand the files to the native share sheet
  if (hasAndroidBridge() && typeof window.AndroidBridge.shareFiles === 'function') {
    const payload = list.map(p => ({ name: photoFileName(p), mime: 'image/jpeg', data: p.imageData.split(',')[1] }));
    const text = list.length === 1
      ? [list[0].projectName, list[0].activity, siteLabel(list[0].chainage, list[0].side), list[0].remarks].filter(Boolean).join(' | ')
      : projectName;
    window.AndroidBridge.shareFiles(JSON.stringify(payload), text);
    return;
  }
  // Browser: Web Share API, otherwise save the files instead
  try {
    const files = await Promise.all(list.map(async p => {
      const blob = await (await fetch(p.imageData)).blob();
      return new File([blob], photoFileName(p), {type:'image/jpeg'});
    }));
    if (navigator.share && navigator.canShare?.({files})) {
      await navigator.share({files, title: projectName});
      return;
    }
  } catch(e) { /* fall through to saving */ }
  for (const p of list) await downloadPhoto(p);
}

function sharePhoto(photo) {
  if (photo) sharePhotoList([photo]);
}

function shareSelected() {
  sharePhotoList(photos.filter(p => selectedPhotos.has(p.id)));
}

function exportSelectedToGallery() {
  switchTab('export');
}

function openGalleryFromCamera() { switchTab('gallery'); }

