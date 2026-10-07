import type { DomainResult } from "../contracts/domainResult";
import { conceptOf } from "../interpretation/conceptLexicon";
import { analyse } from "../interpretation/semanticObjective";
import type { Availability, CapabilityStatus, EnvelopeRecord, Limitation, ResultEnvelope } from "./resultEnvelope";

// IQ-8D thin family mappers. Each moves truth a capability already returned (typed blocks, `answer_rows`, `result_facts`) into the shared envelope.
// A mapper never reinterprets the user's wording, ranks, judges, queries another source, widens authority, writes data or generates prose.

type Family = { domain: string | null; object_class: string | null; noun: string; singular: string; population?: string; facets: string[]; total_qualifier?: string; requires_judgment?: boolean; permission_only?: boolean; aggregate_only?: boolean };
const F = (domain: string | null, object_class: string | null, noun: string, singular: string, facets: string[], extra: Partial<Family> = {}): Family => ({ domain, object_class, noun, singular, facets, ...extra });
const REGISTRY: Record<string, Family> = {
  "crm.leads.read": F("crm", "lead", "leads", "lead", ["status", "list"], { population: "needing attention", total_qualifier: "open", requires_judgment: true }),
  "crm.opportunities.read": F("crm", "opportunity", "opportunities", "opportunity", ["status", "list", "history"], { population: "that have gone stale", requires_judgment: true }),
  "reports.approvals.read": F("office_reports", "report", "reports awaiting approval", "report awaiting approval", ["status", "list"], { requires_judgment: true }),
  "development.status.read": F("office_development", "project", "development projects", "development project", ["status", "list"], { requires_judgment: true }),
  "office_tasks.query.read": F("office_tasks", "task", "tasks", "task", ["status", "list"]),
  "office_support.query.read": F("office_support", null, "support cases", "support case", ["status", "list"]),
  "office_meetings.query.read": F("office_meetings", null, "meetings", "meeting", ["status", "list"]),
  "office_portfolio.query.read": F("office_portfolio", null, "portfolio entries", "portfolio entry", ["status", "list"]),
  "office_documents.query.read": F("office_documents", "document", "documents", "document", ["list"]),
  "maintenance.requests.read": F("maintenance", "maintenance_request", "maintenance requests", "maintenance request", ["status", "list"]),
  "visitors.pending.read": F("visitors", "visitor", "visitor access records", "visitor access record", ["status", "list"], { permission_only: true }),
  "security.incidents.read": F("security", "incident", "security incidents", "security incident", ["status", "list"]),
  "wallet.transactions.read": F("wallet", "wallet", "wallet transactions", "wallet transaction", ["transactions", "list"]),
  "wallet.balance.read": F("wallet", "wallet", "wallet balance", "wallet balance", ["balance", "status"]),
  "devices.status.read": F("devices", "device", "devices", "device", ["status", "list"]),
  "devices.availability.read": F("devices", "device", "devices", "device", ["status", "list"]),
  "utilities.spending.read": F("utilities", "utility", "utility transactions", "utility transaction", ["spending", "transactions"]),
  "utilities.purchases.read": F("utilities", "utility", "utility purchases", "utility purchase", ["transactions"]),
  "utilities.usage.read": F("utilities", "utility", "utility usage", "utility usage", ["usage"]),
  "facility.cameras.read": F("cameras", "camera", "cameras", "camera", ["status"]),
  "facility.overview.read": F("facility", null, "open items", "open item", ["status", "list"]),
  "financial.summary.read": F("office_financial", null, "estate financial summaries", "estate financial summary", ["status", "balance"]),
  "corporate.opportunity.read": F("corporate_opportunity", null, "details you have shared", "detail you have shared", ["recall", "status"]),
};
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const stateOfStatus = (status: string | null | undefined): EnvelopeRecord["state"] => {
  const found = analyse(status || "").tokens.map(conceptOf).filter(Boolean);
  return (["resolved", "stale", "overdue", "open"] as const).find(c => found.includes(c)) ?? null;
};
const availabilityOf = (s: DomainResult["status"]): Availability | null =>
  s === "answered" ? "answered" : s === "empty" ? "empty" : s === "unavailable" ? "unavailable" : s === "unsupported" ? "unsupported" : s === "permission_restricted" ? "denied" : null;

