begin;

create table if not exists ochiga_intelligence_predictions (
  id uuid default gen_random_uuid() primary key
);

alter table if exists ochiga_intelligence_predictions add column if not exists prediction_type text not null default 'operational_recommendation';
alter table if exists ochiga_intelligence_predictions add column if not exists title text not null default 'Intelligence prediction';
alter table if exists ochiga_intelligence_predictions add column if not exists summary text not null default 'Intelligence prediction';
alter table if exists ochiga_intelligence_predictions add column if not exists confidence text not null default 'possible';
alter table if exists ochiga_intelligence_predictions add column if not exists severity text not null default 'info';
alter table if exists ochiga_intelligence_predictions add column if not exists agent_id text not null default 'intelligence_core';
alter table if exists ochiga_intelligence_predictions add column if not exists estate_id uuid references estates(id) on delete set null;
alter table if exists ochiga_intelligence_predictions add column if not exists home_id uuid references homes(id) on delete set null;
alter table if exists ochiga_intelligence_predictions add column if not exists camera_id uuid references facility_cameras(id) on delete set null;
alter table if exists ochiga_intelligence_predictions add column if not exists source_event_ids text[] not null default '{}'::text[];
alter table if exists ochiga_intelligence_predictions add column if not exists evidence jsonb not null default '[]'::jsonb;
alter table if exists ochiga_intelligence_predictions add column if not exists recommended_action text;
alter table if exists ochiga_intelligence_predictions add column if not exists status text not null default 'open';
alter table if exists ochiga_intelligence_predictions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_intelligence_predictions add column if not exists created_at timestamptz not null default now();
alter table if exists ochiga_intelligence_predictions add column if not exists updated_at timestamptz not null default now();
alter table if exists ochiga_intelligence_predictions add column if not exists acknowledged_at timestamptz;
alter table if exists ochiga_intelligence_predictions add column if not exists acknowledged_by uuid references users(id) on delete set null;

create index if not exists idx_ochiga_intelligence_predictions_scope_time on ochiga_intelligence_predictions(estate_id, home_id, created_at desc);
create index if not exists idx_ochiga_intelligence_predictions_type_time on ochiga_intelligence_predictions(prediction_type, created_at desc);
create index if not exists idx_ochiga_intelligence_predictions_status_time on ochiga_intelligence_predictions(status, created_at desc);
create index if not exists idx_ochiga_intelligence_predictions_camera_time on ochiga_intelligence_predictions(camera_id, created_at desc);

alter table if exists ochiga_intelligence_events enable row level security;
alter table if exists ochiga_memory_directory enable row level security;
alter table if exists ochiga_agent_observability enable row level security;
alter table if exists ochiga_intelligence_predictions enable row level security;

commit;
