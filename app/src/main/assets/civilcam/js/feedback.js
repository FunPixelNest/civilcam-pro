// ============================================================
// SUPPORT & SUGGESTIONS
// Opens the phone's e-mail app with the message addressed to the
// CivilCam Pro team, and (when signed in) also keeps a copy in the
// cloud so nothing is lost if the e-mail is never sent.
// ============================================================
const SUPPORT_EMAIL = 'info@funpixelnest.com';
const FEEDBACK_KINDS = ['Problem', 'Suggestion', 'Feature request', 'Question'];
let feedbackKind = 'Suggestion';

function openFeedback(kind) {
  if (kind) feedbackKind = kind;
  renderFeedbackKinds();
  const note = document.getElementById('fb-note');
  note.textContent = `Opens your e-mail app with the message ready to send to ${SUPPORT_EMAIL}. Just tap Send there.`;
  openSheet('feedback-sheet');
  setTimeout(() => document.getElementById('fb-text').focus(), 250);
}

function renderFeedbackKinds() {
  renderChips('fb-kind', 'feedbackKind', feedbackKind, v => { feedbackKind = v; renderFeedbackKinds(); }, { values: FEEDBACK_KINDS, plain: true });
}

function feedbackDetails() {
  const b = window.AndroidBridge;
  const v = b && typeof b.appVersion === 'function' ? b.appVersion() : '';
  const d = b && typeof b.deviceInfo === 'function' ? b.deviceInfo() : navigator.userAgent;
  return [
    'App: CivilCam Pro' + (v ? ' ' + v : ''),
    'Phone: ' + d,
    'Projects: ' + projects.length + ', photos: ' + photos.length,
    currentProject ? `Open project: ${currentProject.name} (${LAYOUTS_SITE[projectLayout(currentProject)].name})` : '',
    'Signed in: ' + (Account.isSignedIn() ? 'yes' : 'no') + (typeof Sync !== 'undefined' && Sync.enabled() ? ', backup: ' + Sync.statusText() : ''),
    typeof Sync !== 'undefined' && Sync.lastError && Sync.lastError() ? 'Last sync error: ' + Sync.lastError() : ''
  ].filter(Boolean).join('\n');
}

async function sendFeedback() {
  const text = document.getElementById('fb-text').value.trim();
  if (text.length < 3) { showToast('Please write a few words first', 'danger'); document.getElementById('fb-text').focus(); return; }
  const phone = document.getElementById('fb-phone').value.trim();
  const withInfo = document.getElementById('fb-info').checked;
  const who = [profile.name, profile.designation, profile.company].filter(Boolean).join(', ');
  const subject = `CivilCam Pro · ${feedbackKind}: ${text.replace(/\s+/g, ' ').slice(0, 60)}${text.length > 60 ? '…' : ''}`;
  const body = [
    text,
    '',
    '— ' + (who || 'CivilCam Pro user'),
    profile.email ? 'E-mail: ' + profile.email : '',
    phone ? 'Phone / WhatsApp: ' + phone : '',
    withInfo ? '\n' + feedbackDetails() : ''
  ].filter(x => x !== '').join('\n');

  saveFeedbackCopy({ kind: feedbackKind, text, phone, details: withInfo ? feedbackDetails() : '' });

  const b = window.AndroidBridge;
  if (b && typeof b.sendEmail === 'function') b.sendEmail(SUPPORT_EMAIL, subject, body);
  else window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  closeSheet('feedback-sheet');
  document.getElementById('fb-text').value = '';
  showToast('Your e-mail app is open with the message. Tap Send there. Thank you!', 'success');
}

// A copy in Firestore (feedback/{id}) when signed in; quietly skipped otherwise
async function saveFeedbackCopy(f) {
  try {
    if (!Account.available() || !Account.isSignedIn() || !navigator.onLine) return;
    const token = await Account.getToken();
    const s = v => ({ stringValue: String(v || '') });
    const fields = {
      kind: s(f.kind), text: s(f.text), phone: s(f.phone), details: s(f.details),
      name: s(profile.name), designation: s(profile.designation), company: s(profile.company), email: s(profile.email),
      uid: s(profile.uid), createdAt: { integerValue: String(Date.now()) }
    };
    await fetch(`https://firestore.googleapis.com/v1/projects/${CIVILCAM_CONFIG.firebase.projectId}/databases/(default)/documents/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ fields })
    });
  } catch (e) { /* the e-mail is the main route */ }
}
