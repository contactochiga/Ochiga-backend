begin;

-- Release stabilization: canonical home-scoped resident wallets and scoped
-- operational messages. This migration is intentionally idempotent because
-- some production databases already contain portions of the service runtime.

alter table if exists wallets
  add column if not exists estate_id uuid references estates(id) on delete set null,
  add column if not exists home_id uuid references homes(id) on delete set null,
  add column if not exists membership_id uuid references home_memberships(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists wallet_transactions
  add column if not exists wallet_account_id uuid references wallets(id) on delete set null,
  add column if not exists estate_id uuid references estates(id) on delete set null,
  add column if not exists home_id uuid references homes(id) on delete set null,
  add column if not exists membership_id uuid references home_memberships(id) on delete set null,
  add column if not exists service_account_id uuid references home_service_accounts(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update wallet_transactions
set wallet_account_id = wallet_id
where wallet_account_id is null
  and wallet_id is not null;

update wallets w
set
  estate_id = coalesce(w.estate_id, u.estate_id),
  home_id = coalesce(w.home_id, u.home_id),
  metadata = coalesce(w.metadata, '{}'::jsonb) || jsonb_build_object(
    'scope_repaired_from', 'legacy_user_wallet',
    'scope_repaired_at', now()
  )
from users u
where w.user_id = u.id
  and w.home_id is null
  and u.home_id is not null;

update wallets w
set membership_id = hm.id
from home_memberships hm
where w.membership_id is null
  and w.user_id = hm.user_id
  and w.home_id = hm.home_id
  and hm.status = 'active';

update wallet_transactions wt
set
  estate_id = coalesce(wt.estate_id, w.estate_id),
  home_id = coalesce(wt.home_id, w.home_id),
  membership_id = coalesce(wt.membership_id, w.membership_id)
from wallets w
where wt.wallet_id = w.id;

do $$
declare
  c record;
  i record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'wallets'::regclass
      and contype = 'u'
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'wallets'::regclass and attname = 'user_id')
      ]::smallint[]
  loop
    execute format('alter table wallets drop constraint if exists %I', c.conname);
  end loop;

  for i in
    select ci.relname
    from pg_index ix
    join pg_class ci on ci.oid = ix.indexrelid
    where ix.indrelid = 'wallets'::regclass
      and ix.indisunique
      and ix.indkey::int2[] = array[
        (select attnum from pg_attribute where attrelid = 'wallets'::regclass and attname = 'user_id')
      ]::smallint[]
  loop
    execute format('drop index if exists %I', i.relname);
  end loop;
end $$;

create unique index if not exists idx_wallets_user_home_unique
  on wallets(user_id, home_id)
  where home_id is not null;

create unique index if not exists idx_wallets_user_global_unique
  on wallets(user_id)
  where home_id is null;

create index if not exists idx_wallets_home_user on wallets(home_id, user_id);
create index if not exists idx_wallets_estate_home on wallets(estate_id, home_id);
create index if not exists idx_wallet_transactions_wallet_account on wallet_transactions(wallet_account_id, created_at desc);
create index if not exists idx_wallet_transactions_home_time on wallet_transactions(home_id, created_at desc);
create index if not exists idx_wallet_transactions_service_account on wallet_transactions(service_account_id, created_at desc);

insert into wallets (user_id, estate_id, home_id, membership_id, balance, currency, metadata, updated_at)
select
  hm.user_id,
  h.estate_id,
  hm.home_id,
  hm.id,
  0,
  'NGN',
  jsonb_build_object('scope', 'home', 'created_by', 'multi_home_wallet_backfill'),
  now()
from home_memberships hm
join homes h on h.id = hm.home_id
where hm.status = 'active'
  and not exists (
    select 1
    from wallets w
    where w.user_id = hm.user_id
      and w.home_id = hm.home_id
  )
on conflict do nothing;

