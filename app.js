
/**
 * Incanto Ops+ Cloud v4 — App
 * - Role-scoped nav injection
 * - Local stores (IndexedDB) + hooks for Supabase sync (sync.js)
 * - Uses provided logo in header/login/portal
 */

const DB = 'incanto_ops_plus_v4';
const VER = 1;

let db;
let currentUser = null; // {id, name, role}
let running = null; // {userId, areaId, note, start, geoStart?}
let tickTimer = null;
let lastGeo = null;

const ROLE_LABEL = { putzkraft:'Putzkraft', personal:'Personalmanagement', geschaeft:'Geschäftsführung' };

// -------- Util --------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pad = n => String(n).padStart(2,'0');
const fmtDuration = ms => { const sec=Math.floor(ms/1000); const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60; return `${pad(h)}:${pad(m)}:${pad(s)}`; };
const fmtDateTime = ts => { const d = new Date(ts); return d.toLocaleString('de-DE', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}); };
const fmtDate = ts => new Date(ts).toISOString().slice(0,10);
const groupBy = (xs,f) => xs.reduce((a,x)=>{ const k=f(x); (a[k] ||= []).push(x); return a; }, {});
const roundMs = (ms, step)=> { if(!step) return ms; const s = step*60*1000; return Math.round(ms/s)*s; };
function mapsLink(lat, lon, label='Ort'){ return `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(label)}`; }

