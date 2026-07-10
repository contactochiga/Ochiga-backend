begin;

alter table if exists public.devices
  add column if not exists parent_device_id uuid;

alter table if exists public.devices
  add column if not exists is_virtual boolean;

update public.devices
set is_virtual = false
where is_virtual is null;

alter table if exists public.devices
  alter column is_virtual set default false;

alter table if exists public.devices
  alter column is_virtual set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.devices'::regclass
      and conname = 'devices_parent_device_id_fkey'
  ) then
    alter table public.devices
      add constraint devices_parent_device_id_fkey
      foreign key (parent_device_id)
      references public.devices(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_devices_parent_device on public.devices(parent_device_id);
create index if not exists idx_devices_virtual on public.devices(is_virtual);

commit;
