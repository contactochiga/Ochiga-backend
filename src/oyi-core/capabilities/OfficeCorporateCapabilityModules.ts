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
import { parseMeetingMutationIntent, parseSupportMutationIntent, isTaskMutationMessage } from "../context/officeActionProposal";
import { isAutomationScheduleOrRecurrenceMessage } from "../context/officeAutomationSuggestion";
import type { IntelligenceFact } from "../contracts/canonicalConversation";

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
  // Phase 4, PR 2 (Oyi Conversational Runtime Completion Programme) — an
  // aggregate list, distinct from the single-selected-record task_context
  // slot below. Mirrors leads/opportunities exactly: Office computes and
  // permission-gates this itself (see oyi-core-gateway.js's
  // buildTasksSnapshot()), Backend only ever reads it as evidence.
  tasks: {
    open: Array<{ id: string; title: string; status: string; priority: string | null; owner: string | null; due_at: string | null; overdue: boolean }>;
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
export type TaskContextSlot = {
  task_ref: string | null;
  safe_summary: string | null;
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  owner?: string | null;
  due_at?: string | null;
  overdue?: boolean;
} | null;

export function taskContextSlot(context: CapabilityContext): TaskContextSlot {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const slot = (requestContext as Record<string, unknown>).task_context;
  return slot && typeof slot === "object" ? (slot as TaskContextSlot) : null;
}

// Phase 4, PR 4 -- the batch counterpart of task_context: after a batch
// confirm, Office resends one rebuilt entry per child it PATCHed
// (same taskOyiContext() shape as the single-record slot above, just
// plural), so the VERIFY turn can check each child independently
// instead of assuming a single selected record.
export type TaskBatchContextEntry = NonNullable<TaskContextSlot>;

export function taskBatchContextSlot(context: CapabilityContext): TaskBatchContextEntry[] {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return [];
  const slot = (requestContext as Record<string, unknown>).task_batch_context;
  return Array.isArray(slot) ? (slot.filter((entry) => entry && typeof entry === "object") as TaskBatchContextEntry[]) : [];
}

const officePrivate: OyiEvidence["privacy_class"] = "corporate_private";
const publicEvidence: OyiEvidence["privacy_class"] = "public";
const readOperations = ["inform", "summarize", "list", "inspect"];

export function unavailableResult(answer: string): DomainResult {
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
// Phase 4, PR 2 -- distinguishes "show me my overdue tasks" (a list query,
// claimed by officeTasksQueryReadModule below) from "is this task overdue"
// (a question about the one currently-selected record, claimed by
// officeTasksReadModule). Anchored on plural "tasks" specifically: every
// single-record phrasing in officeTasksReadModule's own answer() branches
// below ("owner", "due", "priority" of *this* task) is naturally singular,
// and the domain classifier itself already accepts singular "task" for
// that capability. Mutual exclusion by construction, same pattern as the
// read/write split -- no score tie-break to reason about.
function isTaskListIntent(message: string): boolean {
  return /\btasks\b/i.test(message);
}

// Production bug found in live Milestone 1 verification, generalized in
// Milestone 2: "Do that every Friday" (or any other scheduling/
// recurrence reference) has no domain-specific mutation/list wording, so
// after any answer keeps that domain active via domain-only continuity,
// it falls through to that domain's single-record read module's own
// catch-all supports() -- which requires an active single-record
// context a scheduling reference never has, producing a misleading
// "I don't have a specific X open to check..." PRIMARY answer, rendered
// alongside (and contradicting) the correct automation-suggestion card
// corporateOfficeInternalPolicy.ts's toolProposals() independently
// attaches for the same message. A scheduling/recurrence reference must
// never be claimed by ANY single-record (or list) read module -- let it
// fall through to the generic degraded-answer rescue instead, same as
// any other unclaimed office_internal message. Applied uniformly below
// to every office_internal read module, not just Tasks.
function isAutomationScheduleReferenceMessage(message: string): boolean {
  return isAutomationScheduleOrRecurrenceMessage(message);
}

function officeTasksReadModule(): CapabilityModule {
  return readModule({
    key: "office_tasks.read",
    domain: "office_tasks",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["tasks.read"],
    evidenceRequirements: [{ domain: "office_tasks", evidence_type: "office_task_selected", freshness: ["fresh", "unknown"], required: false }],
    // Mutually exclusive with office_tasks.write's own supports() (Phase 3)
    // and office_tasks.query.read's own supports() (Phase 4) by
    // construction -- a mutation-intent message ("move this to in
    // progress") is claimed by the write capability, a plural list query
    // ("show my overdue tasks") is claimed by the query capability, so
    // there's no tie-break to reason about.
    supports: (frame: SemanticFrame) =>
      frame.domain === "office_tasks" &&
      !isTaskMutationMessage(frame.normalizedText) &&
      !isTaskListIntent(frame.normalizedText) &&
      !isAutomationScheduleReferenceMessage(frame.normalizedText),
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
      if (/\b(?:history|activity|log)\b/i.test(message)) {
        return {
          status: "answered",
          answer: `I don't have an activity history for ${label} available in this conversation yet — check the Audit Log tab on the task for that.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:owner|owns|assign\w*)\b/i.test(message)) {
        return {
          status: "answered",
          answer: task.owner ? `${label} is owned by ${task.owner}.` : `${label} doesn't have an owner assigned yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:due|overdue|deadline|late)\b/i.test(message)) {
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
// office_internal — Tasks list (Phase 4, PR 2). Answers "show me my
// overdue tasks" / "what tasks are open" -- an aggregate the single-
// selected-record officeTasksReadModule above cannot answer (it only
// ever sees one task_context slot). Each task is wrapped in an
// evidenceEnvelope() carrying an IntelligenceFact payload (see collect()
// below) so it participates in the same generic evidence ->
// IntelligenceFact -> ResultSetContext pipeline as any other capability,
// which is what lets a later turn ("move the first two to Monday")
// resolve an ordinal reference against this list without any
// Office-specific plumbing.
// ---------------------------------------------------------------------
function taskOpenFact(task: NonNullable<OperationalSnapshot["tasks"]>["open"][number]): IntelligenceFact {
  return {
    fact_id: `office_task_open:${task.id}`,
    domain: "office_tasks",
    fact_type: "office_task_open",
    scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
    object: { object_type: "task", canonical_id: task.id, label: task.title },
    statement: `${task.title} — ${task.status}`,
    value: { status: task.status, priority: task.priority, owner: task.owner, due_at: task.due_at, overdue: task.overdue },
    previous_value: null,
    occurred_at: task.due_at,
    observed_at: new Date().toISOString(),
    source_type: "database",
    source_id: task.id,
    truth_state: "observed",
    confidence: 0.85,
    freshness: "unknown",
    privacy_class: officePrivate,
    permissions: [],
    evidence: [],
  };
}

// Phase 4 hotfix -- the ONE filtering decision ("overdue" phrasing means
// overdue-only), shared by collect() and answer() so the persisted
// result set always matches what was actually displayed and confirmed
// to the user. Previously duplicated independently in each, which is
// exactly how they drifted out of sync.
function officeTasksQueryRows(tasks: NonNullable<OperationalSnapshot["tasks"]>, normalizedMessage: string) {
  const wantsOverdueOnly = /\boverdue\b/i.test(normalizedMessage);
  return wantsOverdueOnly ? tasks.open.filter((task) => task.overdue) : tasks.open;
}

function officeTasksQueryReadModule(): CapabilityModule {
  return readModule({
    key: "office_tasks.query.read",
    domain: "office_tasks",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["tasks.read"],
    evidenceRequirements: [{ domain: "office_tasks", evidence_type: "office_task_open", freshness: ["fresh", "unknown"], required: false }],
    supports: (frame: SemanticFrame) =>
      frame.domain === "office_tasks" && !isTaskMutationMessage(frame.normalizedText) && isTaskListIntent(frame.normalizedText),
    collect: async (context) => {
      const snapshot = officeSnapshot(context);
      const tasks = snapshot?.tasks;
      if (!tasks) return [];
      // Phase 4 hotfix (found in live production verification): collect()
      // must filter the SAME way answer() does below (see
      // officeTasksQueryRows), not return every open task regardless of
      // phrasing. Previously "show me my overdue tasks" ANSWERED with
      // only the overdue ones but registered ALL open tasks (including
      // non-overdue ones) as the persisted result set -- so "move the
      // first two" on the next turn resolved against the wrong,
      // unfiltered list instead of the two tasks actually shown.
      const rows = officeTasksQueryRows(tasks, normalizeMessage(context));
      // Phase 4 hotfix (found in live production verification, not
      // caught by unit tests that call collect()/answer() directly and
      // so never exercise CapabilityService's assertEvidenceAllowed
      // gate) -- evidenceFromFact() is a Consumer/Facility helper whose
      // privacyForFact() ignores whatever privacy_class the fact itself
      // carries and defaults anything it doesn't recognize (every
      // office_* domain) to "household_private", which privacyAllowed()
      // then unconditionally blocks on office_internal. Every OTHER
      // office_internal capability in this file builds its envelope via
      // evidenceEnvelope() directly with an explicit corporate privacy_
      // class for exactly this reason; this one now matches.
      return rows.map((task) => {
        const fact = taskOpenFact(task);
        return evidenceEnvelope({
          evidence_id: `capability:${fact.fact_id}`,
          domain: "office_tasks",
          type: fact.fact_type,
          object_type: "task",
          object_id: task.id,
          source: "domain_adapter",
          observed_at: fact.observed_at,
          freshness: "unknown",
          privacy_class: officePrivate,
          confidence: 0.85,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { fact },
        });
      });
    },
    answer: (context) => {
      const snapshot = officeSnapshot(context);
      if (!snapshot?.tasks) {
        return unavailableResult("I don't have a current read on tasks for this session — the Office tasks snapshot wasn't attached to this request.");
      }
      const message = normalizeMessage(context);
      const wantsOverdueOnly = /\boverdue\b/i.test(message);
      const { total_open: totalOpen } = snapshot.tasks;
      const rows = officeTasksQueryRows(snapshot.tasks, message);
      if (!rows.length) {
        return {
          status: "empty",
          answer: wantsOverdueOnly
            ? `No open tasks are overdue right now. There ${totalOpen === 1 ? "is" : "are"} ${totalOpen} open task${totalOpen === 1 ? "" : "s"} in total.`
            : "No open tasks right now.",
          presentation_policy: resultPresentation("list"),
          metadata: { total_open: totalOpen },
        };
      }
      const label = wantsOverdueOnly ? "overdue task" : "open task";
      const lines = rows
        .slice(0, 10)
        .map((task) => `${task.title} — ${task.status}${task.owner ? `, ${task.owner}` : ""}${task.due_at ? `, due ${task.due_at}` : ""}${task.overdue ? " (overdue)" : ""}`);
      return {
        status: "answered",
        answer: `${rows.length} ${label}${rows.length === 1 ? "" : "s"}${wantsOverdueOnly ? "" : ` out of ${totalOpen} total`}:\n${lines.map((line) => `• ${line}`).join("\n")}`,
        blocks: [
          {
            type: "record_list",
            title: wantsOverdueOnly ? "Overdue Tasks" : "Open Tasks",
            columns: [
              { key: "title", label: "Task" },
              { key: "status", label: "Status" },
              { key: "owner", label: "Owner" },
              { key: "due_at", label: "Due" },
            ],
            rows: rows.map((task) => ({ id: task.id, title: task.title, status: task.status, owner: task.owner, due_at: task.due_at })),
            total_count: totalOpen,
            truncated: rows.length < totalOpen,
          },
        ],
        presentation_policy: resultPresentation("list"),
        metadata: { total_open: totalOpen },
      };
    },
    primary: "list",
  });
}

// ---------------------------------------------------------------------
// office_internal — Automations (Oyi Conversational Runtime Completion
// Programme, second domain after Tasks — same template). Reuses the
// same "automations" domain Consumer's automations.list.read/
// automations.runs.read already classify on (ReadCapabilityModules.ts)
// rather than inventing an office-prefixed domain: CapabilityService.
// resolve() explicitly scores surface-compatible candidates before
// domain/text score (SemanticFrame carries no surface field, so this is
// the resolver's own documented mechanism for exactly this situation —
// several modules sharing one domain, disambiguated by
// supported_surfaces, never by the classifier). trigger/action are
// Office's own already-formatted display strings (humanizeAutomation-
// Trigger/automationActionSummary), not re-derived here. Like Tasks,
// this only answers about the specific automation currently selected —
// no aggregate list capability, and no lifecycle actions (pause/resume/
// run now/delete) here; those stay manual through the existing
// Automations detail panel, matching this pass's read-only scope.
// ---------------------------------------------------------------------
type AutomationContextSlot = {
  automation_ref: string | null;
  safe_summary: string | null;
  name?: string | null;
  enabled?: boolean;
  trigger?: string | null;
  action?: string | null;
  owner?: string | null;
  last_run_status?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
} | null;

function automationContextSlot(context: CapabilityContext): AutomationContextSlot {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const slot = (requestContext as Record<string, unknown>).automation_context;
  return slot && typeof slot === "object" ? (slot as AutomationContextSlot) : null;
}

// Mirrors office.js's automationStatusInfo() 3-line rule exactly (not
// enabled -> Paused; last run failed -> Needs Attention; else -> Active)
// so the two independent implementations describe the same automation
// the same way. Both are small enough that drift risk is low, and
// keeping the raw enabled/last_run_status fields on the wire (rather
// than a pre-composed label) matches how every other structured field
// on this contract stays raw and gets formatted at the point of use.
function describeAutomationStatus(automation: AutomationContextSlot): string {
  if (!automation) return "unknown";
  if (!automation.enabled) return "paused";
  if (automation.last_run_status === "failed") return "needs attention";
  return "active";
}

function officeAutomationsReadModule(): CapabilityModule {
  return readModule({
    key: "office_automations.read",
    domain: "automations",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["tasks.read"],
    evidenceRequirements: [{ domain: "automations", evidence_type: "office_automation_selected", freshness: ["fresh", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "automations" && !isAutomationScheduleReferenceMessage(frame.normalizedText),
    collect: async (context) => {
      const automation = automationContextSlot(context);
      if (!automation || !(automation.safe_summary || automation.name)) return [];
      return [
        evidenceEnvelope({
          domain: "automations",
          type: "office_automation_selected",
          object_type: "automation",
          object_id: automation.automation_ref,
          source: "domain_adapter",
          observed_at: automation.last_run_at || null,
          freshness: automation.last_run_at ? "fresh" : "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { automation },
        }),
      ];
    },
    answer: (context) => {
      const automation = automationContextSlot(context);
      if (!automation || !(automation.safe_summary || automation.name)) {
        return unavailableResult("I don't have a specific automation open to check — select one in Automations first, then ask me about it.");
      }
      const message = normalizeMessage(context);
      const label = automation.name || "This automation";

      if (/\btask\b/i.test(message)) {
        return {
          status: "answered",
          answer: `${label} isn't linked to a specific task — automations and tasks aren't connected records in this system.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:trigger|schedule\w*|when does|how often)\b/i.test(message)) {
        return {
          status: "answered",
          answer: automation.trigger ? `${label} runs ${automation.trigger}.` : `${label} doesn't have a trigger configured yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bnext run\b/i.test(message)) {
        return {
          status: "answered",
          answer: automation.enabled && automation.next_run_at ? `${label}'s next run is ${automation.next_run_at}.` : `${label} has no upcoming run scheduled.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:last run|ran last|recently)\b/i.test(message)) {
        if (!automation.last_run_at) {
          return { status: "answered", answer: `${label} hasn't run yet.`, presentation_policy: resultPresentation("text") };
        }
        return { status: "answered", answer: `${label} last ran ${automation.last_run_at} — ${automation.last_run_status || "unknown result"}.`, presentation_policy: resultPresentation("text") };
      }
      if (/\b(?:who owns|owner)\b/i.test(message)) {
        return {
          status: "answered",
          answer: automation.owner ? `${label} is owned by ${automation.owner}.` : `${label} doesn't have an owner assigned yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:what does .* do|action|what happens)\b/i.test(message)) {
        return {
          status: "answered",
          answer: automation.action ? `${label}: ${automation.action}.` : `${label} doesn't have an action configured yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:status|active|paused|running|enabled)\b/i.test(message)) {
        return { status: "answered", answer: `${label} is ${describeAutomationStatus(automation)}.`, presentation_policy: resultPresentation("text") };
      }

      const digest = automation.safe_summary || [label, describeAutomationStatus(automation), automation.trigger].filter(Boolean).join(" · ");
      return { status: "answered", answer: digest, presentation_policy: resultPresentation("text") };
    },
    primary: "text",
  });
}

// ---------------------------------------------------------------------
// office_internal — Meetings (Oyi Conversational Runtime Completion
// Programme, third domain — same template as Tasks/Automations). Reads
// only the currently-selected meeting (meeting_context), same
// single-record scope as Tasks/Automations — no aggregate meetings-list
// capability. Genuinely different from Tasks/Automations in one respect:
// a meeting CAN have a real linked follow-up task (office.js already
// resolves record.follow_up_task_id before building meeting_context), so
// that question is answered truthfully either way — present or absent —
// never a blanket "not tracked" statement like Tasks'
// workflow/automation-linkage answers.
// ---------------------------------------------------------------------
export type MeetingContextSlot = {
  meeting_ref: string | null;
  safe_summary: string | null;
  title?: string | null;
  status?: string | null;
  scheduled_at?: string | null;
  owner?: string | null;
  outcome?: string | null;
  related_type?: string | null;
  related_name?: string | null;
  follow_up_task_title?: string | null;
  follow_up_task_status?: string | null;
} | null;

export function meetingContextSlot(context: CapabilityContext): MeetingContextSlot {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const slot = (requestContext as Record<string, unknown>).meeting_context;
  return slot && typeof slot === "object" ? (slot as MeetingContextSlot) : null;
}

function officeMeetingsReadModule(): CapabilityModule {
  return readModule({
    key: "office_meetings.read",
    domain: "office_meetings",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["meetings.read"],
    evidenceRequirements: [{ domain: "office_meetings", evidence_type: "office_meeting_selected", freshness: ["fresh", "unknown"], required: false }],
    // Mutually exclusive with office_meetings.write's own supports() (Phase 3).
    supports: (frame: SemanticFrame) =>
      frame.domain === "office_meetings" &&
      !parseMeetingMutationIntent(frame.normalizedText) &&
      !isAutomationScheduleReferenceMessage(frame.normalizedText),
    collect: async (context) => {
      const meeting = meetingContextSlot(context);
      if (!meeting || !(meeting.safe_summary || meeting.title)) return [];
      return [
        evidenceEnvelope({
          domain: "office_meetings",
          type: "office_meeting_selected",
          object_type: "meeting",
          object_id: meeting.meeting_ref,
          source: "domain_adapter",
          observed_at: meeting.scheduled_at || null,
          freshness: meeting.scheduled_at ? "fresh" : "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { meeting },
        }),
      ];
    },
    answer: (context) => {
      const meeting = meetingContextSlot(context);
      if (!meeting || !(meeting.safe_summary || meeting.title)) {
        return unavailableResult("I don't have a specific meeting open to check — select one in Meetings first, then ask me about it.");
      }
      const message = normalizeMessage(context);
      const label = meeting.title || "This meeting";

      if (/\b(?:task|follow.?up)\b/i.test(message)) {
        return {
          status: "answered",
          answer: meeting.follow_up_task_title
            ? `${label} has a linked follow-up task: ${meeting.follow_up_task_title}${meeting.follow_up_task_status ? ` (${meeting.follow_up_task_status})` : ""}.`
            : `${label} doesn't have a follow-up task recorded yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:when|schedule[d]?)\b/i.test(message)) {
        return {
          status: "answered",
          answer: meeting.scheduled_at ? `${label} is scheduled for ${meeting.scheduled_at}.` : `${label} hasn't been scheduled yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:who owns|owner)\b/i.test(message)) {
        return {
          status: "answered",
          answer: meeting.owner ? `${label} is owned by ${meeting.owner}.` : `${label} doesn't have an owner assigned yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:outcome|result|how (?:did|was) (?:it|this|the meeting)|what happened)\b/i.test(message)) {
        return {
          status: "answered",
          answer: meeting.outcome ? `${label}'s outcome: ${meeting.outcome}.` : `${label} doesn't have an outcome recorded yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:related|connected to|linked to)\b/i.test(message)) {
        return {
          status: "answered",
          answer: meeting.related_name ? `${label} is related to the ${meeting.related_type || "record"} "${meeting.related_name}".` : `${label} isn't linked to a related record.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bstatus\b/i.test(message) && meeting.status) {
        return { status: "answered", answer: `${label} is ${meeting.status}.`, presentation_policy: resultPresentation("text") };
      }

      const digest = meeting.safe_summary || [label, meeting.status, meeting.scheduled_at].filter(Boolean).join(" · ");
      return { status: "answered", answer: digest, presentation_policy: resultPresentation("text") };
    },
    primary: "text",
  });
}

// ---------------------------------------------------------------------
// office_internal — Support (Oyi Conversational Runtime Completion
// Programme, fourth domain — same template as Tasks/Automations/
// Meetings). Reads only the currently-selected support case
// (support_context), same single-record scope as the others — no
// aggregate support-queue capability.
// ---------------------------------------------------------------------
export type SupportContextSlot = {
  support_case_ref: string | null;
  safe_summary: string | null;
  title?: string | null;
  status?: string | null;
  severity?: string | null;
  category?: string | null;
  product_area?: string | null;
  assigned_staff?: string | null;
  sla_target_at?: string | null;
  resolution_notes?: string | null;
  customer_name?: string | null;
  organization_name?: string | null;
} | null;

export function supportContextSlot(context: CapabilityContext): SupportContextSlot {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const slot = (requestContext as Record<string, unknown>).support_context;
  return slot && typeof slot === "object" ? (slot as SupportContextSlot) : null;
}

function officeSupportReadModule(): CapabilityModule {
  return readModule({
    key: "office_support.read",
    domain: "office_support",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["support.read"],
    evidenceRequirements: [{ domain: "office_support", evidence_type: "office_support_case_selected", freshness: ["fresh", "unknown"], required: false }],
    // Mutually exclusive with office_support.write's own supports() (Phase 3).
    supports: (frame: SemanticFrame) =>
      frame.domain === "office_support" &&
      !parseSupportMutationIntent(frame.normalizedText) &&
      !isAutomationScheduleReferenceMessage(frame.normalizedText),
    collect: async (context) => {
      const support = supportContextSlot(context);
      if (!support || !(support.safe_summary || support.title)) return [];
      return [
        evidenceEnvelope({
          domain: "office_support",
          type: "office_support_case_selected",
          object_type: "support_case",
          object_id: support.support_case_ref,
          source: "domain_adapter",
          observed_at: null,
          freshness: "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { support },
        }),
      ];
    },
    answer: (context) => {
      const support = supportContextSlot(context);
      if (!support || !(support.safe_summary || support.title)) {
        return unavailableResult("I don't have a specific support case open to check — select one in Support first, then ask me about it.");
      }
      const message = normalizeMessage(context);
      const label = support.title || "This case";

      if (/\b(?:customer|organization|who is this .*(?:for|from))\b/i.test(message)) {
        const who = [support.customer_name, support.organization_name].filter(Boolean).join(" at ");
        return {
          status: "answered",
          answer: who ? `${label} is for ${who}.` : `${label} doesn't have a customer or organization recorded yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:severity|urgent|priority)\b/i.test(message)) {
        return {
          status: "answered",
          answer: support.severity ? `${label} is ${support.severity} severity.` : `${label} doesn't have a severity set yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:category|product area|what (?:kind|type) of)\b/i.test(message)) {
        const parts = [support.category, support.product_area].filter(Boolean).join(" · ");
        return {
          status: "answered",
          answer: parts ? `${label} is categorized as ${parts}.` : `${label} doesn't have a category set yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:sla|deadline|due)\b/i.test(message)) {
        return {
          status: "answered",
          answer: support.sla_target_at ? `${label}'s SLA target is ${support.sla_target_at}.` : `${label} doesn't have an SLA target set.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:resolv\w*|fixed)\b/i.test(message)) {
        return {
          status: "answered",
          answer: support.resolution_notes ? `${label}'s resolution: ${support.resolution_notes}.` : `${label} doesn't have resolution notes recorded yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:who.?s (?:working|assigned)|assigned to|owner)\b/i.test(message)) {
        return {
          status: "answered",
          answer: support.assigned_staff ? `${label} is assigned to ${support.assigned_staff}.` : `${label} isn't assigned to anyone yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bstatus\b/i.test(message) && support.status) {
        return { status: "answered", answer: `${label} is ${support.status}.`, presentation_policy: resultPresentation("text") };
      }

      const digest = support.safe_summary || [label, support.status, support.severity].filter(Boolean).join(" · ");
      return { status: "answered", answer: digest, presentation_policy: resultPresentation("text") };
    },
    primary: "text",
  });
}

// ---------------------------------------------------------------------
// office_internal — Portfolio (Oyi Conversational Runtime Completion
// Programme, fifth domain — same template as Tasks/Automations/
// Meetings/Support). Genuinely different shape from the other four:
// operational numbers (homes/devices/escalations) only exist when the
// entry is actually linked to a live Oyi deployment, so this always
// checks projection_state first and answers honestly about which of
// the three real states applies (linked / live-read-unavailable-right-
// now / never-linked) rather than treating "no numbers" as one
// undifferentiated blank.
// ---------------------------------------------------------------------
type PortfolioContextSlot = {
  portfolio_ref: string | null;
  backend_building_ref: string | null;
  safe_summary: string | null;
  name?: string | null;
  relationship_type?: string | null;
  business_unit?: string | null;
  status?: string | null;
  oyi_deployment_status?: string | null;
  facility_os_status?: string | null;
  consumer_os_status?: string | null;
  support_status?: string | null;
  health_summary?: string | null;
  major_escalations?: number | null;
  projection_state?: "linked" | "unavailable" | "not_linked" | null;
  homes_total?: number | null;
  homes_active?: number | null;
  devices_total?: number | null;
  devices_online?: number | null;
  major_open_escalations?: number | null;
} | null;

function portfolioContextSlot(context: CapabilityContext): PortfolioContextSlot {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const slot = (requestContext as Record<string, unknown>).portfolio_context;
  return slot && typeof slot === "object" ? (slot as PortfolioContextSlot) : null;
}

function describeOperationalState(portfolio: PortfolioContextSlot): string {
  if (!portfolio) return "unknown";
  if (portfolio.projection_state === "linked") {
    return `${portfolio.homes_active ?? "—"}/${portfolio.homes_total ?? "—"} homes active, ${portfolio.devices_online ?? "—"}/${portfolio.devices_total ?? "—"} devices online, ${portfolio.major_open_escalations ?? 0} major open escalation${portfolio.major_open_escalations === 1 ? "" : "s"}`;
  }
  if (portfolio.projection_state === "unavailable") return "live Oyi operational data is currently unavailable";
  return "not yet linked to a live Oyi deployment reference";
}

function officePortfolioReadModule(): CapabilityModule {
  return readModule({
    key: "office_portfolio.read",
    domain: "office_portfolio",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["portfolio.read"],
    evidenceRequirements: [{ domain: "office_portfolio", evidence_type: "office_portfolio_entry_selected", freshness: ["fresh", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "office_portfolio" && !isAutomationScheduleReferenceMessage(frame.normalizedText),
    collect: async (context) => {
      const portfolio = portfolioContextSlot(context);
      if (!portfolio || !(portfolio.safe_summary || portfolio.name)) return [];
      return [
        evidenceEnvelope({
          domain: "office_portfolio",
          type: "office_portfolio_entry_selected",
          object_type: "portfolio_entry",
          object_id: portfolio.portfolio_ref,
          source: "domain_adapter",
          observed_at: null,
          freshness: portfolio.projection_state === "linked" ? "fresh" : "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { portfolio },
        }),
      ];
    },
    answer: (context) => {
      const portfolio = portfolioContextSlot(context);
      if (!portfolio || !(portfolio.safe_summary || portfolio.name)) {
        return unavailableResult("I don't have a specific portfolio entry open to check — select one in Portfolio first, then ask me about it.");
      }
      const message = normalizeMessage(context);
      const label = portfolio.name || "This portfolio entry";

      if (/\b(?:home|homes|device|devices|escalation\w*|operational|online)\b/i.test(message)) {
        return { status: "answered", answer: `${label}: ${describeOperationalState(portfolio)}.`, presentation_policy: resultPresentation("text") };
      }
      if (/\b(?:deployment|deployed|oyi)\b/i.test(message)) {
        return {
          status: "answered",
          answer: portfolio.oyi_deployment_status ? `${label}'s Oyi deployment is ${portfolio.oyi_deployment_status}.` : `${label} doesn't have a deployment status set.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:facility os|facility system)\b/i.test(message)) {
        return {
          status: "answered",
          answer: portfolio.facility_os_status ? `${label}'s Facility OS is ${portfolio.facility_os_status}.` : `${label} doesn't have a Facility OS status set.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:consumer os|resident app|consumer app)\b/i.test(message)) {
        return {
          status: "answered",
          answer: portfolio.consumer_os_status ? `${label}'s Consumer OS is ${portfolio.consumer_os_status}.` : `${label} doesn't have a Consumer OS status set.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:health|going|doing)\b/i.test(message)) {
        return {
          status: "answered",
          answer: portfolio.health_summary ? `${label}: ${portfolio.health_summary}.` : `${label} doesn't have a health summary recorded yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:relationship|account type)\b/i.test(message) && portfolio.relationship_type) {
        return { status: "answered", answer: `${label} is a ${portfolio.relationship_type} relationship.`, presentation_policy: resultPresentation("text") };
      }
      if (/\bstatus\b/i.test(message) && portfolio.status) {
        return { status: "answered", answer: `${label} is ${portfolio.status}.`, presentation_policy: resultPresentation("text") };
      }

      const digest = portfolio.safe_summary || [label, portfolio.relationship_type, describeOperationalState(portfolio)].filter(Boolean).join(" · ");
      return { status: "answered", answer: digest, presentation_policy: resultPresentation("text") };
    },
    primary: "text",
  });
}

// ---------------------------------------------------------------------
// office_internal — Partnerships (Oyi Conversational Runtime Completion
// Programme, sixth domain). Deliberately reuses the "corporate_partnerships"
// domain classifyDomain() already resolves for the public site's "how do
// I partner with Ochiga" phrasing, rather than adding a new office_*
// domain -- same precedent as Automations reusing Consumer's "automations"
// domain. capabilityService.resolve() disambiguates purely by
// supported_surfaces (office_internal here vs. public_corporate for
// corporate.partnerships.read), sorting surface-compatible candidates
// above incompatible ones regardless of score, so no languageUnderstanding.ts
// change is needed -- verified in the regression script below.
// ---------------------------------------------------------------------
type PartnershipContextSlot = {
  partnership_ref: string | null;
  safe_summary: string | null;
  relationship_type?: string | null;
  review_status?: string | null;
  business_unit?: string | null;
  relationship_manager?: string | null;
  organization_name?: string | null;
  opportunity_type?: string | null;
  last_contact_status?: string | null;
  last_contact_mode?: string | null;
} | null;

function partnershipContextSlot(context: CapabilityContext): PartnershipContextSlot {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const slot = (requestContext as Record<string, unknown>).partnership_context;
  return slot && typeof slot === "object" ? (slot as PartnershipContextSlot) : null;
}

function officePartnershipsReadModule(): CapabilityModule {
  return readModule({
    key: "office_partnerships.read",
    domain: "corporate_partnerships",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["partnerships.read"],
    evidenceRequirements: [{ domain: "corporate_partnerships", evidence_type: "office_partnership_selected", freshness: ["fresh", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "corporate_partnerships" && !isAutomationScheduleReferenceMessage(frame.normalizedText),
    collect: async (context) => {
      const partnership = partnershipContextSlot(context);
      if (!partnership || !partnership.safe_summary) return [];
      return [
        evidenceEnvelope({
          domain: "corporate_partnerships",
          type: "office_partnership_selected",
          object_type: "partnership_relationship",
          object_id: partnership.partnership_ref,
          source: "domain_adapter",
          observed_at: null,
          freshness: "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { partnership },
        }),
      ];
    },
    answer: (context) => {
      const partnership = partnershipContextSlot(context);
      if (!partnership || !partnership.safe_summary) {
        return unavailableResult("I don't have a specific partnership open to check — select one in Partnerships first, then ask me about it.");
      }
      const message = normalizeMessage(context);
      const label = partnership.organization_name || "This partnership";

      if (/\b(?:status|review)\b/i.test(message) && partnership.review_status) {
        return { status: "answered", answer: `${label} is ${partnership.review_status}.`, presentation_policy: resultPresentation("text") };
      }
      if (/\b(?:manager|who.?s (?:managing|handling)|owner)\b/i.test(message)) {
        return {
          status: "answered",
          answer: partnership.relationship_manager ? `${label} is managed by ${partnership.relationship_manager}.` : `${label} doesn't have a relationship manager assigned yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:organization|organisation|company)\b/i.test(message)) {
        return {
          status: "answered",
          answer: partnership.organization_name ? `${label} is with ${partnership.organization_name}.` : `This partnership doesn't have an organization recorded yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bopportunit(?:y|ies)\b/i.test(message)) {
        return {
          status: "answered",
          answer: partnership.opportunity_type ? `${label} has a linked ${partnership.opportunity_type} opportunity.` : `${label} isn't linked to a specific opportunity — these aren't connected records in this system.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:contact\w*|communicat\w*|handoff|touch\w*|reach\w*)\b/i.test(message)) {
        const via = [partnership.last_contact_status, partnership.last_contact_mode].filter(Boolean).join(" via ");
        return {
          status: "answered",
          answer: via ? `${label}'s last communication: ${via}.` : `${label} doesn't have a communication logged yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:business unit|unit)\b/i.test(message) && partnership.business_unit) {
        return { status: "answered", answer: `${label} sits under ${partnership.business_unit}.`, presentation_policy: resultPresentation("text") };
      }
      if (/\b(?:relationship type|what kind of)\b/i.test(message) && partnership.relationship_type) {
        return { status: "answered", answer: `${label} is a ${partnership.relationship_type} relationship.`, presentation_policy: resultPresentation("text") };
      }

      const digest = partnership.safe_summary || [label, partnership.relationship_type, partnership.review_status].filter(Boolean).join(" · ");
      return { status: "answered", answer: digest, presentation_policy: resultPresentation("text") };
    },
    primary: "text",
  });
}

// ---------------------------------------------------------------------
// office_internal — Documents (Oyi Conversational Runtime Completion
// Programme, seventh domain -- and the first explicitly scoped as
// STRICTLY READ-ONLY: no drafting, generation, sending, approval or
// publishing of any kind, per instruction). document_context only ever
// carries metadata already rendered on the Documents detail page (title,
// type, status, owner, related record) -- never the file body/contents,
// which may carry sensitive commercial detail Oyi Core has no need to
// see just to answer "what is this document about" (mirrors office.js's
// documentOyiSafeSummary comment exactly). A staff member asking Oyi to
// summarize/read/draft/send/approve/publish a document gets an honest
// "I can only see this document's metadata, not its contents" answer,
// never a fabricated summary and never an action.
// ---------------------------------------------------------------------
type DocumentContextSlot = {
  document_ref: string | null;
  safe_summary: string | null;
  title?: string | null;
  document_type?: string | null;
  status?: string | null;
  owner?: string | null;
  related_type?: string | null;
  related_name?: string | null;
} | null;

function documentContextSlot(context: CapabilityContext): DocumentContextSlot {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const slot = (requestContext as Record<string, unknown>).document_context;
  return slot && typeof slot === "object" ? (slot as DocumentContextSlot) : null;
}

function officeDocumentsReadModule(): CapabilityModule {
  return readModule({
    key: "office_documents.read",
    domain: "office_documents",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["documents.generate"],
    evidenceRequirements: [{ domain: "office_documents", evidence_type: "office_document_selected", freshness: ["fresh", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "office_documents" && !isAutomationScheduleReferenceMessage(frame.normalizedText),
    collect: async (context) => {
      const document = documentContextSlot(context);
      if (!document || !(document.safe_summary || document.title)) return [];
      return [
        evidenceEnvelope({
          domain: "office_documents",
          type: "office_document_selected",
          object_type: "document",
          object_id: document.document_ref,
          source: "domain_adapter",
          observed_at: null,
          freshness: "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { document },
        }),
      ];
    },
    answer: (context) => {
      const document = documentContextSlot(context);
      if (!document || !(document.safe_summary || document.title)) {
        return unavailableResult("I don't have a specific document open to check — select one in Documents first, then ask me about it.");
      }
      const message = normalizeMessage(context);
      const label = document.title || "This document";

      if (/\b(?:say|says|summarize|summarise|contents?|read it|what.?s in it|what does it contain)\b/i.test(message)) {
        return {
          status: "answered",
          answer: `I can only see ${label}'s metadata — title, type, status and owner — not the file's contents, so I can't summarize or read it. Open it in Documents to review the actual content.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:draft|generate|send|approve|approval|publish)\b/i.test(message)) {
        return {
          status: "answered",
          answer: `I can only look up ${label.toLowerCase() === "this document" ? "this document's" : `${label}'s`} status and metadata — drafting, sending, approving or publishing documents isn't something I can do from chat yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bstatus\b/i.test(message) && document.status) {
        return { status: "answered", answer: `${label} is ${document.status}.`, presentation_policy: resultPresentation("text") };
      }
      if (/\b(?:owner|who (?:owns|created|made))\b/i.test(message)) {
        return {
          status: "answered",
          answer: document.owner ? `${label} is owned by ${document.owner}.` : `${label} doesn't have an owner recorded.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:type|kind of document)\b/i.test(message) && document.document_type) {
        return { status: "answered", answer: `${label} is a ${document.document_type} document.`, presentation_policy: resultPresentation("text") };
      }
      if (/\b(?:related|linked|about which|which (?:lead|opportunity|partnership|project))\b/i.test(message)) {
        return {
          status: "answered",
          answer: document.related_name ? `${label} is related to ${(document.related_type || "a record").replace(/_/g, " ")}: ${document.related_name}.` : `${label} isn't linked to a specific record.`,
          presentation_policy: resultPresentation("text"),
        };
      }

      const digest = document.safe_summary || [label, document.document_type, document.status].filter(Boolean).join(" · ");
      return { status: "answered", answer: digest, presentation_policy: resultPresentation("text") };
    },
    primary: "text",
  });
}

// ---------------------------------------------------------------------
// office_internal — Content (Oyi Conversational Runtime Completion
// Programme, eighth domain -- also STRICTLY READ-ONLY: no drafting,
// generation, review-state changes or publishing. excerpt is real
// short-form metadata Office already surfaces on the Content editor page
// (contentOyiSafeSummary), never the full article body, so Oyi can
// legitimately describe what an article is about from the excerpt
// without ever claiming to have read or be able to edit the full text.
// ---------------------------------------------------------------------
type ContentContextSlot = {
  content_ref: string | null;
  safe_summary: string | null;
  title?: string | null;
  workflow_status?: string | null;
  category?: string | null;
  author?: string | null;
  excerpt?: string | null;
  scheduled_publish_at?: string | null;
  sanity_live_url?: string | null;
} | null;

function contentContextSlot(context: CapabilityContext): ContentContextSlot {
  const requestContext = context.input.context;
  if (!requestContext || typeof requestContext !== "object" || Array.isArray(requestContext)) return null;
  const slot = (requestContext as Record<string, unknown>).content_context;
  return slot && typeof slot === "object" ? (slot as ContentContextSlot) : null;
}

function officeContentReadModule(): CapabilityModule {
  return readModule({
    key: "office_content.read",
    domain: "office_content",
    operations: readOperations,
    supportedSurfaces: ["office_internal"],
    permissions: ["content.write"],
    evidenceRequirements: [{ domain: "office_content", evidence_type: "office_content_selected", freshness: ["fresh", "unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "office_content" && !isAutomationScheduleReferenceMessage(frame.normalizedText),
    collect: async (context) => {
      const content = contentContextSlot(context);
      if (!content || !(content.safe_summary || content.title)) return [];
      return [
        evidenceEnvelope({
          domain: "office_content",
          type: "office_content_selected",
          object_type: "content_article",
          object_id: content.content_ref,
          source: "domain_adapter",
          observed_at: null,
          freshness: "unknown",
          privacy_class: officePrivate,
          confidence: 0.9,
          authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
          payload: { content },
        }),
      ];
    },
    answer: (context) => {
      const content = contentContextSlot(context);
      if (!content || !(content.safe_summary || content.title)) {
        return unavailableResult("I don't have a specific article open to check — select one in Content first, then ask me about it.");
      }
      const message = normalizeMessage(context);
      const label = content.title || "This article";

      if (/\b(?:draft|generate|write|edit|approve|approval|publish|schedule it)\b/i.test(message)) {
        return {
          status: "answered",
          answer: `I can only look up ${label}'s status and metadata — drafting, editing, approving or publishing articles isn't something I can do from chat yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bstatus\b/i.test(message) && content.workflow_status) {
        return { status: "answered", answer: `${label} is ${content.workflow_status}.`, presentation_policy: resultPresentation("text") };
      }
      if (/\b(?:category)\b/i.test(message)) {
        return {
          status: "answered",
          answer: content.category ? `${label} is in the ${content.category} category.` : `${label} doesn't have a category set yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\bauthor\b/i.test(message)) {
        return {
          status: "answered",
          answer: content.author ? `${label} is written by ${content.author}.` : `${label} doesn't have an author recorded.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:scheduled|when.*(?:publish|go live|goes live))\b/i.test(message)) {
        return {
          status: "answered",
          answer: content.scheduled_publish_at ? `${label} is scheduled to publish ${content.scheduled_publish_at}.` : `${label} doesn't have a publish date scheduled.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:live|is it published|url|link)\b/i.test(message)) {
        return {
          status: "answered",
          answer: content.sanity_live_url ? `${label} is live at ${content.sanity_live_url}.` : `${label} isn't live yet.`,
          presentation_policy: resultPresentation("text"),
        };
      }
      if (/\b(?:about|excerpt|summary|what.?s it about)\b/i.test(message)) {
        return {
          status: "answered",
          answer: content.excerpt ? `${label}: ${content.excerpt}` : `${label} doesn't have an excerpt written yet — I can't see the full article body.`,
          presentation_policy: resultPresentation("text"),
        };
      }

      const digest = content.safe_summary || [label, content.workflow_status, content.category].filter(Boolean).join(" · ");
      return { status: "answered", answer: digest, presentation_policy: resultPresentation("text") };
    },
    primary: "text",
  });
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
  return [crmLeadsReadModule(), crmOpportunitiesReadModule(), reportsApprovalsReadModule(), developmentStatusReadModule(), financialSummaryReadModule(), officeTasksReadModule(), officeTasksQueryReadModule(), officeAutomationsReadModule(), officeMeetingsReadModule(), officeSupportReadModule(), officePortfolioReadModule(), officePartnershipsReadModule(), officeDocumentsReadModule(), officeContentReadModule()];
}

export function buildPublicCorporateReadCapabilities(): CapabilityModule[] {
  return [corporateCompanyReadModule(), corporateDevelopmentReadModule(), corporateOyiReadModule(), corporatePrivateReadModule(), corporatePartnershipsReadModule()];
}
