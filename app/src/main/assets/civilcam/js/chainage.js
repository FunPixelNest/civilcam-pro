// ============================================================
// CHAINAGE STRIP — every photo placed on the project stretch
// ============================================================
const stripFilter = { period: 'all', activity: new Set(), side: new Set(), photoType: new Set(), element: new Set(), chFrom: null, chTo: null, smart: null };
let openGroupDef = null;        // which location's sheet is open: { title, from, to, lane } or { element }
let mapView = null;             // part of a linear site in view: { from, to, zoomed }
const GROUP_SIZES = [25, 50, 100, 200, 500];

function groupSizeOf(p) { return (p && p.groupSize) || 100; }

// Photos of this project grouped by nearby chainage (same 100 m band, etc.)
function buildGroups(list, project) {
  const size = groupSizeOf(project);
  const start = project.startM || 0;
  const groups = new Map();
  list.forEach(p => {
    const mid = photoChMid(p);
    if (mid == null) return;
    const idx = Math.floor((mid - start) / size);
    if (!groups.has(idx)) groups.set(idx, { idx, from: start + idx * size, to: start + (idx + 1) * size, photos: [] });
    groups.get(idx).photos.push(p);
  });
  return [...groups.values()].sort((a, b) => a.idx - b.idx);
}

function siteElements(p = currentProject) {
  return projectElements(p).concat((p.extraElements || []).filter(e => !projectElements(p).includes(e)));
}

function renderStripControls(linear) {
  document.getElementById('strip-period').innerHTML = PERIODS.map(([k, label]) =>
    `<button class="chip ${stripFilter.period === k ? 'active' : ''}" onclick="stripFilter.period='${k}';renderStrip()">${label}</button>`).join('');
  document.getElementById('strip-filters').innerHTML = filterButtonsHTML(stripFilter, 'stripFilter', 'renderStrip');
  const size = groupSizeOf(currentProject);
  const seg = document.getElementById('strip-group-size');
  seg.style.display = linear ? '' : 'none';
  seg.innerHTML = linear ? `<span class="seg-lbl">Group by</span>` + GROUP_SIZES.map(s =>
    `<button class="${s === size ? 'on' : ''}" onclick="setGroupSize(${s})">${s} m</button>`).join('') : '';
}

async function setGroupSize(s) {
  currentProject.groupSize = s;
  currentProject.updatedAt = Date.now(); currentProject.synced = false;
  await DB.put('projects', currentProject);
  Sync.schedule();
  renderStrip();
}

// Chainage range to draw: the project's, widened to take in any photo outside it
function siteRange(p, list) {
  const ms = list.map(photoChMid).filter(m => m != null);
  let lo = isLinearProject(p) ? p.startM : (ms.length ? Math.min(...ms) : 0);
  let hi = isLinearProject(p) ? p.endM : (ms.length ? Math.max(...ms) : 1000);
  if (ms.length) { lo = Math.min(lo, Math.min(...ms)); hi = Math.max(hi, Math.max(...ms)); }
  if (!isLinearProject(p)) { lo = Math.max(0, Math.floor((lo - 50) / 100) * 100); hi = Math.ceil((hi + 50) / 100) * 100; }
  if (hi - lo < 100) hi = lo + 100;
  return [lo, hi];
}

