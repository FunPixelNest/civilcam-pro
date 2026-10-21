// ============================================================
// GOOGLE DRIVE BACKUP
// Full photos go to a "CivilCam / <project>" folder in the engineer's own
// Google Drive. The shared database keeps only the text details, the Drive
// link and a small preview, so it stays small and cheap.
// The app asks for "drive.file" access: it can only see files it created.
// ============================================================
const Drive = (() => {
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  let token = null, tokenAt = 0, reqNo = 0;
  const reqs = {};

  // The phone build can ask Google for Drive access
  function supported() {
    return hasAndroidBridge() && typeof window.AndroidBridge.getDriveToken === 'function';
  }
  // Drive backup is used once turned on. Any signed-in engineer can use it: people who sign in
  // with Microsoft or Apple simply pick a Google account for the backup.
  function enabled() {
    return supported() && Account.isSignedIn() && loadJSON('driveBackup', false);
  }

  window.onNativeDriveToken = function (id, tok, err) {
    const r = reqs[id];
    if (!r) return;
    delete reqs[id];
    if (tok) r.res(tok); else r.rej(new Error(err || 'No Drive access'));
  };

  // interactive = true shows Google's "Allow CivilCam to use Drive" screen if needed
  function getToken(interactive) {
    if (token && Date.now() - tokenAt < 45 * 60 * 1000) return Promise.resolve(token);
    return new Promise((res, rej) => {
      const id = 'd' + (++reqNo);
      reqs[id] = { res, rej };
      window.AndroidBridge.getDriveToken(id, !!interactive);
      setTimeout(() => { if (reqs[id]) { delete reqs[id]; rej(new Error('Drive did not answer')); } }, interactive ? 180000 : 30000);
    }).then(t => { token = t; tokenAt = Date.now(); return t; });
  }

  async function api(method, url, body, headers = {}) {
    let t = await getToken(false);
    const send = () => fetch(url, { method, headers: Object.assign({ Authorization: 'Bearer ' + t }, headers), body });
    let r = await send();
    if (r.status === 401) { token = null; t = await getToken(false); r = await send(); }   // token expired
    if (!r.ok) throw new Error('Drive ' + r.status);
    return r;
  }

  // Finds or creates a folder; ids are remembered on the phone
  async function folder(name, parent = 'root') {
    const cache = loadJSON('driveFolders', {});
    const key = parent + '/' + name;
    if (cache[key]) return cache[key];
    const safe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name='${safe}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent}' in parents`;
    const found = await (await api('GET', `${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`)).json();
    let id = found.files && found.files[0] && found.files[0].id;
    if (!id) {
      const made = await api('POST', `${API}/files?fields=id`,
        JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
        { 'Content-Type': 'application/json' });
      id = (await made.json()).id;
    }
    cache[key] = id;
    saveJSON('driveFolders', cache);
    return id;
  }

  function describe(p) {
    return [
      p.activity,
      p.element,
      chainageText(p) ? 'Chainage ' + chainageText(p) : '',
      p.side,
      `${p.displayDate} ${p.displayTime}`,
      p.description,
    ].filter(Boolean).join(' | ');
  }

  // Uploads one photo; returns { id, webViewLink }
  async function upload(p) {
    const proj = projects.find(x => x.id === p.projectId);
    const root = await folder('CivilCam');
    const dir = await folder(proj ? (proj.name || 'Project') : 'Photos', root);
    const meta = { name: photoFileName(p), parents: [dir], description: describe(p), appProperties: { civilcamId: p.id } };
    const blob = await (await fetch(p.imageData)).blob();
    const boundary = 'civilcam' + Date.now();
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`, blob, `\r\n--${boundary}--`
    ]);
    const r = await api('POST', `${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, body,
      { 'Content-Type': `multipart/related; boundary=${boundary}` });
    return r.json();
  }

  // Full photo back from Drive (works for the engineer's own photos, on any phone)
  async function download(fileId) {
    const r = await api('GET', `${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return 'data:image/jpeg;base64,' + await blobToBase64(await r.blob());
  }

  // Team projects: anyone with the link can view (the link itself is only stored in the team's
  // project, which only its members can read). Works with the narrow drive.file access.
  async function shareByLink(fileId) {
    await api('POST', `${API}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false`,
      JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }), { 'Content-Type': 'application/json' });
  }

  // A colleague's full photo, shared by link: no sign-in needed
  async function fetchShared(fileId) {
    const r = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`);
    if (!r.ok) throw new Error('Drive ' + r.status);
    const blob = await r.blob();
    if (!/^image\//.test(blob.type) && blob.size < 20000) throw new Error('The photo is not shared yet');
    return 'data:image/jpeg;base64,' + await blobToBase64(blob);
  }

  // Called from the Account sheet: asks for permission once, then backs up
  async function connect() {
    if (!supported()) { showToast('Drive backup needs the Android app', 'danger'); return; }
    if (!Account.isSignedIn()) {
      showToast('Sign in first to back up to Google Drive', 'danger');
      return;
    }
    try {
      token = null;
      await getToken(true);
      saveJSON('driveBackup', true);
      showToast('Photos will be backed up to your Google Drive, folder CivilCam', 'success');
      photos.filter(p => !p.driveId && p.imageData && !p.previewOnly).forEach(p => { p.uploaded = false; p.synced = false; });
      refreshDriveRow();
      Sync.now();
    } catch (e) {
      if (!/cancel/i.test(e.message)) showToast('Could not turn on Drive backup: ' + e.message, 'danger');
    }
  }

  function disconnect() {
    saveJSON('driveBackup', false);
    token = null;
    showToast('Drive backup is off. New photos stay on this phone.');
    refreshDriveRow();
  }

  return { supported, enabled, upload, download, shareByLink, fetchShared, connect, disconnect };
})();

// The Drive row on the Account sheet
function refreshDriveRow() {
  const btn = document.getElementById('ac-drive'), note = document.getElementById('ac-drive-note');
  if (!btn) return;
  const google = /google/i.test(profile.provider || '');
  btn.style.display = Drive.supported() && Account.isSignedIn() ? '' : 'none';
  note.style.display = btn.style.display;
  if (Drive.enabled()) {
    const left = photos.filter(p => p.imageData && !p.previewOnly && !p.driveId).length;
    btn.innerHTML = ic('cloud', 18) + 'Stop backing up to Google Drive';
    note.textContent = left ? `${left} photos waiting to upload to Drive › CivilCam.` : 'All photos are in your Google Drive › CivilCam.';
  } else {
    btn.innerHTML = ic('cloud', 18) + 'Back up photos to my Google Drive';
    note.textContent = (google ? '' : 'You can use any Google account for this, even though you signed in with ' + (/microsoft/i.test(profile.provider) ? 'Microsoft' : /apple/i.test(profile.provider) ? 'Apple' : 'another account') + '. ') +
      'Full photos go to your own Drive (free 15 GB). The company database keeps only details and a small preview.';
  }
}

// Small preview kept in the shared database so colleagues can see what a photo shows
async function makePreview(dataUrl) {
  const s = await shrinkImage(dataUrl, 320);
  return s ? s.data : '';
}

function openDriveLink(p) {
  if (!p || !p.driveLink) return;
  if (hasAndroidBridge() && typeof window.AndroidBridge.openLink === 'function') window.AndroidBridge.openLink(p.driveLink);
  else window.open(p.driveLink, '_blank');
}
