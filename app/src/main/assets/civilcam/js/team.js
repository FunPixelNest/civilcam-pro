// ============================================================
// TEAM PROJECTS AND FULL PHOTOS ON REQUEST
// A project can be shared with other engineers by e-mail. Everyone in the team sees all the
// team's photos: the details and a small preview arrive by themselves; the full photo stays in
// the Google Drive of the engineer who took it and is only downloaded when someone asks:
// save to this phone, save to my own Drive, share, or put it in a report.
// ============================================================
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const fullCache = new Map();          // photo id -> full photo, for this session only
let sheetMembers = [];                // team list while the project sheet is open

function myEmail() { return (profile.email || '').toLowerCase(); }
function teamOwner(p) { return !p || !p.team || (p.owner || '') === myEmail(); }
function teamCount(p) { return p && p.team ? (p.members || []).length : 0; }
function takenByOther(ph) { return !!(ph.engineer && ph.engineer.email && myEmail() && ph.engineer.email.toLowerCase() !== myEmail()); }

// ---------- the Team part of the project sheet ----------
function renderTeamBlock(p) {
  const block = document.getElementById('pj-team-block');
  if (!block) return;
  sheetMembers = p && p.team ? (p.members || []).slice() : (myEmail() ? [myEmail()] : []);
  drawTeamBlock(p);
}

function drawTeamBlock(p) {
  const signedIn = Sync.enabled() && !!myEmail();
  const owner = teamOwner(p);
  const hint = document.getElementById('pj-team-hint');
  const signBtn = document.getElementById('pj-team-signin');
  if (signBtn) signBtn.style.display = signedIn ? 'none' : '';
  document.getElementById('pj-team-add').style.display = signedIn && owner ? '' : 'none';
  document.getElementById('pj-team-invite').style.display = signedIn && sheetMembers.length > 1 ? '' : 'none';
  document.getElementById('pj-team-leave').style.display = signedIn && p && p.team && !owner ? '' : 'none';
  if (!signedIn) {
    hint.textContent = 'To add engineers, sign in first. Then type each engineer\'s sign-in e-mail here; everyone in the team sees all the photos of this project.';
    document.getElementById('pj-team-list').innerHTML = '';
    return;
  }
  hint.textContent = owner
    ? 'Add the e-mail each engineer signs in with. They see this project and all its photos; full photos open from the Google Drive or OneDrive of whoever took them.'
    : `Shared by ${p.owner}. Only the owner can add or remove engineers.`;
  document.getElementById('pj-team-list').innerHTML = sheetMembers.map(e => `
    <div class="team-row">
      <span class="team-av">${esc(e[0].toUpperCase())}</span>
      <span class="team-mail">${esc(e)}${e === myEmail() ? ' <em>you</em>' : ''}${p && p.team && e === p.owner ? ' <em>owner</em>' : ''}</span>
      ${owner && e !== myEmail() ? `<button class="icon-btn" onclick="removeTeamMember('${esc(e)}')" aria-label="Remove ${esc(e)}">${ic('x', 16)}</button>` : ''}
    </div>`).join('');
}

function addTeamMember() {
  const input = document.getElementById('pj-team-email');
  const e = input.value.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) { showToast('Type a full e-mail address', 'danger'); input.focus(); return; }
  if (sheetMembers.includes(e)) { showToast('Already in the team'); return; }
  if (sheetMembers.length >= 50) { showToast('A team can have up to 50 engineers', 'danger'); return; }
  if (!sheetMembers.includes(myEmail())) sheetMembers.unshift(myEmail());
  sheetMembers.push(e);
  input.value = '';
  drawTeamBlock(editingProject);
}

function removeTeamMember(e) {
  sheetMembers = sheetMembers.filter(x => x !== e);
  drawTeamBlock(editingProject);
}

// Called by saveProjectFromSheet(): adds the team fields; returns true if the project just became a team project
function applyTeamToProject(proj, wasTeam) {
  if (!Sync.enabled() || !myEmail()) return false;
  if (!teamOwner(proj) && proj.team) return false;          // only the owner changes the list
  const others = sheetMembers.filter(e => e !== myEmail());
  if (!proj.team && !others.length) return false;            // stays a personal / company project
  proj.team = true;
  proj.owner = proj.owner || myEmail();
  proj.members = [...new Set([myEmail(), ...sheetMembers])];
  return !wasTeam;
}

// A project that becomes a team project moves to the team space: everything is sent again there,
// and the old copies in the personal / company space are marked deleted.
async function moveProjectToTeam(proj) {
  Sync.markDeleted('projects', proj.id);
  for (const ph of photos.filter(x => x.projectId === proj.id)) {
    if (ph.synced || ph.uploaded) Sync.markDeleted('photos', ph.id);
    ph.synced = false; ph.updatedAt = Date.now();
    await DB.save(ph);
  }
}

function inviteTeam() {
  const p = editingProject || currentProject;
  const name = p ? p.name : 'our project';
  const text = `I've added you to "${name}" on CivilCam Pro, the site photo app. Install it from Google Play, sign in with the e-mail I added, and the project with all our site photos appears.`;
  const url = 'https://wa.me/?text=' + encodeURIComponent(text);
  if (hasAndroidBridge() && typeof window.AndroidBridge.openLink === 'function') window.AndroidBridge.openLink(url);
  else window.open(url, '_blank');
}