alter table if exists estate_service_configs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists service_transactions (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid references estates(id) on delete set null,
  building_id uuid null,
  home_id uuid references homes(id) on delete set null,
  membership_id uuid references home_memberships(id) on delete set null,
  resident_id uuid references users(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  wallet_account_id uuid references wallets(id) on delete set null,
  wallet_transaction_id uuid references wallet_transactions(id) on delete set null,
  service_account_id uuid references home_service_accounts(id) on delete set null,
  service_type text not null,
  service_key text not null,
  provider text,
  amount numeric not null default 0,
  currency text not null default 'NGN',
  status text not null default 'pending',
  transaction_type text not null,
  fulfilment_type text not null default 'pending_provider',
  settlement_status text not null default 'none',
  provider_reference text,
  receipt jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists service_transactions
  add column if not exists building_id uuid null,
  add column if not exists membership_id uuid references home_memberships(id) on delete set null,
  add column if not exists wallet_account_id uuid references wallets(id) on delete set null,
  add column if not exists wallet_transaction_id uuid references wallet_transactions(id) on delete set null,
  add column if not exists fulfilment_type text not null default 'pending_provider',
  add column if not exists receipt jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_service_transactions_estate on service_transactions(estate_id, created_at desc);
create index if not exists idx_service_transactions_home on service_transactions(home_id, created_at desc);
create index if not exists idx_service_transactions_membership on service_transactions(membership_id, created_at desc);
create index if not exists idx_service_transactions_user on service_transactions(user_id, created_at desc);
create index if not exists idx_service_transactions_account on service_transactions(service_account_id, created_at desc);
create index if not exists idx_service_transactions_wallet_account on service_transactions(wallet_account_id, created_at desc);
create index if not exists idx_service_transactions_key on service_transactions(service_key, created_at desc);

alter table if exists service_provider_transactions
  add column if not exists membership_id uuid references home_memberships(id) on delete set null,
  add column if not exists service_account_id uuid references home_service_accounts(id) on delete set null,
  add column if not exists fulfilment_type text not null default 'pending_provider';

alter table if exists dm_threads
  add column if not exists home_id uuid references homes(id) on delete set null,
  add column if not exists scope text not null default 'home',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists dm_thread_members
  add column if not exists home_id uuid references homes(id) on delete set null;

alter table if exists dm_messages
  add column if not exists home_id uuid references homes(id) on delete set null;

alter table if exists dm_reports
  add column if not exists home_id uuid references homes(id) on delete set null;

alter table if exists dm_moderation_logs
  add column if not exists home_id uuid references homes(id) on delete set null;

update dm_threads t
set home_id = u.home_id
from users u
where t.home_id is null
  and t.created_by = u.id
  and u.home_id is not null;

update dm_thread_members m
set home_id = t.home_id
from dm_threads t
where m.thread_id = t.id
  and m.home_id is null
  and t.home_id is not null;

update dm_messages msg
set home_id = t.home_id
from dm_threads t
where msg.thread_id = t.id
  and msg.home_id is null
  and t.home_id is not null;

do $$
declare
  i record;
begin
  for i in
    select ci.relname
    from pg_index ix
    join pg_class ci on ci.oid = ix.indexrelid
    where ix.indrelid = 'dm_threads'::regclass
      and ix.indisunique
      and ci.relname = 'ux_dm_threads_direct_pair'
  loop
    execute format('drop index if exists %I', i.relname);
  end loop;
end $$;

create unique index if not exists ux_dm_threads_direct_pair_home
  on dm_threads(estate_id, home_id, kind, user_a_id, user_b_id)
  where kind = 'direct' and home_id is not null;

create unique index if not exists ux_dm_threads_direct_pair_global
  on dm_threads(estate_id, kind, user_a_id, user_b_id)
  where kind = 'direct' and home_id is null;

create index if not exists idx_dm_threads_home_last_message
  on dm_threads(home_id, last_message_at desc nulls last);

create index if not exists idx_dm_thread_members_home_user_active
  on dm_thread_members(home_id, user_id, is_active);

create index if not exists idx_dm_messages_home_created
  on dm_messages(home_id, created_at desc);

create or replace function public.oyi_credit_home_wallet(
  p_wallet_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_reason text default 'manual_credit',
  p_currency text default 'NGN',
  p_reference text default null,
  p_type text default 'credit'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_balance numeric;
  v_transaction_id uuid := null;
  v_reference text := coalesce(nullif(trim(p_reference), ''), 'credit_' || extract(epoch from now())::bigint || '_' || floor(random() * 1000000)::int);
  v_wallet record;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;

  update public.wallets
    set balance = balance + p_amount,
        updated_at = now()
    where id = p_wallet_id
      and user_id = p_user_id
    returning id, balance, estate_id, home_id, membership_id into v_wallet;

  v_wallet_id := v_wallet.id;
  v_balance := v_wallet.balance;

  if v_wallet_id is null then
    return jsonb_build_object('ok', false, 'code', 'wallet_not_found');
  end if;

  begin
    insert into public.wallet_transactions
      (wallet_id, wallet_account_id, user_id, estate_id, home_id, membership_id, direction, type, amount, reference, status, metadata, updated_at)
    values
      (v_wallet_id, v_wallet_id, p_user_id, v_wallet.estate_id, v_wallet.home_id, v_wallet.membership_id,
       'credit', p_type, p_amount, v_reference, 'completed',
       jsonb_build_object('reason', p_reason, 'currency', p_currency, 'direction', 'credit'),
       now())
    returning id into v_transaction_id;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'wallet_id', v_wallet_id,
    'balance', v_balance,
    'transaction_id', v_transaction_id,
    'reference', v_reference
  );
end;
$$;

create or replace function public.oyi_debit_home_wallet(
  p_wallet_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_reason text default 'manual_debit',
  p_currency text default 'NGN',
  p_reference text default null,
  p_type text default 'service_charge'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_balance numeric;
  v_transaction_id uuid := null;
  v_reference text := coalesce(nullif(trim(p_reference), ''), 'debit_' || extract(epoch from now())::bigint || '_' || floor(random() * 1000000)::int);
  v_wallet record;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;

  update public.wallets
    set balance = balance - p_amount,
        updated_at = now()
    where id = p_wallet_id
      and user_id = p_user_id
      and coalesce(is_frozen, false) = false
      and balance >= p_amount
    returning id, balance, estate_id, home_id, membership_id into v_wallet;

  v_wallet_id := v_wallet.id;
  v_balance := v_wallet.balance;

  if v_wallet_id is null then
    select id, coalesce(is_frozen, false) as is_frozen into v_wallet
    from public.wallets
    where id = p_wallet_id and user_id = p_user_id
    limit 1;
    if v_wallet.id is null then
      return jsonb_build_object('ok', false, 'code', 'wallet_not_found');
    end if;
    if v_wallet.is_frozen then
      return jsonb_build_object('ok', false, 'code', 'frozen');
    end if;
    return jsonb_build_object('ok', false, 'code', 'insufficient_funds');
  end if;

  begin
    insert into public.wallet_transactions
      (wallet_id, wallet_account_id, user_id, estate_id, home_id, membership_id, direction, type, amount, reference, status, metadata, updated_at)
    values
      (v_wallet_id, v_wallet_id, p_user_id, v_wallet.estate_id, v_wallet.home_id, v_wallet.membership_id,
       'debit', p_type, p_amount, v_reference, 'completed',
       jsonb_build_object('reason', p_reason, 'currency', p_currency, 'direction', 'debit'),
       now())
    returning id into v_transaction_id;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'wallet_id', v_wallet_id,
    'balance', v_balance,
    'transaction_id', v_transaction_id,
    'reference', v_reference
  );
end;
$$;

commit;
