begin;

create table if not exists public.device_states (
  device_id uuid primary key
    references public.devices(id)
    on delete cascade,

  status jsonb not null default '{}'::jsonb,
  last_seen timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists device_states_last_seen_idx
  on public.device_states(last_seen desc);

create or replace function public.oyi_touch_device_states_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists device_states_touch_updated_at
  on public.device_states;

create trigger device_states_touch_updated_at
before update on public.device_states
for each row
execute function public.oyi_touch_device_states_updated_at();

commit;
