begin;

-- Oyi Intelligence closure: keep public data access API/service-role mediated.
-- Newer runtime tables added after the earlier security closure can inherit
-- broad browser grants from default schema privileges, so re-apply the
-- canonical posture across the public schema.
do $$
declare
  table_record record;
begin
  for table_record in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', table_record.table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_record.table_name);
  end loop;
end;
$$;

alter default privileges in schema public revoke all on tables from anon, authenticated;

alter function public.oyi_credit_home_wallet(uuid, uuid, numeric, text, text, text, text)
  set search_path = pg_catalog, public;
alter function public.oyi_credit_wallet(uuid, numeric, text, text, text, text)
  set search_path = pg_catalog, public;
alter function public.oyi_debit_home_wallet(uuid, uuid, numeric, text, text, text, text)
  set search_path = pg_catalog, public;
alter function public.oyi_debit_wallet(uuid, numeric, text, text, text, text)
  set search_path = pg_catalog, public;
alter function public.oyi_touch_device_states_updated_at()
  set search_path = pg_catalog, public;

commit;