// -------- Crypto (PIN) --------
async function sha256Hex(str){ const enc = new TextEncoder().encode(str); const buf = await crypto.subtle.digest('SHA-256', enc); return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function salt(len=12){ const a=new Uint8Array(len); crypto.getRandomValues(a); return [...a].map(b=>b.toString(16).padStart(2,'0')).join(''); }

// -------- IDB --------
function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB, VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath:'id', autoIncrement:true });
      if(!db.objectStoreNames.contains('areas')) db.createObjectStore('areas', { keyPath:'id', autoIncrement:true });
      if(!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath:'id', autoIncrement:true });
      if(!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath:'id', autoIncrement:true });
      if(!db.objectStoreNames.contains('orders')) db.createObjectStore('orders', { keyPath:'id', autoIncrement:true });
      if(!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath:'id', autoIncrement:true });
      if(!db.objectStoreNames.contains('clients')) db.createObjectStore('clients', { keyPath:'id', autoIncrement:true });
      if(!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath:'key' });
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function tx(store, mode='readonly'){ return db.transaction(store, mode); }
function idbAll(store){ return new Promise((res,rej)=>{ const r=tx(store).objectStore(store).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
function idbAdd(store, v){ return new Promise((res,rej)=>{ const r=tx(store,'readwrite').objectStore(store).add(v); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function idbPut(store, v){ return new Promise((res,rej)=>{ const r=tx(store,'readwrite').objectStore(store).put(v); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function idbGet(store, id){ return new Promise((res,rej)=>{ const r=tx(store).objectStore(store).get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function idbDel(store, id){ return new Promise((res,rej)=>{ const r=tx(store,'readwrite').objectStore(store).delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
async function getSetting(key, fallback=null){ const v=await idbGet('settings', key); return v? v.value : fallback; }
async function setSetting(key, value){ await idbPut('settings', { key, value }); }

// -------- Role-aware navigation --------
function renderRoleNav(){
  if(!currentUser) return;
  const role = currentUser.role;
  const nav = $('#role-nav');
  const buttons = [];

  const push = (tab, label) => buttons.push(`<button data-tab="${tab}" class="nav-btn">${label}</button>`);

  if(role === 'putzkraft'){
    push('orders','Einsätze'); push('timer','Timer'); push('entries','Einträge'); push('tasks','Aufgaben');
  }else if(role === 'personal'){
    push('orders','Einsätze'); push('entries','Einträge'); push('tasks','Aufgaben'); push('areas','Arbeitsbereiche'); push('portal','Kundenportal'); push('export','Export');
  }else{ // geschaeft
    push('orders','Einsätze'); push('timer','Timer'); push('entries','Einträge'); push('tasks','Aufgaben'); push('areas','Arbeitsbereiche'); push('portal','Kundenportal'); push('export','Export'); push('admin','Admin'); push('settings','Einstellungen');
  }
  buttons.push('<button id="btn-logout" class="nav-btn ghost">Logout</button>');
  nav.innerHTML = buttons.join(' ');

  // activate first visible tab
  const firstTab = (nav.querySelector('[data-tab]')||{}).dataset?.tab;
  if(firstTab){ $$('.tab').forEach(t=>t.classList.remove('active')); $('#tab-'+firstTab)?.classList.add('active'); }
  // set active class
  nav.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click', ()=>{
    const name = btn.dataset.tab;
    nav.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active', b===btn));
    $$('.tab').forEach(t=>t.classList.toggle('active', t.id===`tab-${name}`));
    if(name==='orders') renderOrders();
    if(name==='entries') renderEntries();
    if(name==='admin') renderEntries(true);
    if(name==='tasks') renderTasks();
    if(name==='areas') renderAreas();
    if(name==='portal'){ renderClients(); fillPortalClientSelect(); renderApprovals(); }
  }));

  // wire logout
  $('#btn-logout')?.addEventListener('click', logout);
}

// -------- Auth --------
async function ensureInitialData(){
  const users = await idbAll('users');
  if(users.length===0){
    $('#auth-setup').classList.remove('hidden');
    $('#auth-login').classList.add('hidden');
    $('#auth').classList.remove('hidden');
  }else{
    await populateLoginUsers();
    $('#auth-setup').classList.add('hidden');
    $('#auth-login').classList.remove('hidden');
    $('#auth').classList.remove('hidden');
  }
}
async function populateLoginUsers(){ const users = await idbAll('users'); $('#login-user').innerHTML = users.map(u=>`<option value="${u.id}">${u.name} — ${ROLE_LABEL[u.role]||u.role}</option>`).join(''); }
async function createAdmin(pin){ const s=salt(); const h=await sha256Hex(s+pin); await idbAdd('users', { name:'Admin', role:'geschaeft', salt:s, hash:h, createdAt:Date.now() }); }
async function login(userId, pin){
  const u = await idbGet('users', Number(userId)); if(!u) throw new Error('Unbekannter Benutzer');
  const h = await sha256Hex((u.salt||'') + pin);
  if(h !== u.hash) throw new Error('PIN falsch');
  currentUser = { id:u.id, name:u.name, role:u.role };
  sessionStorage.setItem('incanto-v4-current', JSON.stringify(currentUser));
  $('#auth').classList.add('hidden');
  $('#user-name-label').textContent = currentUser.name;
  $('#user-role-label').textContent = ROLE_LABEL[currentUser.role]||currentUser.role;
  renderRoleNav();
  await initAfterLogin();
}
function logout(){
  currentUser=null; sessionStorage.removeItem('incanto-v4-current');
  $('#auth').classList.remove('hidden');
  populateLoginUsers();
  $('#auth-login').classList.remove('hidden');
  $('#auth-setup').classList.add('hidden');
}

// -------- Areas --------
async function ensureDefaultArea(){ if((await idbAll('areas')).length===0){ await idbAdd('areas', { name:'Allgemein', color:'#14b8a6', createdAt: Date.now() }); } }
async function loadAreas(){ const areas = await idbAll('areas'); const opts = areas.map(a=>`<option value="${a.id}">${a.name}</option>`).join(''); $('#timer-area').innerHTML = opts; $('#task-area').innerHTML = `<option value="">—</option>` + opts; }
async function renderAreas(){
  const wrap = $('#areas-list'); const areas = await idbAll('areas'); const entries = await idbAll('entries'); const byArea = groupBy(entries, e=>e.areaId);
  wrap.innerHTML = areas.map(a=>`
    <li class="project-item">
      <span class="badge" style="background:${a.color}"></span>
      <div><div style="font-weight:800">${a.name}</div><div class="hint">${(byArea[a.id]||[]).length} Einträge</div></div>
      ${(currentUser.role!=='putzkraft') ? `<div class="project-actions">
        <button class="action" data-rename="${a.id}">Umbenennen</button>
        <button class="action" data-color="${a.id}">Farbe</button>
        <button class="action" data-del="${a.id}">Löschen</button>
      </div>` : ''}
    </li>`).join('');
  if(currentUser.role!=='putzkraft'){
    wrap.querySelectorAll('[data-rename]').forEach(b=>b.addEventListener('click', async()=>{ const id=Number(b.dataset.rename); const a=await idbGet('areas', id); if(!a) return; const name=prompt('Neuer Name', a.name); if(!name) return; a.name=name.trim(); await idbPut('areas', a); await renderAreas(); await loadAreas(); }));
    wrap.querySelectorAll('[data-color]').forEach(b=>b.addEventListener('click', async()=>{ const id=Number(b.dataset.color); const a=await idbGet('areas', id); if(!a) return; const color=prompt('Neue Farbe (HEX)', a.color); if(!color) return; a.color=color; await idbPut('areas', a); await renderAreas(); }));
    wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async()=>{ const id=Number(b.dataset.del); const entries = await idbAll('entries'); const count = entries.filter(e=>e.areaId===id).length; if(count>0){ alert('Bereich enthält Einträge.'); return; } if(confirm('Bereich löschen?')){ await idbDel('areas', id); await renderAreas(); await loadAreas(); } }));
  }
}

// -------- Users --------
async function renderUsers(){
  const users = await idbAll('users');
  const wrap = $('#users-list');
  wrap.innerHTML = users.map(u=>`
    <li class="project-item">
      <span class="badge" style="background:${u.role==='putzkraft'?'#60a5fa':u.role==='personal'?'#10b981':'#f59e0b'}"></span>
      <div><div style="font-weight:800">${u.name}</div><div class="hint">${ROLE_LABEL[u.role]}</div></div>
      <div class="project-actions">
        <button class="action" data-role="${u.id}">Rolle</button>
        <button class="action" data-pin="${u.id}">PIN</button>
        <button class="action" data-del="${u.id}">Löschen</button>
      </div>
    </li>`).join('');
  wrap.querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click', async()=>{ const id=Number(b.dataset.role); const u=await idbGet('users', id); if(!u) return; const role=prompt('Rolle (putzkraft|personal|geschaeft)', u.role); if(!role||!['putzkraft','personal','geschaeft'].includes(role)) return; u.role=role; await idbPut('users', u); await renderUsers(); }));
  wrap.querySelectorAll('[data-pin]').forEach(b=>b.addEventListener('click', async()=>{ const id=Number(b.dataset.pin); const u=await idbGet('users', id); if(!u) return; const pin=prompt('Neue PIN (4–8)'); if(!pin) return; const s=u.salt||salt(); const h=await sha256Hex(s+pin); u.salt=s; u.hash=h; await idbPut('users', u); alert('PIN gesetzt.'); }));
  wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async()=>{ const id=Number(b.dataset.del); const u=await idbGet('users', id); if(!u) return; if(u.role==='geschaeft'){ alert('Admin kann nicht gelöscht werden.'); return; } if(confirm('Benutzer löschen?')){ await idbDel('users', id); await renderUsers(); } }));
}
async function populateUserSelects(){ const users = await idbAll('users'); const opts = users.map(u=>`<option value="${u.id}">${u.name}</option>`).join(''); $('#task-assign').innerHTML = `<option value="">—</option>` + opts; $('#filter-user').innerHTML = `<option value="">Alle</option>` + opts; $('#export-user').innerHTML = `<option value="">Alle</option>` + opts; }

// -------- Files (photos/signatures) --------
async function saveDataUrl(dataUrl){ return await idbAdd('files', { dataUrl, createdAt: Date.now() }); }
async function getFile(id){ return await idbGet('files', id); }

// -------- Orders (Einsätze) --------
// order: {id, title, areaId, assignedTo, startPlan, endPlan, instructions, address, lat, lon, photos:[fileId], signature:fileId, status, published?, approved?}
async function addOrder(o){ return await idbAdd('orders', o); }
async function updateOrder(o){ return await idbPut('orders', o); }
async function renderOrders(){
  const wrap = $('#orders-list'); const mine = $('#orders-mine').checked;
  const from = $('#orders-from').value ? new Date($('#orders-from').value).getTime() : 0;
  const to = $('#orders-to').value ? (new Date($('#orders-to').value).getTime() + 24*3600*1000 - 1) : Number.MAX_SAFE_INTEGER;
  const orders = (await idbAll('orders')).filter(o => (!mine || o.assignedTo===currentUser.id) && (!o.startPlan || (o.startPlan>=from && o.startPlan<=to))).sort((a,b)=> (a.startPlan||0)-(b.startPlan||0));
  const users = await idbAll('users'); const areas = await idbAll('areas');
  const uname = id => (users.find(u=>u.id===id)||{}).name || '—'; const aname = id => (areas.find(a=>a.id===id)||{}).name || '—';

  async function photoThumbs(ids){ if(!ids||!ids.length) return ''; let out=''; for(const fid of ids){ const f=await getFile(fid); if(f) out += `<img src="${f.dataUrl}" alt="Foto">`; } return out; }

  wrap.innerHTML = '';
  for(const o of orders){
    const photos = await photoThumbs(o.photos||[]);
    const sig = o.signature ? `<a class="action" href="${(await getFile(o.signature)).dataUrl}" download="unterschrift.png">Unterschrift</a>` : '';
    const geo = (o.lat && o.lon) ? `<a class="action" target="_blank" href="${mapsLink(o.lat,o.lon,o.address||o.title)}">Karte</a>` : '';
    const when = o.startPlan ? `${fmtDateTime(o.startPlan)} – ${o.endPlan?fmtDateTime(o.endPlan):''}` : 'ohne Plan';
    const status = o.status || 'geplant';

    const controls = [];
    if(currentUser.role!=='putzkraft' || o.assignedTo===currentUser.id){
      controls.push(`<button class="action" data-start="${o.id}">Start</button>`);
      controls.push(`<button class="action" data-stop="${o.id}">Stop</button>`);
      controls.push(`<button class="action" data-sign="${o.id}">Unterschrift</button>`);
      controls.push(`<label class="action"><input type="file" data-photo="${o.id}" accept="image/*" capture="environment" hidden>Foto</label>`);
    }
    if(currentUser.role!=='putzkraft'){
      controls.push(`<button class="action" data-edit="${o.id}">Bearbeiten</button>`);
      controls.push(`<button class="action" data-del="${o.id}">Löschen</button>`);
      controls.push(`<label class="action"><input type="checkbox" data-pub-order="${o.id}" ${o.published?'checked':''}> Freigeben</label>`);
      controls.push(`<label class="action"><input type="checkbox" data-appr-order="${o.id}" ${o.approved?'checked':''}> Genehmigen</label>`);
    }

    const div = document.createElement('div');
    div.className = 'order';
    div.innerHTML = `
      <div><strong>${o.title}</strong> — ${aname(o.areaId)} • ${uname(o.assignedTo)} • <span class="hint">${when}</span></div>
      <div class="meta">${o.address||''}</div>
      ${o.instructions? `<div class="hint">${o.instructions}</div>` : ''}
      <div class="photos">${photos}</div>
      <div class="btn-row">${controls.join(' ')} ${geo} ${sig}</div>
      <div class="hint">Status: ${status}</div>`;
    wrap.appendChild(div);

    const input = div.querySelector('[data-photo]');
    if(input){ input.addEventListener('change', async e=>{ const file=e.target.files[0]; if(!file) return; const url=await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(file); }); const fid=await saveDataUrl(url); o.photos=(o.photos||[]).concat([fid]); await updateOrder(o); await renderOrders(); }); }
    div.querySelectorAll('[data-start]').forEach(b=>b.addEventListener('click', async()=>{ try{ const pos = await askForLocationOnce(); o.status='gestartet'; o.startReal=Date.now(); o.geoStart=pos; await updateOrder(o); await renderOrders(); }catch(e){ alert('Standortfehler: '+(e.message||e)); } }));
    div.querySelectorAll('[data-stop]').forEach(b=>b.addEventListener('click', async()=>{ try{ const pos = await askForLocationOnce(); o.status='beendet'; o.endReal=Date.now(); o.geoEnd=pos; await idbAdd('entries', { userId:o.assignedTo, areaId:o.areaId, start:o.startReal, end:o.endReal, durationMs:o.endReal-o.startReal, note:`Einsatz: ${o.title}`, day: fmtDate(o.startReal), geoStart:o.geoStart, geoEnd:o.geoEnd, createdAt: Date.now(), approved:false, published:false }); await updateOrder(o); await renderOrders(); }catch(e){ alert('Standortfehler: '+(e.message||e)); } }));
    div.querySelectorAll('[data-sign]').forEach(b=>b.addEventListener('click', async()=>{ await openSignatureDialog(o); }));
    if(currentUser.role!=='putzkraft'){
      div.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click', async()=>{ await openOrderDialog(o); }));
      div.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async()=>{ if(confirm('Einsatz löschen?')){ await idbDel('orders', o.id); await renderOrders(); } }));
      div.querySelectorAll('[data-pub-order]').forEach(ch=>ch.addEventListener('change', async e=>{ o.published = e.target.checked; await updateOrder(o); }));
      div.querySelectorAll('[data-appr-order]').forEach(ch=>ch.addEventListener('change', async e=>{ o.approved = e.target.checked; await updateOrder(o); }));
    }
  }
}

async function openOrderDialog(o=null){
  const areas = await idbAll('areas'); const users = await idbAll('users');
  const area = prompt('Arbeitsbereich (Name)', o? (areas.find(a=>a.id===o.areaId)||{}).name : '');
  const a = areas.find(x=>x.name===area) || areas[0];
  const title = prompt('Titel', o?o.title:'Einsatz');
  const assignedName = prompt('Mitarbeiter (Name)', o? (users.find(u=>u.id===o.assignedTo)||{}).name : '');
  const u = users.find(x=>x.name===assignedName) || users[0];
  const start = prompt('Start (YYYY-MM-DD HH:MM)', o&&o.startPlan? new Date(o.startPlan).toISOString().slice(0,16).replace('T',' ') : '');
  const end = prompt('Ende (YYYY-MM-DD HH:MM)', o&&o.endPlan? new Date(o.endPlan).toISOString().slice(0,16).replace('T',' ') : '');
  const address = prompt('Adresse (optional)', o?o.address||'':'');
  const lat = prompt('Latitude (optional)', o&&o.lat? String(o.lat):'');
  const lon = prompt('Longitude (optional)', o&&o.lon? String(o.lon):'');
  const instr = prompt('Anweisungen (optional)', o?o.instructions||'':'');
  const sp = start? Date.parse(start.replace(' ','T')): null; const ep = end? Date.parse(end.replace(' ','T')): null;
  const obj = o||{}; Object.assign(obj, { title, areaId:a.id, assignedTo:u.id, startPlan:sp, endPlan:ep, address, lat:lat?Number(lat):null, lon:lon?Number(lon):null, instructions:instr, status: obj.status||'geplant' });
  if(o){ await idbPut('orders', obj); } else { await idbAdd('orders', obj); }
  await renderOrders();
}

async function openSignatureDialog(order){
  const modal = document.createElement('div'); Object.assign(modal.style, {position:'fixed', inset:'0', background:'rgba(0,0,0,.35)', display:'grid', placeItems:'center', zIndex:2000});
  modal.innerHTML = `<div style="background:#fff; color:#0f172a; border-radius:12px; padding:16px; width:min(560px,92vw);">
    <h3>Unterschrift für „${order.title}“</h3>
    <canvas id="sig" class="signature-pad"></canvas>
    <div class="btn-row mt">
      <button id="sig-clear" class="btn ghost">Löschen</button>
      <button id="sig-save" class="btn">Speichern</button>
      <button id="sig-cancel" class="btn danger">Abbrechen</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const canvas = modal.querySelector('#sig'); const ctx = canvas.getContext('2d');
  function resize(){ const r = canvas.getBoundingClientRect(); canvas.width = r.width*2; canvas.height = r.height*2; ctx.scale(2,2); ctx.lineWidth=2; ctx.lineCap='round'; }
  resize(); window.addEventListener('resize', resize, { once:true });
  let drawing=false, prev=null;
  function getPos(e){ const rect=canvas.getBoundingClientRect(); const p = (e.touches? e.touches[0] : e); return { x: (p.clientX-rect.left), y: (p.clientY-rect.top) }; }
  function draw(e){ if(!drawing) return; const pos=getPos(e); ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(pos.x,pos.y); ctx.stroke(); prev=pos; }
  canvas.addEventListener('pointerdown', e=>{ drawing=true; prev=getPos(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', draw);
  canvas.addEventListener('pointerup', e=>{ drawing=false; });
  modal.querySelector('#sig-clear').addEventListener('click', ()=>{ ctx.clearRect(0,0,canvas.width,canvas.height); });
  modal.querySelector('#sig-cancel').addEventListener('click', ()=>{ modal.remove(); });
  modal.querySelector('#sig-save').addEventListener('click', async ()=>{
    const dataUrl = canvas.toDataURL('image/png');
    const fid = await saveDataUrl(dataUrl);
    order.signature = fid; order.status = 'bestätigt';
    await idbPut('orders', order);
    modal.remove();
    await renderOrders();
  });
}

// -------- Tasks --------
async function addTask(t){ return await idbAdd('tasks', t); }
async function renderTasks(){
  const wrap = $('#tasks-list');
  const all = await idbAll('tasks');
  const tasks = currentUser.role==='putzkraft' ? all.filter(t => !t.assignedTo || t.assignedTo===currentUser.id) : all;
  const areas = await idbAll('areas'); const users = await idbAll('users');
  const aname = id => { const a=areas.find(x=>x.id===id); return a? a.name : '—'; };
  const uname = id => { const u=users.find(x=>x.id===id); return u? u.name : 'Alle'; };
  wrap.innerHTML = tasks.filter(t=>t.status!=='done').map(t=>`
    <div class="task-item">
      <div><div><strong>${t.title}</strong></div><div class="hint">${t.desc||''}</div><div class="hint">${aname(t.areaId)} • ${uname(t.assignedTo)}</div></div>
      <button class="action" data-done="${t.id}">Erledigt</button>
      ${currentUser.role!=='putzkraft' ? `<button class="action" data-del="${t.id}">Löschen</button>` : ''}
    </div>`).join('') || `<div class="hint">Keine offenen Aufgaben.</div>`;
  wrap.querySelectorAll('[data-done]').forEach(b=>b.addEventListener('click', async()=>{ const id=Number(b.dataset.done); const t=await idbGet('tasks', id); t.status='done'; await idbPut('tasks', t); await renderTasks(); }));
  wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async()=>{ const id=Number(b.dataset.del); await idbDel('tasks', id); await renderTasks(); }));
}

// -------- Geolocation --------
function geoStatus(msg, ok=false){ const el=$('#geo-status'); if(!el) return; el.textContent=msg; el.style.color = ok ? '#16a34a' : ''; }
function askForLocationOnce(){
  return new Promise((resolve, reject) => {
    if(!('geolocation' in navigator)){ reject(new Error('Geolocation nicht verfügbar')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { lastGeo = { lat:pos.coords.latitude, lon:pos.coords.longitude, acc:pos.coords.accuracy, ts:Date.now() }; resolve(lastGeo); },
      err => reject(err),
      { enableHighAccuracy:true, maximumAge:5000, timeout:8000 }
    );
  });
}

// -------- Entries --------
async function addEntry(e){ return await idbAdd('entries', e); }
async function renderEntries(admin=false){
  const wrap = admin? $('#admin-entries') : $('#entries-list');
  const from = $('#filter-from')?.value ? new Date($('#filter-from').value).getTime() : 0;
  const to = $('#filter-to')?.value ? (new Date($('#filter-to').value).getTime() + 24*3600*1000 - 1) : Number.MAX_SAFE_INTEGER;
  const selUser = $('#filter-user')?.value;
  const all = await idbAll('entries');
  const filtered = all.filter(e => e.start>=from && e.start<=to && (admin || (selUser? e.userId===Number(selUser) : (currentUser.role==='putzkraft'? e.userId===currentUser.id : true)))).sort((a,b)=>b.start-a.start);
  const areas = await idbAll('areas'); const users = await idbAll('users');
  const rounding = Number(await getSetting('rounding', 0));
  const groups = groupBy(filtered, e=>fmtDate(e.start));
  const aname = id => (areas.find(a=>a.id===id)||{}).name || '—';
  const uname = id => (users.find(u=>u.id===id)||{}).name || '—';

  wrap.innerHTML = Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(day=>{
    const list = groups[day];
    const total = list.reduce((s,e)=> s+e.durationMs, 0);
    return `<div class="entry-group">
      <div class="entry-group-header"><div><strong>${day}</strong> • ${list.length} Einträge</div><div>Tages‑Summe: <strong>${fmtDuration(roundMs(total, rounding))}</strong></div></div>
      ${list.map(e=>{
        const links = [];
        if(e.geoStart) links.push(`<a class="action" href="${mapsLink(e.geoStart.lat,e.geoStart.lon,'Start')}" target="_blank" rel="noopener">Karte: Start</a>`);
        if(e.geoEnd) links.push(`<a class="action" href="${mapsLink(e.geoEnd.lat,e.geoEnd.lon,'Ende')}" target="_blank" rel="noopener">Karte: Ende</a>`);
        const adminControls = (currentUser.role==='geschaeft' || admin) ? `
          <button class="action" data-edit="${e.id}">Bearbeiten</button>
          <button class="action" data-del="${e.id}">Löschen</button>
          <label class="action"><input type="checkbox" data-appr="${e.id}" ${e.approved?'checked':''}> Genehmigen</label>
          <label class="action"><input type="checkbox" data-pub="${e.id}" ${e.published?'checked':''}> Freigeben</label>` : '';
        return `<div class="entry">
          <div>
            <div><strong>${aname(e.areaId)}</strong> • ${fmtDateTime(e.start)}–${fmtDateTime(e.end)} • ${uname(e.userId)}</div>
            ${e.note? `<div class="note">${e.note}</div>`:''}
            ${links.length? `<div class="hint">${links.join(' ')}</div>`:''}
          </div>
          <div class="hint">${fmtDuration(roundMs(e.durationMs, rounding))}</div>
          ${adminControls}
        </div>`
      }).join('')}
    </div>`;
  }).join('') || `<div class="hint">Keine Einträge.</div>`;

  if(currentUser.role==='geschaeft' || admin){
    wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async()=>{ const id=Number(b.dataset.del); if(confirm('Eintrag löschen?')){ await idbDel('entries', id); await renderEntries(admin); } }));
    wrap.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click', async()=>{
      const id=Number(b.dataset.edit); const e=await idbGet('entries', id); if(!e) return;
      const users = await idbAll('users'); const areas = await idbAll('areas');
      const s = prompt('Start (YYYY-MM-DD HH:MM)', new Date(e.start).toISOString().slice(0,16).replace('T',' ')); if(!s) return;
      const ed = prompt('Ende (YYYY-MM-DD HH:MM)', new Date(e.end).toISOString().slice(0,16).replace('T',' ')); if(!ed) return;
      const note = prompt('Notiz', e.note||'');
      const unamePrompt = prompt('Mitarbeiter (Name)', (users.find(u=>u.id===e.userId)||{}).name || '');
      const anamePrompt = prompt('Bereich (Name)', (areas.find(a=>a.id===e.areaId)||{}).name || '');
      const u = users.find(x=>x.name===unamePrompt) || {id:e.userId}; const a = areas.find(x=>x.name===anamePrompt) || {id:e.areaId};
      const start = Date.parse(s.replace(' ','T')); const end = Date.parse(ed.replace(' ','T'));
      if(isNaN(start)||isNaN(end)||end<=start){ alert('Ungültige Zeiten.'); return; }
      e.start=start; e.end=end; e.durationMs=end-start; e.note=note||''; e.day=fmtDate(start); e.userId=u.id; e.areaId=a.id;
      await idbPut('entries', e); await renderEntries(admin);
    }));
    wrap.querySelectorAll('[data-appr]').forEach(ch=>ch.addEventListener('change', async e=>{ const id=Number(ch.dataset.appr); const ent=await idbGet('entries', id); ent.approved = e.target.checked; await idbPut('entries', ent); }));
    wrap.querySelectorAll('[data-pub]').forEach(ch=>ch.addEventListener('change', async e=>{ const id=Number(ch.dataset.pub); const ent=await idbGet('entries', id); ent.published = e.target.checked; await idbPut('entries', ent); }));
  }
}

async function renderTodaySummary(){
  const wrap = $('#today-summary'); if(!wrap) return;
  const today = new Date(); const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const d1 = d0 + 24*3600*1000 - 1;
  const all = await idbAll('entries');
  const mine = all.filter(e=> e.userId===currentUser.id);
  const todayMine = mine.filter(e=> e.start>=d0 && e.start<=d1);
  const total = todayMine.reduce((s,e)=> s+e.durationMs, 0);
  wrap.innerHTML = `
    <div class="box"><div class="k">Heute</div><div class="v">${fmtDuration(total)}</div></div>
    <div class="box"><div class="k">Einträge heute</div><div class="v">${todayMine.length}</div></div>
    <div class="box"><div class="k">Laufender Timer</div><div class="v">${running ? 'Aktiv' : '—'}</div></div>
    <div class="box"><div class="k">Letzter Standort</div><div class="v">${lastGeo? `${lastGeo.lat.toFixed(3)},${lastGeo.lon.toFixed(3)}`:'—'}</div></div>`;
}

// -------- Timer --------
function paint(){ $('#timer-display').textContent = running ? fmtDuration(Date.now() - running.start) : '00:00:00'; }
function startPaint(){ if(tickTimer) return; tickTimer = setInterval(paint, 250); }
function stopPaint(){ clearInterval(tickTimer); tickTimer=null; }
async function startTimer(){
  if(running) return;
  const areaId = Number($('#timer-area').value);
  const note = $('#timer-note').value;
  const geoOn = (await getSetting('geo', false)) === true || $('#set-geo')?.checked;
  let geoStart=null; if(geoOn){ try{ geoStart = await askForLocationOnce(); geoStatus(`Standort OK (${geoStart.lat.toFixed(5)}, ${geoStart.lon.toFixed(5)} • ±${Math.round(geoStart.acc)} m)`, true);}catch(e){ geoStatus(`Standortfehler: ${e.message||e}`, false);} }
  running = { userId: currentUser.id, areaId, note, start: Date.now(), geoStart };
  sessionStorage.setItem('incanto-v4-running', JSON.stringify(running));
  $('#btn-start').disabled=true; $('#btn-stop').disabled=false; startPaint(); paint();
}
async function stopTimer(){
  if(!running) return;
  const end = Date.now();
  const geoOn = (await getSetting('geo', false)) === true || $('#set-geo')?.checked;
  let geoEnd=null; if(geoOn){ try{ geoEnd = await askForLocationOnce(); geoStatus(`Standort OK (${geoEnd.lat.toFixed(5)}, ${geoEnd.lon.toFixed(5)} • ±${Math.round(geoEnd.acc)} m)`, true);}catch(e){ geoStatus(`Kein Standort beim Stop: ${e.message||e}`, false);} }
  await addEntry({ userId: currentUser.id, areaId: running.areaId, start: running.start, end, durationMs:end-running.start, note: running.note, day: fmtDate(running.start), geoStart: running.geoStart, geoEnd, createdAt: Date.now(), approved:false, published:false });
  running=null; sessionStorage.removeItem('incanto-v4-running');
  $('#btn-start').disabled=false; $('#btn-stop').disabled=true; $('#timer-note').value=''; stopPaint(); paint(); await renderEntries(); await renderTodaySummary();
}

// -------- Export & Backup --------
async function exportCSV(){
  const from = $('#export-from').value ? new Date($('#export-from').value).getTime() : 0;
  const to = $('#export-to').value ? (new Date($('#export-to').value).getTime() + 24*3600*1000 - 1) : Number.MAX_SAFE_INTEGER;
  const userSel = $('#export-user').value;
  const rounding = Number(await getSetting('rounding', 0));
  const all = (await idbAll('entries')).filter(e => e.start>=from && e.start<=to && (userSel? e.userId===Number(userSel):(currentUser.role==='putzkraft'? e.userId===currentUser.id : true))).sort((a,b)=>a.start-b.start);
  const users = await idbAll('users'); const areas = await idbAll('areas');
  const uname = id => (users.find(u=>u.id===id)||{}).name || '';
  const aname = id => (areas.find(a=>a.id===id)||{}).name || '';
  const header = ['ID','Mitarbeiter','Arbeitsbereich','Start','Ende','Dauer_Minuten','Notiz','GeoStart_Breitengrad','GeoStart_Laengengrad','GeoEnde_Breitengrad','GeoEnde_Laengengrad','GeoStart_Genauigkeit_m','GeoEnde_Genauigkeit_m','Genehmigt','Freigegeben'];
  const rows = [header.join(';')];
  all.forEach(e=>{
    const dur=roundMs(e.durationMs, rounding);
    const pm=Math.round(dur/60000);
    const gs=e.geoStart||{}, ge=e.geoEnd||{};
    rows.push([
      e.id,
      `"${uname(e.userId).replace(/"/g,'""')}"`,
      `"${aname(e.areaId).replace(/"/g,'""')}"`,
      new Date(e.start).toLocaleString('de-DE', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}),
      new Date(e.end).toLocaleString('de-DE', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}),
      pm,
      `"${(e.note||'').replace(/"/g,'""')}"`,
      gs.lat??'', gs.lon??'', ge.lat??'', ge.lon??'', gs.acc??'', ge.acc??'',
      e.approved? 'ja':'nein',
      e.published? 'ja':'nein'
    ].join(';'));
  });
  const csv = '\ufeff' + rows.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='incanto_export_de.csv'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
}
async function exportJSON(){
  const users = await idbAll('users'); const areas = await idbAll('areas'); const entries = await idbAll('entries'); const orders = await idbAll('orders'); const tasks = await idbAll('tasks'); const clients = await idbAll('clients'); const files = await idbAll('files');
  const data = { exportedAt: new Date().toISOString(), users, areas, entries, orders, tasks, clients, files };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='incanto_export.json'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
}
async function backup(){ const stores=['settings','users','areas','entries','orders','tasks','files','clients']; const data={}; for(const s of stores){ data[s]=await idbAll(s); } const blob=new Blob([JSON.stringify(data)], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='incanto_backup.json'; document.body.appendChild(a); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),0); }
async function restore(file){ const text=await file.text(); const data=JSON.parse(text); const stores=['settings','users','areas','entries','orders','tasks','files','clients']; await Promise.all(stores.map(s=>new Promise((res,rej)=>{ const r=tx(s,'readwrite').objectStore(s).clear(); r.onsuccess=res; r.onerror=()=>rej(r.error);}))); for(const s of stores){ for(const x of (data[s]||[])) await idbPut(s, x); } await initAfterLogin(); }

