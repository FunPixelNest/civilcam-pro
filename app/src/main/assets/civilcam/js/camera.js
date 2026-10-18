// ============================================================
// PHOTO DETAILS SHEET
// ============================================================
let hindranceValues = {};   // { 'Land owner name': 'K. Ramesh', ... }

function renderDetailChips() {
  renderChips('type-row', 'photoType', currentPhotoType, v => {
    currentPhotoType = v;
    if (v === 'Hindrance' && getOptions('activity').includes('Hindrance')) currentActivity = 'Hindrance';
    renderDetailChips();
    updateOverlayMeta();
  }, { others: true, othersLabel: 'Add a photo type' });
  renderChips('activity-row', 'activity', currentActivity, v => {
    currentActivity = v; renderDetailChips(); updateOverlayMeta();
  }, { others: true, othersLabel: 'Add an activity' });
  renderChips('side-row', 'side', currentSide, v => {
    currentSide = v; renderDetailChips(); updateOverlayMeta();
  }, { others: true, othersLabel: 'Add a side / location' });
  document.getElementById('hindrance-block').style.display = currentPhotoType === 'Hindrance' ? '' : 'none';
  renderHindranceFields();
}

function renderHindranceFields() {
  const wrap = document.getElementById('hindrance-fields');
  wrap.innerHTML = getOptions('hindranceField').map((label, i) => `
    <label class="field compact"><span>${esc(label)}</span>
      <input class="input" data-hf="${esc(label)}" value="${esc(hindranceValues[label] || '')}"
        ${/phone/i.test(label) ? 'inputmode="tel"' : ''} oninput="hindranceValues[this.dataset.hf]=this.value;updateOverlayMeta()"></label>`).join('');
}

async function addHindranceField() {
  const label = await askText('Add a field', 'e.g. Khata no., Tree count, Structure type. It stays for next time.');
  if (!label) return;
  await addOption('hindranceField', label);
  renderHindranceFields();
}

function getDetails() {
  const fromRaw = document.getElementById('ch-from-input').value.trim();
  const toRaw = document.getElementById('ch-to-input').value.trim();
  const chFrom = normCh(fromRaw);
  const chTo = normCh(toRaw);
  const fields = currentPhotoType === 'Hindrance'
    ? getOptions('hindranceField').map(label => ({ label, value: (hindranceValues[label] || '').trim() })).filter(f => f.value)
    : [];
  return {
    activity: currentActivity, side: currentSide, photoType: currentPhotoType,
    chFrom, chTo: chTo === chFrom ? '' : chTo,
    chFromM: parseCh(chFrom), chToM: chTo === chFrom ? null : parseCh(chTo),
    description: document.getElementById('desc-input').value.trim(),
    fields
  };
}

function updateChHint() {
  const el = document.getElementById('ch-hint');
  if (!el || !currentProject) return;
  const d = getDetails();
  const p = currentProject;
  let msg = '';
  if (isLinearProject(p)) {
    msg = `Project runs ${fmtCh(p.startM)} to ${fmtCh(p.endM)}.`;
    const bad = [d.chFromM, d.chToM].some(m => m != null && (m < p.startM || m > p.endM));
    if (bad) msg = `Outside the project (${fmtCh(p.startM)} – ${fmtCh(p.endM)}). Check the chainage.`;
    el.classList.toggle('warn', bad);
  }
  el.textContent = msg;
}

function updateOverlayMeta() {
  const d = getDetails();
  const site = [d.activity, chainageText(d, 'short') ? 'Ch ' + chainageText(d, 'short') : '', d.side].filter(Boolean).join('  |  ');
  document.getElementById('ov-main').textContent = site;
  document.getElementById('ov-engineer').textContent = profile.name ? 'Engineer: ' + [profile.name, profile.designation].filter(Boolean).join(', ') : '';
  const descBits = [fieldsText(d), d.description].filter(Boolean).join('  |  ');
  document.getElementById('ov-desc').textContent = descBits;

  document.getElementById('dc-main').textContent = (d.photoType !== 'General' ? d.photoType + ' · ' : '') + d.activity;
  const parts = [chainageText(d, 'short') ? 'Ch ' + chainageText(d, 'short') : 'No chainage', d.side];
  if (descBits) parts.push(descBits);
  document.getElementById('dc-sub').textContent = parts.join('  ·  ');
  updateChHint();
}

