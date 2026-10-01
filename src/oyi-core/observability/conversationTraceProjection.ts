// Intelligence System Visibility, Slice 7 -- durable canonical trace
// PROJECTION CONTRACT.
//
// One canonical conversational turn -> one sanitized, structural record.
// This module is the ONLY place that decides what a durable trace may
// contain. Nothing is ever spread from tracer/logger payloads: every
// persisted field is named in TRACE_FIELD_CLASSIFICATION and produced by
// an explicit, validated extraction below. Free-form values that could
// carry user/private content (prompts, replies, labels, target/actor/home
// IDs, evidence, error messages) are never read into the projection.
//
// Validation is structural, not cosmetic:
//   - enums are checked against closed vocabularies;
//   - descriptive tokens (domain/operation/target class) must match a
//     short lowercase identifier grammar (no spaces, '@', digits-only
//     IDs, punctuation) -- user text cannot pass;
//   - capability keys must be REGISTERED capability keys;
//   - lineage references must be UUIDs;
//   - thread correlation is a keyed one-way hash, never the thread id.
import { createHmac, randomUUID } from "node:crypto";
import { capabilityRegistry } from "../capabilities/CapabilityRegistry";
import { LEGACY_ROLE_ALIASES, PLATFORM_ROLES } from "../../core/foundation/permissions";
import type { ConversationTraceStage } from "./ConversationTracer";

