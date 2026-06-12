begin;

create table if not exists ochiga_organization_departments (id uuid default gen_random_uuid() primary key);
alter table if exists ochiga_organization_departments add column if not exists name text;
alter table if exists ochiga_organization_departments add column if not exists description text;
alter table if exists ochiga_organization_departments add column if not exists status text not null default 'active';
alter table if exists ochiga_organization_departments add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_organization_departments add column if not exists created_at timestamptz not null default now();
alter table if exists ochiga_organization_departments add column if not exists updated_at timestamptz not null default now();
create unique index if not exists idx_ochiga_org_departments_name on ochiga_organization_departments(name) where name is not null;

create table if not exists ochiga_organization_teams (id uuid default gen_random_uuid() primary key);
alter table if exists ochiga_organization_teams add column if not exists department_id uuid references ochiga_organization_departments(id) on delete set null;
alter table if exists ochiga_organization_teams add column if not exists name text;
alter table if exists ochiga_organization_teams add column if not exists description text;
alter table if exists ochiga_organization_teams add column if not exists status text not null default 'active';
alter table if exists ochiga_organization_teams add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_organization_teams add column if not exists created_at timestamptz not null default now();
alter table if exists ochiga_organization_teams add column if not exists updated_at timestamptz not null default now();
create unique index if not exists idx_ochiga_org_teams_department_name on ochiga_organization_teams(department_id, name) where name is not null;

create table if not exists ochiga_organization_roles (id uuid default gen_random_uuid() primary key);
alter table if exists ochiga_organization_roles add column if not exists department_id uuid references ochiga_organization_departments(id) on delete set null;
alter table if exists ochiga_organization_roles add column if not exists team_id uuid references ochiga_organization_teams(id) on delete set null;
alter table if exists ochiga_organization_roles add column if not exists name text;
alter table if exists ochiga_organization_roles add column if not exists description text;
alter table if exists ochiga_organization_roles add column if not exists authority_level text not null default 'member';
alter table if exists ochiga_organization_roles add column if not exists status text not null default 'active';
alter table if exists ochiga_organization_roles add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_organization_roles add column if not exists created_at timestamptz not null default now();
alter table if exists ochiga_organization_roles add column if not exists updated_at timestamptz not null default now();

create table if not exists ochiga_organization_employees (id uuid default gen_random_uuid() primary key);
alter table if exists ochiga_organization_employees add column if not exists user_id uuid references users(id) on delete set null;
alter table if exists ochiga_organization_employees add column if not exists department_id uuid references ochiga_organization_departments(id) on delete set null;
alter table if exists ochiga_organization_employees add column if not exists team_id uuid references ochiga_organization_teams(id) on delete set null;
alter table if exists ochiga_organization_employees add column if not exists role_id uuid references ochiga_organization_roles(id) on delete set null;
alter table if exists ochiga_organization_employees add column if not exists display_name text;
alter table if exists ochiga_organization_employees add column if not exists email text;
alter table if exists ochiga_organization_employees add column if not exists status text not null default 'active';
alter table if exists ochiga_organization_employees add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_organization_employees add column if not exists created_at timestamptz not null default now();
alter table if exists ochiga_organization_employees add column if not exists updated_at timestamptz not null default now();

create table if not exists ochiga_organization_responsibilities (id uuid default gen_random_uuid() primary key);
alter table if exists ochiga_organization_responsibilities add column if not exists department_id uuid references ochiga_organization_departments(id) on delete set null;
alter table if exists ochiga_organization_responsibilities add column if not exists team_id uuid references ochiga_organization_teams(id) on delete set null;
alter table if exists ochiga_organization_responsibilities add column if not exists role_id uuid references ochiga_organization_roles(id) on delete set null;
alter table if exists ochiga_organization_responsibilities add column if not exists name text;
alter table if exists ochiga_organization_responsibilities add column if not exists description text;
alter table if exists ochiga_organization_responsibilities add column if not exists category text;
alter table if exists ochiga_organization_responsibilities add column if not exists status text not null default 'active';
alter table if exists ochiga_organization_responsibilities add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_organization_responsibilities add column if not exists created_at timestamptz not null default now();
alter table if exists ochiga_organization_responsibilities add column if not exists updated_at timestamptz not null default now();

