begin;

create table if not exists ochiga_agent_observability (
  id uuid default gen_random_uuid() primary key,
  agent_id text not null,
  action text not null,
  tool text,
  surface text,
  actor_id text,
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  success boolean not null default true,
  failure_reason text,
  latency_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_ochiga_agent_observability_agent_time
  on ochiga_agent_observability(agent_id, occurred_at desc);

create index if not exists idx_ochiga_agent_observability_scope_time
  on ochiga_agent_observability(estate_id, home_id, occurred_at desc);

create index if not exists idx_ochiga_agent_observability_success_time
  on ochiga_agent_observability(success, occurred_at desc);

commit;
