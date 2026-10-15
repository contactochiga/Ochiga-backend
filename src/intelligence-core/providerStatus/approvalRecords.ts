// Provider approval-record ledger: types and strict validation (Settings S5 Backend contract).
// The ledger is the ONLY source the provider-status projection reads. It is deliberately NOT derived from historical documentation, environment variables, the offline
// IQ-11F adapter registry, or any live provider call: none of those can prove current qualification, credentials, funding or data-processing approval.
// Records are immutable, versioned facts ("who approved/observed what, when, from which source"). A change is a new record (optionally superseding earlier ones), made
// through code review; nothing in this module or the endpoint can write one.

export const PROVIDER_LEDGER_VERSION = 1 as const;
export const PROVIDER_IDS = ["openai", "gemini", "anthropic"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type RecordSource = {
  type: "user_instruction" | "checkpoint_artifact" | "approval_register";
  ref: string; // e.g. "codex/intelligence-quality-v1@ecc53e7:artifacts/…json"
  note?: string;
};

type Base = {
  id: string;
  ledger_version: typeof PROVIDER_LEDGER_VERSION;
  recorded_at: string; // ISO-8601, when the underlying fact was recorded at its source
  recorded_by: string;
  source: RecordSource;
  supersedes?: string[];
};

export type GatewayStateRecord = Base & {
  kind: "gateway_state";
  status: "offline_design_only" | "shadow" | "live";
  live_transport_implemented: boolean;
  paid_inference_enabled: boolean;
  cross_provider_fallback: "disabled" | "enabled";
  approved_cross_provider_transfers: string[];
  /** Gateway-level figure recorded at the time (a different statement from a provider-specific authorization). */
  authorized_spend_usd: number | null;
  multi_provider_budget_approved: boolean;
  adapters: Array<{ provider: ProviderId; registered: boolean; protocol: "responses" | "messages" | "generateContent-compatibility-profile"; mode: "offline_mock_only" | "shadow" | "live" }>;
  /** Providers for which an approved credential reference is recorded (the reference itself is never stored here). */
  credential_references_recorded: ProviderId[];
};

export type BudgetAuthorizationRecord = Base & {
  kind: "budget_authorization";
  provider: ProviderId;
  currency: "USD";
  maximum_cumulative: number; // an approved ceiling. NOT funding, NOT a balance, NOT spend.
  synthetic_only: boolean;
  shadow_only: boolean;
  production_adoption: boolean;
  conditions: string[];
  candidate_models: string[];
};

export type ObservationRecord = Base & {
  kind: "observation";
  provider: ProviderId;
  scope: string; // exactly what was checked; absence in this scope proves nothing outside it
  valid_for_hours: number;
  facts: {
    credentials: "not_found_in_scope" | "provisioned_unverified" | "verified" | "unknown";
    billing: "verified" | "not_verified";
    model_access: "verified" | "not_verified";
    data_controls: "verified" | "not_verified";
    verified_credits_usd: number | null; // only meaningful when billing === "verified"
    verified_spend_usd: number | null; // only meaningful when billing === "verified"
    authenticated_requests: number | null;
    paid_inference_calls: number | null;
  };
  limitations: string[];
};

export type ProviderStateRecord = Base & {
  kind: "provider_state";
  provider: ProviderId;
  qualification_status?: "not_started" | "preparation" | "in_progress" | "qualified" | "failed";
  qualification_scope?: string;
  data_processing_status?: "not_reviewed" | "pending" | "approved" | "rejected";
  model_status?: "none_selected" | "candidate" | "approved";
  approved_model?: string | null;
  operating_mode?: "off" | "offline_mock_only" | "shadow" | "live";
  budget_enforcement?: "none" | "designed" | "tested" | "verified";
  limitations?: string[];
};

export type ApprovalRecord = GatewayStateRecord | BudgetAuthorizationRecord | ObservationRecord | ProviderStateRecord;

const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{10,}|Bearer\s+\S{8,}|-----BEGIN|\b(?![0-9a-f]{40}\b)[A-Za-z0-9+/]{40,}\b)/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const KINDS = new Set(["gateway_state", "budget_authorization", "observation", "provider_state"]);
const oneOf = (v: unknown, allowed: readonly string[]) => typeof v === "string" && allowed.includes(v);
const isIso = (v: unknown) => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v));
const isProvider = (v: unknown): v is ProviderId => typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);
const isMoney = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9;
const isStr = (v: unknown, max = 300) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !SECRET_VALUE.test(v);
const isStrList = (v: unknown, max = 12) => Array.isArray(v) && v.length <= max && v.every((x) => isStr(x));

