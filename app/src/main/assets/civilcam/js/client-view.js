// ============================================================
// CLIENT VIEW
// One HTML file the client or consultant opens in any browser, on
// a phone or a PC, with no app and no sign-in. It holds the photos,
// a search box, activity filters, a draggable chainage strip,
// a photo viewer and the hindrance register.
// ============================================================
function buildClientView(list, imgs, meta, opts) {
  const sorted = list.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const data = {
    project: meta.fullName,
    title: meta.title,
    preparedBy: meta.preparedBy,
    made: fmtDate(new Date()) + ', ' + fmtTime(new Date()),
    showGps: !!opts.gps,
    showEngineer: !!opts.engineer,
    photos: sorted.map(p => {
      const im = imgs.get(p.id);
      return {
        id: p.id,
        img: im ? im.data : '',
        date: p.displayDate,
        time: p.displayTime,
        day: p.date || localDateKey(new Date(p.timestamp)),
        ts: new Date(p.timestamp).getTime(),
        activity: p.activity || '',
        ch: [p.element, chainageText(p)].filter(Boolean).join(' · '),
        chShort: [p.element, chainageText(p, 'short')].filter(Boolean).join(' · '),
        chM: photoChMid(p),
        side: p.side || '',
        type: p.photoType !== 'General' ? p.photoType : '',
        desc: p.description || '',
        fields: (p.fields || []).filter(f => f.value).map(f => [f.label, f.value]),
        engineer: p.engineer && p.engineer.name ? [p.engineer.name, p.engineer.designation].filter(Boolean).join(', ') : '',
        gps: p.location ? `${p.location.lat}, ${p.location.lng}` : '',
        hind: p.hind ? { ref: p.hind.ref, status: p.hind.status, cleared: p.hind.clearedAt ? fmtDate(p.hind.clearedAt) : '', days: hindDays(p), note: p.hind.clearedNote || '', after: p.hind.clearedPhotoId || '' } : null,
        repeatOf: p.repeatOf || ''
      };
    })
  };
  // "</" inside the JSON would end the <script> block early
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = CLIENT_VIEW_TEMPLATE
    .replace('%%TITLE%%', () => esc(`${meta.fullName} — ${meta.title}`))
    .replace('%%DATA%%', () => json);
  return new Blob([html], { type: 'text/html' });
}