function openDetailsSheet() {
  renderDetailChips();
  openSheet('details-sheet');
}

function closeDetailsSheet() {
  closeSheet('details-sheet');
  saveJSON('camDetails', {
    activity: currentActivity, side: currentSide, photoType: currentPhotoType,
    chFrom: document.getElementById('ch-from-input').value, chTo: document.getElementById('ch-to-input').value
  });
  updateOverlayMeta();
}

function restoreCamDetails() {
  const s = loadJSON('camDetails', null);
  if (!s) return;
  currentActivity = s.activity || currentActivity;
  currentSide = s.side || currentSide;
  currentPhotoType = s.photoType || 'General';
  document.getElementById('ch-from-input').value = s.chFrom || '';
  document.getElementById('ch-to-input').value = s.chTo || '';
}

// ============================================================
// CAMERA
// ============================================================
async function startCamera() {
  if (cameraStream || !document.getElementById('app').classList.contains('visible')) return;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
    });
    document.getElementById('camera-video').srcObject = cameraStream;
  } catch (e) {
    console.error('Camera error:', e);
    showToast('Camera not available: ' + e.message, 'danger');
  }
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
}

function switchCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  stopCamera();
  startCamera();
}

let flashEnabled = false;
function toggleFlash() {
  flashEnabled = !flashEnabled;
  document.getElementById('flash-btn').classList.toggle('on', flashEnabled);
  const track = cameraStream && cameraStream.getVideoTracks()[0];
  if (track && track.getCapabilities && track.getCapabilities().torch !== undefined) {
    track.applyConstraints({ advanced: [{ torch: flashEnabled }] });
  }
}

function startLocationTracking() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    pos => {
      currentLocation = {
        lat: pos.coords.latitude.toFixed(6),
        lng: pos.coords.longitude.toFixed(6),
        accuracy: Math.round(pos.coords.accuracy)
      };
      document.getElementById('ov-gps').textContent = `GPS: ${currentLocation.lat}, ${currentLocation.lng} (±${currentLocation.accuracy}m)`;
    },
    () => { document.getElementById('ov-gps').textContent = 'GPS: Unavailable (turn on Location)'; },
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

function startClock() {
  if (clockInterval) clearInterval(clockInterval);
  const tick = () => {
    const now = new Date();
    document.getElementById('ov-date').textContent = fmtDate(now);
    document.getElementById('ov-time').textContent = now.toLocaleTimeString('en-GB');
  };
  tick();
  clockInterval = setInterval(tick, 1000);
}

function toggleMetadata() {
  metadataEnabled = !metadataEnabled;
  try { localStorage.setItem('stampOn', metadataEnabled ? '1' : '0'); } catch (e) {}
  applyStampUI();
  showToast(metadataEnabled ? 'Details will be printed on photos' : 'Stamp off: details saved in the file only');
}

function applyStampUI() {
  document.getElementById('meta-toggle').classList.toggle('on', metadataEnabled);
  document.getElementById('meta-toggle-lbl').textContent = metadataEnabled ? 'Stamp on' : 'Stamp off';
  document.getElementById('cam-overlay').classList.toggle('visible', metadataEnabled);
}

function updateLastThumb() {
  const btn = document.getElementById('last-thumb');
  const latest = currentProject ? projectPhotos()[0] : null;
  btn.style.backgroundImage = latest && latest.imageData ? `url("${latest.imageData}")` : '';
  btn.innerHTML = latest ? '' : ic('image', 20);
}

