import { createHash, randomUUID } from "node:crypto";
import type { AuthUser } from "../../../middleware/auth";
import type { OisContext } from "../../../types/oisContext";
import type { EvidenceScopeClass } from "../../contracts/evidence";
import type { CapabilityModule } from "../../contracts/capability";
import { capabilityRegistry } from "../../capabilities/CapabilityRegistry";
import { capabilityService } from "../../capabilities/CapabilityService";
import { EVIDENCE_CLASSES, entryFor } from "./evidenceClasses";
import { deriveRequirements } from "./policy";
import type { EvidencePlan, PlanStep, Requirement, UnresolvedClass } from "./types";
import type { PlannerLimits } from "./types";

export type RoomScope = { status: "none" } | { status: "resolved"; room_id: string; label: string } | { status: "unresolved"; label: string };

export type PlanningInput = {
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  surface: string;
  objective: string;
  subject_domains: string[];
  subject_label: string | null;
  target_id: string | null;
  broad: boolean;
  room: RoomScope;
  building_label: string | null;
  thread_id: string | null;
  // The scope the reads will actually be issued for (request estate/home; client building/room hints are stripped).
  request_scope: { estate_id: string | null; home_id: string | null };
  limits: PlannerLimits;
  // Test seam: the registry/authority used for admission. Defaults to the real ones.
  registry?: { get(key: string): CapabilityModule | undefined };
  canUse?: typeof capabilityService.canUse;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);

export function scopeKeyFor(i: Pick<PlanningInput, "surface" | "oisContext" | "room" | "building_label">) {
  return hash([i.surface, i.oisContext?.estate_id || "", i.oisContext?.home_id || "", i.room.status === "resolved" ? i.room.room_id : i.room.status, (i.building_label || "").toLowerCase()].join("|"));
}
export function subjectKeyFor(i: Pick<PlanningInput, "subject_domains" | "subject_label" | "target_id">) {
  return hash([[...i.subject_domains].sort().join(","), (i.subject_label || "").toLowerCase(), i.target_id || ""].join("|"));
}

function scopeClassFor(surface: string, module: CapabilityModule, roomCapable: boolean, room: RoomScope): EvidenceScopeClass | null {
  if (surface === "office_internal") return "office_permissioned_snapshot";
  if (surface === "facility") return "facility_estate";
  if (surface === "consumer") return roomCapable && room.status === "resolved" ? "consumer_room" : "consumer_home";
  if (surface === "public_corporate") return module.evidence_read?.scopes.includes("public_thread") ? "public_thread" : "public_corporate";
  return null;
}

type Admission = { ok: true; scope_class: EvidenceScopeClass } | { ok: false; reason: UnresolvedClass["reason"]; detail: string };

export function admitSource(key: string, roomCapable: boolean, i: PlanningInput): Admission {
  const module = (i.registry || capabilityRegistry).get(key);
  if (!module) return { ok: false, reason: "no_certified_source", detail: `${key} is not registered` };
  // Certification is read from the capability itself: absent evidence_read means NOT certified (debt, disabled, composite).
  if (!module.evidence_read) return { ok: false, reason: "no_certified_source", detail: `${key} has no IQ-3A certified evidence read` };
  const scope = scopeClassFor(i.surface, module, roomCapable, i.room);
  if (!scope) return { ok: false, reason: "scope_unsupported", detail: `surface ${i.surface} is not a planner surface` };
  const declared = module.evidence_read.scopes;
  const compatible = declared.includes(scope) || (scope === "public_thread" && declared.includes("public_corporate"));
  if (!compatible) return { ok: false, reason: "scope_unsupported", detail: `${key} is not certified for ${scope}` };
  if (scope === "public_thread" && !i.thread_id) return { ok: false, reason: "scope_insufficient", detail: "a thread is required" };
  const authority = (i.canUse || capabilityService.canUse.bind(capabilityService))(key, { actor: i.actor, oisContext: i.oisContext, surface: i.surface as any, scope: { estate_id: i.request_scope.estate_id, building_id: null, home_id: i.request_scope.home_id, room_id: null } });
  if (!authority.allowed) return { ok: false, reason: "not_authorised", detail: `${key}: ${authority.reason}` };
  return { ok: true, scope_class: scope };
}

