-- Brivviant Studio Events Tasks — Supabase setup
-- Run this whole file in Supabase SQL Editor for the Studio project.

create extension if not exists pgcrypto with schema extensions;

create table if not exists studio_users (
  id text primary key,
  name text not null,
  nickname text,
  username text unique not null,
  password text not null,
  email text,
  role text default 'staff' check (role in ('admin','staff')),
  avatar text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists studio_events (
  id text primary key,
  name text not null,
  client text,
  event_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists studio_event_tasks (
  id text primary key,
  board_type text default 'event',
  event_id text references studio_events(id) on delete set null,
  title text not null,
  column_id text default 'todo',
  owner text,
  owner_name text,
  priority text,
  due date,
  tags text,
  notes text,
  delay_reason text,
  attachments jsonb default '[]'::jsonb,
  ai_brief_analysis jsonb,
  design_elements jsonb default '[]'::jsonb,
  ai_brief_pdf_name text,
  ai_brief_analyzed_at timestamptz,
  drive_link text,
  staff_status text not null default 'pending' check (staff_status in ('pending','working','blocked','submitted')),
  submitted_at timestamptz,
  submitted_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists studio_activity_logs (
  id text primary key,
  action text,
  details text,
  target text,
  actor text,
  username text,
  role text,
  created_at timestamptz default now()
);

-- Every login attempt and logout is persisted here, including failed logins.
create table if not exists studio_login_events (
  id text primary key,
  session_id text,
  user_id text references studio_users(id) on delete set null,
  username text,
  success boolean not null default false,
  failure_reason text,
  event_type text not null default 'login' check (event_type in ('login','logout')),
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists studio_sessions (
  session_id text primary key,
  user_id text not null references studio_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '12 hours'),
  ended_at timestamptz
);

-- Passwords are stored as bcrypt hashes. Existing plaintext rows are migrated once.
create or replace function public.studio_hash_password()
returns trigger
language plpgsql
set search_path=public,extensions
as $$
begin
  if new.password is null or new.password='' then
    raise exception 'Password cannot be empty';
  end if;
  if new.password not like '$2%' then
    new.password=extensions.crypt(new.password,extensions.gen_salt('bf'));
  end if;
  return new;
end;
$$;

drop trigger if exists studio_users_hash_password on public.studio_users;
create trigger studio_users_hash_password
before insert or update of password on public.studio_users
for each row execute function public.studio_hash_password();

update public.studio_users
set password=extensions.crypt(password,extensions.gen_salt('bf'))
where password is not null and password<>'' and password not like '$2%';

-- Login verification and audit insertion happen in the same database call.
create or replace function public.studio_login(
  p_username text,
  p_password text,
  p_session_id text,
  p_user_agent text default ''
)
returns table(id text,name text,nickname text,username text,email text,role text,avatar text)
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_user public.studio_users%rowtype;
begin
  select su.* into v_user
  from public.studio_users su
  where lower(su.username)=lower(trim(p_username))
    and su.password=extensions.crypt(p_password,su.password)
  limit 1;

  insert into public.studio_login_events
    (id,session_id,user_id,username,success,failure_reason,event_type,user_agent)
  values
    (gen_random_uuid()::text,p_session_id,v_user.id,trim(p_username),v_user.id is not null,
     case when v_user.id is null then 'invalid_credentials' else null end,'login',left(coalesce(p_user_agent,''),1000));

  if v_user.id is not null then
    insert into public.studio_sessions(session_id,user_id,created_at,expires_at,ended_at)
    values (p_session_id,v_user.id,now(),now()+interval '12 hours',null)
    on conflict (session_id) do update set user_id=excluded.user_id,created_at=now(),expires_at=now()+interval '12 hours',ended_at=null;
    return query select v_user.id,v_user.name,v_user.nickname,v_user.username,v_user.email,v_user.role,v_user.avatar;
  end if;
end;
$$;

revoke all on function public.studio_login(text,text,text,text) from public;
grant execute on function public.studio_login(text,text,text,text) to anon;

alter table studio_users add column if not exists updated_at timestamptz default now();
alter table studio_events add column if not exists updated_at timestamptz default now();
alter table studio_event_tasks add column if not exists updated_at timestamptz default now();
alter table studio_event_tasks add column if not exists board_type text default 'event';
alter table studio_event_tasks add column if not exists ai_brief_analysis jsonb;
alter table studio_event_tasks add column if not exists design_elements jsonb default '[]'::jsonb;
alter table studio_event_tasks add column if not exists ai_brief_pdf_name text;
alter table studio_event_tasks add column if not exists ai_brief_pdf_path text;
alter table studio_event_tasks add column if not exists ai_brief_pdf_url text;
alter table studio_event_tasks add column if not exists ai_brief_analyzed_at timestamptz;
alter table studio_event_tasks add column if not exists staff_status text not null default 'pending';
alter table studio_event_tasks add column if not exists submitted_at timestamptz;
alter table studio_event_tasks add column if not exists submitted_by text;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='studio_event_tasks_staff_status_check') then
    alter table public.studio_event_tasks add constraint studio_event_tasks_staff_status_check check (staff_status in ('pending','working','blocked','submitted'));
  end if;
end $$;

-- Session-backed authorization. Task writes are only exposed through admin RPCs.
create or replace function public.studio_session_user(p_session_id text,p_admin_only boolean default false)
returns text language plpgsql security definer set search_path=public as $$
declare v_user_id text;
begin
  select s.user_id into v_user_id
  from public.studio_sessions s join public.studio_users u on u.id=s.user_id
  where s.session_id=p_session_id and s.ended_at is null and s.expires_at>now()
    and (not p_admin_only or u.role='admin');
  if v_user_id is null then raise exception 'Not authorized or session expired' using errcode='42501'; end if;
  return v_user_id;
end;
$$;

create or replace function public.studio_validate_session(p_session_id text)
returns boolean language sql security definer set search_path=public stable as $$
  select exists(select 1 from public.studio_sessions s where s.session_id=p_session_id and s.ended_at is null and s.expires_at>now());
$$;

create or replace function public.studio_admin_save_task(p_session_id text,p_task jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.studio_session_user(p_session_id,true);
  insert into public.studio_event_tasks
    (id,board_type,event_id,title,column_id,owner,owner_name,priority,due,tags,notes,delay_reason,attachments,ai_brief_analysis,design_elements,ai_brief_pdf_name,ai_brief_pdf_path,ai_brief_pdf_url,ai_brief_analyzed_at,drive_link,staff_status,submitted_at,submitted_by,updated_at)
  values
    (p_task->>'id',coalesce(p_task->>'board_type','event'),nullif(p_task->>'event_id',''),coalesce(p_task->>'title',''),coalesce(p_task->>'column_id','todo'),p_task->>'owner',p_task->>'owner_name',p_task->>'priority',nullif(p_task->>'due','')::date,p_task->>'tags',p_task->>'notes',p_task->>'delay_reason',coalesce(p_task->'attachments','[]'::jsonb),p_task->'ai_brief_analysis',coalesce(p_task->'design_elements','[]'::jsonb),p_task->>'ai_brief_pdf_name',p_task->>'ai_brief_pdf_path',p_task->>'ai_brief_pdf_url',nullif(p_task->>'ai_brief_analyzed_at','')::timestamptz,p_task->>'drive_link',coalesce(p_task->>'staff_status','pending'),nullif(p_task->>'submitted_at','')::timestamptz,p_task->>'submitted_by',now())
  on conflict (id) do update set
    board_type=excluded.board_type,event_id=excluded.event_id,title=excluded.title,column_id=excluded.column_id,owner=excluded.owner,owner_name=excluded.owner_name,priority=excluded.priority,due=excluded.due,tags=excluded.tags,notes=excluded.notes,delay_reason=excluded.delay_reason,attachments=excluded.attachments,ai_brief_analysis=excluded.ai_brief_analysis,design_elements=excluded.design_elements,ai_brief_pdf_name=excluded.ai_brief_pdf_name,ai_brief_pdf_path=excluded.ai_brief_pdf_path,ai_brief_pdf_url=excluded.ai_brief_pdf_url,ai_brief_analyzed_at=excluded.ai_brief_analyzed_at,drive_link=excluded.drive_link,staff_status=excluded.staff_status,submitted_at=excluded.submitted_at,submitted_by=excluded.submitted_by,updated_at=now();
end;
$$;

create or replace function public.studio_update_task_progress(p_session_id text,p_task_id text,p_status text,p_drive_link text,p_completed_indexes jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_user public.studio_users%rowtype;v_task public.studio_event_tasks%rowtype;v_elements jsonb;
begin
  select u.* into v_user from public.studio_users u where u.id=public.studio_session_user(p_session_id,false);
  select * into v_task from public.studio_event_tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found' using errcode='P0002'; end if;
  if v_user.role<>'admin' and not (coalesce(v_task.owner,'')=v_user.id or lower(coalesce(v_task.owner,'')) in (lower(coalesce(v_user.username,'')),lower(coalesce(v_user.name,'')),lower(coalesce(v_user.nickname,'')),lower(coalesce(v_user.email,'')))) then raise exception 'Only the assigned user can update task progress' using errcode='42501'; end if;
  if p_status not in ('pending','working','blocked','submitted') then raise exception 'Invalid task status' using errcode='22023'; end if;
  if p_status='submitted' and nullif(trim(coalesce(p_drive_link,'')),'') is null then raise exception 'Drive link is required for submission' using errcode='22023'; end if;
  select coalesce(jsonb_agg(case when jsonb_typeof(e.value)='object' then jsonb_set(e.value,'{completed}',to_jsonb(exists(select 1 from jsonb_array_elements_text(coalesce(p_completed_indexes,'[]'::jsonb)) x where x.value::int=e.ordinality-1)),true) else jsonb_build_object('name',trim(both '"' from e.value::text),'completed',exists(select 1 from jsonb_array_elements_text(coalesce(p_completed_indexes,'[]'::jsonb)) x where x.value::int=e.ordinality-1)) end order by e.ordinality),'[]'::jsonb) into v_elements
  from jsonb_array_elements(coalesce(v_task.design_elements,'[]'::jsonb)) with ordinality e(value,ordinality);
  update public.studio_event_tasks set staff_status=p_status,drive_link=nullif(trim(coalesce(p_drive_link,'')),''),design_elements=v_elements,submitted_at=case when p_status='submitted' then now() else null end,submitted_by=case when p_status='submitted' then v_user.id else null end,updated_at=now() where id=p_task_id;
  insert into public.studio_activity_logs(id,action,details,target,actor,username,role,created_at)
  values(gen_random_uuid()::text,'Task Progress Update','Status: '||p_status||' | Completed elements: '||jsonb_array_length(coalesce(p_completed_indexes,'[]'::jsonb)),v_task.title,v_user.name,v_user.username,v_user.role,now());
end;
$$;

create or replace function public.studio_admin_delete_task(p_session_id text,p_task_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.studio_session_user(p_session_id,true);
  delete from public.studio_event_tasks where id=p_task_id;
end;
$$;

create or replace function public.studio_save_activity_log(p_session_id text,p_log jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_user public.studio_users%rowtype;
begin
  select u.* into v_user from public.studio_users u where u.id=public.studio_session_user(p_session_id,false);
  insert into public.studio_activity_logs(id,action,details,target,actor,username,role,created_at)
  values (coalesce(nullif(p_log->>'id',''),gen_random_uuid()::text),p_log->>'action',p_log->>'details',p_log->>'target',v_user.name,v_user.username,v_user.role,now())
  on conflict (id) do nothing;
end;
$$;

create or replace function public.studio_get_activity_logs(p_session_id text,p_limit integer default 1000)
returns setof public.studio_activity_logs
language plpgsql security definer set search_path=public as $$
begin
  perform public.studio_session_user(p_session_id,true);
  return query select l.* from public.studio_activity_logs l order by l.created_at desc limit greatest(1,least(coalesce(p_limit,1000),1000));
end;
$$;

create or replace function public.studio_logout(p_session_id text,p_user_agent text default '')
returns void language plpgsql security definer set search_path=public as $$
declare v_user public.studio_users%rowtype;
begin
  select u.* into v_user from public.studio_users u join public.studio_sessions s on s.user_id=u.id where s.session_id=p_session_id and s.ended_at is null;
  if v_user.id is null then raise exception 'Session not found' using errcode='42501'; end if;
  update public.studio_sessions set ended_at=now() where session_id=p_session_id;
  insert into public.studio_login_events(id,session_id,user_id,username,success,event_type,user_agent)
  values(gen_random_uuid()::text,p_session_id,v_user.id,v_user.username,true,'logout',left(coalesce(p_user_agent,''),1000));
end;
$$;

revoke all on function public.studio_session_user(text,boolean) from public;
revoke all on function public.studio_validate_session(text) from public;
revoke all on function public.studio_admin_save_task(text,jsonb) from public;
revoke all on function public.studio_admin_delete_task(text,text) from public;
revoke all on function public.studio_update_task_progress(text,text,text,text,jsonb) from public;
revoke all on function public.studio_save_activity_log(text,jsonb) from public;
revoke all on function public.studio_get_activity_logs(text,integer) from public;
revoke all on function public.studio_logout(text,text) from public;
grant execute on function public.studio_admin_save_task(text,jsonb) to anon;
grant execute on function public.studio_validate_session(text) to anon;
grant execute on function public.studio_admin_delete_task(text,text) to anon;
grant execute on function public.studio_update_task_progress(text,text,text,text,jsonb) to anon;
grant execute on function public.studio_save_activity_log(text,jsonb) to anon;
grant execute on function public.studio_get_activity_logs(text,integer) to anon;
grant execute on function public.studio_logout(text,text) to anon;

-- Default admin account
insert into studio_users (id,name,nickname,username,password,email,role,avatar)
values ('admin-brivviant','Brivviant','Main Admin','Brivviant','Brivviant@123456','','admin','')
on conflict (username) do update set
  name=excluded.name,
  nickname=excluded.nickname,
  role='admin',
  updated_at=now();

insert into studio_events (id,name,client,event_date,notes)
values ('evt-demo','Internal Studio Event','Brivviant',current_date,'Demo board')
on conflict (id) do nothing;

-- RLS: tasks and activity logs are read-only through REST; writes use checked RPCs.
alter table studio_users enable row level security;
alter table studio_events enable row level security;
alter table studio_event_tasks enable row level security;
alter table studio_activity_logs enable row level security;
alter table studio_login_events enable row level security;
alter table studio_sessions enable row level security;

drop policy if exists "studio_users_frontend_access" on studio_users;
drop policy if exists "studio_events_frontend_access" on studio_events;
drop policy if exists "studio_event_tasks_frontend_access" on studio_event_tasks;
drop policy if exists "studio_activity_logs_frontend_access" on studio_activity_logs;
drop policy if exists "studio_login_events_frontend_access" on studio_login_events;

create policy "studio_users_frontend_access" on studio_users
for all to anon using (true) with check (true);

-- The frontend can list profile fields, but it cannot read password hashes.
revoke select on table public.studio_users from anon;
grant select (id,name,nickname,username,email,role,avatar,created_at,updated_at) on table public.studio_users to anon;
grant insert,update,delete on table public.studio_users to anon;

create policy "studio_events_frontend_access" on studio_events
for all to anon using (true) with check (true);

create policy "studio_event_tasks_frontend_access" on studio_event_tasks
for select to anon using (true);

create policy "studio_activity_logs_frontend_access" on studio_activity_logs
for select to anon using (false);

revoke insert,update,delete on table public.studio_event_tasks from anon;
revoke select,insert,update,delete on table public.studio_activity_logs from anon;
grant select on table public.studio_event_tasks to anon;

create policy "studio_login_events_frontend_access" on studio_login_events
for insert to anon with check (true);

-- All task uploads, profile photos, and analyzed brief PDFs live in Supabase Storage.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('studio-files','studio-files',true,15728640,array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "studio_files_public_read" on storage.objects;
drop policy if exists "studio_files_frontend_insert" on storage.objects;
drop policy if exists "studio_files_frontend_update" on storage.objects;
drop policy if exists "studio_files_frontend_delete" on storage.objects;

create policy "studio_files_public_read" on storage.objects for select to public using (bucket_id='studio-files');
create policy "studio_files_frontend_insert" on storage.objects for insert to anon with check (bucket_id='studio-files');
create policy "studio_files_frontend_update" on storage.objects for update to anon using (bucket_id='studio-files') with check (bucket_id='studio-files');
create policy "studio_files_frontend_delete" on storage.objects for delete to anon using (bucket_id='studio-files');

-- Optional delivery link. Only an Admin can change the task or its status.
alter table studio_event_tasks add column if not exists drive_link text;
update studio_event_tasks set board_type='event' where board_type is null;

-- Supabase Realtime setup.
-- This block only adds missing tables to the publication. It never drops tables,
-- so it avoids "relation is not part of the publication" errors.
alter table public.studio_users replica identity full;
alter table public.studio_events replica identity full;
alter table public.studio_event_tasks replica identity full;
alter table public.studio_activity_logs replica identity full;
alter table public.studio_login_events replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='studio_users'
  ) then
    alter publication supabase_realtime add table public.studio_users;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='studio_events'
  ) then
    alter publication supabase_realtime add table public.studio_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='studio_event_tasks'
  ) then
    alter publication supabase_realtime add table public.studio_event_tasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='studio_activity_logs'
  ) then
    alter publication supabase_realtime add table public.studio_activity_logs;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='studio_login_events'
  ) then
    alter publication supabase_realtime add table public.studio_login_events;
  end if;
end $$;