export const TRACE_RETENTION_DAYS_DEFAULT = 30;
export function traceRetentionDays(): number {
  const raw = Number(process.env.OYI_TRACE_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 1 && raw <= 365 ? Math.floor(raw) : TRACE_RETENTION_DAYS_DEFAULT;
}

// Stages the canonical runtime genuinely emits today (audited). Declared-
// but-never-emitted tracer stages (context_loaded, action_created,
// execution_started, verification_completed, legacy_fallback_used) are
// deliberately absent: they are never fabricated.
export const OBSERVED_TRACE_STAGES = [
  "request_received",
  "turn_normalized",
  "workflow_restored",
  "turn_resolved",
  "authority_decided",
  "capability_selected",
  "canonical_terminal_response",
  "evidence_planned",
  "evidence_loaded",
  "response_composed",
  "persistence_completed",
  "response_sent",
] as const satisfies readonly ConversationTraceStage[];
export type ObservedTraceStage = (typeof OBSERVED_TRACE_STAGES)[number];

// Mirrors OyiDomain (runtime/languageUnderstanding.ts) and SemanticOperation
// (contracts/semanticFrame.ts) plus the orchestrator's explicit frame
// override "automation.suggest"; static smoke guards fail on drift.
export const TRACE_DOMAINS = ["global", "home", "rooms", "devices", "visitors", "access", "security", "maintenance", "wallet", "transactions", "utilities", "services", "community", "messages", "scenes", "automations", "reports", "cameras", "notifications", "incidents", "crm", "office_reports", "office_development", "office_financial", "office_tasks", "office_meetings", "office_support", "office_portfolio", "office_documents", "office_content", "corporate_company", "corporate_development", "corporate_oyi", "corporate_private", "corporate_partnerships", "corporate_opportunity", "digital_twin"] as const;
export const TRACE_OPERATIONS = ["memory.recall", "plan.review", "inform", "summarize", "list", "inspect", "navigate", "compose", "clarify", "approve", "reject", "cancel", "device.power.on", "device.power.off", "device.availability", "device.status", "device.activity", "device.failures", "device.diagnosis", "device.relationships", "wallet.history", "utilities.spending", "utilities.active", "utilities.usage", "utilities.balance", "utilities.meter", "automation.suggest"] as const;
export const TRACE_SURFACES = ["consumer", "facility", "office", "watch", "edge", "public_corporate", "office_internal"] as const;
export const TRACE_WORKERS = ["consumer", "facility", "oma", "osa", "other"] as const;
export const TRACE_ACTOR_CLASSES = ["resident", "staff", "admin", "system", "anonymous", "unknown"] as const;
// Wave 11 resolution outcomes (docs/WAVE11_INTENT_CAPABILITY_MATRIX.md).
export const TRACE_RESOLUTION_OUTCOMES = ["matched", "declared_disabled", "permission_restricted", "scope_restricted", "surface_restricted", "no_match"] as const;
// Canonical terminal taxonomy at the projection boundary.
export const TRACE_TERMINAL_OUTCOMES = [
  "capability_response", // a governed capability answered (read/workflow/proposal)
  "governed_continuation", // resolved before capability selection: confirmation, cancellation, workflow continuation, follow-up, Office action/communication/goal proposal
  "canonical_unsupported",
  "capability_no_match",
  "business_surface_fallback",
  "declared_disabled",
  "authority_denied",
  "runtime_error",
] as const;
export const TRACE_ROLLOUT_STATUSES = ["declared", "implemented", "adapter_ready", "integration_tested", "shadow", "enabled", "disabled"] as const;
export const TRACE_TARGET_SOURCES = ["active_workflow", "current_turn", "current_scope", "valid_reference", "page_context", "thread_memory", "none"] as const;
export const TRACE_RESPONSE_STATUSES = ["returned", "returned_unsaved", "failed"] as const;

// Every persisted column, classified. EXCLUDED lists what is deliberately
// never read into the projection (with the reason), so the boundary is
// reviewable in one place. The projection smoke asserts that the record's
// keys are exactly the non-excluded set.
export const TRACE_FIELD_CLASSIFICATION = {
  trace_id: "DERIVED_SAFELY", // random UUID per turn
  turn_ref: "DERIVED_SAFELY", // one-way hash of the tracer request id
  thread_ref: "DERIVED_SAFELY", // keyed one-way hash of the thread id
  surface: "AVAILABLE_NOW",
  worker: "DERIVED_SAFELY", // surface -> worker
  actor_class: "DERIVED_SAFELY", // role -> class, never identity
  domain: "AVAILABLE_NOW",
  operation: "AVAILABLE_NOW",
  mutation_intent: "AVAILABLE_NOW",
  target_class: "AVAILABLE_NOW",
  target_resolution_source: "AVAILABLE_NOW",
  resolution_outcome: "AVAILABLE_NOW",
  capability_key: "AVAILABLE_NOW",
  capability_rollout: "AVAILABLE_NOW",
  authority_result: "AVAILABLE_NOW",
  authority_tier: "AVAILABLE_NOW",
  authority_denial_reason: "AVAILABLE_NOW",
  evidence_planned: "DERIVED_SAFELY", // stage observed
  evidence_count: "AVAILABLE_NOW",
  workflow_restored: "DERIVED_SAFELY", // restore stage status != not_restored
  workflow_state: "AVAILABLE_NOW",
  execution_state: "AVAILABLE_NOW",
  confirmation_required: "DERIVED_SAFELY",
  terminal_outcome: "DERIVED_SAFELY", // Wave 11 taxonomy translation
  compatibility_label_seen: "DERIVED_SAFELY", // old "legacy" tracer label observed (compat telemetry only)
  response_status: "DERIVED_SAFELY",
  persistence_saved: "AVAILABLE_NOW",
  error_class: "DERIVED_SAFELY", // closed class name only, never message/stack
  lineage: "DERIVED_SAFELY", // UUID references only
  stages: "DERIVED_SAFELY", // observed stage names + timings only
  started_at: "AVAILABLE_NOW",
  completed_at: "AVAILABLE_NOW",
  total_latency_ms: "AVAILABLE_NOW",
  expires_at: "DERIVED_SAFELY", // started_at + retention
} as const;

export const TRACE_EXCLUDED_FIELDS = {
  message: "raw user prompt",
  reply: "assistant response text (also answer/summary/message)",
  system_prompt: "system/hidden instructions",
  thread_id: "raw thread id (replaced by thread_ref)",
  request_id: "raw request id, may be caller-supplied (replaced by turn_ref)",
  actor_id: "actor identity",
  estate_id: "estate scope identifier",
  home_id: "home/unit identifier",
  target_id: "device/record identifier (target canonical_id)",
  target_label: "device/person/record name",
  channel_code: "device channel identifier",
  evidence: "raw evidence records and facts",
  context: "raw conversational/business context",
  memory: "memory contents",
  knowledge: "knowledge item content",
  communication: "message bodies and recipients",
  error_message: "exception messages and stacks",
  credentials: "tokens and keys",
} as const;

export type ConversationTraceRecord = {
  trace_id: string;
  turn_ref: string | null;
  thread_ref: string | null;
  surface: string;
  worker: string;
  actor_class: string;
  domain: string | null;
  operation: string | null;
  mutation_intent: boolean | null;
  target_class: string | null;
  target_resolution_source: string | null;
  resolution_outcome: string | null;
  capability_key: string | null;
  capability_rollout: string | null;
  authority_result: "allowed" | "denied" | null;
  authority_tier: number | null;
  authority_denial_reason: string | null;
  evidence_planned: boolean;
  evidence_count: number | null;
  workflow_restored: boolean;
  workflow_state: string | null;
  execution_state: string | null;
  confirmation_required: boolean;
  terminal_outcome: string;
  compatibility_label_seen: boolean;
  response_status: string;
  persistence_saved: boolean | null;
  error_class: string | null;
  lineage: Record<string, string>;
  stages: Array<{ stage: ObservedTraceStage; offset_ms: number; duration_ms: number }>;
  started_at: string;
  completed_at: string;
  total_latency_ms: number;
  expires_at: string;
};

// A stage event as captured by ConversationTracer. `fields` are already
// reduced to TRACE_STAGE_FIELD_ALLOWLIST scalars by the tracer.
export type TraceStageEvent = { stage: string; at: number; duration_ms: number; fields: Record<string, string | number | boolean | null> };

// Metadata keys the tracer may retain from a stage call (scalars only).
// Anything else -- thread_id, labels, ids -- is dropped at capture time.
export const TRACE_STAGE_FIELD_ALLOWLIST = [
  "surface",
  "domain",
  "operation",
  "mutation_intent",
  "status",
  "capability_key",
  "target_type",
  "target_source",
  "authority_result",
  "tier",
  "rollout_status",
  "resolution_outcome",
  "authority_allowed",
  "authority_reason",
  "outcome",
  "evidence_count",
  "persistence_saved",
] as const;

const TOKEN = /^[a-z][a-z0-9_]{0,47}(\.[a-z][a-z0-9_]{0,47}){0,4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pickTraceFields(metadata: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of TRACE_STAGE_FIELD_ALLOWLIST) {
    if (!(key in metadata)) continue;
    const value = metadata[key];
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) out[key] = value as any;
    else if (typeof value === "string" && value.length <= 96) out[key] = value;
  }
  return out;
}

