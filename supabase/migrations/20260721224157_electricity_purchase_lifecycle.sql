-- Electricity purchase lifecycle closure.
-- This migration is intentionally idempotent because production may have only
-- part of the release-stabilization schema applied.

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
  service_type text not null default 'electricity',
  service_key text not null default 'utility_token',
  provider text,
  amount numeric not null default 0,
  currency text not null default 'NGN',
  status text not null default 'pending',
  transaction_type text not null default 'electricity_purchase',
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
  add column if not exists meter_id text,
  add column if not exists account_ref text,
  add column if not exists wallet_account_id uuid references wallets(id) on delete set null,
  add column if not exists wallet_transaction_id uuid references wallet_transactions(id) on delete set null,
  add column if not exists fee numeric not null default 0,
  add column if not exists tax numeric not null default 0,
  add column if not exists total_deduction numeric not null default 0,
  add column if not exists net_service_amount numeric not null default 0,
  add column if not exists computed_units numeric,
  add column if not exists tariff_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists fulfilment_method text,
  add column if not exists vending_mode text,
  add column if not exists token_reference text,
  add column if not exists meter_credit_reference text,
  add column if not exists receipt_reference text,
  add column if not exists completed_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists safe_failure_message text;

create index if not exists idx_service_transactions_meter on service_transactions(meter_id);
create index if not exists idx_service_transactions_receipt_reference on service_transactions(receipt_reference);
create index if not exists idx_service_transactions_wallet_home on service_transactions(wallet_account_id, home_id, created_at desc);
create unique index if not exists idx_service_transactions_idempotency
  on service_transactions(estate_id, home_id, user_id, idempotency_key)
  where idempotency_key is not null;

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'wallets'
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attnum)
        from unnest(c.conkey) k(attnum)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      ) = array['user_id']::text[]
  loop
    execute format('alter table public.wallets drop constraint if exists %I', r.conname);
  end loop;
end $$;

drop index if exists public.uniq_wallets_user_id;
drop index if exists public.wallets_user_id_key;
drop index if exists public.idx_wallets_user_id_unique;
drop index if exists public.wallets_estate_user_unique;

create unique index if not exists idx_wallets_user_home_unique
  on wallets(user_id, home_id)
  where home_id is not null;

create unique index if not exists idx_wallets_user_global_unique
  on wallets(user_id)
  where home_id is null;

select pg_notify('pgrst', 'reload schema');
