create table if not exists public.oyi_language_phrase_memory (
  id uuid primary key default gen_random_uuid(),
  phrase text not null,
  phrase_key text not null unique,
  normalized_phrase text not null,
  domain text not null,
  intent text not null,
  confidence numeric not null default 0,
  usage_count integer not null default 0,
  success_count integer not null default 0,
  status text not null default 'candidate' check (status in ('candidate', 'approved', 'rejected')),
  provider text not null default 'local',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_oyi_language_phrase_memory_status on public.oyi_language_phrase_memory(status);
create index if not exists idx_oyi_language_phrase_memory_domain_intent on public.oyi_language_phrase_memory(domain, intent);

create table if not exists public.oyi_language_teacher_observations (
  id uuid primary key default gen_random_uuid(),
  phrase text not null,
  normalized_phrase text,
  domain text,
  intent text,
  confidence numeric,
  provider text,
  event_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_oyi_language_teacher_observations_created on public.oyi_language_teacher_observations(created_at desc);
create index if not exists idx_oyi_language_teacher_observations_event_type on public.oyi_language_teacher_observations(event_type);

alter table public.oyi_language_phrase_memory enable row level security;
alter table public.oyi_language_teacher_observations enable row level security;

grant select, insert, update, delete on public.oyi_language_phrase_memory to service_role;
grant select, insert, update, delete on public.oyi_language_teacher_observations to service_role;