export type ValidationResult = { ok: true; record: ApprovalRecord } | { ok: false; id: string; reason: string };

/** Strict allowlisting validator: returns a rebuilt record containing only known fields, or a reason it was rejected. */
export function validateApprovalRecord(input: unknown): ValidationResult {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const id = typeof raw.id === "string" ? raw.id.slice(0, 80) : "(no id)";
  const fail = (reason: string): ValidationResult => ({ ok: false, id, reason });
  if (!isStr(raw.id, 80)) return fail("missing_or_invalid_id");
  if (raw.ledger_version !== PROVIDER_LEDGER_VERSION) return fail("unsupported_ledger_version");
  if (!KINDS.has(raw.kind)) return fail("unknown_record_kind");
  if (!isIso(raw.recorded_at)) return fail("invalid_recorded_at");
  if (!isStr(raw.recorded_by, 120)) return fail("missing_recorded_by");
  const s = raw.source;
  if (!s || typeof s !== "object" || !oneOf(s.type, ["user_instruction", "checkpoint_artifact", "approval_register"]) || !isStr(s.ref, 200) || (s.note !== undefined && !isStr(s.note, 300))) return fail("missing_or_invalid_source");
  if (raw.supersedes !== undefined && !(Array.isArray(raw.supersedes) && raw.supersedes.length <= 12 && raw.supersedes.every((x: unknown) => isStr(x, 80)))) return fail("invalid_supersedes");
  const base = { id: raw.id as string, ledger_version: PROVIDER_LEDGER_VERSION, recorded_at: raw.recorded_at as string, recorded_by: raw.recorded_by as string, source: { type: s.type, ref: s.ref, ...(s.note ? { note: s.note } : {}) } as RecordSource, ...(raw.supersedes ? { supersedes: [...raw.supersedes] as string[] } : {}) };

  if (raw.kind === "gateway_state") {
    if (!oneOf(raw.status, ["offline_design_only", "shadow", "live"])) return fail("invalid_gateway_status");
    if (typeof raw.live_transport_implemented !== "boolean" || typeof raw.paid_inference_enabled !== "boolean" || typeof raw.multi_provider_budget_approved !== "boolean") return fail("invalid_gateway_flags");
    if (!oneOf(raw.cross_provider_fallback, ["disabled", "enabled"])) return fail("invalid_fallback");
    if (!isStrList(raw.approved_cross_provider_transfers, 6)) return fail("invalid_transfers");
    if (!(raw.authorized_spend_usd === null || isMoney(raw.authorized_spend_usd))) return fail("invalid_authorized_spend");
    if (!Array.isArray(raw.adapters) || raw.adapters.length > 6) return fail("invalid_adapters");
    for (const a of raw.adapters) if (!a || !isProvider(a.provider) || typeof a.registered !== "boolean" || !oneOf(a.protocol, ["responses", "messages", "generateContent-compatibility-profile"]) || !oneOf(a.mode, ["offline_mock_only", "shadow", "live"])) return fail("invalid_adapter_entry");
    if (!Array.isArray(raw.credential_references_recorded) || !raw.credential_references_recorded.every(isProvider)) return fail("invalid_credential_reference_list");
    return { ok: true, record: { ...base, kind: "gateway_state", status: raw.status, live_transport_implemented: raw.live_transport_implemented, paid_inference_enabled: raw.paid_inference_enabled, cross_provider_fallback: raw.cross_provider_fallback, approved_cross_provider_transfers: [...raw.approved_cross_provider_transfers], authorized_spend_usd: raw.authorized_spend_usd, multi_provider_budget_approved: raw.multi_provider_budget_approved, adapters: raw.adapters.map((a: any) => ({ provider: a.provider, registered: a.registered, protocol: a.protocol, mode: a.mode })), credential_references_recorded: [...raw.credential_references_recorded] } };
  }
  if (!isProvider(raw.provider)) return fail("unknown_provider");
  if (raw.kind === "budget_authorization") {
    if (raw.currency !== "USD" || !isMoney(raw.maximum_cumulative)) return fail("invalid_budget_amount");
    if (typeof raw.synthetic_only !== "boolean" || typeof raw.shadow_only !== "boolean" || typeof raw.production_adoption !== "boolean") return fail("invalid_budget_scope");
    if (!isStrList(raw.conditions) || !isStrList(raw.candidate_models, 6)) return fail("invalid_budget_lists");
    return { ok: true, record: { ...base, kind: "budget_authorization", provider: raw.provider, currency: "USD", maximum_cumulative: raw.maximum_cumulative, synthetic_only: raw.synthetic_only, shadow_only: raw.shadow_only, production_adoption: raw.production_adoption, conditions: [...raw.conditions], candidate_models: [...raw.candidate_models] } };
  }
  if (raw.kind === "observation") {
    const f = raw.facts;
    if (!isStr(raw.scope, 300) || !(typeof raw.valid_for_hours === "number" && raw.valid_for_hours > 0 && raw.valid_for_hours <= 24 * 365)) return fail("invalid_observation_scope_or_validity");
    if (!f || typeof f !== "object" || !oneOf(f.credentials, ["not_found_in_scope", "provisioned_unverified", "verified", "unknown"]) || !oneOf(f.billing, ["verified", "not_verified"]) || !oneOf(f.model_access, ["verified", "not_verified"]) || !oneOf(f.data_controls, ["verified", "not_verified"])) return fail("invalid_observation_facts");
    for (const k of ["verified_credits_usd", "verified_spend_usd"]) if (!(f[k] === null || isMoney(f[k]))) return fail("invalid_observation_amount");
    for (const k of ["authenticated_requests", "paid_inference_calls"]) if (!(f[k] === null || (Number.isInteger(f[k]) && f[k] >= 0))) return fail("invalid_observation_counter");
    if ((f.verified_credits_usd !== null || f.verified_spend_usd !== null) && f.billing !== "verified") return fail("amounts_require_verified_billing");
    if (!isStrList(raw.limitations, 8)) return fail("invalid_limitations");
    return { ok: true, record: { ...base, kind: "observation", provider: raw.provider, scope: raw.scope, valid_for_hours: raw.valid_for_hours, facts: { credentials: f.credentials, billing: f.billing, model_access: f.model_access, data_controls: f.data_controls, verified_credits_usd: f.verified_credits_usd, verified_spend_usd: f.verified_spend_usd, authenticated_requests: f.authenticated_requests, paid_inference_calls: f.paid_inference_calls }, limitations: [...raw.limitations] } };
  }
  // provider_state
  const out: Record<string, any> = { ...base, kind: "provider_state", provider: raw.provider };
  if (raw.qualification_status !== undefined) { if (!oneOf(raw.qualification_status, ["not_started", "preparation", "in_progress", "qualified", "failed"])) return fail("invalid_qualification_status"); out.qualification_status = raw.qualification_status; }
  if (raw.qualification_scope !== undefined) { if (!isStr(raw.qualification_scope)) return fail("invalid_qualification_scope"); out.qualification_scope = raw.qualification_scope; }
  if (raw.data_processing_status !== undefined) { if (!oneOf(raw.data_processing_status, ["not_reviewed", "pending", "approved", "rejected"])) return fail("invalid_data_processing_status"); out.data_processing_status = raw.data_processing_status; }
  if (raw.model_status !== undefined) { if (!oneOf(raw.model_status, ["none_selected", "candidate", "approved"])) return fail("invalid_model_status"); out.model_status = raw.model_status; }
  if (raw.approved_model !== undefined) { if (!(raw.approved_model === null || isStr(raw.approved_model, 80))) return fail("invalid_approved_model"); out.approved_model = raw.approved_model; }
  if (raw.operating_mode !== undefined) { if (!oneOf(raw.operating_mode, ["off", "offline_mock_only", "shadow", "live"])) return fail("invalid_operating_mode"); out.operating_mode = raw.operating_mode; }
  if (raw.budget_enforcement !== undefined) { if (!oneOf(raw.budget_enforcement, ["none", "designed", "tested", "verified"])) return fail("invalid_budget_enforcement"); out.budget_enforcement = raw.budget_enforcement; }
  if (raw.limitations !== undefined) { if (!isStrList(raw.limitations, 8)) return fail("invalid_limitations"); out.limitations = [...raw.limitations]; }
  if (out.model_status === "approved" && !out.approved_model) return fail("approved_model_requires_a_model");
  return { ok: true, record: out as ProviderStateRecord };
}

export { SECRET_VALUE };
