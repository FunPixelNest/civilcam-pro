// ============================================================
// PROJECTS
// ============================================================
function isLinearProject(p) {
  return !!(p && p.startM != null && p.endM != null && p.endM > p.startM);
}

function projectChText(p) {
  const kind = projectLayout(p);
  const ch = isLinearProject(p) ? `Ch ${fmtCh(p.startM)} – ${fmtCh(p.endM)}` : '';
  if (kind === 'building') {
    const b = +p.basements || 0, f = p.floors == null ? 4 : +p.floors;
    return `${b ? b + 'B + ' : ''}G + ${f}` + (p.type ? ' · ' + p.type : '');
  }
  if (kind === 'bridge') { const n = p.spans == null ? 4 : +p.spans; return [`${n} span${n === 1 ? '' : 's'}`, ch].filter(Boolean).join(' · '); }
  if (kind === 'plant') { const n = projectElements(p).length; return `${n} zone${n === 1 ? '' : 's'}` + (p.type ? ' · ' + p.type : ''); }
  return ch || p.type || '';
}

async function loadProjects() {
  projects = (await DB.getAll('projects')).filter(p => !p.deleted);
  projects.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
}

// Earlier versions only had a project NAME on each photo; turn those into projects
async function migrateOldProjects() {
  const byName = {};
  projects.forEach(p => { byName[p.name] = p; });
  const recent = loadJSON('recentProjects', []);
  const names = new Set(recent);
  photos.forEach(p => { if (!p.projectId && p.projectName) names.add(p.projectName); });
  for (const name of names) {
    if (!name || byName[name]) continue;
    const proj = newProjectRecord({ name, fullName: name });
    byName[name] = proj;
    projects.push(proj);
    await DB.put('projects', proj);
  }
  for (const p of photos) {
    if (!p.projectId && byName[p.projectName]) {
      p.projectId = byName[p.projectName].id;
      await DB.save(p);
    }
  }
}

function newProjectRecord(data) {
  const now = Date.now();
  return Object.assign({
    id: 'p-' + uid(), name: '', fullName: '', type: 'Road / Highway', client: '', contractor: '',
    startM: null, endM: null, groupSize: 100, createdAt: now, updatedAt: now, lastUsed: now,
    createdBy: profile.email || profile.name || '', synced: false
  }, data);
}

function renderProjectList() {
  const list = document.getElementById('project-list');
  document.getElementById('projects-hello').textContent = profile.name ? `Hello, ${profile.name.split(' ')[0]}` : 'CivilCam Pro';
  if (!projects.length) {
    list.innerHTML = `<div class="empty">
      <div class="empty-ic">${ic('folder', 40)}</div>
      <div class="empty-title">No projects yet</div>
      <div class="empty-sub">Create a project, then every photo you take goes into it.</div>
      <button class="btn primary" onclick="openProjectSheet()">${ic('plus', 18)}New project</button></div>`;
    return;
  }
  list.innerHTML = projects.map(p => {
    const ps = projectPhotos(p.id);
    const last = ps.reduce((m, x) => Math.max(m, new Date(x.timestamp).getTime()), 0);
    const thumbs = ps.slice(0, 3).map(x => `<img src="${x.imageData || ''}" alt="">`).join('');
    return `<div class="project-wrap"><button class="project-card" onclick="openProject('${p.id}')">
      <div class="pc-thumbs">${thumbs || `<div class="pc-thumb-empty">${ic('camera', 22)}</div>`}</div>
      <div class="pc-body">
        <div class="pc-name">${esc(p.name)}</div>
        <div class="pc-full">${esc(p.fullName)}</div>
        <div class="pc-meta"><span>${ps.length} photo${ps.length === 1 ? '' : 's'}</span>${isLinearProject(p) ? `<span>${projectChText(p)}</span>` : ''}${teamCount(p) > 1 ? `<span class="pc-team">${ic('users', 13)}${teamCount(p)} engineers</span>` : ''}${last ? `<span>Last ${fmtDate(last)}</span>` : ''}</div>
      </div>
      ${ic('chevronRight', 18)}
    </button>
    <div class="pc-actions">
      <button onclick="openProject('${p.id}')">${ic('camera', 15)}Open</button>
      <button onclick="openProjectSheet(projects.find(x => x.id === '${p.id}'))">${ic('edit', 15)}Edit</button>
      <button onclick="currentProject = projects.find(x => x.id === '${p.id}'); openTeam(currentProject)">${ic('users', 15)}Team${teamCount(p) > 1 ? ' (' + teamCount(p) + ')' : ''}</button>
    </div></div>`;
  }).join('');
}