function recordsFromBlock(b: Record<string, unknown> | undefined): EnvelopeRecord[] | undefined {
  if (!b || !Array.isArray(b.rows) || !(b.rows as unknown[]).length) return undefined;
  const cols = ((b.columns as Array<{ key: string }>) || []).map(c => c.key);
  const labelKey = ["name", "title", "visitor", "description", "device", "lead", "label"].find(k => cols.includes(k)) || cols[0];
  const statusKey = ["status", "state", "stage"].find(k => cols.includes(k));
  const detailKey = ["reason", "priority", "purpose", "owner", "amount"].find(k => cols.includes(k));
  return (b.rows as Array<Record<string, unknown>>).map(r => {
    const status = statusKey && r[statusKey] ? clean(r[statusKey]) : null, detail = detailKey && r[detailKey] ? clean(r[detailKey]) : null;
    const fields: Record<string, string | number | boolean | null> = {};
    for (const c of cols) { const v = r[c]; if (v === null || ["string", "number", "boolean"].includes(typeof v)) fields[c] = v as string | number | boolean | null; }
    return { id: r.id ? String(r.id) : null, label: clean(r[labelKey] ?? "item"), status, state: stateOfStatus(status), detail: detail && detail.length <= 60 ? detail : null, time: clean(r.due_at ?? r.date ?? r.last_observed_at ?? "") || null, fields };
  });
}

