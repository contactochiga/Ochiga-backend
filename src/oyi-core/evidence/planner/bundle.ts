import type { EvidenceReadOutcome, OyiEvidence } from "../../contracts/evidence";
import { ASSESSMENT_TTL_MS } from "../../context/conversationAssessmentContext";
import { MAX_REFS_PER_SOURCE, MAX_STRING } from "./limits";
import { SOURCE_NOUN, entryFor } from "./evidenceClasses";
import type { ClassOutcome, ClassStatus, CompactEvidencePlanState, CompactRef, Contribution, EvidencePlan, PlanStatus, PlannerLimits } from "./types";
import type { StepResult } from "./execute";

const text = (v: unknown) => String(v ?? "").trim();
const recordOf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// Allowlisted scalar fields that later judgment (IQ-4) may need. Names of third parties (visitors),
// credentials, free-text descriptions and contact details are deliberately not projectable.
const MATERIAL_FIELDS = ["id", "name", "title", "status", "stage", "state", "priority", "severity", "overdue", "days_since_activity", "reason", "last_activity_at",
  "scheduled_at", "due_at", "expires_at", "opened_at", "created_at", "updated_at", "enabled", "availability", "online", "category", "device_family", "room_name",
  "overall", "video_evidence", "observed_at", "freshness", "workflow_status", "location", "type", "known_facts_count", "claim_boundary", "canonical_key"] as const;

function primaryObject(record: OyiEvidence): Record<string, unknown> {
  const payload = recordOf(record.payload);
  const fact = recordOf(payload.fact);
  if (Object.keys(fact).length) return { ...recordOf(fact.value), __label: text(fact.object && recordOf(fact.object).label) };
  for (const [k, v] of Object.entries(payload)) if (k !== "provenance" && v && typeof v === "object" && !Array.isArray(v)) return recordOf(v);
  return payload;
}

const scalar = (v: unknown): string | number | boolean | null | undefined =>
  typeof v === "string" ? v.slice(0, MAX_STRING) : typeof v === "number" && Number.isFinite(v) ? v : typeof v === "boolean" ? v : v === null ? null : undefined;

export function materialFor(record: OyiEvidence, sourceKey: string): Record<string, string | number | boolean | null> {
  const p = primaryObject(record);
  const out: Record<string, string | number | boolean | null> = {};
  for (const f of MATERIAL_FIELDS) { const v = scalar(p[f]); if (v !== undefined && !(sourceKey === "visitors.pending.read" && f === "name")) out[f] = v; }
  const label = text(record.object_ref?.label) || text(p.__label) || text(p.name) || text(p.title);
  if (label && sourceKey !== "visitors.pending.read") out.label = label.slice(0, MAX_STRING);
  if (sourceKey === "corporate.opportunity.read") {
    const objective = recordOf(recordOf(record.payload).objective);
    out.objective_type = scalar(objective.objective_type) ?? null; out.known_facts_count = Object.keys(recordOf(objective.known_facts)).length;
    for (const [k, v] of Object.entries(recordOf(objective.known_facts)).slice(0, 6)) { const s = scalar(v); if (s !== undefined) out[`fact_${k}`.slice(0, 32)] = s; }
    out.caller_supplied_unverified = true;
  }
  if (record.truth_class === "user_assertion") out.caller_supplied_unverified = true;
  return out;
}

// A visitor record's label is a third party's name: the reference keeps type and id only.
function refFor(record: OyiEvidence, sourceKey: string): CompactRef {
  const p = primaryObject(record);
  if (sourceKey === "visitors.pending.read") return { t: record.object_type || null, id: record.object_id || text(p.id) || null, l: null };
  return { t: record.object_type || null, id: record.object_id || text(p.id) || null, l: (text(record.object_ref?.label) || text(p.name) || text(p.title)).slice(0, MAX_STRING) || null };
}

export function lifecycleSummary(outcome: EvidenceReadOutcome) {
  const s = { active: 0, historical: 0, unknown: 0 };
  for (const l of outcome.lifecycle || []) s[l.relevance] += 1;
  return s;
}

function availabilityFor(status: Contribution["status"]): Contribution["availability"] {
  switch (status) {
    case "available_complete": case "available_partial": case "available_zero": case "stale": return "available";
    case "authority_denied": return "denied";
    case "scope_unsupported": case "scope_insufficient": return "unsupported_scope";
    case "timeout": return "timeout";
    case "error": return "error";
    default: return "unavailable";
  }
}

