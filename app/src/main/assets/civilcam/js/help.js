// ============================================================
// HOW IT WORKS — a short guide to every part of the app.
// Opened from the ? button, the Account sheet, and once on first use.
// ============================================================
const HELP = [
  { ic: 'folder', t: 'Projects', s: [
    'Tap <b>New project</b>. Give a short name (shown on photos) and the full name (shown on reports).',
    'Pick the project type. Roads, canals, rail and pipelines use chainage (e.g. 0+000 to 25+000); bridges use piers; buildings use floors; plants use zones.',
    'Every photo you take goes into the open project.',
    'To <b>edit</b> a project, add your <b>team</b> or <b>add photos from other apps</b>: tap the project name at the top of the camera (or the <b>Project</b> button on the other screens). On the Projects list, each project also has <b>Open</b>, <b>Edit</b> and <b>Team</b> buttons.'] },
  { ic: 'camera', t: 'Taking photos', s: [
    'Set the details once with the <b>details</b> panel: type, activity, chainage, side, description. They stay for every photo until you change them.',
    'Each photo is stamped with your name, project, chainage, date, time, GPS, height above sea level, place name and the compass direction.',
    'After each photo the app checks that it is not blurred.',
    '<b>Same spot again</b>: open an old photo and tap <b>Photo, same spot</b>. The old photo shows faintly over the camera so the new one lines up, and GPS tells you how far away you are.'] },
  { ic: 'image', t: 'Gallery', s: [
    'All photos of the project, newest first. Use the filters (period, activity, side, type, chainage) or type in the search box.',
    '<b>Select photos</b>: press and hold a photo until the phone vibrates, then tap more photos. The bar at the bottom lets you <b>Share</b> (WhatsApp or any app), <b>Save</b> to the phone, make a report or delete.',
    'Tap a photo to open it full screen, edit its details, share it, or open it in Google Drive / OneDrive.',
    'Photos from other engineers in your team show a name badge. They arrive as small previews to save data; tap <b>Full</b> to get the full photo only when you need it.'] },
  { ic: 'strip', t: 'Chainage strip and site map', s: [
    'Every photo is placed on a drawing of the site: along the chainage for roads, by pier for bridges, by floor for buildings.',
    'Drag to move, pinch to zoom. Tap a location to see all its photos date-wise, compare before and after, or make a report of just that location.',
    'LHS photos are shown above the line, RHS below.'] },
  { ic: 'alert', t: 'Hindrances', s: [
    'Take a photo with type <b>Hindrance</b> (trees, shops, utilities, land not handed over...). It gets a number like H-001 and is listed here.',
    'When it is removed, tap <b>Clear</b> and take a clearance photo from the same spot as proof.',
    'The register goes into reports, so the client sees what is still holding up work.'] },
  { ic: 'file', t: 'Reports', s: [
    'Choose the photos (all, a period, filters, or the ones you selected), a layout (1, 2, 4 or 6 per page, or same location date-wise) and a format.',
    '<b>PDF</b> to submit, <b>Word</b> to edit, <b>Excel</b> photo register, <b>PowerPoint</b> for meetings, <b>Client view</b> (one file that opens in any browser, no app) and <b>Google Earth</b> (photo spots on a map).',
    'When the report is ready: WhatsApp, Share, Open or Save. Reports are kept in Download / CivilCam.'] },
  { ic: 'download', t: 'Photos from other camera apps', s: [
    'Photos taken with GPS Map Camera, Timestamp Camera, the phone camera or any app can be added: tap <b>Add photos from other camera apps</b> at the top of the Gallery (or in the project menu).',
    '<b>Pick photos</b> once, or add a <b>synced camera folder</b>; new photos in that folder are offered every time you open the app.',
    'Date, time and GPS saved inside the photos are kept. Chainage is suggested from your nearby photos. You can check each photo before it is added, and add the CivilCam stamp if you want.'] },
  { ic: 'users', t: 'Team: engineers on the same project', s: [
    'Everyone must <b>sign in</b> first (Account › Sign in). Use the same e-mail you will give your team.',
    'On the Projects list tap <b>Team</b> under the project (or, inside a project, tap the project name › <b>Team: add engineers</b>). Type each engineer\'s sign-in e-mail under <b>Team</b>, tap <b>Add</b>, then <b>Save project</b>.',
    'Tap <b>Tell them on WhatsApp</b> to send them the invitation. When they sign in with that e-mail, the project and all its photos appear on their phone.',
    'Everyone sees everyone\'s photos. Only the owner can add or remove engineers; a member can leave the team.',
    'Full photos are never downloaded by themselves. Each engineer chooses: save to the phone, save to their own Google Drive or OneDrive, or keep in the app.'] },
  { ic: 'cloud', t: 'Sign-in and backup', s: [
    'Without signing in, everything stays on this phone only.',
    'Sign in with Google, Microsoft or Apple to back up and to share projects. The top-right pill shows <b>On phone</b>, <b>Syncing</b> or <b>Backed up</b>.',
    'Full photos are kept in <b>your own cloud</b>: <b>Google Drive</b> (folder CivilCam) if you sign in with Google, <b>OneDrive</b> (Apps › CivilCam Pro) if you sign in with Microsoft. You can change it in Account. The app can only see the files it made. The company database keeps just the details and a small preview.',
    'In a team, everyone can use a different cloud: one engineer on Google Drive, another on OneDrive. Photos still show for everyone.'] },
  { ic: 'crown', t: 'Free and Pro', s: [
    'The app is free with ads. There are never ads on the camera.',
    'Free reports carry a small "Made with CivilCam Pro" line. Watch a short video to remove it from one report.',
    '<b>CivilCam Pro</b> (monthly or yearly) removes all ads and that line. Manage or cancel any time in Google Play.'] },
  { ic: 'mail', t: 'Help and ideas', s: [
    'Found a problem or have an idea? Tap <b>Support &amp; suggestions</b>. It goes straight to the CivilCam Pro team.'] }
];

