// ============================================================
// MATERIAL RECEIPTS (stores) with AI bar counting
// A photo of type "Material" is a receipt: MR-001, MR-002 …
// The AI marks every bar end it finds; the storekeeper taps to add a
// missed bar or remove a wrong dot, so the saved count is always checked.
// photo.mat = { ref, material, dia, grade, lengthM, count, aiCount, added, removed,
//               pts: "x,y;x,y…" (0-1 of the photo), dotR, unitKg, weightKg,
//               supplier, challanNo, vehicleNo, challanQty, challanUnit, ai, editedAt }
// ============================================================

const MAT_MATERIALS = ['TMT bar', 'Pipe', 'Other'];
const MAT_DIAS = [8, 10, 12, 16, 20, 25, 28, 32, 36, 40];
const MAT_GRADES = ['Fe 500', 'Fe 500D', 'Fe 550D', 'Fe 415'];
const MAT_FREE_AI = 3;               // AI counts a free user can try
const MAT_AI_SIDE = 640;             // photo is resized to this long side for counting (tested best)
const MAT_AI_THR = 0.25;             // peak score needed to place a dot (tested best on real photos)
const MAT_AI_MERGE = 0.9;            // peaks closer than this x bar radius are one bar (stops two dots on one end)
const MAT_AI_LONE = 4;               // a dot with no neighbour within this x radius is not part of the bundle

// kg per metre of a round bar: d² / 162 (d in mm), the usual site formula
function barKgPerM(dia) { return dia ? (dia * dia) / 162 : 0; }
function fmtKg(kg) {
  if (!kg) return '—';
  return kg >= 1000 ? `${(kg / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 })} t` : `${Math.round(kg).toLocaleString('en-IN')} kg`;
}
function matLabel(m) {
  if (!m) return '';
  const size = m.dia ? (m.material === 'Pipe' ? ` ${m.dia} mm` : ` ${m.dia} mm`) : '';
  return [m.material + size, m.grade].filter(Boolean).join(' ');
}
function matPhotos(projectId) {
  return projectPhotos(projectId).filter(p => p.photoType === 'Material' && p.mat);
}
// dots: [x, y, byHand] with x, y as 0-1 of the photo; stored as "x,y,0;x,y,1…" (no nested arrays for sync)
function encodePts(pts) { return pts.map(([x, y, u]) => `${x.toFixed(4)},${y.toFixed(4)},${u ? 1 : 0}`).join(';'); }
function decodePts(s) {
  if (!s) return [];
  return String(s).split(';').map(t => t.split(',').map(Number))
    .filter(a => a.length >= 2 && a.every(isFinite)).map(a => [a[0], a[1], a[2] === 1]);
}
function matEdits() {
  const added = MC.pts.filter(p => p[2]).length;
  const removed = MC.aiCount != null ? Math.max(0, MC.aiCount - (MC.pts.length - added)) : 0;
  return { added, removed };
}

async function ensureMaterialRefs(projectId = currentProject && currentProject.id) {
  if (!projectId) return;
  const list = matPhotos(projectId).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let next = list.reduce((m, p) => Math.max(m, parseInt(String(p.mat.ref || '').replace(/\D/g, ''), 10) || 0), 0);
  for (const p of list) {
    if (p.mat.ref) continue;
    p.mat.ref = 'MR-' + String(++next).padStart(3, '0');
    p.updatedAt = Date.now(); p.synced = false;
    await DB.save(p);
  }
}

