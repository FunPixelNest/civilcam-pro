// ============================================================
// FREE VERSION WITH ADS · CIVILCAM PRO SUBSCRIPTION
// Free: everything works; a banner sits under Gallery / Strip / Hindrance / Reports (never on the
//       camera), a short ad may show after a report is created (at most every 3 minutes), and
//       reports carry one small "free version" line. Watching a rewarded ad removes that line
//       from one report.
// Pro:  no ads, no line on reports, priority support. Bought through Google Play.
// The ads and the purchase run natively (AdsManager.kt, BillingHelper.kt).
// ============================================================
const Pro = { plans: [], webPreview: false };

function bridgeHas(fn) { return hasAndroidBridge() && typeof window.AndroidBridge[fn] === 'function'; }

function isPro() {
  if (bridgeHas('isPro')) { try { return !!window.AndroidBridge.isPro(); } catch (e) { return false; } }
  return !!loadJSON('proPreview', false);           // browser preview only
}

window.onNativePro = function () { applyPro(); };
window.onNativePlans = function (json) {
  try { Pro.plans = JSON.parse(json) || []; } catch (e) { Pro.plans = []; }
  if (document.getElementById('pro-sheet').classList.contains('open')) renderPaywall();
};
window.onNativeProError = function (msg) { showToast(msg, 'danger'); };

function applyPro() {
  const pro = isPro();
  document.querySelectorAll('.pro-chip').forEach(el => { el.style.display = pro ? 'none' : ''; });
  document.querySelectorAll('.pro-badge').forEach(el => { el.style.display = pro ? '' : 'none'; });
  const row = document.getElementById('ac-pro');
  if (row) row.innerHTML = pro ? `${ic('crown', 18)}CivilCam Pro · active` : `${ic('crown', 18)}Go Pro: no ads`;
  if (pro && document.getElementById('pro-sheet').classList.contains('open')) renderPaywall();
  Ads.refresh(true);
  if (currentTab === 'export' && currentProject) renderExportScreen();
}

// ---------- the line on free reports ----------
function reportBrandLine() {
  if (isPro() || exportState.noBrandOnce) return '';
  return 'Made with CivilCam Pro (free version)';
}

function renderBrandSection() {
  const box = document.getElementById('brand-section');
  if (!box) return;
  if (isPro()) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = exportState.noBrandOnce
    ? `<div class="brand-note ok">${ic('check', 16)}<span>This report will be made without the "free version" line.</span></div>`
    : `<div class="brand-note"><span>Free version: reports end with a small line <i>"Made with CivilCam Pro (free version)"</i>.</span>
        <div class="btn-row"><button class="btn small" onclick="removeBrandWithAd()">${ic('play', 16)}Remove for this report</button>
        <button class="btn small primary" onclick="openPaywall('report')">${ic('crown', 16)}Go Pro</button></div></div>`;
}

async function removeBrandWithAd() {
  const r = await watchRewarded('report-brand');
  if (r === 'earned' || r === 'notready') {
    exportState.noBrandOnce = true;
    if (r === 'notready') showToast('No ad available right now, so this one is on us', 'success');
    renderBrandSection();
  } else {
    showToast('The line stays unless the ad is watched to the end');
  }
}

// ---------- ads ----------
const Ads = {
  last: null, pending: {},
  BANNER_TABS: ['gallery', 'chainage', 'hindrance', 'export'],
  // Works out whether the banner should show and tells the phone only when that changes
  refresh(force) {
    if (!bridgeHas('setBannerVisible')) return;
    const appOn = document.getElementById('app').classList.contains('visible');
    const covered = document.getElementById('photo-modal').classList.contains('visible') ||
      document.getElementById('compare-modal').classList.contains('visible') ||
      document.getElementById('loading-overlay').classList.contains('visible');
    const projectsOn = document.getElementById('projects-screen').style.display !== 'none' && !appOn;
    const want = !isPro() && !covered && ((appOn && Ads.BANNER_TABS.includes(currentTab)) || projectsOn);
    if (force || want !== Ads.last) { Ads.last = want; window.AndroidBridge.setBannerVisible(want); }
  }
};
setInterval(() => Ads.refresh(false), 700);