export function safeToken(value: unknown): string | null {
  return typeof value === "string" && TOKEN.test(value) ? value : null;
}
function oneOf<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T[number]) : null;
}
function safeUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}
function registeredCapability(value: unknown): string | null {
  const key = safeToken(value);
  return key && capabilityRegistry.get(key) ? key : null;
}
function boolish(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

// Keyed one-way pseudonymization. OYI_TRACE_REFERENCE_KEY is REQUIRED
// (>= TRACE_REFERENCE_KEY_MIN_LENGTH chars); there is deliberately no
// unkeyed fallback -- an unkeyed deterministic hash of a thread id would
// be linkable by anyone already holding that id. Without a key, no
// reference can be produced and the recorder does not persist traces.
export const TRACE_REFERENCE_KEY_MIN_LENGTH = 32;
export function traceReferenceKeyConfigured(): boolean {
  const key = process.env.OYI_TRACE_REFERENCE_KEY;
  return typeof key === "string" && key.length >= TRACE_REFERENCE_KEY_MIN_LENGTH;
}
export class TraceReferenceKeyUnavailableError extends Error {
  constructor() {
    super("trace_reference_key_unavailable");
    this.name = "TraceReferenceKeyUnavailableError";
  }
}
export function opaqueReference(kind: "thread" | "turn", raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  if (!traceReferenceKeyConfigured()) throw new TraceReferenceKeyUnavailableError();
  const digest = createHmac("sha256", process.env.OYI_TRACE_REFERENCE_KEY as string).update(`${kind}:${raw}`).digest("hex");
  return `${kind === "thread" ? "th" : "tu"}_${digest.slice(0, 20)}`;
}

export function workerForSurface(surface: string | null): (typeof TRACE_WORKERS)[number] {
  if (surface === "consumer") return "consumer";
  if (surface === "facility") return "facility";
  if (surface === "office_internal") return "oma";
  if (surface === "public_corporate") return "osa";
  return "other";
}

// Role -> class through the canonical platform role vocabulary
// (core/foundation/permissions.ts PLATFORM_ROLES + LEGACY_ROLE_ALIASES).
const ROLE_CLASS: Record<string, (typeof TRACE_ACTOR_CLASSES)[number]> = {
  super_admin: "admin",
  ochiga_admin: "admin",
  estate_admin: "admin",
  ochiga_staff: "staff",
  facility_manager: "staff",
  security_operator: "staff",
  maintenance_operator: "staff",
  finance_operator: "staff",
  resident: "resident",
  guest: "anonymous",
  ai_agent: "system",
};
export function actorClassFor(actor: { role?: unknown } | null | undefined): (typeof TRACE_ACTOR_CLASSES)[number] {
  if (!actor) return "anonymous";
  const raw = typeof actor.role === "string" ? actor.role : "";
  const role = (PLATFORM_ROLES as readonly string[]).includes(raw) ? raw : LEGACY_ROLE_ALIASES[raw] || "";
  return ROLE_CLASS[role] || "unknown";
}

// Error class only: a bare constructor-style name. Messages/stacks are
// never read.
export function safeErrorClass(error: unknown): string | null {
  if (!error) return null;
  const name = error instanceof Error ? error.name : typeof error === "object" && error && typeof (error as any).name === "string" ? (error as any).name : "";
  return /^[A-Z][A-Za-z]{0,39}$/.test(name) ? name : "Error";
}

export type TraceProjectionInput = {
  events: TraceStageEvent[];
  startedAt: number;
  completedAt: number;
  requestId: string | null;
  surface: unknown;
  threadId: unknown;
  actor: { role?: unknown } | null | undefined;
  response: Record<string, any> | null;
  error: unknown;
};

function lastField(events: TraceStageEvent[], stage: string, key: string): string | number | boolean | null | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].stage === stage && key in events[i].fields) return events[i].fields[key];
  }
  return undefined;
}
function hasStage(events: TraceStageEvent[], stage: string) {
  return events.some((e) => e.stage === stage);
}