export function contribution(result: StepResult, limits: PlannerLimits, gatheredAtMs: number): Contribution {
  const { step, outcome, failure } = result;
  const status: Contribution["status"] = outcome ? outcome.status : failure === "timeout" ? "timeout" : "error";
  const entry = entryFor(step.class);
  const fresh = Math.min(gatheredAtMs + (entry?.ttl_ms ?? 5 * 60_000), gatheredAtMs + ASSESSMENT_TTL_MS);
  const records = outcome?.records || [];
  const availability = availabilityFor(status);
  return {
    source_key: step.source_key, evidence_class: step.class, necessity: step.necessity, status, availability,
    completeness: !outcome || availability !== "available" ? "unknown" : outcome.zero_proven ? "zero_proven" : outcome.complete ? "complete" : "partial",
    freshness: outcome ? (entry?.kind === "state" ? outcome.freshness : outcome.freshness === "stale" ? "current" : outcome.freshness) : "unknown",
    scope_class: step.scope_class, scope_label: step.scope_label || null,
    lifecycle: outcome ? lifecycleSummary(outcome) : { active: 0, historical: 0, unknown: 0 },
    record_count: outcome?.record_count || 0, unobserved: records.filter(r => r.freshness === "unobservable").length, source_total: outcome?.source_total ?? null, truncated: Boolean(outcome?.truncated),
    degraded: (outcome?.degraded_sources || []).map(d => `${d.source}${d.mandatory ? "!" : ""}`),
    refs: records.slice(0, MAX_REFS_PER_SOURCE).map(r => refFor(r, step.source_key)),
    material: records.slice(0, limits.max_material_items).map(r => materialFor(r, step.source_key)),
    provenance: records.flatMap(r => (r.payload && (r.payload as any).provenance ? [recordOf((r.payload as any).provenance)] : [])).slice(0, 2),
    gathered_at: new Date(gatheredAtMs).toISOString(), fresh_until: new Date(fresh).toISOString(), latency_ms: result.latency_ms,
  };
}

const UNRESOLVED_AS_MISSING = new Set(["known_product_debt", "no_certified_source", "composite_not_planner_source"]);

export function classOutcomes(plan: EvidencePlan, contributions: Contribution[]): ClassOutcome[] {
  const out: ClassOutcome[] = [];
  for (const req of plan.requirements) {
    const mine = contributions.filter(c => c.evidence_class === req.class);
    const unresolved = plan.unresolved.find(u => u.class === req.class);
    const usable = mine.filter(c => c.availability === "available");
    let status: ClassStatus; let reason: string | null = null;
    if (!mine.length) {
      reason = unresolved ? `${unresolved.reason}: ${unresolved.detail}` : "not planned";
      status = req.necessity === "optional" ? "OPTIONAL_UNAVAILABLE" : unresolved && UNRESOLVED_AS_MISSING.has(unresolved.reason) ? "MANDATORY_MISSING_CAPABILITY" : "MANDATORY_UNAVAILABLE";
    } else if (req.necessity === "optional") {
      status = usable.length ? "OPTIONAL_GATHERED" : "OPTIONAL_UNAVAILABLE";
    } else if (!usable.length) { status = "MANDATORY_UNAVAILABLE"; reason = mine.map(c => `${c.source_key}:${c.status}`).join(","); }
    else {
      const whole = usable.length === mine.length && !unresolved && usable.every(c => (c.completeness === "complete" || c.completeness === "zero_proven") && !c.truncated && c.freshness !== "stale" && !c.degraded.length && c.unobserved === 0);
      status = whole ? "MANDATORY_COMPLETE_ENOUGH" : "MANDATORY_PARTIAL";
      if (!whole) reason = [...mine.filter(c => c.availability !== "available").map(c => `${c.source_key}:${c.status}`), ...(unresolved ? [`member_missing:${unresolved.reason}`] : [])].join(",") || "partial";
    }
    out.push({ class: req.class, necessity: req.necessity, status, sources: mine.map(c => c.source_key), reason });
  }
  return out;
}

export function planStatus(classes: ClassOutcome[]): PlanStatus {
  const mandatory = classes.filter(c => c.necessity === "mandatory");
  if (!mandatory.length) return "NO_EVIDENCE_REQUIRED";
  if (mandatory.some(c => c.status === "MANDATORY_MISSING_CAPABILITY")) return "MANDATORY_MISSING_CAPABILITY";
  if (mandatory.some(c => c.status === "MANDATORY_UNAVAILABLE")) return "MANDATORY_UNAVAILABLE";
  if (mandatory.some(c => c.status === "MANDATORY_PARTIAL")) return "MANDATORY_PARTIAL";
  return "MANDATORY_COMPLETE_ENOUGH";
}

