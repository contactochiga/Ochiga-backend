-- Enterprise device ownership and home-scoped provider connections.
-- This extends the canonical registry/runtime model without replacing it.

create extension if not exists pgcrypto;

create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_account_id text not null,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  home_membership_id uuid null references public.home_memberships(id) on delete set null,
  estate_id uuid not null references public.estates(id) on delete cascade,
  building_id uuid null,
  home_id uuid not null references public.homes(id) on delete cascade,
  connection_scope text not null default 'resident_home',
  credential_reference text null,
  status text not null default 'active',
  last_sync_at timestamptz null,
  last_successful_sync_at timestamptz null,
  last_error jsonb null,
  sync_cursor jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  disconnected_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_connections_scope_check check (connection_scope in ('resident_home','facility_estate','partner_managed','system')),
  constraint provider_connections_status_check check (status in ('active','disconnected','expired','authorization_required','degraded','pending'))
);

create unique index if not exists provider_connections_active_home_account_uniq
  on public.provider_connections(provider, owner_user_id, home_id, provider_account_id)
  where disconnected_at is null;

create index if not exists idx_provider_connections_home
  on public.provider_connections(estate_id, home_id, provider, status);

create index if not exists idx_provider_connections_owner
  on public.provider_connections(owner_user_id, provider, status);

alter table public.devices add column if not exists provider_connection_id uuid null references public.provider_connections(id) on delete set null;
alter table public.devices add column if not exists ownership_class text null;
alter table public.devices add column if not exists assignment_scope text null;
alter table public.devices add column if not exists commissioning_status text null;
alter table public.devices add column if not exists visibility_policy jsonb not null default '{}'::jsonb;
alter table public.devices add column if not exists control_policy jsonb not null default '{}'::jsonb;
alter table public.devices add column if not exists critical_event_policy jsonb not null default '{}'::jsonb;
alter table public.devices add column if not exists owner_user_id uuid null references public.users(id) on delete set null;
alter table public.devices add column if not exists building_id uuid null;

create index if not exists idx_devices_provider_connection
  on public.devices(provider_connection_id);

create index if not exists idx_devices_projection_scope
  on public.devices(estate_id, home_id, ownership_class, sync_state);

create index if not exists idx_devices_owner_home
  on public.devices(owner_user_id, home_id)
  where owner_user_id is not null;

create table if not exists public.device_access_grants (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  user_id uuid null references public.users(id) on delete cascade,
  home_id uuid null references public.homes(id) on delete cascade,
  estate_id uuid not null references public.estates(id) on delete cascade,
  grant_type text not null,
  can_view boolean not null default true,
  can_control boolean not null default false,
  can_manage boolean not null default false,
  source text not null default 'system',
  expires_at timestamptz null,
  created_by uuid null references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_access_grants_type_check check (grant_type in ('owner','resident_home','facility_support','technician','shared_access','emergency'))
);

create unique index if not exists device_access_grants_device_user_type_uniq
  on public.device_access_grants(device_id, user_id, grant_type)
  where user_id is not null and expires_at is null;

create unique index if not exists device_access_grants_device_home_type_uniq
  on public.device_access_grants(device_id, home_id, grant_type)
  where home_id is not null and expires_at is null;

create index if not exists idx_device_access_grants_home
  on public.device_access_grants(estate_id, home_id, grant_type);

-- Backfill home-scoped Tuya provider connections from legacy user-level storage.
-- Production schemas have varied over time, so legacy source reads are guarded.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'tuya_uid'
  ) then
    execute $sql$
      insert into public.provider_connections (
        provider, provider_account_id, owner_user_id, home_membership_id,
        estate_id, home_id, connection_scope, status, metadata, created_at, updated_at
      )
      select
        'tuya',
        nullif(trim(u.tuya_uid), ''),
        hm.user_id,
        hm.id,
        h.estate_id,
        hm.home_id,
        'resident_home',
        'active',
        jsonb_build_object('source', 'legacy_users_tuya_uid_backfill'),
        now(),
        now()
      from public.home_memberships hm
      join public.homes h on h.id = hm.home_id
      join public.users u on u.id = hm.user_id
      where hm.status = 'active'
        and nullif(trim(u.tuya_uid), '') is not null
      on conflict (provider, owner_user_id, home_id, provider_account_id)
      where disconnected_at is null
      do update set
        home_membership_id = coalesce(public.provider_connections.home_membership_id, excluded.home_membership_id),
        estate_id = excluded.estate_id,
        status = case when public.provider_connections.status = 'disconnected' then 'active' else public.provider_connections.status end,
        updated_at = now()
    $sql$;
  end if;

  if to_regclass('public.user_integrations') is not null then
    execute $sql$
      insert into public.provider_connections (
        provider, provider_account_id, owner_user_id, home_membership_id,
        estate_id, home_id, connection_scope, status, metadata, created_at, updated_at
      )
      select
        'tuya',
        nullif(trim(ui.external_user_id), ''),
        hm.user_id,
        hm.id,
        h.estate_id,
        hm.home_id,
        'resident_home',
        'active',
        jsonb_build_object('source', 'legacy_user_integrations_backfill'),
        now(),
        now()
      from public.home_memberships hm
      join public.homes h on h.id = hm.home_id
      join public.user_integrations ui on ui.user_id = hm.user_id and lower(ui.provider) = 'tuya'
      where hm.status = 'active'
        and nullif(trim(ui.external_user_id), '') is not null
      on conflict (provider, owner_user_id, home_id, provider_account_id)
      where disconnected_at is null
      do update set
        home_membership_id = coalesce(public.provider_connections.home_membership_id, excluded.home_membership_id),
        estate_id = excluded.estate_id,
        status = case when public.provider_connections.status = 'disconnected' then 'active' else public.provider_connections.status end,
        updated_at = now()
    $sql$;
  end if;
