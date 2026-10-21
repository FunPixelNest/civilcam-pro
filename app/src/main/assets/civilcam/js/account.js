// ============================================================
// SIGN-IN (done natively by the Android app with Firebase Auth)
// ============================================================
const CONFIG = window.CIVILCAM_CONFIG || { firebase: {}, aiEndpoint: '' };

const Account = (() => {
  let tokenReqs = {};
  let reqNo = 0;

  function available() {
    return hasAndroidBridge() && typeof window.AndroidBridge.authAvailable === 'function' &&
      window.AndroidBridge.authAvailable() && !!CONFIG.firebase.projectId;
  }
  function isSignedIn() { return !!profile.uid; }

  function signIn(provider) {
    if (!available()) {
      showToast('Sign-in is not set up in this build yet. You can use the app without an account.', 'danger');
      return;
    }
    showLoading('Signing in…');
    window.AndroidBridge.signIn(provider);
  }

  // Called by the Android app when sign-in finishes
  window.onNativeAuth = function (json) {
    hideLoading();
    let r;
    try { r = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { r = { ok: false, error: 'Bad reply' }; }
    if (!r.ok) {
      if (r.error && !/cancel/i.test(r.error)) showToast('Sign-in failed: ' + r.error, 'danger');
      return;
    }
    const firstTime = !profile.name;
    profile.uid = r.uid;
    profile.email = r.email || '';
    profile.provider = r.provider || '';
    if (!profile.name && r.name) profile.name = r.name;
    saveJSON('profile', profile);
    saveJSON('authChoice', 'account');
    showToast('Signed in as ' + (r.email || r.name), 'success');
    Sync.now();
    // Google accounts: ask once for permission to keep full photos in their own Drive
    if (/google/i.test(r.provider || '') && Drive.supported() && !loadJSON('driveBackupAsked', false)) {
      saveJSON('driveBackupAsked', true);
      setTimeout(() => Drive.connect(), 600);
    }
    if (firstTime || !profile.designation) showProfileForm(); else afterProfileReady();
  };

  // Fresh Firebase ID token for calling the cloud
  function getToken() {
    return new Promise((res, rej) => {
      if (!available() || !isSignedIn()) { rej(new Error('Not signed in')); return; }
      const id = 't' + (++reqNo);
      tokenReqs[id] = { res, rej };
      window.AndroidBridge.getIdToken(id);
      setTimeout(() => { if (tokenReqs[id]) { delete tokenReqs[id]; rej(new Error('Token timeout')); } }, 20000);
    });
  }
  window.onNativeToken = function (id, token, error) {
    const r = tokenReqs[id];
    if (!r) return;
    delete tokenReqs[id];
    if (token) r.res(token); else r.rej(new Error(error || 'No token'));
  };

  function signOut() {
    if (hasAndroidBridge() && typeof window.AndroidBridge.signOut === 'function') window.AndroidBridge.signOut();
    profile.uid = ''; profile.email = ''; profile.provider = '';
    saveJSON('profile', profile);
    saveJSON('authChoice', '');
    closeSheet('account-sheet');
    Sync.updateDot();
    showToast('Signed out. Photos on this phone are kept.');
    showAuth();
  }

  function continueOffline() {
    saveJSON('authChoice', 'offline');
    if (!profile.name) showProfileForm(); else afterProfileReady();
  }

  // Engineers with a company e-mail share projects; personal e-mail = own space
  const PUBLIC_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'rediffmail.com', 'privaterelay.appleid.com', 'proton.me'];
  function orgId() {
    const domain = (profile.email.split('@')[1] || '').toLowerCase();
    return domain && !PUBLIC_MAIL.includes(domain) ? domain : 'u_' + profile.uid;
  }

  return { available, isSignedIn, signIn, getToken, signOut, continueOffline, orgId };
})();

