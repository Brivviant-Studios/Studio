const STORAGE_KEY='brivviant_studio_events_trello_v1';
const SESSION_KEY='brivviant_studio_events_session_v1';
const COLUMNS=[
  {id:'todo',title:'To Do'},
  {id:'progress',title:'In Progress'},
  {id:'review',title:'Review'},
  {id:'done',title:'Done'},
  {id:'late',title:'Late'}
];
const DEFAULT_ADMIN={id:'admin-brivviant',name:'Brivviant',nickname:'Main Admin',username:'Brivviant',password:'Brivviant@123456',email:'',role:'admin',avatar:''};
let state=loadState();

let dbClient=null;
let dbOnline=false;
function setSync(msg){const el=$('#syncState'); if(el) el.textContent=msg;}
function normalizeRole(r){return String(r||'staff').toLowerCase()==='admin'?'admin':'staff'}
function userFromDb(r){return {id:r.id,name:r.name||'',nickname:r.nickname||'',username:r.username||'',password:r.password||'',email:r.email||'',role:normalizeRole(r.role),avatar:r.avatar||''}}
function userToDb(u){return {id:u.id,name:u.name||'',nickname:u.nickname||'',username:u.username||'',password:u.password||'',email:u.email||'',role:normalizeRole(u.role),avatar:u.avatar||''}}
function eventFromDb(r){return {id:r.id,name:r.name||'',client:r.client||'',date:r.event_date||'',notes:r.notes||''}}
function eventToDb(e){return {id:e.id,name:e.name||'',client:e.client||'',event_date:e.date||null,notes:e.notes||''}}
function taskFromDb(r){return {id:r.id,eventId:r.event_id,title:r.title||'',column:r.column_id||'todo',owner:r.owner||'',ownerName:r.owner_name||'',priority:r.priority||'Normal',due:r.due||'',tags:r.tags||'',notes:r.notes||'',delayReason:r.delay_reason||'',attachments:Array.isArray(r.attachments)?r.attachments:[],aiBriefAnalysis:r.ai_brief_analysis||null,aiBriefPdfName:r.ai_brief_pdf_name||'',aiBriefAnalyzedAt:r.ai_brief_analyzed_at||'',driveLink:r.drive_link||''}}
function taskToDb(t){return {id:t.id,event_id:t.eventId||null,title:t.title||'',column_id:t.column||'todo',owner:t.owner||'',owner_name:t.ownerName||'',priority:t.priority||'Normal',due:t.due||null,tags:t.tags||'',notes:t.notes||'',delay_reason:t.delayReason||'',attachments:t.attachments||[],ai_brief_analysis:t.aiBriefAnalysis||null,ai_brief_pdf_name:t.aiBriefPdfName||null,ai_brief_analyzed_at:t.aiBriefAnalyzedAt||null,drive_link:t.driveLink||'',updated_at:new Date().toISOString()}}
function logFromDb(r){return {id:r.id,action:r.action||'',details:r.details||'',target:r.target||'',actor:r.actor||'',username:r.username||'',role:r.role||'',createdAt:r.created_at||'',createdAtText:r.created_at?new Date(r.created_at).toLocaleString('ar-EG',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):''}}
function logToDb(l){return {id:l.id,action:l.action,details:l.details,target:l.target,actor:l.actor,username:l.username,role:l.role,created_at:l.createdAt||new Date().toISOString()}}
async function initDb(){
  const cfg=window.BRIVVIANT_CONFIG||{};
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){setSync('Local Mode');return false;}
  dbClient=window.supabase.createClient(cfg.SUPABASE_URL.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,''),cfg.SUPABASE_ANON_KEY);
  dbOnline=true; setSync('Supabase Connecting...');
  try{await loadRemoteState(); setSync('Supabase Ready'); return true;}catch(err){console.error(err); dbOnline=false; setSync('Supabase Error - Local Mode'); return false;}
}
async function loadRemoteState(){
  if(!dbClient)return;
  const [u,e,t,l]=await Promise.all([
    dbClient.from('studio_users').select('*').order('created_at',{ascending:true}),
    dbClient.from('studio_events').select('*').order('created_at',{ascending:true}),
    dbClient.from('studio_event_tasks').select('*').order('created_at',{ascending:true}),
    dbClient.from('studio_activity_logs').select('*').order('created_at',{ascending:false}).limit(1000)
  ]);
  const err=[u.error,e.error,t.error,l.error].find(Boolean); if(err) throw err;
  state.users=(u.data||[]).map(userFromDb); state.events=(e.data||[]).map(eventFromDb); state.tasks=(t.data||[]).map(taskFromDb); state.logs=(l.data||[]).map(logFromDb);
  if(!state.users.some(x=>x.username==='Brivviant')){state.users.unshift({...DEFAULT_ADMIN}); await dbUpsertUser(DEFAULT_ADMIN)}
  if(!state.events.length){const ev={id:'evt-demo',name:'Internal Studio Event',client:'Brivviant',date:today(),notes:'Demo board'};state.events.push(ev); await dbUpsertEvent(ev)}
  saveState();
}
async function dbUpsertUser(u){if(dbOnline&&dbClient){const {error}=await dbClient.from('studio_users').upsert(userToDb(u)); if(error)throw error;}}
async function dbUpsertEvent(e){if(dbOnline&&dbClient){const {error}=await dbClient.from('studio_events').upsert(eventToDb(e)); if(error)throw error;}}
async function dbUpsertTask(t){if(dbOnline&&dbClient){const {error}=await dbClient.from('studio_event_tasks').upsert(taskToDb(t)); if(error)throw error;}}
async function dbInsertLog(l){if(dbOnline&&dbClient){const {error}=await dbClient.from('studio_activity_logs').insert(logToDb(l)); if(error)console.error(error);}}
async function dbDelete(table,id){if(dbOnline&&dbClient){const {error}=await dbClient.from(table).delete().eq('id',id); if(error)throw error;}}