// ---------------- the counting model (runs on the phone, offline) ----------------
const RebarAI = (() => {
  let session = null, loading = null;
  function script(src) {
    return new Promise((res, rej) => {
      if (window.ort) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src));
      document.head.appendChild(s);
    });
  }
  // XHR, not fetch: the app runs from file:// where fetch is not allowed
  function bytes(url) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('GET', url); x.responseType = 'arraybuffer';
      x.onload = () => (x.status === 0 || x.status === 200) && x.response ? res(new Uint8Array(x.response)) : rej(new Error('could not read ' + url));
      x.onerror = () => rej(new Error('could not read ' + url));
      x.send();
    });
  }
  async function load() {
    if (session) return session;
    if (!loading) {
      loading = (async () => {
        await script('lib/ort/ort.wasm.min.js');
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.simd = true;
        ort.env.wasm.proxy = false;
        // Full file:// address: the runtime then reads its engine with XHR. The Android WebView
        // refuses fetch() for app files ("TypeError: Failed to fetch"), and a relative path makes it use fetch.
        ort.env.wasm.wasmPaths = new URL('lib/ort/', location.href).href;
        session = await ort.InferenceSession.create(await bytes('ai/rebar-count.onnx'), { executionProviders: ['wasm'] });
        return session;
      })().catch(e => { loading = null; throw e; });
    }
    return loading;
  }
  // Returns dots in 0-1 photo coordinates, with a radius (0-1 of the width)
  async function count(source, side = MAT_AI_SIDE, thr = MAT_AI_THR) {
    const s = await load();
    const sw = source.width, sh = source.height;
    const k = side / Math.max(sw, sh);
    const W = Math.max(32, Math.round(sw * k / 32) * 32), H = Math.max(32, Math.round(sh * k / 32) * 32);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';   // smooth downscale, as in training
    g.drawImage(source, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    const n = W * H, data = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      data[i] = px[i * 4] / 255; data[n + i] = px[i * 4 + 1] / 255; data[2 * n + i] = px[i * 4 + 2] / 255;
    }
    const t0 = performance.now();
    const out = await s.run({ image: new ort.Tensor('float32', data, [1, 3, H, W]) });
    const ms = Math.round(performance.now() - t0);
    const pk = out.peaks.data, lr = out.logr.data;
    const h4 = out.peaks.dims[2], w4 = out.peaks.dims[3];
    // candidate bar ends, strongest first
    const cand = [];
    for (let y = 0; y < h4; y++) {
      for (let x = 0; x < w4; x++) {
        const i = y * w4 + x;
        if (pk[i] > thr) cand.push([x, y, pk[i], Math.exp(lr[i])]);
      }
    }
    cand.sort((a, b) => b[2] - a[2]);
    // two peaks closer than MAT_AI_MERGE x the bar radius are the same bar
    const kept = [];
    for (const c of cand) {
      if (!kept.some(k => (k[0] - c[0]) ** 2 + (k[1] - c[1]) ** 2 < (MAT_AI_MERGE * Math.max(k[3], c[3])) ** 2)) kept.push(c);
    }
    // bars in a bundle touch each other: drop lone dots on the background or on bar sides
    let use = kept;
    if (kept.length >= 8) {
      const rs = kept.map(k => k[3]).sort((a, b) => a - b), rMed = rs[Math.floor(rs.length / 2)];
      use = kept.filter(a => {
        const lim = (MAT_AI_LONE * Math.max(rMed, a[3])) ** 2;
        return kept.some(b => b !== a && (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 <= lim);
      });
    }
    const dots = use.map(([x, y, , r]) => [(x + 0.5) / w4, (y + 0.5) / h4, r * 4 / W]);
    return { dots, ms };
  }
  return { load, count };
})();

// ---------------- count sheet ----------------
let MC = null;   // the receipt being counted / edited

function matDefaults() {
  return Object.assign({ material: 'TMT bar', dia: 16, grade: 'Fe 500D', lengthM: 12 }, loadJSON('matLast', {}));
}

// Called by the camera for a photo of type "Material" (not yet saved, no stamp yet)
async function openMaterialCount(canvas, photo, sharpness) {
  const d = matDefaults();
  MC = {
    mode: 'new', canvas, photo, sharpness,
    pts: [], aiCount: null, dotR: 0.012, ai: null,
    form: { material: d.material, dia: d.dia, grade: d.grade, lengthM: d.lengthM, supplier: '', challanNo: '', vehicleNo: '', challanQty: '', challanUnit: 't' },
    zoom: 1
  };
  renderMatSheet();
  openSheet('mat-sheet');
  await runMatAI();
}

function editMaterialReceipt(id) {
  const p = photos.find(x => x.id === id);
  if (!p || !p.mat) return;
  const m = p.mat;
  MC = {
    mode: 'edit', photo: p, canvas: null,
    pts: decodePts(m.pts), aiCount: m.aiCount ?? null, dotR: m.dotR || 0.012, ai: m.ai || null,
    form: { material: m.material, dia: m.dia, grade: m.grade || '', lengthM: m.lengthM, supplier: m.supplier || '', challanNo: m.challanNo || '', vehicleNo: m.vehicleNo || '', challanQty: m.challanQty ?? '', challanUnit: m.challanUnit || 't' },
    zoom: 1
  };
  closeSheet('mat-register');
  renderMatSheet();
  openSheet('mat-sheet');
}

function matAIAllowed() {
  if (isPro()) return true;
  return (loadJSON('matAiUsed', 0) || 0) < MAT_FREE_AI;
}

async function runMatAI() {
  if (!MC || MC.mode !== 'new') return;
  const status = document.getElementById('mat-ai-status');
  if (!matAIAllowed()) {
    status.innerHTML = `${ic('lock', 14)} You have used the ${MAT_FREE_AI} free AI counts. Tap the bar ends to count by hand, or <button class="link-btn inline" onclick="openPaywall('ai-count')">get Pro</button> for unlimited AI counting.`;
    return;
  }
  status.innerHTML = `<span class="spin"></span> Counting bar ends…`;
  try {
    const { dots, ms } = await RebarAI.count(MC.canvas);
    if (!MC || MC.mode !== 'new') return;
    MC.pts = dots.map(d => [d[0], d[1], false]);
    MC.aiCount = dots.length;
    if (dots.length) {
      const rs = dots.map(d => d[2]).sort((a, b) => a - b);
      MC.dotR = Math.min(0.03, Math.max(0.004, rs[Math.floor(rs.length / 2)] * 0.55));
    }
    MC.ai = { model: 'rebar-count-1', ms, thr: MAT_AI_THR };
    if (!isPro()) saveJSON('matAiUsed', (loadJSON('matAiUsed', 0) || 0) + 1);
    status.innerHTML = dots.length
      ? `${ic('sparkles', 14)} AI found <b>${dots.length}</b>. Check the dots: tap a missed bar to add it, tap a wrong dot to remove it.`
      : `${ic('sparkles', 14)} The AI found no bar ends. Take the photo square to the cut ends, or tap each bar to count by hand.`;
    if (!isPro()) {
      const left = MAT_FREE_AI - loadJSON('matAiUsed', 0);
      status.innerHTML += `<div class="mat-trial">${left > 0 ? `${left} free AI count${left === 1 ? '' : 's'} left.` : 'That was your last free AI count.'} Pro counts without limit.</div>`;
    }
    drawMatDots();
    renderMatTotals();
  } catch (e) {
    status.innerHTML = `${ic('alert', 14)} AI counting is not available on this phone (${esc(e.message)}). Tap each bar end to count by hand.`;
  }
}

