-- Wave 9 reproducible bootstrap prerequisites.
--
-- This is NOT an historical migration and does not assert the original
-- creation order of these tables. It is a forward, schema-only bootstrap
-- derived from the authenticated production schema dump captured on
-- 2026-09-28 for project zcpgtdakqxyvjkmiibei. It exists because the tracked
-- migrations begin by assuming these production-foundation relations already
-- exist. Historical migrations stay unchanged.
--
-- Supported replay order:
--   1. migrations/schema.sql
--   2. 20260521000100_pilot_onboarding_foundation.sql as the retained
--      compatibility foundation (it supplies facility_cameras and other
--      pre-March prerequisites)
--   3. this file
--   4. every supabase/migrations/*.sql in lexical/version order
--
-- The later security migration owns RLS/policy/grant convergence. This file
-- deliberately creates only the structural prerequisites it can verify from
-- current production, plus pre-existing indexes not created by a tracked
-- migration. It contains no application data and is idempotent.

create extension if not exists pgcrypto;

create table if not exists public.community_posts (
  id uuid default gen_random_uuid() not null,
  estate_id uuid not null,
  author_id uuid not null,
  title text,
  body text,
  created_at timestamptz default now() not null,
  updated_at timestamptz,
  status text default 'published' not null,
  media jsonb,
  live_link text,
  view_count integer default 0 not null,
  category text default 'resident',
  is_pinned boolean default false,
  pinned_until timestamptz,
  audience_type text default 'all_estate',
  audience_ref text,
  scheduled_at timestamptz,
  priority text,
  constraint community_posts_pkey primary key (id)
);

create index if not exists idx_community_posts_created on public.community_posts(created_at desc);
create index if not exists idx_community_posts_estate on public.community_posts(estate_id);
create index if not exists idx_community_posts_estate_status_created on public.community_posts(estate_id, status, created_at desc);

create table if not exists public.estate_devices (
  id uuid default gen_random_uuid() not null,
  estate_id uuid not null,
  home_id uuid,
  room text,
  adapter text default 'tuya' not null,
  external_id text not null,
  name text,
  category text,
  online boolean default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint estate_devices_pkey primary key (id),
  constraint estate_devices_estate_id_fkey foreign key (estate_id) references public.estates(id) on delete cascade,
  constraint estate_devices_home_id_fkey foreign key (home_id) references public.homes(id) on delete set null
);

create unique index if not exists uniq_estate_devices_home_adapter_external on public.estate_devices(home_id, adapter, external_id);

create table if not exists public.user_integrations (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  provider text not null,
  external_user_id text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint user_integrations_pkey primary key (id),
  constraint user_integrations_user_provider_unique unique (user_id, provider),
  constraint user_integrations_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade
);

create index if not exists idx_user_integrations_user_id on public.user_integrations(user_id);

create table if not exists public.user_presence (
  user_id uuid not null,
  estate_id uuid,
  home_id uuid,
  last_seen_at timestamptz default now() not null,
  is_online boolean default true not null,
  updated_at timestamptz default now() not null,
  id uuid default gen_random_uuid() not null,
  constraint user_presence_pkey primary key (id),
  constraint user_presence_user_home_key unique (user_id, home_id),
  constraint user_presence_estate_id_fkey foreign key (estate_id) references public.estates(id) on delete set null,
  constraint user_presence_home_id_fkey foreign key (home_id) references public.homes(id) on delete set null,
  constraint user_presence_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade
);

create index if not exists idx_user_presence_estate_id on public.user_presence(estate_id);
create index if not exists idx_user_presence_home_id on public.user_presence(home_id);

create table if not exists public.visitor_access (
  id uuid default gen_random_uuid() not null,
  estate_id uuid not null,
  home_id uuid not null,
  created_by uuid not null,
  visitor_name text not null,
  visitor_phone text not null,
  purpose text,
  access_code text not null,
  status text default 'active' not null,
  expires_at timestamptz,
  created_at timestamptz default now() not null,
  house_id uuid,
  navigation_mode text default 'code',
  resident_id uuid,
  constraint visitor_access_pkey primary key (id)
);

create index if not exists idx_visitor_access_code on public.visitor_access(access_code);
create index if not exists idx_visitor_access_estate on public.visitor_access(estate_id);
create index if not exists idx_visitor_access_home on public.visitor_access(home_id);
create index if not exists idx_visitor_access_resident on public.visitor_access(resident_id);

create table if not exists public.visitors_legacy (
  id uuid default gen_random_uuid() not null,
  full_name text,
  email text,
  phone text,
  estate_id uuid,
  home_id uuid,
  current_lat numeric,
  current_lng numeric,
  status text default 'idle',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- The retained foundation already owns the schema-wide visitors_pkey name.
  -- Production's legacy table carries that historical name, but PostgreSQL
  -- constraint names share a schema namespace; use an equivalent bootstrap
  -- identifier without claiming to reproduce the historical rename sequence.
  constraint visitors_legacy_pkey primary key (id),
  constraint visitors_estate_id_fkey foreign key (estate_id) references public.estates(id) on delete cascade,
  constraint visitors_home_id_fkey foreign key (home_id) references public.homes(id) on delete set null
);

create index if not exists idx_visitors_estate on public.visitors_legacy(estate_id);
create index if not exists idx_visitors_home on public.visitors_legacy(home_id);

-- The retained schema foundation defines wallet_transactions before its
-- historical owner column. The first tracked security policy already relies
-- on that column, while no tracked predecessor creates it. This is verified
-- current-production compatibility state, not an assertion about the original
-- provisioning migration.
alter table public.wallet_transactions
  add column if not exists user_id uuid;

-- Security closure phase 2 hardens these pre-existing trigger functions. They
-- are reproduced here from the verified production definitions because the
-- retained migration sequence only alters their configuration.
create or replace function public.set_camera_ai_profiles_updated_at()
returns trigger language plpgsql
as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql
as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.sync_house_id()
returns trigger language plpgsql
as $$ begin new.house_id := new.home_id; return new; end; $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql
as $$
begin
  if to_jsonb(new) ? 'updated_at' then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

create or replace function public.notify_invite_created()
returns trigger language plpgsql
as $$
declare invited_user uuid;
begin
  select u.id into invited_user from public.users u
  where lower(u.email) = lower(new.invited_email) limit 1;
  if invited_user is null then return new; end if;
  insert into public.notifications (user_id, title, message, type, payload, status, created_at, updated_at)
  values (
    invited_user,
    'Home invite',
    'You’ve been invited to join a home. Tap to review.',
    'invite',
    jsonb_build_object('inviteId', new.id, 'estate_id', new.estate_id, 'home_id', new.home_id,
      'invited_email', new.invited_email, 'role', new.role),
    'unread', now(), now()
  );
  return new;
end;
$$;
