begin;

-- Programme 3 (§10/§37): the ONE new table this programme needs. Holds
-- bounded, versioned, observe-first tuning parameters for detectors/
-- providers/ranking (thresholds, sensitivity, ranking weights, confidence
-- calibration). This table has no relationship whatsoever to permissions,
-- RLS, financial authority, confirmation requirements, or safety policy —
-- those remain governed exclusively by their own existing tables/code and
-- are never referenced, read, or writable through this one. Enforcement of
-- that boundary lives in src/oyi-core/domains/intelligence/learningParameters.ts.
create table if not exists public.oyi_learning_parameters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope_estate_id uuid references public.estates(id),
  scope_home_id uuid references public.homes(id),
  version integer not null default 1,
  current_value jsonb not null,
  proposed_value jsonb,
  min_bound jsonb,
  max_bound jsonb,
  rollout_stage text not null default 'observe',
  evaluation_basis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oyi_learning_parameters_rollout_stage_check
    check (rollout_stage in ('observe', 'shadow', 'reviewed', 'enabled'))
);

create unique index if not exists idx_oyi_learning_parameters_identity
  on public.oyi_learning_parameters(name, coalesce(scope_estate_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(scope_home_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_oyi_learning_parameters_scope
  on public.oyi_learning_parameters(scope_estate_id, scope_home_id);

alter table public.oyi_learning_parameters enable row level security;

commit;
