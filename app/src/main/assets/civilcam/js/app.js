// ============================================================
// SETUP / SESSION
// ============================================================
function startSession() {
  const input = document.getElementById('project-name-input').value.trim();
  if (!input) { document.getElementById('project-name-input').focus(); showToast('Enter a project name', 'danger'); return; }
  projectName = input;

  // Save to recent
  recentProjects = JSON.parse(localStorage.getItem('recentProjects') || '[]');
  if (!recentProjects.includes(projectName)) {
    recentProjects.unshift(projectName);
    recentProjects = recentProjects.slice(0, 5);
    localStorage.setItem('recentProjects', JSON.stringify(recentProjects));
  }
  localStorage.setItem('lastProject', projectName);

  document.getElementById('header-project-name').textContent = projectName;
  document.getElementById('ov-proj-name').textContent = projectName;
  document.getElementById('cam-project-name').textContent = projectName;
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');

  init();
}

function changeProject() {
  document.getElementById('setup-screen').style.display = 'flex';
  document.getElementById('app').classList.remove('visible');
  loadRecentProjects();
}

function loadRecentProjects() {
  recentProjects = JSON.parse(localStorage.getItem('recentProjects') || '[]');
  const wrap = document.getElementById('recent-projects-wrap');
  const chips = document.getElementById('recent-projects-chips');
  if (recentProjects.length > 0) {
    wrap.style.display = 'block';
    chips.innerHTML = '';
    recentProjects.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'recent-chip';
      chip.textContent = '🏗️ ' + p;
      chip.onclick = () => {
        document.getElementById('project-name-input').value = p;
        startSession();
      };
      chips.appendChild(chip);
    });
  } else {
    wrap.style.display = 'none';
  }
}

// ============================================================
// TABS
// ============================================================
function switchTab(tabName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabName + '-screen').classList.add('active');
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

  // The camera uses the whole screen; other tabs show the header
  document.querySelector('.app-header').style.display = tabName === 'camera' ? 'none' : 'flex';
  if (tabName === 'export') {
    updateExportCount();
  }
}

// ============================================================
// LOADING / TOAST
// ============================================================
function showLoading(text, sub) {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-sub').textContent = sub || '';
  document.getElementById('loading-overlay').classList.add('visible');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('visible');
}

let toastTimer;
// action (optional): { label, onClick } adds a button, e.g. OPEN after saving
function showToast(msg, type = '', action = null) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '') + (action ? ' has-action' : '');
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.onclick = () => { t.classList.remove('show'); action.onClick(); };
    t.appendChild(btn);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); }, action ? 6000 : 2800);
}

// ============================================================
// INIT
// ============================================================
async function init() {
  await DB.init();
  photos = await DB.getAll();
  photos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  buildActivityChips();
  buildSideChips();
  updateOverlayMeta();
  applyStampUI();
  switchTab('camera');
  renderGallery();
  updateExportCount();
  startCamera();
  startLocationTracking();
  startClock();
}

// Auto-load last project
window.addEventListener('load', () => {
  loadRecentProjects();
  const last = localStorage.getItem('lastProject');
  if (last) {
    document.getElementById('project-name-input').value = last;
  }
});

// Keyboard shortcut: Enter on setup screen
document.getElementById('project-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') startSession();
});

// Close modal on overlay click
document.getElementById('photo-modal').addEventListener('click', function(e) {
  if (e.target === this) closePhotoModal();
});
