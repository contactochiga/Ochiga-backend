// Provider-status projection (Settings S5 Backend contract). Pure function: ledger records in, strictly allowlisted response out. No I/O, no provider calls, no
// environment reads. Every value is either established by a (valid, non-superseded) approval record or it is unknown. See docs/PROVIDER_STATUS_CONTRACT.md.

import type { Request, Response } from "express";
import {
  PROVIDER_IDS,
  PROVIDER_LEDGER_VERSION,
  SECRET_VALUE,
  validateApprovalRecord,
  type ApprovalRecord,
  type BudgetAuthorizationRecord,
  type GatewayStateRecord,
  type ObservationRecord,
  type ProviderId,
  type ProviderStateRecord,
} from "./approvalRecords";

const MAX_LIMITATIONS = 8;
const t = (r: { recorded_at: string }) => Date.parse(r.recorded_at);
const newestFirst = <T extends { recorded_at: string; id: string }>(a: T, b: T) => t(b) - t(a) || a.id.localeCompare(b.id);
const iso = (v: string) => new Date(v).toISOString();

type Provenance = { group: string; source_record: string; recorded_at: string; conflicts: string[] };

function uniq<T>(xs: T[]) { return [...new Set(xs)]; }

/** Latest record(s) among candidates; `tied` is true when several records share the newest timestamp and disagree on `key`. */
function latestBy<T extends { recorded_at: string; id: string }>(candidates: T[], key: (r: T) => string): { record: T | null; tied: T[] } {
  if (!candidates.length) return { record: null, tied: [] };
  const sorted = [...candidates].sort(newestFirst);
  const top = t(sorted[0]);
  const atTop = sorted.filter((r) => t(r) === top);
  const distinct = uniq(atTop.map(key));
  return { record: sorted[0], tied: distinct.length > 1 ? atTop : [] };
}

export function projectProviderStatus(rawRecords: ReadonlyArray<unknown>, options: { now?: Date } = {}) {
  const now = options.now || new Date();
  const rejected: Array<{ id: string; reason: string }> = [];
  const valid: ApprovalRecord[] = [];
  const seenIds = new Set<string>();
  for (const raw of rawRecords) {
    const v = validateApprovalRecord(raw);
    if (!v.ok) { rejected.push({ id: v.id, reason: v.reason }); continue; }
    if (seenIds.has(v.record.id)) { rejected.push({ id: v.record.id, reason: "duplicate_record_id" }); continue; }
    seenIds.add(v.record.id);
    valid.push(v.record);
  }
  const superseded = new Set(valid.flatMap((r) => r.supersedes || []));
  const records = valid.filter((r) => !superseded.has(r.id));

  const provenance: Provenance[] = [];
  const gatewayRecords = records.filter((r): r is GatewayStateRecord => r.kind === "gateway_state");
  const gw = latestBy(gatewayRecords, (r) => JSON.stringify([r.status, r.live_transport_implemented, r.paid_inference_enabled, r.cross_provider_fallback, r.authorized_spend_usd]));
  const gateway: GatewayStateRecord | null = gw.tied.length ? null : gw.record;
  if (gw.tied.length) provenance.push({ group: "gateway", source_record: gw.tied.map((r) => r.id).join(", ").slice(0, 120), recorded_at: iso(gw.tied[0].recorded_at), conflicts: ["Gateway records with the same timestamp disagree; gateway state is unknown until a later record supersedes them"] });
  else if (gateway) provenance.push({ group: "gateway", source_record: gateway.id, recorded_at: iso(gateway.recorded_at), conflicts: [] });

  const providers = PROVIDER_IDS.map((id) => projectProvider(id, records, gateway, now, provenance));

  const newest = records.length ? iso([...records].sort(newestFirst)[0].recorded_at) : null;
  if (rejected.length) provenance.push({ group: "ledger", source_record: `${rejected.length} rejected record(s)`, recorded_at: now.toISOString(), conflicts: rejected.slice(0, 4).map((r) => `Record ${r.id} was not projected: ${r.reason}`) });
  const response = {
    ok: true,
    schema_version: 1,
    generated_at: now.toISOString(),
    source: { ledger_version: PROVIDER_LEDGER_VERSION, record_count: records.length, rejected_count: rejected.length, newest_record_at: newest },
    gateway: {
      status: gateway ? gateway.status : "unknown",
      live_transport_implemented: gateway ? gateway.live_transport_implemented : null,
      paid_inference_enabled: gateway ? gateway.paid_inference_enabled : null,
      cross_provider_fallback: gateway ? gateway.cross_provider_fallback : "unknown",
      approved_cross_provider_transfers: gateway ? gateway.approved_cross_provider_transfers : [],
      source_record: gateway ? { id: gateway.id, version: PROVIDER_LEDGER_VERSION, recorded_at: iso(gateway.recorded_at) } : null,
    },
    providers,
    provenance: provenance.slice(0, 12),
    rejected_records: rejected.slice(0, 20),
  };
  const scrubbed = scrubSecrets(response);
  return { ...(scrubbed.value as typeof response), redaction_applied: scrubbed.redactions };
}

