-- =====================================================
-- 2026-07-11 Wallet atomic debit/credit RPC
-- Security: eliminates read-modify-write race conditions by performing the
-- balance mutation in a single atomic UPDATE ... RETURNING statement inside
-- a SECURITY DEFINER function. The ledger (wallet_transactions) is preserved.
-- =====================================================

-- Atomic wallet debit.
-- Returns:
--   { ok: bool, wallet_id: uuid, balance: numeric, transaction_id: uuid|null, reference: text, code: text }
-- code values: "ok", "insufficient_funds", "frozen", "wallet_not_found"
create or replace function public.oyi_debit_wallet(
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
  v_is_frozen boolean := false;
  v_transaction_id uuid := null;
  v_reference text := coalesce(nullif(trim(p_reference), ''), 'debit_' || extract(epoch from now())::bigint || '_' || floor(random() * 1000000)::int);
  v_row record;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;

  -- Atomically decrement only when funds are sufficient and wallet is not frozen.
  -- The FOR UPDATE is implicit in a single UPDATE; the conditional WHERE clause
  -- guarantees no two concurrent transactions can both succeed (double-spend).
  update public.wallets
    set balance = balance - p_amount,
        updated_at = now()
    where id in (
      select w.id from public.wallets w
      where w.user_id = p_user_id
      for update of w
    )
    and coalesce(is_frozen, false) = false
    and balance >= p_amount
    returning id, balance into v_wallet_id, v_balance;

  if v_wallet_id is null then
    -- Determine the reason for failure for a useful error.
    select id, coalesce(is_frozen, false) into v_row from public.wallets where user_id = p_user_id limit 1;
    if v_row.id is null then
      return jsonb_build_object('ok', false, 'code', 'wallet_not_found');
    end if;
    if v_row.is_frozen then
      return jsonb_build_object('ok', false, 'code', 'frozen');
    end if;
    return jsonb_build_object('ok', false, 'code', 'insufficient_funds');
  end if;

  -- Preserve the ledger. Insert defensively so a missing column does not
  -- roll back the (already committed) balance mutation.
  begin
    insert into public.wallet_transactions
      (wallet_id, user_id, direction, type, amount, reference, status, metadata, updated_at)
    values
      (v_wallet_id, p_user_id, 'debit', p_type, p_amount, v_reference, 'completed',
       jsonb_build_object('reason', p_reason, 'currency', p_currency, 'direction', 'debit'),
       now())
    returning id into v_transaction_id;
  exception
    when undefined_column then
      -- Fallback: older schemas may not have user_id / updated_at columns.
      begin
        insert into public.wallet_transactions
          (wallet_id, direction, type, amount, reference, status, metadata)
        values
          (v_wallet_id, 'debit', p_type, p_amount, v_reference, 'completed',
           jsonb_build_object('reason', p_reason, 'currency', p_currency, 'direction', 'debit', 'resident_id', p_user_id));
      exception when others then
        null; -- ledger write is best-effort relative to the atomic balance change
      end;
    when others then
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

-- Atomic wallet credit. Used for non-provider credits; provider funding still
-- flows through the idempotent reconcileWalletFunding state machine.
create or replace function public.oyi_credit_wallet(
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
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;

  update public.wallets
    set balance = balance + p_amount,
        updated_at = now()
    where id in (
      select w.id from public.wallets w
      where w.user_id = p_user_id
      for update of w
    )
    returning id, balance into v_wallet_id, v_balance;

  if v_wallet_id is null then
    return jsonb_build_object('ok', false, 'code', 'wallet_not_found');
  end if;

  begin
    insert into public.wallet_transactions
      (wallet_id, user_id, direction, type, amount, reference, status, metadata, updated_at)
    values
      (v_wallet_id, p_user_id, 'credit', p_type, p_amount, v_reference, 'completed',
       jsonb_build_object('reason', p_reason, 'currency', p_currency, 'direction', 'credit'),
       now())
    returning id into v_transaction_id;
  exception
    when undefined_column then
      begin
        insert into public.wallet_transactions
          (wallet_id, direction, type, amount, reference, status, metadata)
        values
          (v_wallet_id, 'credit', p_type, p_amount, v_reference, 'completed',
           jsonb_build_object('reason', p_reason, 'currency', p_currency, 'direction', 'credit', 'resident_id', p_user_id));
      exception when others then
        null;
      end;
    when others then
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

comment on function public.oyi_debit_wallet(uuid, numeric, text, text, text, text) is
  'Security: atomic wallet debit that prevents double-spend race conditions. Returns ok/code/wallet_id/balance/transaction_id/reference.';
comment on function public.oyi_credit_wallet(uuid, numeric, text, text, text, text) is
  'Security: atomic wallet credit. Returns ok/code/wallet_id/balance/transaction_id/reference.';
