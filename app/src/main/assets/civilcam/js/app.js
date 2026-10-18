// ============================================================
// START-UP
// ============================================================
function showAuth() {
  if (!Account.available()) { if (!profile.name) showProfileForm(); else afterProfileReady(); return; }
  showOnly('auth-screen');
}

function afterProfileReady() {
  const lastId = loadJSON('lastProjectId', null);
  if (lastId && projects.some(p => p.id === lastId) && !afterProfileReady.done) {
    afterProfileReady.done = true;
    openProject(lastId);
  } else {
    showProjects();
  }
  Sync.updateDot();
}

async function boot() {
  hydrateIcons();
  await DB.init();
  (await DB.getAll('options')).forEach(o => { customOptions[o.key] = o.values || []; });
  photos = (await DB.getAll('photos')).map(normPhoto);
  photos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  await loadProjects();
  await migrateOldProjects();

  restoreCamDetails();
  applyStampUI();
  startLocationTracking();
  startClock();

  const choice = loadJSON('authChoice', '');
  if (Account.available() && !choice && !Account.isSignedIn()) showAuth();
  else if (!profile.name) showProfileForm();
  else afterProfileReady();

  if (Sync.enabled()) Sync.now();
}

// Android back button: close the top-most thing first, then go up a level
window.onAndroidBack = function () {
  const open = [...document.querySelectorAll('.sheet-backdrop.open')];
  if (open.length) { const top = open[open.length - 1]; if (top.id === 'ask-sheet') answerAsk(null); else if (top.id === 'details-sheet') closeDetailsSheet(); else closeSheet(top.id); return true; }
  if (document.getElementById('photo-modal').classList.contains('visible')) { closePhotoModal(); return true; }
  if (document.getElementById('app').classList.contains('visible')) {
    if (selectedPhotos.size) { clearSelection(); return true; }
    if (currentTab !== 'camera') { switchTab('camera'); return true; }
    showProjects(); return true;
  }
  return false;
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
  else if (currentTab === 'camera' && document.getElementById('app').classList.contains('visible')) startCamera();
});

window.addEventListener('load', boot);