async function leaveTeam() {
  const p = editingProject;
  if (!p || !p.team) return;
  const ok = await askText('Leave this team?', `"${p.name}" and its photos are removed from this phone. Type LEAVE to confirm.`);
  if (!ok || ok.trim().toUpperCase() !== 'LEAVE') return;
  try {
    showLoading('Leaving the team…');
    const token = await Account.getToken();
    const data = Object.assign({}, p, { members: (p.members || []).filter(e => e !== myEmail()), updatedAt: Date.now() });
    delete data.synced;
    await Sync.putAt(Sync.projectPath(p), data, token);
    for (const ph of photos.filter(x => x.projectId === p.id)) await DB.delPhoto(ph.id);
    photos = photos.filter(x => x.projectId !== p.id);
    projects = projects.filter(x => x.id !== p.id);
    await DB.del('projects', p.id);
    hideLoading();
    closeSheet('project-sheet');
    currentProject = null;
    showProjects();
    showToast(`You left ${p.name}`);
  } catch (e) {
    hideLoading();
    showToast('Could not leave the team: ' + e.message, 'danger');
  }
}

// ---------- full photos, only when asked ----------
async function fullImageOf(p) {
  if (!p.previewOnly && p.imageData) return p.imageData;
  if (fullCache.has(p.id)) return fullCache.get(p.id);
  let data = null;
  const store = PhotoStore.of(p);
  if (p.driveId && p.driveOwner === profile.email && store.enabled()) data = await store.download(p.driveId);
  else if (p.driveId) data = await store.fetchShared(p);
  else if (CONFIG.firebase.storageBucket && Sync.enabled()) data = await Sync.downloadImage(p.id, await Account.getToken());
  if (!data) throw new Error(`The full photo is only on ${p.engineer && p.engineer.name ? p.engineer.name + "'s" : 'the other engineer\'s'} phone so far`);
  fullCache.set(p.id, data);
  return data;
}

// Full photos for a list; previews are used where the full one cannot be fetched
async function fullImages(list, label) {
  const need = list.filter(p => p.previewOnly);
  if (!need.length) return list;
  showLoading(label || 'Getting full photos…', '');
  let n = 0, missing = 0;
  const out = [];
  for (const p of list) {
    if (!p.previewOnly) { out.push(p); continue; }
    setLoadingSub(`${++n} of ${need.length}`);
    try { out.push(Object.assign({}, p, { imageData: await fullImageOf(p), previewOnly: false })); }
    catch (e) { missing++; out.push(p); }
  }
  hideLoading();
  if (missing) showToast(`${missing} photo${missing === 1 ? ' is' : 's are'} only a preview: the full photo is not in Drive yet`, '');
  return out;
}

// The "Full photo" button on a preview
async function fullPhotoActions(p) {
  if (!p) return;
  const opts = [['phone', 'Save to this phone (Pictures / CivilCam)']];
  const mine = PhotoStore.active();
  if (mine) opts.push(['drive', 'Save to my ' + mine.label]);
  opts.push(['keep', 'Keep the full photo in the app']);
  if (p.driveLink && !takenByOther(p)) opts.push(['open', 'Open in ' + PhotoStore.of(p).label]);
  const who = p.engineer && p.engineer.name ? p.engineer.name : 'another engineer';
  const choice = await askChoice('Full photo', `This is a small preview. The full photo is in ${PhotoStore.where(p, takenByOther(p) ? who + "'s" : 'your')} and is only downloaded if you choose.`, opts);
  if (!choice) return;
  if (choice === 'open') { openDriveLink(p); return; }
  try {
    showLoading('Getting the full photo…');
    const data = await fullImageOf(p);
    if (choice === 'phone') {
      hideLoading();
      savedMessage(await saveFile(data, photoFileName(p), 'image/jpeg'), 'Photo', 'image/jpeg');
    } else if (choice === 'drive') {
      setLoadingSub('Uploading to your Drive');
      await mine.upload(Object.assign({}, p, { imageData: data }));
      hideLoading();
      showToast('Saved in your ' + mine.folder, 'success');
    } else if (choice === 'keep') {
      p.imageData = data; p.previewOnly = false;
      await DB.save(p);
      hideLoading();
      if (currentModalPhoto && currentModalPhoto.id === p.id) openPhotoModal(p.id);
      if (currentTab === 'gallery') renderGallery();
      showToast('Full photo kept in the app', 'success');
    }
  } catch (e) {
    hideLoading();
    showToast(e.message, 'danger');
  }
}

// Gallery: save the selected photos (full size) to the phone
async function saveSelected() {
  const list = photos.filter(p => selectedPhotos.has(p.id));
  if (!list.length) return;
  const full = await fullImages(list, 'Getting full photos…');
  showLoading('Saving to the phone…', '');
  let ok = 0;
  for (const p of full) {
    setLoadingSub(`${ok + 1} of ${full.length}`);
    if (await saveFile(p.imageData, photoFileName(p), 'image/jpeg')) ok++;
  }
  hideLoading();
  showToast(`${ok} photo${ok === 1 ? '' : 's'} saved to Pictures / CivilCam`, ok ? 'success' : 'danger');
}
