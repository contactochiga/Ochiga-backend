begin;

create table if not exists ochiga_agent_observability (
  id uuid default gen_random_uuid() primary key
);

alter table if exists ochiga_agent_observability add column if not exists agent_id text not null default 'unknown';
alter table if exists ochiga_agent_observability add column if not exists action text not null default 'unknown';
alter table if exists ochiga_agent_observability add column if not exists tool text;
alter table if exists ochiga_agent_observability add column if not exists surface text;
alter table if exists ochiga_agent_observability add column if not exists actor_id text;
alter table if exists ochiga_agent_observability add column if not exists estate_id uuid references estates(id) on delete set null;
alter table if exists ochiga_agent_observability add column if not exists home_id uuid references homes(id) on delete set null;
alter table if exists ochiga_agent_observability add column if not exists success boolean not null default true;
alter table if exists ochiga_agent_observability add column if not exists failure_reason text;
alter table if exists ochiga_agent_observability add column if not exists latency_ms integer;
alter table if exists ochiga_agent_observability add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_agent_observability add column if not exists occurred_at timestamptz not null default now();

create index if not exists idx_ochiga_agent_observability_agent_time on ochiga_agent_observability(agent_id, occurred_at desc);
create index if not exists idx_ochiga_agent_observability_scope_time on ochiga_agent_observability(estate_id, home_id, occurred_at desc);
create index if not exists idx_ochiga_agent_observability_success_time on ochiga_agent_observability(success, occurred_at desc);

alter table if exists ochiga_agent_observability enable row level security;

commit;