create table if not exists ochiga_organization_assignments (id uuid default gen_random_uuid() primary key);
alter table if exists ochiga_organization_assignments add column if not exists employee_id uuid references ochiga_organization_employees(id) on delete cascade;
alter table if exists ochiga_organization_assignments add column if not exists responsibility_id uuid references ochiga_organization_responsibilities(id) on delete cascade;
alter table if exists ochiga_organization_assignments add column if not exists assigned_by uuid references users(id) on delete set null;
alter table if exists ochiga_organization_assignments add column if not exists status text not null default 'active';
alter table if exists ochiga_organization_assignments add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_organization_assignments add column if not exists created_at timestamptz not null default now();
alter table if exists ochiga_organization_assignments add column if not exists updated_at timestamptz not null default now();

create table if not exists ochiga_agent_collaborations (id uuid default gen_random_uuid() primary key);
alter table if exists ochiga_agent_collaborations add column if not exists workflow_id text not null default 'collaboration';
alter table if exists ochiga_agent_collaborations add column if not exists from_agent text not null default 'unknown';
alter table if exists ochiga_agent_collaborations add column if not exists to_agent text not null default 'unknown';
alter table if exists ochiga_agent_collaborations add column if not exists event_type text not null default 'collaboration.event';
alter table if exists ochiga_agent_collaborations add column if not exists title text not null default 'Agent collaboration';
alter table if exists ochiga_agent_collaborations add column if not exists summary text not null default 'Agent collaboration';
alter table if exists ochiga_agent_collaborations add column if not exists status text not null default 'recorded';
alter table if exists ochiga_agent_collaborations add column if not exists actor_id text;
alter table if exists ochiga_agent_collaborations add column if not exists estate_id uuid references estates(id) on delete set null;
alter table if exists ochiga_agent_collaborations add column if not exists home_id uuid references homes(id) on delete set null;
alter table if exists ochiga_agent_collaborations add column if not exists department_id uuid references ochiga_organization_departments(id) on delete set null;
alter table if exists ochiga_agent_collaborations add column if not exists team_id uuid references ochiga_organization_teams(id) on delete set null;
alter table if exists ochiga_agent_collaborations add column if not exists source_event_id text;
alter table if exists ochiga_agent_collaborations add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_agent_collaborations add column if not exists occurred_at timestamptz not null default now();
alter table if exists ochiga_agent_collaborations add column if not exists created_at timestamptz not null default now();

alter table if exists ochiga_agent_observability add column if not exists department_id uuid references ochiga_organization_departments(id) on delete set null;
alter table if exists ochiga_agent_observability add column if not exists team_id uuid references ochiga_organization_teams(id) on delete set null;
alter table if exists ochiga_agent_observability add column if not exists role_id uuid references ochiga_organization_roles(id) on delete set null;
alter table if exists ochiga_agent_observability add column if not exists employee_id uuid references ochiga_organization_employees(id) on delete set null;

create index if not exists idx_ochiga_org_teams_department on ochiga_organization_teams(department_id);
create index if not exists idx_ochiga_org_employees_department on ochiga_organization_employees(department_id);
create index if not exists idx_ochiga_org_employees_team on ochiga_organization_employees(team_id);
create index if not exists idx_ochiga_org_assignments_employee on ochiga_organization_assignments(employee_id);
create index if not exists idx_ochiga_agent_collaborations_time on ochiga_agent_collaborations(occurred_at desc);
create index if not exists idx_ochiga_agent_collaborations_agents on ochiga_agent_collaborations(from_agent, to_agent, occurred_at desc);
create index if not exists idx_ochiga_agent_collaborations_scope on ochiga_agent_collaborations(estate_id, home_id, occurred_at desc);

alter table if exists ochiga_organization_departments enable row level security;
alter table if exists ochiga_organization_teams enable row level security;
alter table if exists ochiga_organization_roles enable row level security;
alter table if exists ochiga_organization_employees enable row level security;
alter table if exists ochiga_organization_responsibilities enable row level security;
alter table if exists ochiga_organization_assignments enable row level security;
alter table if exists ochiga_agent_collaborations enable row level security;

commit;
