// ============================================================
// DELETE ACCOUNT AND CLOUD DATA (Account sheet)
// Google Play requires apps with sign-in to let people delete their account in the app.
// Deleted: personal projects / photo details / previews / lists; in a company space only the
// photos this engineer took; team projects they own (for everyone) and their photos in other
// teams (and they leave those teams); then the sign-in account itself.
// Kept: everything on this phone, and full photos in their own Google Drive / OneDrive.
// The same is explained at funpixelnest.com/civilcam/delete-account.html
// ============================================================
async function deleteMyAccount() {
  if (!Account.isSignedIn()) { showToast('You are not signed in'); return; }
  const typed = await askText('Delete account and cloud data?',
    'This deletes your CivilCam account, your projects and photo details in the cloud, and team projects you own (for everyone in them). Photos on this phone and full photos in your own Google Drive / OneDrive are kept. Type DELETE to confirm.');
  if (!typed || typed.trim().toUpperCase() !== 'DELETE') return;
  closeSheet('account-sheet');
  showLoading('Deleting your cloud data…', '');
  try {
    const token = await Account.getToken();
    const R = Sync.root();
    const auth = { Authorization: 'Bearer ' + token };
    const me = (profile.email || '').toLowerCase();
    const relName = d => d.name.split('/documents/')[1];
    const takenByMe = d => {
      const e = d.fields && d.fields.engineer && d.fields.engineer.mapValue && d.fields.engineer.mapValue.fields &&
        d.fields.engineer.mapValue.fields.email;
      return !!e && String(e.stringValue || '').toLowerCase() === me;
    };
    async function list(path) {
      const out = [];
      let page = '';
      do {
        const r = await fetch(`${R}/${path}?pageSize=300&mask.fieldPaths=engineer${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, { headers: auth });
        if (r.status === 404 || r.status === 403) break;
        if (!r.ok) throw new Error('Cloud ' + r.status);
        const j = await r.json();
        (j.documents || []).forEach(d => out.push(d));
        page = j.nextPageToken || '';
      } while (page);
      return out;
    }
    async function del(path) {
      const r = await fetch(`${R}/${path}`, { method: 'DELETE', headers: auth });
      if (!r.ok && r.status !== 404) throw new Error('Cloud ' + r.status);
    }

    // 1. own or company space
    const org = Sync.orgPath();
    const personal = Account.orgId().startsWith('u_');
    let n = 0;
    for (const coll of ['photos', 'projects', 'options']) {
      if (!personal && coll !== 'photos') continue;     // company projects and lists stay for colleagues
      for (const d of await list(`${org}/${coll}`)) {
        if (personal || takenByMe(d)) { await del(relName(d)); setLoadingSub(`${++n} removed`); }
      }
    }

    // 2. team projects
    for (const pj of projects.filter(p => p.team)) {
      const tp = `teams/${encodeURIComponent(pj.id)}`;
      const owner = (pj.owner || '').toLowerCase() === me;
      for (const d of await list(`${tp}/photos`)) {
        if (owner || takenByMe(d)) { await del(relName(d)); setLoadingSub(`${++n} removed`); }
      }
      if (owner) await del(tp);
      else {
        const data = Object.assign({}, pj, { members: (pj.members || []).filter(e => e !== me), updatedAt: Date.now() });
        delete data.synced;
        try { await Sync.putAt(tp, data, token); } catch (e) { console.warn('Leave team', e); }
      }
    }

    // 3. the sign-in account
    setLoadingSub('Deleting the account');
    const res = await new Promise((resolve) => {
      window.onNativeAccountDeleted = (ok, err) => resolve({ ok, err });
      if (hasAndroidBridge() && typeof window.AndroidBridge.deleteAccount === 'function') window.AndroidBridge.deleteAccount();
      else resolve({ ok: false, err: 'Account deletion needs the Android app' });
      setTimeout(() => resolve({ ok: false, err: 'No answer' }), 30000);
    });
    hideLoading();
    if (!res.ok && res.err === 'relogin') {
      showToast('Your cloud data is deleted. For safety, sign in once more, then tap Delete account again to finish.', '');
      Account.signIn(/microsoft/i.test(profile.provider) ? 'microsoft' : /apple/i.test(profile.provider) ? 'apple' : 'google');
      return;
    }
    if (!res.ok) { showToast('Cloud data deleted, but the account could not be deleted: ' + res.err + '. E-mail info@funpixelnest.com and we will finish it.', 'danger'); return; }

    // 4. this phone: forget the account; photos stay
    for (const pj of projects.filter(p => p.team)) {
      for (const ph of photos.filter(x => x.projectId === pj.id && x.previewOnly)) await DB.delPhoto(ph.id);
    }
    photos = photos.filter(x => !(x.previewOnly));
    photos.forEach(p => { p.synced = false; p.uploaded = false; });
    for (const p of photos) await DB.save(p);
    profile.uid = ''; profile.email = ''; profile.provider = '';
    saveJSON('profile', profile);
    saveJSON('authChoice', 'offline');
    saveJSON('photoStore', ''); saveJSON('driveBackup', false); saveJSON('driveFolders', {});
    saveJSON('pendingDeletes', []);
    Sync.updateDot();
    showToast('Your account and cloud data are deleted. Photos on this phone are kept.', 'success');
    showProjects();
  } catch (e) {
    hideLoading();
    showToast('Could not delete everything: ' + e.message + '. Try again, or e-mail info@funpixelnest.com.', 'danger');
  }
}
