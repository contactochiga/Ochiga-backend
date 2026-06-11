begin;

create table if not exists ochiga_intelligence_predictions (
  id uuid default gen_random_uuid() primary key,
  prediction_type text not null,
  title text not null,
  summary text not null,
  confidence text not null default 'possible',
  severity text not null default 'info',
  agent_id text not null default 'intelligence_core',
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  camera_id uuid references facility_cameras(id) on delete set null,
  source_event_ids text[] not null default '{}'::text[],
  evidence jsonb not null default '[]'::jsonb,
  recommended_action text,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references users(id) on delete set null,
  constraint ochiga_intelligence_predictions_type_check check (prediction_type in ('device_anomaly', 'camera_anomaly', 'maintenance_risk', 'security_risk', 'visitor_pattern', 'power_or_network_instability', 'edge_runtime_risk', 'operational_recommendation')),
  constraint ochiga_intelligence_predictions_confidence_check check (confidence in ('confirmed', 'likely', 'possible', 'needs_monitoring')),
  constraint ochiga_intelligence_predictions_severity_check check (severity in ('info', 'attention', 'warning', 'critical')),
  constraint ochiga_intelligence_predictions_status_check check (status in ('open', 'acknowledged', 'resolved', 'dismissed'))
);

create index if not exists idx_ochiga_intelligence_predictions_scope_time
  on ochiga_intelligence_predictions(estate_id, home_id, created_at desc);

create index if not exists idx_ochiga_intelligence_predictions_type_time
  on ochiga_intelligence_predictions(prediction_type, created_at desc);

create index if not exists idx_ochiga_intelligence_predictions_status_time
  on ochiga_intelligence_predictions(status, created_at desc);

create index if not exists idx_ochiga_intelligence_predictions_camera_time
  on ochiga_intelligence_predictions(camera_id, created_at desc);

alter table if exists ochiga_intelligence_events enable row level security;
alter table if exists ochiga_memory_directory enable row level security;
alter table if exists ochiga_agent_observability enable row level security;
alter table if exists ochiga_intelligence_predictions enable row level security;

commit;
