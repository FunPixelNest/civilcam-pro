// ============================================================
// STATE
// ============================================================
let projects = [];            // all projects on this phone
let currentProject = null;    // the open project
let photos = [];              // photos of ALL projects (filter with projectPhotos())
let selectedPhotos = new Set();
let currentModalPhoto = null;

// Camera details, remembered between photos
let currentActivity = 'Earthwork';
let currentSide = 'LHS';
let currentPhotoType = 'General';
let currentElement = '';          // floor / pier / zone for non-chainage projects
let metadataEnabled = (() => { try { return localStorage.getItem('stampOn') !== '0'; } catch (e) { return true; } })();
let cameraStream = null;
let facingMode = 'environment';
let currentLocation = null;
let clockInterval = null;

// Engineer profile (filled from sign-in or typed in)
let profile = loadJSON('profile', { name: '', designation: '', company: '', email: '', uid: '', provider: '' });

// ============================================================
// LISTS — built-in values plus the user's own "Others" values
// ============================================================
const DEFAULT_OPTIONS = {
  activity: [
    'Earthwork', 'Roadwork', 'Concrete Works', 'Masonry', 'Reinforcement/Steel',
    'Drainage Works', 'Bridge Works', 'Culvert Works', 'Retaining Wall',
    'Pavement Works', 'Signage & Marking', 'Safety Works', 'Site Clearing',
    'Survey Works', 'Foundation Works', 'Finishing Works', 'Testing & QA', 'Hindrance'
  ],
  side: ['LHS', 'RHS', 'Both Sides', 'Median', 'Centre Line'],
  photoType: ['General', 'Hindrance'],
  hindranceField: ['Land owner name', 'Phone no.', 'Survey no.', 'Village / Location', 'Issue', 'Area affected'],
  projectType: ['Road / Highway', 'Building', 'Bridge / Flyover', 'Canal / Irrigation', 'Railway / Metro', 'Pipeline', 'Plant / Industrial']
};
let customOptions = {};       // { activity: ['Utility Shifting'], side: [...] }

function getOptions(key) {
  const base = baseOptions(key);
  const extra = (customOptions[key] || []).filter(v => !base.includes(v));
  return base.concat(extra);
}

function isCustomOption(key, value) {
  return !baseOptions(key).includes(value);
}

// ============================================================
// SITE TYPES — how a project is laid out on the site map
//   road / canal / rail / pipe : along a chainage
//   building : floors          bridge : abutments and piers (chainage optional)
//   plant    : zones
// ============================================================
const LAYOUTS_SITE = {
  road:     { name: 'Road',            linear: true,  tab: 'Chainage' },
  canal:    { name: 'Canal',           linear: true,  tab: 'Chainage' },
  rail:     { name: 'Rail / Metro',    linear: true,  tab: 'Chainage' },
  pipe:     { name: 'Pipeline',        linear: true,  tab: 'Chainage' },
  bridge:   { name: 'Bridge',          linear: false, tab: 'Piers',  element: 'Pier / Abutment' },
  building: { name: 'Building',        linear: false, tab: 'Floors', element: 'Floor' },
  plant:    { name: 'Zones',           linear: false, tab: 'Zones',  element: 'Zone' }
};

function guessLayout(type) {
  const t = String(type || '').toLowerCase();
  if (/build|tower|apartment|house|hospital|school|college|hotel|mall|office|residen|commercial|villa/.test(t)) return 'building';
  if (/bridge|flyover|viaduct|\brob\b|\brub\b|overpass|underpass/.test(t)) return 'bridge';
  if (/plant|industr|factory|stp|wtp|etp|substation|refinery|warehouse|shed/.test(t)) return 'plant';
  if (/canal|irrig|drain|channel|river|embankment/.test(t)) return 'canal';
  if (/rail|metro|track/.test(t)) return 'rail';
  if (/pipe|water supply|sewer|gas line/.test(t)) return 'pipe';
  return 'road';
}

