// ============================================================
// REPORT BUILDING BLOCKS shared by PDF, Word, Excel and PowerPoint
// ============================================================
const LAYOUTS = {
  A: { name: '1 per page', desc: 'One large photo', perPage: 1, cols: 1, slide: 1 },
  B: { name: '2 per page', desc: 'Two photos, one above the other', perPage: 2, cols: 1, slide: 2 },
  C: { name: '4 per page', desc: '2 × 2 grid', perPage: 4, cols: 2, slide: 4 },
  D: { name: '6 per page', desc: '2 × 3 grid, compact', perPage: 6, cols: 2, slide: 6 },
  E: { name: 'Same chainage, date-wise', desc: 'Each location over time, oldest first', perPage: 4, cols: 2, slide: 4 }
};

// Which extra details to print under each photo (Activity, Chainage and Side are always shown)
const CAPTION_OPTIONS = [
  ['date', 'Date and time', true],
  ['description', 'Description and hindrance details', true],
  ['engineer', 'Engineer name', false],
  ['gps', 'GPS position', false]
];

// One caption = lines; one line = [label, value] pairs printed "Label: value | Label: value"
function captionLines(p, opts, inGroup = false) {
  const lines = [];
  if (!inGroup) {
    lines.push([['Activity', p.activity], ['Chainage', chainageText(p)], ['Side', p.side]].filter(x => x[1]));
  }
  const second = [];
  if (opts.date || inGroup) second.push(['Date', `${p.displayDate}, ${p.displayTime}`]);
  if (opts.engineer && p.engineer && p.engineer.name) second.push(['Engineer', [p.engineer.name, p.engineer.designation].filter(Boolean).join(', ')]);
  if (opts.gps && p.location) second.push(['GPS', `${p.location.lat}, ${p.location.lng}`]);
  if (second.length) lines.push(second);
  if (opts.description) {
    const f = (p.fields || []).filter(x => x.value).map(x => [x.label, x.value]);
    if (f.length) lines.push(f);
    if (p.description) lines.push([[inGroup ? 'Remarks' : 'Description', p.description]]);
  }
  return lines;
}

// The Excel "Description" cell: everything in one readable sentence
function captionSentence(p, opts) {
  let s = `${p.activity}`;
  if (chainageText(p)) s += p.chTo && p.chTo !== p.chFrom ? ` at Chainage ${p.chFrom} to ${p.chTo}` : ` at Chainage ${p.chFrom}`;
  if (p.side) s += `, ${p.side}`;
  s += `, taken on ${p.displayDate} at ${p.displayTime}`;
  if (p.engineer && p.engineer.name) s += ` by ${[p.engineer.name, p.engineer.designation].filter(Boolean).join(', ')}`;
  s += '.';
  if (opts.gps && p.location) s += ` GPS ${p.location.lat}, ${p.location.lng}.`;
  const f = (p.fields || []).filter(x => x.value);
  if (f.length) s += ' ' + f.map(x => `${x.label}: ${x.value}`).join('; ') + '.';
  if (p.description) s += ` Remarks: ${p.description.replace(/\s*\.?\s*$/, '')}.`;
  return s;
}

// Groups the chosen photos into pages for a layout
function paginate(list, layoutKey, project) {
  const L = LAYOUTS[layoutKey];
  const pages = [];
  if (layoutKey !== 'E') {
    const sorted = list.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    for (let i = 0; i < sorted.length; i += L.perPage) pages.push({ items: sorted.slice(i, i + L.perPage) });
    return pages;
  }
  // Layout E: one location at a time, oldest photo first
  const groups = buildGroups(list, Object.assign({ startM: 0, groupSize: 100 }, project || {}));
  const loose = list.filter(p => photoChMid(p) == null);
  if (loose.length) groups.push({ from: null, to: null, photos: loose });
  groups.forEach(g => {
    const sorted = g.photos.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const acts = [...new Set(sorted.map(p => p.activity))];
    const sides = [...new Set(sorted.map(p => p.side).filter(Boolean))];
    const header = [
      ['Activity', acts.join(', ')],
      ['Chainage', g.from == null ? 'Not recorded' : `From ${fmtCh(g.from)} To ${fmtCh(g.to)}`],
      ['Side', sides.join(', ')]
    ].filter(x => x[1]);
    const dates = new Set(sorted.map(p => p.date)).size;
    for (let i = 0; i < sorted.length; i += L.perPage) {
      pages.push({
        items: sorted.slice(i, i + L.perPage),
        group: { header, note: `Same location photographed on ${dates} date${dates === 1 ? '' : 's'}, oldest first${i ? ' (continued)' : ''}` }
      });
    }
  });
  return pages;
}

// Loads each photo once, shrunk for documents. Returns Map(photoId -> {data, w, h})
async function loadReportImages(list, maxPx, onProgress) {
  const out = new Map();
  let n = 0;
  for (const p of list) {
    out.set(p.id, await shrinkImage(p.imageData, maxPx));
    if (onProgress) onProgress(++n, list.length);
  }
  return out;
}

function shrinkImage(dataUrl, max) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * k), h = Math.round(img.height * k);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      res({ data: c.toDataURL('image/jpeg', 0.82), w, h });
    };
    img.onerror = () => res(null);
    img.src = dataUrl;
  });
}

// Fits an image inside a box without cropping (the stamp stays visible)
function fitBox(imgW, imgH, boxW, boxH) {
  const k = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * k, h = imgH * k;
  return { w, h, dx: (boxW - w) / 2, dy: (boxH - h) / 2 };
}

function dataUrlToBytes(dataUrl) {
  const b = atob(dataUrl.split(',')[1]);
  const arr = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
  return arr;
}

// Report colours (kept sober for client submissions)
const RC = { ink: '14213D', navy: '1F3A5F', muted: '5B6778', line: 'C9D1DC', soft: 'F3F6F9', badge: '14213D' };