function showProjects() {
  closePhotoModal();
  showOnly('projects-screen');
  renderProjectList();
}

async function openProject(id) {
  const p = projects.find(x => x.id === id);
  if (!p) return;
  currentProject = p;
  p.lastUsed = Date.now();
  await DB.put('projects', p);
  saveJSON('lastProjectId', p.id);
  selectedPhotos.clear();
  applyProjectToUI();
  showOnly('app');
  switchTab('camera');
}

function applyProjectToUI() {
  const p = currentProject;
  document.getElementById('header-project-name').textContent = p.name;
  document.getElementById('header-project-sub').textContent = projectChText(p);
  document.getElementById('cam-project-name').textContent = p.name;
  document.getElementById('ov-proj-name').textContent = p.name;
  document.getElementById('tab-chainage').querySelector('span').textContent = LAYOUTS_SITE[projectLayout(p)].tab;
  // Lists differ by project kind: keep the camera choices valid for this project
  if (!getOptions('activity').includes(currentActivity)) currentActivity = getOptions('activity')[0];
  if (!getOptions('side').includes(currentSide)) currentSide = getOptions('side')[0];
  const els = projectElements(p);
  if (usesElements(p) && !els.includes(currentElement)) currentElement = loadJSON('lastElement_' + p.id, els[0] || '');
  if (!usesElements(p)) currentElement = '';
  updateHindranceBadge();
  updateChHint();
  updateOverlayMeta();
  updateLastThumb();
}

// ----- project sheet -----
function updateProjectChHint() {
  const a = parseCh(document.getElementById('pj-start').value, true);
  const b = parseCh(document.getElementById('pj-end').value, true);
  const el = document.getElementById('pj-ch-hint');
  if (a == null && b == null) { el.textContent = 'Type 0+000 style, or km (25) or metres (25000). Leave empty for buildings.'; el.classList.remove('warn'); return; }
  if (a != null && b != null && b > a) { el.textContent = `Reads as ${fmtCh(a)} to ${fmtCh(b)} (${((b - a) / 1000).toFixed(2)} km)`; el.classList.remove('warn'); return; }
  el.textContent = a != null && b != null ? 'End must be after start' : 'Enter both start and end';
  el.classList.toggle('warn', a != null && b != null);
}

let editingProject = null;
let sheetProjectType = 'Road / Highway';
let sheetLayout = 'road', sheetLayoutPicked = false;

function openProjectSheet(p = null) {
  editingProject = p;
  document.getElementById('project-sheet-title').textContent = p ? 'Edit project' : 'New project';
  document.getElementById('pj-name').value = p ? p.name : '';
  document.getElementById('pj-full').value = p ? p.fullName : '';
  document.getElementById('pj-start').value = p && p.startM != null ? fmtCh(p.startM) : '';
  document.getElementById('pj-end').value = p && p.endM != null ? fmtCh(p.endM) : '';
  document.getElementById('pj-client').value = p ? p.client || '' : '';
  document.getElementById('pj-contractor').value = p ? p.contractor || '' : '';
  document.getElementById('pj-delete').style.display = p ? '' : 'none';
  sheetProjectType = p ? p.type : 'Road / Highway';
  sheetLayout = p ? projectLayout(p) : 'road';
  sheetLayoutPicked = !!(p && p.layout);
  document.getElementById('pj-basements').value = p && p.basements ? p.basements : '';
  document.getElementById('pj-floors').value = p && p.floors != null ? p.floors : '';
  document.getElementById('pj-foundation').checked = !(p && p.foundation === false);
  document.getElementById('pj-terrace').checked = !(p && p.terrace === false);
  document.getElementById('pj-spans').value = p && p.spans != null ? p.spans : '';
  document.getElementById('pj-deck').checked = !(p && p.deck === false);
  document.getElementById('pj-zones').value = p && p.zones ? p.zones.join('\n') : '';
  renderProjectTypeChips();
  updateProjectChHint();
  if (typeof renderTeamBlock === 'function') renderTeamBlock(p);
  // Team members who are not the owner can only leave a team project, not delete it
  document.getElementById('pj-delete').textContent = p && p.team && !teamOwner(p) ? 'Leave this team' : 'Delete project';
  openSheet('project-sheet');
}

