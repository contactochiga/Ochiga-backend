-- Forward correction only: do not recreate facility_cameras or rewrite applied history.
-- home_id is required by CAMERA_ACCESS_SELECT and the accepted transition RPC.
-- privacy_scope was specified in migrations/2026-06-11-camera-dvr-registry.sql
-- but omitted from the Supabase migration chain. Existing metadata remains intact.
begin;
set local lock_timeout = '5s';
alter table public.facility_cameras
  add column if not exists home_id uuid references public.homes(id) on delete set null,
  add column if not exists privacy_scope text;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public'
    and table_name='facility_cameras' and column_name='home_id' and udt_name='uuid')
    or not exists (select 1 from information_schema.columns where table_schema='public'
    and table_name='facility_cameras' and column_name='privacy_scope' and udt_name='text') then
    raise exception 'camera scope columns have incompatible types; manual review required';
  end if;
end $$;
-- No defaults/backfill: NULL preserves the existing explicit legacy-metadata
-- fallback, rather than reclassifying all historical cameras as facility-visible.
-- Preserve existing policies/functions/triggers. Direct clients must not bypass
-- Backend cameraAccess.policy or gain access to stored camera credentials.
alter table public.facility_cameras enable row level security;
revoke all on table public.facility_cameras from public, anon, authenticated;
grant select, insert, update, delete on table public.facility_cameras to service_role;
commit;
