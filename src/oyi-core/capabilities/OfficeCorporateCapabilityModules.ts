// First-class Oyi Core capability modules for the office_internal and
// public_corporate surfaces. Consumer/Facility's capability modules
// (ReadCapabilityModules.ts) are built entirely around the smart-home
// object model and have zero CRM/development/corporate-knowledge
// awareness — these modules fill that gap using the same readModule()
// factory pattern and the same capability pipeline (supports/collect/
// buildReadResponse), so authority, evidence and presentation are
// enforced identically to every other capability.
//
// office_internal modules never query a database directly — Backend has
// no direct connection to Office's CRM/reports/development store (a
// separate Supabase project from Consumer/Facility's). Office computes a
// compact, permission-gated `operational_snapshot` itself (reusing its
// own existing store + permission functions) and attaches it to the
// request; these modules only read evidence from that snapshot. A null
// section means "not computed for this request" (reported as
// unavailable, never fabricated); an empty array means "computed,
// genuinely none right now".
//
// public_corporate modules never read private Office data and never
// inherit Office operational authority — corporate.development.read
// reads Website's own public Sanity dataset live (credential-free CDN
// read); the other four use curated content mirrored from what is
// actually live on the public website today (app/about, app/private,
// app/partnerships, lib/company.ts), since no CMS schema exists yet for
// that copy.
import type { CapabilityContext, CapabilityModule } from "../contracts/capability";
import type { DomainResult } from "../contracts/domainResult";
import type { OyiEvidence } from "../contracts/evidence";
import type { SemanticFrame } from "../contracts/semanticFrame";
import { evidenceEnvelope } from "../evidence/EvidenceEnvelope";
import { readModule, resultPresentation } from "./ReadCapabilityModules";

type OperationalSnapshot = {
  generated_at: string | null;
  leads: {
    needing_attention: Array<{ id: string; name: string; status: string; reason: string; last_activity_at: string | null }>;
    total_open: number;
  } | null;
  opportunities: {
    stale: Array<{ id: string; name: string; stage: string; days_since_activity: number | null; owner: string | null }>;
    total_open: number;
  } | null;
  reports: {
    pending_approval: Array<{ id: string; title: string; submitted_by: string | null; submitted_at: string | null }>;
  } | null;
  development: {
    projects: Array<{ id: string; name: string; status: string; percent_complete: number | null; units_sold: number | null; units_total: number | null }>;
  } | null;
  financial: {
    generated_at: string | null;
    period_start: string | null;
    period_end: string | null;
    portfolio: {
      estate_count: number;
      currency: string;
      current_balance_total: number;
      revenue_period_total: number;
      utility_sales_period_total: number;
      service_charge_period_total: number;
      transaction_count_total: number;
    } | null;
    estates: Array<{
      estate_id: string;
      name: string;
      current_balance: number | null;
      currency: string;
      revenue_period: number;
      utility_sales_period: number;
      service_charge_period: number;
      transaction_count: number;
    }>;
  } | null;
};

function officeSnapshot(context: CapabilityContext): OperationalSnapshot | null {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const snapshot = (requestContext as Record<string, unknown>).operational_snapshot;
  return snapshot && typeof snapshot === "object" ? (snapshot as OperationalSnapshot) : null;
}

// Tasks reads the currently-SELECTED task's context slot (a specific
// record the staff member has open), not an aggregate snapshot section —
// there is no tasks list in operational_snapshot today, and adding one is
// a separate, larger change. This mirrors exactly how the frontend's own
// selectedContextSlot()/CONTEXT_SLOT_BY_SELECTED_TYPE already treat
// task_context as "Office already knows what record is open" — a more
// reliable signal than trying to infer a task from free text.
type TaskContextSlot = {
  task_ref: string | null;
  safe_summary: string | null;
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  owner?: string | null;
  due_at?: string | null;
  overdue?: boolean;
} | null;

