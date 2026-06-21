const STORAGE_KEY='brivviant_studio_events_trello_v1';
const SESSION_KEY='brivviant_studio_events_session_v1';
const FILES_BUCKET='studio-files';
const COLUMNS=[
  {id:'todo',title:'To Do'},
  {id:'progress',title:'In Progress'},
  {id:'review',title:'Review'},
  {id:'done',title:'Done'},
  {id:'late',title:'Late'}
];
const BOARD_TYPES={
  event:{id:'event',tab:'board',label:'Event Board'},
  social:{id:'social',tab:'social',label:'Social Board'}
};
const STAFF_STATUSES=[
  {id:'pending',label:'لم يبدأ',hint:'في انتظار البدء'},
  {id:'working',label:'شغال',hint:'جاري التنفيذ'},
  {id:'blocked',label:'معطل',hint:'يوجد عائق'},
  {id:'submitted',label:'تم التسليم',hint:'تم رفع رابط التسليم'}
];
const DEFAULT_ADMIN={id:'admin-brivviant',name:'Brivviant',nickname:'Main Admin',username:'Brivviant',password:'Brivviant@123456',email:'',role:'admin',avatar:''};
let state=loadState();
let activeBoardType='event';

let dbClient=null;
let dbOnline=false;
let realtimeChannel=null;
let realtimeRefreshTimer=null;
let realtimeRefreshRunning=false;
let logQueue=Promise.resolve();
function setSync(msg){const el=$('#syncState'); if(el) el.textContent=msg;}
function withTimeout(promise, ms=9000, label='Request'){return Promise.race([promise,new Promise((_,rej)=>setTimeout(()=>rej(new Error(label+' timeout')),ms))]);}
function normalizeRole(r){return String(r||'staff').toLowerCase()==='admin'?'admin':'staff'}
function normalizeBoardType(v){return String(v||'event').toLowerCase()==='social'?'social':'event'}
function userFromDb(r){const u={id:r.id,name:r.name||'',nickname:r.nickname||'',username:r.username||'',email:r.email||'',role:normalizeRole(r.role),avatar:r.avatar||''};if(Object.prototype.hasOwnProperty.call(r,'password'))u.password=r.password||'';return u}
function userToDb(u){const row={id:u.id,name:u.name||'',nickname:u.nickname||'',username:u.username||'',email:u.email||'',role:normalizeRole(u.role),avatar:u.avatar||''};if(u.password)row.password=u.password;return row}
function eventFromDb(r){return {id:r.id,name:r.name||'',client:r.client||'',date:r.event_date||'',notes:r.notes||''}}
function eventToDb(e){return {id:e.id,name:e.name||'',client:e.client||'',event_date:e.date||null,notes:e.notes||''}}
function taskFromDb(r){return normalizeTask({id:r.id,boardType:r.board_type,eventId:r.event_id,title:r.title||'',column:r.column_id||'todo',owner:r.owner||'',ownerName:r.owner_name||'',priority:r.priority||'Normal',due:r.due||'',tags:r.tags||'',notes:r.notes||'',delayReason:r.delay_reason||'',attachments:Array.isArray(r.attachments)?r.attachments:[],aiBriefAnalysis:r.ai_brief_analysis||null,designElements:Array.isArray(r.design_elements)?r.design_elements:[],aiBriefPdfName:r.ai_brief_pdf_name||'',aiBriefPdfPath:r.ai_brief_pdf_path||'',aiBriefPdfUrl:r.ai_brief_pdf_url||'',aiBriefAnalyzedAt:r.ai_brief_analyzed_at||'',driveLink:r.drive_link||'',staffStatus:r.staff_status||'pending',submittedAt:r.submitted_at||'',submittedBy:r.submitted_by||'',updatedAt:r.updated_at||''})}
function taskToDb(t){return {id:t.id,board_type:normalizeBoardType(t.boardType),event_id:normalizeBoardType(t.boardType)==='event'?(t.eventId||null):null,title:t.title||'',column_id:t.column||'todo',owner:t.owner||'',owner_name:t.ownerName||'',priority:t.priority||'Normal',due:t.due||null,tags:t.tags||'',notes:t.notes||'',delay_reason:t.delayReason||'',attachments:t.attachments||[],ai_brief_analysis:t.aiBriefAnalysis||null,design_elements:t.designElements||[],ai_brief_pdf_name:t.aiBriefPdfName||null,ai_brief_pdf_path:t.aiBriefPdfPath||null,ai_brief_pdf_url:t.aiBriefPdfUrl||null,ai_brief_analyzed_at:t.aiBriefAnalyzedAt||null,drive_link:t.driveLink||'',staff_status:t.staffStatus||'pending',submitted_at:t.submittedAt||null,submitted_by:t.submittedBy||null,updated_at:t.updatedAt||new Date().toISOString()}}
function logFromDb(r){return {id:r.id,action:r.action||'',details:r.details||'',target:r.target||'',actor:r.actor||'',username:r.username||'',role:r.role||'',createdAt:r.created_at||'',createdAtText:r.created_at?new Date(r.created_at).toLocaleString('ar-EG',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):''}}
function logToDb(l){return {id:l.id,action:l.action,details:l.details,target:l.target,actor:l.actor,username:l.username,role:l.role,created_at:l.createdAt||new Date().toISOString()}}
async function initDb(){
  const cfg=window.BRIVVIANT_CONFIG||{};
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){setSync('Supabase غير مُعد');return false;}
  dbClient=window.supabase.createClient(cfg.SUPABASE_URL.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,''),cfg.SUPABASE_ANON_KEY);
  dbOnline=true; setSync('Supabase Connecting...');
  try{await withTimeout(loadRemoteState({mergeLocal:false,syncLocal:false}),12000,'Supabase'); setupRealtime(); setSync('Supabase Ready - Realtime Connecting'); return true;}catch(err){console.error(err); dbOnline=false; setSync('Supabase غير متصل - الحفظ متوقف'); return false;}
}
async function loadRemoteState(options={}){
  if(!dbClient)return;
  const {mergeLocal=false,syncLocal=false}=options;
  const session=getSession();
  const logsRequest=session?.role==='admin'&&session?.sessionId
    ? dbClient.rpc('studio_get_activity_logs',{p_session_id:session.sessionId,p_limit:1000})
    : Promise.resolve({data:[],error:null});
  const [u,e,t,l]=await Promise.all([
    dbClient.from('studio_users').select('id,name,nickname,username,email,role,avatar,created_at,updated_at').order('created_at',{ascending:true}),
    dbClient.from('studio_events').select('*').order('created_at',{ascending:true}),
    dbClient.from('studio_event_tasks').select('*').order('created_at',{ascending:true}),
    logsRequest
  ]);
  const err=[u.error,e.error,t.error].find(Boolean); if(err) throw err;
  if(l.error)console.warn('Activity logs will load after a valid Admin session:',l.error);
  const local=loadState();
  const remoteUsers=(u.data||[]).map(userFromDb), remoteEvents=(e.data||[]).map(eventFromDb), remoteTasks=(t.data||[]).map(taskFromDb), remoteLogs=(l.data||[]).map(logFromDb);
  state.users=mergeLocal?mergeById(local.users,remoteUsers):remoteUsers;
  state.events=mergeLocal?mergeById(local.events,remoteEvents):remoteEvents;
  state.tasks=mergeLocal?mergeById(local.tasks,remoteTasks,normalizeTask):remoteTasks;
  state.logs=(mergeLocal?mergeById(local.logs,remoteLogs):remoteLogs).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,1000);
  if(!state.users.some(x=>x.username==='Brivviant')){await dbUpsertUser(DEFAULT_ADMIN);state.users.unshift({...DEFAULT_ADMIN})}
  if(!state.events.length){const ev={id:'evt-demo',name:'Internal Studio Event',client:'Brivviant',date:today(),notes:'Demo board'};state.events.push(ev); await dbUpsertEvent(ev)}
  saveState();
  if(syncLocal) await syncLocalMissing(local,remoteUsers,remoteEvents,remoteTasks);
}
function requireDb(){if(!dbClient)throw new Error('Supabase is not connected. Check config.js and internet connection.'); dbOnline=true;}
async function dbUpsertUser(u){requireDb();const existing=state.users.some(x=>x.id===u.id);const payload=userToDb(u);const {error}=existing?await dbClient.from('studio_users').update(payload).eq('id',u.id):await dbClient.from('studio_users').insert(payload);if(error){dbOnline=false;throw error;}scheduleRealtimeRefresh(500);}
async function dbUpsertEvent(e){requireDb(); const {error}=await dbClient.from('studio_events').upsert(eventToDb(e)); if(error){dbOnline=false;throw error;} scheduleRealtimeRefresh(500);}
async function dbUpsertTask(t){requireDb();const sessionId=getSession()?.sessionId;if(!sessionId)throw new Error('جلسة الدخول غير صالحة. سجل الدخول مرة أخرى.');const {error}=await dbClient.rpc('studio_admin_save_task',{p_session_id:sessionId,p_task:taskToDb(t)});if(error){dbOnline=false;throw error;}scheduleRealtimeRefresh(500);}
async function dbUpdateTaskProgress(taskId,status,driveLink,completedIndexes){requireDb();const sessionId=getSession()?.sessionId;if(!sessionId)throw new Error('جلسة الدخول غير صالحة. سجل الدخول مرة أخرى.');const {data,error}=await dbClient.rpc('studio_update_task_progress',{p_session_id:sessionId,p_task_id:taskId,p_status:status,p_drive_link:driveLink||'',p_completed_indexes:completedIndexes});if(error){dbOnline=false;throw error;}scheduleRealtimeRefresh(300);return Array.isArray(data)?data[0]:data}
async function dbInsertLog(l){requireDb();const sessionId=getSession()?.sessionId;if(!sessionId)return;let {error}=await dbClient.rpc('studio_save_activity_log',{p_session_id:sessionId,p_log:logToDb(l)});if(error?.code==='PGRST202')({error}=await dbClient.from('studio_activity_logs').insert(logToDb(l)));if(error){dbOnline=false;throw error;}scheduleRealtimeRefresh(700);}
async function dbInsertLoginEvent(event){
  requireDb();
  const {error}=await dbClient.from('studio_login_events').insert({
    id:event.id,session_id:event.sessionId||null,user_id:event.userId||null,username:event.username||'',success:!!event.success,
    failure_reason:event.failureReason||null,event_type:event.eventType||'login',user_agent:navigator.userAgent||'',created_at:event.createdAt||new Date().toISOString()
  });
  if(error){dbOnline=false;throw error;}
}
async function dbLogin(username,password,sessionId){
  requireDb();
  const {data,error}=await dbClient.rpc('studio_login',{p_username:username,p_password:password,p_session_id:sessionId,p_user_agent:navigator.userAgent||''});
  if(error){dbOnline=false;throw error;}
  const row=Array.isArray(data)?data[0]:data;
  return row?userFromDb(row):null;
}
async function dbValidateSession(sessionId){if(!sessionId||!dbClient)return false;const {data,error}=await dbClient.rpc('studio_validate_session',{p_session_id:sessionId});if(error){if(error.code==='PGRST202')return true;console.warn('Session validation failed:',error);return false}return data===true}
async function dbLogout(sessionId){if(!sessionId||!dbClient)return;const s=getSession(),u=currentUser();const {error}=await dbClient.rpc('studio_logout',{p_session_id:sessionId,p_user_agent:navigator.userAgent||''});if(error?.code==='PGRST202'){await dbInsertLoginEvent({id:uid(),sessionId,userId:u?.id,username:u?.username||s?.username||'',success:true,eventType:'logout'});return}if(error){dbOnline=false;throw error;}}
async function dbDelete(table,id){requireDb();let error;if(table==='studio_event_tasks'){const sessionId=getSession()?.sessionId;if(!sessionId)throw new Error('جلسة الدخول غير صالحة.');({error}=await dbClient.rpc('studio_admin_delete_task',{p_session_id:sessionId,p_task_id:id}));}else({error}=await dbClient.from(table).delete().eq('id',id));if(error){dbOnline=false;throw error;}scheduleRealtimeRefresh(500);}
function safeObjectName(name){return String(name||'file').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-120)||'file'}
async function uploadStudioFile(file,folder){
  requireDb();
  if(!file)throw new Error('No file selected.');
  const id=uid(), path=`${folder}/${id}-${safeObjectName(file.name)}`;
  const {error}=await dbClient.storage.from(FILES_BUCKET).upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false,cacheControl:'3600'});
  if(error)throw error;
  const {data}=dbClient.storage.from(FILES_BUCKET).getPublicUrl(path);
  return {id,name:file.name,type:file.type||'application/octet-stream',size:file.size,path,url:data.publicUrl,data:data.publicUrl,createdAt:new Date().toISOString(),createdBy:currentUser()?.username||''};
}
async function deleteStudioFile(path){if(!path)return;requireDb();const {error}=await dbClient.storage.from(FILES_BUCKET).remove([path]);if(error)throw error;}
function setupRealtime(){
  if(!dbClient||realtimeChannel)return;
  const refresh=payload=>scheduleRealtimeRefresh(payload?.table==='studio_activity_logs'?900:250);
  realtimeChannel=dbClient.channel('studio_realtime_sync_v1')
    .on('postgres_changes',{event:'*',schema:'public',table:'studio_users'},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'studio_events'},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'studio_event_tasks'},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'studio_activity_logs'},refresh)
    .subscribe(status=>{
      if(status==='SUBSCRIBED')setSync('Supabase Realtime Ready');
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')setSync('Supabase Realtime Error');
    });
}
function scheduleRealtimeRefresh(delay=350){
  if(!dbClient)return;
  clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer=setTimeout(refreshRemoteFromRealtime,delay);
}
async function refreshRemoteFromRealtime(){
  if(realtimeRefreshRunning||!dbClient)return;
  realtimeRefreshRunning=true;
  try{
    await loadRemoteState({mergeLocal:false,syncLocal:false});
    dbOnline=true;
    setSync(realtimeChannel?'Supabase Realtime Ready':'Supabase Ready');
    render();
  }catch(err){
    console.error('Realtime refresh failed:',err);
    dbOnline=false;
    setSync('Supabase Realtime Refresh Error');
  }finally{
    realtimeRefreshRunning=false;
  }
}

