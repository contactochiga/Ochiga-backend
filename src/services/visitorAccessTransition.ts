// src/services/visitorAccessTransition.ts
//
// Wave 6 Slice 11 -- shared compare-and-set primitive for every writer that
// mutates visitor_access.status. Closes the race documented in
// docs/WAVE6_CURRENT_STATE_FRESHNESS_AUDIT.md Section 3.4:
// approveVisitor/denyVisitor (and their automation equivalents) previously
// performed an unconditional `.update({status}).eq("id", id)` with no
// status precondition, so two concurrent decisions on the same row could
// both pass authorization and both write -- whichever committed last
// silently won with no detection.
//
// Reuses the exact CAS shape already proven in
// facilityAutomationService.ts::executeApprovalRow (pending_approval ->
// executing): one conditional UPDATE, then branch on whether a row came
// back. A genuine DB error is never conflated with "someone else already
// moved this row" -- that exact conflation was the exact bug the
// automation-approval CAS guard was built to close, and is the same
// failure mode this closes here.
import { supabaseAdmin } from "../supabase/supabaseClient";

export type VisitorTransitionOutcome =
  | { code: "applied"; row: any }
  | { code: "already_in_target"; row: any }
  | { code: "conflict"; currentStatus: string }
  | { code: "not_found" }
  | { code: "db_error"; message: string };

function missingUpdatedAtColumn(error: any) {
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  return /updated_at/.test(message) && /column|schema cache|could not find/.test(message);
}

// fromAny: the set of prior statuses this transition is legitimately
// allowed to fire from (matches actual existing precondition vocabulary --
// see call sites for the exact set each transition preserves). A single-
// element array expresses a plain optimistic-concurrency snapshot guard
// (the generic Facility status-setter's use case) rather than a named
// lifecycle transition.
export async function transitionVisitorAccessStatus(
  id: string,
  fromAny: string[],
  to: string,
  extraPatch: Record<string, unknown> = {}
): Promise<VisitorTransitionOutcome> {
  const patch = { status: to, ...extraPatch, updated_at: new Date().toISOString() };
  let { data: claimed, error } = await supabaseAdmin
    .from("visitor_access")
    .update(patch as any)
    .eq("id", id)
    .in("status", fromAny)
    .select("*")
    .maybeSingle();

  if (error && missingUpdatedAtColumn(error)) {
    const { updated_at, ...withoutUpdatedAt } = patch;
    ({ data: claimed, error } = await supabaseAdmin
      .from("visitor_access")
      .update(withoutUpdatedAt as any)
      .eq("id", id)
      .in("status", fromAny)
      .select("*")
      .maybeSingle());
  }

  if (error) return { code: "db_error", message: error.message };
  if (claimed) return { code: "applied", row: claimed };

  // Lost the CAS (or the row was never in fromAny to begin with) --
  // re-read to distinguish "already at the target state" (idempotent, not
  // an error) from a genuine conflicting stale write, and never report
  // success for either without having actually won the update.
  const { data: current, error: readError } = await supabaseAdmin.from("visitor_access").select("*").eq("id", id).maybeSingle();
  if (readError) return { code: "db_error", message: readError.message };
  if (!current) return { code: "not_found" };
  if (String(current.status) === to) return { code: "already_in_target", row: current };
  return { code: "conflict", currentStatus: String(current.status) };
}