function renderMatSheet() {
  const f = MC.form;
  const src = MC.mode === 'new' ? MC.canvas.toDataURL('image/jpeg', 0.85) : MC.photo.imageData;
  document.getElementById('mat-title').textContent = MC.mode === 'new' ? 'Material receipt' : `Material receipt ${MC.photo.mat.ref || ''}`;
  document.getElementById('mat-img').src = src;
  document.getElementById('mat-ai-status').innerHTML = MC.mode === 'edit'
    ? (MC.aiCount != null ? `${ic('sparkles', 14)} AI counted ${MC.aiCount}; checked count ${MC.pts.length}. Tap to add or remove a bar.` : 'Tap to add or remove a bar.')
    : '';
  // fill the inputs first: rendering reads them back into the form
  ['supplier', 'challanNo', 'vehicleNo', 'challanQty'].forEach(k => { document.getElementById('mat-' + k).value = f[k] ?? ''; });
  document.getElementById('mat-length').value = f.lengthM || '';
  document.getElementById('mat-challanUnit').value = f.challanUnit || 't';
  renderChips('mat-material', 'matMaterial', f.material, v => { f.material = v; renderMatSheetForm(); }, { values: MAT_MATERIALS, plain: true });
  renderMatSheetForm();
  setMatZoom(1);
  document.getElementById('mat-retake').style.display = MC.mode === 'new' ? '' : 'none';
  document.getElementById('mat-delete').style.display = MC.mode === 'edit' ? '' : 'none';
}

function renderMatSheetForm() {
  const f = MC.form;
  const bar = f.material === 'TMT bar';
  document.getElementById('mat-dia-label').textContent = f.material === 'Pipe' ? 'Pipe size (mm, optional)' : 'Bar diameter (mm)';
  renderChips('mat-dia', 'matDia', f.dia ? String(f.dia) : '', v => { f.dia = Number(v) || 0; renderMatSheetForm(); },
    { values: MAT_DIAS.map(String).concat(f.dia && !MAT_DIAS.includes(f.dia) ? [String(f.dia)] : []), plain: true });
  const more = document.createElement('button');
  more.type = 'button'; more.className = 'chip others'; more.innerHTML = ic('plus', 14) + 'Other';
  more.onclick = async () => { const v = await askText('Size in mm', 'For example 6 or 50'); if (v && Number(v) > 0) { f.dia = Number(v); renderMatSheetForm(); } };
  document.getElementById('mat-dia').appendChild(more);
  document.getElementById('mat-grade-block').style.display = bar ? '' : 'none';
  if (bar) renderChips('mat-grade', 'matGrade', f.grade, v => { f.grade = f.grade === v ? '' : v; renderMatSheetForm(); }, { values: MAT_GRADES, plain: true });
  document.getElementById('mat-length-block').style.display = bar ? '' : 'none';
  renderMatTotals();
}

function matReadForm() {
  const f = MC.form;
  f.lengthM = parseFloat(document.getElementById('mat-length').value) || 0;
  ['supplier', 'challanNo', 'vehicleNo'].forEach(k => { f[k] = document.getElementById('mat-' + k).value.trim(); });
  const q = document.getElementById('mat-challanQty').value.trim();
  f.challanQty = q === '' ? '' : (parseFloat(q) || 0);
  f.challanUnit = document.getElementById('mat-challanUnit').value;
}

function matWeight(count, f) {
  if (f.material !== 'TMT bar' || !f.dia || !f.lengthM) return { unitKg: 0, weightKg: 0 };
  const unitKg = barKgPerM(f.dia) * f.lengthM;
  return { unitKg, weightKg: unitKg * count };
}

