create table if not exists public.consumer_scenes (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid references public.estates(id) on delete cascade,
  home_id uuid references public.homes(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  name text not null,
  icon text not null default 'sparkles',
  mood text,
  actions jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.consumer_automations (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid references public.estates(id) on delete cascade,
  home_id uuid references public.homes(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  name text not null,
  trigger jsonb not null,
  condition jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consumer_scenes_scope_idx on public.consumer_scenes (estate_id, home_id, created_at desc);
create index if not exists consumer_automations_scope_idx on public.consumer_automations (estate_id, home_id, created_at desc);

alter table public.consumer_scenes enable row level security;
alter table public.consumer_automations enable row level security;

revoke all on public.consumer_scenes from anon, authenticated;
revoke all on public.consumer_automations from anon, authenticated;

comment on table public.consumer_scenes is 'Resident-scoped multi-device presets. Accessed through authenticated backend routes.';
comment on table public.consumer_automations is 'Resident-scoped automation definitions. Execution remains safety-gated by backend workers.';