function projectLayout(p) {
  if (!p) return 'road';
  return p.layout && LAYOUTS_SITE[p.layout] ? p.layout : guessLayout(p.type);
}
function isLinearLayout(p) { return LAYOUTS_SITE[projectLayout(p)].linear; }
function usesElements(p) { return !!LAYOUTS_SITE[projectLayout(p)].element; }

const ORD = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

// Floors / piers / zones of a project, in site order (bottom-up, left to right)
function projectElements(p) {
  const kind = projectLayout(p);
  if (kind === 'building') {
    const b = Math.max(0, +p.basements || 0), f = Math.max(0, p.floors == null ? 4 : +p.floors);
    const out = [];
    if (p.foundation !== false) out.push('Foundation');
    for (let i = b; i >= 1; i--) out.push('Basement ' + i);
    out.push('Ground Floor');
    for (let i = 1; i <= f; i++) out.push(ORD(i) + ' Floor');
    if (p.terrace !== false) out.push('Terrace');
    return out;
  }
  if (kind === 'bridge') {
    const n = Math.max(1, p.spans == null ? 4 : +p.spans);
    const out = ['A1'];
    for (let i = 1; i < n; i++) out.push('P' + i);
    out.push('A2');
    if (p.deck !== false) out.push('Deck / Superstructure');
    return out;
  }
  if (kind === 'plant') return (p.zones && p.zones.length ? p.zones : ['Main building', 'Equipment area', 'Utilities', 'Storage', 'Roads & drains']).slice();
  return [];
}

// "Ch 12+350 · RHS" for roads, "3rd Floor" for buildings, "P4 · Ch 1+200" for bridges
function placeText(p, style = 'short') {
  const ch = chainageText(p, style);
  return [p.element || '', ch ? (style === 'short' ? 'Ch ' : 'Chainage ') + ch : ''].filter(Boolean).join(' · ');
}

// Built-in list values depend on the kind of project that is open
const OPTIONS_BY_LAYOUT = {
  activity: {
    road: null,   // the general list below
    building: ['Excavation', 'PCC', 'Footing / Raft', 'Columns', 'Beams & Slab', 'Shuttering', 'Reinforcement/Steel', 'Concrete Works',
      'Brickwork / Blockwork', 'Plastering', 'Waterproofing', 'Electrical', 'Plumbing', 'Fire Fighting', 'HVAC', 'Flooring / Tiling',
      'Doors & Windows', 'Painting', 'Facade / Glazing', 'Lift', 'External Works', 'Finishing Works', 'Testing & QA', 'Safety Works', 'Hindrance'],
    bridge: ['Piling', 'Pile Cap', 'Open Foundation', 'Pier / Abutment', 'Pier Cap', 'Bearings', 'Girders / Launching', 'Deck Slab',
      'Reinforcement/Steel', 'Concrete Works', 'Expansion Joint', 'Crash Barrier', 'Wearing Coat', 'Approach / RE Wall',
      'Drainage Works', 'Load Test', 'Testing & QA', 'Safety Works', 'Hindrance'],
    canal: ['Site Clearing', 'Earthwork Excavation', 'Embankment', 'Compaction', 'Canal Lining', 'CD Works / Aqueduct', 'Regulator',
      'Fall / Drop', 'Outlet', 'Bridge Works', 'Culvert Works', 'Service Road', 'Survey Works', 'Testing & QA', 'Safety Works', 'Hindrance'],
    rail: ['Site Clearing', 'Formation / Earthwork', 'Blanketing', 'Ballast', 'Sleepers', 'Track Linking', 'Welding', 'Bridge Works',
      'Culvert Works', 'OHE', 'Signalling', 'Station Works', 'Level Crossing', 'Survey Works', 'Testing & QA', 'Safety Works', 'Hindrance'],
    pipe: ['Site Clearing', 'Trenching', 'Pipe Stringing', 'Welding / Jointing', 'Lowering & Laying', 'Bedding', 'Backfilling',
      'Valve Chamber', 'Thrust Block', 'Crossing (Road/Rail)', 'Hydro Test', 'Restoration', 'Survey Works', 'Testing & QA', 'Safety Works', 'Hindrance'],
    plant: ['Excavation', 'Foundation Works', 'Equipment Foundation', 'Structural Steel', 'Roofing / Cladding', 'Concrete Works',
      'Equipment Erection', 'Piping', 'Electrical', 'Instrumentation', 'Roads & Drains', 'Commissioning', 'Testing & QA', 'Safety Works', 'Hindrance']
  },
  side: {
    road: null,
    building: ['Inside', 'North', 'South', 'East', 'West', 'Facade', 'Roof'],
    bridge: ['LHS', 'RHS', 'Upstream', 'Downstream', 'Top', 'Underside'],
    canal: ['Left bank', 'Right bank', 'Canal bed', 'Both banks', 'Service road'],
    rail: ['Up line', 'Down line', 'Both lines', 'Station', 'Yard'],
    pipe: ['Along RoW', 'Left of RoW', 'Right of RoW', 'Crossing'],
    plant: ['Inside', 'Outside', 'Roof', 'Ground']
  }
};

