// ============================================================
// SAME-SPOT REPEAT PHOTOS
// The earlier photo is shown faintly over the live camera so the new
// one lines up; the details are copied; GPS says how far away you are.
// The new photo gets photo.repeatOf = <earlier id>, so before / after
// pairs can be compared later.
// ============================================================
let repeatTarget = null;      // { id, clearHindrance }
let repeatTimer = null;

function startRepeat(id, opts = {}) {
  const p = photos.find(x => x.id === id);
  if (!p) return;
  repeatTarget = { id, clearHindrance: opts.clearHindrance || null };

  // Copy the details of the earlier photo
  currentActivity = p.activity || currentActivity;
  currentSide = p.side || currentSide;
  currentPhotoType = opts.clearHindrance ? 'General' : (p.photoType || 'General');
  document.getElementById('ch-from-input').value = p.chFrom || '';
  document.getElementById('ch-to-input').value = p.chTo || '';
  document.getElementById('desc-input').value = opts.clearHindrance && p.hind ? `Hindrance ${p.hind.ref} cleared` : '';
  if (typeof renderDetailChips === 'function') renderDetailChips();
  updateOverlayMeta();

  // Ghost of the earlier photo over the camera
  const ghost = document.getElementById('ghost-img');
  ghost.src = p.imageData || '';
  ghost.style.opacity = loadJSON('ghostOpacity', 0.4);
  document.getElementById('ghost-opacity').value = Math.round(loadJSON('ghostOpacity', 0.4) * 100);
  document.getElementById('repeat-title').textContent = opts.clearHindrance && p.hind
    ? `Clearance photo for ${p.hind.ref}` : `Same spot as ${p.displayDate}`;
  document.getElementById('repeat-bar').classList.add('visible');
  ghost.classList.add('visible');
  document.getElementById('camera-screen').classList.add('repeating');

  if (document.getElementById('photo-modal').classList.contains('visible')) closePhotoModal();
  switchTab('camera');
  clearInterval(repeatTimer);
  updateRepeatDistance();
  repeatTimer = setInterval(updateRepeatDistance, 1500);
}

function endRepeat() {
  repeatTarget = null;
  clearInterval(repeatTimer);
  document.getElementById('repeat-bar').classList.remove('visible');
  const ghost = document.getElementById('ghost-img');
  ghost.classList.remove('visible');
  document.getElementById('camera-screen').classList.remove('repeating');
  ghost.removeAttribute('src');
}

function setGhostOpacity(v) {
  const o = Math.max(0, Math.min(0.85, v / 100));
  document.getElementById('ghost-img').style.opacity = o;
  saveJSON('ghostOpacity', o);
}

// Distance in metres between two { lat, lng } points
function gpsDistance(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function updateRepeatDistance() {
  const el = document.getElementById('repeat-gps');
  if (!repeatTarget) return;
  const p = photos.find(x => x.id === repeatTarget.id);
  if (!p || !p.location) { el.textContent = 'The earlier photo has no GPS. Line it up by eye.'; el.className = 'repeat-gps'; return; }
  if (!currentLocation) { el.textContent = 'Waiting for GPS…'; el.className = 'repeat-gps'; return; }
  const d = Math.round(gpsDistance(
    { lat: +p.location.lat, lng: +p.location.lng },
    { lat: +currentLocation.lat, lng: +currentLocation.lng }));
  const near = d <= Math.max(8, +currentLocation.accuracy || 0);
  el.textContent = near ? `You are at the spot (${d} m)` : `${d} m from where the earlier photo was taken`;
  el.className = 'repeat-gps ' + (near ? 'near' : d > 50 ? 'far' : '');
}

// Called by capturePhoto() just before saving
function applyRepeatTo(photo) {
  if (repeatTarget) photo.repeatOf = repeatTarget.id;
}

// Called by capturePhoto() after saving
async function afterRepeatCapture(photo) {
  if (!repeatTarget) return false;
  const t = repeatTarget;
  endRepeat();
  if (t.clearHindrance) await markHindranceCleared(t.clearHindrance, { photoId: photo.id });
  const earlier = photos.find(x => x.id === t.id);
  showToast(t.clearHindrance && earlier && earlier.hind ? `${earlier.hind.ref} cleared` : 'Photo saved', 'success', { label: 'COMPARE', onClick: () => openCompare(t.id, photo.id) });
  return true;
}

// Photos linked to this one (earlier one, and later repeats), oldest first
function linkedPhotos(p) {
  const root = p.repeatOf ? photos.find(x => x.id === p.repeatOf) || p : p;
  const chain = [root, ...photos.filter(x => x.repeatOf === root.id)];
  return chain.filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function compareFromModal() {
  const p = currentModalPhoto;
  if (!p) return;
  const chain = linkedPhotos(p);
  if (chain.length < 2) return;
  const other = p.id === chain[0].id ? chain[chain.length - 1] : chain[0];
  closePhotoModal();
  openCompare(other.id, p.id);
}

// ---- before / after: drag the line to wipe between the two ----
function openCompare(aId, bId) {
  const [a, b] = [aId, bId].map(id => photos.find(x => x.id === id)).sort((x, y) => new Date(x.timestamp) - new Date(y.timestamp));
  if (!a || !b) return;
  document.getElementById('cmp-before').src = a.imageData || '';
  document.getElementById('cmp-after').src = b.imageData || '';
  document.getElementById('cmp-before-lbl').textContent = 'Before · ' + a.displayDate;
  document.getElementById('cmp-after-lbl').textContent = 'After · ' + b.displayDate;
  document.getElementById('cmp-title').textContent = [a.activity, placeText(a)].filter(Boolean).join(' · ');
  setWipe(50);
  document.getElementById('compare-modal').classList.add('visible');
}

function closeCompare() { document.getElementById('compare-modal').classList.remove('visible'); }

function setWipe(pct) {
  pct = Math.max(0, Math.min(100, pct));
  document.getElementById('cmp-after').style.clipPath = `inset(0 0 0 ${pct}%)`;
  document.getElementById('cmp-line').style.left = pct + '%';
}

(function attachWipe() {
  const stage = () => document.getElementById('cmp-stage');
  let down = false;
  const move = e => {
    if (!down) return;
    const r = stage().getBoundingClientRect();
    setWipe((e.clientX - r.left) / r.width * 100);
  };
  document.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('#cmp-stage')) { down = true; move(e); }
  });
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', () => { down = false; });
})();