let pendingFiles=[];
let pendingProfileAvatar='';
let pendingAiPdf=null;
const $=s=>document.querySelector(s); const $$=s=>Array.from(document.querySelectorAll(s));
function uid(){return crypto.randomUUID?.()||String(Date.now()+Math.random())}
function today(){return new Date().toISOString().slice(0,10)}
function nowText(){return new Date().toLocaleString('ar-EG',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function safe(v){return String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]))}
function loadState(){
  const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
  const base=saved||{events:[{id:'evt-demo',name:'Internal Studio Event',client:'Brivviant',date:today(),notes:'Demo board'}],tasks:[],users:[DEFAULT_ADMIN],logs:[]};
  base.users=Array.isArray(base.users)?base.users:[];
  if(!base.users.some(u=>u.username==='Brivviant')) base.users.unshift({...DEFAULT_ADMIN});
  base.events=Array.isArray(base.events)?base.events:[];
  base.tasks=Array.isArray(base.tasks)?base.tasks:[];
  base.logs=Array.isArray(base.logs)?base.logs:[];
  if(!base.events.length) base.events.push({id:'evt-demo',name:'Internal Studio Event',client:'Brivviant',date:today(),notes:''});
  return base;
}
function saveState(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
function getSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch(e){return null}}
function setSession(u){localStorage.setItem(SESSION_KEY,JSON.stringify({id:u.id,username:u.username,role:u.role,name:u.name}))}
function clearSession(){localStorage.removeItem(SESSION_KEY)}
function currentUser(){const s=getSession(); return s?state.users.find(u=>u.id===s.id||u.username===s.username):null}
function isAdmin(){return currentUser()?.role==='admin'}
function isTaskOwner(t){const u=currentUser(); if(!u||!t)return false; return [u.id,u.name,u.username,u.nickname,u.email].filter(Boolean).map(x=>String(x).toLowerCase()).includes(String(t.owner||'').toLowerCase())}
function isLate(t){return t.column==='late'||(t.due&&t.due<today()&&t.column!=='done')}
function log(action,details='',target=''){const entry={id:uid(),action,details,target,actor:currentUser()?.name||'Unknown',username:currentUser()?.username||'',role:currentUser()?.role||'',createdAt:new Date().toISOString(),createdAtText:nowText()};state.logs.unshift(entry);state.logs=state.logs.slice(0,1000);saveState();dbInsertLog(entry);renderLogs()}
function fileToData(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res({id:uid(),name:file.name,type:file.type||'application/octet-stream',size:file.size,data:r.result,createdAt:new Date().toISOString(),createdBy:currentUser()?.username||''});r.onerror=rej;r.readAsDataURL(file)})}
function render(){applyPermissions();renderProfile();renderFilters();renderBoard();renderMyTasks();renderEvents();renderTeam();renderLogs();renderStats()}
function applyPermissions(){const admin=isAdmin();$$('.admin-only').forEach(el=>el.classList.toggle('hidden',!admin)); if(!admin&&$('#board').classList.contains('active')) switchTab('mytasks')}
function renderProfile(){const u=currentUser(); const box=$('#profileBar'); if(!u){box.innerHTML='';return} box.innerHTML=`${u.avatar?`<img src="${u.avatar}" alt="">`:`<span class="avatar"></span>`}<div><b>${safe(u.nickname||u.name)}</b><small>${safe(u.role==='admin'?'Admin':'Staff')} — @${safe(u.username)}</small></div>`}
function renderStats(){const tasks=state.tasks; $('#statTasks').textContent=tasks.length; $('#statDone').textContent=tasks.filter(t=>t.column==='done').length; $('#statLate').textContent=tasks.filter(isLate).length}
function renderFilters(){
  const eventFilter=$('#eventFilter'), taskEvent=$('#taskEvent');
  const opts=`<option value="all">كل الفعاليات</option>`+state.events.map(e=>`<option value="${e.id}">${safe(e.name)}</option>`).join('');
  eventFilter.innerHTML=opts;
  taskEvent.innerHTML=state.events.map(e=>`<option value="${e.id}">${safe(e.name)}</option>`).join('');
  $('#taskOwner').innerHTML=state.users.filter(u=>u.role==='staff'||u.role==='admin').map(u=>`<option value="${u.id}">${safe(u.nickname||u.name)} — ${safe(u.role)}</option>`).join('');
  $('#taskColumn').innerHTML=COLUMNS.map(c=>`<option value="${c.id}">${c.title}</option>`).join('');
}
function filteredTasks(){const q=$('#searchInput')?.value.trim().toLowerCase()||''; const ev=$('#eventFilter')?.value||'all'; return state.tasks.filter(t=>{const matchEvent=ev==='all'||t.eventId===ev; const blob=[t.title,t.notes,t.tags,t.ownerName,getEventName(t.eventId)].join(' ').toLowerCase(); return matchEvent&&(!q||blob.includes(q));})}
function getEventName(id){return state.events.find(e=>e.id===id)?.name||'No Event'}
function getUserName(id){const u=state.users.find(x=>x.id===id); return u?(u.nickname||u.name):id}
function renderBoard(){
  const board=$('#kanbanBoard'); const tasks=filteredTasks();
  board.innerHTML=COLUMNS.map(col=>{const list=tasks.filter(t=>t.column===col.id || (col.id==='late'&&isLate(t)&&t.column!=='done'));return `<div class="kanban-col" data-col="${col.id}"><div class="col-head"><b>${col.title}</b><span class="col-count">${list.length}</span></div><div class="cards-stack">${list.map(taskCard).join('')||`<div class="empty">لا توجد كروت</div>`}</div></div>`}).join('');
  $$('.task-card').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-ai-brief]'))return;openTask(el.dataset.id)}); $$('#kanbanBoard [data-ai-brief]').forEach(b=>b.onclick=e=>{e.stopPropagation();openAiBrief(b.dataset.aiBrief)});
}
function priorityClass(p){p=String(p||'').toLowerCase();return p==='urgent'?'urgent':p==='high'?'high':''}
function taskCard(t){const atts=t.attachments||[];return `<article class="task-card" data-id="${t.id}"><div class="task-top"><div class="task-title">${safe(t.title)}</div><span class="pill ${priorityClass(t.priority)}">${safe(t.priority||'Normal')}</span></div><div class="meta-grid"><div class="meta"><small>Event</small><b>${safe(getEventName(t.eventId))}</b></div><div class="meta"><small>Owner</small><b>${safe(t.ownerName||getUserName(t.owner))}</b></div><div class="meta"><small>Due</small><b>${safe(t.due||'-')}</b></div><div class="meta"><small>Files</small><b>${atts.length}</b></div></div>${t.notes?`<div class="task-notes">${safe(t.notes).slice(0,130)}</div>`:''}<div class="thumbs">${atts.slice(0,4).map(a=>a.type?.startsWith('image/')?`<img src="${a.data}" alt="">`:`<span class="pdf-chip">PDF</span>`).join('')}</div>${t.driveLink?`<div class="task-drive"><small>Drive</small><a href="${safe(t.driveLink)}" target="_blank" rel="noopener">فتح رابط التسليم</a></div>`:''}<div class="task-actions"><button type="button" class="ai-brief-btn" data-ai-brief="${t.id}">شرح العناصر</button></div></article>`}
function renderMyTasks(){
  const u=currentUser();
  const list=$('#myTasksList');
  if(!u){list.innerHTML='';return}
  const tasks=state.tasks.filter(t=>isTaskOwner(t));
  list.innerHTML=tasks.map(t=>{
    const status=safe(COLUMNS.find(c=>c.id===t.column)?.title||t.column);
    const late=isLate(t);
    return `<article class="horizontal-card mytask-card" data-id="${t.id}">
      <div class="mytask-main">
        <div class="main-title">${safe(t.title)}</div>
        <p>${safe(getEventName(t.eventId))}</p>
        ${t.notes?`<div class="mytask-notes">${safe(t.notes)}</div>`:''}
      </div>
      <div class="cell"><small>Status</small><b>${status}</b></div>
      <div class="cell"><small>Due</small><b>${safe(t.due||'-')}</b></div>
      <div class="cell"><small>Priority</small><b>${safe(t.priority||'Normal')}</b></div>
      <div class="cell"><small>Files</small><b>${(t.attachments||[]).length}</b></div>
      <div class="mytask-actions-panel">
        ${late?`<label class="inline-field delay-field">سبب التأخير<textarea data-delay-input="${t.id}" rows="2" placeholder="اكتب سبب التأخير هنا">${safe(t.delayReason||'')}</textarea></label><button type="button" data-save-delay="${t.id}">حفظ سبب التأخير</button>`:''}
        <label class="inline-field">Drive Link للتسليم<input data-drive-input="${t.id}" type="url" placeholder="https://drive.google.com/..." value="${safe(t.driveLink||'')}"></label>
        <div class="row-actions">
          <button type="button" data-ai-brief="${t.id}">شرح العناصر</button>
          <button type="button" data-open="${t.id}">Open</button>
          <button type="button" class="done-btn" data-mark-done="${t.id}">Done</button>
        </div>
      </div>
    </article>`;
  }).join('')||`<div class="empty">لا توجد تاسكات مخصصة لك</div>`;
  list.querySelectorAll('button[data-open]').forEach(b=>b.onclick=()=>openTask(b.dataset.open));
  list.querySelectorAll('button[data-ai-brief]').forEach(b=>b.onclick=()=>openAiBrief(b.dataset.aiBrief));
  list.querySelectorAll('button[data-save-delay]').forEach(b=>b.onclick=()=>saveMyDelayReason(b.dataset.saveDelay));
  list.querySelectorAll('button[data-mark-done]').forEach(b=>b.onclick=()=>markMyTaskDone(b.dataset.markDone));
}