function renderProjectTypeChips() {
  renderChips('pj-type-row', 'projectType', sheetProjectType, v => {
    sheetProjectType = v;
    if (!sheetLayoutPicked) sheetLayout = guessLayout(v);
    renderProjectTypeChips();
  }, { others: true, othersLabel: 'Add a project type' });
  renderLayoutChips();
}

function renderLayoutChips() {
  const names = { road: 'Road', canal: 'Canal', rail: 'Rail track', pipe: 'Pipeline', bridge: 'Bridge piers', building: 'Building floors', plant: 'Zones' };
  renderChips('pj-layout-row', 'layout', names[sheetLayout], label => {
    sheetLayout = Object.keys(names).find(k => names[k] === label);
    sheetLayoutPicked = true;
    renderLayoutChips();
  }, { values: Object.values(names), plain: true });
  updateProjectPreview();
}

function sheetDraft() {
  const num = id => { const v = document.getElementById(id).value.trim(); return v === '' ? null : Math.max(0, Math.round(+v)); };
  return {
    layout: sheetLayout, type: sheetProjectType,
    basements: num('pj-basements') || 0, floors: num('pj-floors'),
    foundation: document.getElementById('pj-foundation').checked, terrace: document.getElementById('pj-terrace').checked,
    spans: num('pj-spans'), deck: document.getElementById('pj-deck').checked,
    zones: document.getElementById('pj-zones').value.split(/\n|,/).map(s => s.trim()).filter(Boolean)
  };
}

function updateProjectPreview() {
  const k = sheetLayout;
  document.getElementById('pj-building-block').style.display = k === 'building' ? '' : 'none';
  document.getElementById('pj-bridge-block').style.display = k === 'bridge' ? '' : 'none';
  document.getElementById('pj-plant-block').style.display = k === 'plant' ? '' : 'none';
  document.getElementById('pj-road-block').style.display = LAYOUTS_SITE[k].linear || k === 'bridge' ? '' : 'none';
  document.getElementById('pj-ch-label').textContent = k === 'bridge' ? 'Bridge chainage (optional)' : 'Project chainage';
  const hints = {
    road: 'Photos are placed along the road by chainage, LHS above and RHS below.',
    canal: 'Photos are placed along the canal by chainage, left bank above and right bank below.',
    rail: 'Photos are placed along the track by chainage, up line above and down line below.',
    pipe: 'Photos are placed along the pipeline route by chainage.',
    bridge: 'Each photo is tagged to an abutment, a pier or the deck.',
    building: 'Each photo is tagged to a floor. The site map shows the building floor by floor.',
    plant: 'Each photo is tagged to a zone of the site.'
  };
  document.getElementById('pj-layout-hint').textContent = hints[k];
  const els = usesElements({ layout: k }) ? projectElements(sheetDraft()) : [];
  document.getElementById('pj-preview').innerHTML = els.length
    ? `<div class="pj-preview-label">${els.length} locations</div><div class="pj-preview-chips">${els.slice(0, 40).map(e => `<span>${esc(e)}</span>`).join('')}${els.length > 40 ? `<span>+${els.length - 40}</span>` : ''}</div>` : '';
}

async function saveProjectFromSheet() {
  const name = document.getElementById('pj-name').value.trim();
  const fullName = document.getElementById('pj-full').value.trim() || name;
  if (!name) { showToast('Enter a short project name', 'danger'); document.getElementById('pj-name').focus(); return; }
  const startM = parseCh(document.getElementById('pj-start').value, true);
  const endM = parseCh(document.getElementById('pj-end').value, true);
  if ((startM != null) !== (endM != null)) { showToast('Enter both start and end chainage, or neither', 'danger'); return; }
  if (startM != null && endM <= startM) { showToast('End chainage must be after start', 'danger'); return; }

  const d = sheetDraft();
  if (sheetLayout === 'plant' && !d.zones.length) { showToast('Add at least one zone', 'danger'); return; }
  const data = {
    name, fullName, type: sheetProjectType, startM, endM,
    layout: sheetLayout,
    basements: d.basements, floors: d.floors == null ? 4 : d.floors, foundation: d.foundation, terrace: d.terrace,
    spans: d.spans == null ? 4 : Math.max(1, d.spans), deck: d.deck,
    zones: d.zones,
    client: document.getElementById('pj-client').value.trim(),
    contractor: document.getElementById('pj-contractor').value.trim(),
    updatedAt: Date.now(), synced: false
  };
  let proj;
  const wasTeam = !!(editingProject && editingProject.team);
  if (editingProject) {
    proj = Object.assign(editingProject, data);
    // Keep the name on this project's photos in step
    for (const ph of projectPhotos(proj.id)) {
      if (ph.projectName !== name || ph.projectFullName !== fullName) {
        ph.projectName = name; ph.projectFullName = fullName; ph.updatedAt = Date.now(); ph.synced = false;
        await DB.save(ph);
      }
    }
  } else {
    proj = newProjectRecord(data);
    projects.unshift(proj);
  }
  const nowTeam = typeof applyTeamToProject === 'function' && applyTeamToProject(proj, wasTeam);
  await DB.put('projects', proj);
  if (nowTeam) await moveProjectToTeam(proj);
  Sync.schedule();
  closeSheet('project-sheet');
  showToast(editingProject ? 'Project saved' : 'Project created', 'success');
  if (editingProject && currentProject && currentProject.id === proj.id) {
    applyProjectToUI();
    if (currentTab === 'chainage') renderStrip();
  } else {
    openProject(proj.id);
  }
}

