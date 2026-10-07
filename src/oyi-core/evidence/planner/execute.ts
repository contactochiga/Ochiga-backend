import type { AuthUser } from "../../../middleware/auth";
import type { OisContext } from "../../../types/oisContext";
import type { CanonicalConversationRequest } from "../../contracts/canonicalConversation";
import type { CapabilityContext } from "../../contracts/capability";
import type { EvidenceReadOutcome } from "../../contracts/evidence";
import type { ResolvedTurn } from "../../contracts/resolvedTurn";
import { capabilityService } from "../../capabilities/CapabilityService";
import { readOnlyEvidenceDb, type ReadOnlyEvidenceDb } from "../ReadOnlyEvidenceDb";
import type { EvidencePlan, PlanStep, PlannerLimits } from "./types";

export type StepResult = { step: PlanStep; outcome: EvidenceReadOutcome | null; failure: "timeout" | "error" | null; latency_ms: number };

export type ExecutionBase = {
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  input: CanonicalConversationRequest;
  resolvedTurn: ResolvedTurn;
  room_id: string | null;
};

export type ExecutionDeps = {
  readEvidence?: (key: string, context: CapabilityContext, timeoutMs: number) => Promise<EvidenceReadOutcome>;
  db?: ReadOnlyEvidenceDb;
  now?: () => number;
};

// Each source gets its OWN context object: no shared mutable planner state between parallel reads.
// Exact-record targets and client-supplied room/building hints are stripped so a source can only be
// asked the question the plan chose (a stale selected object must not turn every read into an
// "unsupported exact-record" rejection, and a client hint must not widen or narrow a certified scope).
function contextFor(step: PlanStep, base: ExecutionBase, deps: ExecutionDeps): CapabilityContext {
  const requestContext = base.input.context && typeof base.input.context === "object" && !Array.isArray(base.input.context) ? (base.input.context as Record<string, unknown>) : {};
  const { building_id: _b, room_id: _r, ...keptContext } = requestContext;
  return {
    actor: base.actor, oisContext: base.oisContext,
    input: { ...base.input, room_id: step.scope_class === "consumer_room" ? base.room_id : null, context: keptContext } as CanonicalConversationRequest,
    resolvedTurn: { ...base.resolvedTurn, target: null } as ResolvedTurn,
    legacyFallback: async () => { throw new Error("EVIDENCE_PLAN_NO_FALLBACK"); },
    evidence_db: deps.db ?? readOnlyEvidenceDb(),
  } as CapabilityContext;
}

/**
 * Run the plan's reads in parallel. Results are returned in PLAN order (never completion order).
 * A source failure, denial or timeout is isolated to that source. After the overall deadline the
 * run is closed: unfinished sources are reported as timeouts and any late result is discarded.
 */
export async function executeEvidencePlan(plan: EvidencePlan, steps: PlanStep[], base: ExecutionBase, limits: PlannerLimits, deps: ExecutionDeps = {}): Promise<StepResult[]> {
  const now = deps.now || Date.now;
  const read = deps.readEvidence || ((key, context, ms) => capabilityService.readEvidence(key, context, ms));
  const results: Array<StepResult | null> = steps.map(() => null);
  let closed = false;
  const started = now();
  const runs = steps.map(async (step, index) => {
    const t0 = now();
    let outcome: EvidenceReadOutcome | null = null;
    let failure: StepResult["failure"] = null;
    try { outcome = await read(step.source_key, contextFor(step, base, deps), limits.per_source_ms); } catch { failure = "error"; }
    // Late results (after the overall deadline) are discarded, never delivered.
    if (!closed) results[index] = { step, outcome, failure, latency_ms: Math.max(0, now() - t0) };
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>(resolve => { timer = setTimeout(resolve, limits.overall_ms); });
  try { await Promise.race([Promise.allSettled(runs), deadline]); } finally { closed = true; if (timer) clearTimeout(timer); }
  return steps.map((step, i) => results[i] || { step, outcome: null, failure: "timeout" as const, latency_ms: Math.max(0, now() - started) });
}