function renderMatTotals() {
  if (!MC) return;
  matReadForm();
  const f = MC.form, n = MC.pts.length;
  const { unitKg, weightKg } = matWeight(n, f);
  const unit = f.material === 'Pipe' ? 'pipes' : f.material === 'TMT bar' ? 'bars' : 'pieces';
  let check = '';
  if (f.challanQty !== '' && f.challanQty > 0) {
    if (f.challanUnit === 't' && weightKg) {
      const diff = weightKg - f.challanQty * 1000;
      const pct = diff / (f.challanQty * 1000) * 100;
      check = `<div class="mat-check ${Math.abs(pct) > 2 ? 'warn' : 'ok'}">Challan ${f.challanQty} t · counted ${fmtKg(weightKg)} · ${diff >= 0 ? '+' : '−'}${fmtKg(Math.abs(diff))} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</div>`;
    } else if (f.challanUnit === 'nos') {
      const diff = n - f.challanQty;
      check = `<div class="mat-check ${diff ? 'warn' : 'ok'}">Challan ${f.challanQty} nos · counted ${n} · ${diff === 0 ? 'matches' : (diff > 0 ? '+' : '') + diff}</div>`;
    }
  }
  const ed = matEdits();
  const edits = MC.aiCount != null ? `AI ${MC.aiCount}${ed.added ? ` · +${ed.added} added by you` : ''}${ed.removed ? ` · −${ed.removed} removed` : ''}` : 'Counted by hand';
  document.getElementById('mat-total').innerHTML = `
    <div class="mat-big"><b>${n}</b><span>${unit}</span></div>
    <div class="mat-sub">${edits}</div>
    ${weightKg ? `<div class="mat-weight"><b>${fmtKg(weightKg)}</b><span>${f.dia} mm × ${f.lengthM} m = ${unitKg.toFixed(2)} kg each (d²/162)</span></div>` : ''}
    ${check}`;
}

function setMatZoom(z) {
  if (!MC) return;
  MC.zoom = z;
  document.getElementById('mat-zoom-inner').style.width = (z * 100) + '%';
  document.querySelectorAll('#mat-zoom button').forEach(b => b.classList.toggle('on', Number(b.dataset.z) === z));
  requestAnimationFrame(drawMatDots);
}

function drawMatDots() {
  const img = document.getElementById('mat-img'), cv = document.getElementById('mat-dots');
  if (!MC || !img.naturalWidth) return;
  const w = img.clientWidth, h = img.clientHeight, dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const r = Math.max(4, Math.min(16, MC.dotR * w));
  MC.pts.forEach(([x, y, u]) => {
    g.beginPath(); g.arc(x * w, y * h, r, 0, Math.PI * 2);
    g.fillStyle = u ? 'rgba(59,130,246,0.9)' : 'rgba(34,197,94,0.85)';
    g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
  });
  renderMatTotals();
}

// Tap: on a dot -> remove it; elsewhere -> add a bar there
function matTap(ev) {
  if (!MC) return;
  const img = document.getElementById('mat-img');
  const rect = img.getBoundingClientRect();
  const x = (ev.clientX - rect.left) / rect.width, y = (ev.clientY - rect.top) / rect.height;
  if (x < 0 || y < 0 || x > 1 || y > 1) return;
  const r = Math.max(4, Math.min(16, MC.dotR * rect.width)) * 1.4;
  let best = -1, bd = Infinity;
  MC.pts.forEach(([px, py], i) => {
    const d = Math.hypot((px - x) * rect.width, (py - y) * rect.height);
    if (d < bd) { bd = d; best = i; }
  });
  if (best >= 0 && bd <= r) MC.pts.splice(best, 1);
  else MC.pts.push([x, y, true]);
  drawMatDots();
}

function matUndoAll() {
  if (!MC || !MC.pts.length) return;
  if (!confirm('Remove all dots and count by hand?')) return;
  MC.pts = [];
  drawMatDots();
}

function retakeMaterial() {
  MC = null;
  closeSheet('mat-sheet');
}

async function saveMaterialReceipt() {
  if (!MC) return;
  matReadForm();
  const f = MC.form, n = MC.pts.length;
  if (!n) { showToast('No bars counted yet. Tap each bar end, or retake the photo.', 'danger'); return; }
  if (f.material === 'TMT bar' && !f.dia) { showToast('Pick the bar diameter', 'danger'); return; }
  const { unitKg, weightKg } = matWeight(n, f);
  const ed = matEdits();
  const mat = Object.assign({}, MC.mode === 'edit' ? MC.photo.mat : {}, {
    material: f.material, dia: f.dia || 0, grade: f.material === 'TMT bar' ? f.grade : '', lengthM: f.material === 'TMT bar' ? f.lengthM : 0,
    count: n, aiCount: MC.aiCount, added: ed.added, removed: ed.removed,
    pts: encodePts(MC.pts), dotR: MC.dotR, unitKg: Math.round(unitKg * 1000) / 1000, weightKg: Math.round(weightKg * 10) / 10,
    supplier: f.supplier, challanNo: f.challanNo, vehicleNo: f.vehicleNo,
    challanQty: f.challanQty === '' ? null : f.challanQty, challanUnit: f.challanUnit, ai: MC.ai
  });
  saveJSON('matLast', { material: f.material, dia: f.dia, grade: f.grade, lengthM: f.lengthM });
  const unit = f.material === 'Pipe' ? 'pipes' : f.material === 'TMT bar' ? 'bars' : 'nos';
  const fields = [
    { label: 'Material', value: matLabel(mat) },
    { label: 'Count', value: `${n} ${unit}` + (mat.lengthM ? ` × ${mat.lengthM} m` : '') },
    { label: 'Weight', value: weightKg ? fmtKg(weightKg) : '' },
    { label: 'Supplier', value: f.supplier },
    { label: 'Challan', value: f.challanNo },
    { label: 'Vehicle', value: f.vehicleNo }
  ].filter(x => x.value);

  if (MC.mode === 'edit') {
    const p = MC.photo;
    mat.editedAt = new Date().toISOString();
    p.mat = mat; p.fields = fields;
    p.updatedAt = Date.now(); p.synced = false;
    await DB.save(p);
    Sync.schedule();
    MC = null;
    closeSheet('mat-sheet');
    showToast(`${p.mat.ref} updated: ${n} ${unit}`, 'success');
    openMaterialRegister();
    return;
  }
  const p = MC.photo;
  p.photoType = 'Material';
  p.activity = 'Material Receipt';
  p.mat = mat;
  p.fields = fields;
  const canvas = MC.canvas, sharpness = MC.sharpness;
  MC = null;
  closeSheet('mat-sheet');
  let sample = null;
  try { if (aiShareAvailable() && aiShareChoice() !== false) sample = trainingSample(canvas, mat); } catch (e) { sample = null; }
  await ensureMaterialRefsFor(p);
  await storeCapturedPhoto(canvas, p, sharpness, `Saved ${p.mat.ref}: ${n} ${unit}${weightKg ? ', ' + fmtKg(weightKg) : ''}`);
  if (sample) offerTrainingSample(sample);
}

