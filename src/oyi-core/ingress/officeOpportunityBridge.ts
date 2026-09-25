// Wave 8 Slice 4 -- Commercial Outcome Evaluator. Core's only READ path
// into Office's real Opportunity authority (Office HEAD c08cb92,
// docs/WAVE8_SLICE4_OFFICE_OPPORTUNITY_OUTCOME_PREREQUISITE_IMPLEMENTATION.md).
// Mirrors the SAME outbound Backend->Office bridge pattern
// officeHandoffBridge.ts already established (same shared secret, same
// base-URL resolution, same discriminated-union result shape) -- not a
// new architecture, applying that proven pattern to two existing,
// read-only Office admin routes (GET /api/lead-agents/admin/crm/
// opportunities and .../activities). Office remains the sole authority
// for Opportunity stage/status/history; this module only reads and
// reports what Office says -- it never writes anything back.
import axios from "axios";
import { resolveOfficeSyncKey } from "../../middleware/officeCredential";

const DEFAULT_OFFICE_BASE_URL = "https://ochiga-lead-agents.onrender.com";

function resolveOfficeBaseUrl(): string {
  const configured = process.env.OFFICE_APP_URL || "";
  const first = configured.split(",")[0]?.trim();
  return (first || DEFAULT_OFFICE_BASE_URL).replace(/\/+$/, "");
}

export type OfficeOpportunityTransitionEvidence = {
  previousStage: string | null;
  targetStage: string | null;
  evidenceType: string | null;
  evidenceId: string | null;
  occurredAt: string;
};

export type OfficeOpportunitySnapshot = {
  id: string;
  stage: string;
  status: string;
  leadId: string | null;
  updatedAt: string;
  // Every real opportunity_stage_changed activity for this Opportunity,
  // oldest first -- the historical record needed to answer "did this
  // Opportunity ever reach stage X," not merely "is it at X right now"
  // (Section 20 -- historical outcome preservation). Empty, honestly,
  // when no such activity exists (a freshly-created Opportunity, or
  // Office's activities fetch failed independently of the opportunities
  // fetch -- see fetchOfficeOpportunitySnapshots' own disclosed
  // degradation below).
  stageHistory: OfficeOpportunityTransitionEvidence[];
};

export type OfficeOpportunitySnapshotResult =
  | { ok: true; snapshots: Map<string, OfficeOpportunitySnapshot> }
  | { ok: false; reason: string };

function text(value: unknown): string {
  return String(value ?? "").trim();
}

// Batched by construction (Section 32 -- no N+1): exactly two Office HTTP
// calls total, regardless of how many opportunityIds the caller asks
// about or how many Goals a batch evaluation covers -- never one call per
// Opportunity/Goal. Office's own admin routes are list-only (no per-id
// GET exists yet -- a disclosed, known scaling limitation for a very
// large opportunities/activities table; see the Slice 4 doc's own
// "remaining gaps," not a hard blocker at today's real volume).
export async function fetchOfficeOpportunitySnapshots(opportunityIds: string[]): Promise<OfficeOpportunitySnapshotResult> {
  const wanted = new Set(opportunityIds.filter(Boolean).map(String));
  if (!wanted.size) return { ok: true, snapshots: new Map() };

  const key = resolveOfficeSyncKey();
  if (!key) return { ok: false, reason: "not_configured" };

  const headers = { "x-office-api-key": key, "content-type": "application/json" };
  const baseUrl = resolveOfficeBaseUrl();

  let opportunityRows: Array<Record<string, unknown>>;
  try {
    const response = await axios.get(`${baseUrl}/api/lead-agents/admin/crm/opportunities`, { headers, timeout: 15000, validateStatus: () => true });
    if (response.status < 200 || response.status >= 300) return { ok: false, reason: `office_http_${response.status}` };
    opportunityRows = Array.isArray(response.data?.collection) ? response.data.collection : [];
  } catch (error: any) {
    return { ok: false, reason: String(error?.message || error) };
  }

  const snapshots = new Map<string, OfficeOpportunitySnapshot>();
  for (const row of opportunityRows) {
    const id = text(row.id);
    if (!id || !wanted.has(id)) continue;
    snapshots.set(id, {
      id,
      stage: text(row.stage) || "intake_received",
      status: text(row.status) || "open",
      leadId: text(row.lead_id) || null,
      updatedAt: text(row.updated_at) || text(row.created_at) || new Date(0).toISOString(),
      stageHistory: [],
    });
  }
  if (!snapshots.size) return { ok: true, snapshots };

  // Activities fetch degrades independently and honestly (Section 20's
  // own historical-preservation need is best-effort, never fabricated):
  // if this second call fails, every snapshot above is still returned
  // with an empty stageHistory rather than failing the whole evaluation
  // -- the evaluator falls back to current-stage-only comparison for
  // intermediate targets in that case, a real, disclosed degradation.
  try {
    const response = await axios.get(`${baseUrl}/api/lead-agents/admin/crm/activities`, { headers, timeout: 15000, validateStatus: () => true });
    if (response.status >= 200 && response.status < 300) {
      const activityRows: Array<Record<string, unknown>> = Array.isArray(response.data?.collection) ? response.data.collection : [];
      for (const activity of activityRows) {
        if (activity.activity_type !== "opportunity_stage_changed") continue;
        const relatedId = text(activity.related_id) || text(activity.opportunity_id);
        const snapshot = snapshots.get(relatedId);
        if (!snapshot) continue;
        const metadata = (activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {}) as Record<string, unknown>;
        snapshot.stageHistory.push({
          previousStage: text(metadata.previous_stage) || null,
          targetStage: text(metadata.target_stage) || null,
          evidenceType: text(metadata.evidence_type) || null,
          evidenceId: text(metadata.evidence_id) || null,
          occurredAt: text(activity.occurred_at) || text(activity.created_at) || snapshot.updatedAt,
        });
      }
      for (const snapshot of snapshots.values()) {
        snapshot.stageHistory.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
      }
    }
  } catch {
    // Disclosed degradation -- see the comment above this try block.
  }

  return { ok: true, snapshots };
}
