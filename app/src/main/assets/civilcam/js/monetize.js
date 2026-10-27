// ============================================================
// FREE VERSION WITH ADS · CIVILCAM PRO SUBSCRIPTION
// Free: camera, gallery, chainage, hindrance and PDF reports. A banner sits under Gallery / Strip /
//       Hindrance / Reports (never on the camera), a short ad may show after a report is created,
//       and free PDF reports carry the CivilCam Pro logo (large and faded on every page, plus a
//       small logo in the footer).
// Pro:  no ads, PDF without the logo, and Word, Excel, PowerPoint, Client view and Google Earth
//       reports. Bought through Google Play (product civilcam_pro: monthly / yearly, 7-day trial).
// The ads and the purchase run natively (AdsManager.kt, BillingHelper.kt).
// ============================================================
const Pro = { plans: [], webPreview: false };

function bridgeHas(fn) { return hasAndroidBridge() && typeof window.AndroidBridge[fn] === 'function'; }

// A paid subscription on this Google account (Play's own check on the phone)
function isPaidPro() {
  if (bridgeHas('isPro')) { try { return !!window.AndroidBridge.isPro(); } catch (e) { return false; } }
  return !!loadJSON('proPreview', false);           // browser preview only
}

// ---------- "Pro free for everyone" period ----------
// Switched on in Firebase console › Remote Config: free_pro_until = last free day (YYYY-MM-DD),
// free_pro_ads_off = no ads meanwhile, free_pro_message = optional line. Ends by itself on that date.
function promoInfo() {
  let p = null;
  if (bridgeHas('promo')) { try { p = JSON.parse(window.AndroidBridge.promo()); } catch (e) { p = null; } }
  else p = loadJSON('promoPreview', null);          // browser preview only
  if (!p || !p.until) return { active: false, until: '', adsOff: true, message: '' };
  if (!bridgeHas('promo')) p.active = localDateKey(new Date()) <= p.until;
  return { active: !!p.active, until: p.until, adsOff: p.adsOff !== false, message: p.message || '' };
}
function promoActive() { return promoInfo().active; }
function promoUntilText() {
  const u = promoInfo().until;
  return u ? new Date(u + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

// Everything Pro unlocks: a paid subscription, or the free period
function isPro() { return isPaidPro() || promoActive(); }
// Ads stay off for subscribers, and during the free period unless free_pro_ads_off is false
function adsHidden() { return isPaidPro() || (promoActive() && promoInfo().adsOff); }

// Tells the engineer once when a free period starts, and once when it ends
function announcePromo() {
  if (isPaidPro()) return;
  const info = promoInfo();
  const seen = loadJSON('promoSeen', null);
  if (info.active && (!seen || seen.until !== info.until || !seen.active)) {
    saveJSON('promoSeen', { until: info.until, active: true });
    showToast(info.message || `All Pro features are free until ${promoUntilText()}`, 'success',
      { label: 'SEE WHAT', onClick: () => openPaywall('promo') });
  } else if (!info.active && seen && seen.active) {
    saveJSON('promoSeen', { until: seen.until, active: false });
    showToast('The free Pro period has ended. Thank you for trying it!', '', { label: 'GO PRO', onClick: () => openPaywall('promo-ended') });
  }
}

window.onNativePromo = function () { applyPro(); announcePromo(); };
window.onNativePro = function () { applyPro(); };
window.onNativePlans = function (json) {
  try { Pro.plans = JSON.parse(json) || []; } catch (e) { Pro.plans = []; }
  if (document.getElementById('pro-sheet').classList.contains('open')) renderPaywall();
};
window.onNativeProError = function (msg) { showToast(msg, 'danger'); };

function applyPro() {
  const pro = isPro(), paid = isPaidPro(), promo = !paid && promoActive();
  // During the free period the PRO chip stays, saying it is free, and opens the details
  document.querySelectorAll('.pro-chip').forEach(el => {
    el.style.display = paid ? 'none' : '';
    el.innerHTML = promo ? `${ic('crown', 14)}PRO FREE` : `${ic('crown', 14)}PRO`;
  });
  document.querySelectorAll('.pro-badge').forEach(el => { el.style.display = pro ? '' : 'none'; });
  const row = document.getElementById('ac-pro');
  if (row) row.innerHTML = paid ? `${ic('crown', 18)}CivilCam Pro · active`
    : promo ? `${ic('crown', 18)}CivilCam Pro · free until ${esc(promoUntilText())}` : `${ic('crown', 18)}Go Pro: no ads`;
  if (document.getElementById('pro-sheet').classList.contains('open')) renderPaywall();
  Ads.refresh(true);
  if (currentTab === 'export' && currentProject) renderExportScreen();
}

// ---------- what free users can make ----------
const FREE_FORMATS = ['pdf'];            // everything else in FORMATS needs Pro
function formatNeedsPro(f) { return !FREE_FORMATS.includes(f); }

// Free PDFs carry the CivilCam Pro logo; Pro reports carry nothing
function reportBrandLine() {
  return isPro() ? '' : 'Made with CivilCam Pro · Free version';
}

// The logo for free PDFs: a large faded copy for the middle of the page and a small one for the
// footer. Built once from img/logo.png and kept for the session.
let watermarkCache = null;
function reportWatermark() {
  if (isPro()) return Promise.resolve(null);
  if (watermarkCache) return watermarkCache;
  watermarkCache = new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const big = document.createElement('canvas');
      big.width = big.height = 600;
      const b = big.getContext('2d');
      b.globalAlpha = 0.16;
      b.drawImage(img, 0, 0, 600, 600);
      const small = document.createElement('canvas');
      small.width = small.height = 96;
      small.getContext('2d').drawImage(img, 0, 0, 96, 96);
      resolve({ faded: big.toDataURL('image/png'), small: small.toDataURL('image/png') });
    };
    img.onerror = () => { watermarkCache = null; resolve(null); };
    img.src = 'img/logo.png';
  });
  return watermarkCache;
}

