// src/services/maintenanceTransition.ts
//
// Wave 6 Slice 11 -- shared compare-and-set primitive for every writer that
// mutates maintenance_requests.status. Closes the race documented in
// docs/WAVE6_CURRENT_STATE_FRESHNESS_AUDIT.md Section 3.5:
// updateMaintenance read `existing` unlocked, computed lifecycle
// timestamps from the *new* status, then wrote with no
// `.eq("status", existing.status)` precondition -- identical race shape
// to visitors, and the resulting timeline insert's `from_status` could
// itself already be stale by the time it was written.
//
// Same proven CAS shape as visitorAccessTransition.ts / one conditional
// UPDATE, branch on whether a row came back. Two callers exist with two
// different precondition shapes (a fixed-status snapshot guard for the
// Facility PATCH endpoint's arbitrary-status updates, and a not-already-
// terminal exclusion guard matching executionRegistry.ts's existing
// automation preconditions) -- both expressed here rather than inventing
// a canonical status enum this codebase does not otherwise have.
import { supabaseAdmin } from "../supabase/supabaseClient";

export type MaintenanceTransitionOutcome =
  | { code: "applied"; row: any }
  | { code: "already_in_target"; row: any }
  | { code: "conflict"; currentStatus: string }
  | { code: "not_found" }
  | { code: "db_error"; message: string };

export type MaintenancePrecondition = { in: string[] } | { notIn: string[] };

function applyPrecondition(query: any, precondition: MaintenancePrecondition) {
  if ("in" in precondition) return query.in("status", precondition.in);
  return query.not("status", "in", `(${precondition.notIn.join(",")})`);
}

// patch must include `status` when this is a real status transition (used
// to detect "already_in_target" on a lost race); omit it only for the
// exclusion-guard case where the caller's own logic already fixes the
// target status via a separate field (kept as a required param here so
// every call site is explicit about what it's writing).
export async function transitionMaintenanceStatus(
  id: string,
  precondition: MaintenancePrecondition,
  patch: Record<string, unknown> & { status?: string }
): Promise<MaintenanceTransitionOutcome> {
  const fullPatch = { ...patch, updated_at: new Date().toISOString() };
  let query: any = supabaseAdmin.from("maintenance_requests").update(fullPatch as any).eq("id", id);
  query = applyPrecondition(query, precondition);
  const { data: claimed, error } = await query.select("*").maybeSingle();

  if (error) return { code: "db_error", message: error.message };
  if (claimed) return { code: "applied", row: claimed };

  const { data: current, error: readError } = await supabaseAdmin.from("maintenance_requests").select("*").eq("id", id).maybeSingle();
  if (readError) return { code: "db_error", message: readError.message };
  if (!current) return { code: "not_found" };
  if (patch.status && String(current.status) === patch.status) return { code: "already_in_target", row: current };
  return { code: "conflict", currentStatus: String(current.status) };
}
