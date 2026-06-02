alter table public.devices
  add column if not exists bind_state text not null default 'discovered';

update public.devices
set bind_state = case
  when room_id is not null then 'room_bound'
  when home_id is not null then 'home_bound'
  else 'discovered'
end
where bind_state = 'discovered';

create index if not exists devices_estate_home_sync_state_idx
  on public.devices (estate_id, home_id, sync_state);
