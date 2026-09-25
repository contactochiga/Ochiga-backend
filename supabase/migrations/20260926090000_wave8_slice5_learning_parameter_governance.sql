begin;

-- Wave 8 Slice 5 -- Learning Parameter Consumer. Two narrow, additive
-- fixes, both required before any learning parameter can be safely
-- promoted and consumed.

-- 1) intelligence_feedback outcome-evaluation idempotency (Section 28):
--    outcomeEvaluation.ts's persistOutcome() had no DB-level guard
--    against writing two outcome_evaluation rows for the same
--    prediction if evaluateOpenPredictions() ever raced (e.g. two
--    overlapping ticks, or a retried job landing between the insert and
--    the conditional close). summarizeEvaluatedPredictionsByType() --
--    the ONLY function in this repo that currently produces an
--    evidence-backed learning proposal -- counts these rows directly,
--    so a duplicate would silently inflate or deflate the accuracy
--    ratio fed into that proposal. A prediction is evaluated exactly
--    once by design (evaluateOpenPredictions only reads status='open'
--    rows and immediately closes each one after evaluating it), so a
--    real 1:1 relationship is the correct invariant to enforce here --
--    scoped narrowly to feedback_type='outcome_evaluation' only, so
--    Wave 8 Slice 2's dismissal-feedback rows (which legitimately allow
--    multiple rows per object over time, from different actors) are
--    completely unaffected by this constraint.
create unique index if not exists idx_intelligence_feedback_outcome_evaluation_identity
  on public.intelligence_feedback(object_type, object_id, feedback_type)
  where feedback_type = 'outcome_evaluation';

-- 2) Learning parameter promotion audit/history (Sections 10/11/26/27/33):
--    oyi_learning_parameters itself has no append-only history -- a
--    promotion previously overwrote current_value/version with no
--    record of what it was before, who approved it, or what evidence
--    justified it, and promoteLearningParameter() had no
--    compare-and-swap precondition at all (a plain
--    `update ... where id = ?`), so two concurrent promotions could
--    race and a stale approval could silently clobber a newer value.
--    This table is the minimum additive fix: one append-only row per
--    promotion event, never updated or deleted, giving auditability
--    (Section 26), rollback (Section 11 -- restore current_value from
--    the latest row's previous_value), and a durable record of the
--    optimistic-concurrency precondition (version_before/version_after)
--    alongside the real compare-and-swap now enforced in
--    learningParameters.ts's promoteLearningParameter().
create table if not exists public.oyi_learning_parameter_promotions (
  id uuid primary key default gen_random_uuid(),
  parameter_id uuid not null references public.oyi_learning_parameters(id),
  from_stage text not null,
  to_stage text not null,
  previous_value jsonb,
  new_value jsonb,
  version_before integer not null,
  version_after integer not null,
  evidence jsonb not null default '{}'::jsonb,
  approver text,
  is_rollback boolean not null default false,
  promoted_at timestamptz not null default now()
);

create index if not exists idx_oyi_learning_parameter_promotions_parameter
  on public.oyi_learning_parameter_promotions(parameter_id, promoted_at desc);

alter table public.oyi_learning_parameter_promotions enable row level security;

commit;
