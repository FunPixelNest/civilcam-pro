// ============================================================
// CHAINAGE STRIP — every photo placed on the project stretch
// ============================================================
const stripFilter = { period: 'all', activity: new Set(), side: new Set(), photoType: new Set(), chFrom: null, chTo: null, smart: null };
let stripFocus = null;          // [fromM, toM] when a part of the strip is tapped
let openGroupKey = null;
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

function renderStripControls() {
  document.getElementById('strip-period').innerHTML = PERIODS.map(([k, label]) =>
    `<button class="chip ${stripFilter.period === k ? 'active' : ''}" onclick="stripFilter.period='${k}';renderStrip()">${label}</button>`).join('');
  document.getElementById('strip-filters').innerHTML = filterButtonsHTML(stripFilter, 'stripFilter', 'renderStrip') +
    (stripFocus ? `<button class="chip clear" onclick="stripFocus=null;renderStrip()">${ic('x', 13)}Whole stretch</button>` : '');
  const size = groupSizeOf(currentProject);
  document.getElementById('strip-group-size').innerHTML = GROUP_SIZES.map(s =>
    `<button class="${s === size ? 'on' : ''}" onclick="setGroupSize(${s})">${s} m</button>`).join('');
}

async function setGroupSize(s) {
  currentProject.groupSize = s;
  currentProject.updatedAt = Date.now(); currentProject.synced = false;
  await DB.put('projects', currentProject);
  Sync.schedule();
  renderStrip();
}

function renderStrip() {
  const p = currentProject;
  if (!isLinearProject(p)) return;
  renderStripControls();
  const list = projectPhotos().filter(x => matchesFilter(x, stripFilter));
  const groups = buildGroups(list, p);
  const noCh = list.filter(x => photoChMid(x) == null).length;
  const L = p.endM - p.startM;

  document.getElementById('strip-title').textContent = `${fmtCh(p.startM)} to ${fmtCh(p.endM)}`;
  const covered = groups.length * groupSizeOf(p);
  document.getElementById('strip-sub').textContent =
    `${list.length - noCh} photos in ${groups.length} location${groups.length === 1 ? '' : 's'} · ${Math.min(100, Math.round(covered / L * 100))}% of stretch photographed`;

  // The strip shows at most ~90 cells; each cell may cover several groups
  const cells = Math.min(90, Math.ceil(L / groupSizeOf(p)));
  const cellLen = L / cells;
  const counts = new Array(cells).fill(0);
  list.forEach(x => {
    const mid = photoChMid(x);
    if (mid == null || mid < p.startM || mid > p.endM) return;
    counts[Math.min(cells - 1, Math.floor((mid - p.startM) / cellLen))]++;
  });
  const max = Math.max(1, ...counts);
  document.getElementById('strip').innerHTML = counts.map((c, i) => {
    const a = p.startM + i * cellLen, b = a + cellLen;
    const lvl = c === 0 ? 0 : c / max > 0.66 ? 3 : c / max > 0.33 ? 2 : 1;
    const focused = stripFocus && a >= stripFocus[0] - 1 && b <= stripFocus[1] + 1;
    return `<button class="cell l${lvl}${focused ? ' focus' : ''}" title="${fmtCh(a)} – ${fmtCh(b)}: ${c}" aria-label="${fmtCh(a)} to ${fmtCh(b)}, ${c} photos" onclick="focusStrip(${a},${b})"></button>`;
  }).join('');
  const ticks = 5;
  document.getElementById('strip-axis').innerHTML = Array.from({ length: ticks + 1 }, (_, i) => `<span>${fmtCh(p.startM + L * i / ticks)}</span>`).join('');

  // Group cards
  const shown = stripFocus ? groups.filter(g => g.to > stripFocus[0] && g.from < stripFocus[1]) : groups;
  const listEl = document.getElementById('group-list');
  if (!shown.length) {
    listEl.innerHTML = `<div class="empty small"><div class="empty-title">No photos here yet</div><div class="empty-sub">${stripFocus ? 'Nothing in this part of the stretch for the chosen period.' : 'Photos with a chainage show up on the strip.'}</div></div>`;
  } else {
    listEl.innerHTML = `<div class="list-head">${stripFocus ? `Ch ${fmtCh(stripFocus[0])} – ${fmtCh(stripFocus[1])}` : 'Locations'} <span>${shown.length}</span></div>` +
      shown.map(groupCardHTML).join('');
  }
  if (noCh) listEl.innerHTML += `<div class="note">${noCh} photo${noCh === 1 ? ' has' : 's have'} no chainage, so ${noCh === 1 ? "it isn't" : "they aren't"} on the strip.</div>`;
}

function focusStrip(a, b) {
  stripFocus = [a, b];
  renderStrip();
  document.getElementById('group-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function groupCardHTML(g) {
  const dates = [...new Set(g.photos.map(p => p.date))].sort();
  const acts = [...new Set(g.photos.map(p => p.activity))];
  // newest photo of each visit, newest first
  const perDate = dates.slice().reverse().map(d => g.photos.filter(p => p.date === d)[0]).slice(0, 4);
  return `<button class="group-card" onclick="openGroup(${g.idx})">
    <div class="gc-top">
      <div><div class="gc-ch">Ch ${fmtCh(g.from)} – ${fmtCh(g.to)}</div>
      <div class="gc-meta">${g.photos.length} photo${g.photos.length === 1 ? '' : 's'} · ${dates.length} visit${dates.length === 1 ? '' : 's'} · ${fmtDate(dates[0])}${dates.length > 1 ? ' → ' + fmtDate(dates[dates.length - 1]) : ''}</div></div>
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

function currentGroup() {
  const list = projectPhotos().filter(x => matchesFilter(x, Object.assign({}, stripFilter, { period: 'all' })));
  return buildGroups(list, currentProject).find(g => g.idx === openGroupKey);
}

function openGroup(idx) {
  openGroupKey = idx;
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
  document.getElementById('group-title').textContent = `Ch ${fmtCh(g.from)} – ${fmtCh(g.to)}`;
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
          <span>${esc([chainageText(p, 'short'), p.side, p.activity].filter(Boolean).join(' · '))}</span>
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
    showLoading('Reading the photos…', `${pick.length} visits at Ch ${fmtCh(g.from)}`);
    const images = [];
    for (const p of pick) images.push({ date: p.displayDate, activity: p.activity, description: p.description, image: await downscaleDataUrl(p.imageData, 640) });
    const r = await AI.call('progress', { chainage: `${fmtCh(g.from)} – ${fmtCh(g.to)}`, project: currentProject.fullName, visits: images });
    box.style.display = '';
    box.innerHTML = `<div class="ai-box-head">${ic('sparkles', 16)}Progress summary <em>AI draft — check before using</em></div><div class="ai-box-text">${esc(r.text)}</div>`;
  } catch (e) {
    showToast('Could not reach the AI service', 'danger');
  } finally { hideLoading(); }
}

function exportGroup() {
  const g = currentGroup();
  if (!g) return;
  exportState.source = { kind: 'ids', ids: g.photos.map(p => p.id), label: `Ch ${fmtCh(g.from)} – ${fmtCh(g.to)}` };
  exportState.layout = 'E';
  closeSheet('group-sheet');
  switchTab('export');
}
