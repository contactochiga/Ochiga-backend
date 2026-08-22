-- Oyi Autonomous Work Runtime -- durable goals that orchestrate the
-- EXISTING domain systems (CommunicationRuntime, the Shared Automation
-- Runtime's scheduler tick pattern, recipient resolution, governed
-- action proposals). Not a second CRM/task/automation platform -- a
-- goal's "plan" is a staged sequence of steps, each one dispatched
-- through the systems that already exist.

begin;

create table if not exists public.oyi_goals (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null,
  requesting_actor_id text,
  surface text not null,
  conversation_thread_id text,
  organization_scope text,

  objective text not null,
  -- {lead_id, contact_id, user_id, organization_id, name, email, phone,
  --  whatsapp_phone} -- resolved once at goal creation via the SAME
  -- recipientResolutionService.ts every conversational send already uses.
  target_entities jsonb not null default '{}'::jsonb,

  status text not null default 'understood' check (status in (
    'understood', 'proposed', 'confirmed', 'active', 'observing',
    'action_due', 'executing', 'verifying', 'waiting', 'reevaluating',
    'completed', 'blocked', 'failed', 'cancelled', 'expired', 'needs_human'
  )),

  -- {type: "reply_received"|"task_completed"|"positive_reply"|"manual", ...}
  success_condition jsonb not null default '{}'::jsonb,
  -- {type: "max_attempts_reached"|"deadline_passed"|"negative_reply"|"none", ...}
  stop_condition jsonb not null default '{}'::jsonb,

  -- Ordered staged plan: [{step_index, channel, action_type, body,
  -- wait_hours, condition, status, executed_at, result}]. The decision
  -- loop advances through this one step at a time -- see
  -- goalRuntime.ts's evaluateGoal().
  plan jsonb not null default '[]'::jsonb,
  current_step_index integer not null default 0,

  schedule jsonb not null default '{}'::jsonb,
  event_conditions jsonb not null default '[]'::jsonb,
  -- {allowed_channels: ["email","whatsapp","voice_call"], escalation_policy: {...}}
  communication_preferences jsonb not null default '{}'::jsonb,

  max_attempts integer not null default 5,
  attempts_completed integer not null default 0,

  observations jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,

  linked_crm_records jsonb not null default '{}'::jsonb,
  linked_tasks jsonb not null default '[]'::jsonb,
  linked_meetings jsonb not null default '[]'::jsonb,
  linked_automations jsonb not null default '[]'::jsonb,
  -- array of oyi_communications.thread_reference strings this goal
  -- watches for inbound events -- the event-driven wake path (see
  -- officeExport.ts's webhook-event route) matches against this.
  linked_communication_threads jsonb not null default '[]'::jsonb,

  execution_history jsonb not null default '[]'::jsonb,

  last_evaluated_at timestamptz,
  next_evaluation_at timestamptz,
  completion_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_oyi_goals_due
  on public.oyi_goals(next_evaluation_at)
  where status in ('active','observing','action_due','waiting','reevaluating')
    and next_evaluation_at is not null;

create index if not exists idx_oyi_goals_actor
  on public.oyi_goals(requesting_actor_id, created_at desc);

create index if not exists idx_oyi_goals_status
  on public.oyi_goals(status, created_at desc);

-- GIN index so the event-driven wake path can efficiently find every
-- active goal watching a given thread_reference.
create index if not exists idx_oyi_goals_threads
  on public.oyi_goals using gin (linked_communication_threads);

commit;
