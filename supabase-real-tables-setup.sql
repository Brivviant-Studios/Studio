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

-- Default admin account
insert into studio_users (id,name,nickname,username,password,email,role,avatar)
values ('admin-brivviant','Brivviant','Main Admin','Brivviant','Brivviant@123456','','admin','')
on conflict (username) do update set
  name=excluded.name,
  nickname=excluded.nickname,
  password=excluded.password,
  role='admin',
  updated_at=now();

insert into studio_events (id,name,client,event_date,notes)
values ('evt-demo','Internal Studio Event','Brivviant',current_date,'Demo board')
on conflict (id) do nothing;

-- Remove the UNRESTRICTED warning by enabling RLS.
-- IMPORTANT: Because this app uses custom username/password login from the frontend,
-- the policies below allow the anon frontend key to read/write these tables.
-- This fixes Supabase warnings but is not as secure as Supabase Auth.
alter table studio_users enable row level security;
alter table studio_events enable row level security;
alter table studio_event_tasks enable row level security;
alter table studio_activity_logs enable row level security;
alter table studio_login_events enable row level security;

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
for all to anon using (true) with check (true);

create policy "studio_activity_logs_frontend_access" on studio_activity_logs
for all to anon using (true) with check (true);

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

-- Delivery link required by the app before a Staff member can mark a task as Done
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