function renderHelp() {
  document.getElementById('help-list').innerHTML = HELP.map((h, i) => `
    <details class="help-item"${i === 0 ? ' open' : ''}>
      <summary><span class="help-ic">${ic(h.ic, 18)}</span><b>${h.t}</b>${ic('chevronDown', 16)}</summary>
      <ul>${h.s.map(x => `<li>${x}</li>`).join('')}</ul>
    </details>`).join('');
}

function openHelp(section) {
  renderHelp();
  openSheet('help-sheet');
  if (section != null) {
    const items = document.querySelectorAll('#help-list .help-item');
    items.forEach((d, i) => { d.open = HELP[i].t.toLowerCase().startsWith(section); });
    const target = [...items].find(d => d.open);
    if (target) setTimeout(() => target.scrollIntoView({ block: 'start' }), 50);
  }
  try { localStorage.setItem('civilcam_help_seen', '1'); } catch (e) {}
}

// Shown once, after the engineer's details are filled in for the first time
function maybeShowHelpFirstTime() {
  let seen = '1';
  try { seen = localStorage.getItem('civilcam_help_seen'); } catch (e) {}
  if (!seen) setTimeout(() => openHelp(), 600);
}

// The Team button: opens the project's Team section directly
function openTeam(p) {
  p = p || currentProject;
  if (!p) return;
  openProjectSheet(p);
  setTimeout(() => {
    const block = document.getElementById('pj-team-block');
    if (block) block.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const input = document.getElementById('pj-team-email');
    if (input && input.offsetParent) input.focus();
  }, 250);
}

// Project options: one place for Edit, Team, Import, Reports, Change project, Help
function openProjectMenu() {
  if (!currentProject) { showProjects(); return; }
  document.getElementById('pm-title').textContent = currentProject.name;
  document.getElementById('pm-sub').textContent = currentProject.fullName || '';
  const n = teamCount(currentProject);
  document.getElementById('pm-team').textContent = n > 1 ? `${n} engineers share this project` : 'Share this project with other engineers by e-mail';
  openSheet('project-menu');
}

// The "How it works" card on the Projects screen, until the engineer hides it
function hideHelpBanner() {
  try { localStorage.setItem('civilcam_help_banner_hidden', '1'); } catch (e) {}
  const b = document.getElementById('help-banner'); if (b) b.style.display = 'none';
}
(function () {
  let hidden = false;
  try { hidden = localStorage.getItem('civilcam_help_banner_hidden') === '1'; } catch (e) {}
  const b = document.getElementById('help-banner');
  if (b && hidden) b.style.display = 'none';
})();