async function saveMyDelayReason(id){
  const t=state.tasks.find(x=>x.id===id);
  if(!t||!isTaskOwner(t)){alert('غير مسموح تعديل سبب التأخير إلا لصاحب التاسك.');log('Blocked Delay Edit','Unauthorized delay reason edit',t?.title||id);return}
  const input=document.querySelector(`[data-delay-input="${CSS.escape(id)}"]`);
  t.delayReason=(input?.value||'').trim();
  saveState();
  try{await dbUpsertTask(t)}catch(err){alert('Database Error: '+err.message);return}
  log('Update Delay Reason',t.delayReason,t.title);
  render();
}

async function markMyTaskDone(id){
  const t=state.tasks.find(x=>x.id===id);
  if(!t||!isTaskOwner(t)){alert('غير مسموح إنهاء التاسك إلا لصاحب التاسك.');log('Blocked Done','Unauthorized done action',t?.title||id);return}
  const input=document.querySelector(`[data-drive-input="${CSS.escape(id)}"]`);
  const link=(input?.value||'').trim();
  if(!link){alert('لازم تضيف Drive Link للتسليم قبل ما تعمل Done.');return}
  if(!/^https?:\/\//i.test(link)){alert('Drive Link لازم يبدأ بـ http أو https.');return}
  t.driveLink=link;
  t.column='done';
  saveState();
  try{await dbUpsertTask(t)}catch(err){alert('Database Error: '+err.message);return}
  log('Mark Done',`Done with drive link: ${link}`,t.title);
  render();
}
function renderEvents(){const grid=$('#eventsGrid'); grid.innerHTML=state.events.map(e=>`<article class="event-card" data-id="${e.id}"><h3>${safe(e.name)}</h3><p>${safe(e.client||'')}</p><p>${safe(e.date||'')}</p><button data-edit-event="${e.id}">Edit</button></article>`).join(''); grid.querySelectorAll('[data-edit-event]').forEach(b=>b.onclick=()=>openEvent(b.dataset.editEvent))}
function renderTeam(){const grid=$('#teamGrid'); grid.innerHTML=state.users.map(u=>`<article class="person-card"><h3>${safe(u.nickname||u.name)}</h3><p>@${safe(u.username)} — ${safe(u.role)}</p><p>${safe(u.email||'')}</p><button data-edit-user="${u.id}">Edit</button></article>`).join(''); grid.querySelectorAll('[data-edit-user]').forEach(b=>b.onclick=()=>openAccount(b.dataset.editUser))}
function renderLogs(){const list=$('#logsList'); if(!list)return; list.innerHTML=state.logs.map(l=>`<div class="log-card"><b>${safe(l.action)}</b><span>${safe(l.actor)}<br><small>@${safe(l.username)}</small></span><p>${safe(l.details)} ${l.target?`<small>— ${safe(l.target)}</small>`:''}</p><small>${safe(l.createdAtText)}</small></div>`).join('')||`<div class="empty">No logs yet</div>`}

function briefAnalysisToHtml(analysis){
  if(!analysis) return '<div class="empty">لا يوجد تحليل محفوظ لهذا الكارت.</div>';
  const esc=safe;
  const arr=(v)=>Array.isArray(v)?v.filter(Boolean):[];
  if(typeof analysis==='string') return `<div class="brief-block">${esc(analysis).replace(/\n/g,'<br>')}</div>`;
  const section=(title,items)=>arr(items).length?`<h3>${esc(title)}</h3><ul>${arr(items).map(x=>`<li>${esc(typeof x==='string'?x:JSON.stringify(x))}</li>`).join('')}</ul>`:'';
  return `${analysis.summary?`<div class="brief-block"><b>Summary</b><br>${esc(analysis.summary)}</div>`:''}
    ${section('العناصر المطلوبة من العميل',analysis.required_elements)}
    ${section('المقاسات / الكميات',analysis.dimensions_quantities)}
    ${section('الخامات / التشطيبات',analysis.materials_finishes)}
    ${section('المخرجات المطلوبة',analysis.deliverables)}
    ${section('المواعيد المهمة',analysis.deadlines)}
    ${section('اشتراطات خاصة',analysis.special_requirements)}
    ${section('أسئلة ناقصة للعميل',analysis.missing_questions)}
    ${analysis.raw?`<h3>Raw Notes</h3><div class="brief-block">${esc(analysis.raw).replace(/\n/g,'<br>')}</div>`:''}`;
}
function openAiBrief(id){
  const t=state.tasks.find(x=>x.id===id); if(!t)return;
  pendingAiPdf=null;
  $('#aiBriefTaskId').value=id;
  $('#aiBriefPdf').value='';
  $('#aiBriefTaskContext').innerHTML=`<b>${safe(t.title)}</b><br><span>${safe(getEventName(t.eventId))}</span><br><small>Owner: ${safe(t.ownerName||getUserName(t.owner))}</small>`;
  $('#aiBriefStatus').textContent='';
  $('#aiBriefOutput').classList.toggle('empty',!t.aiBriefAnalysis);
  $('#aiBriefOutput').innerHTML=briefAnalysisToHtml(t.aiBriefAnalysis);
  $('#aiBriefDialog').showModal();
}
function dataUrlBase64(dataUrl){return String(dataUrl||'').split(',')[1]||''}
async function analyzeBrief(){
  const task=state.tasks.find(x=>x.id===$('#aiBriefTaskId').value); if(!task)return;
  if(!pendingAiPdf){$('#aiBriefStatus').textContent='ارفع PDF الأول.';return}
  const cfg=window.BRIVVIANT_CONFIG||{};
  const endpoint=cfg.AI_BRIEF_ENDPOINT || (cfg.SUPABASE_URL?`${cfg.SUPABASE_URL.replace(/\/$/,'')}/functions/v1/analyze-brief`:'');
  if(!endpoint){$('#aiBriefStatus').textContent='AI API مش متوصل. اكتب AI_BRIEF_ENDPOINT في config.js أو فعّل Supabase Edge Function.';return}
  $('#aiBriefStatus').textContent='جاري تحليل كراسة الشروط بالـ AI...';
  $('#analyzeBriefBtn').disabled=true;
  try{
    const headers={'Content-Type':'application/json'};
    if(cfg.SUPABASE_ANON_KEY){ headers.Authorization=`Bearer ${cfg.SUPABASE_ANON_KEY}`; headers.apikey=cfg.SUPABASE_ANON_KEY; }
    const res=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({
      task:{id:task.id,title:task.title,event:getEventName(task.eventId),notes:task.notes,tags:task.tags},
      pdf:{name:pendingAiPdf.name,type:pendingAiPdf.type,base64:dataUrlBase64(pendingAiPdf.data)}
    })});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||data.message||`API Error ${res.status}`);
    task.aiBriefAnalysis=data.analysis||data;
    task.aiBriefPdfName=pendingAiPdf.name;
    task.aiBriefAnalyzedAt=new Date().toISOString();
    saveState(); await dbUpsertTask(task); log('AI Brief Analysis',pendingAiPdf.name,task.title);
    $('#aiBriefOutput').classList.remove('empty');
    $('#aiBriefOutput').innerHTML=briefAnalysisToHtml(task.aiBriefAnalysis);
    $('#aiBriefStatus').textContent='تم استخراج شرح العناصر وحفظه داخل الكارت.';
    render();
  }catch(err){
    const msg=(err instanceof TypeError && String(err.message).includes('Failed to fetch'))?'فشل التحليل: Failed to fetch — غالبًا Edge Function analyze-brief غير معمولة Deploy أو CORS/Secrets ناقصة. شغّل Supabase Function وتأكد من OPENAI_API_KEY.':'فشل التحليل: '+err.message; $('#aiBriefStatus').textContent=msg;
  }finally{$('#analyzeBriefBtn').disabled=false;}
}
function copyBrief(){
  const t=state.tasks.find(x=>x.id===$('#aiBriefTaskId').value); if(!t?.aiBriefAnalysis){$('#aiBriefStatus').textContent='لا يوجد تحليل لنسخه.';return}
  const text=typeof t.aiBriefAnalysis==='string'?t.aiBriefAnalysis:JSON.stringify(t.aiBriefAnalysis,null,2);
  navigator.clipboard?.writeText(text); $('#aiBriefStatus').textContent='تم نسخ التحليل.';
}
async function convertBriefToTasks(){
  const t=state.tasks.find(x=>x.id===$('#aiBriefTaskId').value); if(!t?.aiBriefAnalysis)return;
  const items=Array.isArray(t.aiBriefAnalysis.required_elements)?t.aiBriefAnalysis.required_elements:[];
  if(!items.length){$('#aiBriefStatus').textContent='لا توجد عناصر واضحة لتحويلها إلى Tasks.';return}
  for(const item of items){const nt={id:uid(),eventId:t.eventId,title:String(item).slice(0,120),column:'todo',owner:t.owner,ownerName:t.ownerName,priority:'Normal',due:t.due,tags:'AI Brief',notes:`Generated from AI Brief Analysis of: ${t.title}`,attachments:[]}; state.tasks.push(nt); await dbUpsertTask(nt)}
  saveState(); log('Convert AI Brief To Tasks',`${items.length} tasks created`,t.title); $('#aiBriefStatus').textContent=`تم إنشاء ${items.length} Tasks من شرح العناصر.`; render();
}