let pendingFiles=[];
let pendingProfileAvatar='';
let pendingAiPdf=null;
const $=s=>document.querySelector(s); const $$=s=>Array.from(document.querySelectorAll(s));
function uid(){return crypto.randomUUID?.()||String(Date.now()+Math.random())}
function today(){return new Date().toISOString().slice(0,10)}
function nowText(){return new Date().toLocaleString('ar-EG',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function safe(v){return String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]))}
function loadState(){
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch(err){console.warn('Local cache could not be read:',err)}
  const base=saved||{events:[{id:'evt-demo',name:'Internal Studio Event',client:'Brivviant',date:today(),notes:'Demo board'}],tasks:[],users:[DEFAULT_ADMIN],logs:[]};
  base.users=Array.isArray(base.users)?base.users:[];
  if(!base.users.some(u=>u.username==='Brivviant')) base.users.unshift({...DEFAULT_ADMIN});
  base.events=Array.isArray(base.events)?base.events:[];
  base.tasks=Array.isArray(base.tasks)?base.tasks.map(normalizeTask):[];
  base.logs=Array.isArray(base.logs)?base.logs:[];
  if(!base.events.length) base.events.push({id:'evt-demo',name:'Internal Studio Event',client:'Brivviant',date:today(),notes:''});
  return base;
}
function normalizeTask(t={}){
  return {
    ...t,
    boardType:normalizeBoardType(t.boardType||t.board_type),
    eventId:t.eventId||t.event_id||'',
    column:t.column||t.column_id||'todo',
    attachments:Array.isArray(t.attachments)?t.attachments:[],
    designElements:Array.isArray(t.designElements)?t.designElements.map(x=>typeof x==='string'?{name:x,completed:false}:{...x,completed:x?.completed===true}):[],
    staffStatus:t.staffStatus||t.staff_status||'pending',
    submittedAt:t.submittedAt||t.submitted_at||'',
    submittedBy:t.submittedBy||t.submitted_by||'',
    updatedAt:t.updatedAt||t.updated_at||''
  };
}
function mergeById(local=[],remote=[],normalizer=x=>x){
  const map=new Map();
  (Array.isArray(local)?local:[]).forEach(item=>{if(item?.id)map.set(item.id,normalizer(item));});
  (Array.isArray(remote)?remote:[]).forEach(item=>{if(item?.id)map.set(item.id,normalizer(item));});
  return [...map.values()];
}
async function syncLocalMissing(local,remoteUsers,remoteEvents,remoteTasks){
  const missing=(items,remote)=>{const ids=new Set((remote||[]).map(x=>x.id)); return (items||[]).filter(x=>x?.id&&!ids.has(x.id));};
  try{
    for(const u of missing(local.users,remoteUsers)) await dbUpsertUser(u);
    for(const e of missing(local.events,remoteEvents)) await dbUpsertEvent(e);
    for(const t of missing(local.tasks,remoteTasks)) await dbUpsertTask(normalizeTask(t));
  }catch(err){
    console.warn('Cached records could not be synced:',err);
    setSync('Supabase sync failed');
  }
}
function loadImportedState(imported){
  const base=imported&&typeof imported==='object'?imported:{};
  base.users=Array.isArray(base.users)?base.users:[];
  if(!base.users.some(u=>u.username==='Brivviant')) base.users.unshift({...DEFAULT_ADMIN});
  base.events=Array.isArray(base.events)?base.events:[];
  base.tasks=Array.isArray(base.tasks)?base.tasks.map(normalizeTask):[];
  base.logs=Array.isArray(base.logs)?base.logs:[];
  if(!base.events.length) base.events.push({id:'evt-demo',name:'Internal Studio Event',client:'Brivviant',date:today(),notes:''});
  return base;
}
function getSafeLocalState(){
  // Keep the browser cache small. Large uploaded files/images/PDFs are kept in Supabase/state memory,
  // but not duplicated into localStorage because browsers usually allow only ~5MB.
  return {
    events: state.events || [],
    users: (state.users || []).map(u => ({...u, password: '', avatar: ''})),
    tasks: (state.tasks || []).map(t => ({
      ...t,
      attachments: [],
      aiBriefAnalysis: t.aiBriefAnalysis ? String(t.aiBriefAnalysis).slice(0, 3000) : null,
      designElements: t.designElements || []
    })),
    logs: (state.logs || []).slice(0, 200)
  };
}
function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getSafeLocalState()));
  }catch(err){
    console.warn('Local cache skipped because browser storage is full:', err);
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        events:state.events||[],
        users:(state.users||[]).map(u=>({...u,avatar:''})),
        tasks:(state.tasks||[]).map(t=>({...normalizeTask(t),attachments:[],aiBriefAnalysis:null,designElements:[]})),
        logs:[]
      }));
    }catch(e){console.warn('Emergency local cache also failed:',e)}
  }
}
function getSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch(e){return null}}
function setSession(u,sessionId=uid()){localStorage.setItem(SESSION_KEY,JSON.stringify({id:u.id,username:u.username,role:u.role,name:u.name,sessionId,startedAt:new Date().toISOString()}));return sessionId}
function clearSession(){localStorage.removeItem(SESSION_KEY)}
function currentUser(){const s=getSession(); return s?state.users.find(u=>u.id===s.id||u.username===s.username):null}
function isAdmin(){return currentUser()?.role==='admin'}
function isTaskOwner(t){const u=currentUser(); if(!u||!t)return false; return [u.id,u.name,u.username,u.nickname,u.email].filter(Boolean).map(x=>String(x).toLowerCase()).includes(String(t.owner||'').toLowerCase())}
function isLate(t){return t.column==='late'||(t.due&&t.due<today()&&t.column!=='done')}
function log(action,details='',target=''){
  const entry={id:uid(),action,details,target,actor:currentUser()?.name||'Unknown',username:currentUser()?.username||'',role:currentUser()?.role||'',createdAt:new Date().toISOString(),createdAtText:nowText()};
  state.logs.unshift(entry);state.logs=state.logs.slice(0,1000);saveState();renderLogs();
  if(!getSession()?.sessionId)return Promise.resolve(entry);
  const operation=logQueue.then(()=>dbInsertLog(entry));
  logQueue=operation.catch(err=>{console.error('Activity log was not saved:',err);setSync('Supabase Log Error')});
  return operation;
}
function fileToData(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res({id:uid(),name:file.name,type:file.type||'application/octet-stream',size:file.size,data:r.result,createdAt:new Date().toISOString(),createdBy:currentUser()?.username||''});r.onerror=rej;r.readAsDataURL(file)})}

