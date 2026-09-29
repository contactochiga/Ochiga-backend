-- Backend-only wallet mutations. Historical bodies and financial semantics stay intact.
-- service_role already owns the required table privileges; no definer escalation needed.
begin;
alter function public.oyi_credit_wallet(uuid,numeric,text,text,text,text) security invoker;
alter function public.oyi_debit_wallet(uuid,numeric,text,text,text,text) security invoker;
alter function public.oyi_credit_home_wallet(uuid,uuid,numeric,text,text,text,text) security invoker;
alter function public.oyi_debit_home_wallet(uuid,uuid,numeric,text,text,text,text) security invoker;
revoke all on function public.oyi_credit_wallet(uuid,numeric,text,text,text,text), public.oyi_debit_wallet(uuid,numeric,text,text,text,text), public.oyi_credit_home_wallet(uuid,uuid,numeric,text,text,text,text), public.oyi_debit_home_wallet(uuid,uuid,numeric,text,text,text,text) from public,anon,authenticated;
grant execute on function public.oyi_credit_wallet(uuid,numeric,text,text,text,text), public.oyi_debit_wallet(uuid,numeric,text,text,text,text), public.oyi_credit_home_wallet(uuid,uuid,numeric,text,text,text,text), public.oyi_debit_home_wallet(uuid,uuid,numeric,text,text,text,text) to service_role;
commit;
