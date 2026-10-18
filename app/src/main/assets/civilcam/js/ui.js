// ============================================================
// SCREENS AND TABS
// ============================================================
function showOnly(id) {
  ['auth-screen', 'profile-screen', 'projects-screen'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'flex' : 'none';
  });
  document.getElementById('app').classList.toggle('visible', id === 'app');
  if (id !== 'app') stopCamera();
}

let currentTab = 'camera';
function switchTab(tabName) {
  if (tabName === 'chainage' && !isLinearProject(currentProject)) tabName = 'gallery';
  currentTab = tabName;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabName + '-screen').classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add('active');

  // The camera uses the whole screen; other tabs show the header
  document.querySelector('.app-header').style.display = tabName === 'camera' ? 'none' : 'flex';
  if (tabName === 'camera') startCamera(); else stopCamera();
  if (tabName === 'gallery') renderGallery();
  if (tabName === 'chainage') renderStrip();
  if (tabName === 'export') renderExportScreen();
}

// ============================================================
// SHEETS
// ============================================================
function openSheet(id) { document.getElementById(id).classList.add('open'); }
function closeSheet(id) {
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  document.getElementById(id).classList.remove('open');
}

// Asks for a short piece of text. Resolves to the text, or null if cancelled.
let askResolver = null;
function askText(title, hint, value = '') {
  document.getElementById('ask-title').textContent = title;
  document.getElementById('ask-hint').textContent = hint || '';
  const input = document.getElementById('ask-input');
  input.value = value;
  openSheet('ask-sheet');
  setTimeout(() => input.focus(), 250);
  return new Promise(res => { askResolver = res; });
}
function answerAsk(value) {
  closeSheet('ask-sheet');
  const r = askResolver;
  askResolver = null;
  if (r) r(value === null ? null : String(value).trim() || null);
}

// ============================================================
// CHIP ROWS (with an "Others" chip that saves a new value)
// ============================================================
// key: options list (activity, side, ...); opts.others adds the "+ Others" chip;
// opts.all adds an "All" chip (value null); opts.multi allows several values (Set).
function renderChips(container, key, current, onPick, opts = {}) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  el.innerHTML = '';
  const isOn = v => opts.multi ? current.has(v) : current === v;
  const values = opts.values || getOptions(key);
  const add = (label, value, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (cls ? ' ' + cls : '') + (isOn(value) ? ' active' : '');
    b.textContent = label;
    b.onclick = () => onPick(value);
    el.appendChild(b);
  };
  if (opts.all) add(opts.all, null, '');
  values.forEach(v => add(v, v, isCustomOption(key, v) ? 'custom' : ''));
  if (opts.others) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip others';
    b.innerHTML = ic('plus', 14) + 'Others';
    b.onclick = async () => {
      const label = opts.othersLabel || 'Add a new value';
      const v = await askText(label, 'Not in the list? Type it once and it stays in your list from now on.');
      if (!v) return;
      const saved = await addOption(key, v);
      showToast(`"${saved}" added to your list`, 'success');
      onPick(saved);
    };
    el.appendChild(b);
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
function setLoadingSub(sub) { document.getElementById('loading-sub').textContent = sub || ''; }
function hideLoading() { document.getElementById('loading-overlay').classList.remove('visible'); }

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
