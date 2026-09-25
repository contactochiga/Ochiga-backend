// Wave 8 Slice 6 -- shared idempotent-persist plumbing for the new
// Camera/Maintenance/Visitor outcome evaluators (Section 3: "avoid
// copy/pasting three domain-specific evaluator frameworks... but do not
// create an over-generalized abstraction if domain semantics genuinely
// differ"). The mechanical shape -- check existing rows by evidence_key,
// batch-insert the rest, fall back to per-row inserts only on a genuine
// concurrent 23505 -- is identical across all three domains and shares
// nothing with each domain's own target/reduction/evidence logic, which
// stays entirely separate in each evaluator's own file. deviceOutcomeEvaluator.ts
// (Slice 1) is deliberately NOT refactored to use this -- it is frozen,
// and its own weaker application-level idempotency pattern is a
// different, already-accepted design this slice does not need to touch.
//
// Reuses Slice 5's real partial unique index
// (idx_intelligence_feedback_outcome_evaluation_identity, scoped to
// feedback_type='outcome_evaluation') for genuine DB-level idempotency --
// every caller of this helper MUST pass feedbackType="outcome_evaluation"
// for that guarantee to actually apply; object_type is what
// differentiates domains under that one shared constraint.
import { logger } from "../../../observability/logger";
import { supabaseAdmin } from "../../../supabase/supabaseClient";

export type PersistableEvaluation = {
  persisted: boolean;
  feedbackId: string | null;
  causalNote: string;
  notes: string;
  lineage: unknown;
  result: string;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function persistOutcomeEvaluations<E extends PersistableEvaluation>(
  evaluated: Array<{ evaluation: E; evidenceKey: string; objectId: string }>,
  objectType: string,
  feedbackType: string,
  logPrefix: string,
  extraMetadata?: (evaluation: E) => Record<string, unknown>
): Promise<void> {
  if (!evaluated.length) return;

  const objectIds = Array.from(new Set(evaluated.map((e) => e.objectId)));
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("intelligence_feedback")
    .select("id,object_id,outcome_metadata")
    .eq("object_type", objectType)
    .eq("feedback_type", feedbackType)
    .in("object_id", objectIds);
  if (existingError) logger.warn(`${logPrefix}_existing_lookup_failed`, { error: existingError, object_ids: objectIds });

  const existingByObjectId = new Map<string, Array<{ id: string; evidence_key: unknown }>>();
  for (const row of existingRows || []) {
    const list = existingByObjectId.get((row as any).object_id) || [];
    list.push({ id: (row as any).id, evidence_key: recordOf((row as any).outcome_metadata).evidence_key });
    existingByObjectId.set((row as any).object_id, list);
  }

  const toInsert: Array<Record<string, unknown>> = [];
  evaluated.forEach((entry) => {
    const existing = (existingByObjectId.get(entry.objectId) || []).find((row) => row.evidence_key === entry.evidenceKey);
    if (existing) {
      entry.evaluation.persisted = true;
      entry.evaluation.feedbackId = existing.id;
      return;
    }
    toInsert.push({
      object_type: objectType,
      object_id: entry.objectId,
      feedback_type: feedbackType,
      actor_id: null,
      reason: entry.evaluation.causalNote,
      outcome_metadata: {
        evidence_key: entry.evidenceKey,
        result: entry.evaluation.result,
        lineage: entry.evaluation.lineage,
        notes: entry.evaluation.notes,
        evaluated_at: new Date().toISOString(),
        ...(extraMetadata ? extraMetadata(entry.evaluation) : {}),
      },
    });
  });

  if (!toInsert.length) return;

  // Belt-and-braces write: even after the pre-check above, a genuine
  // concurrent evaluator run could still race between that SELECT and
  // this INSERT. The real DB-level unique index is the actual source of
  // truth; a 23505 here means the row was already durably recorded by
  // whichever run got there first -- an expected, benign idempotent
  // outcome, never a failure. A multi-row batch insert rolls back
  // entirely on any single conflict, so on 23505 we fall back to
  // inserting the remaining rows one at a time, each tolerating its own
  // 23505 independently -- a rare path, only exercised under genuine
  // concurrency.
  const { data: inserted, error: insertError } = await supabaseAdmin.from("intelligence_feedback").insert(toInsert as any).select("id,object_id,outcome_metadata");
  if (insertError && (insertError as any).code === "23505") {
    for (const row of toInsert) {
      const { data: single, error: singleError } = await supabaseAdmin.from("intelligence_feedback").insert(row as any).select("id,object_id,outcome_metadata").maybeSingle();
      if (singleError && (singleError as any).code !== "23505") {
        logger.warn(`${logPrefix}_persist_failed_single`, { error: singleError });
        continue;
      }
      if (single) {
        const match = evaluated.find((e) => e.objectId === (single as any).object_id && !e.evaluation.persisted);
        if (match) {
          match.evaluation.persisted = true;
          match.evaluation.feedbackId = (single as any).id;
        }
      }
    }
    return;
  }
  if (insertError) {
    logger.warn(`${logPrefix}_persist_failed`, { error: insertError });
    return;
  }
  for (const row of inserted || []) {
    const evidenceKey = recordOf((row as any).outcome_metadata).evidence_key;
    const match = evaluated.find((e) => e.objectId === (row as any).object_id && e.evidenceKey === evidenceKey && !e.evaluation.persisted);
    if (match) {
      match.evaluation.persisted = true;
      match.evaluation.feedbackId = (row as any).id;
    }
  }
}