// Number the new receipt before it is stamped, so the stamp shows MR-00x
async function ensureMaterialRefsFor(p) {
  await ensureMaterialRefs();
  const max = matPhotos().reduce((m, x) => Math.max(m, parseInt(String(x.mat.ref || '').replace(/\D/g, ''), 10) || 0), 0);
  p.mat.ref = 'MR-' + String(max + 1).padStart(3, '0');
  p.description = [p.mat.ref, p.description].filter(Boolean).join('  ');
}

async function deleteMaterialReceipt() {
  if (!MC || MC.mode !== 'edit') return;
  const id = MC.photo.id;
  MC = null;
  closeSheet('mat-sheet');
  await deletePhotos([id]);
  openMaterialRegister();
}

// Camera shortcut: next photo is a material receipt
function toggleMaterialMode() {
  if (currentPhotoType === 'Material') {
    currentPhotoType = 'General';
    showToast('Back to normal site photos');
  } else {
    currentPhotoType = 'Material';
    showToast('Material receipt: photograph the cut ends of the bundle, square on, filling the frame');
  }
  saveJSON('camDetails', Object.assign(loadJSON('camDetails', {}), { photoType: currentPhotoType }));
  applyMaterialModeUI();
  updateOverlayMeta();
}
function applyMaterialModeUI() {
  const b = document.getElementById('mat-mode-btn');
  if (b) b.classList.toggle('active', currentPhotoType === 'Material');
}

// ---------------- register ----------------
function openMaterialRegister() {
  renderMaterialRegister();
  openSheet('mat-register');
}

async function renderMaterialRegister() {
  if (!currentProject) return;
  await ensureMaterialRefs();
  const list = matPhotos().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const totalKg = list.reduce((s, p) => s + (p.mat.weightKg || 0), 0);
  const bars = list.filter(p => p.mat.material === 'TMT bar').reduce((s, p) => s + p.mat.count, 0);
  const byDia = {};
  list.filter(p => p.mat.material === 'TMT bar').forEach(p => {
    const k = p.mat.dia; byDia[k] = byDia[k] || { n: 0, kg: 0 }; byDia[k].n += p.mat.count; byDia[k].kg += p.mat.weightKg || 0;
  });
  document.getElementById('mr-summary').innerHTML = `
    <div class="hs-box"><b>${list.length}</b><span>receipts</span></div>
    <div class="hs-box"><b>${bars.toLocaleString('en-IN')}</b><span>bars</span></div>
    <div class="hs-box"><b>${totalKg ? fmtKg(totalKg) : '—'}</b><span>steel received</span></div>`;
  const dias = Object.keys(byDia).map(Number).sort((a, b) => a - b);
  document.getElementById('mr-bydia').innerHTML = dias.length ? `<table class="mr-table"><tr><th>Dia</th><th>Bars</th><th>Weight</th></tr>${dias.map(d => `<tr><td>${d} mm</td><td>${byDia[d].n.toLocaleString('en-IN')}</td><td>${fmtKg(byDia[d].kg)}</td></tr>`).join('')}</table>` : '';
  const box = document.getElementById('mr-list');
  if (!list.length) {
    box.innerHTML = `<div class="empty"><div class="empty-ic">${ic('sparkles', 40)}</div><div class="empty-title">No material receipts yet</div>
      <div class="empty-sub">In the camera tap <b>AI count</b>, then photograph the cut ends of the bundle, square on. The AI marks every bar; you check the count, pick the diameter and save. Weight is worked out for you.</div>
      <button class="btn primary" onclick="closeSheet('mat-register');switchTab('camera');if(currentPhotoType!=='Material')toggleMaterialMode()">${ic('camera', 18)}Count a bundle now</button></div>`;
    return;
  }
  box.innerHTML = list.map(p => {
    const m = p.mat;
    const unit = m.material === 'Pipe' ? 'pipes' : m.material === 'TMT bar' ? 'bars' : 'nos';
    const meta = [m.supplier, m.challanNo && 'Challan ' + m.challanNo, m.vehicleNo].filter(Boolean).map(esc).join(' · ');
    return `<button class="mr-card" onclick="editMaterialReceipt('${p.id}')">
      <img src="${p.thumb || p.imageData}" alt="">
      <span class="mr-body">
        <span class="mr-top"><b>${esc(m.ref || '')}</b><span>${esc(p.displayDate)} ${esc(p.displayTime || '')}</span></span>
        <span class="mr-main">${esc(matLabel(m))}: <b>${m.count} ${unit}</b>${m.weightKg ? ` · ${fmtKg(m.weightKg)}` : ''}</span>
        ${meta ? `<span class="mr-meta">${meta}</span>` : ''}
        <span class="mr-meta">${m.aiCount != null ? `AI ${m.aiCount}, checked ${m.count}` : 'Counted by hand'}${p.engineer && p.engineer.name ? ' · ' + esc(p.engineer.name) : ''}${m.editedAt ? ' · corrected later' : ''}</span>
      </span></button>`;
  }).join('');
}