function renderStrip() {
  const p = currentProject;
  if (!p) return;
  const kind = projectLayout(p), L = LAYOUTS_SITE[kind];
  renderStripControls(L.linear);
  const list = projectPhotos().filter(x => matchesFilter(x, stripFilter));
  const box = document.getElementById('site-map');
  const legend = document.getElementById('map-legend');
  const onPick = key => openGroupKey(key);

  if (L.linear) {
    const [lo, hi] = siteRange(p, list);
    const groups = buildGroups(list, p);
    const noCh = list.filter(x => photoChMid(x) == null).length;
    document.getElementById('strip-title').textContent = isLinearProject(p) ? `${fmtCh(p.startM)} to ${fmtCh(p.endM)}` : `${L.name} · ${fmtCh(lo)} to ${fmtCh(hi)}`;
    const covered = groups.length * groupSizeOf(p);
    document.getElementById('strip-sub').textContent =
      `${list.length - noCh} photos at ${groups.length} location${groups.length === 1 ? '' : 's'} · ${Math.min(100, Math.round(covered / (hi - lo) * 100))}% of the stretch photographed`;
    SiteMap.mountStrip(box, {
      kind, projectId: p.id, lo, hi, photos: list.filter(x => photoChMid(x) != null), groupSize: groupSizeOf(p),
      onPick, onView: r => { mapView = r; renderGroupList(); }
    });
    mapView = SiteMap.visibleRange();
    const names = { road: ['LHS', 'RHS', 'Median / both sides'], canal: ['Left bank', 'Right bank', 'Bed / both banks'], rail: ['Up line', 'Down line', 'Both lines'], pipe: ['Left of RoW', 'Right of RoW', 'On the pipeline'] }[kind];
    legend.innerHTML = `<span><b class="lg-pin"></b>${names[0]} above, ${names[1]} below, ${names[2].toLowerCase()} in the middle</span><span><b class="lg-cov"></b>photographed</span><span><b class="lg-hind"></b>open hindrance</span>`;
  } else {
    const all = siteElements(p);
    const counts = {}, latest = {}, hindNames = new Set();
    list.forEach(x => {
      if (!x.element) return;
      counts[x.element] = (counts[x.element] || 0) + 1;
      if (!latest[x.element] || new Date(x.timestamp) > new Date(latest[x.element].timestamp)) latest[x.element] = x;
      if (x.photoType === 'Hindrance' && !(x.hind && x.hind.status === 'cleared')) hindNames.add(x.element);
    });
    const done = all.filter(e => counts[e]).length;
    const unit = { building: 'floor', bridge: 'location', plant: 'zone' }[kind];
    document.getElementById('strip-title').textContent = kind === 'building' ? `${p.name} · ${projectChText(p).split(' · ')[0]}` : kind === 'bridge' ? `${p.name} · ${projectChText(p)}` : p.name;
    document.getElementById('strip-sub').textContent = `${list.filter(x => x.element).length} photos · ${done} of ${all.length} ${unit}s photographed`;
    const opts = { names: all, counts, latest, hindNames, onPick };
    if (kind === 'building') {
      SiteMap.mountBuilding(box, opts);
      legend.innerHTML = `<span><b class="lg0"></b>no photos</span><span><b class="lg1"></b>few</span><span><b class="lg3"></b>many</span><span><b class="lg-hind"></b>open hindrance</span><span>Tap a floor to see its photos</span>`;
    } else if (kind === 'bridge') {
      const supports = all.filter(e => /^(A|P)\d+$/.test(e));
      const deckName = all.find(e => /^Deck/.test(e)) || null;
      SiteMap.mountStrip(box, { kind: 'bridge', projectId: p.id, lo: 0, hi: Math.max(1, supports.length - 1), names: supports, allNames: all, deckName, counts, latest, hindNames, onPick });
      legend.innerHTML = `<span><b class="lg-pin"></b>photos at each abutment and pier</span><span><b class="lg-hind"></b>open hindrance</span><span>Tap a pier or the deck</span>`;
    } else {
      SiteMap.mountZones(box, opts);
      legend.innerHTML = '';
    }
    mapView = null;
  }
  renderGroupList();
}

// The location cards under the map
function renderGroupList() {
  const p = currentProject;
  const kind = projectLayout(p), L = LAYOUTS_SITE[kind];
  const list = projectPhotos().filter(x => matchesFilter(x, stripFilter));
  const listEl = document.getElementById('group-list');
  if (!L.linear) {
    const all = siteElements(p);
    const withPhotos = all.map((e, i) => ({ element: e, i, photos: list.filter(x => x.element === e) })).filter(g => g.photos.length);
    const loose = list.filter(x => !x.element).length;
    listEl.innerHTML = withPhotos.length
      ? `<div class="list-head">${L.element.split(' / ')[0]}s with photos <span>${withPhotos.length}</span></div>` + withPhotos.map(g => groupCardHTML(g.element, g.photos, `openGroupKey('el:${g.i}')`)).join('')
      : `<div class="empty small"><div class="empty-title">No photos here yet</div><div class="empty-sub">In the camera, open the details card and pick the ${L.element.toLowerCase()} before taking the photo.</div></div>`;
    if (loose) listEl.innerHTML += `<div class="note">${loose} photo${loose === 1 ? ' has' : 's have'} no ${L.element.toLowerCase()}, so ${loose === 1 ? "it isn't" : "they aren't"} on the map. Open a photo in the gallery to see it.</div>`;
    return;
  }
  const groups = buildGroups(list, p);
  const v = mapView && mapView.zoomed ? mapView : null;
  const shown = v ? groups.filter(g => g.to > v.from && g.from < v.to) : groups;
  const noCh = list.filter(x => photoChMid(x) == null).length;
  if (!shown.length) {
    listEl.innerHTML = `<div class="empty small"><div class="empty-title">No photos ${v ? 'in this part of the map' : 'here yet'}</div><div class="empty-sub">${v ? 'Drag the map or zoom out to see other locations.' : 'Photos with a chainage show up on the map.'}</div></div>`;
  } else {
    listEl.innerHTML = `<div class="list-head">${v ? `In view · Ch ${fmtCh(v.from)} – ${fmtCh(v.to)}` : 'Locations'} <span>${shown.length}</span></div>` +
      shown.map(g => groupCardHTML(`Ch ${fmtCh(g.from)} – ${fmtCh(g.to)}`, g.photos, `openGroupKey('band:${g.from}:${g.to}')`)).join('');
  }
  if (noCh) listEl.innerHTML += `<div class="note">${noCh} photo${noCh === 1 ? ' has' : 's have'} no chainage, so ${noCh === 1 ? "it isn't" : "they aren't"} on the map.</div>`;
}

