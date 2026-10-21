// ============================================================
// ONEDRIVE STORAGE (Microsoft accounts)
// Same job as drive.js, for engineers who use Microsoft: full photos go to
// OneDrive › Apps › CivilCam Pro › <project> in the engineer's own OneDrive.
// The app can only see that folder (Files.ReadWrite.AppFolder).
// The shared database keeps only the details, the file id and a small preview.
// ============================================================
const OneDrive = (() => {
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const SIMPLE_MAX = 4 * 1024 * 1024;     // larger files go up in pieces
  let token = null, tokenAt = 0, reqNo = 0;
  const reqs = {};

  function supported() {
    return hasAndroidBridge() && typeof window.AndroidBridge.getOneDriveToken === 'function' &&
      (typeof window.AndroidBridge.oneDriveAvailable !== 'function' || window.AndroidBridge.oneDriveAvailable());
  }
  function enabled() {
    return supported() && Account.isSignedIn() && loadJSON('photoStore', '') === 'onedrive';
  }

  window.onNativeOneDriveToken = function (id, tok, err, account) {
    const r = reqs[id];
    if (!r) return;
    delete reqs[id];
    if (tok) {
      if (account && account.username) saveJSON('oneDriveAccount', account.username);
      r.res(tok);
    } else r.rej(new Error(err || 'No OneDrive access'));
  };

  function getToken(interactive) {
    if (token && Date.now() - tokenAt < 45 * 60 * 1000) return Promise.resolve(token);
    return new Promise((res, rej) => {
      const id = 'o' + (++reqNo);
      reqs[id] = { res, rej };
      const hint = /microsoft/i.test(profile.provider || '') ? (profile.email || '') : '';
      window.AndroidBridge.getOneDriveToken(id, !!interactive, hint);
      setTimeout(() => { if (reqs[id]) { delete reqs[id]; rej(new Error('OneDrive did not answer')); } }, interactive ? 180000 : 30000);
    }).then(t => { token = t; tokenAt = Date.now(); return t; });
  }

  async function api(method, url, body, headers = {}) {
    let t = await getToken(window.cloudPromptAllowed === true);
    const send = () => fetch(url, { method, headers: Object.assign({ Authorization: 'Bearer ' + t }, headers), body });
    let r = await send();
    if (r.status === 401) { token = null; t = await getToken(false); r = await send(); }
    if (!r.ok) {
      let msg = 'OneDrive ' + r.status;
      try { const j = await r.json(); if (j.error && j.error.message) msg += ': ' + j.error.message; } catch (e) {}
      throw new Error(msg);
    }
    return r;
  }

  // OneDrive does not allow these in names: " * : < > ? / \ |
  function safeName(s) { return String(s || 'Photos').replace(/["*:<>?\/\\|#%]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Photos'; }
  function itemPath(p) {
    const proj = projects.find(x => x.id === p.projectId);
    return encodeURIComponent(safeName(proj ? proj.name : 'Photos')) + '/' + encodeURIComponent(safeName(photoFileName(p)));
  }

  // Uploads one photo; returns { id, webViewLink } like Drive.upload
  async function upload(p) {
    const blob = await (await fetch(p.imageData)).blob();
    const path = `${GRAPH}/me/drive/special/approot:/${itemPath(p)}`;
    let item;
    if (blob.size <= SIMPLE_MAX) {
      item = await (await api('PUT', `${path}:/content?@microsoft.graph.conflictBehavior=rename`, blob, { 'Content-Type': 'image/jpeg' })).json();
    } else {
      const s = await (await api('POST', `${path}:/createUploadSession`,
        JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }), { 'Content-Type': 'application/json' })).json();
      const CHUNK = 320 * 1024 * 10;     // a multiple of 320 KB, as OneDrive asks
      for (let start = 0; start < blob.size; start += CHUNK) {
        const end = Math.min(start + CHUNK, blob.size);
        const r = await fetch(s.uploadUrl, { method: 'PUT', body: blob.slice(start, end),
          headers: { 'Content-Range': `bytes ${start}-${end - 1}/${blob.size}` } });
        if (!r.ok && r.status !== 202) throw new Error('OneDrive upload ' + r.status);
        if (end === blob.size) item = await r.json();
      }
    }
    // Keep the photo details with the file, so they show in OneDrive too
    try {
      await api('PATCH', `${GRAPH}/me/drive/items/${encodeURIComponent(item.id)}`,
        JSON.stringify({ description: Drive.describe(p).slice(0, 1000) }), { 'Content-Type': 'application/json' });
    } catch (e) { /* the description is only a nicety */ }
    return { id: item.id, webViewLink: item.webUrl || '' };
  }

  async function download(fileId) {
    const r = await api('GET', `${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}/content`);
    return 'data:image/jpeg;base64,' + await blobToBase64(await r.blob());
  }

  // Team projects: a view-only link, stored only in the team's project.
  // Company OneDrives may not allow "anyone" links; then the link works inside that company.
  async function shareByLink(fileId) {
    for (const scope of ['anonymous', 'organization']) {
      try {
        const r = await api('POST', `${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}/createLink`,
          JSON.stringify({ type: 'view', scope }), { 'Content-Type': 'application/json' });
        const j = await r.json();
        if (j.link && j.link.webUrl) return j.link.webUrl;
      } catch (e) { if (scope === 'organization') throw e; }
    }
    return '';
  }

  function shareToken(url) {
    const b64 = btoa(unescape(encodeURIComponent(url))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    return 'u!' + b64;
  }

  async function toData(r) {
    const blob = await r.blob();
    if (!/^image\//.test(blob.type) && blob.size < 20000) throw new Error('The photo is not shared yet');
    return 'data:image/jpeg;base64,' + await blobToBase64(blob);
  }

  // A colleague's full photo, from the link they shared
  async function fetchShared(p) {
    const url = p.shareUrl;
    if (!url) throw new Error('The photo is not shared yet');
    const tok = shareToken(url);
    // 1. Personal OneDrive links open without signing in
    try {
      const r = await fetch(`https://api.onedrive.com/v1.0/shares/${tok}/root/content`);
      if (r.ok) return await toData(r);
    } catch (e) {}
    // 2. With this engineer's own OneDrive connected, Microsoft Graph can open any link they may see
    if (enabled()) {
      try {
        const r = await api('GET', `${GRAPH}/shares/${tok}/driveItem/content`, undefined, { Prefer: 'redeemSharingLinkIfNecessary' });
        return await toData(r);
      } catch (e) {}
    }
    // 3. Company links: ask for the file itself
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'download=1');
    if (!r.ok) throw new Error('OneDrive ' + r.status);
    return await toData(r);
  }

  async function connect() {
    if (!supported()) { showToast('OneDrive needs the Android app', 'danger'); return; }
    if (!Account.isSignedIn()) { showToast('Sign in first to keep photos in OneDrive', 'danger'); return; }
    try {
      token = null;
      await getToken(true);
      saveJSON('photoStore', 'onedrive');
      saveJSON('driveBackup', false);
      const who = loadJSON('oneDriveAccount', '');
      showToast(`Photos will be kept in ${who ? who + "'s " : 'your '}OneDrive › Apps › CivilCam Pro`, 'success');
      photos.filter(p => !p.driveId && p.imageData && !p.previewOnly).forEach(p => { p.uploaded = false; p.synced = false; });
      refreshDriveRow();
      Sync.now();
    } catch (e) {
      if (!/cancel/i.test(e.message)) showToast('Could not connect OneDrive: ' + e.message, 'danger');
    }
  }

  function disconnect() {
    saveJSON('photoStore', '');
    token = null;
    if (hasAndroidBridge() && typeof window.AndroidBridge.oneDriveSignOut === 'function') window.AndroidBridge.oneDriveSignOut();
    showToast('OneDrive is off. New photos stay on this phone; photos already in OneDrive stay there.');
    refreshDriveRow();
  }

  return { key: 'onedrive', label: 'OneDrive', folder: 'OneDrive › Apps › CivilCam Pro',
    supported, enabled, upload, download, shareByLink, fetchShared, connect, disconnect };
})();

// ------------------------------------------------------------
// Which cloud keeps the full photos: Google Drive or OneDrive
// ------------------------------------------------------------
const PhotoStore = {
  // The one new photos go to (or null: they stay on the phone / company storage)
  active() {
    if (OneDrive.enabled()) return OneDrive;
    if (Drive.enabled()) return Drive;
    return null;
  },
  // The one a photo is in
  of(p) { return p && p.store === 'onedrive' ? OneDrive : Drive; },
  // For text: "your OneDrive", "Ravi's Google Drive"
  where(p, whose) { return `${whose || 'your'} ${PhotoStore.of(p).label}`; },
  activeLabel() { const s = PhotoStore.active(); return s ? s.label : ''; }
};