// Photo with the counted dots drawn on it, for reports
function annotatedReceipt(p, maxPx = 1000) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const r = Math.max(2.5, Math.min(12, (p.mat.dotR || 0.012) * c.width * 0.8));
      decodePts(p.mat.pts).forEach(([x, y], i) => {
        g.beginPath(); g.arc(x * c.width, y * c.height, r, 0, Math.PI * 2);
        g.fillStyle = 'rgba(34,197,94,0.85)'; g.fill();
        g.lineWidth = 1; g.strokeStyle = '#fff'; g.stroke();
      });
      res({ data: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height });
    };
    img.onerror = () => res(null);
    img.src = p.imageData;
  });
}

function matRows() {
  return matPhotos().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map(p => {
    const m = p.mat;
    return {
      p, ref: m.ref, date: `${p.displayDate} ${p.displayTime || ''}`.trim(),
      material: matLabel(m), count: m.count, aiCount: m.aiCount, length: m.lengthM || '',
      unitKg: m.unitKg || '', weightKg: m.weightKg || '',
      challan: [m.challanNo, m.challanQty != null && m.challanQty !== '' ? `${m.challanQty} ${m.challanUnit === 'nos' ? 'nos' : 't'}` : ''].filter(Boolean).join(' · '),
      supplier: m.supplier || '', vehicle: m.vehicleNo || '',
      by: p.engineer && p.engineer.name ? p.engineer.name : ''
    };
  });
}

async function exportMaterialRegister(format) {
  await ensureMaterialRefs();
  const rows = matRows();
  if (!rows.length) { showToast('No material receipts to export', 'danger'); return; }
  showLoading('Creating material receipt register…', `${rows.length} receipts`);
  try {
    const imgs = new Map();
    for (const r of rows) imgs.set(r.p.id, await annotatedReceipt(r.p, 700));
    const title = `Material Receipt Register as on ${fmtDate(new Date())}`;
    const name = safeFileName(`${currentProject.name}_Material_Receipts_${localDateKey(new Date())}.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
    const blob = format === 'pdf' ? await matPDF(rows, imgs, title) : await matExcel(rows, imgs, title);
    const mime = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    hideLoading();
    savedMessage(await saveFile(blob, name, mime), 'Material receipt register', mime);
  } catch (e) {
    hideLoading();
    showToast('Could not create the register: ' + e.message, 'danger');
  }
}

function matTotalsByDia(rows) {
  const by = {};
  rows.filter(r => r.p.mat.material === 'TMT bar').forEach(r => {
    const d = r.p.mat.dia; by[d] = by[d] || { n: 0, kg: 0 }; by[d].n += r.count; by[d].kg += r.weightKg || 0;
  });
  return Object.keys(by).map(Number).sort((a, b) => a - b).map(d => ({ dia: d, n: by[d].n, kg: by[d].kg }));
}

async function matPDF(rows, imgs, title) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, H = 210, M = 10;
  const cols = [['Ref', 16], ['Date / time', 24], ['Material', 34], ['Count', 16], ['Length', 14], ['kg each', 15], ['Weight', 20], ['Supplier', 30], ['Challan', 26], ['Vehicle', 22], ['Photo (counted)', 60]];
  const rowH = 36, headH = 8;
  let y = 0, page = 0;
  const header = () => {
    page++;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(doc.splitTextToSize(currentProject.fullName || currentProject.name, W - 2 * M)[0], W / 2, M + 4, { align: 'center' });
    doc.setFontSize(11); doc.text(title, W / 2, M + 10, { align: 'center' });
    doc.setLineWidth(0.4); doc.line(M, M + 13, W - M, M + 13);
    y = M + 16;
    let x = M;
    doc.setFontSize(8);
    cols.forEach(([label, w]) => { doc.rect(x, y, w, headH); doc.text(label, x + 1.5, y + 5.3); x += w; });
    y += headH;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Page ${page}`, W - M, H - 5, { align: 'right' });
    doc.text('Counts made with CivilCam Pro AI and checked by the engineer (dots on each photo). Weight = count × d²/162 × length.', M, H - 5);
  };
  header();
  for (const r of rows) {
    if (y + rowH > H - 10) { doc.addPage(); header(); }
    let x = M;
    const values = [r.ref, r.date, r.material, String(r.count) + (r.aiCount != null && r.aiCount !== r.count ? `\n(AI ${r.aiCount})` : ''), r.length ? r.length + ' m' : '', r.unitKg ? String(r.unitKg) : '', r.weightKg ? fmtKg(r.weightKg) : '', r.supplier, r.challan, r.vehicle];
    cols.forEach(([, w], i) => {
      doc.setLineWidth(0.2); doc.rect(x, y, w, rowH);
      if (i < values.length) {
        doc.setFont('helvetica', i === 0 || i === 3 || i === 6 ? 'bold' : 'normal');
        doc.text(doc.splitTextToSize(values[i] || '-', w - 3).slice(0, 8), x + 1.5, y + 4);
      } else {
        const im = imgs.get(r.p.id);
        if (im) {
          const fb = fitBox(im.w, im.h, w - 2, rowH - 2);
          try { doc.addImage(im.data, 'JPEG', x + 1 + fb.dx, y + 1 + fb.dy, fb.w, fb.h, undefined, 'FAST'); } catch (e) { /* skip */ }
        }
      }
      x += w;
    });
    y += rowH;
  }
  // totals by diameter
  const tot = matTotalsByDia(rows);
  if (tot.length) {
    if (y + 12 + tot.length * 7 > H - 10) { doc.addPage(); header(); }
    y += 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Steel received, by diameter', M, y); y += 3;
    doc.setFontSize(9);
    [['Diameter', 30], ['Bars', 30], ['Weight', 35]].reduce((x, [l, w]) => { doc.rect(x, y, w, 7); doc.text(l, x + 2, y + 5); return x + w; }, M);
    y += 7;
    doc.setFont('helvetica', 'normal');
    tot.concat([{ dia: 'Total', n: tot.reduce((s, t) => s + t.n, 0), kg: tot.reduce((s, t) => s + t.kg, 0) }]).forEach(t => {
      [[t.dia === 'Total' ? 'Total' : t.dia + ' mm', 30], [t.n.toLocaleString('en-IN'), 30], [fmtKg(t.kg), 35]].reduce((x, [l, w]) => { doc.rect(x, y, w, 7); doc.text(String(l), x + 2, y + 5); return x + w; }, M);
      y += 7;
    });
  }
  return doc.output('blob');
}