// ============================================================
// CLOUD SYNC (Firestore + Cloud Storage over REST)
// ============================================================
const Sync = (() => {
  let timer = null, running = false, status = 'idle', lastError = '';
  let progress = null;          // { done, total } while photos upload
  // Where things live in Firestore:
  //   orgs/<company domain or u_uid>/{projects,photos,options}/<id>   own / company projects
  //   teams/<projectId>  (+ /photos/<id>)                              projects shared with named engineers
  const root = () => `https://firestore.googleapis.com/v1/projects/${CONFIG.firebase.projectId}/databases/(default)/documents`;
  const orgPath = () => `orgs/${encodeURIComponent(Account.orgId())}`;
  const base = () => `${root()}/${orgPath()}`;
  const enc1 = encodeURIComponent;
  function projectOf(p) { return projects.find(x => x.id === p.projectId); }
  function projectPath(pj) { return pj.team ? `teams/${enc1(pj.id)}` : `${orgPath()}/projects/${enc1(pj.id)}`; }
  function photoPath(p, pj = projectOf(p)) { return pj && pj.team ? `teams/${enc1(pj.id)}/photos/${enc1(p.id)}` : `${orgPath()}/photos/${enc1(p.id)}`; }

  function enabled() { return Account.available() && Account.isSignedIn(); }

  function schedule() {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(() => now(), 3000);
  }

  // path: the document to mark deleted (defaults to the own / company space)
  function markDeleted(coll, id, path) {
    const q = loadJSON('pendingDeletes', []);
    q.push({ coll, id, path: path || '' });
    saveJSON('pendingDeletes', q);
    schedule();
  }

  // ----- Firestore value encoding -----
  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    return { mapValue: { fields: encFields(v) } };
  }
  function encFields(o) {
    const f = {};
    Object.keys(o).forEach(k => { if (o[k] !== undefined) f[k] = enc(o[k]); });
    return f;
  }
  function dec(v) {
    if ('nullValue' in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('stringValue' in v) return v.stringValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    if ('mapValue' in v) return decFields(v.mapValue.fields || {});
    return null;
  }
  function decFields(f) {
    const o = {};
    Object.keys(f).forEach(k => { o[k] = dec(f[k]); });
    return o;
  }

  async function api(method, url, token, body) {
    const r = await fetch(url, {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) throw new Error(`${method} ${r.status}`);
    return r.json();
  }

  const putDoc = (coll, id, data, token) => api('PATCH', `${base()}/${coll}/${encodeURIComponent(id)}`, token, { fields: encFields(data) });
  const putAt = (path, data, token) => api('PATCH', `${root()}/${path}`, token, { fields: encFields(data) });

  // Changed documents of one collection under parent (default: own / company space)
  async function query(coll, since, token, parent) {
    const out = [];
    let cursor = since;
    for (;;) {
      const rows = await api('POST', `${parent ? `${root()}/${parent}` : base()}:runQuery`, token, { structuredQuery: {
        from: [{ collectionId: coll }],
        where: { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { integerValue: String(cursor) } } },
        orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' }],
        limit: 200
      } });
      const docs = rows.filter(r => r.document).map(r => decFields(r.document.fields || {}));
      out.push(...docs);
      if (docs.length < 200) break;
      cursor = docs[docs.length - 1].updatedAt;
    }
    return out;
  }

  // ----- Cloud Storage for the pictures -----
  const bucketUrl = () => `https://firebasestorage.googleapis.com/v0/b/${CONFIG.firebase.storageBucket}/o`;
  const imagePath = id => `orgs/${Account.orgId()}/photos/${id}.jpg`;

  async function uploadImage(p, token) {
    const blob = await (await fetch(p.imageData)).blob();
    const r = await fetch(`${bucketUrl()}?uploadType=media&name=${encodeURIComponent(imagePath(p.id))}`, {
      method: 'POST', headers: { Authorization: 'Firebase ' + token, 'Content-Type': 'image/jpeg' }, body: blob
    });
    if (!r.ok) throw new Error('upload ' + r.status);
  }

  async function downloadImage(id, token) {
    const r = await fetch(`${bucketUrl()}/${encodeURIComponent(imagePath(id))}?alt=media`, { headers: { Authorization: 'Firebase ' + token } });
    if (!r.ok) throw new Error('download ' + r.status);
    const blob = await r.blob();
    return 'data:image/jpeg;base64,' + await blobToBase64(blob);
  }

  // ----- one sync round -----
  // Photos and changes still on this phone only
  function pending() {
    const waitingPhotos = photos.filter(p => !p.synced && p.imageData && !p.previewOnly);
    return {
      photos: waitingPhotos.filter(p => !p.uploaded).length,
      details: waitingPhotos.filter(p => p.uploaded).length + projects.filter(p => !p.synced).length + loadJSON('pendingDeletes', []).length,
      list: waitingPhotos
    };
  }

  function onWifi() {
    const c = navigator.connection;
    if (!c || !c.type || c.type === 'unknown') return true;     // can't tell: allow
    return c.type === 'wifi' || c.type === 'ethernet';
  }

  async function now(manual) {
    if (!enabled()) { if (manual) showToast('Sign in to sync', 'danger'); return; }
    if (running) return;
    if (!navigator.onLine) { status = 'offline'; updateDot(); return; }
    if (!manual && loadJSON('syncWifiOnly', false) && !onWifi() && pending().photos) { status = 'waitwifi'; updateDot(); return; }
    running = true; status = 'syncing'; updateDot();
    try {
      const token = await Account.getToken();

      // 1. send what changed here
      for (const pj of (await DB.getAll('projects')).filter(x => !x.synced)) {
        const data = Object.assign({}, pj); delete data.synced;
        await putAt(projectPath(pj), data, token);
        pj.synced = true; await DB.put('projects', pj);
        const mem = projects.find(x => x.id === pj.id);
        if (mem) mem.synced = true;
      }
      for (const op of (await DB.getAll('options')).filter(x => !x.synced)) {
        await putDoc('options', op.key, { key: op.key, values: op.values, updatedAt: op.updatedAt }, token);
        op.synced = true; await DB.put('options', op);
      }
      const toSend = photos.filter(x => !x.synced && x.imageData);
      progress = { done: 0, total: toSend.length };
      for (const p of toSend) {
        progress.done++; updateDot();
        if (!p.uploaded) {
          // Small preview for colleagues; the full photo goes to the engineer's Google Drive
          if (!p.thumb) p.thumb = await makePreview(p.imageData);
          if (Drive.enabled()) {
            const f = await Drive.upload(p);
            p.driveId = f.id; p.driveLink = f.webViewLink || ''; p.driveOwner = profile.email;
          } else if (CONFIG.firebase.storageBucket && !loadJSON('driveBackup', false)) {
            await uploadImage(p, token);
          }
          p.uploaded = true;
        }
        // Team project: let the team open the full photo from this engineer's Drive (by link)
        const pj = projectOf(p);
        if (pj && pj.team && p.driveId && !p.linkShared && p.driveOwner === profile.email && Drive.enabled()) {
          try { await Drive.shareByLink(p.driveId); p.linkShared = true; } catch (e) { console.warn('Drive sharing', e); }
        }
        const data = Object.assign({}, p);
        delete data.imageData; delete data.synced; delete data.previewOnly; delete data.fullCached;
        await putAt(photoPath(p, pj), data, token);
        p.synced = true; await DB.save(p);
      }
      const dels = loadJSON('pendingDeletes', []);
      for (const d of dels) await putAt(d.path || `${orgPath()}/${d.coll}/${enc1(d.id)}`, Object.assign({ id: d.id, deleted: true, updatedAt: Date.now() }, d.extra || {}), token);
      saveJSON('pendingDeletes', []);

      // 2. bring in what colleagues (or this account on another phone) changed
      const since = loadJSON('lastPull_' + Account.orgId(), 0);
      let newest = since, changed = false;
      for (const pj of await query('projects', since, token)) {
        newest = Math.max(newest, pj.updatedAt || 0);
        const local = projects.find(x => x.id === pj.id);
        // (a project that became a team project leaves a "deleted" marker here; the team copy wins)
        if (pj.deleted) { if (local && !local.team) { projects = projects.filter(x => x.id !== pj.id); await DB.del('projects', pj.id); changed = true; } continue; }
        if (!local || (local.updatedAt || 0) < pj.updatedAt) {
          const rec = Object.assign({}, local || {}, pj, { synced: true });
          await DB.put('projects', rec);
          if (local) Object.assign(local, rec); else projects.push(rec);
          changed = true;
        }
      }
      for (const op of await query('options', since, token)) {
        newest = Math.max(newest, op.updatedAt || 0);
        const merged = [...new Set([...(customOptions[op.key] || []), ...(op.values || [])])];
        customOptions[op.key] = merged;
        await DB.put('options', { key: op.key, values: merged, updatedAt: op.updatedAt, synced: merged.length === (op.values || []).length });
        changed = true;
      }
      const pulled = await query('photos', since, token);
      pulled.forEach(rp => { newest = Math.max(newest, rp.updatedAt || 0); });
      if (await mergePhotos(pulled)) changed = true;
      saveJSON('lastPull_' + Account.orgId(), newest);

      // 3. projects shared with this engineer by name (team projects) and their photos
      if (profile.email) {
        if (await pullTeams(token)) changed = true;
      }
      if (changed) {
        photos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        refreshAfterSync();
      }
      status = 'idle'; lastError = '';
      saveJSON('lastSyncAt', Date.now());
      if (manual) showToast('Everything is synced', 'success');
    } catch (e) {
      console.warn('Sync failed', e);
      status = 'error'; lastError = e.message;
      if (manual) showToast('Sync failed: ' + e.message, 'danger');
    } finally {
      running = false;
      progress = null;
      updateDot();
    }
  }

  // Photos coming from the cloud keep only the small preview on this phone. The full photo is
  // fetched when the engineer asks for it (save to phone, save to Drive, share, report).
  async function mergePhotos(list, fromTeam) {
    let changed = false;
    for (const rp of list) {
      const local = photos.find(x => x.id === rp.id);
      // Markers left in the own / company space when a project moved to a team are ignored
      const movedToTeam = !fromTeam && local && (projectOf(local) || {}).team;
      if (rp.deleted) { if (local && !movedToTeam) { photos = photos.filter(x => x.id !== rp.id); await DB.delPhoto(rp.id); changed = true; } continue; }
      if (local && (local.updatedAt || 0) >= rp.updatedAt) continue;
      const rec = normPhoto(Object.assign({}, local || {}, rp, { synced: true, uploaded: true }));
      if (!rec.imageData) { rec.imageData = rec.thumb || ''; rec.previewOnly = true; }
      await DB.save(rec);
      if (local) Object.assign(local, rec); else photos.push(rec);
      changed = true;
    }
    return changed;
  }

  async function pullTeams(token) {
    const me = profile.email.toLowerCase();
    const rows = await api('POST', `${root()}:runQuery`, token, { structuredQuery: {
      from: [{ collectionId: 'teams' }],
      where: { fieldFilter: { field: { fieldPath: 'members' }, op: 'ARRAY_CONTAINS', value: { stringValue: me } } },
      limit: 300
    } });
    const teams = rows.filter(r => r.document).map(r => decFields(r.document.fields || {}));
    let changed = false;
    const ids = new Set();
    for (const t of teams) {
      ids.add(t.id);
      const local = projects.find(x => x.id === t.id);
      if (t.deleted) { if (local) { await removeProjectLocally(local); changed = true; } continue; }
      if (!local || (local.updatedAt || 0) < (t.updatedAt || 0) || !local.team) {
        const rec = Object.assign({}, local || {}, t, { team: true, synced: true });
        await DB.put('projects', rec);
        if (local) Object.assign(local, rec); else projects.push(rec);
        changed = true;
      }
      const key = 'lastPull_team_' + t.id;
      const since = loadJSON(key, 0);
      const list = await query('photos', since, token, `teams/${enc1(t.id)}`);
      if (await mergePhotos(list, true)) changed = true;
      saveJSON(key, list.reduce((m, p) => Math.max(m, p.updatedAt || 0), since));
    }
    // Taken off a team by its owner: drop the project from this phone (own unsent photos stay)
    for (const pj of projects.filter(x => x.team && x.synced && !ids.has(x.id) && (x.owner || '') !== me)) {
      await removeProjectLocally(pj, true);
      showToast(`You are no longer in the team for ${pj.name}`, '');
      changed = true;
    }
    return changed;
  }

  async function removeProjectLocally(pj, keepUnsent) {
    for (const ph of photos.filter(p => p.projectId === pj.id && !(keepUnsent && !p.synced))) await DB.delPhoto(ph.id);
    photos = photos.filter(p => p.projectId !== pj.id || (keepUnsent && !p.synced));
    projects = projects.filter(x => x.id !== pj.id);
    await DB.del('projects', pj.id);
  }

  // Header badge, camera chip, gallery badges and the sync sheet all read from here
  function updateDot() {
    const pill = document.getElementById('sync-pill');
    const cam = document.getElementById('cam-sync');
    const n = pending();
    let cls, text;
    if (!enabled()) { cls = 'local'; text = 'On phone'; }
    else if (running && progress) { cls = 'syncing'; text = `Uploading ${progress.done}/${progress.total}`; }
    else if (status === 'offline' || !navigator.onLine) { cls = 'offline'; text = n.photos ? `Offline · ${n.photos} waiting` : 'Offline'; }
    else if (status === 'waitwifi') { cls = 'offline'; text = `Waiting for Wi-Fi · ${n.photos}`; }
    else if (status === 'error') { cls = 'error'; text = 'Sync problem'; }
    else if (n.photos || n.details) { cls = 'waiting'; text = `${n.photos + n.details} waiting`; }
    else { cls = 'idle'; text = 'Synced'; }
    if (pill) { pill.className = 'sync-pill ' + cls; pill.querySelector('span').textContent = text; pill.title = statusText(); }
    if (cam) {
      const show = enabled() && (n.photos > 0 || cls === 'error');
      cam.style.display = show ? '' : 'none';
      cam.className = 'cam-sync ' + cls;
      cam.querySelector('span').textContent = cls === 'syncing' ? `${progress.done}/${progress.total}` : `${n.photos}`;
    }
    if (document.getElementById('sync-sheet') && document.getElementById('sync-sheet').classList.contains('open')) renderSyncSheet();
  }

  function statusText() {
    if (!enabled()) return 'Not syncing';
    const at = loadJSON('lastSyncAt', 0);
    if (status === 'syncing') return 'Syncing…';
    if (status === 'error') return 'Sync problem: ' + lastError;
    if (status === 'offline') return 'Offline — will sync later';
    if (status === 'waitwifi') return 'Waiting for Wi-Fi to upload photos';
    return at ? 'Synced ' + fmtTime(at) : 'Not synced yet';
  }

  window.addEventListener('online', () => { status = 'idle'; updateDot(); schedule(); });
  window.addEventListener('offline', () => { status = 'offline'; updateDot(); });
  if (navigator.connection && navigator.connection.addEventListener) {
    navigator.connection.addEventListener('change', () => { if (status === 'waitwifi' && onWifi()) schedule(); });
  }
  return { schedule, now, markDeleted, updateDot, statusText, enabled, pending, lastError: () => lastError, photoPath, projectPath, orgPath, putAt, root, downloadImage };
})();