function switchTab(tab){$$('.tab').forEach(s=>s.classList.toggle('active',s.id===tab));$$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$('#pageTitle').textContent=$(`.nav-btn[data-tab="${tab}"]`)?.textContent||tab}
function openTask(id=''){
  const t=state.tasks.find(x=>x.id===id)||null; pendingFiles=[]; $('#taskId').value=t?.id||''; $('#taskTitle').value=t?.title||''; $('#taskEvent').value=t?.eventId||state.events[0]?.id||''; $('#taskColumn').value=t?.column||'todo'; $('#taskOwner').value=t?.owner||currentUser()?.id||''; $('#taskPriority').value=t?.priority||'Normal'; $('#taskDue').value=t?.due||''; $('#taskTags').value=t?.tags||''; $('#taskNotes').value=t?.notes||''; $('#taskDelayReason').value=t?.delayReason||''; $('#deleteTaskBtn').classList.toggle('hidden',!t||!isAdmin());
  $('#delayReasonWrap').classList.add('hidden'); $('#taskDelayReason').disabled=true;
  renderAttachmentPreview(t?.attachments||[]); $('#taskDialog').showModal();
}
function renderAttachmentPreview(atts){const wrap=$('#taskAttachmentsPreview'); wrap.innerHTML=atts.map(a=>`<div class="attachment-card" data-att="${a.id}">${a.type?.startsWith('image/')?`<img src="${a.data}" alt="">`:`<div class="pdf-chip">PDF</div>`}<a href="${a.data}" download="${safe(a.name)}">تحميل ${safe(a.name)}</a>${isAdmin()?`<button type="button" data-del-att="${a.id}">حذف</button>`:''}</div>`).join(''); wrap.querySelectorAll('[data-del-att]').forEach(b=>b.onclick=()=>{const id=$('#taskId').value; const t=state.tasks.find(x=>x.id===id); if(t){t.attachments=(t.attachments||[]).filter(a=>a.id!==b.dataset.delAtt); log('Delete Attachment',b.dataset.delAtt,t.title); saveState(); dbUpsertTask(t); renderAttachmentPreview(t.attachments); render();}})}
async function saveTask(e){e.preventDefault(); const id=$('#taskId').value; const owner=state.users.find(u=>u.id===$('#taskOwner').value); let t=state.tasks.find(x=>x.id===id); const isNew=!t; if(!t){t={id:uid(),attachments:[]}; state.tasks.push(t)}
  if(!isAdmin()&&!isTaskOwner(t)){alert('غير مسموح تعديل هذا التاسك'); log('Blocked Edit','Unauthorized task edit',$('#taskTitle').value);return}
  t.title=$('#taskTitle').value.trim(); t.eventId=$('#taskEvent').value; t.column=$('#taskColumn').value; t.owner=owner?.id||$('#taskOwner').value; t.ownerName=owner?(owner.nickname||owner.name):''; t.priority=$('#taskPriority').value; t.due=$('#taskDue').value; t.tags=$('#taskTags').value; t.notes=$('#taskNotes').value;
  if(pendingFiles.length){t.attachments=[...(t.attachments||[]),...pendingFiles];}
  saveState(); try{await dbUpsertTask(t)}catch(err){alert('Database Error: '+err.message);return} log(isNew?'Create Task':'Update Task',t.title,getEventName(t.eventId)); $('#taskDialog').close(); render();
}
function openEvent(id=''){const e=state.events.find(x=>x.id===id)||null; $('#eventId').value=e?.id||''; $('#eventName').value=e?.name||''; $('#eventClient').value=e?.client||''; $('#eventDate').value=e?.date||''; $('#eventNotes').value=e?.notes||''; $('#deleteEventBtn').classList.toggle('hidden',!e); $('#eventDialog').showModal()}
async function saveEvent(e){e.preventDefault(); let ev=state.events.find(x=>x.id===$('#eventId').value); const isNew=!ev; if(!ev){ev={id:uid()};state.events.push(ev)} ev.name=$('#eventName').value; ev.client=$('#eventClient').value; ev.date=$('#eventDate').value; ev.notes=$('#eventNotes').value; saveState(); try{await dbUpsertEvent(ev)}catch(err){alert('Database Error: '+err.message);return} log(isNew?'Create Event':'Update Event',ev.name); $('#eventDialog').close();render()}
function openAccount(id=''){const u=state.users.find(x=>x.id===id)||null; $('#accountId').value=u?.id||''; $('#accountName').value=u?.name||''; $('#accountNickname').value=u?.nickname||''; $('#accountUsername').value=u?.username||''; $('#accountEmail').value=u?.email||''; $('#accountPassword').value=u?.password||''; $('#accountRole').value=u?.role||'staff'; $('#deleteAccountBtn').classList.toggle('hidden',!u||u.username==='Brivviant'); $('#accountDialog').showModal()}
async function saveAccount(e){e.preventDefault(); let u=state.users.find(x=>x.id===$('#accountId').value); const isNew=!u; const username=$('#accountUsername').value.trim(); if(state.users.some(x=>x.username===username && x.id!==$('#accountId').value)){alert('Username موجود بالفعل');return} if(!u){u={id:uid(),avatar:''};state.users.push(u)} u.name=$('#accountName').value; u.nickname=$('#accountNickname').value; u.username=username; u.email=$('#accountEmail').value; u.password=$('#accountPassword').value; u.role=normalizeRole($('#accountRole').value); saveState(); try{await dbUpsertUser(u)}catch(err){alert('Database Error: '+err.message);return} log(isNew?'Create Account':'Update Account',u.username); $('#accountDialog').close();render()}
function openProfile(){const u=currentUser(); if(!u)return; pendingProfileAvatar=''; $('#profileName').value=u.name||''; $('#profileNickname').value=u.nickname||''; $('#profileUsername').value=u.username||''; $('#profileEmail').value=u.email||''; $('#profilePassword').value=''; $('#avatarPreview').innerHTML=u.avatar?`<img src="${u.avatar}">`:'No Image'; $('#profileDialog').showModal()}
async function saveProfile(e){e.preventDefault();const u=currentUser(); if(!u)return; u.name=$('#profileName').value; u.nickname=$('#profileNickname').value; u.email=$('#profileEmail').value; if($('#profilePassword').value)u.password=$('#profilePassword').value; if(pendingProfileAvatar)u.avatar=pendingProfileAvatar; saveState(); try{await dbUpsertUser(u)}catch(err){alert('Database Error: '+err.message);return} log('Update Profile',u.username); $('#profileDialog').close();render()}
function bind(){
  $$('.nav-btn').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab)); $('#profileBar').onclick=openProfile; $('#logoutBtn').onclick=()=>{log('Logout','User logged out');clearSession();location.reload()}; $('#loginForm').onsubmit=async e=>{e.preventDefault(); $('#loginError').textContent=''; if(dbOnline){try{await loadRemoteState()}catch(err){$('#loginError').textContent='Database Error: '+err.message;return}} const un=$('#loginUsername').value.trim(), pw=$('#loginPassword').value.trim(); if(!un||!pw){$('#loginError').textContent='لازم تدخل Username و Password';return} const u=state.users.find(x=>String(x.username).toLowerCase()===un.toLowerCase()&&String(x.password)===pw); if(!u){$('#loginError').textContent='Username أو Password غير صحيح أو الحساب غير محفوظ في Supabase';return} setSession(u); $('#loginOverlay').classList.add('hidden'); log('Login','User logged in');render()};
  $('#addTaskBtn').onclick=()=>openTask(); $('#taskForm').onsubmit=saveTask; $('#cancelTaskBtn').onclick=()=>$('#taskDialog').close(); $('#deleteTaskBtn').onclick=async()=>{const id=$('#taskId').value; const t=state.tasks.find(x=>x.id===id); if(t&&confirm('حذف التاسك؟')){state.tasks=state.tasks.filter(x=>x.id!==id);saveState();try{await dbDelete('studio_event_tasks',id)}catch(err){alert('Database Error: '+err.message);return}log('Delete Task',t.title);$('#taskDialog').close();render()}};
  $('#taskFiles').onchange=async e=>{pendingFiles=await Promise.all([...e.target.files].map(fileToData)); const id=$('#taskId').value; const current=state.tasks.find(t=>t.id===id)?.attachments||[]; renderAttachmentPreview([...current,...pendingFiles])};
  $('#addEventBtn').onclick=()=>openEvent(); $('#eventForm').onsubmit=saveEvent; $('#cancelEventBtn').onclick=()=>$('#eventDialog').close(); $('#deleteEventBtn').onclick=async()=>{const id=$('#eventId').value;if(confirm('حذف الفعالية؟')){state.events=state.events.filter(e=>e.id!==id); saveState(); try{await dbDelete('studio_events',id)}catch(err){alert('Database Error: '+err.message);return} log('Delete Event',id); $('#eventDialog').close();render()}};
  $('#addPersonBtn').onclick=()=>openAccount(); $('#accountForm').onsubmit=saveAccount; $('#cancelAccountBtn').onclick=()=>$('#accountDialog').close(); $('#deleteAccountBtn').onclick=async()=>{const id=$('#accountId').value;const u=state.users.find(x=>x.id===id); if(u&&confirm('حذف الحساب؟')){state.users=state.users.filter(x=>x.id!==id); saveState(); try{await dbDelete('studio_users',id)}catch(err){alert('Database Error: '+err.message);return} log('Delete Account',u.username); $('#accountDialog').close();render()}}; $('#generatePasswordBtn').onclick=()=>{$('#accountPassword').value='Bv@'+Math.random().toString(36).slice(2,10)};
  $('#profileForm').onsubmit=saveProfile; $('#cancelProfileBtn').onclick=()=>$('#profileDialog').close(); $('#profileImage').onchange=async e=>{const f=e.target.files[0]; if(f){const d=await fileToData(f); pendingProfileAvatar=d.data; $('#avatarPreview').innerHTML=`<img src="${pendingProfileAvatar}">`}};
  $('#aiBriefPdf').onchange=async e=>{const f=e.target.files[0]; if(!f)return; if(!/pdf$/i.test(f.name)&&f.type!=='application/pdf'){ $('#aiBriefStatus').textContent='الملف لازم يكون PDF.'; return } pendingAiPdf=await fileToData(f); $('#aiBriefStatus').textContent='تم رفع PDF: '+f.name};
  $('#analyzeBriefBtn').onclick=analyzeBrief; $('#copyBriefBtn').onclick=copyBrief; $('#convertBriefTasksBtn').onclick=convertBriefToTasks; $('#closeAiBriefBtn').onclick=()=>$('#aiBriefDialog').close();
  $('#searchInput').oninput=renderBoard; $('#eventFilter').onchange=renderBoard; $('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='brivviant-studio-events-state.json';a.click();URL.revokeObjectURL(a.href);log('Export JSON','State exported')}; $('#importInput').onchange=e=>{const f=e.target.files[0];if(!f)return; const r=new FileReader();r.onload=()=>{state=JSON.parse(r.result);saveState();log('Import JSON','State imported');render()};r.readAsText(f)};
}
async function boot(){bind(); await initDb(); if(getSession()) $('#loginOverlay').classList.add('hidden'); render()}
boot();
