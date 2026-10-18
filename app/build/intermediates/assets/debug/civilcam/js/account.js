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
  const base = () => `https://firestore.googleapis.com/v1/projects/${CONFIG.firebase.projectId}/databases/(default)/documents/orgs/${encodeURIComponent(Account.orgId())}`;

  function enabled() { return Account.available() && Account.isSignedIn(); }

  function schedule() {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(() => now(), 3000);
  }

  function markDeleted(coll, id) {
    const q = loadJSON('pendingDeletes', []);
    q.push({ coll, id });
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

  async function query(coll, since, token) {
    const out = [];
    let cursor = since;
    for (;;) {
      const rows = await api('POST', `${base()}:runQuery`, token, { structuredQuery: {
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
  async function now(manual) {
    if (!enabled()) { if (manual) showToast('Sign in to sync', 'danger'); return; }
    if (running) return;
    if (!navigator.onLine) { status = 'offline'; updateDot(); return; }
    running = true; status = 'syncing'; updateDot();
    try {
      const token = await Account.getToken();

      // 1. send what changed here
      for (const pj of (await DB.getAll('projects')).filter(x => !x.synced)) {
        const data = Object.assign({}, pj); delete data.synced;
        await putDoc('projects', pj.id, data, token);
        pj.synced = true; await DB.put('projects', pj);
        const mem = projects.find(x => x.id === pj.id);
        if (mem) mem.synced = true;
      }
      for (const op of (await DB.getAll('options')).filter(x => !x.synced)) {
        await putDoc('options', op.key, { key: op.key, values: op.values, updatedAt: op.updatedAt }, token);
        op.synced = true; await DB.put('options', op);
      }
      for (const p of photos.filter(x => !x.synced && x.imageData)) {
        if (!p.uploaded) { await uploadImage(p, token); p.uploaded = true; }
        const data = Object.assign({}, p); delete data.imageData; delete data.synced;
        await putDoc('photos', p.id, data, token);
        p.synced = true; await DB.save(p);
      }
      const dels = loadJSON('pendingDeletes', []);
      for (const d of dels) await putDoc(d.coll, d.id, { id: d.id, deleted: true, updatedAt: Date.now() }, token);
      saveJSON('pendingDeletes', []);

      // 2. bring in what colleagues (or this account on another phone) changed
      const since = loadJSON('lastPull_' + Account.orgId(), 0);
      let newest = since, changed = false;
      for (const pj of await query('projects', since, token)) {
        newest = Math.max(newest, pj.updatedAt || 0);
        const local = projects.find(x => x.id === pj.id);
        if (pj.deleted) { if (local) { projects = projects.filter(x => x.id !== pj.id); await DB.del('projects', pj.id); changed = true; } continue; }
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
      for (const rp of await query('photos', since, token)) {
        newest = Math.max(newest, rp.updatedAt || 0);
        const local = photos.find(x => x.id === rp.id);
        if (rp.deleted) { if (local) { photos = photos.filter(x => x.id !== rp.id); await DB.delPhoto(rp.id); changed = true; } continue; }
        if (local && (local.updatedAt || 0) >= rp.updatedAt) continue;
        const rec = normPhoto(Object.assign({}, local || {}, rp, { synced: true, uploaded: true }));
        if (!rec.imageData) {
          try { rec.imageData = await downloadImage(rp.id, token); } catch (e) { continue; }
        }
        await DB.save(rec);
        if (local) Object.assign(local, rec); else photos.push(rec);
        changed = true;
      }
      saveJSON('lastPull_' + Account.orgId(), newest);
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
      updateDot();
    }
  }

  function updateDot() {
    const dot = document.getElementById('sync-dot');
    if (!dot) return;
    dot.className = 'sync-dot ' + (enabled() ? status : 'off');
    dot.title = statusText();
  }

  function statusText() {
    if (!enabled()) return 'Not syncing';
    const at = loadJSON('lastSyncAt', 0);
    if (status === 'syncing') return 'Syncing…';
    if (status === 'error') return 'Sync problem: ' + lastError;
    if (status === 'offline') return 'Offline — will sync later';
    return at ? 'Synced ' + fmtTime(at) : 'Not synced yet';
  }

  window.addEventListener('online', () => schedule());
  return { schedule, now, markDeleted, updateDot, statusText, enabled };
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
  }
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