export function mapResultEnvelope(key: string, result: DomainResult, ctx: { capability_status: CapabilityStatus }): ResultEnvelope | null {
  const availability = availabilityOf(result.status); if (!availability) return null;
  const fam = REGISTRY[key];
  const block = (result.blocks || []).find(b => (b.type === "record_list" || b.type === "table") && Array.isArray(b.rows)) as Record<string, unknown> | undefined;
  const title = clean(block?.title).toLowerCase();
  const noun = fam?.noun ?? (title || "records"), singular = fam?.singular ?? noun.replace(/ies$/, "y").replace(/s$/, "");
  const meta = (result.metadata || {}) as Record<string, any>;
  const rows = meta.answer_rows?.rows as Array<{ label: string; status?: string; detail?: string }> | undefined;
  let records: EnvelopeRecord[] | undefined = rows ? rows.map(r => ({ label: clean(r.label), status: r.status ?? null, state: stateOfStatus(r.status), detail: r.detail ?? null })) : recordsFromBlock(block);
  const facts = (meta.result_facts || {}) as Record<string, any>;
  if (!records && Array.isArray(facts.records)) records = facts.records as EnvelopeRecord[];
  // structured per-record facts a capability already holds (activity age ...), merged by record id; never derived from prose
  const extras = (facts.record_extras || {}) as Record<string, { age_days?: number | null }>;
  if (records) records = records.map(r => (r.id && extras[r.id] ? { ...r, age_days: extras[r.id].age_days ?? null } : r));
  const ov = meta.overview_view as { maintenance: Array<{ label: string; status: string; priority?: string }>; incidents: Array<{ label: string; status: string }>; unavailable: string[] } | undefined;
  if (ov) records = [...ov.maintenance.map(m => ({ label: m.label, status: m.status, state: stateOfStatus(m.status) ?? "open" as const, detail: m.priority ? `${m.priority} priority` : null, fields: { kind: "maintenance request" } })), ...ov.incidents.map(i => ({ label: i.label, status: i.status, state: "open" as const, fields: { kind: "security incident" } }))];
  const limitations: Limitation[] = [];
  if (ov?.unavailable?.length) for (const d of new Set(ov.unavailable)) limitations.push({ kind: "UNAVAILABLE", label: String(d) });
  if (availability === "unsupported") limitations.push({ kind: ctx.capability_status === "declared" ? "MISSING_CAPABILITY" : "UNSUPPORTED_SCOPE", label: fam?.facets[0] === "usage" ? "consumption (usage) readings" : undefined });
  if (availability === "denied") limitations.push({ kind: "AUTHORITY_DENIED" });
  if (availability === "unavailable") limitations.push({ kind: "UNAVAILABLE" });
  if (ctx.capability_status === "declared" && availability !== "unsupported") limitations.push({ kind: "MISSING_CAPABILITY", label: fam?.facets[0] === "usage" ? "consumption (usage) readings" : undefined });
  if (Array.isArray(facts.limitations)) for (const l of facts.limitations as Limitation[]) limitations.push(l);
  const stateFacts = facts.state_facts as ResultEnvelope["state_facts"] | undefined;
  if (stateFacts?.unobserved) limitations.push({ kind: "UNOBSERVED", label: key === "facility.cameras.read" ? "camera state" : undefined });
  if (records && records.length && records.every(r => r.state === "stale")) limitations.push({ kind: "STALE" });
  const env: ResultEnvelope = {
    v: 1, capability_key: key, availability, capability_status: ctx.capability_status, truth_state: availability === "answered" ? "observed" : availability === "empty" ? "confirmed" : availability,
    subject: { domain: fam?.domain ?? null, object_class: fam?.object_class ?? null, noun, singular, population: fam?.population ?? (/^(overdue|stale|open|pending|expired)\b/i.exec(title)?.[1] ? `that are ${/^(overdue|stale|open|pending|expired)\b/i.exec(title)![1].toLowerCase()}` : null), facets: fam?.facets ?? ["list"] },
    ...(records ? { records, count: records.length } : availability === "empty" ? { records: [], count: 0 } : {}),
    ...(typeof block?.total_count === "number" ? { total_count: block.total_count as number, total_qualifier: fam?.total_qualifier ?? null } : {}),
    ...(block?.truncated ? { truncated: true } : {}),
    ...(facts.value ? { value: facts.value } : {}), ...(stateFacts ? { state_facts: stateFacts } : {}),
    ...(limitations.length ? { limitations } : {}),
    ...(Array.isArray(facts.measures) && facts.measures.length ? { measures: facts.measures } : {}),
    ...(facts.held_facts ? { held_facts: facts.held_facts } : {}),
    ...(meta.workflow_id || meta.action_id || facts.submission ? { actions: { workflow_id: meta.workflow_id ?? null, action_id: meta.action_id ?? null, ...(facts.submission ? { submission: facts.submission } : {}) } } : {}),
    hints: { ...(fam?.permission_only ? { permission_only: true } : {}), ...(fam?.requires_judgment ? { requires_judgment: true } : {}), ...(fam?.aggregate_only ? { aggregate_only: true } : {}) },
    legacy_prose: clean(result.answer),
  };
  return env;
}

/** Osa/public: what the caller has supplied and what the existing completeness logic says is missing, as held facts (no capability call). */
export function heldFactsEnvelope(h: { known: Record<string, string>; missing: string[] | null; constraints: string[]; submission?: "submitted" | "not_submitted" | "unknown" }): ResultEnvelope {
  return { v: 1, capability_key: "corporate.opportunity", availability: "answered", capability_status: "enabled", truth_state: "observed",
    subject: { domain: "corporate", object_class: "opportunity", noun: "opportunity details", singular: "opportunity detail", facets: ["recall", "missing"] },
    held_facts: { known: h.known, missing: h.missing, constraints: h.constraints }, actions: { submission: h.submission ?? "unknown" }, legacy_prose: "" };
}
