create table if not exists public.room_device_bindings (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null,
  home_id uuid not null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  binding_type text not null check (binding_type in ('light','ac','tv','plug','switch')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (room_id, binding_type)
);

create index if not exists idx_rdb_room on public.room_device_bindings(room_id);
create index if not exists idx_rdb_device on public.room_device_bindings(device_id);