function baseOptions(key) {
  const by = OPTIONS_BY_LAYOUT[key];
  if (by && typeof currentProject !== 'undefined' && currentProject) {
    const list = by[projectLayout(currentProject)];
    if (list) return list;
  }
  return DEFAULT_OPTIONS[key] || [];
}

// Where a photo sits across the width of a linear site: -1 top (LHS / left bank / up line), 1 bottom, 0 middle
function sideLane(side) {
  const s = String(side || '').toLowerCase();
  if (/^(lhs|left|up\b|up line|upstream)/.test(s)) return -1;
  if (/^(rhs|right|down\b|down line|downstream)/.test(s)) return 1;
  return 0;
}

// Saves a new "Others" value so it shows up as a normal choice from now on
async function addOption(key, value) {
  value = String(value || '').trim();
  if (!value) return null;
  const existing = getOptions(key).find(v => v.toLowerCase() === value.toLowerCase());
  if (existing) return existing;
  customOptions[key] = (customOptions[key] || []).concat(value);
  await DB.put('options', { key, values: customOptions[key], updatedAt: Date.now(), synced: false });
  if (typeof Sync !== 'undefined') Sync.schedule();
  return value;
}

// ============================================================
// INDEXEDDB
// ============================================================
const DB = (() => {
  let db = null;
  function init() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('CivilCamPro', 3);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        const tx = e.target.transaction;
        let s;
        if (!d.objectStoreNames.contains('photos')) {
          s = d.createObjectStore('photos', { keyPath: 'id' });
          ['date', 'month', 'year', 'quarter', 'activity'].forEach(i => s.createIndex(i, i, { unique: false }));
        } else {
          s = tx.objectStore('photos');
        }
        if (!s.indexNames.contains('projectId')) s.createIndex('projectId', 'projectId', { unique: false });
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('options')) d.createObjectStore('options', { keyPath: 'key' });
      };
      req.onsuccess = e => { db = e.target.result; res(); };
      req.onerror = rej;
    });
  }
  function put(store, value) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  function getAll(store) {
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  }
  function del(store, key) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  // Older code called DB.save(photo) / DB.getAll() / DB.del(id)
  return {
    init, put, getAll, del,
    save: p => put('photos', p),
    delPhoto: id => del('photos', id)
  };
})();

// ============================================================
// CHAINAGE  ("12+450"  <->  12450 metres)
// ============================================================
// bareKm: a plain number under 1000 means km (used for the project's start/end, where "25" means 25 km)
function parseCh(text, bareKm = false) {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim().toLowerCase();
  const saysKm = /km\s*$/.test(raw) || /^km/.test(raw);
  const s = raw.replace(/^(ch|km)\.?\s*/, '').replace(/\s*(km|m)$/, '');
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d+)\s*\+\s*(\d+(?:\.\d+)?)$/))) return Number(m[1]) * 1000 + Number(m[2]);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    // "12.45" or "12 km" reads as km; "12450" reads as metres
    if (saysKm || (s.includes('.') && n < 1000) || (bareKm && n < 1000)) return Math.round(n * 1000);
    return n;
  }
  return null;
}

