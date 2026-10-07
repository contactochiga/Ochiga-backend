// Evidence classes the planner can request, and the certified sources that satisfy each.
//
// SELECTION PRECEDENCE (deterministic, documented):
//  1. A class is satisfied only by sources listed here, in this order.
//  2. mode "first": the first source that is registered, IQ-3A-certified for the request's surface x scope
//     and currently authorised is used; later entries are fallbacks only (never queried in addition).
//     mode "all": every admissible source is used (the class is a union of distinct populations).
//  3. DIRECT sources are always preferred over composite aggregates. Composite capabilities
//     (home.summary/attention/activity, facility.overview) are NOT listed anywhere: they are
//     presentation/composition sources whose components appear here directly, so a composite and its
//     components are never both treated as independent truth.
//  4. Sources not listed (non-benchmark evidence debt, disabled capabilities) are never selected.
//     A class listing only uncertified sources is reported as "no certified source", not queried.
export type ClassEntry = {
  id: string;
  label: string;
  mode: "first" | "all";
  sources: string[];
  // Whether the certified sources of this class can be narrowed to one verified room.
  room_capable?: boolean;
  // How long a gathered contribution stays acceptable for reuse within the assessment TTL.
  ttl_ms: number;
  // Office snapshot classes are keyed to the supplied snapshot content, not to wall time alone.
  snapshot?: boolean;
  // A class with no implemented safe source anywhere (IQ-3A proven product debt).
  product_debt?: string;
  // "state": a live observation can be stale (devices, cameras). "records": rows whose age is lifecycle, not
  // staleness of the read (tickets, leads). "knowledge": governed content.
  kind: "state" | "records" | "knowledge";
  // Surfaces on which this class has no implemented safe source (IQ-3A proven product debt per surface).
  surface_debt?: Record<string, string>;
};

const MIN = 60_000;
export const SOURCE_NOUN: Record<string, string> = {
  "crm.leads.read": "leads needing attention", "crm.opportunities.read": "stale opportunities",
  "reports.approvals.read": "reports awaiting approval", "development.status.read": "development projects",
  "financial.summary.read": "estate financial summaries", "office_tasks.query.read": "tasks", "office_automations.query.read": "automations",
  "office_meetings.query.read": "meetings", "office_support.query.read": "support cases", "office_portfolio.query.read": "portfolio entries",
  "office_partnerships.query.read": "partnerships", "office_documents.query.read": "documents", "office_content.query.read": "content items",
  "corporate.opportunity.read": "details you have shared about the opportunity", "corporate.partnerships.read": "approved partnership information",
  "corporate.development.read": "published development projects",
  "maintenance.requests.read": "maintenance requests", "security.incidents.read": "security incidents", "visitors.pending.read": "visitor access records",
  "facility.cameras.read": "cameras", "devices.status.read": "registered devices", "devices.availability.read": "registered devices",
  "devices.activity.read": "recent device command executions", "devices.failures.read": "recent device failures", "scenes.list.read": "scenes",
};

