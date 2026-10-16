// ============================================================
// STATE
// ============================================================
let projectName = '';
let recentProjects = [];
let currentActivity = 'Earthwork';
let currentSide = 'LHS';
let metadataEnabled = false;
let cameraStream = null;
let facingMode = 'environment';
let currentLocation = null;
let clockInterval = null;
let photos = [];
let selectedPhotos = new Set();
let currentTimePeriod = 'all';
let currentGalleryActivity = 'all';
let gallerySearchText = '';
let currentExportPeriod = 'all';
let currentTemplate = 'grid';
let currentFormat = 'pdf';
let currentModalPhoto = null;

const SIDES = ['LHS', 'RHS', 'Both Sides', 'Median', 'Centre Line'];

const ACTIVITIES = [
  'Earthwork','Roadwork','Concrete Works','Masonry','Reinforcement/Steel',
  'Drainage Works','Bridge Works','Culvert Works','Retaining Wall',
  'Pavement Works','Signage & Marking','Safety Works','Site Clearing',
  'Survey Works','Foundation Works','Finishing Works','Testing & QA','Other'
];

// ============================================================
// INDEXEDDB
// ============================================================
const DB = (() => {
  let db = null;
  function init() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('CivilCamPro', 2);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('photos')) {
          const s = d.createObjectStore('photos', {keyPath:'id'});
          s.createIndex('date','date',{unique:false});
          s.createIndex('month','month',{unique:false});
          s.createIndex('year','year',{unique:false});
          s.createIndex('quarter','quarter',{unique:false});
          s.createIndex('activity','activity',{unique:false});
        }
      };
      req.onsuccess = e => { db = e.target.result; res(); };
      req.onerror = rej;
    });
  }
  function save(photo) {
    return new Promise((res, rej) => {
      const tx = db.transaction('photos','readwrite');
      tx.objectStore('photos').put(photo).onsuccess = () => res();
      tx.onerror = rej;
    });
  }
  function getAll() {
    return new Promise((res, rej) => {
      const tx = db.transaction('photos','readonly');
      const req = tx.objectStore('photos').getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = rej;
    });
  }
  function del(id) {
    return new Promise((res, rej) => {
      const tx = db.transaction('photos','readwrite');
      tx.objectStore('photos').delete(id).onsuccess = () => res();
      tx.onerror = rej;
    });
  }
  return {init, save, getAll, del};
})();

// ============================================================
// SITE DETAILS: SIDE CHIPS + LIVE OVERLAY
// ============================================================
function buildSideChips() {
  const row = document.getElementById('side-row');
  row.innerHTML = '<span class="field-lbl">Side</span>';
  SIDES.forEach(s => {
    const chip = document.createElement('button');
    chip.className = 'act-chip' + (s === currentSide ? ' active' : '');
    chip.textContent = s;
    chip.onclick = () => {
      currentSide = s;
      row.querySelectorAll('.act-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      updateOverlayMeta();
    };
    row.appendChild(chip);
  });
}

function getChainage() {
  return document.getElementById('chainage-input').value.trim();
}

function siteLabel(chainage, side) {
  const parts = [];
  if (chainage) parts.push('Ch: ' + chainage);
  if (side) parts.push(side);
  return parts.join('  |  ');
}

function updateOverlayMeta() {
  const act = document.getElementById('ov-activity');
  if (act) act.textContent = currentActivity;
  const site = document.getElementById('ov-site');
  if (site) site.textContent = siteLabel(getChainage(), currentSide);
  const rem = document.getElementById('ov-remarks');
  if (rem) rem.textContent = document.getElementById('remarks-input').value.trim();
}

// ============================================================
// SAVE / SHARE HELPERS (work in Android app and in browser)
// ============================================================
function hasAndroidBridge() {
  return typeof window.AndroidBridge !== 'undefined' && typeof window.AndroidBridge.saveFile === 'function';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function toBase64(data) {
  return typeof data === 'string' ? data.split(',')[1] : await blobToBase64(data);
}

function safeFileName(name) {
  return name.replace(/[^a-z0-9._+-]/gi, '_');
}

// data: a Blob or a data: URL string
async function saveFile(data, filename, mime) {
  filename = safeFileName(filename);
  if (hasAndroidBridge()) {
    const b64 = await toBase64(data);
    return window.AndroidBridge.saveFile(b64, filename, mime);
  }
  const url = typeof data === 'string' ? data : URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

function savedMessage(ok, what, mime) {
  if (!ok) { showToast('Could not save ' + what, 'danger'); return; }
  if (hasAndroidBridge()) {
    const folder = mime && mime.startsWith('image/') ? 'Pictures/CivilCam' : 'Download/CivilCam';
    showToast('✅ ' + what + ' saved to ' + folder, 'success');
  } else {
    showToast('✅ ' + what + ' downloaded', 'success');
  }
}

function photoFileName(p) {
  const ch = p.chainage ? '_Ch' + p.chainage : '';
  return safeFileName(`${p.projectName}_${p.activity}${ch}_${p.displayDate}_${(p.time || '').replace(/:/g, '')}.jpg`);
}