// -------- Kundenportal (local management) --------
function randomToken(len=12){ const a=new Uint8Array(len); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[^A-Za-z0-9]/g,'').slice(0, len); }
async function renderClients(){
  const wrap = $('#clients-list'); const clients = await idbAll('clients'); const areas = await idbAll('areas');
  wrap.innerHTML = clients.map(c=>{
    const names = (c.areaIds||[]).map(id => (areas.find(a=>a.id===id)||{}).name || '—').join(', ') || 'keine Zuordnung';
    return `<li class="project-item">
      <span class="badge" style="background:#60a5fa"></span>
      <div><div style="font-weight:800">${c.name}</div><div class="hint">Bereiche: ${names}</div></div>
      <div class="project-actions">
        <button class="action" data-assign="${c.id}">Bereiche</button>
        <button class="action" data-rename="${c.id}">Umbenennen</button>
        <button class="action" data-del="${c.id}">Löschen</button>
      </div>
    </li>`;
  }).join('') || `<div class="hint">Noch keine Kunden angelegt.</div>`;

  wrap.querySelectorAll('[data-assign]').forEach(b=>b.addEventListener('click', async()=>{
    const id=Number(b.dataset.assign); const c=await idbGet('clients', id); const areas = await idbAll('areas');
    const names = prompt('Bereiche (Kommagetrennte Namen)', (c.areaIds||[]).map(i => (areas.find(a=>a.id===i)||{}).name || '').filter(x=>x).join(', '));
    if(names===null) return;
    const wanted = names.split(',').map(s=>s.trim()).filter(Boolean);
    c.areaIds = areas.filter(a=> wanted.includes(a.name)).map(a=>a.id);
    await idbPut('clients', c); await renderClients(); await fillPortalClientSelect();
  }));
  wrap.querySelectorAll('[data-rename]').forEach(b=>b.addEventListener('click', async()=>{
    const id=Number(b.dataset.rename); const c=await idbGet('clients', id); const name=prompt('Neuer Kundenname', c.name); if(!name) return; c.name=name.trim(); await idbPut('clients', c); await renderClients(); await fillPortalClientSelect();
  }));
  wrap.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async()=>{
    const id=Number(b.dataset.del); if(confirm('Kunde löschen?')){ await idbDel('clients', id); await renderClients(); await fillPortalClientSelect(); }
  }));
}
async function fillPortalClientSelect(){ const clients = await idbAll('clients'); $('#portal-client').innerHTML = clients.map(c=>`<option value="${c.id}">${c.name}</option>`).join(''); }
async function newClientFlow(){
  const name = prompt('Kundenname'); if(!name) return;
  const token = randomToken(16);
  const areas = await idbAll('areas');
  const sel = prompt('Welche Bereiche zuordnen? (Kommagetrennte Namen)');
  const areaIds = sel ? areas.filter(a=> sel.split(',').map(s=>s.trim()).includes(a.name)).map(a=>a.id) : [];
  await idbAdd('clients', { name: name.trim(), token, areaIds });
  await renderClients(); await fillPortalClientSelect();
}
async function renderApprovals(){
  const wrap = $('#approvals');
  const entries = await idbAll('entries'); const orders = await idbAll('orders'); const users = await idbAll('users'); const areas = await idbAll('areas');
  function uname(id){ return (users.find(u=>u.id===id)||{}).name || '—'; }
  function aname(id){ return (areas.find(a=>a.id===id)||{}).name || '—'; }
  const list = [
    ...entries.map(e => ({ type:'entry', id:e.id, when:e.start, title:`Eintrag ${aname(e.areaId)} — ${uname(e.userId)}`, detail:`${fmtDateTime(e.start)}–${fmtDateTime(e.end)} (${fmtDuration(e.durationMs)})`, approved: !!e.approved, published: !!e.published })),
    ...orders.map(o => ({ type:'order', id:o.id, when:o.startPlan||o.startReal||0, title:`Einsatz: ${o.title} — ${aname(o.areaId)} — ${uname(o.assignedTo)}`, detail:`${o.startPlan?fmtDateTime(o.startPlan):'—'}${o.endPlan?' – '+fmtDateTime(o.endPlan):''}`, approved: !!o.approved, published: !!o.published }))
  ].sort((a,b)=> (b.when||0) - (a.when||0));

  wrap.innerHTML = list.map(x => `
    <div class="entry">
      <div><div><strong>${x.title}</strong></div><div class="hint">${x.detail}</div></div>
      <label class="action"><input type="checkbox" data-appr-x="${x.type}:${x.id}" ${x.approved?'checked':''}> Genehmigen</label>
      <label class="action"><input type="checkbox" data-pub-x="${x.type}:${x.id}" ${x.published?'checked':''}> Freigeben</label>
    </div>
  `).join('') || `<div class="hint">Noch keine Einträge/Einsätze.</div>`;

  wrap.querySelectorAll('[data-appr-x]').forEach(ch=>ch.addEventListener('change', async e=>{
    const [type,id]=ch.dataset.apprX.split(':'); const num=Number(id);
    if(type==='entry'){ const x=await idbGet('entries', num); x.approved=e.target.checked; await idbPut('entries', x); }
    else { const x=await idbGet('orders', num); x.approved=e.target.checked; await idbPut('orders', x); }
  }));
  wrap.querySelectorAll('[data-pub-x]').forEach(ch=>ch.addEventListener('change', async e=>{
    const [type,id]=ch.dataset.pubX.split(':'); const num=Number(id);
    if(type==='entry'){ const x=await idbGet('entries', num); x.published=e.target.checked; await idbPut('entries', x); }
    else { const x=await idbGet('orders', num); x.published=e.target.checked; await idbPut('orders', x); }
  }));
}