async function matExcel(rows, imgs, title) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Material Receipts', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [9, 18, 22, 9, 9, 10, 12, 22, 18, 14, 14, 40].map(width => ({ width }));
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  ws.mergeCells('A1:L1'); ws.getCell('A1').value = currentProject.fullName || currentProject.name;
  ws.getCell('A1').font = { bold: true, size: 14 }; ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.mergeCells('A2:L2'); ws.getCell('A2').value = title;
  ws.getCell('A2').font = { bold: true, size: 12 }; ws.getCell('A2').alignment = { horizontal: 'center' };
  const head = ws.getRow(4);
  head.values = ['Ref', 'Date / time', 'Material', 'Count', 'AI count', 'Length (m)', 'Weight (kg)', 'Supplier', 'Challan', 'Vehicle', 'Checked by', 'Photo (counted)'];
  head.eachCell(c => { c.font = { bold: true }; c.border = border; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.values = [r.ref, r.date, r.material, r.count, r.aiCount ?? '', r.length || '', r.weightKg || '', r.supplier, r.challan, r.vehicle, r.by, ''];
    row.height = 150;
    for (let c = 1; c <= 12; c++) { row.getCell(c).border = border; row.getCell(c).alignment = { vertical: 'middle', wrapText: true }; }
    row.getCell(7).numFmt = '#,##0.0';
    const im = imgs.get(r.p.id);
    if (im) {
      const fb = fitBox(im.w, im.h, 280, 190);
      ws.addImage(wb.addImage({ base64: im.data, extension: 'jpeg' }), { tl: { col: 11 + 0.03, row: 4 + i + 0.04 }, ext: { width: fb.w, height: fb.h }, editAs: 'oneCell' });
    }
  });
  // totals by diameter, with live formulas on the weight column
  let r0 = 5 + rows.length + 1;
  ws.getCell(`A${r0}`).value = 'Steel received, by diameter'; ws.getCell(`A${r0}`).font = { bold: true };
  r0++;
  ['Diameter', 'Bars', 'Weight (kg)'].forEach((t, k) => { const c = ws.getCell(r0, k + 1); c.value = t; c.font = { bold: true }; c.border = border; });
  const tot = matTotalsByDia(rows);
  tot.forEach((t, k) => {
    const rr = r0 + 1 + k;
    ws.getCell(rr, 1).value = `${t.dia} mm`;
    ws.getCell(rr, 2).value = t.n;
    ws.getCell(rr, 3).value = Math.round(t.kg * 10) / 10; ws.getCell(rr, 3).numFmt = '#,##0.0';
    [1, 2, 3].forEach(c => { ws.getCell(rr, c).border = border; });
  });
  if (tot.length) {
    const tr = r0 + 1 + tot.length;
    ws.getCell(tr, 1).value = 'Total'; ws.getCell(tr, 1).font = { bold: true };
    ws.getCell(tr, 2).value = { formula: `SUM(B${r0 + 1}:B${tr - 1})` };
    ws.getCell(tr, 3).value = { formula: `SUM(C${r0 + 1}:C${tr - 1})` }; ws.getCell(tr, 3).numFmt = '#,##0.0';
    [1, 2, 3].forEach(c => { ws.getCell(tr, c).border = border; ws.getCell(tr, c).font = { bold: true }; });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

window.addEventListener('resize', () => { if (MC) drawMatDots(); });

// ---------------- help improve AI count (opt-in) ----------------
// Signed-in users are asked once, after their first receipt, whether they will share
// the photo of the bar ends and their checked dots with FunPixelNest to train the AI.
// Sent: the photo WITHOUT the stamp (960 px, no GPS/EXIF), the dots, counts, material and size.
// Not sent: project, location, supplier, challan, vehicle, names.
// Stored at aiTraining/{uid}/samples/{id} (see firebase/firestore.rules); deleted with the account.
// Setting 'aiShare': true / false / null (not asked yet). Queue 'aiShareQueue' while offline.
const AI_SHARE_QUEUE_MAX = 8;
let aiSharePending = null;

function aiShareChoice() { return loadJSON('aiShare', null); }
function aiShareAvailable() {
  return typeof Account !== 'undefined' && Account.available() && Account.isSignedIn() && !!CIVILCAM_CONFIG.firebase.projectId;
}
function appVersionText() {
  const b = window.AndroidBridge;
  try { return b && typeof b.appVersion === 'function' ? String(b.appVersion()) : 'web'; } catch (e) { return 'web'; }
}

// Built from the clean (unstamped) photo before it is stamped
function trainingSample(canvas, mat) {
  const k = Math.min(1, 960 / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, 0, c.width, c.height);
  return {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10), img: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height,
    pts: mat.pts, count: mat.count, aiCount: mat.aiCount ?? -1, added: mat.added || 0, removed: mat.removed || 0,
    material: mat.material, dia: mat.dia || 0, model: (mat.ai && mat.ai.model) || '', app: appVersionText(), createdAt: Date.now()
  };
}