const CLIENT_VIEW_TEMPLATE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%%TITLE%%</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#111;--text2:#555;--line:#dde1e6;--accent:#1f2937;--hi:#d97706;--ok:#15803d;--bad:#b91c1c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:var(--card);border-bottom:1px solid var(--line);padding:16px}
h1{font-size:18px;margin:0}
h2{font-size:15px;margin:0 0 2px}
.sub{color:var(--text2);font-size:12px}
.wrap{max-width:1100px;margin:0 auto;padding:0 16px}
.stats{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.stat{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12px}
.stat b{font-size:15px;margin-right:4px}
.bar{position:sticky;top:0;z-index:5;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--line)}
input[type=search]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;background:#fff}
.chips{display:flex;gap:6px;overflow-x:auto;padding-top:8px;scrollbar-width:none}
.chip{flex-shrink:0;border:1px solid var(--line);background:#fff;border-radius:16px;padding:5px 11px;font:inherit;font-size:12px;cursor:pointer}
.chip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
section{margin:16px 0}
.strip{position:relative;height:64px;margin-top:30px!important;background:#fff;border:1px solid var(--line);border-radius:8px;touch-action:none;cursor:ew-resize;user-select:none;margin-top:8px}
.strip .road{position:absolute;left:0;right:0;top:31px;height:2px;background:#9ca3af}
.strip .dot{position:absolute;width:7px;height:7px;border-radius:50%;background:var(--accent);margin-left:-3px}
.strip .head{position:absolute;top:0;bottom:0;width:2px;background:var(--hi);margin-left:-1px}
.strip .head span{position:absolute;top:-22px;left:50%;transform:translateX(-50%);background:var(--hi);color:#fff;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;white-space:nowrap}
.axis{display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-top:3px}
.near{display:flex;gap:8px;overflow-x:auto;padding:8px 0}
.near img{height:90px;border-radius:6px;cursor:pointer}
.day{font-weight:700;font-size:13px;margin:16px 0 8px;color:var(--text2)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;cursor:pointer;text-align:left;padding:0;font:inherit}
.card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#e5e7eb}
.card div{padding:6px 8px;font-size:12px}
.card b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tag{display:inline-block;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:#fee2e2;color:var(--bad)}
.tag.ok{background:#dcfce7;color:var(--ok)}
table{width:100%;border-collapse:collapse;background:#fff;font-size:12px}
th,td{border:1px solid var(--line);padding:6px;vertical-align:top;text-align:left}
th{background:#f3f4f6}
td img{width:110px;border-radius:4px;cursor:pointer}
.tablewrap{overflow-x:auto}
.empty{color:var(--text2);padding:30px;text-align:center}
.lb{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:20;display:none;flex-direction:column}
.lb.on{display:flex}
.lb-img{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.lb-img img{max-width:100%;max-height:100%;object-fit:contain}
.lb-info{background:#fff;padding:12px 16px;max-height:40vh;overflow:auto}
.lb-info dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:6px 0 0;font-size:13px}
.lb-info dt{color:var(--text2)}
.lb-info dd{margin:0}
.lb button.x,.lb button.nav{position:absolute;background:rgba(255,255,255,.15);color:#fff;border:0;border-radius:50%;width:44px;height:44px;font-size:22px;cursor:pointer}
.lb .x{top:10px;right:10px}
.lb .nav{top:40%}
.lb .prev{left:8px}.lb .next{right:8px}
footer{color:var(--text2);font-size:11px;text-align:center;padding:24px 16px}
@media print{.bar,.strip-sec,.lb{display:none!important}.card{break-inside:avoid}}
</style></head>
<body>
<header><div class="wrap">
  <h1 id="p"></h1><div class="sub" id="t"></div>
  <div class="stats" id="stats"></div>
</div></header>
<div class="wrap">
  <div class="bar">
    <input type="search" id="q" placeholder="Search activity, chainage, remarks…">
    <div class="chips" id="acts"></div>
  </div>
  <section class="strip-sec" id="strip-sec" hidden>
    <h2>Along the road</h2><div class="sub">Drag along the line to see the photos at each chainage.</div>
    <div class="strip" id="strip"><div class="road"></div><div class="head" id="head"><span id="headlbl"></span></div></div>
    <div class="axis"><span id="ax0"></span><span id="ax1"></span></div>
    <div class="near" id="near"></div>
  </section>
  <section id="hind-sec" hidden>
    <h2>Hindrance register</h2>
    <div class="tablewrap"><table id="hind"></table></div>
  </section>
  <section><h2 id="count"></h2><div id="list"></div></section>
</div>
<footer id="foot"></footer>
<div class="lb" id="lb">
  <div class="lb-img"><img id="lb-img" alt=""></div>
  <button class="x" onclick="closeLb()" aria-label="Close">×</button>
  <button class="nav prev" onclick="step(-1)" aria-label="Previous">‹</button>
  <button class="nav next" onclick="step(1)" aria-label="Next">›</button>
  <div class="lb-info" id="lb-info"></div>
</div>
<script type="application/json" id="data">%%DATA%%</script>
<script>
var D = JSON.parse(document.getElementById('data').textContent);
var P = D.photos, act = '', shown = [], cur = -1;
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function byId(id){for(var i=0;i<P.length;i++)if(P[i].id===id)return P[i];return null}
document.getElementById('p').textContent = D.project;
document.getElementById('t').textContent = D.title;
document.getElementById('foot').textContent = 'Made with CivilCam Pro on ' + D.made + (D.preparedBy ? ' · Prepared by ' + D.preparedBy : '');
var days = {}, acts = {}, hinds = P.filter(function(p){return p.hind});
P.forEach(function(p){days[p.day]=1; if(p.activity)acts[p.activity]=(acts[p.activity]||0)+1});
var openH = hinds.filter(function(p){return p.hind.status!=='cleared'}).length;
document.getElementById('stats').innerHTML =
  '<span class="stat"><b>'+P.length+'</b>photos</span><span class="stat"><b>'+Object.keys(days).length+'</b>site day'+(Object.keys(days).length===1?'':'s')+'</span>' +
  (P.length ? '<span class="stat">'+e(P[P.length-1].date)+' to '+e(P[0].date)+'</span>' : '') +
  (hinds.length ? '<span class="stat"><b>'+openH+'</b>hindrance'+(openH===1?'':'s')+' open</span>' : '');
function chips(){
  var a = [['', 'All']].concat(Object.keys(acts).sort().map(function(k){return [k, k+' · '+acts[k]]}));
  document.getElementById('acts').innerHTML = a.map(function(x){return '<button class="chip'+(act===x[0]?' on':'')+'" data-a="'+e(x[0])+'">'+e(x[1])+'</button>'}).join('');
}
document.getElementById('acts').onclick = function(ev){var b=ev.target.closest('.chip'); if(!b)return; act=b.getAttribute('data-a'); chips(); render()};
document.getElementById('q').oninput = render;
function match(p){
  if (act && p.activity !== act) return false;
  var q = document.getElementById('q').value.trim().toLowerCase();
  if (!q) return true;
  return [p.activity,p.ch,p.side,p.type,p.desc,p.date,p.hind&&p.hind.ref].concat(p.fields.map(function(f){return f[1]})).join(' ').toLowerCase().indexOf(q) >= 0;
}
function card(p){
  return '<button class="card" data-id="'+p.id+'"><img loading="lazy" src="'+p.img+'" alt=""><div><b>'+e(p.activity||p.type||'Photo')+'</b>'+
    e([p.chShort?'Ch '+p.chShort:'',p.side].filter(Boolean).join(' · ')||p.time)+
    (p.hind?' <span class="tag'+(p.hind.status==='cleared'?' ok':'')+'">'+e(p.hind.ref)+'</span>':'')+'</div></button>';
}
function render(){
  shown = P.filter(match);
  document.getElementById('count').textContent = shown.length + ' photo' + (shown.length===1?'':'s');
  if (!shown.length) { document.getElementById('list').innerHTML = '<div class="empty">No photos match.</div>'; drawStrip(); return; }
  var html = '', last = '';
  shown.forEach(function(p){ if (p.day !== last) { if (last) html += '</div>'; html += '<div class="day">'+e(p.date)+'</div><div class="grid">'; last = p.day; } html += card(p); });
  document.getElementById('list').innerHTML = html + '</div>';
  drawStrip();
}
document.addEventListener('click', function(ev){var c=ev.target.closest('[data-id]'); if(c) openLb(c.getAttribute('data-id'))});
// ---- chainage strip ----
var lo = Infinity, hi = -Infinity, pos = null;
P.forEach(function(p){ if (p.chM != null) { lo = Math.min(lo, p.chM); hi = Math.max(hi, p.chM); } });
function fmtCh(m){ m=Math.round(m); return Math.floor(m/1000)+'+'+String(m%1000).padStart(3,'0'); }
function x(m){ return hi>lo ? (m-lo)/(hi-lo)*100 : 50; }
function drawStrip(){
  if (lo === Infinity) return;
  document.getElementById('strip-sec').hidden = false;
  var s = document.getElementById('strip');
  s.querySelectorAll('.dot').forEach(function(d){d.remove()});
  shown.filter(function(p){return p.chM!=null}).forEach(function(p){
    var d = document.createElement('div'); d.className = 'dot';
    d.style.left = x(p.chM)+'%'; d.style.top = (p.side==='LHS'?16:p.side==='RHS'?42:29)+'px'; s.appendChild(d);
  });
  document.getElementById('ax0').textContent = fmtCh(lo); document.getElementById('ax1').textContent = fmtCh(hi);
  if (pos == null) pos = lo;
  setPos(pos);
}
function setPos(m){
  pos = Math.max(lo, Math.min(hi, m));
  document.getElementById('head').style.left = x(pos)+'%';
  var lbl = document.getElementById('headlbl'), xp = x(pos);
  lbl.textContent = 'Ch ' + fmtCh(pos);
  lbl.style.left = xp < 12 ? '0' : xp > 88 ? 'auto' : '50%';
  lbl.style.right = xp > 88 ? '0' : 'auto';
  lbl.style.transform = xp < 12 || xp > 88 ? 'none' : 'translateX(-50%)';
  var reach = Math.max(50, (hi-lo)/40);
  var near = shown.filter(function(p){return p.chM!=null && Math.abs(p.chM-pos)<=reach}).sort(function(a,b){return Math.abs(a.chM-pos)-Math.abs(b.chM-pos)}).slice(0,20);
  document.getElementById('near').innerHTML = near.length ? near.map(function(p){return '<img data-id="'+p.id+'" src="'+p.img+'" title="'+e(p.date+' · '+p.ch)+'" alt="">'}).join('') : '<span class="sub">No photos near here.</span>';
}
(function(){
  var s = document.getElementById('strip'), down = false;
  function mv(ev){ if(!down)return; var r=s.getBoundingClientRect(); setPos(lo + (ev.clientX-r.left)/r.width*(hi-lo)); }
  s.addEventListener('pointerdown', function(ev){ down=true; s.setPointerCapture(ev.pointerId); mv(ev); });
  s.addEventListener('pointermove', mv);
  s.addEventListener('pointerup', function(){ down=false; });
})();
// ---- hindrance register ----
if (hinds.length) {
  document.getElementById('hind-sec').hidden = false;
  document.getElementById('hind').innerHTML = '<tr><th>Ref</th><th>Chainage</th><th>Details</th><th>Raised</th><th>Status</th><th>Raised photo</th><th>Cleared photo</th></tr>' +
    hinds.slice().sort(function(a,b){return a.ts-b.ts}).map(function(p){
      var h = p.hind, after = h.after ? byId(h.after) : null;
      return '<tr><td><b>'+e(h.ref)+'</b></td><td>'+e([p.ch,p.side].filter(Boolean).join(' · '))+'</td><td>'+
        e(p.fields.map(function(f){return f[0]+': '+f[1]}).concat(p.desc?[p.desc]:[]).join('; '))+(h.note?'<br><i>Cleared: '+e(h.note)+'</i>':'')+
        '</td><td>'+e(p.date)+'</td><td>'+(h.status==='cleared'?'<span class="tag ok">Cleared '+e(h.cleared)+'</span><br>'+h.days+' days':'<span class="tag">Open</span><br>'+h.days+' days')+
        '</td><td><img data-id="'+p.id+'" src="'+p.img+'" alt=""></td><td>'+(after?'<img data-id="'+after.id+'" src="'+after.img+'" alt="">':'')+'</td></tr>';
    }).join('');
}
// ---- viewer ----
function openLb(id){
  cur = shown.findIndex(function(p){return p.id===id});
  var p = cur >= 0 ? shown[cur] : byId(id);
  if (!p) return;
  document.getElementById('lb-img').src = p.img;
  var rows = [['Date',p.date+', '+p.time],['Activity',p.activity],['Chainage',p.ch],['Side',p.side],['Type',p.type],
    ['Hindrance',p.hind?p.hind.ref+' · '+(p.hind.status==='cleared'?'cleared '+p.hind.cleared:'open, '+p.hind.days+' days'):'']]
    .concat(p.fields).concat([['Remarks',p.desc],['Engineer',D.showEngineer?p.engineer:''],['GPS',D.showGps?p.gps:'']]);
  document.getElementById('lb-info').innerHTML = '<dl>'+rows.filter(function(r){return r[1]}).map(function(r){return '<dt>'+e(r[0])+'</dt><dd>'+e(r[1])+'</dd>'}).join('')+'</dl>';
  document.getElementById('lb').classList.add('on');
}
function closeLb(){ document.getElementById('lb').classList.remove('on'); }
function step(d){ if (cur < 0 || !shown.length) return; cur = (cur + d + shown.length) % shown.length; openLb(shown[cur].id); }
document.addEventListener('keydown', function(ev){ if(!document.getElementById('lb').classList.contains('on'))return; if(ev.key==='Escape')closeLb(); if(ev.key==='ArrowLeft')step(-1); if(ev.key==='ArrowRight')step(1); });
chips(); render();
</script>
</body></html>`;