end $$;

-- Preserve existing Tuya device identity while attaching it to a scoped connection where possible.
update public.devices d
set
  provider_connection_id = pc.id,
  owner_user_id = coalesce(d.owner_user_id, pc.owner_user_id),
  ownership_class = coalesce(d.ownership_class, 'resident_owned'),
  assignment_scope = coalesce(d.assignment_scope, 'home'),
  commissioning_status = coalesce(d.commissioning_status, case when d.home_id is not null then 'assigned' else 'discovered' end),
  visibility_policy = coalesce(d.visibility_policy, '{}'::jsonb),
  control_policy = coalesce(d.control_policy, '{}'::jsonb),
  critical_event_policy = coalesce(d.critical_event_policy, '{}'::jsonb),
  updated_at = now()
from public.provider_connections pc
where d.provider_connection_id is null
  and lower(coalesce(d.provider, d.vendor, d.adapter, '')) = 'tuya'
  and pc.provider = 'tuya'
  and pc.home_id = d.home_id
  and (
    d.metadata #>> '{oyi,integration_owner_user_id}' = pc.owner_user_id::text
    or d.metadata #>> '{context,userId}' = pc.owner_user_id::text
  );

update public.devices
set
  ownership_class = coalesce(
    ownership_class,
    case
      when coalesce(is_virtual, false) = true and parent_device_id is not null then 'resident_owned'
      when metadata #>> '{oyi,technical_visibility}' = 'hidden_from_residents' then 'hidden_technical'
      when home_id is not null and lower(coalesce(provider, vendor, adapter, '')) = 'tuya' then 'resident_owned'
      when home_id is not null then 'shared_home'
      else 'building_managed'
    end
  ),
  assignment_scope = coalesce(assignment_scope, case when home_id is not null then 'home' else 'estate' end),
  commissioning_status = coalesce(commissioning_status, case when home_id is not null then 'assigned' else 'discovered' end),
  updated_at = now()
where ownership_class is null
   or assignment_scope is null
   or commissioning_status is null;

insert into public.device_access_grants(device_id, user_id, home_id, estate_id, grant_type, can_view, can_control, can_manage, source, metadata)
select
  d.id,
  d.owner_user_id,
  d.home_id,
  d.estate_id,
  'owner',
  true,
  true,
  true,
  'ownership_backfill',
  jsonb_build_object('ownership_class', d.ownership_class)
from public.devices d
where d.owner_user_id is not null and d.home_id is not null
on conflict (device_id, user_id, grant_type)
where user_id is not null and expires_at is null
do update set
  can_view = true,
  can_control = true,
  can_manage = true,
  updated_at = now();

insert into public.device_access_grants(device_id, home_id, estate_id, grant_type, can_view, can_control, can_manage, source, metadata)
select
  d.id,
  d.home_id,
  d.estate_id,
  'resident_home',
  true,
  case when coalesce(d.control_policy->>'resident_control_enabled', 'true') <> 'false' then true else false end,
  false,
  'home_assignment_backfill',
  jsonb_build_object('ownership_class', d.ownership_class)
from public.devices d
where d.home_id is not null
  and coalesce(d.ownership_class, '') in ('shared_home','resident_owned')
on conflict (device_id, home_id, grant_type)
where home_id is not null and expires_at is null
do update set
  can_view = true,
  can_control = excluded.can_control,
  updated_at = now();

-- Make presence home-scoped. Keep a global row for clients that do not send context.
alter table public.user_presence add column if not exists id uuid default gen_random_uuid();

do $$
declare
  pk_name text;
begin
  select c.conname
  into pk_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'user_presence'
    and c.contype = 'p'
    and (
      select array_agg(a.attname::text order by u.ord)
      from unnest(c.conkey) with ordinality as u(attnum, ord)
      join pg_attribute a on a.attrelid = t.oid and a.attnum = u.attnum
    ) = array['user_id']::text[];

  if pk_name is not null then
    execute format('alter table public.user_presence drop constraint %I', pk_name);
  end if;
end $$;

update public.user_presence set id = gen_random_uuid() where id is null;
alter table public.user_presence alter column id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'user_presence' and c.contype = 'p'
  ) then
    alter table public.user_presence add constraint user_presence_pkey primary key (id);
  end if;
end $$;

create unique index if not exists user_presence_user_home_unique
  on public.user_presence(user_id, home_id)
  where home_id is not null;

create unique index if not exists user_presence_user_global_unique
  on public.user_presence(user_id)
  where home_id is null;
