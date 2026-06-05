-- Brivviant Studio Events Tasks — Supabase setup
-- Run this whole file in Supabase SQL Editor for the Studio project.

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

alter table studio_users add column if not exists updated_at timestamptz default now();
alter table studio_events add column if not exists updated_at timestamptz default now();
alter table studio_event_tasks add column if not exists updated_at timestamptz default now();
alter table studio_event_tasks add column if not exists board_type text default 'event';
alter table studio_event_tasks add column if not exists ai_brief_analysis jsonb;
alter table studio_event_tasks add column if not exists design_elements jsonb default '[]'::jsonb;
alter table studio_event_tasks add column if not exists ai_brief_pdf_name text;
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

drop policy if exists "studio_users_frontend_access" on studio_users;
drop policy if exists "studio_events_frontend_access" on studio_events;
drop policy if exists "studio_event_tasks_frontend_access" on studio_event_tasks;
drop policy if exists "studio_activity_logs_frontend_access" on studio_activity_logs;

create policy "studio_users_frontend_access" on studio_users
for all to anon using (true) with check (true);

create policy "studio_events_frontend_access" on studio_events
for all to anon using (true) with check (true);

create policy "studio_event_tasks_frontend_access" on studio_event_tasks
for all to anon using (true) with check (true);

create policy "studio_activity_logs_frontend_access" on studio_activity_logs
for all to anon using (true) with check (true);

-- Delivery link required by the app before a Staff member can mark a task as Done
alter table studio_event_tasks add column if not exists drive_link text;
update studio_event_tasks set board_type='event' where board_type is null;