function renderBrandSection() {
  const box = document.getElementById('brand-section');
  if (!box) return;
  if (isPro()) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = `<div class="brand-note">
      <span><b>Free version:</b> PDF reports carry the CivilCam Pro logo on every page. Word, Excel, PowerPoint, Client view and Google Earth need Pro.</span>
      <div class="btn-row"><button class="btn small primary" onclick="openPaywall('report')">${ic('crown', 16)}Go Pro: reports without the logo</button></div>
    </div>`;
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
    const want = !adsHidden() && !covered && ((appOn && Ads.BANNER_TABS.includes(currentTab)) || projectsOn);
    if (force || want !== Ads.last) { Ads.last = want; window.AndroidBridge.setBannerVisible(want); }
  }
};
setInterval(() => Ads.refresh(false), 700);

// An interstitial at a natural break. Resolves when the ad is closed (or straight away).
function adBreak(placement) {
  if (adsHidden() || !bridgeHas('showInterstitial')) return Promise.resolve(false);
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
  const pro = isPaidPro();
  const promo = !pro && promoActive(), pi = promoInfo();
  if (bridgeHas('proPlans') && !Pro.plans.length) { try { Pro.plans = JSON.parse(window.AndroidBridge.proPlans()) || []; } catch (e) { /* none yet */ } }
  const plans = Pro.plans.slice().sort((a, b) => (a.plan === 'yearly' ? -1 : 1));
  document.getElementById('pro-body').innerHTML = `
    <div class="pro-hero">${ic('crown', 34)}<div><b>CivilCam Pro</b><span>${pro ? 'Active on this Google account. Thank you!' : promo ? esc(pi.message || `Free for everyone until ${promoUntilText()}. Enjoy every Pro feature.`) : Pro.from === 'promo-ended' ? 'The free period has ended. Keep every Pro feature with a subscription.' : Pro.from && Pro.from.startsWith('format-') ? `${esc((FORMATS[Pro.from.slice(7)] || {}).name || 'This')} reports are part of Pro.` : 'Client-ready reports in every format.'}</span></div></div>
    <ul class="pro-list">
      <li>${ic('check', 16)}PDF reports without the CivilCam logo, ready for your client</li>
      <li>${ic('check', 16)}Word, Excel and PowerPoint reports</li>
      <li>${ic('check', 16)}Client view and Google Earth files</li>
      ${promo && !pi.adsOff ? '' : `<li>${ic('check', 16)}No ads anywhere in the app</li>`}
      <li>${ic('check', 16)}Priority help from the CivilCam team</li>
    </ul>
    ${promo ? `<div class="note">After ${esc(promoUntilText())}, Word, Excel and PowerPoint need Pro again and free PDFs get the CivilCam logo. Subscribe now to keep everything:</div>` : ''}
    ${pro ? `<button class="btn block" onclick="managePro()">Manage subscription in Google Play</button>` :
      !hasAndroidBridge() ? `<div class="note">Subscriptions are bought in the Android app through Google Play.</div>` :
      plans.length ? plans.map(p => { const l = planLabel(p); return `<button class="btn block lg ${p.plan === 'yearly' ? 'primary' : ''} pro-plan" onclick="buyPro('${esc(p.plan)}')">
          <span><b>${esc(l.name)}</b>${l.trial ? '<em>7 days free, then</em>' : ''}</span><span>${esc(l.price)}</span></button>`; }).join('') :
      `<div class="note">Prices load from Google Play. If nothing shows, check the internet connection and open this again.</div>`}
    ${!pro && hasAndroidBridge() ? `<button class="link-btn" onclick="restorePro()">Already bought? Restore purchase</button>` : ''}
    <div class="note">${plans.some(p => p.trial) && !pro ? 'Nothing is charged during the 7-day trial. ' : ''}Payment and renewals are handled by Google Play. Cancel any time in Play Store → Payments &amp; subscriptions.</div>`;
}

function buyPro(plan) { if (bridgeHas('buyPro')) window.AndroidBridge.buyPro(plan); }
function restorePro() { if (bridgeHas('restorePro')) { window.AndroidBridge.restorePro(); showToast('Checking Google Play…'); } }
function managePro() { if (bridgeHas('managePro')) window.AndroidBridge.managePro(); }

document.addEventListener('DOMContentLoaded', () => setTimeout(() => { applyPro(); announcePromo(); }, 300));
// The free period can end while the app stays open: check again when it comes back to the front
document.addEventListener('visibilitychange', () => { if (!document.hidden) { applyPro(); announcePromo(); } });
