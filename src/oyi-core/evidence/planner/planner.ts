import type { AuthUser } from "../../../middleware/auth";
import type { OisContext } from "../../../types/oisContext";
import type { CanonicalConversationRequest } from "../../contracts/canonicalConversation";
import type { ResolvedTurn } from "../../contracts/resolvedTurn";
import type { CapabilityContext } from "../../contracts/capability";
import { capabilityService } from "../../capabilities/CapabilityService";
import { PLANNER_LIMITS } from "./limits";
import { buildEvidencePlan, scopeKeyFor, subjectKeyFor, type PlanningInput, type RoomScope } from "./planning";
import { executeEvidencePlan, type ExecutionDeps } from "./execute";
import { buildState, contribution } from "./bundle";
import { REFRESH_REQUEST, decideReuse, fingerprint } from "./reuse";
import type { CompactEvidencePlanState, Contribution, EvidencePlan, PlannerLimits } from "./types";

// Everything the planner needs from the IQ-2 assessment context. The user's prompt is NOT re-interpreted:
// the only text consulted is the narrow explicit-refresh request below.
export type PlannerRequest = {
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  input: CanonicalConversationRequest;
  resolvedTurn: ResolvedTurn;
  objective: string;
  subject_domains: string[];
  subject_label: string | null;
  target_id: string | null;
  broad: boolean;
  room: RoomScope;
  building_label: string | null;
  raw_text: string;
  material_text: string | null;
  // IQ-6: evidence classes a changed material fact can affect; everything else fresh is reused. Omitted = IQ-3B behaviour.
  affected_classes?: string[] | null;
  previous: CompactEvidencePlanState | null | undefined;
  limits?: PlannerLimits;
  deps?: ExecutionDeps & { now?: () => number; registry?: PlanningInput["registry"]; canUse?: PlanningInput["canUse"] };
};

export type PlannerResult = { applicable: boolean; plan: EvidencePlan; state: CompactEvidencePlanState; reused_all: boolean };

export async function planAndGatherEvidence(r: PlannerRequest): Promise<PlannerResult> {
  const limits = r.limits || PLANNER_LIMITS;
  const now = (r.deps?.now || Date.now)();
  const planning: PlanningInput = {
    actor: r.actor, oisContext: r.oisContext, surface: r.input.surface, objective: r.objective, subject_domains: r.subject_domains, subject_label: r.subject_label,
    target_id: r.target_id, broad: r.broad, room: r.room, building_label: r.building_label, thread_id: r.input.thread_id || null, limits,
    request_scope: { estate_id: r.input.estate_id || r.oisContext?.estate_id || r.actor?.estate_id || null, home_id: r.input.home_id || r.oisContext?.home_id || r.actor?.home_id || null },
    registry: r.deps?.registry, canUse: r.deps?.canUse,
  };
  const plan = buildEvidencePlan(planning);
  const snapshot = (r.input.context && typeof r.input.context === "object" ? (r.input.context as Record<string, unknown>).operational_snapshot : null) ?? null;
  const isOffice = r.input.surface === "office_internal";
  const input_fingerprint = isOffice ? fingerprint(snapshot) : null;
  const material_hash = r.material_text ? fingerprint(r.material_text) : null;
  const canUse = r.deps?.canUse || capabilityService.canUse.bind(capabilityService);
  const reuse = decideReuse({
    previous: r.previous, steps: plan.steps, scope_key: scopeKeyFor(planning), subject_key: subjectKeyFor(planning), input_fingerprint, material_hash,
    refresh: REFRESH_REQUEST.test(r.raw_text), affected_classes: r.affected_classes ?? null, now, authorised: key => canUse(key, { actor: r.actor, oisContext: r.oisContext, surface: r.input.surface as any, scope: { estate_id: planning.request_scope.estate_id, building_id: null, home_id: planning.request_scope.home_id, room_id: null } }).allowed,
  });
  const toRun = plan.steps.filter(s => !reuse.reusable.has(s.source_key));
  const room_id = r.room.status === "resolved" ? r.room.room_id : null;
  const t0 = now;
  const results = toRun.length
    ? await executeEvidencePlan(plan, toRun, { actor: r.actor, oisContext: r.oisContext, input: r.input, resolvedTurn: r.resolvedTurn, room_id }, limits, r.deps)
    : [];
  const gatheredAt = (r.deps?.now || Date.now)();
  const fresh = new Map<string, Contribution>(results.map(x => [x.step.source_key, contribution(x, limits, gatheredAt)]));
  // Deterministic PLAN order; reused and fresh contributions interleave exactly as the plan lists them.
  const contributions = plan.steps.map(s => fresh.get(s.source_key) || reuse.reusable.get(s.source_key)!).filter(Boolean);
  const state = buildState({
    plan, contributions, limits, gatheredAt, latency_ms: Math.max(0, gatheredAt - t0), reusedKeys: new Set(reuse.reusable.keys()),
    input_fingerprint, material_hash, invalidation: reuse.invalidation, planned: plan.steps.length,
  });
  return { applicable: plan.requirements.length > 0, plan, state, reused_all: toRun.length === 0 && plan.steps.length > 0 };
}

export type { CapabilityContext };
