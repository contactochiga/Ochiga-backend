begin;

create table if not exists ochiga_workflows (id uuid default gen_random_uuid() primary key);
alter table if exists ochiga_workflows add column if not exists workflow_id text not null default ('wf_' || gen_random_uuid()::text);
alter table if exists ochiga_workflows add column if not exists workflow_type text not null default 'operational_recommendation';
alter table if exists ochiga_workflows add column if not exists workflow_status text not null default 'created';
alter table if exists ochiga_workflows add column if not exists workflow_priority text not null default 'medium';
alter table if exists ochiga_workflows add column if not exists workflow_owner text;
alter table if exists ochiga_workflows add column if not exists workflow_assignee text;
alter table if exists ochiga_workflows add column if not exists workflow_due_at timestamptz;
alter table if exists ochiga_workflows add column if not exists workflow_escalation_at timestamptz;
alter table if exists ochiga_workflows add column if not exists workflow_resolution text;
alter table if exists ochiga_workflows add column if not exists origin_agent text not null default 'unknown';
alter table if exists ochiga_workflows add column if not exists responsible_agent text not null default 'ochiga_executive';
alter table if exists ochiga_workflows add column if not exists title text not null default 'Workflow';
alter table if exists ochiga_workflows add column if not exists summary text not null default 'Workflow';
alter table if exists ochiga_workflows add column if not exists recommended_action text;
alter table if exists ochiga_workflows add column if not exists actor_id text;
alter table if exists ochiga_workflows add column if not exists estate_id uuid references estates(id) on delete set null;
alter table if exists ochiga_workflows add column if not exists home_id uuid references homes(id) on delete set null;
alter table if exists ochiga_workflows add column if not exists department_id uuid references ochiga_organization_departments(id) on delete set null;
alter table if exists ochiga_workflows add column if not exists team_id uuid references ochiga_organization_teams(id) on delete set null;
alter table if exists ochiga_workflows add column if not exists source_event_id text;
alter table if exists ochiga_workflows add column if not exists source_prediction_id uuid references ochiga_intelligence_predictions(id) on delete set null;
alter table if exists ochiga_workflows add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_workflows add column if not exists created_at timestamptz not null default now();
alter table if exists ochiga_workflows add column if not exists updated_at timestamptz not null default now();
alter table if exists ochiga_workflows add column if not exists completed_at timestamptz;
alter table if exists ochiga_workflows add column if not exists cancelled_at timestamptz;
alter table if exists ochiga_workflows add column if not exists escalated_at timestamptz;

create unique index if not exists idx_ochiga_workflows_workflow_id on ochiga_workflows(workflow_id);
create index if not exists idx_ochiga_workflows_status_priority on ochiga_workflows(workflow_status, workflow_priority, workflow_due_at);
create index if not exists idx_ochiga_workflows_scope on ochiga_workflows(estate_id, home_id, created_at desc);
create index if not exists idx_ochiga_workflows_agents on ochiga_workflows(origin_agent, responsible_agent, created_at desc);

create table if not exists ochiga_workflow_events (id uuid default gen_random_uuid() primary key);
alter table if exists ochiga_workflow_events add column if not exists workflow_id text not null;
alter table if exists ochiga_workflow_events add column if not exists workflow_record_id uuid references ochiga_workflows(id) on delete cascade;
alter table if exists ochiga_workflow_events add column if not exists event_type text not null default 'workflow_created';
alter table if exists ochiga_workflow_events add column if not exists from_status text;
alter table if exists ochiga_workflow_events add column if not exists to_status text;
alter table if exists ochiga_workflow_events add column if not exists agent_id text;
alter table if exists ochiga_workflow_events add column if not exists actor_id text;
alter table if exists ochiga_workflow_events add column if not exists duration_ms integer;
alter table if exists ochiga_workflow_events add column if not exists success boolean not null default true;
alter table if exists ochiga_workflow_events add column if not exists summary text;
alter table if exists ochiga_workflow_events add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_workflow_events add column if not exists occurred_at timestamptz not null default now();

create index if not exists idx_ochiga_workflow_events_workflow_time on ochiga_workflow_events(workflow_id, occurred_at desc);
create index if not exists idx_ochiga_workflow_events_type_time on ochiga_workflow_events(event_type, occurred_at desc);

create table if not exists ochiga_agent_responsibilities (id uuid default gen_random_uuid() primary key);
alter table if exists ochiga_agent_responsibilities add column if not exists agent_id text not null;
alter table if exists ochiga_agent_responsibilities add column if not exists responsibility text not null;
alter table if exists ochiga_agent_responsibilities add column if not exists allowed_actions text[] not null default '{}'::text[];
alter table if exists ochiga_agent_responsibilities add column if not exists forbidden_actions text[] not null default '{}'::text[];
alter table if exists ochiga_agent_responsibilities add column if not exists status text not null default 'active';
alter table if exists ochiga_agent_responsibilities add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_agent_responsibilities add column if not exists created_at timestamptz not null default now();
alter table if exists ochiga_agent_responsibilities add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_ochiga_agent_responsibilities_agent_resp on ochiga_agent_responsibilities(agent_id, responsibility);

alter table if exists ochiga_agent_observability add column if not exists workflow_id text;
alter table if exists ochiga_agent_observability add column if not exists workflow_record_id uuid references ochiga_workflows(id) on delete set null;
alter table if exists ochiga_agent_observability add column if not exists duration_ms integer;

alter table if exists ochiga_workflows enable row level security;
alter table if exists ochiga_workflow_events enable row level security;
alter table if exists ochiga_agent_responsibilities enable row level security;

commit;
