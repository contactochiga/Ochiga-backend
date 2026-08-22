-- Oyi Communication Actions Runtime -- canonical, provider-independent
-- communication records + inbound/status events. Prefixed "oyi_" and
-- named "communication" (singular) deliberately, to stay visually and
-- structurally distinct from the pre-existing, UNRELATED
-- communications_sessions/communications_participants/communications_events
-- tables (live WebRTC session/hand-off durability -- see
-- 20260812000100_communications_sessions_handoffs.sql), which this work
-- does not touch. Service-role access only (supabaseAdmin), same
-- convention as every other table in this project -- no RLS policies.

begin;

create table if not exists public.oyi_communications (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null,
  conversation_thread_id text,
  actor_id text,
  surface text not null,
  source text not null check (source in ('conversation','automation','task','workflow')),
  source_record_type text,
  source_record_id text,

  intent text,
  channel text not null check (channel in ('email','sms','whatsapp','voice_call','internal_message')),
  direction text not null check (direction in ('outbound','inbound')),

  recipient_contact_id text,
  recipient_lead_id text,
  recipient_user_id text,
  recipient_organization_id text,
  recipient_name text,
  recipient_email text,
  recipient_phone text,
  recipient_whatsapp_phone text,
  recipient_resolution_source text not null default 'unresolved',

  subject text,
  body text,
  plain_text text,
  html text,
  template_id text,
  template_variables jsonb,
  attachments jsonb,

  reply_to_message_id uuid references public.oyi_communications(id) on delete set null,
  thread_reference text,

  priority text not null default 'normal' check (priority in ('normal','high')),

  schedule_mode text not null default 'now' check (schedule_mode in ('now','scheduled')),
  scheduled_at timestamptz,
  recurrence jsonb,
  timezone text,

  requires_confirmation boolean not null default true,
  confirmation_id text,
  permission_scope text not null default 'communication.send',
  risk_class text not null default 'consequential_action' check (risk_class in ('low_risk_action','consequential_action')),

  provider text,
  provider_message_id text,
  provider_conversation_id text,

  status text not null default 'draft' check (status in
    ('draft','awaiting_confirmation','confirmed','queued','sending','sent','delivered','read','failed','cancelled','expired')),
  outcome text,
  failure_reason text,
  failure_detail text,

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,

  delivery_metadata jsonb,
  audit_metadata jsonb
);

create index if not exists idx_oyi_communications_source
  on public.oyi_communications(source_record_type, source_record_id, created_at desc);

create index if not exists idx_oyi_communications_thread
  on public.oyi_communications(conversation_thread_id, created_at desc)
  where conversation_thread_id is not null;

create index if not exists idx_oyi_communications_recipient_lead
  on public.oyi_communications(recipient_lead_id, created_at desc)
  where recipient_lead_id is not null;

create index if not exists idx_oyi_communications_status
  on public.oyi_communications(status, created_at desc);

create index if not exists idx_oyi_communications_correlation
  on public.oyi_communications(correlation_id);

create table if not exists public.oyi_communication_events (
  id uuid primary key default gen_random_uuid(),
  communication_id uuid references public.oyi_communications(id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  channel text not null check (channel in ('email','sms','whatsapp','voice_call','internal_message')),
  provider text not null,
  provider_event_id text,
  from_address text,
  event_text text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_oyi_communication_events_comm
  on public.oyi_communication_events(communication_id, occurred_at desc)
  where communication_id is not null;

create index if not exists idx_oyi_communication_events_from
  on public.oyi_communication_events(channel, from_address, occurred_at desc)
  where from_address is not null;

create unique index if not exists uq_oyi_communication_events_provider
  on public.oyi_communication_events(provider, provider_event_id)
  where provider_event_id is not null;

commit;