function fmtCh(metres) {
  if (metres === null || metres === undefined || isNaN(metres)) return '';
  const km = Math.floor(metres / 1000);
  const m = Math.round(metres - km * 1000);
  return `${km}+${String(m).padStart(3, '0')}`;
}

// Tidies whatever the engineer typed into 12+450 form (keeps text it can't read)
function normCh(text, bareKm = false) {
  const m = parseCh(text, bareKm);
  return m === null ? String(text || '').trim() : fmtCh(m);
}

function chainageText(p, style) {
  if (!p.chFrom && !p.chTo) return '';
  if (p.chFrom && p.chTo && p.chTo !== p.chFrom) {
    return style === 'short' ? `${p.chFrom} – ${p.chTo}` : `From ${p.chFrom} To ${p.chTo}`;
  }
  return p.chFrom || p.chTo;
}

// Middle of the photo's chainage in metres (null when not a number)
function photoChMid(p) {
  const a = p.chFromM, b = p.chToM;
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return (a + b) / 2;
}

// ============================================================
// PHOTO RECORDS
// ============================================================
// Brings photos saved by older versions up to the current shape
function normPhoto(p) {
  if (p.chFrom === undefined) {
    p.chFrom = p.chainage ? normCh(p.chainage) : '';
    p.chTo = '';
  }
  if (p.chFromM === undefined) p.chFromM = parseCh(p.chFrom);
  if (p.chToM === undefined) p.chToM = parseCh(p.chTo);
  if (p.description === undefined) p.description = p.remarks || '';
  if (!p.photoType) p.photoType = 'General';
  if (!Array.isArray(p.fields)) p.fields = [];
  if (!p.engineer) p.engineer = { name: '', designation: '', email: '' };
  if (!p.updatedAt) p.updatedAt = new Date(p.timestamp || Date.now()).getTime();
  return p;
}

function projectPhotos(projectId = currentProject && currentProject.id) {
  return photos.filter(p => p.projectId === projectId);
}

function fieldsText(p, sep = '  |  ') {
  return (p.fields || []).filter(f => f.value).map(f => `${f.label}: ${f.value}`).join(sep);
}

