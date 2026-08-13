-- Oyi Phase C runtime correction:
-- conversation workflows/actions are prepared before canonical conversation
-- turn persistence finalizes the thread row. Keep thread_id as a trace/
-- restoration reference, but do not require the conversation thread row to
-- exist before action preparation can reach awaiting_confirmation.

alter table if exists public.oyi_conversation_workflows
  drop constraint if exists oyi_conversation_workflows_thread_id_fkey;

alter table if exists public.oyi_actions
  drop constraint if exists oyi_actions_thread_id_fkey;

comment on column public.oyi_conversation_workflows.thread_id is
  'Canonical conversation thread reference. Not FK-constrained because workflow preparation may happen before the turn persistence owner upserts the thread row.';

comment on column public.oyi_actions.thread_id is
  'Canonical conversation thread reference. Not FK-constrained because action preparation may happen before the turn persistence owner upserts the thread row.';