export function buildEvidencePlan(i: PlanningInput): EvidencePlan {
  const { requirements, notes } = deriveRequirements({ surface: i.surface, objective: i.objective, subject_domains: i.subject_domains, broad: i.broad });
  const steps: PlanStep[] = [];
  const unresolved: UnresolvedClass[] = [];
  const planNotes = [...notes];
  if (i.building_label) planNotes.push("requested_building_scope_not_certified_estate_read_only");
  if (i.target_id) planNotes.push("selected_record_is_context_not_an_exact_read");
  const order = [...requirements].sort((a, b) => (a.necessity === b.necessity ? 0 : a.necessity === "mandatory" ? -1 : 1));
  for (const req of order) {
    const entry = entryFor(req.class);
    if (!entry) { unresolved.push({ class: req.class, necessity: req.necessity, reason: "no_certified_source", detail: "no evidence class exists for this subject" }); continue; }
    if (entry.surface_debt?.[i.surface]) { unresolved.push({ class: req.class, necessity: req.necessity, reason: "known_product_debt", detail: entry.surface_debt[i.surface] }); continue; }
    if (entry.product_debt) { unresolved.push({ class: req.class, necessity: req.necessity, reason: "known_product_debt", detail: entry.product_debt }); continue; }
    if (entry.room_capable && i.room.status === "unresolved") { unresolved.push({ class: req.class, necessity: req.necessity, reason: "room_unresolved", detail: `the room "${i.room.label}" could not be identified; the whole home was not substituted` }); continue; }
    const failures: Array<Extract<Admission, { ok: false }>> = [];
    const admitted: Array<{ key: string; scope_class: EvidenceScopeClass }> = [];
    for (const key of entry.sources) {
      const a = admitSource(key, Boolean(entry.room_capable), i);
      if (a.ok) { admitted.push({ key, scope_class: a.scope_class }); if (entry.mode === "first") break; }
      else failures.push(a);
    }
    if (!admitted.length) {
      const pick = failures.find(f => f.reason === "not_authorised") || failures.find(f => f.reason === "scope_insufficient") || failures.find(f => f.reason === "scope_unsupported") || failures[0];
      unresolved.push({ class: req.class, necessity: req.necessity, reason: pick?.reason || "no_certified_source", detail: pick?.detail || "no source" });
      continue;
    }
    admitted.forEach((a, n) => steps.push({ step_id: `${req.class}#${n}`, class: req.class, necessity: req.necessity, source_key: a.key, scope_class: a.scope_class,
      scope_label: a.scope_class === "consumer_room" && i.room.status === "resolved" ? i.room.label : null, selection_reason: entry.mode === "first" ? `first admissible source in precedence ${entry.sources.join(" > ")}` : `all admissible sources (${entry.sources.length} in class)` }));
    if (entry.mode === "all" && admitted.length < entry.sources.length) planNotes.push(`class_${req.class}_partial_membership`);
  }
  // Explicit fan-out bound: mandatory steps are kept first; optional ones are dropped before any mandatory one.
  if (steps.length > i.limits.max_sources) {
    const keep = steps.slice(0, i.limits.max_sources);
    for (const dropped of steps.slice(i.limits.max_sources)) unresolved.push({ class: dropped.class, necessity: dropped.necessity, reason: "fan_out_bound", detail: `${dropped.source_key} exceeded the ${i.limits.max_sources}-source bound` });
    steps.length = 0; steps.push(...keep);
  }
  return {
    version: 1, plan_id: `iq3b-${randomUUID()}`, objective: i.objective, surface: i.surface, scope_key: scopeKeyFor(i), subject_key: subjectKeyFor(i),
    broad: i.broad, requirements, steps, unresolved, notes: planNotes,
  };
}

export const allClassIds = () => Object.keys(EVIDENCE_CLASSES);
export type { Requirement };