// ============================================================
// SMALL HELPERS
// ============================================================
function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}
function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(d) {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil((((date - yearStart) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}
function localDateKey(d) {
  d = new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Time periods used by the gallery, chainage strip and export
const PERIODS = [
  ['all', 'All'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'],
  ['3months', 'Last 3 months'], ['quarter', 'This quarter'], ['year', 'This year']
];
function inPeriod(p, period) {
  if (!period || period === 'all') return true;
  const now = new Date();
  const d = new Date(p.timestamp);
  if (period === 'today') return localDateKey(d) === localDateKey(now);
  if (period === 'week') return getWeekNumber(d) === getWeekNumber(now);
  if (period === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (period === '3months') return (now - d) <= 92 * 86400000;
  if (period === 'quarter') return d.getFullYear() === now.getFullYear() && Math.floor(d.getMonth() / 3) === Math.floor(now.getMonth() / 3);
  if (period === 'year') return d.getFullYear() === now.getFullYear();
  return true;
}

// ============================================================
// ICONS (inline SVG, drawn with currentColor)
// ============================================================
const ICONS = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  strip: '<path d="M3 12h18"/><path d="M5 9v6M9 10v4M13 8v8M17 10v4M21 9v6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  minus: '<path d="M5 12h14"/>',
  building: '<path d="M5 21V4h10v17M15 9h4v12M3 21h18M8 8h2M8 12h2M8 16h2"/>',
  mail: '<path d="M3 6h18v12H3z"/><path d="M3 7l9 6 9-6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17v.5"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/>',
  flash: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  flip: '<path d="M4 10a8 8 0 0 1 14-4l2 2"/><path d="M20 4v4h-4"/><path d="M20 14a8 8 0 0 1-14 4l-2-2"/><path d="M4 20v-4h4"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  logout: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5"/><path d="M15 8l4 4-4 4M19 12H9"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5z"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>',
  compare: '<rect x="3" y="5" width="7.5" height="14" rx="1"/><rect x="13.5" y="5" width="7.5" height="14" rx="1"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8.2 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-1.9-.9-.8.8c-1-.4-2-1.4-2.4-2.4l.8-.8-.9-1.9z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  import: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6 6 0 0 1 3.5 6"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  cloudDown: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5"/><path d="M12 11v9M9 17l3 3 3-3"/>'
};

function ic(name, size = 20) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Replaces <i data-ic="name"></i> placeholders in static HTML with icons
function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-ic]').forEach(el => {
    el.outerHTML = ic(el.dataset.ic, Number(el.dataset.size) || 20);
  });
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
  return String(name).replace(/[^a-z0-9._+-]/gi, '_').replace(/_+/g, '_');
}

// data: a Blob or a data: URL string. Returns a content:// link on Android, true in a browser.
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

// Shares files through Android's share sheet. app: '' for the chooser, 'whatsapp' for WhatsApp.
async function shareFiles(files, text, app = '') {
  // files: [{ name, mime, data (Blob or data URL) }]
  if (hasAndroidBridge() && typeof window.AndroidBridge.shareFiles === 'function') {
    const payload = await Promise.all(files.map(async f => ({ name: safeFileName(f.name), mime: f.mime, data: await toBase64(f.data) })));
    if (app && typeof window.AndroidBridge.shareToApp === 'function') {
      window.AndroidBridge.shareToApp(JSON.stringify(payload), text || '', app);
    } else {
      window.AndroidBridge.shareFiles(JSON.stringify(payload), text || '');
    }
    return true;
  }
  try {
    const fileObjs = await Promise.all(files.map(async f => {
      const blob = typeof f.data === 'string' ? await (await fetch(f.data)).blob() : f.data;
      return new File([blob], safeFileName(f.name), { type: f.mime });
    }));
    if (navigator.share && navigator.canShare && navigator.canShare({ files: fileObjs })) {
      await navigator.share({ files: fileObjs, text: text || '' });
      return true;
    }
  } catch (e) { /* fall back to saving */ }
  if (app === 'whatsapp' && text) window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  for (const f of files) await saveFile(f.data, f.name, f.mime);
  return false;
}

// Opens the phone's file manager at Download/CivilCam ('reports') or Pictures/CivilCam ('photos')
function openSavedFolder(kind) {
  if (hasAndroidBridge() && typeof window.AndroidBridge.openFolder === 'function') {
    window.AndroidBridge.openFolder(kind);
  } else {
    showToast(kind === 'photos' ? 'Saved photos are in your Downloads folder' : 'Reports are in your Downloads folder');
  }
}

function savedMessage(result, what, mime) {
  if (!result) { showToast('Could not save ' + what, 'danger'); return; }
  if (hasAndroidBridge()) {
    const folder = mime && mime.startsWith('image/') ? 'Pictures/CivilCam' : 'Download/CivilCam';
    const canOpen = typeof result === 'string' && typeof window.AndroidBridge.openFile === 'function';
    showToast(what + ' saved to ' + folder, 'success',
      canOpen ? { label: 'OPEN', onClick: () => window.AndroidBridge.openFile(result, mime) } : null);
  } else {
    showToast(what + ' downloaded', 'success');
  }
}

function photoFileName(p) {
  const ch = p.chFrom ? '_Ch' + p.chFrom + (p.chTo && p.chTo !== p.chFrom ? '-' + p.chTo : '') : '';
  const d = new Date(p.timestamp);
  return safeFileName(`${p.projectName}_${p.activity}${ch}_${localDateKey(d)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.jpg`);
}