function renderDashboard(){
  const grid=$('#dashboardGrid'); if(!grid)return;
  const tasks=state.tasks||[], events=state.events||[], users=state.users||[];
  const late=tasks.filter(isLate).length, done=tasks.filter(t=>t.column==='done').length, review=tasks.filter(t=>t.column==='review').length, active=tasks.filter(t=>t.column!=='done').length;
  grid.innerHTML=[
    ['Total Tasks',tasks.length,'كل التاسكات'],['Active',active,'لسه شغالة'],['Review',review,'محتاج مراجعة'],['Done',done,'تم الانتهاء'],['Late',late,'متأخر'],['Events',events.length,'فعاليات'],['Team',users.length,'حسابات']
  ].map(x=>`<div class="dash-card"><small>${x[0]}</small><b>${x[1]}</b><span>${x[2]}</span></div>`).join('');
  const lateWrap=$('#lateTasksPanel'); if(lateWrap){
    const list=tasks.filter(t=>isLate(t)||String(t.priority).toLowerCase()==='urgent').slice(0,8);
    lateWrap.innerHTML=list.map(t=>`<button class="dash-row" data-open-dash-task="${t.id}"><b>${safe(t.title)}</b><small>${safe(getUserName(t.owner))} • ${safe(t.due||'-')} • ${safe(t.priority||'Normal')}</small></button>`).join('')||'<div class="empty">لا يوجد مهام متأخرة أو عاجلة</div>';
    lateWrap.querySelectorAll('[data-open-dash-task]').forEach(b=>b.onclick=()=>openTask(b.dataset.openDashTask));
  }
  const logsWrap=$('#recentLogsPanel');
  const logsPanel=logsWrap?.closest('.dash-panel');
  if(logsPanel) logsPanel.classList.toggle('hidden',!isAdmin());
  if(logsWrap){
    if(!isAdmin()) logsWrap.innerHTML='';
    else logsWrap.innerHTML=(state.logs||[]).slice(0,8).map(l=>`<div class="dash-row static"><b>${safe(l.action)}</b><small>${safe(l.actor)} • ${safe(l.createdAtText)}</small></div>`).join('')||'<div class="empty">لا يوجد نشاط بعد</div>';
  }
}
function makeTempPassword(){return 'Bv@'+Math.random().toString(36).slice(2,10)+Math.floor(10+Math.random()*89)}
async function resetForgotPassword(e){
  e.preventDefault();
  const box=$('#forgotResult'); box.classList.add('hidden'); box.textContent='';
  if(dbOnline){try{await withTimeout(loadRemoteState({mergeLocal:false,syncLocal:false}),9000,'Supabase refresh')}catch(err){setSync('Supabase Error - Local Reset');}}
  const id=$('#forgotIdentity').value.trim().toLowerCase();
  const u=state.users.find(x=>String(x.username||'').toLowerCase()===id || String(x.email||'').toLowerCase()===id);
  if(!u){box.classList.remove('hidden'); box.innerHTML='الحساب غير موجود. راجع الـ Username أو Email.'; return;}
  const temp=makeTempPassword(),next={...u,password:temp};
  try{await dbUpsertUser(next)}catch(err){box.classList.remove('hidden'); box.innerHTML='Supabase رفض حفظ كلمة المرور: '+safe(err.message); return;}
  Object.assign(u,next);saveState();
  box.classList.remove('hidden'); box.innerHTML=`Password مؤقت:<br><b>${safe(temp)}</b><br><small>انسخه وسجل دخول، وبعدها غيره من Profile.</small>`;
  log('Reset Password','Temporary password generated',u.username);
}

