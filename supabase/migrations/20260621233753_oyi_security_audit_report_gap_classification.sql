begin;

create or replace function public.oyi_security_audit_report()
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with tables as (
    select
      c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      (
        select count(*)
        from pg_policies p
        where p.schemaname = n.nspname and p.tablename = c.relname
      ) as policy_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  ),
  grants as (
    select count(*)::int as count
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
  ),
  unsafe_functions as (
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.prosecdef
        or exists (select 1 from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal)
      )
      and not coalesce(p.proconfig, array[]::text[]) @> array['search_path=pg_catalog, public']
  )
  select jsonb_build_object(
    'generated_at', now(),
    'public_table_count', (select count(*) from tables),
    'tables_without_rls', coalesce((select jsonb_agg(table_name order by table_name) from tables where not rls_enabled), '[]'::jsonb),
    'browser_table_grant_count', (select count from grants),
    'browser_policy_tables', coalesce((select jsonb_agg(table_name order by table_name) from tables where policy_count > 0), '[]'::jsonb),
    'backend_only_tables', coalesce((select jsonb_agg(table_name order by table_name) from tables where policy_count = 0), '[]'::jsonb),
    'unexpected_policy_gaps', case
      when (select count from grants) > 0
        then coalesce((select jsonb_agg(table_name order by table_name) from tables where policy_count = 0), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'unsafe_trigger_or_definer_functions', coalesce((select jsonb_agg(proname order by proname) from unsafe_functions), '[]'::jsonb)
  );
$$;

revoke all on function public.oyi_security_audit_report() from public, anon, authenticated;
grant execute on function public.oyi_security_audit_report() to service_role;

commit;
