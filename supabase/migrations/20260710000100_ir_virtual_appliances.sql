begin;

alter table if exists devices
  add column if not exists parent_device_id uuid references devices(id) on delete set null;

alter table if exists devices
  add column if not exists is_virtual boolean not null default false;

create index if not exists idx_devices_parent_device on devices(parent_device_id);
create index if not exists idx_devices_virtual on devices(is_virtual);

commit;