// ============================================================
// CAPTURE
// ============================================================
async function capturePhoto() {
  const video = document.getElementById('camera-video');
  if (!video.srcObject) { showToast('Camera not ready', 'danger'); return; }
  if (!currentProject) return;

  const flash = document.getElementById('capture-flash');
  flash.style.opacity = '1';
  setTimeout(() => { flash.style.opacity = '0'; }, 120);

  const canvas = document.getElementById('camera-canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const sharpness = measureSharpness(canvas);   // before the stamp is drawn

  const now = new Date();
  const details = getDetails();
  const photo = normPhoto(Object.assign({
    id: now.getTime() + '-' + Math.random().toString(36).slice(2, 8),
    projectId: currentProject.id,
    projectName: currentProject.name,
    projectFullName: currentProject.fullName,
    timestamp: now.toISOString(),
    date: localDateKey(now),
    time: now.toTimeString().slice(0, 8),
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    year: String(now.getFullYear()),
    quarter: `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`,
    displayDate: fmtDate(now),
    displayTime: fmtTime(now),
    location: currentLocation ? Object.assign({}, currentLocation) : null,
    engineer: { name: profile.name, designation: profile.designation, email: profile.email },
    hasMetadata: metadataEnabled,
    sharpness,
    updatedAt: now.getTime(),
    synced: false
  }, details));

  if (metadataEnabled) drawStamp(ctx, canvas.width, canvas.height, photo);
  photo.imageData = writeExif(canvas.toDataURL('image/jpeg', 0.85), photo);

  await DB.save(photo);
  photos.unshift(photo);
  Sync.schedule();

  // Clear one-off details unless the engineer asked to keep them
  if (!document.getElementById('desc-keep').checked) {
    document.getElementById('desc-input').value = '';
    hindranceValues = {};
    renderHindranceFields();
    updateOverlayMeta();
  }
  updateLastThumb();

  if (sharpness !== null && sharpness < BLUR_LIMIT) {
    showToast('This photo may be blurry', 'danger', { label: 'RETAKE', onClick: () => deletePhotos([photo.id], true) });
  } else {
    showToast('Saved to ' + currentProject.name, 'success');
  }
}

// Stamp printed along the bottom of the photo; long text wraps instead of being cut
function drawStamp(ctx, w, h, p) {
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.024));
  const lh = Math.round(fs * 1.38);
  const pad = Math.round(fs * 0.8);
  const maxW = w - pad * 2;
  const gpsText = p.location ? `GPS: ${p.location.lat}, ${p.location.lng} (±${p.location.accuracy}m)` : 'GPS: Unavailable';
  const lines = [];
  const push = (text, colour, bold, maxLines = 1) => {
    if (!text) return;
    ctx.font = `${bold ? 'bold ' : ''}${fs}px sans-serif`;
    wrapText(ctx, text, maxW, maxLines).forEach(t => lines.push([t, colour, bold]));
  };
  push(p.projectName, '#fbbf24', true);
  push([p.activity, chainageText(p, 'short') ? 'Ch: ' + chainageText(p, 'short') : '', p.side].filter(Boolean).join('  |  '), '#ffffff', true, 2);
  push(`${p.displayDate}  ${new Date(p.timestamp).toLocaleTimeString('en-GB')}`, '#e2e8f0', false);
  push(gpsText, '#fcd34d', false);
  if (p.engineer && p.engineer.name) push('Engineer: ' + [p.engineer.name, p.engineer.designation].filter(Boolean).join(', '), '#e2e8f0', false);
  const long = p.photoType === 'Hindrance' ? 8 : 4;
  push(fieldsText(p), '#ffffff', false, long);
  push(p.description, '#ffffff', false, long);

  const boxH = lines.length * lh + pad * 1.4;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, h - boxH, w, boxH);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach(([text, colour, bold], i) => {
    ctx.font = `${bold ? 'bold ' : ''}${fs}px sans-serif`;
    ctx.fillStyle = colour;
    ctx.fillText(text, pad, h - boxH + pad * 0.7 + i * lh);
  });
}

function wrapText(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width <= maxW || !line) { line = test; continue; }
    out.push(line);
    line = word;
    if (out.length === maxLines) break;
  }
  if (out.length < maxLines && line) out.push(line);
  const used = out.join(' ').split(/\s+/).length;
  if (used < words.length && out.length) {
    let last = out[out.length - 1];
    while (last && ctx.measureText(last + ' …').width > maxW) last = last.slice(0, -1);
    out[out.length - 1] = last + ' …';
  }
  return out;
}