function groupCardHTML(title, photosHere, onclick) {
  const dates = [...new Set(photosHere.map(p => p.date))].sort();
  const acts = [...new Set(photosHere.map(p => p.activity))];
  // newest photo of each visit, newest first
  const perDate = dates.slice().reverse().map(d => photosHere.filter(p => p.date === d)[0]).slice(0, 4);
  return `<button class="group-card" onclick="${onclick}">
    <div class="gc-top">
      <div><div class="gc-ch">${esc(title)}</div>
      <div class="gc-meta">${photosHere.length} photo${photosHere.length === 1 ? '' : 's'} · ${dates.length} visit${dates.length === 1 ? '' : 's'} · ${fmtDate(dates[0])}${dates.length > 1 ? ' → ' + fmtDate(dates[dates.length - 1]) : ''}</div></div>
      ${ic('chevronRight', 18)}
    </div>
    <div class="gc-thumbs">${perDate.map(p => `<div class="gc-thumb"><img src="${p.imageData || ''}" alt=""><span>${new Date(p.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span></div>`).join('')}</div>
    <div class="gc-acts">${acts.slice(0, 3).map(a => `<span>${esc(a)}</span>`).join('')}${acts.length > 3 ? `<span>+${acts.length - 3}</span>` : ''}</div>
  </button>`;
}

// ============================================================
// ONE LOCATION, DATE-WISE
// ============================================================
let compareMode = false, comparePick = [];

// key: 'band:<from>:<to>' (a chainage band), 'range:<from>:<to>:<lane>' (a map marker), 'el:<index>' (floor / pier / zone)
function groupDefFromKey(key) {
  const [k, a, b, lane] = key.split(':');
  if (k === 'el') { const name = siteElements()[+a]; return name ? { element: name, title: name } : null; }
  const from = +a, to = +b;
  const laneName = lane == null ? '' : { '-1': 'LHS', '0': 'Median / both', '1': 'RHS' }[lane];
  const names = { canal: ['Left bank', 'Bed / both', 'Right bank'], rail: ['Up line', 'Both lines', 'Down line'], pipe: ['Left of RoW', 'On the line', 'Right of RoW'] }[projectLayout(currentProject)];
  const ln = lane == null ? '' : names ? names[+lane + 1] : laneName;
  return {
    from, to, lane: lane == null ? null : +lane, inclusive: k === 'range',
    title: (from === to || to - from < 1 ? `Ch ${fmtCh(from)}` : `Ch ${fmtCh(from)} – ${fmtCh(to)}`) + (ln ? ' · ' + ln : '')
  };
}

function currentGroup() {
  const d = openGroupDef;
  if (!d) return null;
  const list = projectPhotos().filter(x => matchesFilter(x, Object.assign({}, stripFilter, { period: 'all' })));
  const ph = d.element != null
    ? list.filter(p => p.element === d.element)
    : list.filter(p => {
      const m = photoChMid(p);
      if (m == null) return false;
      if (d.inclusive ? (m < d.from - 0.01 || m > d.to + 0.01) : (m < d.from || m >= d.to)) return false;
      return d.lane == null || sideLane(p.side) === d.lane;
    });
  return ph.length ? Object.assign({ photos: ph }, d) : null;
}

function openGroupKey(key) {
  const def = groupDefFromKey(key);
  if (!def) return;
  openGroupDef = def;
  if (!currentGroup()) { showToast('No photos here yet'); return; }
  compareMode = false; comparePick = [];
  document.getElementById('group-ai-box').style.display = 'none';
  document.getElementById('group-ai-btn').style.display = AI.available() ? '' : 'none';
  renderGroup();
  openSheet('group-sheet');
}

function renderGroup() {
  const g = currentGroup();
  if (!g) { closeSheet('group-sheet'); return; }
  const dates = [...new Set(g.photos.map(p => p.date))].sort().reverse();
  document.getElementById('group-title').textContent = g.title;
  document.getElementById('group-sub').textContent = `${g.photos.length} photos on ${dates.length} date${dates.length === 1 ? '' : 's'} · all periods`;
  document.getElementById('group-compare-btn').classList.toggle('active', compareMode);
  document.getElementById('group-compare-btn').innerHTML = ic('compare', 16) + (compareMode ? 'Pick 2 photos…' : 'Compare two dates');

  document.getElementById('group-timeline').innerHTML = dates.map((d, i) => {
    const day = g.photos.filter(p => p.date === d);
    const prev = dates[i + 1];
    const gap = prev ? Math.round((new Date(d) - new Date(prev)) / 86400000) : null;
    return `<div class="tl-day">
      <div class="tl-dot"></div>
      <div class="tl-head"><b>${fmtDate(d)}</b><span>${day.length} photo${day.length === 1 ? '' : 's'}${gap ? ` · ${gap} day${gap === 1 ? '' : 's'} after previous visit` : ''}</span></div>
      <div class="tl-photos">${day.map(p => `
        <button class="tl-photo${comparePick.includes(p.id) ? ' picked' : ''}" onclick="onGroupPhoto('${p.id}')">
          <img src="${p.imageData || ''}" alt="">
          <span>${esc([placeText(p), p.side, p.activity].filter(Boolean).join(' · '))}</span>
        </button>`).join('')}</div>
    </div>`;
  }).join('');
  renderCompare();
}

function onGroupPhoto(id) {
  if (!compareMode) { openPhotoModal(id); return; }
  if (comparePick.includes(id)) comparePick = comparePick.filter(x => x !== id);
  else comparePick = comparePick.concat(id).slice(-2);
  renderGroup();
}

function toggleCompare() {
  compareMode = !compareMode;
  comparePick = [];
  renderGroup();
}

function renderCompare() {
  const box = document.getElementById('compare-view');
  if (!compareMode || comparePick.length < 2) { box.style.display = 'none'; return; }
  const [a, b] = comparePick.map(id => photos.find(p => p.id === id)).sort((x, y) => new Date(x.timestamp) - new Date(y.timestamp));
  const days = Math.round((new Date(b.timestamp) - new Date(a.timestamp)) / 86400000);
  box.style.display = '';
  box.innerHTML = `<div class="cmp-grid">
    <figure><img src="${a.imageData}" alt=""><figcaption><b>Before</b> ${a.displayDate}</figcaption></figure>
    <figure><img src="${b.imageData}" alt=""><figcaption><b>After</b> ${b.displayDate}</figcaption></figure>
  </div><div class="cmp-note">${days} day${days === 1 ? '' : 's'} apart</div>`;
}

async function summariseGroup() {
  const g = currentGroup();
  if (!g) return;
  const dates = [...new Set(g.photos.map(p => p.date))].sort();
  const pick = dates.map(d => g.photos.filter(p => p.date === d)[0]).slice(-6);
  const box = document.getElementById('group-ai-box');
  try {
    showLoading('Reading the photos…', `${pick.length} visits at ${g.title}`);
    const images = [];
    for (const p of pick) images.push({ date: p.displayDate, activity: p.activity, description: p.description, image: await downscaleDataUrl(p.imageData, 640) });
    const r = await AI.call('progress', { chainage: g.title, project: currentProject.fullName, visits: images });
    box.style.display = '';
    box.innerHTML = `<div class="ai-box-head">${ic('sparkles', 16)}Progress summary <em>AI draft — check before using</em></div><div class="ai-box-text">${esc(r.text)}</div>`;
  } catch (e) {
    showToast('Could not reach the AI service', 'danger');
  } finally { hideLoading(); }
}

function exportGroup() {
  const g = currentGroup();
  if (!g) return;
  exportState.source = { kind: 'ids', ids: g.photos.map(p => p.id), label: g.title };
  exportState.layout = 'E';
  closeSheet('group-sheet');
  switchTab('export');
}