function refreshAfterSync() {
  if (document.getElementById('projects-screen').style.display !== 'none') renderProjectList();
  if (currentProject) {
    const fresh = projects.find(p => p.id === currentProject.id);
    if (!fresh) { showProjects(); return; }
    currentProject = fresh;
    applyProjectToUI();
    if (currentTab === 'gallery') renderGallery();
    if (currentTab === 'chainage') renderStrip();
    if (currentTab === 'hindrance') renderHindrances();
  }
}

// ============================================================
// BACKUP SHEET: what is safe in the cloud, what is still only on this phone
// ============================================================
function openSyncSheet() {
  renderSyncSheet();
  openSheet('sync-sheet');
}

function renderSyncSheet() {
  const on = Sync.enabled();
  const n = Sync.pending();
  const pill = document.getElementById('sync-pill');
  const cls = pill ? pill.className.replace('sync-pill', '').trim() : '';
  const total = photos.length;
  const where = typeof Drive !== 'undefined' && Drive.enabled() ? 'your Google Drive' : 'the cloud';
  document.getElementById('sync-state').className = 'sync-state ' + cls;
  document.getElementById('sync-state').innerHTML = !on
    ? `<b>Photos are only on this phone</b><span>If the phone is lost or reset, they are gone. Sign in to back them up to ${where}.</span>`
    : `<b>${esc(Sync.statusText())}</b><span>${n.photos ? `${n.photos} photo${n.photos === 1 ? '' : 's'} not backed up yet. They are safe on the phone and upload by themselves when there is a connection.` : `All photos are backed up to ${where}.`}</span>`;
  document.getElementById('sync-counts').innerHTML = on ? `
    <div class="hs-box"><b>${total - n.photos}</b><span>backed up</span></div>
    <div class="hs-box ${n.photos ? 'warn' : ''}"><b>${n.photos}</b><span>photos waiting</span></div>
    <div class="hs-box"><b>${n.details}</b><span>changes waiting</span></div>` : '';
  const waiting = n.list.filter(p => !p.uploaded).slice(0, 24);
  document.getElementById('sync-waiting').innerHTML = on && waiting.length
    ? `<div class="section-title">Waiting to upload</div><div class="sw-grid">${waiting.map(p => `<button onclick="closeSheet('sync-sheet');openPhotoModal('${p.id}')"><img src="${p.imageData}" alt=""></button>`).join('')}</div>` : '';
  document.getElementById('sync-wifi').checked = !!loadJSON('syncWifiOnly', false);
  document.getElementById('sync-wifi').closest('.toggle-row').style.display = on ? '' : 'none';
  document.getElementById('sync-now-btn').style.display = on ? '' : 'none';
  document.getElementById('sync-now-btn').disabled = !navigator.onLine;
  document.getElementById('sync-signin-btn').style.display = on ? 'none' : '';
}

// ============================================================
// AI (runs in the cloud function, so no API key sits in the app)
// ============================================================
const AI = (() => {
  function available() { return !!CONFIG.aiEndpoint && Account.available() && Account.isSignedIn() && navigator.onLine; }
  async function call(task, payload) {
    const token = await Account.getToken();
    const r = await fetch(CONFIG.aiEndpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ task }, payload))
    });
    if (!r.ok) throw new Error('AI ' + r.status);
    return r.json();
  }
  return { available, call };
})();