// ============================================================
// BLUR CHECK (on the phone, no internet needed)
// ============================================================
const BLUR_LIMIT = 40;
function measureSharpness(src) {
  try {
    const W = 320, H = Math.round(320 * src.height / src.width);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    const g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    let sum = 0, sum2 = 0, n = 0;
    for (let yy = 1; yy < H - 1; yy++) {
      for (let xx = 1; xx < W - 1; xx++) {
        const i = yy * W + xx;
        const lap = g[i - W] + g[i + W] + g[i - 1] + g[i + 1] - 4 * g[i];
        sum += lap; sum2 += lap * lap; n++;
      }
    }
    const mean = sum / n;
    return Math.round(sum2 / n - mean * mean);
  } catch (e) { return null; }
}

// ============================================================
// METADATA INSIDE THE JPEG (EXIF) — shows in Gallery / Windows file properties
// ============================================================
function asciiOnly(s) { return String(s || '').replace(/[^\x20-\x7E]/g, '?'); }
function ucs2Bytes(s) {
  const out = [];
  for (const ch of String(s || '') + '\0') { const c = ch.charCodeAt(0); out.push(c & 255, c >> 8); }
  return out;
}
function toRational(deg) {
  const d = Math.floor(deg), mFloat = (deg - d) * 60, m = Math.floor(mFloat), s = Math.round((mFloat - m) * 60 * 100);
  return [[d, 1], [m, 1], [s, 100]];
}

function photoSummaryText(p) {
  return [
    `${p.projectFullName || p.projectName}`,
    `Activity: ${p.activity}`,
    chainageText(p) ? `Chainage: ${chainageText(p)}` : '',
    p.side ? `Side: ${p.side}` : '',
    p.photoType !== 'General' ? `Type: ${p.photoType}` : '',
    fieldsText(p, '; '),
    p.description ? `Description: ${p.description}` : '',
    p.engineer && p.engineer.name ? `Engineer: ${[p.engineer.name, p.engineer.designation].filter(Boolean).join(', ')}` : ''
  ].filter(Boolean).join(' | ');
}

function writeExif(dataUrl, p) {
  if (typeof piexif === 'undefined') return dataUrl;
  try {
    const d = new Date(p.timestamp);
    const stamp = `${d.getFullYear()}:${String(d.getMonth() + 1).padStart(2, '0')}:${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 8)}`;
    const summary = photoSummaryText(p);
    const zeroth = {};
    zeroth[piexif.ImageIFD.ImageDescription] = asciiOnly(summary);
    zeroth[piexif.ImageIFD.Software] = 'CivilCam Pro';
    zeroth[piexif.ImageIFD.DateTime] = stamp;
    if (p.engineer && p.engineer.name) {
      zeroth[piexif.ImageIFD.Artist] = asciiOnly(p.engineer.name);
      zeroth[piexif.ImageIFD.XPAuthor] = ucs2Bytes(p.engineer.name);
    }
    zeroth[piexif.ImageIFD.XPTitle] = ucs2Bytes([p.activity, chainageText(p, 'short'), p.side].filter(Boolean).join(' | '));
    zeroth[piexif.ImageIFD.XPComment] = ucs2Bytes(summary);
    zeroth[piexif.ImageIFD.XPSubject] = ucs2Bytes(p.projectFullName || p.projectName);
    zeroth[piexif.ImageIFD.XPKeywords] = ucs2Bytes([p.projectName, p.activity, p.side, p.photoType].filter(Boolean).join(';'));
    const exif = {};
    exif[piexif.ExifIFD.DateTimeOriginal] = stamp;
    exif[piexif.ExifIFD.UserComment] = 'ASCII\0\0\0' + asciiOnly(summary);
    const gps = {};
    if (p.location) {
      const lat = Number(p.location.lat), lng = Number(p.location.lng);
      gps[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? 'N' : 'S';
      gps[piexif.GPSIFD.GPSLatitude] = toRational(Math.abs(lat));
      gps[piexif.GPSIFD.GPSLongitudeRef] = lng >= 0 ? 'E' : 'W';
      gps[piexif.GPSIFD.GPSLongitude] = toRational(Math.abs(lng));
    }
    return piexif.insert(piexif.dump({ '0th': zeroth, 'Exif': exif, 'GPS': gps }), dataUrl);
  } catch (e) {
    console.warn('EXIF not written', e);
    return dataUrl;
  }
}