function taskContextSlot(context: CapabilityContext): TaskContextSlot {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const slot = (requestContext as Record<string, unknown>).task_context;
  return slot && typeof slot === "object" ? (slot as TaskContextSlot) : null;
}

const officePrivate: OyiEvidence["privacy_class"] = "corporate_private";
const publicEvidence: OyiEvidence["privacy_class"] = "public";
const readOperations = ["inform", "summarize", "list", "inspect"];

function unavailableResult(answer: string): DomainResult {
  return { status: "unavailable", answer, presentation_policy: resultPresentation("text") };
}

// ---------------------------------------------------------------------
// office_internal — CRM leads
// ---------------------------------------------------------------------
function crmLeadsReadModule(): CapabilityModule {
  return readModule({
    key: "crm.leads.read",
    domain: "crm",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["crm.read"],
    evidenceRequirements: [{ domain: "crm", evidence_type: "crm_lead_needs_attention", freshness: ["fresh", "stale", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "crm" && /\bleads?\b/i.test(frame.normalizedText),
    collect: async (context) => {
      const snapshot = officeSnapshot(context);
      const leads = snapshot?.leads;
      if (!leads) return [];
      return leads.needing_attention.map((lead) =>
        evidenceEnvelope({
          domain: "crm",
          type: "crm_lead_needs_attention",
          object_type: "lead",
          object_id: lead.id,
          source: "domain_adapter",
          observed_at: lead.last_activity_at,
          freshness: lead.last_activity_at ? "fresh" : "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { lead },
        })
      );
    },
    answer: (context) => {
      const snapshot = officeSnapshot(context);
      if (!snapshot?.leads) {
        return unavailableResult("I don't have a current read on leads for this session — the Office CRM snapshot wasn't attached to this request.");
      }
      const { needing_attention: items, total_open: totalOpen } = snapshot.leads;
      if (!items.length) {
        return {
          status: "empty",
          answer: `No leads currently need attention. There are ${totalOpen} open lead${totalOpen === 1 ? "" : "s"} in total and none are flagged.`,
          presentation_policy: resultPresentation("list"),
          metadata: { total_open: totalOpen },
        };
      }
      const lines = items.slice(0, 10).map((lead) => `${lead.name} — ${lead.reason} (${lead.status})`);
      return {
        status: "answered",
        answer: `${items.length} lead${items.length === 1 ? "" : "s"} need${items.length === 1 ? "s" : ""} attention out of ${totalOpen} open:\n${lines.map((line) => `• ${line}`).join("\n")}`,
        blocks: [{ type: "list", items }],
        presentation_policy: resultPresentation("list"),
        metadata: { total_open: totalOpen },
      };
    },
    primary: "list",
  });
}

// ---------------------------------------------------------------------
// office_internal — CRM opportunities
// ---------------------------------------------------------------------
function crmOpportunitiesReadModule(): CapabilityModule {
  return readModule({
    key: "crm.opportunities.read",
    domain: "crm",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["crm.read"],
    evidenceRequirements: [{ domain: "crm", evidence_type: "crm_opportunity_stale", freshness: ["fresh", "stale", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "crm" && /\bopportunit/i.test(frame.normalizedText),
    collect: async (context) => {
      const snapshot = officeSnapshot(context);
      const opportunities = snapshot?.opportunities;
      if (!opportunities) return [];
      return opportunities.stale.map((opportunity) =>
        evidenceEnvelope({
          domain: "crm",
          type: "crm_opportunity_stale",
          object_type: "opportunity",
          object_id: opportunity.id,
          source: "domain_adapter",
          observed_at: null,
          freshness: "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { opportunity },
        })
      );
    },
    answer: (context) => {
      const snapshot = officeSnapshot(context);
      if (!snapshot?.opportunities) {
        return unavailableResult("I don't have a current read on opportunities for this session — the Office CRM snapshot wasn't attached to this request.");
      }
      const { stale: items, total_open: totalOpen } = snapshot.opportunities;
      if (!items.length) {
        return {
          status: "empty",
          answer: `All ${totalOpen} open opportunit${totalOpen === 1 ? "y" : "ies"} have been followed up recently — none are stale.`,
          presentation_policy: resultPresentation("list"),
          metadata: { total_open: totalOpen },
        };
      }
      const lines = items.slice(0, 10).map((o) => `${o.name} — ${o.stage}${o.days_since_activity != null ? `, ${o.days_since_activity}d since last activity` : ""}${o.owner ? ` (owner: ${o.owner})` : ""}`);
      return {
        status: "answered",
        answer: `${items.length} opportunit${items.length === 1 ? "y hasn't" : "ies haven't"} been followed up this week:\n${lines.map((line) => `• ${line}`).join("\n")}`,
        blocks: [{ type: "list", items }],
        presentation_policy: resultPresentation("list"),
        metadata: { total_open: totalOpen },
      };
    },
    primary: "list",
  });
}

// ---------------------------------------------------------------------
// office_internal — Reports awaiting approval
// ---------------------------------------------------------------------
function reportsApprovalsReadModule(): CapabilityModule {
  return readModule({
    key: "reports.approvals.read",
    domain: "office_reports",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["reports.write"],
    evidenceRequirements: [{ domain: "office_reports", evidence_type: "report_pending_approval", freshness: ["fresh", "stale", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "office_reports",
    collect: async (context) => {
      const snapshot = officeSnapshot(context);
      const reports = snapshot?.reports;
      if (!reports) return [];
      return reports.pending_approval.map((report) =>
        evidenceEnvelope({
          domain: "office_reports",
          type: "report_pending_approval",
          object_type: "report",
          object_id: report.id,
          source: "domain_adapter",
          observed_at: report.submitted_at,
          freshness: report.submitted_at ? "fresh" : "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { report },
        })
      );
    },
    answer: (context) => {
      const snapshot = officeSnapshot(context);
      if (!snapshot?.reports) {
        return unavailableResult("I don't have a current read on report approvals for this session — the Office reports snapshot wasn't attached to this request.");
      }
      const items = snapshot.reports.pending_approval;
      if (!items.length) {
        return { status: "empty", answer: "No reports are currently awaiting approval.", presentation_policy: resultPresentation("list") };
      }
      const lines = items.slice(0, 10).map((r) => `${r.title}${r.submitted_by ? ` — submitted by ${r.submitted_by}` : ""}`);
      return {
        status: "answered",
        answer: `${items.length} report${items.length === 1 ? "" : "s"} awaiting approval:\n${lines.map((line) => `• ${line}`).join("\n")}`,
        blocks: [{ type: "list", items }],
        presentation_policy: resultPresentation("list"),
      };
    },
    primary: "list",
  });
}

// ---------------------------------------------------------------------
// office_internal — Development status
// ---------------------------------------------------------------------
function developmentStatusReadModule(): CapabilityModule {
  return readModule({
    key: "development.status.read",
    domain: "office_development",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["development.manage"],
    evidenceRequirements: [{ domain: "office_development", evidence_type: "development_project_status", freshness: ["fresh", "stale", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "office_development",
    collect: async (context) => {
      const snapshot = officeSnapshot(context);
      const development = snapshot?.development;
      if (!development) return [];
      return development.projects.map((project) =>
        evidenceEnvelope({
          domain: "office_development",
          type: "development_project_status",
          object_type: "development_project",
          object_id: project.id,
          source: "domain_adapter",
          observed_at: null,
          freshness: "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { project },
        })
      );
    },
    answer: (context) => {
      const snapshot = officeSnapshot(context);
      if (!snapshot?.development) {
        return unavailableResult("I don't have a current read on development projects for this session — the Office development snapshot wasn't attached to this request.");
      }
      const items = snapshot.development.projects;
      if (!items.length) {
        return { status: "empty", answer: "No development projects are currently tracked in Development Management.", presentation_policy: resultPresentation("list") };
      }
      const lines = items.map((p) => {
        const parts = [p.status];
        if (p.percent_complete != null) parts.push(`${p.percent_complete}% complete`);
        if (p.units_sold != null && p.units_total != null) parts.push(`${p.units_sold}/${p.units_total} units sold`);
        return `${p.name} — ${parts.join(", ")}`;
      });
      return {
        status: "answered",
        answer: `Across ${items.length} development project${items.length === 1 ? "" : "s"}:\n${lines.map((line) => `• ${line}`).join("\n")}`,
        blocks: [{ type: "list", items }],
        presentation_policy: resultPresentation("list"),
      };
    },
    primary: "list",
  });
}

// ---------------------------------------------------------------------
// office_internal — Financial summary (Financial Unification Programme)
// The snapshot's financial section is itself sourced live from
// Ochiga-backend's canonical /office/financial-summary aggregate contract
// (Office fetches it and attaches it, same as every other snapshot
// section) — so this module only ever surfaces real, already-computed
// estate/portfolio aggregates. It never returns a resident/home-keyed
// figure. If the snapshot's financial section is null (actor lacks
// financial.read, or the backend call failed), the answer says so rather
// than fabricating a number.
// ---------------------------------------------------------------------
function financialSummaryReadModule(): CapabilityModule {
  return readModule({
    key: "financial.summary.read",
    domain: "office_financial",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["financial.read"],
    evidenceRequirements: [{ domain: "office_financial", evidence_type: "financial_estate_summary", freshness: ["fresh", "stale", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "office_financial",
    collect: async (context) => {
      const snapshot = officeSnapshot(context);
      const financial = snapshot?.financial;
      if (!financial) return [];
      return financial.estates.map((estate) =>
        evidenceEnvelope({
          domain: "office_financial",
          type: "financial_estate_summary",
          object_type: "estate_financial_summary",
          object_id: estate.estate_id,
          source: "domain_adapter",
          observed_at: financial.generated_at,
          freshness: financial.generated_at ? "fresh" : "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: estate.estate_id, building_id: null, home_id: null, room_id: null },
          payload: { estate, portfolio: financial.portfolio, period_start: financial.period_start, period_end: financial.period_end },
        })
      );
    },
    answer: (context) => {
      const snapshot = officeSnapshot(context);
      const financial = snapshot?.financial;
      if (!financial) {
        return unavailableResult("I don't have a current read on the financial position for this session — the financial snapshot wasn't attached to this request, or this account isn't permitted to view it.");
      }
      const portfolio = financial.portfolio;
      if (!portfolio || !financial.estates.length) {
        return { status: "empty", answer: "No estate financial records are available right now.", presentation_policy: resultPresentation("text") };
      }
      const fmt = (value: number) => `${portfolio.currency} ${Number(value || 0).toLocaleString("en-NG")}`;
      const lines = financial.estates
        .slice(0, 10)
        .map((estate) => `${estate.name} — balance ${fmt(estate.current_balance ?? 0)}, revenue ${fmt(estate.revenue_period)}, ${estate.transaction_count} transaction${estate.transaction_count === 1 ? "" : "s"}`);
      const summary =
        `Across ${portfolio.estate_count} estate${portfolio.estate_count === 1 ? "" : "s"}: current balance ${fmt(portfolio.current_balance_total)}, ` +
        `period revenue ${fmt(portfolio.revenue_period_total)} (utility sales ${fmt(portfolio.utility_sales_period_total)}, service charges ${fmt(portfolio.service_charge_period_total)}), ` +
        `${portfolio.transaction_count_total} completed transaction${portfolio.transaction_count_total === 1 ? "" : "s"}.\n${lines.map((line) => `• ${line}`).join("\n")}`;
      return {
        status: "answered",
        answer: summary,
        blocks: [{ type: "list", items: financial.estates }],
        presentation_policy: resultPresentation("list"),
        metadata: { portfolio, period_start: financial.period_start, period_end: financial.period_end },
      };
    },
    primary: "list",
  });
}

// ---------------------------------------------------------------------
// office_internal — Tasks (Oyi Conversational Runtime Completion
// Programme, Phase 1c). The first of office_internal's context-slot
// domains (task/automation/meeting/partnership/document/content/
// support/project) to get a real capability module instead of falling
// through to the generic business-surface fallback. Answers only about
// the specific task the staff member currently has open (task_context),
// never a fabricated aggregate — there is no task list capability here,
// only a grounded read of one real record. Question-aware: leads with
// whichever field the message asked about, otherwise falls back to the
// full safe_summary digest. Workflow/automation linkage and activity
// history are answered honestly as "not tracked"/"not available" rather
// than invented — crm_tasks carries no such link field in this system,
// and Office does not send task history over this contract yet.
// ---------------------------------------------------------------------
function officeTasksReadModule(): CapabilityModule {
  return readModule({
    key: "office_tasks.read",
    domain: "office_tasks",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["tasks.read"],
    evidenceRequirements: [{ domain: "office_tasks", evidence_type: "office_task_selected", freshness: ["fresh", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "office_tasks",
    collect: async (context) => {
      const task = taskContextSlot(context);
      if (!task || !(task.safe_summary || task.title)) return [];
      return [
        evidenceEnvelope({
          domain: "office_tasks",
          type: "office_task_selected",
          object_type: "task",
          object_id: task.task_ref,
          source: "domain_adapter",
          observed_at: null,
          freshness: "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { task },
        }),
      ];
    },
    answer: (context) => {
      const task = taskContextSlot(context);
      if (!task || !(task.safe_summary || task.title)) {
        return unavailableResult("I don't have a specific task open to check — select a task in Tasks first, then ask me about it.");
      }
      const message = normalizeMessage(context);
      const label = task.title || "This task";

      if (/\bworkflow\b/i.test(message)) {
        return {
          status: "answered",
          answer: `${label} isn't linked to a specific workflow — tasks and workflows aren't connected records in this system.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bautomat/i.test(message)) {
        return {
          status: "answered",
          answer: `${label} isn't linked to a specific automation — tasks and automations aren't connected records in this system.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bhistory|activity|log\b/i.test(message)) {
        return {
          status: "answered",
          answer: `I don't have an activity history for ${label} available in this conversation yet — check the Audit Log tab on the task for that.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bowner|owns|assign/i.test(message)) {
        return {
          status: "answered",
          answer: task.owner ? `${label} is owned by ${task.owner}.` : `${label} doesn't have an owner assigned yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bdue|overdue|deadline|late\b/i.test(message)) {
        if (!task.due_at) {
          return { status: "answered", answer: `${label} doesn't have a due date set.`, presentation_policy: resultPresentation("text") };
        }
        const overdueNote = task.overdue ? " — it's overdue." : ".";
        return { status: "answered", answer: `${label} is due ${task.due_at}${overdueNote}`, presentation_policy: resultPresentation("text") };
      }
      if (/\bpriority\b/i.test(message) && task.priority) {
        return { status: "answered", answer: `${label} is ${task.priority} priority.`, presentation_policy: resultPresentation("text") };
      }

      // General/status question, or nothing more specific matched — the
      // full pre-composed digest is the honest, complete answer.
      const digest = task.safe_summary || [label, task.status, task.priority].filter(Boolean).join(" · ");
      return { status: "answered", answer: digest, presentation_policy: resultPresentation("text") };
    },
    primary: "text",
  });
}

function normalizeMessage(context: CapabilityContext): string {
  return String(context.input.message ?? "").toLowerCase();
}

// ---------------------------------------------------------------------
// public_corporate — curated static content, mirrored from what is
// actually live on the public website today (app/about/page.tsx,
// app/private/page.tsx, app/partnerships/page.tsx, lib/company.ts).
// Not Sanity-live like development, so the answer is honest about that.
// ---------------------------------------------------------------------
function corporateEvidence(domain: OyiEvidence["domain"], type: string): OyiEvidence {
  return evidenceEnvelope({
    domain,
    type,
    object_type: null,
    object_id: null,
    source: "domain_adapter",
    observed_at: null,
    freshness: "unknown",
    privacy_class: publicEvidence,
    confidence: 0.85,
    authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
    payload: {},
  });
}

function corporateCompanyReadModule(): CapabilityModule {
  return readModule({
    key: "corporate.company.read",
    domain: "corporate_company",
    operations: readOperations,
    supportedSurfaces: ["public_corporate"],
    permissions: [],
    evidenceRequirements: [],
    supports: (frame: SemanticFrame) => frame.domain === "corporate_company",
    collect: async () => [corporateEvidence("corporate_company", "corporate_company_profile")],
    answer: () => ({
      status: "answered",
      answer:
        "Ochiga develops and powers intelligent places, bringing together real estate development, building technology and strategic investment partnerships. " +
        "The company works through three connected engines: Ochiga Development (creates the physical asset), Oyi (Ochiga's building operating technology — powers how it operates), " +
        "and Ochiga Private (connects selected investors, buyers, landowners and strategic partners with opportunity). These are interconnected parts of one Ochiga ecosystem, not three unrelated businesses.",
      presentation_policy: resultPresentation("text"),
    }),
    primary: "text",
  });
}

function corporateOyiReadModule(): CapabilityModule {
  return readModule({
    key: "corporate.oyi.read",
    domain: "corporate_oyi",
    operations: readOperations,
    supportedSurfaces: ["public_corporate"],
    permissions: [],
    evidenceRequirements: [],
    supports: (frame: SemanticFrame) => frame.domain === "corporate_oyi",
    collect: async () => [corporateEvidence("corporate_oyi", "corporate_oyi_profile")],
    answer: () => ({
      status: "answered",
      answer:
        "Oyi is Ochiga's building operating technology — the intelligence layer that helps developments continue to evolve after handover, powering access control, energy, climate and security across a property. " +
        "It's the same assistant you're talking to right now, adapted for residents, facility staff and Ochiga's own developments. More at getoyi.com.",
      presentation_policy: resultPresentation("text"),
    }),
    primary: "text",
  });
}

function corporatePrivateReadModule(): CapabilityModule {
  return readModule({
    key: "corporate.private.read",
    domain: "corporate_private",
    operations: readOperations,
    supportedSurfaces: ["public_corporate"],
    permissions: [],
    evidenceRequirements: [],
    supports: (frame: SemanticFrame) => frame.domain === "corporate_private",
    collect: async () => [corporateEvidence("corporate_private", "corporate_private_profile")],
    answer: () => ({
      status: "answered",
      answer:
        "Ochiga Private is a curated private real-estate investment and opportunity network connecting selected investors, buyers, landowners and strategic partners with Ochiga's development opportunities. " +
        "Membership works through five stages — Apply, Qualify, Access, Participate, Grow — and opportunities span recurring income, longer-term appreciation and development-linked categories. " +
        "Membership and access are subject to individual review and are never guaranteed; Ochiga does not provide investment advice, and nothing here is an offer of securities or a guarantee of returns.",
      presentation_policy: resultPresentation("text"),
    }),
    primary: "text",
  });
}

function corporatePartnershipsReadModule(): CapabilityModule {
  return readModule({
    key: "corporate.partnerships.read",
    domain: "corporate_partnerships",
    operations: readOperations,
    supportedSurfaces: ["public_corporate"],
    permissions: [],
    evidenceRequirements: [],
    supports: (frame: SemanticFrame) => frame.domain === "corporate_partnerships",
    collect: async () => [corporateEvidence("corporate_partnerships", "corporate_partnerships_profile")],
    answer: () => ({
      status: "answered",
      answer:
        "Ochiga partners across several tracks: Landowners & Joint Ventures (land contribution, joint development), Capital Partners (institutions, family offices, strategic capital), " +
        "Buyers & Offtake (acquisition and sales relationships), and Professional/Strategic Partners (delivery and technology integrators). " +
        "The process is Introduce, Review, Structure, Align, Execute. Start a conversation at ochiga.com.ng/partnerships or ochiga.com.ng/contact.",
      presentation_policy: resultPresentation("text"),
    }),
    primary: "text",
  });
}

// ---------------------------------------------------------------------
// public_corporate — Development, live from Website's public Sanity
// dataset (same project/dataset the website itself renders from). A
// credential-free CDN read — no new secrets, nothing private.
// ---------------------------------------------------------------------
const SANITY_PROJECT_ID = "ap1ku6sf";
const SANITY_DATASET = "production";
const DEVELOPMENT_PROJECTS_GROQ = `*[_type == "developmentProject"] | order(order asc) {
  name,
  "slug": slug.current,
  typeLine,
  location,
  status,
  oneLiner
}`;

type SanityDevelopmentProject = {
  name?: string;
  slug?: string;
  typeLine?: string;
  location?: string;
  status?: string;
  oneLiner?: string;
};

async function fetchLiveDevelopmentProjects(): Promise<{ projects: SanityDevelopmentProject[]; fetched: boolean }> {
  try {
    const url = `https://${SANITY_PROJECT_ID}.apicdn.sanity.io/v2024-01-01/data/query/${SANITY_DATASET}?query=${encodeURIComponent(DEVELOPMENT_PROJECTS_GROQ)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return { projects: [], fetched: false };
    const body = (await response.json()) as { result?: SanityDevelopmentProject[] };
    return { projects: Array.isArray(body.result) ? body.result : [], fetched: true };
  } catch {
    return { projects: [], fetched: false };
  }
}

function corporateDevelopmentReadModule(): CapabilityModule {
  return readModule({
    key: "corporate.development.read",
    domain: "corporate_development",
    operations: readOperations,
    supportedSurfaces: ["public_corporate"],
    permissions: [],
    evidenceRequirements: [{ domain: "corporate_development", evidence_type: "public_development_project", freshness: ["fresh", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "corporate_development",
    collect: async () => {
      const { projects, fetched } = await fetchLiveDevelopmentProjects();
      if (!fetched) return [];
      return projects.map((project) =>
        evidenceEnvelope({
          domain: "corporate_development",
          type: "public_development_project",
          object_type: "development_project",
          object_id: project.slug || project.name || null,
          source: "provider",
          source_type: "provider_api",
          observed_at: new Date().toISOString(),
          freshness: "fresh",
          privacy_class: publicEvidence,
          confidence: 0.95,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { project },
        })
      );
    },
    answer: (context, evidence) => {
      if (!evidence.length) {
        return unavailableResult("I couldn't reach the live development records just now, so I can't list current projects accurately. Please try again shortly or see ochiga.com.ng/development.");
      }
      const projects = evidence.map((item) => (item.payload as { project: SanityDevelopmentProject }).project);
      const lines = projects.map((p) => `${p.name}${p.location ? ` (${p.location})` : ""}${p.status ? ` — ${p.status}` : ""}${p.oneLiner ? `: ${p.oneLiner}` : ""}`);
      return {
        status: "answered",
        answer: `Ochiga currently has ${projects.length} development${projects.length === 1 ? "" : "s"}:\n${lines.map((line) => `• ${line}`).join("\n")}`,
        blocks: [{ type: "list", items: projects }],
        presentation_policy: resultPresentation("list"),
      };
    },
    primary: "list",
  });
}

export function buildOfficeInternalReadCapabilities(): CapabilityModule[] {
  return [crmLeadsReadModule(), crmOpportunitiesReadModule(), reportsApprovalsReadModule(), developmentStatusReadModule(), financialSummaryReadModule(), officeTasksReadModule()];
}

export function buildPublicCorporateReadCapabilities(): CapabilityModule[] {
  return [corporateCompanyReadModule(), corporateDevelopmentReadModule(), corporateOyiReadModule(), corporatePrivateReadModule(), corporatePartnershipsReadModule()];
}