// What the gathered evidence cannot support. Deterministic from the contributions; never invented confidence.
export function cannotConclude(plan: EvidencePlan, classes: ClassOutcome[], contributions: Contribution[]): string[] {
  const out = new Set<string>();
  const partialSnapshots: string[] = [];
  for (const c of classes) {
    const entry = entryFor(c.class);
    if (c.status === "MANDATORY_MISSING_CAPABILITY" && entry?.product_debt) out.add(`Anything about ${entry.label}: ${entry.product_debt}.`);
    else if (c.status === "MANDATORY_MISSING_CAPABILITY") out.add(`Anything about ${entry?.label || c.class}: no certified evidence source is available to me for it.`);
    if (c.status === "MANDATORY_UNAVAILABLE") out.add(`${entry?.label || c.class} could not be read, so it was not checked.`);
  }
  for (const k of contributions) {
    if (k.availability !== "available") continue;
    const noun = SOURCE_NOUN[k.source_key] || k.source_key;
    if (k.scope_class === "office_permissioned_snapshot" && k.completeness === "partial") partialSnapshots.push(noun);
    else if (k.truncated) out.add(`${noun} beyond the first ${k.record_count} shown.`);
    if (k.freshness === "stale") out.add(`The current state of ${noun}: the latest readings are stale.`);
    if (k.evidence_class === "cameras" && k.material.some(m => m.overall === "unknown")) out.add("Whether any camera is working or offline: unknown camera state is unobservable, not an outage and not normal operation.");
    if (k.evidence_class === "device_availability" && k.unobserved) out.add("The current state of devices that have no observation yet.");
    if (k.source_key === "corporate.opportunity.read" && k.record_count) out.add("The accuracy of the details you described: they are your own statements and are not verified.");
    if (k.provenance.length) out.add("Governed public guidance is approved content, not a verified current fact about your situation.");
    if (k.degraded.length) out.add(`${noun}: part of this source could not be read (${k.degraded.join(", ")}).`);
  }
  if (partialSnapshots.length) out.add(`The full set behind ${partialSnapshots.join(", ")}: each is a bounded, supplied view, not the whole population.`);
  if (plan.notes.includes("requested_building_scope_not_certified_estate_read_only")) out.add("Anything specific to the named building: only estate-level records were read; a building label is not a verified building scope.");
  if (plan.unresolved.some(u => u.reason === "room_unresolved")) out.add("The named room: it could not be identified, so no room-level or whole-home substitute was read.");
  if (plan.unresolved.some(u => u.reason === "not_authorised")) out.add("Sources I am not currently permitted to read on this surface.");
  return [...out];
}

export function buildState(args: {
  plan: EvidencePlan; contributions: Contribution[]; limits: PlannerLimits; gatheredAt: number; latency_ms: number; reusedKeys: Set<string>;
  input_fingerprint: string | null; material_hash: string | null; invalidation: string[]; planned: number;
}): CompactEvidencePlanState {
  const { plan, contributions, limits } = args;
  const classes = classOutcomes(plan, contributions);
  const attempted = contributions.filter(c => !args.reusedKeys.has(c.source_key));
  const usableFresh = contributions.filter(c => c.availability === "available").map(c => Date.parse(c.fresh_until));
  return {
    v: 1, plan_id: plan.plan_id, gathered_at: new Date(args.gatheredAt).toISOString(),
    expires_at: new Date(usableFresh.length ? Math.min(...usableFresh) : args.gatheredAt).toISOString(),
    scope_key: plan.scope_key, subject_key: plan.subject_key, input_fingerprint: args.input_fingerprint, material_hash: args.material_hash,
    objective: plan.objective, surface: plan.surface, status: planStatus(classes), classes, contributions,
    missing_mandatory: classes.filter(c => c.necessity === "mandatory" && ["MANDATORY_MISSING_CAPABILITY", "MANDATORY_UNAVAILABLE"].includes(c.status)).map(c => c.class),
    optional_unavailable: classes.filter(c => c.status === "OPTIONAL_UNAVAILABLE").map(c => c.class),
    cannot_conclude: cannotConclude(plan, classes, contributions),
    requested_not_honoured: plan.notes.filter(n => n.startsWith("requested_")),
    limits: { ...limits },
    stats: {
      sources_planned: args.planned, sources_attempted: attempted.length, sources_reused: args.reusedKeys.size,
      success: attempted.filter(c => ["available_complete", "available_zero"].includes(c.status)).length,
      partial: attempted.filter(c => ["available_partial", "stale"].includes(c.status)).length,
      error: attempted.filter(c => c.status === "error" || (c.availability === "unavailable")).length,
      denied: attempted.filter(c => c.availability === "denied" || c.availability === "unsupported_scope").length,
      timeout: attempted.filter(c => c.status === "timeout").length, latency_ms: args.latency_ms,
    },
    invalidation: args.invalidation,
  };
}

// Persisted state must stay compact. If an unusually rich bundle exceeds the budget, the optional
// material projection is dropped first (refs, counts and statuses are always kept).
export function enforceStateSize(state: CompactEvidencePlanState, maxBytes = 20_000): CompactEvidencePlanState {
  if (JSON.stringify(state).length <= maxBytes) return state;
  const slim = { ...state, contributions: state.contributions.map(c => ({ ...c, material: [] as Contribution["material"] })) };
  return JSON.stringify(slim).length <= maxBytes ? slim : { ...slim, contributions: slim.contributions.map(c => ({ ...c, refs: c.refs.slice(0, 3) })) };
}
