begin;

create table if not exists home_service_accounts (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  home_id uuid not null references homes(id) on delete cascade,
  service_key text not null,
  provider text,
  account_ref text,
  meter_id text,
  plan text,
  balance numeric,
  outstanding numeric,
  status text not null default 'active',
  due_date timestamptz,
  expires_at timestamptz,
  linked boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists home_service_accounts
  add column if not exists provider text,
  add column if not exists account_ref text,
  add column if not exists meter_id text,
  add column if not exists plan text,
  add column if not exists balance numeric,
  add column if not exists outstanding numeric,
  add column if not exists status text not null default 'active',
  add column if not exists due_date timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists linked boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists home_service_accounts
  drop constraint if exists home_service_accounts_key_check;

alter table if exists home_service_accounts
  add constraint home_service_accounts_key_check
  check (service_key in (
    'utility_token',
    'water_service',
    'gas_service',
    'internet_service',
    'fiber_internet',
    'generator_recovery',
    'solar_battery_service',
    'service_charge',
    'other_facility_fees'
  ));

create unique index if not exists idx_home_service_accounts_home_service_key_uniq
  on home_service_accounts(home_id, service_key);
create index if not exists idx_home_service_accounts_home on home_service_accounts(home_id);
create index if not exists idx_home_service_accounts_estate on home_service_accounts(estate_id);
create index if not exists idx_home_service_accounts_key on home_service_accounts(service_key);

create table if not exists home_service_assignments (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  home_id uuid references homes(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  service_key text not null,
  enabled boolean not null default true,
  assigned_by uuid references users(id) on delete set null,
  scope text not null default 'home',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists home_service_assignments
  add column if not exists enabled boolean not null default true,
  add column if not exists assigned_by uuid references users(id) on delete set null,
  add column if not exists scope text not null default 'home',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists home_service_assignments
  drop constraint if exists home_service_assignments_key_check;

alter table if exists home_service_assignments
  add constraint home_service_assignments_key_check
  check (service_key in (
    'utility_token',
    'water_service',
    'gas_service',
    'internet_service',
    'fiber_internet',
    'generator_recovery',
    'solar_battery_service',
    'service_charge',
    'other_facility_fees'
  ));

create index if not exists idx_home_service_assignments_home on home_service_assignments(home_id);
create index if not exists idx_home_service_assignments_estate on home_service_assignments(estate_id);
create index if not exists idx_home_service_assignments_user on home_service_assignments(user_id);

with legacy_accounts as (
  select
    h.estate_id,
    h.id as home_id,
    item.service_key,
    nullif(btrim(item.identifier), '') as identifier
  from homes h
  cross join lateral (
    values
      ('utility_token'::text, h.electricity_meter::text),
      ('water_service'::text, h.water_meter::text),
      ('internet_service'::text, h.internet_id::text)
  ) as item(service_key, identifier)
  where nullif(btrim(item.identifier), '') is not null
)
insert into home_service_accounts (
  estate_id,
  home_id,
  service_key,
  account_ref,
  meter_id,
  status,
  linked,
  metadata,
  created_at,
  updated_at
)
select
  legacy_accounts.estate_id,
  legacy_accounts.home_id,
  legacy_accounts.service_key,
  legacy_accounts.identifier,
  case
    when legacy_accounts.service_key in ('utility_token', 'water_service') then legacy_accounts.identifier
    else null
  end,
  'active',
  true,
  jsonb_build_object(
    'provisioned_from', 'legacy_home_identifier_backfill',
    'legacy_home_identifier_backfilled_at', now(),
    'provider_integration_mode',
      case when legacy_accounts.service_key = 'utility_token' then 'authorized_vending_provider' else null end
  ),
  now(),
  now()
from legacy_accounts
on conflict (home_id, service_key) do update set
  estate_id = excluded.estate_id,
  account_ref = coalesce(nullif(home_service_accounts.account_ref, ''), excluded.account_ref),
  meter_id = coalesce(nullif(home_service_accounts.meter_id, ''), excluded.meter_id),
  linked = home_service_accounts.linked or excluded.linked,
  status = case
    when coalesce(home_service_accounts.status, '') in ('', 'setup_needed', 'pending') then 'active'
    else home_service_accounts.status
  end,
  metadata = coalesce(home_service_accounts.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'legacy_home_identifier_backfill_seen_at', now(),
      'legacy_home_identifier_backfill_preserved_existing', true
    ),
  updated_at = now();

with fee_accounts as (
  select h.estate_id, h.id as home_id, item.service_key
  from homes h
  cross join lateral (
    values
      ('service_charge'::text),
      ('other_facility_fees'::text)
  ) as item(service_key)
)
insert into home_service_accounts (
  estate_id,
  home_id,
  service_key,
  account_ref,
  status,
  linked,
  metadata,
  created_at,
  updated_at
)
select
  fee_accounts.estate_id,
  fee_accounts.home_id,
  fee_accounts.service_key,
  fee_accounts.home_id::text,
  'active',
  true,
  jsonb_build_object(
    'provisioned_from', 'home_fee_backfill',
    'home_fee_backfilled_at', now()
  ),
  now(),
  now()
from fee_accounts
on conflict (home_id, service_key) do nothing;

with resident_home_accounts as (
  select
    hsa.estate_id,
    hsa.home_id,
    hsa.service_key,
    coalesce(hm.user_id, h.resident_id) as user_id
  from home_service_accounts hsa
  join homes h on h.id = hsa.home_id
  left join home_memberships hm
    on hm.home_id = hsa.home_id
   and hm.status = 'active'
  where coalesce(hm.user_id, h.resident_id) is not null
)
insert into home_service_assignments (
  estate_id,
  home_id,
  user_id,
  service_key,
  enabled,
  scope,
  metadata,
  created_at,
  updated_at
)
select distinct on (estate_id, home_id, user_id, service_key)
  estate_id,
  home_id,
  user_id,
  service_key,
  true,
  'home',
  jsonb_build_object('provisioned_from', 'service_account_backfill'),
  now(),
  now()
from resident_home_accounts
where not exists (
  select 1
  from home_service_assignments existing
  where existing.home_id = resident_home_accounts.home_id
    and existing.user_id = resident_home_accounts.user_id
    and existing.service_key = resident_home_accounts.service_key
    and existing.scope = 'home'
);

commit;