function render(){applyPermissions();renderProfile();renderFilters();renderDashboard();renderBoards();renderMyTasks();renderEvents();renderTeam();renderLogs();renderStats()}
function applyPermissions(){const admin=isAdmin();$$('.admin-only').forEach(el=>el.classList.toggle('hidden',!admin)); if(!admin&&($('#board').classList.contains('active')||$('#events').classList.contains('active')||$('#team').classList.contains('active')||$('#logs').classList.contains('active'))) switchTab('mytasks')}
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
function filteredTasks(boardType=activeBoardType){const q=$('#searchInput')?.value.trim().toLowerCase()||''; const ev=$('#eventFilter')?.value||'all'; const type=normalizeBoardType(boardType); return state.tasks.filter(t=>{const taskType=normalizeBoardType(t.boardType); const matchBoard=taskType===type; const matchEvent=type!=='event'||ev==='all'||t.eventId===ev; const blob=[t.title,t.notes,t.tags,t.ownerName,getEventName(t.eventId),BOARD_TYPES[taskType]?.label].join(' ').toLowerCase(); return matchBoard&&matchEvent&&(!q||blob.includes(q));})}
function getEventName(id){return state.events.find(e=>e.id===id)?.name||'No Event'}
function getUserName(id){const u=state.users.find(x=>x.id===id); return u?(u.nickname||u.name):id}
function renderBoards(){renderBoard('event','#kanbanBoard');renderBoard('social','#socialKanbanBoard')}
function renderBoard(boardType='event',selector='#kanbanBoard'){
  const board=$(selector); if(!board)return; const tasks=filteredTasks(boardType);
  board.innerHTML=COLUMNS.map(col=>{const list=tasks.filter(t=>t.column===col.id || (col.id==='late'&&isLate(t)&&t.column!=='done'));return `<div class="kanban-col" data-col="${col.id}"><div class="col-head"><b>${col.title}</b><span class="col-count">${list.length}</span></div><div class="cards-stack">${list.map(taskCard).join('')||`<div class="empty">لا توجد كروت</div>`}</div></div>`}).join('');
  board.querySelectorAll('.task-card').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-ai-brief]'))return;openTask(el.dataset.id,boardType)}); board.querySelectorAll('[data-ai-brief]').forEach(b=>b.onclick=e=>{e.stopPropagation();openAiBrief(b.dataset.aiBrief)});
}
function priorityClass(p){p=String(p||'').toLowerCase();return p==='urgent'?'urgent':p==='high'?'high':''}
function renderDesignElements(elements,compact=false){
  const list=Array.isArray(elements)?elements.filter(Boolean):[];
  if(!list.length)return '';
  const shown=compact?list.slice(0,3):list;
  return `<div class="elements-box"><div class="elements-title">العناصر المطلوبة</div>${shown.map(el=>{
    const name=typeof el==='string'?el:(el.name||el.title||'عنصر');
    const desc=typeof el==='string'?'':(el.description||el.notes||'');
    const extra=typeof el==='string'?'':[el.quantity,el.dimensions].filter(Boolean).join(' • ');
    return `<div class="element-row ${el?.completed?'completed':''}"><b>${el?.completed?'<span class="mini-done">✓</span> ':''}${safe(name)}</b>${extra?`<small>${safe(extra)}</small>`:''}${(!compact&&desc)?`<p>${safe(desc)}</p>`:''}</div>`;
  }).join('')}${compact&&list.length>3?`<small class="more-elements">+ ${list.length-3} عناصر أخرى</small>`:''}</div>`;
}
function renderDesignElementsTable(elements,interactive=false){
  const list=Array.isArray(elements)?elements.filter(Boolean):[];
  if(!list.length)return '';
  return `<table class="elements-table ${interactive?'interactive':''}"><thead><tr><th>تم</th><th>#</th><th>العنصر</th><th>الوصف</th><th>الكمية</th><th>المقاسات</th><th>ملاحظات</th></tr></thead><tbody>${list.map((item,index)=>{
    const el=typeof item==='string'?{name:item}:item||{};
    return `<tr class="${el.completed?'completed':''}"><td>${interactive?`<label class="element-check"><input type="checkbox" data-element-check="${index}" ${el.completed?'checked':''}><span>✓</span></label>`:`<span class="element-read-check ${el.completed?'done':''}">${el.completed?'✓':'○'}</span>`}</td><td><span class="element-index">${String(index+1).padStart(2,'0')}</span></td><td><b>${safe(el.name||el.title||'عنصر')}</b></td><td>${safe(el.description||'—')}</td><td>${safe(el.quantity||'—')}</td><td>${safe(el.dimensions||el.size||'—')}</td><td>${safe(el.notes||'—')}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function taskContextName(t){return normalizeBoardType(t.boardType)==='social'?'Social Board':getEventName(t.eventId)}
function renderTaskExperience(t){
  const task=t||{title:'تاسك جديد',boardType:currentBoardType(),column:'todo',priority:'Normal',attachments:[],designElements:[]};
  const type=normalizeBoardType(task.boardType),event=state.events.find(x=>x.id===task.eventId),project=type==='social'?'Social Content':(event?.name||'مشروع جديد');
  const status=COLUMNS.find(c=>c.id===task.column)?.title||'To Do',staffStatus=STAFF_STATUSES.find(s=>s.id===(task.staffStatus||'pending'))||STAFF_STATUSES[0],owner=task.ownerName||getUserName(task.owner)||'غير محدد',tags=String(task.tags||'').split(/[,،]/).map(x=>x.trim()).filter(Boolean);
  const flow=COLUMNS,activeIndex=Math.max(0,flow.findIndex(c=>c.id===task.column));
  $('#taskDetailHero').innerHTML=`<div class="task-hero-glow"></div><div class="task-hero-copy"><div class="task-hero-kicker"><span>${safe(type==='social'?'SOCIAL BOARD':'EVENT PROJECT')}</span><span class="task-status-dot">${safe(status)}</span></div><small>المشروع</small><h3>${safe(project)}</h3><h1>${safe(task.title||'بدون عنوان')}</h1><div class="task-hero-sub"><span>${safe(event?.client||'Brivviant Studio')}</span><span>•</span><span>${safe(task.due||'بدون موعد')}</span></div></div><div class="task-progress">${flow.map((c,i)=>`<div class="task-progress-step ${i<=activeIndex?'active':''} ${c.id===task.column?'current':''}"><i></i><span>${safe(c.title)}</span></div>`).join('')}</div>`;
  $('#taskDetailOverview').innerHTML=`<div class="task-facts"><article><small>المسؤول</small><b>${safe(owner)}</b><span>Assigned owner</span></article><article><small>حالة التنفيذ</small><b class="staff-status-text status-${staffStatus.id}">${safe(staffStatus.label)}</b><span>${safe(staffStatus.hint)}</span></article><article><small>موعد التسليم</small><b>${safe(task.due||'غير محدد')}</b><span>Due date</span></article><article><small>الأولوية</small><b class="priority-text ${priorityClass(task.priority)}">${safe(task.priority||'Normal')}</b><span>Priority level</span></article><article><small>المرفقات</small><b>${(task.attachments||[]).length}</b><span>Files & references</span></article></div><div class="task-story-grid"><article class="task-brief-card"><small>PROJECT BRIEF</small><h3>تفاصيل التاسك</h3><p>${safe(task.notes||'لا توجد تفاصيل إضافية لهذا التاسك حتى الآن.')}</p>${tags.length?`<div class="task-tags">${tags.map(tag=>`<span>#${safe(tag)}</span>`).join('')}</div>`:''}</article><aside class="task-delivery-card"><small>DELIVERY</small><h3>${task.staffStatus==='submitted'?'تم التسليم':task.driveLink?'رابط مضاف':'قيد التنفيذ'}</h3>${task.driveLink?`<a href="${safe(task.driveLink)}" target="_blank" rel="noopener">فتح رابط التسليم ↗</a>`:'<p>سيظهر رابط التسليم هنا عند إضافته.</p>'}${task.submittedAt?`<span class="submitted-time">${safe(new Date(task.submittedAt).toLocaleString('ar-EG'))}</span>`:''}${task.delayReason?`<div class="delay-insight"><b>سبب التأخير</b><span>${safe(task.delayReason)}</span></div>`:''}</aside></div>`;
}
function canUpdateTaskProgress(t){return !!(t&&!isAdmin()&&isTaskOwner(t))}
function updateTaskProgressCounter(){const boxes=$$('#taskElementsView [data-element-check]'),done=boxes.filter(x=>x.checked).length,total=boxes.length;const count=$('#taskProgressCount');if(count)count.textContent=`${done} / ${total}`;const bar=$('#taskProgressBar');if(bar)bar.style.width=total?`${Math.round(done/total*100)}%`:'0%'}
function renderTaskProgressPanel(t){
  const panel=$('#taskProgressPanel');if(!panel)return;
  if(!t){panel.classList.add('hidden');panel.innerHTML='';return}
  const editable=canUpdateTaskProgress(t),status=t.staffStatus||'pending',elements=t.designElements||[],done=elements.filter(x=>x?.completed).length;
  panel.classList.remove('hidden');
  panel.innerHTML=`<div class="task-section-heading"><span>✓</span><div><small>EXECUTION UPDATE</small><h2>${editable?'حدّث تنفيذك':'متابعة تنفيذ صاحب التاسك'}</h2></div><div class="progress-number" id="taskProgressCount">${done} / ${elements.length}</div></div><div class="completion-track"><i id="taskProgressBar" style="width:${elements.length?Math.round(done/elements.length*100):0}%"></i></div><div class="staff-status-options">${STAFF_STATUSES.map(s=>`<label class="staff-status-option status-${s.id} ${status===s.id?'selected':''}"><input type="radio" name="taskStaffStatus" value="${s.id}" ${status===s.id?'checked':''} ${editable?'':'disabled'}><span><b>${safe(s.label)}</b><small>${safe(s.hint)}</small></span></label>`).join('')}</div><label class="staff-delivery-field">رابط Drive للتسليم<input id="staffTaskDriveLink" type="url" placeholder="https://drive.google.com/..." value="${safe(t.driveLink||'')}" ${editable?'':'disabled'}><small>اختيار “تم التسليم” يتطلب رابط Drive صالح.</small></label><div id="taskProgressMessage" class="task-progress-message"></div>${editable?'<button type="button" id="saveTaskProgressBtn" class="save-progress-btn">حفظ حالة التنفيذ والتسليم</button>':''}`;
  if(editable){$$('[name="taskStaffStatus"]').forEach(input=>input.onchange=()=>{$$('.staff-status-option').forEach(x=>x.classList.toggle('selected',x.querySelector('input')?.checked))});$('#saveTaskProgressBtn').onclick=saveTaskProgress}
}
async function saveTaskProgress(){
  const t=state.tasks.find(x=>x.id===$('#taskId').value),message=$('#taskProgressMessage');if(!canUpdateTaskProgress(t)){if(message)message.textContent='غير مسموح بتحديث هذا التاسك.';return}
  const status=$('[name="taskStaffStatus"]:checked')?.value||'pending',driveLink=$('#staffTaskDriveLink').value.trim(),completedIndexes=$$('#taskElementsView [data-element-check]').filter(x=>x.checked).map(x=>Number(x.dataset.elementCheck));
  if(driveLink&&!/^https?:\/\//i.test(driveLink)){message.textContent='رابط Drive لازم يبدأ بـ http أو https.';return}
  if(status==='submitted'&&!driveLink){message.textContent='أضف رابط Drive قبل اختيار “تم التسليم”.';return}
  const btn=$('#saveTaskProgressBtn');btn.disabled=true;message.textContent='جاري الحفظ في Supabase...';
  try{await dbUpdateTaskProgress(t.id,status,driveLink,completedIndexes);t.staffStatus=status;t.driveLink=driveLink;t.designElements=(t.designElements||[]).map((el,index)=>({...el,completed:completedIndexes.includes(index)}));t.submittedAt=status==='submitted'?new Date().toISOString():'';t.submittedBy=currentUser()?.id||'';t.updatedAt=new Date().toISOString();saveState();renderTaskExperience(t);renderTaskProgressPanel(t);const view=$('#taskElementsView');view.innerHTML=renderDesignElementsTable(t.designElements,true)||'لم يتم استخراج عناصر بعد';view.querySelectorAll('[data-element-check]').forEach(x=>x.onchange=updateTaskProgressCounter);updateTaskProgressCounter();$('#taskProgressMessage').textContent='تم حفظ التحديث والتسليم في Supabase.';renderMyTasks()}catch(err){message.textContent='فشل الحفظ: '+err.message}finally{const activeBtn=$('#saveTaskProgressBtn');if(activeBtn)activeBtn.disabled=false}
}
function previewTaskExperience(){
  if(!isAdmin()||!$('#taskDialog')?.open)return;
  const current=state.tasks.find(x=>x.id===$('#taskId').value)||{},owner=state.users.find(u=>u.id===$('#taskOwner').value);
  renderTaskExperience({...current,title:$('#taskTitle').value,boardType:$('#taskBoardType').value,eventId:$('#taskEvent').value,column:$('#taskColumn').value,owner:owner?.id||'',ownerName:owner?(owner.nickname||owner.name):'',priority:$('#taskPriority').value,due:$('#taskDue').value,tags:$('#taskTags').value,notes:$('#taskNotes').value,driveLink:$('#taskDriveLink').value});
}
function attachmentUrl(a){return a?.url||a?.data||''}
function taskCard(t){const atts=t.attachments||[],elements=t.designElements||[],done=elements.filter(x=>x?.completed).length,status=STAFF_STATUSES.find(s=>s.id===(t.staffStatus||'pending'))||STAFF_STATUSES[0],contextLabel=normalizeBoardType(t.boardType)==='social'?'Board':'Event';return `<article class="task-card" data-id="${t.id}"><div class="task-top"><div class="task-title">${safe(t.title)}</div><span class="pill ${priorityClass(t.priority)}">${safe(t.priority||'Normal')}</span></div><div class="card-execution-row"><span class="staff-mini-status status-${status.id}">${safe(status.label)}</span><span>${done}/${elements.length} عناصر</span></div><div class="meta-grid"><div class="meta"><small>${contextLabel}</small><b>${safe(taskContextName(t))}</b></div><div class="meta"><small>Owner</small><b>${safe(t.ownerName||getUserName(t.owner))}</b></div><div class="meta"><small>Due</small><b>${safe(t.due||'-')}</b></div><div class="meta"><small>Files</small><b>${atts.length}</b></div></div>${renderDesignElements(t.designElements,true)}${t.notes?`<div class="task-notes">${safe(t.notes).slice(0,130)}</div>`:''}<div class="thumbs">${atts.slice(0,4).map(a=>a.type?.startsWith('image/')?`<img src="${safe(attachmentUrl(a))}" alt="">`:`<span class="pdf-chip">PDF</span>`).join('')}</div>${t.driveLink?`<div class="task-drive"><small>Drive</small><a href="${safe(t.driveLink)}" target="_blank" rel="noopener">فتح رابط التسليم</a></div>`:''}<div class="task-actions"><button type="button" class="ai-brief-btn" data-ai-brief="${t.id}">شرح العناصر</button></div></article>`}
function renderMyTasks(){
  const u=currentUser();
  const list=$('#myTasksList');
  if(!u){list.innerHTML='';return}
  const tasks=state.tasks.filter(t=>isTaskOwner(t));
  list.innerHTML=tasks.map(t=>{
    const workflowStatus=safe(COLUMNS.find(c=>c.id===t.column)?.title||t.column),staffStatus=STAFF_STATUSES.find(s=>s.id===(t.staffStatus||'pending'))||STAFF_STATUSES[0],elements=t.designElements||[],done=elements.filter(x=>x?.completed).length;
    return `<article class="horizontal-card mytask-card" data-id="${t.id}">
      <div class="mytask-main">
        <div class="main-title">${safe(t.title)}</div>
        <p>${safe(taskContextName(t))}</p>
        ${t.notes?`<div class="mytask-notes">${safe(t.notes)}</div>`:''}
        ${renderDesignElements(t.designElements,true)}
      </div>
      <div class="cell"><small>حالة التنفيذ</small><b class="staff-status-text status-${staffStatus.id}">${safe(staffStatus.label)}</b><span>${done}/${elements.length} عناصر</span></div>
      <div class="cell"><small>Board Status</small><b>${workflowStatus}</b></div>
      <div class="cell"><small>Due</small><b>${safe(t.due||'-')}</b></div>
      <div class="cell"><small>Priority</small><b>${safe(t.priority||'Normal')}</b></div>
      <div class="cell"><small>Files</small><b>${(t.attachments||[]).length}</b></div>
      <div class="mytask-actions-panel">
        <div class="permission-note">يمكنك تحديث العناصر والحالة وإضافة رابط التسليم من تفاصيل التاسك.</div>
        ${t.driveLink?`<a class="delivery-link" href="${safe(t.driveLink)}" target="_blank" rel="noopener">فتح رابط التسليم</a>`:''}
        <div class="row-actions">
          <button type="button" data-ai-brief="${t.id}">عرض البريف</button>
          <button type="button" data-open="${t.id}">عرض التفاصيل</button>
        </div>
      </div>
    </article>`;
  }).join('')||`<div class="empty">لا توجد تاسكات مخصصة لك</div>`;
  list.querySelectorAll('button[data-open]').forEach(b=>b.onclick=()=>openTask(b.dataset.open));
  list.querySelectorAll('button[data-ai-brief]').forEach(b=>b.onclick=()=>openAiBrief(b.dataset.aiBrief));
}

async function saveMyDelayReason(id){
  const t=state.tasks.find(x=>x.id===id);
  if(!isAdmin()){alert('تعديل التاسك متاح للـAdmin فقط.');log('Blocked Delay Edit','Admin only',t?.title||id);return}
  if(!t)return;
  const input=document.querySelector(`[data-delay-input="${CSS.escape(id)}"]`);
  const next={...t,delayReason:(input?.value||'').trim(),updatedAt:new Date().toISOString()};
  try{await dbUpsertTask(next)}catch(err){alert('Database Error: '+err.message);return}
  Object.assign(t,next);saveState();
  log('Update Delay Reason',t.delayReason,t.title);
  render();
}

async function markMyTaskDone(id){
  const t=state.tasks.find(x=>x.id===id);
  if(!isAdmin()){alert('تعديل حالة التاسك متاح للـAdmin فقط.');log('Blocked Done','Admin only',t?.title||id);return}
  if(!t)return;
  const input=document.querySelector(`[data-drive-input="${CSS.escape(id)}"]`);
  const link=(input?.value||'').trim();
  if(!link){alert('لازم تضيف Drive Link للتسليم قبل ما تعمل Done.');return}
  if(!/^https?:\/\//i.test(link)){alert('Drive Link لازم يبدأ بـ http أو https.');return}
  const next={...t,driveLink:link,column:'done',updatedAt:new Date().toISOString()};
  try{await dbUpsertTask(next)}catch(err){alert('Database Error: '+err.message);return}
  Object.assign(t,next);saveState();
  log('Mark Done',`Done with drive link: ${link}`,t.title);
  render();
}
function renderEvents(){const grid=$('#eventsGrid'); grid.innerHTML=state.events.map(e=>`<article class="event-card" data-id="${e.id}"><h3>${safe(e.name)}</h3><p>${safe(e.client||'')}</p><p>${safe(e.date||'')}</p><button data-edit-event="${e.id}">Edit</button></article>`).join(''); grid.querySelectorAll('[data-edit-event]').forEach(b=>b.onclick=()=>openEvent(b.dataset.editEvent))}
function renderTeam(){const grid=$('#teamGrid'); grid.innerHTML=state.users.map(u=>`<article class="person-card"><h3>${safe(u.nickname||u.name)}</h3><p>@${safe(u.username)} — ${safe(u.role)}</p><p>${safe(u.email||'')}</p><button data-edit-user="${u.id}">Edit</button></article>`).join(''); grid.querySelectorAll('[data-edit-user]').forEach(b=>b.onclick=()=>openAccount(b.dataset.editUser))}
function renderLogs(){const list=$('#logsList'); if(!list)return; if(!isAdmin()){list.innerHTML='';return} list.innerHTML=state.logs.map(l=>`<div class="log-card"><b>${safe(l.action)}</b><span>${safe(l.actor)}<br><small>@${safe(l.username)}</small></span><p>${safe(l.details)} ${l.target?`<small>— ${safe(l.target)}</small>`:''}</p><small>${safe(l.createdAtText)}</small></div>`).join('')||`<div class="empty">No logs yet</div>`}


function normalizeDesignElements(analysis){
  const src=analysis?.required_elements||analysis?.design_elements||analysis?.elements||[];
  if(Array.isArray(src)) return src.map(x=>{
    if(typeof x==='string') return {name:x,description:'',quantity:'',dimensions:'',notes:''};
    return {name:String(x.name||x.title||x.element||'عنصر'),description:String(x.description||''),quantity:String(x.quantity||''),dimensions:String(x.dimensions||x.size||''),notes:String(x.notes||'')};
  }).filter(x=>x.name&&x.name!=='عنصر');
  if(typeof src==='string') return src.split(/\n|،|,/).map(x=>x.trim()).filter(Boolean).map(x=>({name:x,description:'',quantity:'',dimensions:'',notes:''}));
  return [];
}
function briefAnalysisToHtml(analysis){
  if(!analysis) return '<div class="empty">لا يوجد تحليل محفوظ لهذا الكارت.</div>';
  const esc=safe;
  const arr=(v)=>Array.isArray(v)?v.filter(Boolean):[];
  if(typeof analysis==='string') return `<div class="brief-block">${esc(analysis).replace(/\n/g,'<br>')}</div>`;
  const itemText=x=>typeof x==='string'?x:[x?.name||x?.title,x?.description,x?.quantity&&`العدد: ${x.quantity}`,x?.dimensions&&`المقاس: ${x.dimensions}`,x?.notes].filter(Boolean).join(' — ');
  const section=(title,items)=>arr(items).length?`<h3>${esc(title)}</h3><ul>${arr(items).map(x=>`<li>${esc(itemText(x))}</li>`).join('')}</ul>`:'';
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
  $('#aiBriefTaskContext').innerHTML=`<b>${safe(t.title)}</b><br><span>${safe(taskContextName(t))}</span><br><small>Owner: ${safe(t.ownerName||getUserName(t.owner))}</small>`;
  $('#aiBriefStatus').textContent='';
  $('#aiBriefOutput').classList.toggle('empty',!t.aiBriefAnalysis);
  $('#aiBriefOutput').innerHTML=briefAnalysisToHtml(t.aiBriefAnalysis);
  const readOnly=!isAdmin();
  $('#aiBriefPdf').closest('label')?.classList.toggle('hidden',readOnly);
  $('#analyzeBriefBtn').classList.toggle('hidden',readOnly);
  $('#saveBriefElementsBtn').classList.toggle('hidden',readOnly);
  if(readOnly)$('#aiBriefStatus').textContent='عرض فقط — تحليل البريف وحفظ العناصر متاح للـAdmin فقط.';
  $('#aiBriefDialog').showModal();
}
function dataUrlBase64(dataUrl){return String(dataUrl||'').split(',')[1]||''}
async function analyzeBrief(){
  const task=state.tasks.find(x=>x.id===$('#aiBriefTaskId').value); if(!task)return;
  if(!isAdmin()){$('#aiBriefStatus').textContent='تحليل البريف متاح للـAdmin فقط.';return}
  if(!pendingAiPdf){$('#aiBriefStatus').textContent='ارفع PDF الأول.';return}
  const cfg=window.BRIVVIANT_CONFIG||{};
  const endpoint=cfg.AI_BRIEF_ENDPOINT || (cfg.SUPABASE_URL?`${cfg.SUPABASE_URL.replace(/\/$/,'')}/functions/v1/analyze-brief`:'');
  if(!endpoint){$('#aiBriefStatus').textContent='AI API مش متوصل. اكتب AI_BRIEF_ENDPOINT في config.js أو فعّل Supabase Edge Function.';return}
  $('#aiBriefStatus').textContent='جاري تحليل كراسة الشروط بالـ AI...';
  $('#analyzeBriefBtn').disabled=true;
  try{
    // Edge Function is deployed with verify_jwt=false to avoid CORS/Auth gateway failures.
    // Keep Authorization optional only if you explicitly set AI_BRIEF_SEND_AUTH=true in config.js.
    const headers={'Content-Type':'application/json','Accept':'application/json'};
    if(cfg.AI_BRIEF_SEND_AUTH && cfg.SUPABASE_ANON_KEY){ headers.Authorization=`Bearer ${cfg.SUPABASE_ANON_KEY}`; headers.apikey=cfg.SUPABASE_ANON_KEY; }
    const res=await fetch(endpoint,{method:'POST',mode:'cors',headers,body:JSON.stringify({
      task:{id:task.id,title:task.title,event:getEventName(task.eventId),notes:task.notes,tags:task.tags},
      pdf:{name:pendingAiPdf.name,type:pendingAiPdf.type,base64:dataUrlBase64(pendingAiPdf.data)}
    })});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||data.message||`API Error ${res.status}`);
    const analysis=data.analysis||data;
    const designElements=normalizeDesignElements(analysis);
    if(!analysis||typeof analysis!=='object')throw new Error('الـ AI لم يرجع نتيجة منظمة. أعد المحاولة بملف PDF أوضح.');
    $('#aiBriefStatus').textContent='تم التحليل. جاري رفع ملف البريف وحفظ العناصر في Supabase...';
    const uploaded=await uploadStudioFile(pendingAiPdf.file,`briefs/${task.id}`);
    const next={...task,aiBriefAnalysis:analysis,designElements,aiBriefPdfName:pendingAiPdf.name,aiBriefPdfPath:uploaded.path,aiBriefPdfUrl:uploaded.url,aiBriefAnalyzedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    try{await dbUpsertTask(next)}catch(err){await deleteStudioFile(uploaded.path).catch(()=>{});throw err}
    if(task.aiBriefPdfPath&&task.aiBriefPdfPath!==uploaded.path)await deleteStudioFile(task.aiBriefPdfPath).catch(console.warn);
    Object.assign(task,next);saveState();log('AI Brief Analysis',`${pendingAiPdf.name} — ${designElements.length} elements`,task.title);
    $('#aiBriefOutput').classList.remove('empty');
    $('#aiBriefOutput').innerHTML=briefAnalysisToHtml(task.aiBriefAnalysis);
    $('#aiBriefStatus').textContent=designElements.length?`تم استخراج وحفظ ${designElements.length} عنصر داخل نفس الكارت في Supabase.`:'تم حفظ التحليل وملف البريف في Supabase، لكن الـPDF لا يحتوي عناصر تنفيذ واضحة. راجع الملخص أو جرّب نسخة أوضح.';
    render();
  }catch(err){
    const msg=(err instanceof TypeError && String(err.message).includes('Failed to fetch'))
      ? 'فشل التحليل: Failed to fetch — الحل: Deploy للـ Edge Function باسم analyze-brief مع verify_jwt=false، ثم إضافة GEMINI_API_KEY في Secrets. افتح README_GEMINI_SETUP.txt واتبع الخطوات حرفيًا.'
      : 'فشل التحليل: '+err.message;
    $('#aiBriefStatus').textContent=msg;
  }finally{$('#analyzeBriefBtn').disabled=false;}
}
function copyBrief(){
  const t=state.tasks.find(x=>x.id===$('#aiBriefTaskId').value); if(!t?.aiBriefAnalysis){$('#aiBriefStatus').textContent='لا يوجد تحليل لنسخه.';return}
  const text=typeof t.aiBriefAnalysis==='string'?t.aiBriefAnalysis:JSON.stringify(t.aiBriefAnalysis,null,2);
  navigator.clipboard?.writeText(text); $('#aiBriefStatus').textContent='تم نسخ التحليل.';
}
async function saveBriefElementsOnly(){
  const t=state.tasks.find(x=>x.id===$('#aiBriefTaskId').value);
  if(!isAdmin()){$('#aiBriefStatus').textContent='حفظ عناصر البريف متاح للـAdmin فقط.';return}
  if(!t?.aiBriefAnalysis){$('#aiBriefStatus').textContent='حلل PDF الأول.';return}
  const next={...t,designElements:normalizeDesignElements(t.aiBriefAnalysis),updatedAt:new Date().toISOString()};
  try{await dbUpsertTask(next)}catch(err){alert('Database Error: '+err.message);return}
  Object.assign(t,next);saveState();
  $('#aiBriefStatus').textContent=`تم حفظ ${t.designElements.length} عنصر داخل نفس الكارت في Supabase.`;
  log('Save Brief Elements',`${t.designElements.length} elements saved`,t.title);
  render();
}

function currentBoardType(){const tab=$('.tab.active')?.id; return tab==='social'?'social':'event'}
function updateTaskBoardFields(){
  const type=normalizeBoardType($('#taskBoardType')?.value);
  const eventSelect=$('#taskEvent');
  if(eventSelect)eventSelect.required=type==='event';
  eventSelect?.closest('label')?.classList.toggle('hidden',type==='social');
}
function switchTab(tab){if(!isAdmin()&&['events','team','logs'].includes(tab)) tab='mytasks'; if(tab==='board'||tab==='social')activeBoardType=tab==='social'?'social':'event'; $$('.tab').forEach(s=>s.classList.toggle('active',s.id===tab));$$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$('#pageTitle').textContent=$(`.nav-btn[data-tab="${tab}"]`)?.textContent||tab}
function setTaskDialogReadOnly(readOnly){
  ['taskBoardType','taskEvent','taskColumn','taskTitle','taskOwner','taskPriority','taskDue','taskTags','taskNotes','taskDriveLink','taskFiles'].forEach(id=>{const el=$(`#${id}`);if(el)el.disabled=readOnly});
  $('#saveTaskBtn').classList.toggle('hidden',readOnly);
  $('#taskPermissionNote').classList.toggle('hidden',!readOnly);
  $('#taskFiles')?.closest('label')?.classList.toggle('hidden',readOnly);
  $('#taskEditorFields').classList.toggle('hidden',readOnly);
}
function openTask(id='',boardType=currentBoardType()){
  if(!id&&!isAdmin()){alert('إنشاء التاسكات متاح للـAdmin فقط.');return}
  const t=state.tasks.find(x=>x.id===id)||null; const type=normalizeBoardType(t?.boardType||boardType); pendingFiles=[];$('#taskDialogTitle').textContent=isAdmin()?(t?'تعديل التاسك':'إنشاء تاسك جديد'):'تفاصيل التاسك'; $('#taskId').value=t?.id||''; $('#taskBoardType').value=type; $('#taskTitle').value=t?.title||''; $('#taskEvent').value=t?.eventId||state.events[0]?.id||''; $('#taskColumn').value=t?.column||'todo'; $('#taskOwner').value=t?.owner||currentUser()?.id||''; $('#taskPriority').value=t?.priority||'Normal'; $('#taskDue').value=t?.due||''; $('#taskTags').value=t?.tags||''; $('#taskNotes').value=t?.notes||'';$('#taskDriveLink').value=t?.driveLink||''; $('#taskDelayReason').value=t?.delayReason||''; $('#deleteTaskBtn').classList.toggle('hidden',!t||!isAdmin());
  updateTaskBoardFields();
  $('#delayReasonWrap').classList.add('hidden'); $('#taskDelayReason').disabled=true;
  renderTaskExperience(t);renderTaskProgressPanel(t);const ev=$('#taskElementsView'); if(ev){const interactive=canUpdateTaskProgress(t);ev.classList.toggle('empty',!(t?.designElements||[]).length); ev.innerHTML=renderDesignElementsTable(t?.designElements||[],interactive)||'لم يتم استخراج عناصر بعد';if(interactive)ev.querySelectorAll('[data-element-check]').forEach(x=>x.onchange=updateTaskProgressCounter)}
  setTaskDialogReadOnly(!isAdmin());renderAttachmentPreview(t?.attachments||[]); $('#taskDialog').showModal();
}
function renderAttachmentPreview(atts){const wrap=$('#taskAttachmentsPreview'); wrap.innerHTML=atts.map(a=>`<div class="attachment-card" data-att="${a.id}">${a.type?.startsWith('image/')?`<img src="${safe(attachmentUrl(a))}" alt="">`:`<div class="pdf-chip">PDF</div>`}<a href="${safe(attachmentUrl(a))}" target="_blank" rel="noopener">فتح ${safe(a.name)}</a>${isAdmin()&&!a.pending?`<button type="button" data-del-att="${a.id}">حذف</button>`:''}</div>`).join(''); wrap.querySelectorAll('[data-del-att]').forEach(b=>b.onclick=async()=>{const id=$('#taskId').value; const t=state.tasks.find(x=>x.id===id); const file=t?.attachments?.find(a=>a.id===b.dataset.delAtt); if(!t||!file)return; const next={...t,attachments:t.attachments.filter(a=>a.id!==file.id),updatedAt:new Date().toISOString()}; try{await dbUpsertTask(next);await deleteStudioFile(file.path)}catch(err){alert('لم يتم حذف الملف من Supabase: '+err.message);return}Object.assign(t,next);saveState();log('Delete Attachment',file.name,t.title);renderAttachmentPreview(t.attachments);render();})}
async function saveTask(e){e.preventDefault(); const id=$('#taskId').value; const owner=state.users.find(u=>u.id===$('#taskOwner').value); const type=normalizeBoardType($('#taskBoardType').value); const current=state.tasks.find(x=>x.id===id); const isNew=!current; const t={...(current||{id:uid(),attachments:[]})};
  if(!isAdmin()){alert('تعديل التاسك متاح للـAdmin فقط.');log('Blocked Edit','Admin only',$('#taskTitle').value);return}
  t.title=$('#taskTitle').value.trim(); t.boardType=type; t.eventId=type==='event'?$('#taskEvent').value:''; t.column=$('#taskColumn').value; t.owner=owner?.id||$('#taskOwner').value; t.ownerName=owner?(owner.nickname||owner.name):''; t.priority=$('#taskPriority').value; t.due=$('#taskDue').value; t.tags=$('#taskTags').value; t.notes=$('#taskNotes').value;t.driveLink=$('#taskDriveLink').value.trim(); t.updatedAt=new Date().toISOString();
  if(t.driveLink&&!/^https?:\/\//i.test(t.driveLink)){alert('Drive Link لازم يبدأ بـ http أو https.');return}
  const uploaded=[];
  try{
    setSync(pendingFiles.length?'Uploading files to Supabase...':'Saving to Supabase...');
    for(const file of pendingFiles)uploaded.push(await uploadStudioFile(file,`tasks/${t.id}`));
    t.attachments=[...(t.attachments||[]),...uploaded];
    await dbUpsertTask(t);
  }catch(err){for(const file of uploaded)await deleteStudioFile(file.path).catch(()=>{});setSync('Supabase Save Error');alert('لم يتم الحفظ في Supabase: '+err.message);return}
  if(isNew)state.tasks.push(t);else Object.assign(current,t);pendingFiles=[];saveState();setSync('Supabase Ready');log(isNew?'Create Task':'Update Task',t.title,taskContextName(t));$('#taskDialog').close();render();
}
function openEvent(id=''){const e=state.events.find(x=>x.id===id)||null; $('#eventId').value=e?.id||''; $('#eventName').value=e?.name||''; $('#eventClient').value=e?.client||''; $('#eventDate').value=e?.date||''; $('#eventNotes').value=e?.notes||''; $('#deleteEventBtn').classList.toggle('hidden',!e); $('#eventDialog').showModal()}
async function saveEvent(e){e.preventDefault();const current=state.events.find(x=>x.id===$('#eventId').value);const isNew=!current;const ev={...(current||{id:uid()}),name:$('#eventName').value,client:$('#eventClient').value,date:$('#eventDate').value,notes:$('#eventNotes').value};try{await dbUpsertEvent(ev)}catch(err){alert('لم يتم الحفظ في Supabase: '+err.message);return}if(isNew)state.events.push(ev);else Object.assign(current,ev);saveState();log(isNew?'Create Event':'Update Event',ev.name);$('#eventDialog').close();render()}
function openAccount(id=''){const u=state.users.find(x=>x.id===id)||null; $('#accountId').value=u?.id||''; $('#accountName').value=u?.name||''; $('#accountNickname').value=u?.nickname||''; $('#accountUsername').value=u?.username||''; $('#accountEmail').value=u?.email||''; $('#accountPassword').value='';$('#accountPassword').placeholder=u?'اتركها فارغة للاحتفاظ بكلمة المرور':'مطلوبة للحساب الجديد'; $('#accountRole').value=u?.role||'staff'; $('#deleteAccountBtn').classList.toggle('hidden',!u||u.username==='Brivviant'); $('#accountDialog').showModal()}
async function saveAccount(e){e.preventDefault();const current=state.users.find(x=>x.id===$('#accountId').value);const isNew=!current;const username=$('#accountUsername').value.trim(),newPassword=$('#accountPassword').value;if(isNew&&!newPassword){alert('Password مطلوبة للحساب الجديد');return}if(state.users.some(x=>x.username===username&&x.id!==$('#accountId').value)){alert('Username موجود بالفعل');return}const u={...(current||{id:uid(),avatar:''}),name:$('#accountName').value,nickname:$('#accountNickname').value,username,email:$('#accountEmail').value,role:normalizeRole($('#accountRole').value)};if(newPassword)u.password=newPassword;else delete u.password;try{await dbUpsertUser(u)}catch(err){alert('لم يتم الحفظ في Supabase: '+err.message);return}if(isNew)state.users.push(u);else Object.assign(current,u);saveState();log(isNew?'Create Account':'Update Account',u.username);$('#accountDialog').close();render()}
function openProfile(){const u=currentUser(); if(!u)return; pendingProfileAvatar=''; $('#profileName').value=u.name||''; $('#profileNickname').value=u.nickname||''; $('#profileUsername').value=u.username||''; $('#profileEmail').value=u.email||''; $('#profilePassword').value=''; $('#avatarPreview').innerHTML=u.avatar?`<img src="${u.avatar}">`:'No Image'; $('#profileDialog').showModal()}
async function saveProfile(e){e.preventDefault();const current=currentUser();if(!current)return;const u={...current,name:$('#profileName').value,nickname:$('#profileNickname').value,email:$('#profileEmail').value};if($('#profilePassword').value)u.password=$('#profilePassword').value;else delete u.password;let uploaded=null;try{if(pendingProfileAvatar instanceof File){uploaded=await uploadStudioFile(pendingProfileAvatar,`avatars/${u.id}`);u.avatar=uploaded.url;u.avatar_path=uploaded.path}await dbUpsertUser(u)}catch(err){if(uploaded)await deleteStudioFile(uploaded.path).catch(()=>{});alert('لم يتم حفظ الملف الشخصي في Supabase: '+err.message);return}Object.assign(current,u);pendingProfileAvatar='';saveState();log('Update Profile',u.username);$('#profileDialog').close();render()}

async function handleLogin(e){
  e.preventDefault();
  const err=$('#loginError'), btn=$('#loginBtn');
  err.textContent=''; btn.disabled=true; const oldText=btn.textContent; btn.textContent='جاري تسجيل الدخول...';
  try{
    const un=$('#loginUsername').value.trim(), pw=$('#loginPassword').value.trim();
    if(!un||!pw){if(dbClient)await dbInsertLoginEvent({id:uid(),sessionId:uid(),username:un,success:false,failureReason:'missing_credentials',eventType:'login'}).catch(console.error);err.textContent='لازم تدخل Username و Password';return}
    if(!dbClient){err.textContent='Supabase غير متصل. راجع config.js واتصال الإنترنت.';return}
    try{dbOnline=true;await withTimeout(loadRemoteState({mergeLocal:false,syncLocal:false}),12000,'Supabase login');setupRealtime();setSync(realtimeChannel?'Supabase Realtime Ready':'Supabase Ready')}catch(ex){console.error(ex);dbOnline=false;setSync('Supabase Login Error');err.textContent='تعذر الاتصال بـ Supabase، لذلك لم يتم تسجيل الدخول.';return}
    const sessionId=uid();
    let u;
    try{u=await dbLogin(un,pw,sessionId)}catch(ex){console.error(ex);err.textContent='تعذر التحقق من الدخول في Supabase. شغّل ملف SQL الجديد ثم حاول مرة أخرى.';return}
    if(!u){err.textContent='Username أو Password غير صحيح.';return}
    const loaded=state.users.find(x=>x.id===u.id);if(loaded)Object.assign(loaded,u);else state.users.push(u);u=loaded||u;
    setSession(u,sessionId);
    try{await log('Login','User logged in',sessionId)}catch(logErr){await dbLogout(sessionId).catch(()=>{});clearSession();throw new Error('تم التحقق من الحساب لكن تعذر حفظ الـLog في Supabase: '+logErr.message)}
    $('#loginOverlay').classList.add('hidden');render();
  }catch(ex){console.error(ex);err.textContent='حدث خطأ أثناء تسجيل الدخول: '+ex.message;
  } finally {btn.disabled=false; btn.textContent=oldText;}
}

async function handleLogout(){const s=getSession();try{if(s?.sessionId){await log('Logout','User logged out',s.sessionId).catch(console.warn);await dbLogout(s.sessionId).catch(console.warn)}}finally{clearSession();$('#loginOverlay').classList.remove('hidden');$('#loginPassword').value='';$('#loginError').textContent='';setSync(dbOnline?'Supabase Ready':'Supabase غير متصل');render()}}

async function importStateToSupabase(imported){
  requireDb();
  for(const u of imported.users||[])await dbUpsertUser(u);
  for(const e of imported.events||[])await dbUpsertEvent(e);
  for(const t of imported.tasks||[])await dbUpsertTask(normalizeTask(t));
  state=imported;saveState();log('Import JSON','State imported to Supabase');render();
}

function bind(){
  $$('.nav-btn').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab)); $('#profileBar').onclick=openProfile; $('#logoutBtn').onclick=handleLogout; $('#loginForm').onsubmit=handleLogin; $('#forgotPasswordBtn').onclick=()=>{$('#forgotResult').classList.add('hidden');$('#forgotIdentity').value=$('#loginUsername').value||'';$('#forgotDialog').showModal()}; $('#forgotForm').onsubmit=resetForgotPassword; $('#cancelForgotBtn').onclick=()=>$('#forgotDialog').close();
  $('#quickTaskBtn')&&($('#quickTaskBtn').onclick=()=>openTask()); $('#quickEventBtn')&&($('#quickEventBtn').onclick=()=>openEvent()); $('#addTaskBtn').onclick=()=>openTask(); $('#taskForm').onsubmit=saveTask; $('#cancelTaskBtn').onclick=()=>$('#taskDialog').close(); $('#deleteTaskBtn').onclick=async()=>{const id=$('#taskId').value;const t=state.tasks.find(x=>x.id===id);if(t&&confirm('حذف التاسك؟')){try{await dbDelete('studio_event_tasks',id);for(const file of t.attachments||[])await deleteStudioFile(file.path).catch(console.warn)}catch(err){alert('Database Error: '+err.message);return}state.tasks=state.tasks.filter(x=>x.id!==id);saveState();log('Delete Task',t.title);$('#taskDialog').close();render()}};
  $('#taskFiles').onchange=e=>{if(!isAdmin()){e.target.value='';alert('رفع مرفقات التاسك متاح للـAdmin فقط.');return}pendingFiles=[...e.target.files];const previews=pendingFiles.map(file=>({id:uid(),name:file.name,type:file.type,size:file.size,url:URL.createObjectURL(file),pending:true}));const id=$('#taskId').value;const current=state.tasks.find(t=>t.id===id)?.attachments||[];renderAttachmentPreview([...current,...previews])};
  $('#quickTaskBtn')&&($('#quickTaskBtn').onclick=()=>openTask('',currentBoardType()));
  $('#addTaskBtn')&&($('#addTaskBtn').onclick=()=>openTask('','event'));
  $('#addSocialTaskBtn')&&($('#addSocialTaskBtn').onclick=()=>openTask('','social'));
  $('#taskBoardType')&&($('#taskBoardType').onchange=()=>{updateTaskBoardFields();previewTaskExperience()});
  ['taskEvent','taskColumn','taskOwner','taskPriority','taskDue'].forEach(id=>{$(`#${id}`).onchange=previewTaskExperience});
  ['taskTitle','taskTags','taskNotes','taskDriveLink'].forEach(id=>{$(`#${id}`).oninput=previewTaskExperience});
  $('#addEventBtn').onclick=()=>openEvent(); $('#eventForm').onsubmit=saveEvent; $('#cancelEventBtn').onclick=()=>$('#eventDialog').close(); $('#deleteEventBtn').onclick=async()=>{const id=$('#eventId').value;if(confirm('حذف الفعالية؟')){try{await dbDelete('studio_events',id)}catch(err){alert('Database Error: '+err.message);return}state.events=state.events.filter(e=>e.id!==id);saveState();log('Delete Event',id);$('#eventDialog').close();render()}};
  $('#addPersonBtn').onclick=()=>openAccount(); $('#accountForm').onsubmit=saveAccount; $('#cancelAccountBtn').onclick=()=>$('#accountDialog').close(); $('#deleteAccountBtn').onclick=async()=>{const id=$('#accountId').value;const u=state.users.find(x=>x.id===id);if(u&&confirm('حذف الحساب؟')){try{await dbDelete('studio_users',id)}catch(err){alert('Database Error: '+err.message);return}state.users=state.users.filter(x=>x.id!==id);saveState();log('Delete Account',u.username);$('#accountDialog').close();render()}}; $('#generatePasswordBtn').onclick=()=>{$('#accountPassword').value='Bv@'+Math.random().toString(36).slice(2,10)};
  $('#profileForm').onsubmit=saveProfile; $('#cancelProfileBtn').onclick=()=>$('#profileDialog').close(); $('#profileImage').onchange=e=>{const f=e.target.files[0];if(f){pendingProfileAvatar=f;$('#avatarPreview').innerHTML=`<img src="${URL.createObjectURL(f)}">`}};
  $('#aiBriefPdf').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(!/pdf$/i.test(f.name)&&f.type!=='application/pdf'){$('#aiBriefStatus').textContent='الملف لازم يكون PDF.';return}if(f.size>15*1024*1024){$('#aiBriefStatus').textContent='حجم PDF أكبر من 15MB. اضغط الملف ثم حاول مرة أخرى.';return}pendingAiPdf=await fileToData(f);pendingAiPdf.file=f;$('#aiBriefStatus').textContent='تم اختيار PDF: '+f.name};
  $('#analyzeBriefBtn').onclick=analyzeBrief; $('#copyBriefBtn').onclick=copyBrief; const saveEls=$('#saveBriefElementsBtn'); if(saveEls) saveEls.onclick=saveBriefElementsOnly; $('#closeAiBriefBtn').onclick=()=>$('#aiBriefDialog').close();
  $('#searchInput').oninput=renderBoard; $('#eventFilter').onchange=renderBoard; $('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='brivviant-studio-events-state.json';a.click();URL.revokeObjectURL(a.href);log('Export JSON','State exported')};
  $('#searchInput').oninput=renderBoards;
  $('#eventFilter').onchange=renderBoards;
  $('#importInput').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=async()=>{try{await importStateToSupabase(loadImportedState(JSON.parse(r.result)))}catch(err){alert('فشل استيراد البيانات إلى Supabase: '+err.message)}};r.readAsText(f)};
}
async function boot(){bind();await initDb();const session=getSession();const valid=!!(dbOnline&&session?.sessionId&&currentUser()&&await dbValidateSession(session.sessionId));if(valid)$('#loginOverlay').classList.add('hidden');else{clearSession();$('#loginOverlay').classList.remove('hidden')}render()}
boot();
