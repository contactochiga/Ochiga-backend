-- Oyi Communication Runtime -- Live Reply Loop programme. Closes three
-- real gaps found on audit of the production inbound WhatsApp path:
--
-- 1. Idempotency was enforced by a read-then-write existence check in
--    application code (a genuine TOCTOU race under concurrent webhook
--    delivery) rather than a real database constraint. A partial unique
--    index makes duplicate-inbound-insert impossible at the DB layer,
--    not just unlikely.
-- 2. There was no governance-enforceable opt-out/STOP mechanism at all --
--    a "recipient_opted_out" failure reason already existed in the
--    CommunicationFailureReason contract but nothing ever produced it.
--    oyi_communication_opt_outs is the single table CommunicationRuntime.
--    plan() checks before ANY send (conversational, automation, or goal-
--    driven) -- the one existing chokepoint every send already passes
--    through, so this is enforcement, not just a label.
-- 3. No rich outcome classification existed beyond the coarse delivery-
--    state "outcome" column (sent/delivered/read/failed) -- these three
--    new columns hold the SEPARATE business-reply classification
--    (interested/not_interested/callback_request/... see
--    contracts/communication.ts's InboundReplyOutcome).

begin;

-- ---------------------------------------------------------------------
-- 1. Atomic inbound idempotency.
-- ---------------------------------------------------------------------
create unique index if not exists uq_oyi_communications_inbound_provider_message
  on public.oyi_communications(provider, provider_message_id, direction)
  where provider_message_id is not null and direction = 'inbound';

-- ---------------------------------------------------------------------
-- 2. Recipient/channel opt-out -- the real governance gate.
-- ---------------------------------------------------------------------
create table if not exists public.oyi_communication_opt_outs (
  id uuid primary key default gen_random_uuid(),
  -- Normalized identity the recipient was reached at (phone in E.164 for
  -- whatsapp/sms/voice_call, lowercased address for email) -- matched
  -- against CommunicationRecipient.phone/whatsapp_phone/email in
  -- CommunicationRuntime.plan(), the SAME field the send itself resolves.
  identity_key text not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'voice_call', 'internal_message', 'all')),
  opted_out_at timestamptz not null default now(),
  reason text,
  source_communication_id uuid references public.oyi_communications(id) on delete set null,
  lead_id text,
  contact_id text,
  unique (identity_key, channel)
);

create index if not exists idx_oyi_communication_opt_outs_identity
  on public.oyi_communication_opt_outs(identity_key);

-- ---------------------------------------------------------------------
-- 3. Rich business-reply outcome classification (separate from the
--    existing coarse delivery-state `outcome` column).
-- ---------------------------------------------------------------------
alter table public.oyi_communications
  add column if not exists outcome_classification text,
  add column if not exists outcome_confidence numeric,
  add column if not exists outcome_evidence text;

create index if not exists idx_oyi_communications_outcome_classification
  on public.oyi_communications(outcome_classification, created_at desc)
  where outcome_classification is not null;

-- ---------------------------------------------------------------------
-- 4b. Reply branches -- lets a classified inbound outcome branch a goal
--     (complete/stop/escalate/create_task) instead of only advancing it
--     linearly.
-- ---------------------------------------------------------------------
alter table public.oyi_goals
  add column if not exists reply_branches jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------
-- 4. "goal" as a first-class source_record_type -- a goal-driven send
--    already set source_record_id to the goal's id but had no type to
--    label it with, leaving it indistinguishable from an untyped send.
-- ---------------------------------------------------------------------
alter table public.oyi_communications
  drop constraint if exists oyi_communications_source_record_type_check;

alter table public.oyi_communications
  add constraint oyi_communications_source_record_type_check
  check (source_record_type is null or source_record_type in (
    'lead', 'contact', 'organization', 'opportunity', 'partnership',
    'task', 'meeting', 'automation', 'workflow', 'support_case', 'goal'
  ));

commit;