function projectProvider(id: ProviderId, records: ApprovalRecord[], gateway: GatewayStateRecord | null, now: Date, provenance: Provenance[]) {
  const mine = <K extends ApprovalRecord["kind"]>(kind: K) => records.filter((r) => r.kind === kind && (r as { provider?: string }).provider === id) as Array<Extract<ApprovalRecord, { kind: K }>>;
  const limitations: string[] = [];
  const priority: string[] = []; // notes about missing, stale or conflicting evidence come first
  const states = mine("provider_state") as ProviderStateRecord[];
  const budgets = mine("budget_authorization") as BudgetAuthorizationRecord[];
  const observations = mine("observation") as ObservationRecord[];
  const adapter = gateway ? gateway.adapters.find((a) => a.provider === id) || null : null;
  if (!states.length && !budgets.length && !observations.length && !adapter) priority.push("No approval record exists for this provider");

  // field-wise latest value from provider_state records; ties that disagree => unknown + conflict
  const conflicts: string[] = [];
  const field = <K extends keyof ProviderStateRecord>(name: K): ProviderStateRecord[K] | undefined => {
    const withField = states.filter((s) => s[name] !== undefined);
    const { record, tied } = latestBy(withField, (s) => JSON.stringify(s[name]));
    if (tied.length) { conflicts.push(`Records ${tied.map((r) => r.id).join(", ")} disagree on ${String(name)} at the same time; treated as unknown`); return undefined; }
    return record ? record[name] : undefined;
  };
  const qualification = (field("qualification_status") as string | undefined) || "unknown";
  const dataProcessing = (field("data_processing_status") as string | undefined) || "unknown";
  const modelStatus = (field("model_status") as string | undefined) || "unknown";
  const approvedModel = (field("approved_model") as string | null | undefined) ?? null;
  const enforcement = (field("budget_enforcement") as string | undefined) || "unknown";
  const operatingMode = (field("operating_mode") as string | undefined) || (adapter ? adapter.mode : "unknown");
  const qualScope = (field("qualification_scope") as string | undefined) || null;
  const latestState = [...states].sort(newestFirst)[0];

  // budget: an approved ceiling is only ever a ceiling
  const authLatest = latestBy(budgets, (b) => String(b.maximum_cumulative));
  let approvedMaximum: number | null = null; let approvalRef: string | null = null; let approvedAt: string | null = null; let candidates: string[] = [];
  const budgetConflicts: string[] = [];
  if (authLatest.tied.length) budgetConflicts.push(`Unresolved: authorization records ${authLatest.tied.map((r) => `${r.id} (${r.maximum_cumulative})`).join(" and ")} disagree; the approved maximum is unknown`);
  else if (authLatest.record) { approvedMaximum = authLatest.record.maximum_cumulative; approvalRef = authLatest.record.id; approvedAt = iso(authLatest.record.recorded_at); candidates = authLatest.record.candidate_models.slice(0, 6); }
  const distinctAll = uniq(budgets.map((b) => b.maximum_cumulative));
  if (!authLatest.tied.length && distinctAll.length > 1) budgetConflicts.push(`Earlier authorization(s) recorded different maximums (${distinctAll.join(", ")}); the latest record is shown`);
  if (gateway && gateway.authorized_spend_usd !== null) {
    if (approvedMaximum !== null && gateway.authorized_spend_usd !== approvedMaximum) budgetConflicts.push(`Gateway record ${gateway.id} states authorized spend ${gateway.authorized_spend_usd}; provider authorization ${approvalRef} states a maximum of ${approvedMaximum}. Both are preserved; the provider-specific record is shown for this provider`);
    if (approvedMaximum === null && !authLatest.tied.length) priority.push(`Gateway record ${gateway.id} states authorized spend ${gateway.authorized_spend_usd}; no provider-specific authorization is recorded`);
  }
  if (budgets.length || budgetConflicts.length || (gateway && gateway.authorized_spend_usd !== null)) {
    provenance.push({ group: `${id}.budget`, source_record: uniq([...budgets.map((b) => b.id), ...(gateway ? [gateway.id] : [])]).join(", ").slice(0, 120), recorded_at: iso([...budgets, ...(gateway ? [gateway] : [])].sort(newestFirst)[0]?.recorded_at || now.toISOString()), conflicts: budgetConflicts });
  }
  conflicts.push(...budgetConflicts.filter((c) => c.startsWith("Unresolved")));

  // observation: evidence about credentials / billing; freshness enforced; absence in a scope is never "not provisioned"
  const obs = latestBy(observations, (o) => JSON.stringify(o.facts)).record;
  let credentials: "not_provisioned" | "provisioned_unverified" | "verified" | "unknown" = "unknown";
  let credentialsVerifiedAt: string | null = null; let verifiedCredits: number | null = null; let verifiedSpend: number | null = null; let creditsAt: string | null = null; let spendAt: string | null = null;
  let lastVerified: string | null = null; let stale = false;
  if (obs) {
    lastVerified = iso(obs.recorded_at);
    stale = now.getTime() > t(obs) + obs.valid_for_hours * 3_600_000;
    if (stale) priority.push(`The latest ${id} observation (${iso(obs.recorded_at)}) is older than its ${obs.valid_for_hours}-hour validity; its facts are treated as unknown`);
    else {
      if (obs.facts.credentials === "verified") { credentials = "verified"; credentialsVerifiedAt = iso(obs.recorded_at); }
      else if (obs.facts.credentials === "provisioned_unverified") credentials = "provisioned_unverified";
      if (obs.facts.billing === "verified") { verifiedCredits = obs.facts.verified_credits_usd; verifiedSpend = obs.facts.verified_spend_usd; if (verifiedCredits !== null) creditsAt = iso(obs.recorded_at); if (verifiedSpend !== null) spendAt = iso(obs.recorded_at); }
    }
    limitations.push(...obs.limitations);
    provenance.push({ group: `${id}.observation`, source_record: obs.id, recorded_at: iso(obs.recorded_at), conflicts: stale ? ["Stale observation"] : [] });
  }
  if (latestState) limitations.push(...(latestState.limitations || []));
  if (conflicts.length) priority.push(...conflicts);

  return {
    id,
    adapter: { registered: adapter ? adapter.registered : null, version: null, protocol: adapter ? adapter.protocol : null, mode: adapter ? adapter.mode : null },
    credentials: { status: credentials, verified_at: credentialsVerifiedAt, reference_recorded: gateway ? gateway.credential_references_recorded.includes(id) : null },
    model: { approved_model: modelStatus === "approved" ? approvedModel : null, candidates, status: modelStatus },
    qualification: { status: qualification, scope: qualScope, evidence_ref: latestState ? latestState.id : null, verified_at: null },
    operating_mode: operatingMode,
    budget: {
      currency: approvedMaximum !== null || verifiedCredits !== null || verifiedSpend !== null ? "USD" : null,
      approved_maximum: approvedMaximum, approval_ref: approvalRef, approved_at: approvedAt,
      verified_credits: verifiedCredits, credits_verified_at: creditsAt, verified_spend: verifiedSpend, spend_verified_at: spendAt,
      enforcement: { status: enforcement },
    },
    data_processing: { status: dataProcessing, reviewed_at: null, approval_ref: null },
    // This Backend defines no activation contract and activates nothing; these are facts about the code, not ledger claims.
    activation: { contract_available: false, activated: false },
    last_verified_at: lastVerified,
    limitations: uniq([...priority, ...limitations]).slice(0, MAX_LIMITATIONS),
  };
}

/** Recursively drops secret-shaped strings (replaced by null) and reports how many were removed. Defence in depth: validation already refuses them. */
export function scrubSecrets(value: unknown): { value: unknown; redactions: number } {
  let redactions = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") { if (SECRET_VALUE.test(v)) { redactions += 1; return null; } return v; }
    if (Array.isArray(v)) return v.map(walk).filter((x) => x !== null);
    if (v && typeof v === "object") { const out: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x); return out; }
    return v;
  };
  return { value: walk(value), redactions };
}

/** Express handler factory. The route mounts it behind requireOfficeExportKey; tests inject their own record source. GET only; never reads the request body. */
export function createProviderStatusHandler(getRecords: () => ReadonlyArray<unknown>, getNow: () => Date = () => new Date()) {
  return (_req: Request, res: Response) => {
    try {
      res.setHeader("cache-control", "no-store");
      return res.json(projectProviderStatus(getRecords(), { now: getNow() }));
    } catch {
      return res.status(500).json({ ok: false, error: "Unable to project provider status" });
    }
  };
}
