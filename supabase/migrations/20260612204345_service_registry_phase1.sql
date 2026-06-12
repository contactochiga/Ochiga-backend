begin;

create table if not exists estate_service_configs (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  service_key text not null,
  title text not null,
  description text not null default '',
  suggested_amount numeric not null default 0,
  currency text not null default 'NGN',
  active boolean not null default true,
  account_label text,
  account_hint text,
  payment_mode text not null default 'wallet_only',
  unit_cost numeric,
  unit_name text,
  billing_mode text not null default 'wallet_only',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estate_service_configs_key_check check (service_key in ('utility_token','water_service','internet_service','fiber_internet','service_charge','other_facility_fees')),
  constraint estate_service_configs_billing_check check (billing_mode in ('wallet_only','metered','fixed')),
  constraint estate_service_configs_payment_check check (payment_mode in ('wallet_only')),
  unique (estate_id, service_key)
);

create index if not exists idx_estate_service_configs_estate on estate_service_configs(estate_id);
create index if not exists idx_estate_service_configs_key on estate_service_configs(service_key);

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
  updated_at timestamptz not null default now(),
  constraint home_service_accounts_key_check check (service_key in ('utility_token','water_service','internet_service','fiber_internet','service_charge','other_facility_fees')),
  unique (home_id, service_key)
);

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
  updated_at timestamptz not null default now(),
  constraint home_service_assignments_scope_check check (scope in ('estate','building','home','resident')),
  constraint home_service_assignments_key_check check (service_key in ('utility_token','water_service','internet_service','fiber_internet','service_charge','other_facility_fees'))
);

create index if not exists idx_home_service_assignments_home on home_service_assignments(home_id);
create index if not exists idx_home_service_assignments_estate on home_service_assignments(estate_id);
create index if not exists idx_home_service_assignments_user on home_service_assignments(user_id);

create table if not exists service_provider_transactions (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  wallet_transaction_id uuid references wallet_transactions(id) on delete set null,
  service_key text not null,
  provider text,
  account_ref text,
  amount numeric not null default 0,
  currency text not null default 'NGN',
  status text not null default 'manual_review',
  provider_reference text,
  fulfilled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_provider_transactions_status_check check (status in ('pending_provider','manual_review','completed','failed','cancelled')),
  constraint service_provider_transactions_key_check check (service_key in ('utility_token','water_service','internet_service','fiber_internet','service_charge','other_facility_fees'))
);

create index if not exists idx_service_provider_transactions_home on service_provider_transactions(home_id, created_at desc);
create index if not exists idx_service_provider_transactions_wallet on service_provider_transactions(wallet_transaction_id);
create index if not exists idx_service_provider_transactions_status on service_provider_transactions(status);

create table if not exists service_registry_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  service_key text,
  user_id uuid references users(id) on delete set null,
  actor_id uuid references users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint service_registry_events_type_check check (event_type in ('service.config.updated','home.service_registry.updated','home.utility_account.updated','wallet.service_payment.updated'))
);

create index if not exists idx_service_registry_events_home on service_registry_events(home_id, created_at desc);
create index if not exists idx_service_registry_events_estate on service_registry_events(estate_id, created_at desc);
create index if not exists idx_service_registry_events_type on service_registry_events(event_type, created_at desc);

alter table if exists wallet_transactions add column if not exists direction text;

commit;
