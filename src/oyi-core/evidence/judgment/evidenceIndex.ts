import type { CompactEvidencePlanState, Contribution } from "../planner/types";
import type { Candidate, EvidenceEntry, Factor } from "./types";

const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Which evidence classes yield judgment candidates. Others (visitors, devices, cameras, scenes, knowledge) are context:
// they shape what can be concluded and what is uncertain, but are not themselves ranked as "things to deal with".
export const CANDIDATE_KIND: Record<string, Candidate["kind"]> = {
  maintenance: "issue", security: "issue", office_support: "issue", office_tasks: "task", office_meetings: "event",
  crm: "business", office_development: "business", office_reports: "business", corporate_opportunity: "opportunity",
};
// Typed-operational classes can be ordered by recorded fields alone. Business classes differ mainly in free text and so
// need comparative judgment (the single bounded provider boundary) or an honest "cannot rank".
export const TYPED_OPERATIONAL = new Set(["maintenance", "security", "office_support", "office_tasks", "office_meetings"]);

const HISTORICAL = /^(?:resolved|closed|completed|cancelled|canceled|expired|done|inactive|exited|checked_out)$/;
const ACTIVE = /^(?:open|pending|in_progress|acknowledged|new|qualified|qualification|active|scheduled|expected|approved|review|planning)$/;
const LEVELS: Record<string, string> = { critical: "critical", urgent: "critical", high: "high", medium: "medium", normal: "medium", low: "low" };

export type EvidenceIndex = { entries: Map<string, EvidenceEntry>; candidates: Candidate[]; sources: Contribution[]; assessment_id: string };

function lifecycleOf(m: Record<string, unknown>): string {
  const s = text(m.status || m.stage).toLowerCase();
  if (HISTORICAL.test(s)) return "historical";
  const exp = Date.parse(text(m.expires_at));
  if (Number.isFinite(exp) && exp <= Date.now()) return "historical";
  if (ACTIVE.test(s)) return "active";
  return "unknown";
}

function timePressureOf(m: Record<string, unknown>, now: number): string | null {
  if (m.overdue === true) return "overdue";
  const due = Date.parse(text(m.due_at || m.scheduled_at));
  if (!Number.isFinite(due)) return m.overdue === false ? "later" : null;
  if (due < now) return "overdue";
  return due - now <= 48 * 3_600_000 ? "due_within_48h" : "later";
}

// Typed factors only: every value comes from a recorded typed field, never from reading prose, and never invented.
export function factorsFor(m: Record<string, unknown>, eref: string, evidenceClass: string, now: number): Factor[] {
  const out: Factor[] = [];
  const add = (dimension: Factor["dimension"], level: string | null) => { if (level) out.push({ dimension, level, basis: "typed", eref }); };
  if (text(m.status || m.stage)) add("lifecycle", lifecycleOf(m));
  const importance = LEVELS[text(m.severity).toLowerCase()] || LEVELS[text(m.priority).toLowerCase()];
  add("importance", importance || null);
  add("time_pressure", timePressureOf(m, now));
  if (["crm", "office_development"].includes(evidenceClass)) {
    const s = text(m.status || m.stage).toLowerCase();
    add("readiness", s === "qualified" || s === "qualification" ? "qualified" : s === "new" ? "early" : null);
  }
  const days = num(m.days_since_activity);
  if (days !== null) add("recency", days >= 14 ? "stale_14d_plus" : "recent");
  return out;
}

const SIGNAL_FIELDS = ["reason", "status", "stage", "title", "name", "label"] as const;

export function buildEvidenceIndex(state: CompactEvidencePlanState, now = Date.now()): EvidenceIndex {
  const entries = new Map<string, EvidenceEntry>(); const candidates: Candidate[] = [];
  let e = 0, s = 0, c = 0; const sources = state.contributions.filter(k => k.availability === "available");
  for (const k of sources) {
    const sref = `s${++s}`;
    entries.set(sref, { ref: sref, kind: "source", source_key: k.source_key, evidence_class: k.evidence_class, item_index: null, label: null,
      fields: { record_count: k.record_count, truncated: k.truncated, unobserved: k.unobserved, freshness: k.freshness, scope_class: k.scope_class, scope_label: k.scope_label ?? null }, availability: "available", completeness: k.completeness, caller_supplied: k.source_key === "corporate.opportunity.read" });
    const kind = CANDIDATE_KIND[k.evidence_class];
    k.material.forEach((m, idx) => {
      const eref = `e${++e}`;
      const label = text(m.label) || text(m.title) || text(m.name) || null;
      entries.set(eref, { ref: eref, kind: "item", source_key: k.source_key, evidence_class: k.evidence_class, item_index: idx, label, fields: m, availability: "available", completeness: k.completeness, caller_supplied: m.caller_supplied_unverified === true });
      if (!kind || k.evidence_class === "corporate_opportunity") return;
      const ref = k.refs[idx] || { t: null, id: null, l: null };
      const typed = TYPED_OPERATIONAL.has(k.evidence_class);
      const signals = SIGNAL_FIELDS.map(f => ({ f, v: text(m[f]) })).filter(x => x.v && x.f !== "name" && x.f !== "title").map(x => ({ eref, text: x.v.slice(0, 120) }));
      candidates.push({ cid: `c${++c}`, kind, evidence_class: k.evidence_class, source_key: k.source_key, ref: { t: ref.t, id: ref.id, label: label || ref.l }, evidence: [eref, sref],
        factors: factorsFor(m, eref, k.evidence_class, now), signals: typed ? [] : signals.filter((x, i, a) => a.findIndex(y => y.text === x.text) === i), needs_comparative_judgment: !typed });
    });
  }
  return { entries, candidates, sources, assessment_id: state.plan_id };
}