// -------- After Login --------
async function initAfterLogin(){
  await ensureDefaultArea();
  await loadAreas();
  await renderAreas();
  await renderUsers();
  await populateUserSelects();
  await renderOrders();
  await renderEntries();
  await renderEntries(true);
  await renderTasks();
  await renderClients(); await fillPortalClientSelect(); await renderApprovals();
  await renderTodaySummary();

  const now=new Date(); const t=now.toISOString().slice(0,10);
  $('#orders-from').value = t; $('#orders-to').value = t;
  $('#export-from').value = t; $('#export-to').value = t;
  $('#portal-from').value = t; $('#portal-to').value = t;

  const rounding = await getSetting('rounding', 0); $('#set-rounding').value = String(rounding);
  const geo = await getSetting('geo', false); $('#set-geo').checked = !!geo;
  const theme = await getSetting('theme', 'friendly'); document.documentElement.setAttribute('data-theme', theme); $('#set-theme').value = theme;

  try{ running = JSON.parse(sessionStorage.getItem('incanto-v4-running')); }catch{}
  if(running && running.userId===currentUser.id){ startPaint(); $('#btn-start').disabled=true; $('#btn-stop').disabled=false; }
}

// -------- Wire --------
document.addEventListener('DOMContentLoaded', async ()=>{
  db = await openDB();
  await ensureInitialData();

  $('#btn-setup-admin')?.addEventListener('click', async ()=>{
    const pin = $('#setup-admin-pin').value.trim();
    if(!pin || pin.length<4){ alert('Bitte PIN (4–8) setzen.'); return; }
    await createAdmin(pin); await populateLoginUsers();
    $('#auth-setup').classList.add('hidden'); $('#auth-login').classList.remove('hidden');
  });
  $('#btn-login')?.addEventListener('click', async ()=>{
    const userId = $('#login-user').value; const pin = $('#login-pin').value;
    try{ await login(userId, pin); }catch(e){ alert(e.message||e); }
  });

  // Buttons inside tabs
  $('#btn-orders-filter')?.addEventListener('click', renderOrders);
  $('#btn-order-new')?.addEventListener('click', async ()=>{ if(currentUser.role==='putzkraft'){ alert('Nur Personal/Administration.'); return; } await openOrderDialog(null); });
  $('#btn-sync-orders')?.addEventListener('click', async ()=>{ try{ await Sync.pushPullAll(); alert('Sync OK.'); }catch(e){ alert('Sync Fehler: '+(e.message||e)); } });

  $('#btn-start')?.addEventListener('click', startTimer);
  $('#btn-stop')?.addEventListener('click', stopTimer);
  $('#btn-geo-test')?.addEventListener('click', async ()=>{ geoStatus('Frage Standort an…'); try{ const pos = await askForLocationOnce(); geoStatus(`Standort OK (${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)} • ±${Math.round(pos.acc)} m)`, true); }catch(e){ geoStatus(`Standortfehler: ${e.message||e}`, false); } });

  $('#filter-from')?.addEventListener('change', ()=>renderEntries());
  $('#filter-to')?.addEventListener('change', ()=>renderEntries());
  $('#filter-user')?.addEventListener('change', ()=>renderEntries());

  $('#btn-task-add')?.addEventListener('click', async ()=>{
    if(currentUser.role==='putzkraft'){ alert('Nur Personal/Admin.'); return; }
    const title=$('#task-title').value.trim(); if(!title) return;
    const desc=$('#task-desc').value.trim(); const areaId=$('#task-area').value?Number($('#task-area').value):null; const assignedTo=$('#task-assign').value?Number($('#task-assign').value):null;
    await addTask({ title, desc, areaId, assignedTo, status:'open', createdAt: Date.now() });
    $('#task-title').value=''; $('#task-desc').value=''; await renderTasks();
  });

  $('#set-rounding')?.addEventListener('change', async e=>{ await setSetting('rounding', Number(e.target.value||0)); await renderEntries(); });
  $('#set-geo')?.addEventListener('change', async e=>{ await setSetting('geo', !!e.target.checked); });
  $('#set-theme')?.addEventListener('change', async e=>{ const t=e.target.value; document.documentElement.setAttribute('data-theme', t); await setSetting('theme', t); });

  $('#btn-export-csv')?.addEventListener('click', exportCSV);
  $('#btn-export-json')?.addEventListener('click', exportJSON);
  $('#btn-backup')?.addEventListener('click', backup);
  $('#restore-file')?.addEventListener('change', e=>{ if(e.target.files[0]) restore(e.target.files[0]); });

  $('#btn-client-new')?.addEventListener('click', newClientFlow);
  $('#btn-portal-generate')?.addEventListener('click', async ()=>{
    const clientId = $('#portal-client').value; const from = $('#portal-from').value; const to = $('#portal-to').value;
    await generatePortalHTML(clientId, from, to);
  });

  // Restore user if present
  try{ const cur=JSON.parse(sessionStorage.getItem('incanto-v4-current')); if(cur){ currentUser=cur; $('#auth').classList.add('hidden'); $('#user-name-label').textContent=cur.name; $('#user-role-label').textContent=ROLE_LABEL[cur.role]||cur.role; renderRoleNav(); await initAfterLogin(); } }catch{}
});
