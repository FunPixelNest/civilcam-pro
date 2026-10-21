// ============================================================
// SITE MAP — a drawing of the site with the photos placed on it
//   road / canal / rail / pipeline : drawn along the chainage; drag
//     to move, pinch (or + / −) to zoom. Zoomed in, the photos
//     appear as thumbnails at their chainage, LHS above, RHS below.
//   bridge   : abutments and piers, same drag and pinch
//   building : the building floor by floor
//   plant    : zones as tiles
// Tapping a photo marker, a pier, a floor or a zone opens that
// location's photos date-wise (chainage.js).
// ============================================================
const SiteMap = (() => {
  const H = 250, PAD = 28;
  const ROAD_TOP = 76, ROAD_BOT = 150, AXIS_Y = 226;
  const BUCKET = 38;                  // px: markers closer than this merge
  const thumbs = new Map();           // photo id -> small data URL
  let st = null;                      // the map on screen
  let raf = 0, listTimer = 0;

  // ---------- small helpers ----------
  const svgEsc = s => esc(String(s == null ? '' : s));
  function niceStep(minPx, scale) {
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    return steps.find(s => s * scale >= minPx) || steps[steps.length - 1];
  }
  function thumbOf(p) {
    if (thumbs.has(p.id)) return thumbs.get(p.id);
    thumbs.set(p.id, p.thumb || '');                     // placeholder while it is made
    if (!p.thumb && p.imageData) {
      shrinkImage(p.imageData, 160).then(r => {
        if (!r) return;
        thumbs.set(p.id, r.data);
        if (st && st.view) document.querySelectorAll(`#site-map image[data-id="${p.id}"]`).forEach(im => im.setAttribute('href', r.data));
      });
    }
    return thumbs.get(p.id);
  }
  const openHind = p => p.photoType === 'Hindrance' && !(p.hind && p.hind.status === 'cleared');

  // ---------- linear sites and bridges: one zoomable strip ----------
  function mountStrip(el, opts) {
    const prev = st && st.kind === opts.kind && st.projectId === opts.projectId && st.lo === opts.lo && st.hi === opts.hi ? st : null;
    st = Object.assign({ scale: 0, fit: 0 }, opts);
    el.innerHTML = `
      <div class="map-view" id="map-view"><svg id="map-svg" height="${H}" xmlns="http://www.w3.org/2000/svg"></svg></div>
      <div class="map-foot">
        <div class="mf-left"><span id="map-range"></span><span class="map-scalebar" id="map-scalebar"></span></div>
        <div class="map-tools">
          <button class="map-btn" onclick="SiteMap.zoomBy(0.5)" aria-label="Zoom out">${ic('minus', 18)}</button>
          <button class="map-btn" onclick="SiteMap.zoomBy(2)" aria-label="Zoom in">${ic('plus', 18)}</button>
          <button class="map-btn wide" onclick="SiteMap.fit()" aria-label="Show the whole stretch">Fit</button>
        </div>
      </div>`;
    st.view = document.getElementById('map-view');
    st.svg = document.getElementById('map-svg');
    const vw = Math.max(240, st.view.clientWidth || el.clientWidth || 360);
    st.fit = (vw - PAD * 2) / (st.hi - st.lo);
    st.maxScale = Math.max(st.fit * 1.5, st.kind === 'bridge' ? 420 : Math.min(3, 150000 / (st.hi - st.lo)));
    st.scale = prev ? Math.min(Math.max(prev.scale, st.fit), st.maxScale) : st.fit;
    drawBase();
    if (prev) st.view.scrollLeft = prev.view ? prev.scrollLeft || 0 : 0;
    drawDynamic();
    attach();
  }

  const worldAt = clientX => {
    const r = st.view.getBoundingClientRect();
    return st.lo + (st.view.scrollLeft + clientX - r.left - PAD) / st.scale;
  };

  function setScale(s, clientX, anchor) {
    if (!st || !st.view) return;
    s = Math.max(st.fit, Math.min(st.maxScale, s));
    if (Math.abs(s - st.scale) / st.scale < 0.002) return;
    const r = st.view.getBoundingClientRect();
    if (clientX == null) clientX = r.left + r.width / 2;
    if (anchor == null) anchor = worldAt(clientX);
    st.scale = s;
    drawBase();
    st.view.scrollLeft = PAD + (anchor - st.lo) * s - (clientX - r.left);
    schedule();
  }

  function attach() {
    const v = st.view;
    // Pinch: stretch the drawing live (cheap and smooth), redraw it sharp when the fingers lift.
    // The drawing is not replaced during the gesture, so the browser keeps sending the touches.
    let pinch = null;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = t => (t[0].clientX + t[1].clientX) / 2;
    const endPinch = () => {
      if (!pinch) return;
      const p = pinch; pinch = null;
      st.svg.style.transform = ''; st.svg.style.transformOrigin = '';
      setScale(p.s0 * p.k, p.mid, p.anchor);
    };
    v.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const m = mid(e.touches);
        pinch = { d0: dist(e.touches), s0: st.scale, anchor: worldAt(m), m0: m, mid: m, k: 1 };
        e.preventDefault();
      }
    }, { passive: false });
    v.addEventListener('touchmove', e => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const s = Math.max(st.fit, Math.min(st.maxScale, pinch.s0 * dist(e.touches) / pinch.d0));
      pinch.k = s / pinch.s0;
      pinch.mid = mid(e.touches);
      const ax = PAD + (pinch.anchor - st.lo) * pinch.s0;          // anchor in drawing pixels
      st.svg.style.transformOrigin = `${ax}px 0`;
      st.svg.style.transform = `translateX(${pinch.mid - pinch.m0}px) scaleX(${pinch.k})`;
    }, { passive: false });
    v.addEventListener('touchend', e => { if (e.touches.length < 2) endPinch(); });
    v.addEventListener('touchcancel', endPinch);
    // Trackpad pinch and Ctrl + wheel on a PC
    v.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale(st.scale * Math.exp(-e.deltaY / 200), e.clientX);
    }, { passive: false });
    v.addEventListener('dblclick', e => { if (!e.target.closest('[data-pick]')) setScale(st.scale * 2, e.clientX); });
    // Drag with the mouse on a PC (fingers scroll by themselves)
    let drag = null;
    v.addEventListener('mousedown', e => { drag = { x: e.clientX, s: v.scrollLeft, moved: false }; });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) > 3) drag.moved = true;
      v.scrollLeft = drag.s - (e.clientX - drag.x);
    });
    window.addEventListener('mouseup', () => { setTimeout(() => { drag = null; }, 0); });
    v.addEventListener('click', e => {
      if (drag && drag.moved) return;
      const t = e.target.closest('[data-pick]');
      if (t) pick(t.getAttribute('data-pick'));
    });
    v.addEventListener('scroll', schedule, { passive: true });
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (st && st.view) { st.scrollLeft = st.view.scrollLeft; drawDynamic(); } });
    clearTimeout(listTimer);
    listTimer = setTimeout(() => { if (st && st.onView) st.onView(visibleRange()); }, 250);
  }

  function visibleRange() {
    if (!st || !st.view) return null;
    const a = st.lo + (st.view.scrollLeft - PAD) / st.scale;
    const b = a + st.view.clientWidth / st.scale;
    const zoomed = st.scale > st.fit * 1.05;
    return { from: Math.max(st.lo, a), to: Math.min(st.hi, b), zoomed };
  }

  const X = m => PAD + (m - st.lo) * st.scale;

  // The road / canal / track / pipe itself (long shapes and patterns, drawn once per zoom)
  function drawBase() {
    const W = Math.ceil((st.hi - st.lo) * st.scale + PAD * 2);
    st.W = W;
    st.svg.setAttribute('width', W);
    st.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const x0 = PAD, w = W - PAD * 2;
    const defs = `<defs>
      <pattern id="pDash" width="26" height="2" patternUnits="userSpaceOnUse"><rect width="13" height="2" fill="#e5e7eb"/></pattern>
      <pattern id="pSleeper" width="7" height="22" patternUnits="userSpaceOnUse"><rect x="1" width="3" height="22" fill="#8b6b4a"/></pattern>
      <pattern id="pBallast" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#57534e"/><circle cx="2" cy="2" r="1" fill="#78716c"/><circle cx="5" cy="4.5" r=".9" fill="#44403c"/></pattern>
      <pattern id="pWave" width="22" height="8" patternUnits="userSpaceOnUse"><path d="M0 4 Q5.5 0 11 4 T22 4" stroke="#7dd3fc" stroke-opacity=".35" fill="none" stroke-width="1.2"/></pattern>
      <pattern id="pJoint" width="40" height="12" patternUnits="userSpaceOnUse"><rect x="0" width="2.5" height="12" fill="#1e3a5f"/></pattern>
      <pattern id="pSoil" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#4a3b2a"/><circle cx="2" cy="3" r=".8" fill="#5c4a35"/><circle cx="6" cy="6" r=".7" fill="#3b2f22"/></pattern>
      <linearGradient id="gWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e5f8a"/><stop offset="1" stop-color="#0f3d5e"/></linearGradient>
    </defs>`;
    let g = '';
    const band = (y, h, fill, extra = '') => `<rect x="${x0}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
    const line = (y, stroke, sw = 1.5, extra = '') => `<rect x="${x0}" y="${y - sw / 2}" width="${w}" height="${sw}" fill="${stroke}" ${extra}/>`;
    if (st.kind === 'road') {
      // verge | shoulder | 2-lane carriageway | median | 2-lane carriageway | shoulder | verge
      g += band(76, 4, '#2f4a2f') + band(80, 6, '#5b616b') + band(86, 23, '#363b44') + band(109, 10, '#3f6b3a') + band(119, 23, '#363b44') + band(142, 4, '#5b616b') + band(146, 4, '#2f4a2f');
      g += line(86.8, '#f8fafc', 1.4) + line(108.2, '#facc15', 1.4) + line(119.8, '#facc15', 1.4) + line(141.2, '#f8fafc', 1.4);
      g += band(96.5, 2, 'url(#pDash)') + band(129.5, 2, 'url(#pDash)');
      g += line(109.6, '#cbd5e1', 1) + line(118.4, '#cbd5e1', 1);
    } else if (st.kind === 'canal') {
      g += band(76, 14, '#6b5435') + band(80, 5, '#8a8f98') + band(90, 9, '#7c6a4f') + band(99, 34, 'url(#gWater)') + band(99, 34, 'url(#pWave)') + band(133, 9, '#7c6a4f') + band(142, 10, '#6b5435');
      g += line(99, '#cbd5e1', 1) + line(133, '#cbd5e1', 1);
    } else if (st.kind === 'rail') {
      g += band(78, 72, 'url(#pBallast)');
      [86, 120].forEach(y => { g += band(y, 22, 'url(#pSleeper)') + line(y + 6, '#d1d5db', 2) + line(y + 16, '#d1d5db', 2); });
      g += line(78, '#78716c', 1) + line(150, '#78716c', 1);
    } else if (st.kind === 'pipe') {
      g += band(80, 66, '#5c4a35') + band(98, 30, 'url(#pSoil)') + band(107, 12, '#3b82c4') + band(107, 12, 'url(#pJoint)') + line(108, '#93c5fd', 1.2, 'opacity=".6"');
      g += line(80, '#a8a29e', 1, 'stroke-dasharray="4 4"') + line(146, '#a8a29e', 1, 'stroke-dasharray="4 4"');
    } else if (st.kind === 'bridge') {
      g += `<rect x="0" y="152" width="${W}" height="${H - 152}" fill="url(#pSoil)"/>` +
           `<rect x="0" y="128" width="${W}" height="24" fill="url(#gWater)"/><rect x="0" y="128" width="${W}" height="24" fill="url(#pWave)"/>`;
      g += band(70, 4, '#9ca3af') + band(74, 12, '#6b7280') + band(86, 7, '#4b5563');      // parapet, deck, girders
    }
    st.svg.innerHTML = defs + `<g id="m-base">${g}</g><g id="m-dyn"></g>`;
    const span = st.view.clientWidth / st.scale;
    const bar = niceStep(60, st.scale);
    const sb = document.getElementById('map-scalebar');
    if (sb) sb.innerHTML = st.kind === 'bridge' ? '' : `<i style="width:${Math.round(bar * st.scale)}px"></i>${bar >= 1000 ? bar / 1000 + ' km' : bar + ' m'}`;
    st.spanM = span;
  }

  // Ticks, markers and thumbnails — only what is on screen, redrawn as you move
  function drawDynamic() {
    if (!st || !st.svg) return;
    const vw = st.view.clientWidth, sl = st.view.scrollLeft;
    const fromPx = sl - vw, toPx = sl + vw * 2;
    const fromM = st.lo + (fromPx - PAD) / st.scale, toM = st.lo + (toPx - PAD) / st.scale;
    let out = '';
    if (st.kind === 'bridge') out = drawBridgeDyn(fromM, toM);
    else out = drawTicks(fromM, toM) + drawCoverage(fromM, toM) + drawMarkers(fromM, toM);
    document.getElementById('m-dyn').innerHTML = out;
    const r = visibleRange();
    const lbl = document.getElementById('map-range');
    if (lbl && r) lbl.textContent = st.kind === 'bridge'
      ? (r.zoomed ? `Viewing ${st.names[Math.max(0, Math.round(r.from))] || ''} – ${st.names[Math.min(st.names.length - 1, Math.round(r.to))] || ''}` : 'Pinch or + to zoom')
      : (r.zoomed ? `Viewing ${fmtCh(r.from)} – ${fmtCh(r.to)}` : 'Pinch or + to zoom · drag to move');
  }

  function drawTicks(a, b) {
    const major = niceStep(78, st.scale), minor = major / (major >= 1000 ? 10 : 5);
    let s = `<rect x="0" y="${AXIS_Y - 6}" width="${st.W}" height="${H - AXIS_Y + 6}" fill="#0e1626"/>`;
    const start = Math.max(st.lo, Math.ceil(a / minor) * minor);
    const end = Math.min(st.hi, b);
    if (minor * st.scale >= 6) {
      for (let m = start; m <= end; m += minor) {
        const x = X(m), isMajor = Math.abs(m / major - Math.round(m / major)) < 1e-6;
        s += `<rect x="${x - .5}" y="${AXIS_Y - 6}" width="1" height="${isMajor ? 9 : 4}" fill="${isMajor ? '#94a3b8' : '#475569'}"/>`;
      }
    }
    for (let m = Math.max(st.lo, Math.ceil(a / major) * major); m <= end; m += major) {
      const x = X(m), km = m % 1000 === 0;
      s += `<text x="${x}" y="${AXIS_Y + 15}" text-anchor="middle" class="m-ax${km ? ' km' : ''}">${km && major >= 1000 ? 'Km ' + m / 1000 : fmtCh(m)}</text>`;
      // Kilometre stone on the verge
      if (km && st.kind === 'road') s += `<g transform="translate(${x},${ROAD_TOP - 1})"><path d="M-5 0 v-10 a5 5 0 0 1 10 0 v10z" fill="#f8fafc" stroke="#facc15" stroke-width="1"/><text y="-3" text-anchor="middle" class="m-stone">${m / 1000}</text></g>`;
    }
    // Project start / end
    [[st.lo, 'start'], [st.hi, 'end']].forEach(([m, k]) => {
      if (m < a || m > b) return;
      s += `<rect x="${X(m) - 1}" y="${ROAD_TOP - 6}" width="2" height="${ROAD_BOT - ROAD_TOP + 12}" fill="#f5a524"/>`;
    });
    return s;
  }

  // Stretches with photos: an amber line along that side of the road
  function drawCoverage(a, b) {
    const size = st.groupSize || 100;
    const seen = new Set();
    st.photos.forEach(p => {
      const m = photoChMid(p);
      if (m == null || m < a - size || m > b + size) return;
      seen.add(Math.floor((m - st.lo) / size) + ':' + sideLane(p.side));
    });
    let s = '';
    seen.forEach(k => {
      const [i, lane] = k.split(':').map(Number);
      const x = X(st.lo + i * size), w = Math.max(2, size * st.scale - 1);
      const ys = lane < 0 ? [ROAD_TOP + 1] : lane > 0 ? [ROAD_BOT - 4] : [ROAD_TOP + 1, ROAD_BOT - 4];
      ys.forEach(y => { s += `<rect x="${x}" y="${y}" width="${w}" height="3" rx="1.5" fill="#f5a524" opacity=".9"/>`; });
    });
    return s;
  }

  // Photos: grouped where they would overlap; thumbnails once zoomed in
  function drawMarkers(a, b) {
    const lanes = { '-1': new Map(), '0': new Map(), '1': new Map() };
    st.photos.forEach(p => {
      const m = photoChMid(p);
      if (m == null || m < a || m > b) return;
      const lane = String(sideLane(p.side));
      const k = Math.floor((m - st.lo) * st.scale / BUCKET);
      const L = lanes[lane];
      if (!L.has(k)) L.set(k, []);
      L.get(k).push(p);
    });
    const thumbMode = BUCKET / st.scale <= 80;     // each marker covers 80 m or less
    let s = '';
    Object.entries(lanes).forEach(([laneS, L]) => {
      const lane = +laneS;
      L.forEach(list => {
        list.sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp));
        const ms = list.map(photoChMid);
        const mMin = Math.min(...ms), mMax = Math.max(...ms);
        const x = X(ms.reduce((t, v) => t + v, 0) / ms.length);
        const key = `range:${mMin}:${mMax}:${lane}`;
        const n = list.length, hind = list.some(openHind);
        if (lane === 0) {
          s += `<g class="m-pick" data-pick="${key}"><circle cx="${x}" cy="114" r="${n > 1 ? 9 : 6}" fill="#f5a524" stroke="${hind ? '#f87171' : '#0b1220'}" stroke-width="2"/>${n > 1 ? `<text x="${x}" y="117.5" text-anchor="middle" class="m-n">${n}</text>` : ''}</g>`;
          return;
        }
        const up = lane < 0;
        const edge = up ? ROAD_TOP : ROAD_BOT;
        if (thumbMode) {
          const tw = 50, th = 38, ty = up ? 20 : ROAD_BOT + 18;
          s += `<g class="m-pick" data-pick="${key}">
            <line x1="${x}" y1="${up ? ty + th : ty}" x2="${x}" y2="${edge}" stroke="#f5a524" stroke-width="1.5"/>
            <circle cx="${x}" cy="${edge}" r="3" fill="#f5a524"/>
            <rect x="${x - tw / 2 - 2}" y="${ty - 2}" width="${tw + 4}" height="${th + 4}" rx="5" fill="${hind ? '#f87171' : '#f5a524'}"/>
            <image data-id="${list[0].id}" href="${thumbOf(list[0])}" x="${x - tw / 2}" y="${ty}" width="${tw}" height="${th}" preserveAspectRatio="xMidYMid slice"/>
            ${n > 1 ? `<circle cx="${x + tw / 2}" cy="${ty}" r="9" fill="#0b1220" stroke="#f5a524" stroke-width="1.5"/><text x="${x + tw / 2}" y="${ty + 3.5}" text-anchor="middle" class="m-n light">${n}</text>` : ''}
          </g>`;
        } else {
          const cy = up ? 46 : ROAD_BOT + 30, r = Math.min(15, 8 + Math.sqrt(n) * 1.6);
          s += `<g class="m-pick" data-pick="${key}">
            <line x1="${x}" y1="${up ? cy + r : cy - r}" x2="${x}" y2="${edge}" stroke="#f5a524" stroke-opacity=".7" stroke-width="1.5"/>
            <circle cx="${x}" cy="${cy}" r="${r}" fill="#f5a524" stroke="${hind ? '#f87171' : '#0b1220'}" stroke-width="2.5"/>
            <text x="${x}" y="${cy + 4}" text-anchor="middle" class="m-n">${n}</text>
          </g>`;
        }
      });
    });
    // Lane names at the left edge of the view
    const lx = st.view.scrollLeft + 8;
    const names = { road: ['LHS', 'RHS'], canal: ['Left bank', 'Right bank'], rail: ['Up line', 'Down line'], pipe: ['Left of RoW', 'Right of RoW'] }[st.kind];
    if (names) s += `<text x="${lx}" y="12" class="m-lane">▲ ${names[0]}</text><text x="${lx}" y="${AXIS_Y - 10}" class="m-lane">▼ ${names[1]}</text>`;
    return s;
  }

  // Bridge: abutments and piers with their photo counts
  function drawBridgeDyn(a, b) {
    const n = st.names.length;
    let s = '';
    const counts = st.counts, last = st.latest;
    const spanPx = st.scale;
    const thumbsOn = spanPx >= 70;
    for (let i = Math.max(0, Math.floor(a)); i <= Math.min(n - 1, Math.ceil(b)); i++) {
      const name = st.names[i], x = X(i), c = counts[name] || 0, abut = /^A\d/.test(name);
      if (abut) {
        const dir = i === 0 ? -1 : 1;
        s += `<path d="M${x - 10 * dir} 86 L${x + 4 * dir} 86 L${x + 30 * dir} 152 L${x - 14 * dir} 152 Z" fill="#9ca3af" stroke="#e5e7eb" stroke-width=".8"/>`;
      } else {
        s += `<rect x="${x - 12}" y="93" width="24" height="7" fill="#9ca3af"/><rect x="${x - 6}" y="100" width="12" height="54" fill="#a3a3a3" stroke="#d4d4d4" stroke-width=".6"/><rect x="${x - 14}" y="152" width="28" height="8" fill="#78716c"/>`;
      }
      const hind = (st.hindNames || new Set()).has(name);
      s += `<g class="m-pick" data-pick="el:${st.allNames.indexOf(name)}">
        <rect x="${x - Math.max(18, spanPx * 0.35)}" y="20" width="${Math.max(36, spanPx * 0.7)}" height="200" fill="transparent"/>
        <text x="${x}" y="${AXIS_Y + 15}" text-anchor="middle" class="m-ax km">${svgEsc(name)}</text>
        ${c ? `<circle cx="${x}" cy="${thumbsOn ? 62 : 52}" r="${Math.min(14, 9 + Math.sqrt(c))}" fill="#f5a524" stroke="${hind ? '#f87171' : '#0b1220'}" stroke-width="2.5"/><text x="${x}" y="${(thumbsOn ? 62 : 52) + 4}" text-anchor="middle" class="m-n">${c}</text>` : `<circle cx="${x}" cy="52" r="5" fill="#334155"/>`}
        ${c && thumbsOn ? `<rect x="${x - 27}" y="8" width="54" height="40" rx="5" fill="#f5a524"/><image data-id="${last[name].id}" href="${thumbOf(last[name])}" x="${x - 25}" y="10" width="50" height="36" preserveAspectRatio="xMidYMid slice"/>` : ''}
      </g>`;
    }
    // Deck as its own location
    if (st.deckName) {
      const name = st.deckName;
      const c = counts[name] || 0;
      const midX = st.view.scrollLeft + st.view.clientWidth / 2;
      s += `<g class="m-pick" data-pick="el:${st.allNames.indexOf(name)}"><rect x="${PAD}" y="70" width="${st.W - PAD * 2}" height="23" fill="transparent"/>
        <text x="${midX}" y="84" text-anchor="middle" class="m-deck">Deck${c ? ' · ' + c + ' photo' + (c === 1 ? '' : 's') : ''}</text></g>`;
    }
    return s;
  }

  function pick(key) {
    if (!st || !st.onPick) return;
    st.onPick(key);
  }

  // ---------- building: floor by floor ----------
  function mountBuilding(el, opts) {
    st = { kind: 'building', onPick: opts.onPick };
    const names = opts.names, counts = opts.counts, latest = opts.latest, hind = opts.hindNames;
    const max = Math.max(1, ...names.map(n => counts[n] || 0));
    const order = names.slice().reverse();         // top floor first
    const fh = names.length > 40 ? 22 : names.length > 20 ? 26 : 32;
    const W = 360, bx = 64, bw = 196;
    const groundIdx = order.indexOf('Ground Floor');
    let y = 18, s = '';
    order.forEach((name, i) => {
      const c = counts[name] || 0;
      const below = groundIdx >= 0 && i > groundIdx;
      const isTerrace = name === 'Terrace', isFound = name === 'Foundation';
      const lvl = c === 0 ? 0 : c / max > 0.66 ? 3 : c / max > 0.33 ? 2 : 1;
      const fill = ['#273449', '#33557f', '#4f80bf', '#f5a524'][lvl];
      const idx = names.indexOf(name);
      let shape;
      if (isTerrace) {
        shape = `<rect x="${bx}" y="${y + fh - 8}" width="${bw}" height="8" fill="${fill}" stroke="#94a3b8" stroke-width=".8"/>
          <rect x="${bx + bw - 54}" y="${y + 2}" width="40" height="${fh - 10}" fill="${fill}" stroke="#94a3b8" stroke-width=".8"/>
          <rect x="${bx + 14}" y="${y + fh - 18}" width="26" height="10" fill="#475569"/>`;
      } else if (isFound) {
        shape = `<rect x="${bx - 6}" y="${y + fh * .45}" width="${bw + 12}" height="${fh * .55}" fill="${fill}" stroke="#94a3b8" stroke-width=".8"/>
          ${[0.2, 0.5, 0.8].map(f => `<rect x="${bx + bw * f - 14}" y="${y + 2}" width="28" height="${fh * .45}" fill="${fill}" stroke="#94a3b8" stroke-width=".6"/>`).join('')}`;
      } else {
        const win = Math.max(4, Math.floor(bw / 26));
        shape = `<rect x="${bx}" y="${y}" width="${bw}" height="${fh}" fill="${fill}" stroke="#94a3b8" stroke-width=".8"/>` +
          Array.from({ length: win }, (_, k) => `<rect x="${bx + 8 + k * (bw - 16) / win}" y="${y + fh * .25}" width="${(bw - 16) / win - 6}" height="${fh * .45}" rx="1.5" fill="${below ? '#1e293b' : '#0f172a'}" opacity="${lvl === 3 ? .55 : .8}"/>`).join('');
      }
      s += `<g class="m-pick" data-pick="el:${idx}">
        <rect x="0" y="${y}" width="${W}" height="${fh}" fill="transparent"/>
        ${shape}
        <text x="${bx - 8}" y="${y + fh / 2 + 4}" text-anchor="end" class="m-floor">${svgEsc(name.replace(' Floor', '').replace('Basement ', 'B').replace('Ground', 'G').replace('Foundation', 'Fdn'))}</text>
        ${c ? `<circle cx="${bx + bw + 22}" cy="${y + fh / 2}" r="${Math.min(12, fh / 2 - 2)}" fill="#f5a524" stroke="${hind.has(name) ? '#f87171' : '#0b1220'}" stroke-width="2"/><text x="${bx + bw + 22}" y="${y + fh / 2 + 4}" text-anchor="middle" class="m-n">${c}</text>
          <text x="${bx + bw + 40}" y="${y + fh / 2 + 4}" class="m-date">${latest[name] ? esc(new Date(latest[name].timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })) : ''}</text>` : ''}
      </g>`;
      y += fh;
      if (name === 'Ground Floor') {
        s += `<rect x="0" y="${y}" width="${W}" height="3" fill="#a16207"/>`;
        y += 3;
      }
    });
    const total = y + 14;
    // Earth behind the basements and foundation
    const earth = groundIdx >= 0 && groundIdx < order.length - 1
      ? `<rect x="0" y="${18 + (groundIdx + 1) * fh + 3}" width="${W}" height="${total - (18 + (groundIdx + 1) * fh + 3)}" fill="url(#pSoilB)"/>` : '';
    el.innerHTML = `<div class="bld-view"><svg viewBox="0 0 ${W} ${total}" width="100%" xmlns="http://www.w3.org/2000/svg">
      <defs><pattern id="pSoilB" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#3b2f22"/><circle cx="2" cy="3" r=".8" fill="#4a3b2a"/></pattern></defs>
      ${earth}${s}</svg></div>`;
    el.querySelector('svg').addEventListener('click', e => {
      const t = e.target.closest('[data-pick]');
      if (t) pick(t.getAttribute('data-pick'));
    });
  }

  // ---------- plant / zones ----------
  function mountZones(el, opts) {
    st = { kind: 'plant', onPick: opts.onPick };
    el.innerHTML = `<div class="zone-grid">${opts.names.map((n, i) => {
      const c = opts.counts[n] || 0, p = opts.latest[n];
      return `<button class="zone-tile${c ? ' has' : ''}${opts.hindNames.has(n) ? ' hind' : ''}" onclick="SiteMap.pick('el:${i}')">
        ${p ? `<img src="${p.thumb || p.imageData || ''}" alt="">` : `<span class="zt-empty">${ic('camera', 20)}</span>`}
        <b>${esc(n)}</b><small>${c ? `${c} photo${c === 1 ? '' : 's'} · ${new Date(p.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : 'No photos yet'}</small>
      </button>`;
    }).join('')}</div>`;
  }

  return {
    mountStrip, mountBuilding, mountZones, pick,
    zoomBy: f => st && st.view && setScale(st.scale * f),
    fit: () => st && st.view && setScale(st.fit),
    visibleRange,
    clearThumb: id => thumbs.delete(id)
  };
})();