const snapshot = (id: string, label: string, source: string): ClassEntry => ({ id, label, mode: "first", sources: [source], ttl_ms: 5 * MIN, snapshot: true, kind: "records" });
export const EVIDENCE_CLASSES: Record<string, ClassEntry> = Object.freeze({
  // Office (permission-gated supplied snapshot)
  crm: { id: "crm", label: "leads and opportunities", mode: "all", sources: ["crm.leads.read", "crm.opportunities.read"], ttl_ms: 5 * MIN, snapshot: true, kind: "records" },
  office_development: snapshot("office_development", "development projects", "development.status.read"),
  office_reports: snapshot("office_reports", "reports awaiting approval", "reports.approvals.read"),
  office_financial: snapshot("office_financial", "estate financial position", "financial.summary.read"),
  office_tasks: snapshot("office_tasks", "tasks", "office_tasks.query.read"),
  office_automations: snapshot("office_automations", "automations", "office_automations.query.read"),
  office_meetings: snapshot("office_meetings", "meetings", "office_meetings.query.read"),
  office_support: snapshot("office_support", "support cases", "office_support.query.read"),
  office_portfolio: snapshot("office_portfolio", "portfolio", "office_portfolio.query.read"),
  office_partnerships: snapshot("office_partnerships", "partnerships", "office_partnerships.query.read"),
  office_documents: snapshot("office_documents", "documents", "office_documents.query.read"),
  office_content: snapshot("office_content", "content", "office_content.query.read"),
  // Public (Osa): public knowledge and the caller's own thread only
  corporate_opportunity: { id: "corporate_opportunity", label: "the opportunity you described", mode: "first", sources: ["corporate.opportunity.read"], ttl_ms: 10 * MIN, kind: "records" },
  corporate_partnerships: { id: "corporate_partnerships", label: "approved partnership information", mode: "first", sources: ["corporate.partnerships.read"], ttl_ms: 30 * MIN, kind: "knowledge" },
  corporate_development: { id: "corporate_development", label: "published development projects", mode: "first", sources: ["corporate.development.read"], ttl_ms: 30 * MIN, kind: "knowledge" },
  // Consumer / Facility operational
  maintenance: { id: "maintenance", label: "maintenance requests", mode: "first", sources: ["maintenance.requests.read"], ttl_ms: 10 * MIN, kind: "records" },
  security: { id: "security", label: "security incidents", mode: "first", sources: ["security.incidents.read"], ttl_ms: 10 * MIN, kind: "records" },
  visitors: { id: "visitors", label: "visitor access", mode: "first", sources: ["visitors.pending.read"], ttl_ms: 10 * MIN, kind: "records" },
  cameras: { id: "cameras", label: "camera state", mode: "first", sources: ["facility.cameras.read"], ttl_ms: 2 * MIN, kind: "state", surface_debt: { consumer: "no camera read exists for Consumer homes; only the Facility estate camera read is implemented" } },
  device_availability: { id: "device_availability", label: "device availability", mode: "first", sources: ["devices.status.read", "devices.availability.read"], room_capable: true, ttl_ms: 2 * MIN, kind: "state", surface_debt: { facility: "device sources need a verified home; there is no estate-wide device read for Facility" } },
  device_history: { id: "device_history", label: "recent device activity", mode: "first", sources: ["devices.activity.read", "devices.failures.read"], ttl_ms: 5 * MIN, kind: "records", surface_debt: { facility: "device history needs a verified home; there is no estate-wide device history read for Facility" } },
  scenes: { id: "scenes", label: "scenes", mode: "first", sources: ["scenes.list.read"], ttl_ms: 10 * MIN, kind: "records" },
  // Known product debt (IQ-3A proven): never substituted
  device_observed_value: { id: "device_observed_value", label: "device observed values (lock position, temperature, power)", mode: "first", sources: [], ttl_ms: 0, kind: "state", product_debt: "no read capability exposes a device's observed physical value; only availability and freshness" },
  utilities_usage: { id: "utilities_usage", label: "electricity consumption", mode: "first", sources: [], ttl_ms: 0, kind: "state", product_debt: "consumption/meter reads are declared but not enabled; spending is money, not kWh" },
  // Exist in the registry but are NOT IQ-3A certified (non-benchmark evidence debt): reported, never queried
  utilities_service: { id: "utilities_service", label: "utility service status", mode: "all", sources: ["utilities.active.read", "utilities.tariff.read"], ttl_ms: 10 * MIN, kind: "records" },
  wallet: { id: "wallet", label: "wallet", mode: "all", sources: ["wallet.balance.read", "wallet.transactions.read"], ttl_ms: 10 * MIN, kind: "records" },
});

export const entryFor = (id: string): ClassEntry | null => EVIDENCE_CLASSES[id] || null;
