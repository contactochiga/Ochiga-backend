-- Repair home-scoped presence upsert compatibility.
-- PostgreSQL cannot use a partial unique index as an ON CONFLICT target unless
-- the statement repeats the predicate, so home presence needs a real unique
-- constraint on (user_id, home_id). Nullable home_id still allows legacy/global
-- rows while home-scoped rows upsert deterministically.

alter table public.user_presence add column if not exists id uuid default gen_random_uuid();
update public.user_presence set id = gen_random_uuid() where id is null;
alter table public.user_presence alter column id set not null;

delete from public.user_presence a
using public.user_presence b
where a.home_id is not null
  and b.home_id is not null
  and a.user_id = b.user_id
  and a.home_id = b.home_id
  and coalesce(a.updated_at, a.last_seen_at, 'epoch'::timestamptz) < coalesce(b.updated_at, b.last_seen_at, 'epoch'::timestamptz);

delete from public.user_presence a
using public.user_presence b
where a.home_id is not null
  and b.home_id is not null
  and a.user_id = b.user_id
  and a.home_id = b.home_id
  and coalesce(a.updated_at, a.last_seen_at, 'epoch'::timestamptz) = coalesce(b.updated_at, b.last_seen_at, 'epoch'::timestamptz)
  and a.id::text < b.id::text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'user_presence'
      and c.conname = 'user_presence_user_home_key'
  ) then
    alter table public.user_presence
      add constraint user_presence_user_home_key unique (user_id, home_id);
  end if;
end $$;
