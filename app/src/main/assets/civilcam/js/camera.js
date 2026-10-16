// ============================================================
// ACTIVITY CHIPS
// ============================================================
function buildActivityChips() {
  const row = document.getElementById('activity-row');
  row.innerHTML = '';
  ACTIVITIES.forEach(a => {
    const chip = document.createElement('button');
    chip.className = 'act-chip' + (a === currentActivity ? ' active' : '');
    chip.textContent = a;
    chip.onclick = () => {
      currentActivity = a;
      document.querySelectorAll('#activity-row .act-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      updateOverlayMeta();
    };
    row.appendChild(chip);
  });
}

// ============================================================
// CAMERA
// ============================================================
async function startCamera() {
  try {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); }
    const constraints = {
      video: {
        facingMode,
        width: {ideal: 1920},
        height: {ideal: 1080}
      },
      audio: false
    };
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    document.getElementById('camera-video').srcObject = cameraStream;
  } catch(e) {
    console.error('Camera error:', e);
    showToast('Camera not available: ' + e.message, 'danger');
  }
}

function switchCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
}

let flashEnabled = false;
function toggleFlash() {
  flashEnabled = !flashEnabled;
  const btn = document.getElementById('flash-btn');
  btn.classList.toggle('on', flashEnabled);
  const track = cameraStream?.getVideoTracks()[0];
  if (track && track.getCapabilities().torch !== undefined) {
    track.applyConstraints({advanced:[{torch: flashEnabled}]});
  }
}

// ============================================================
// LOCATION
// ============================================================
function startLocationTracking() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    pos => {
      currentLocation = {
        lat: pos.coords.latitude.toFixed(6),
        lng: pos.coords.longitude.toFixed(6),
        accuracy: Math.round(pos.coords.accuracy)
      };
      const gpsEl = document.getElementById('ov-gps');
      if (gpsEl) gpsEl.textContent = `GPS: ${currentLocation.lat}, ${currentLocation.lng} (±${currentLocation.accuracy}m)`;
    },
    err => {
      const gpsEl = document.getElementById('ov-gps');
      if (gpsEl) gpsEl.textContent = 'GPS: Unavailable (turn on Location)';
    },
    {enableHighAccuracy: true, maximumAge: 5000}
  );
}

// ============================================================
// CLOCK
// ============================================================
function startClock() {
  if (clockInterval) clearInterval(clockInterval);
  function tick() {
    const now = new Date();
    const dateEl = document.getElementById('ov-date');
    const timeEl = document.getElementById('ov-time');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  tick();
  clockInterval = setInterval(tick, 1000);
}

// ============================================================
// METADATA TOGGLE
// ============================================================
function toggleMetadata() {
  metadataEnabled = !metadataEnabled;
  try { localStorage.setItem('stampOn', metadataEnabled ? '1' : '0'); } catch (e) {}
  applyStampUI();
  showToast(metadataEnabled ? 'Details will be stamped on photos' : 'Stamp off: photos saved without details');
}

function applyStampUI() {
  document.getElementById('meta-toggle').classList.toggle('on', metadataEnabled);
  document.getElementById('meta-toggle-lbl').textContent = metadataEnabled ? 'Stamp ON' : 'Stamp OFF';
  document.getElementById('cam-overlay').classList.toggle('visible', metadataEnabled);
}

// ============================================================
// CAPTURE PHOTO
// ============================================================
async function capturePhoto() {
  const video = document.getElementById('camera-video');
  if (!video.srcObject) { showToast('Camera not ready', 'danger'); return; }

  // Flash animation
  const flash = document.getElementById('capture-flash');
  flash.style.opacity = '1';
  setTimeout(() => { flash.style.opacity = '0'; }, 120);

  const canvas = document.getElementById('camera-canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');

  // Draw video frame
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Draw metadata overlay if enabled
  if (metadataEnabled) {
    drawMetadataOverlay(ctx, canvas.width, canvas.height);
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.80);
  const now = new Date();

  const month = now.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  const photo = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2,8),
    timestamp: now.toISOString(),
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().slice(0,8),
    month: `${now.getFullYear()}-${String(month).padStart(2,'0')}`,
    monthLabel: now.toLocaleDateString('en-US', {month:'long', year:'numeric'}),
    year: String(now.getFullYear()),
    quarter: `${now.getFullYear()}-Q${quarter}`,
    quarterLabel: `Q${quarter} ${now.getFullYear()}`,
    weekNum: getWeekNumber(now),
    dayName: now.toLocaleDateString('en-US', {weekday:'long'}),
    displayDate: now.toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-'),
    displayTime: now.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'}),
    activity: currentActivity,
    chainage: getChainage(),
    side: currentSide,
    remarks: document.getElementById('remarks-input').value.trim(),
    location: currentLocation ? {...currentLocation} : null,
    hasMetadata: metadataEnabled,
    projectName: projectName,
    imageData: dataUrl
  };

  await DB.save(photo);
  photos.unshift(photo);
  showToast('📸 Photo captured!', 'success');
  renderGallery();
  updateExportCount();
}

function drawMetadataOverlay(ctx, w, h) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
  const timeStr = now.toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.026));
  const lh = Math.round(fs * 1.4);
  const pad = Math.round(fs * 0.8);
  const chainage = getChainage();
  const remarks = document.getElementById('remarks-input').value.trim();
  const gpsText = currentLocation
    ? `GPS: ${currentLocation.lat}, ${currentLocation.lng} (±${currentLocation.accuracy}m)`
    : 'GPS: Unavailable';

  // [text, colour, bold]; the project name is the same small size as other lines
  const lines = [
    [projectName, '#f59e0b', true],
    [[currentActivity, chainage ? 'Ch: ' + chainage : '', currentSide].filter(Boolean).join('  |  '), '#ffffff', true],
    [`${dateStr}  ${timeStr}`, '#e2e8f0', false],
    [gpsText, '#fcd34d', false],
  ];
  if (remarks) lines.push([remarks.slice(0, 100), '#ffffff', false]);

  const boxH = lines.length * lh + pad * 1.4;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, h - boxH, w, boxH);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach(([text, colour, bold], i) => {
    ctx.font = `${bold ? 'bold ' : ''}${fs}px sans-serif`;
    ctx.fillStyle = colour;
    ctx.fillText(text, pad, h - boxH + pad * 0.7 + i * lh, w - pad * 2);
  });
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil((((date - yearStart) / 86400000) + 1) / 7)).padStart(2,'0')}`;
}