async function deleteProjectFromSheet() {
  const p = editingProject;
  if (!p) return;
  if (p.team && !teamOwner(p)) { leaveTeam(); return; }
  const count = projectPhotos(p.id).length;
  const typed = await askText('Delete project?', `This removes "${p.name}" and its ${count} photo(s) from this phone. Type DELETE to confirm.`);
  if (!typed || typed.toUpperCase() !== 'DELETE') return;
  for (const ph of projectPhotos(p.id)) await DB.delPhoto(ph.id);
  photos = photos.filter(ph => ph.projectId !== p.id);
  p.deleted = true; p.updatedAt = Date.now(); p.synced = false;
  await DB.put('projects', p);
  projects = projects.filter(x => x.id !== p.id);
  Sync.schedule();
  closeSheet('project-sheet');
  currentProject = null;
  showProjects();
  showToast('Project deleted', 'danger');
}

// ============================================================
// ENGINEER PROFILE
// ============================================================
function showProfileForm() {
  document.getElementById('pf-name').value = profile.name || '';
  document.getElementById('pf-designation').value = profile.designation || '';
  document.getElementById('pf-company').value = profile.company || '';
  showOnly('profile-screen');
}

function saveProfileFromForm() {
  const name = document.getElementById('pf-name').value.trim();
  if (!name) { showToast('Enter your name', 'danger'); return; }
  profile.name = name;
  profile.designation = document.getElementById('pf-designation').value.trim();
  profile.company = document.getElementById('pf-company').value.trim();
  saveJSON('profile', profile);
  afterProfileReady();
  if (typeof maybeShowHelpFirstTime === 'function') maybeShowHelpFirstTime();
}

function openAccountSheet() {
  if (typeof applyPro === 'function') applyPro();
  const adp = document.getElementById('ac-adprivacy'); if (adp) adp.style.display = typeof adPrivacyRequired === 'function' && adPrivacyRequired() ? '' : 'none';
  const signedIn = Account.isSignedIn();
  document.getElementById('account-card').innerHTML = signedIn
    ? `<div class="ac-avatar">${esc((profile.name || profile.email || '?').slice(0, 1).toUpperCase())}</div>
       <div><div class="ac-name">${esc(profile.email)}</div><div class="ac-sub">Signed in with ${esc(profile.provider)} · ${Sync.statusText()}</div></div>`
    : `<div class="ac-avatar">${ic('user', 22)}</div><div><div class="ac-name">Not signed in</div><div class="ac-sub">Photos stay on this phone only.</div></div>`;
  document.getElementById('ac-name').value = profile.name || '';
  document.getElementById('ac-designation').value = profile.designation || '';
  document.getElementById('ac-company').value = profile.company || '';
  document.getElementById('ac-sync').style.display = signedIn ? '' : 'none';
  document.getElementById('ac-signout').style.display = signedIn ? '' : 'none';
  document.getElementById('ac-signin').style.display = !signedIn && Account.available() ? '' : 'none';
  refreshDriveRow();
  openSheet('account-sheet');
}

function saveProfileFromAccount() {
  const name = document.getElementById('ac-name').value.trim();
  if (!name) { showToast('Enter your name', 'danger'); return; }
  profile.name = name;
  profile.designation = document.getElementById('ac-designation').value.trim();
  profile.company = document.getElementById('ac-company').value.trim();
  saveJSON('profile', profile);
  closeSheet('account-sheet');
  renderProjectList();
  updateOverlayMeta();
  showToast('Saved', 'success');
}
