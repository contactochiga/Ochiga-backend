-- Release repair: ensure Infrastructure Services transactions exist in environments
-- where the release-stabilization migration was already recorded before these
-- service transaction columns/table repairs were added locally.

alter table if exists estate_service_configs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists service_transactions (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  building_id uuid null,
  membership_id uuid references home_memberships(id) on delete set null,
  resident_id uuid references users(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  wallet_account_id uuid references wallets(id) on delete set null,
  wallet_transaction_id uuid references wallet_transactions(id) on delete set null,
  service_account_id uuid references home_service_accounts(id) on delete set null,
  service_type text not null default 'facility_services',
  service_key text not null default 'other_facility_fees',
  provider text,
  amount numeric not null default 0,
  currency text not null default 'NGN',
  status text not null default 'pending',
  transaction_type text not null default 'facility_service',
  fulfilment_type text not null default 'pending_provider',
  settlement_status text not null default 'none',
  provider_reference text,
  idempotency_key text,
  receipt jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists service_transactions
  add column if not exists estate_id uuid references estates(id) on delete set null,
  add column if not exists home_id uuid references homes(id) on delete set null,
  add column if not exists building_id uuid null,
  add column if not exists membership_id uuid references home_memberships(id) on delete set null,
  add column if not exists resident_id uuid references users(id) on delete set null,
  add column if not exists user_id uuid references users(id) on delete set null,
  add column if not exists wallet_account_id uuid references wallets(id) on delete set null,
  add column if not exists wallet_transaction_id uuid references wallet_transactions(id) on delete set null,
  add column if not exists service_account_id uuid references home_service_accounts(id) on delete set null,
  add column if not exists service_type text,
  add column if not exists service_key text,
  add column if not exists provider text,
  add column if not exists amount numeric not null default 0,
  add column if not exists currency text not null default 'NGN',
  add column if not exists status text not null default 'pending',
  add column if not exists transaction_type text,
  add column if not exists fulfilment_type text not null default 'pending_provider',
  add column if not exists settlement_status text not null default 'none',
  add column if not exists provider_reference text,
  add column if not exists idempotency_key text,
  add column if not exists receipt jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update service_transactions
set
  service_type = coalesce(service_type, 'facility_services'),
  service_key = coalesce(service_key, 'other_facility_fees'),
  transaction_type = coalesce(transaction_type, 'facility_service'),
  fulfilment_type = coalesce(fulfilment_type, 'pending_provider'),
  settlement_status = coalesce(settlement_status, 'none'),
  receipt = coalesce(receipt, '{}'::jsonb),
  metadata = coalesce(metadata, '{}'::jsonb),
  updated_at = coalesce(updated_at, now()),
  created_at = coalesce(created_at, now())
where service_type is null
   or service_key is null
   or transaction_type is null
   or fulfilment_type is null
   or settlement_status is null
   or receipt is null
   or metadata is null
   or updated_at is null
   or created_at is null;

alter table if exists service_transactions
  alter column service_type set not null,
  alter column service_key set not null,
  alter column transaction_type set not null,
  alter column fulfilment_type set not null,
  alter column settlement_status set not null,
  alter column receipt set not null,
  alter column metadata set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create index if not exists idx_service_transactions_estate on service_transactions(estate_id, created_at desc);
create index if not exists idx_service_transactions_home on service_transactions(home_id, created_at desc);
create index if not exists idx_service_transactions_membership on service_transactions(membership_id, created_at desc);
create index if not exists idx_service_transactions_user on service_transactions(user_id, created_at desc);
create index if not exists idx_service_transactions_account on service_transactions(service_account_id, created_at desc);
create index if not exists idx_service_transactions_wallet_account on service_transactions(wallet_account_id, created_at desc);
create index if not exists idx_service_transactions_key on service_transactions(service_key, created_at desc);
create unique index if not exists idx_service_transactions_idempotency
  on service_transactions(estate_id, home_id, user_id, idempotency_key)
  where idempotency_key is not null;

select pg_notify('pgrst', 'reload schema');