function offerTrainingSample(sample) {
  if (!aiShareAvailable()) return;
  const choice = aiShareChoice();
  if (choice === true) { queueTrainingSample(sample); return; }
  if (choice === false) return;
  aiSharePending = sample;
  setTimeout(() => openSheet('ai-share-sheet'), 900);   // after the "Saved" message
}

function answerAiShare(yes) {
  saveJSON('aiShare', !!yes);
  closeSheet('ai-share-sheet');
  const t = document.getElementById('ai-share');
  if (t) t.checked = !!yes;
  if (yes && aiSharePending) queueTrainingSample(aiSharePending);
  aiSharePending = null;
  showToast(yes ? 'Thank you! Your checked counts will help the AI get better.' : 'OK, nothing is shared. You can change this in Backup.', yes ? 'success' : '');
}

function setAiShare(on) {
  saveJSON('aiShare', !!on);
  if (on) flushTrainingSamples();
  else saveJSON('aiShareQueue', []);
}

function queueTrainingSample(sample) {
  let q = loadJSON('aiShareQueue', []);
  q.push(sample);
  while (q.length > AI_SHARE_QUEUE_MAX) q.shift();
  // phone storage is limited: drop the oldest until it fits
  for (;;) {
    try { localStorage.setItem('aiShareQueue', JSON.stringify(q)); break; } catch (e) { if (!q.length) break; q.shift(); }
  }
  flushTrainingSamples();
}

let aiShareBusy = false;
async function flushTrainingSamples() {
  if (aiShareBusy || aiShareChoice() !== true || !aiShareAvailable() || !navigator.onLine) return;
  let q = loadJSON('aiShareQueue', []);
  if (!q.length) return;
  aiShareBusy = true;
  try {
    const token = await Account.getToken();
    const S = v => ({ stringValue: String(v ?? '') }), I = v => ({ integerValue: String(Math.round(Number(v) || 0)) });
    const base = `https://firestore.googleapis.com/v1/projects/${CIVILCAM_CONFIG.firebase.projectId}/databases/(default)/documents`;
    while (q.length) {
      const s = q[0];
      const fields = {
        uid: S(profile.uid), kind: S('rebar-end'), img: S(s.img), w: I(s.w), h: I(s.h), pts: S(s.pts),
        count: I(s.count), aiCount: I(s.aiCount), added: I(s.added), removed: I(s.removed),
        material: S(s.material), dia: I(s.dia), model: S(s.model), app: S(s.app), createdAt: I(s.createdAt)
      };
      const r = await fetch(`${base}/aiTraining/${encodeURIComponent(profile.uid)}/samples?documentId=${encodeURIComponent(s.id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ fields })
      });
      if (!r.ok && r.status !== 409) throw new Error('share ' + r.status);   // 409: already sent
      q.shift();
      saveJSON('aiShareQueue', q);
    }
  } catch (e) {
    console.warn('AI sample not sent yet', e);
  } finally {
    aiShareBusy = false;
  }
}
window.addEventListener('online', () => setTimeout(flushTrainingSamples, 3000));
setTimeout(flushTrainingSamples, 15000);
