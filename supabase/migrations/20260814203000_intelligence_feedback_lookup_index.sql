begin;

-- Programme 4 Phase L (schema/hydration integrity audit) — intelligence_feedback
-- (supabase/migrations/20260728143000_oyi_core_convergence_canonical_storage.sql)
-- has had no index beyond its primary key since creation, despite being
-- queried by (object_type, feedback_type, object_id) in multiple places:
-- outcomeEvaluation.ts's persistOutcome/summarizeEvaluatedPredictions
-- (existing, Programme 3), and this programme's new
-- summarizeEvaluatedPredictionsByType (Phase I's global, cross-home
-- learning-proposal aggregation, now run on a daily schedule). Purely
-- additive — no column/data change, safe to apply without downtime.
create index if not exists idx_intelligence_feedback_lookup
  on public.intelligence_feedback(object_type, feedback_type, object_id);

commit;