// An interstitial at a natural break. Resolves when the ad is closed (or straight away).
function adBreak(placement) {
  if (isPro() || !bridgeHas('showInterstitial')) return Promise.resolve(false);
  return new Promise(resolve => {
    const id = placement + Date.now();
    Ads.pending[id] = resolve;
    setTimeout(() => { if (Ads.pending[id]) { delete Ads.pending[id]; resolve(false); } }, 60000);
    window.AndroidBridge.showInterstitial(id);
  });
}
window.onNativeAdDone = function (id, shown) {
  const r = Ads.pending[id]; delete Ads.pending[id];
  if (r) r(!!shown);
};

// Rewarded ad chosen by the engineer. Resolves 'earned', 'closed' or 'notready'.
function watchRewarded(placement) {
  if (!bridgeHas('showRewarded')) return Promise.resolve('notready');
  return new Promise(resolve => {
    const id = placement + Date.now();
    Ads.pending[id] = resolve;
    window.AndroidBridge.showRewarded(id);
  });
}
window.onNativeReward = function (id, earned, reason) {
  const r = Ads.pending[id]; delete Ads.pending[id];
  if (r) r(earned ? 'earned' : reason === 'notready' ? 'notready' : 'closed');
};

function adPrivacyRequired() { return bridgeHas('adPrivacyRequired') && !!window.AndroidBridge.adPrivacyRequired(); }
function showAdPrivacy() { if (bridgeHas('showAdPrivacy')) window.AndroidBridge.showAdPrivacy(); }

// ---------- paywall ----------
function openPaywall(from) {
  Pro.from = from || '';
  renderPaywall();
  openSheet('pro-sheet');
}

function planLabel(p) {
  const per = { P1W: 'week', P1M: 'month', P3M: '3 months', P6M: '6 months', P1Y: 'year' }[p.period] || p.period;
  return { name: p.plan === 'yearly' ? 'Yearly' : p.plan === 'monthly' ? 'Monthly' : p.plan, price: `${p.price} / ${per}`, trial: p.trial };
}

function renderPaywall() {
  const pro = isPro();
  if (bridgeHas('proPlans') && !Pro.plans.length) { try { Pro.plans = JSON.parse(window.AndroidBridge.proPlans()) || []; } catch (e) { /* none yet */ } }
  const plans = Pro.plans.slice().sort((a, b) => (a.plan === 'yearly' ? -1 : 1));
  document.getElementById('pro-body').innerHTML = `
    <div class="pro-hero">${ic('crown', 34)}<div><b>CivilCam Pro</b><span>${pro ? 'Active on this Google account. Thank you!' : 'Support the app and work without interruptions.'}</span></div></div>
    <ul class="pro-list">
      <li>${ic('check', 16)}No ads anywhere in the app</li>
      <li>${ic('check', 16)}Reports without the "free version" line</li>
      <li>${ic('check', 16)}Priority help from the CivilCam team</li>
      <li>${ic('check', 16)}New Pro features as they arrive (company logo on reports, more templates)</li>
    </ul>
    ${pro ? `<button class="btn block" onclick="managePro()">Manage subscription in Google Play</button>` :
      !hasAndroidBridge() ? `<div class="note">Subscriptions are bought in the Android app through Google Play.</div>` :
      plans.length ? plans.map(p => { const l = planLabel(p); return `<button class="btn block lg ${p.plan === 'yearly' ? 'primary' : ''} pro-plan" onclick="buyPro('${esc(p.plan)}')">
          <span><b>${esc(l.name)}</b>${l.trial ? '<em>free trial first</em>' : ''}</span><span>${esc(l.price)}</span></button>`; }).join('') :
      `<div class="note">Prices load from Google Play. If nothing shows, check the internet connection and open this again.</div>`}
    ${!pro && hasAndroidBridge() ? `<button class="link-btn" onclick="restorePro()">Already bought? Restore purchase</button>` : ''}
    <div class="note">Payment and renewals are handled by Google Play. Cancel any time in Play Store → Payments &amp; subscriptions.</div>`;
}

function buyPro(plan) { if (bridgeHas('buyPro')) window.AndroidBridge.buyPro(plan); }
function restorePro() { if (bridgeHas('restorePro')) { window.AndroidBridge.restorePro(); showToast('Checking Google Play…'); } }
function managePro() { if (bridgeHas('managePro')) window.AndroidBridge.managePro(); }

document.addEventListener('DOMContentLoaded', () => setTimeout(applyPro, 300));