export function projectConversationTrace(input: TraceProjectionInput): ConversationTraceRecord {
  const ev = input.events;
  const response = input.response && typeof input.response === "object" ? input.response : null;
  const execution = response && typeof response.execution === "object" && response.execution ? response.execution : {};
  const surface = oneOf(input.surface, TRACE_SURFACES) || "other";

  const domain = oneOf(lastField(ev, "turn_resolved", "domain") ?? lastField(ev, "turn_normalized", "domain"), TRACE_DOMAINS);
  const operation = oneOf(lastField(ev, "turn_resolved", "operation") ?? lastField(ev, "turn_normalized", "operation"), TRACE_OPERATIONS);
  const resolution = oneOf(lastField(ev, "capability_selected", "resolution_outcome"), TRACE_RESOLUTION_OUTCOMES);
  const rawCapability = lastField(ev, "capability_selected", "capability_key") ?? lastField(ev, "turn_resolved", "capability_key");
  const compatibilityLabelSeen = rawCapability === "legacy" || lastField(ev, "capability_selected", "rollout_status") === "legacy_fallback";
  const capabilityKey = registeredCapability(rawCapability);
  const terminalStageOutcome = lastField(ev, "canonical_terminal_response", "outcome");

  // Authority: capability-level decision when one was made, else the
  // turn-level authority decision.
  const capAllowed = boolish(lastField(ev, "capability_selected", "authority_allowed"));
  const turnAuthority = lastField(ev, "authority_decided", "authority_result");
  const authorityResult: "allowed" | "denied" | null = capAllowed === true ? "allowed" : capAllowed === false ? "denied" : turnAuthority === "allowed" || turnAuthority === "denied" ? (turnAuthority as any) : null;
  const tierRaw = lastField(ev, "authority_decided", "tier");
  const authorityTier = typeof tierRaw === "number" && Number.isInteger(tierRaw) && tierRaw >= 0 && tierRaw <= 4 ? tierRaw : null;
  const denialReason = authorityResult === "denied" ? safeToken(lastField(ev, "capability_selected", "authority_reason")) : null;

  let terminal: (typeof TRACE_TERMINAL_OUTCOMES)[number];
  if (input.error) terminal = "runtime_error";
  else if (terminalStageOutcome === "business_surface_fallback" || terminalStageOutcome === "capability_no_match" || terminalStageOutcome === "canonical_unsupported") terminal = terminalStageOutcome;
  else if (resolution === "permission_restricted" || resolution === "scope_restricted" || (resolution === "surface_restricted" && authorityResult === "denied")) terminal = "authority_denied";
  else if (resolution === "declared_disabled") terminal = "declared_disabled";
  else if (resolution === "no_match") terminal = "capability_no_match";
  else if (hasStage(ev, "capability_selected") && capabilityKey) terminal = authorityResult === "denied" ? "authority_denied" : "capability_response";
  else terminal = "governed_continuation";

  const persistenceRaw = response ? response.persistence_saved : undefined;
  const persistenceSaved = input.error ? null : persistenceRaw === false ? false : response ? true : null;
  const responseStatus: (typeof TRACE_RESPONSE_STATUSES)[number] = input.error ? "failed" : persistenceSaved === false ? "returned_unsaved" : "returned";

  const workflowStatus = lastField(ev, "workflow_restored", "status");
  const executionWorkflow = execution.workflow && typeof execution.workflow === "object" ? execution.workflow : {};
  const lineage: Record<string, string> = {};
  for (const key of ["workflow_id", "action_id", "goal_id", "decision_id", "communication_id", "proposal_id"]) {
    const id = safeUuid(execution[key] ?? (executionWorkflow as any)[key]);
    if (id) lineage[key] = id;
  }
  const evidenceCountRaw = lastField(ev, "evidence_loaded", "evidence_count");

  const started = input.startedAt;
  const stages = ev
    .filter((e) => (OBSERVED_TRACE_STAGES as readonly string[]).includes(e.stage))
    .map((e) => ({ stage: e.stage as ObservedTraceStage, offset_ms: Math.max(0, e.at - started), duration_ms: Math.max(0, Math.round(e.duration_ms)) }));

  return {
    trace_id: randomUUID(),
    turn_ref: opaqueReference("turn", input.requestId),
    thread_ref: opaqueReference("thread", input.threadId ?? (response ? response.thread_id : null)),
    surface,
    worker: workerForSurface(surface),
    actor_class: actorClassFor(input.actor),
    domain,
    operation,
    mutation_intent: boolish(lastField(ev, "turn_normalized", "mutation_intent")),
    target_class: safeToken(lastField(ev, "turn_resolved", "target_type")),
    target_resolution_source: oneOf(lastField(ev, "turn_resolved", "target_source"), TRACE_TARGET_SOURCES),
    resolution_outcome: resolution,
    capability_key: capabilityKey,
    capability_rollout: capabilityKey ? oneOf(lastField(ev, "capability_selected", "rollout_status"), TRACE_ROLLOUT_STATUSES) : null,
    authority_result: authorityResult,
    authority_tier: authorityTier,
    authority_denial_reason: denialReason,
    evidence_planned: hasStage(ev, "evidence_planned"),
    evidence_count: typeof evidenceCountRaw === "number" && Number.isInteger(evidenceCountRaw) && evidenceCountRaw >= 0 ? evidenceCountRaw : null,
    workflow_restored: typeof workflowStatus === "string" && workflowStatus !== "not_restored",
    workflow_state: safeToken((executionWorkflow as any).status) || (typeof workflowStatus === "string" && workflowStatus !== "not_restored" ? safeToken(workflowStatus) : null),
    execution_state: safeToken(execution.status),
    confirmation_required: execution.status === "pending_confirmation" || execution.status === "awaiting_confirmation",
    terminal_outcome: terminal,
    compatibility_label_seen: compatibilityLabelSeen,
    response_status: responseStatus,
    persistence_saved: persistenceSaved,
    error_class: input.error ? safeErrorClass(input.error) : null,
    lineage,
    stages,
    started_at: new Date(started).toISOString(),
    completed_at: new Date(input.completedAt).toISOString(),
    total_latency_ms: Math.max(0, input.completedAt - started),
    expires_at: new Date(started + traceRetentionDays() * 86_400_000).toISOString(),
  };
}
