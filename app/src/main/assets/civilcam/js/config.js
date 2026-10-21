// ============================================================
// CLOUD SETTINGS — fill these in after creating the Firebase project
// (see firebase/SETUP.md). Leave them empty and the app works fully
// offline: sign-in, sync and AI buttons simply stay hidden.
// ============================================================
window.CIVILCAM_CONFIG = {
  firebase: {
    projectId: 'civilcam-pro-fpn',
    storageBucket: ''     // e.g. 'civilcam-pro.appspot.com' or 'civilcam-pro.firebasestorage.app'
  },
  // The AI function's URL after `firebase deploy --only functions`,
  // e.g. 'https://asia-south1-civilcam-pro.cloudfunctions.net/ai'
  aiEndpoint: ''
};
