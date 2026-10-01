begin;

-- Intelligence System Visibility, Slice 7 -- durable canonical
-- conversation trace store.
--
-- One row per canonical ConversationOrchestrator.run() invocation,
-- written by exactly one Backend writer
-- (src/oyi-core/observability/conversationTraceRecorder.ts) from the
-- allow-listed projection in conversationTraceProjection.ts. This is
-- OPERATIONAL TELEMETRY, not conversation history: it holds no prompt,
-- reply, message, context, evidence, memory, actor/home/device identity
-- or error text. It is deliberately separate from
-- oyi_conversation_messages (conversation content),
-- ochiga_intelligence_events (cross-surface activity events) and
-- ai_execution_ledger (execution truth).
--
-- Retention: rows carry expires_at = started_at + OYI_TRACE_RETENTION_DAYS
-- (default 30, matching camera "standard" media and resident-context
-- retention). Reads exclude expired rows; the worker-process retention
-- job (src/workers/conversationTraceRetentionWorker.ts) deletes them in
-- bounded batches.
--
-- Access: Backend service role only. Office never queries this table; it
-- reads the projection through Backend's authenticated
-- /office/intelligence/traces export.

create table if not exists public.oyi_conversation_traces (
  trace_id uuid primary key,
  turn_ref text,
  thread_ref text,
  surface text not null,
  worker text not null,
  actor_class text not null,
  domain text,
  operation text,
  mutation_intent boolean,
  target_class text,
  target_resolution_source text,
  resolution_outcome text,
  capability_key text,
  capability_rollout text,
  authority_result text,
  authority_tier smallint,
  authority_denial_reason text,
  evidence_planned boolean not null default false,
  evidence_count integer,
  workflow_restored boolean not null default false,
  workflow_state text,
  execution_state text,
  confirmation_required boolean not null default false,
  terminal_outcome text not null,
  compatibility_label_seen boolean not null default false,
  response_status text not null,
  persistence_saved boolean,
  error_class text,
  lineage jsonb not null default '{}'::jsonb,
  stages jsonb not null default '[]'::jsonb,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  total_latency_ms integer not null,
  expires_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint oyi_conversation_traces_worker_check
    check (worker in ('consumer', 'facility', 'oma', 'osa', 'other')),
  constraint oyi_conversation_traces_actor_class_check
    check (actor_class in ('resident', 'staff', 'admin', 'system', 'anonymous', 'unknown')),
  constraint oyi_conversation_traces_resolution_check
    check (resolution_outcome is null or resolution_outcome in ('matched', 'declared_disabled', 'permission_restricted', 'scope_restricted', 'surface_restricted', 'no_match')),
  constraint oyi_conversation_traces_terminal_check
    check (terminal_outcome in ('capability_response', 'governed_continuation', 'canonical_unsupported', 'capability_no_match', 'business_surface_fallback', 'declared_disabled', 'authority_denied', 'runtime_error')),
  constraint oyi_conversation_traces_authority_check
    check (authority_result is null or authority_result in ('allowed', 'denied')),
  constraint oyi_conversation_traces_response_status_check
    check (response_status in ('returned', 'returned_unsaved', 'failed')),
  constraint oyi_conversation_traces_tier_check
    check (authority_tier is null or authority_tier between 0 and 4),
  constraint oyi_conversation_traces_latency_check
    check (total_latency_ms >= 0),
  constraint oyi_conversation_traces_refs_check
    check ((turn_ref is null or turn_ref ~ '^tu_[0-9a-f]{20}$') and (thread_ref is null or thread_ref ~ '^th_[0-9a-f]{20}$')),
  constraint oyi_conversation_traces_lineage_object_check
    check (jsonb_typeof(lineage) = 'object'),
  constraint oyi_conversation_traces_stages_array_check
    check (jsonb_typeof(stages) = 'array')
);

-- Indexes follow the export's actual filters, each ordered by recency:
--   default list / time range           -> started_at
--   worker filter (Workers page, list)  -> worker, started_at
--   terminal/failure filter (Overview)  -> terminal_outcome, started_at
--   capability filter                   -> capability_key, started_at
--   domain filter                       -> domain, started_at
--   "same conversation" correlation     -> thread_ref, started_at
--   retention job                       -> expires_at
create index if not exists idx_oyi_conversation_traces_started on public.oyi_conversation_traces (started_at desc);
create index if not exists idx_oyi_conversation_traces_worker on public.oyi_conversation_traces (worker, started_at desc);
create index if not exists idx_oyi_conversation_traces_terminal on public.oyi_conversation_traces (terminal_outcome, started_at desc);
create index if not exists idx_oyi_conversation_traces_capability on public.oyi_conversation_traces (capability_key, started_at desc) where capability_key is not null;
create index if not exists idx_oyi_conversation_traces_domain on public.oyi_conversation_traces (domain, started_at desc) where domain is not null;
create index if not exists idx_oyi_conversation_traces_thread on public.oyi_conversation_traces (thread_ref, started_at desc) where thread_ref is not null;
create index if not exists idx_oyi_conversation_traces_expires on public.oyi_conversation_traces (expires_at);

alter table public.oyi_conversation_traces enable row level security;
-- Append-only: service_role gets exactly select/insert (writer, reads)
-- and delete (retention); no update, even via platform default privileges.
revoke all on public.oyi_conversation_traces from public, anon, authenticated, service_role;
grant select, insert, delete on public.oyi_conversation_traces to service_role;

commit;
