import type { CanonicalConversationResponse } from "../contracts/canonicalConversation";
import {
  CORPORATE_INTELLIGENCE_CONTRACT_VERSION,
  type CorporateBusinessUnit,
  type CorporateToolProposal,
  type OfficeInternalOyiCoreRequest,
  type OfficeInternalOyiCoreResponse,
} from "../../contracts/corporateIntelligence";

function text(value: unknown, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function normalize(value: unknown) {
  return text(value).toLowerCase();
}

export function deniedOfficeInternalOperationalRequest(input: { message?: string; permissions?: string[] } = {}) {
  const message = normalize(input.message);
  const permissions = new Set(Array.isArray(input.permissions) ? input.permissions : []);
  const deepOperational =
    /\b(unlock|lock door|open gate|visitor code|approve visitor|revoke access|fund wallet|pay wallet|buy electricity|turn on|turn off|switch device|control device)\b/.test(message);
  if (!deepOperational) return false;
  return !permissions.has("facility.deep_action") && !permissions.has("operations.execute");
}

function businessDomain(request: OfficeInternalOyiCoreRequest): CorporateBusinessUnit {
  const allowed = new Set(["development", "technology", "private", "partnerships", "corporate"]);
  return allowed.has(request.business_unit) ? request.business_unit : "corporate";
}

// Presence/content of a named context slot is a more reliable signal than guessing from free text,
// since Office already knows what record the staff member is looking at.
const CONTEXT_SLOT_BY_SELECTED_TYPE: Record<string, keyof OfficeInternalOyiCoreRequest> = {
  crm: "crm_context",
  lead: "crm_context",
  contact: "crm_context",
  opportunity: "crm_context",
  portfolio: "portfolio_context",
  building: "portfolio_context",
  support: "support_context",
  case: "support_context",
  ticket: "support_context",
  project: "project_context",
  task: "task_context",
  automation: "automation_context",
  meeting: "meeting_context",
  partnership: "partnership_context",
  document: "document_context",
  content: "content_context",
  article: "content_context",
};

const CONTEXT_SLOT_FALLBACK_ORDER: Array<keyof OfficeInternalOyiCoreRequest> = [
  "crm_context",
  "project_context",
  "task_context",
  "automation_context",
  "meeting_context",
  "partnership_context",
  "portfolio_context",
  "support_context",
  "document_context",
  "content_context",
];

type SafeSummarySlot = { safe_summary: string | null } | null | undefined;

function selectedContextSlot(request: OfficeInternalOyiCoreRequest): SafeSummarySlot {
  const selectedType = normalize(request.page_context.selected_type);
  const preferredKey = CONTEXT_SLOT_BY_SELECTED_TYPE[selectedType];
  const preferred = preferredKey ? (request[preferredKey] as SafeSummarySlot) : null;
  if (preferred && text(preferred.safe_summary)) return preferred;
  for (const key of CONTEXT_SLOT_FALLBACK_ORDER) {
    const slot = request[key] as SafeSummarySlot;
    if (slot && text(slot.safe_summary)) return slot;
  }
  return null;
}

function attentionSignal(request: OfficeInternalOyiCoreRequest): OfficeInternalOyiCoreResponse["attention_signal"] {
  const message = normalize(request.message);
  if (/support|case|ticket|escalat|sla/.test(message)) return "support";
  if (/private|member|membership/.test(message)) return "private";
  if (/handoff|human|assign/.test(message)) return "handoff";
  if (/meeting|calendar|schedule/.test(message) || request.meeting_context) return "meeting";
  if (/project|milestone|development|site/.test(message) || request.project_context) return "project";
  if (/portfolio|building|deployment|health/.test(message) || request.portfolio_context) return "portfolio";
  if (/partner|partnership|integrator|capital|landowner/.test(message) || request.partnership_context) return "partnership";
  if (/follow.?up|overdue|attention|due/.test(message)) return "follow_up";
  if (request.task_context && /overdue|due|late/i.test(text(request.task_context.safe_summary))) return "follow_up";
  return "none";
}

function toolProposals(request: OfficeInternalOyiCoreRequest): CorporateToolProposal[] {
  const message = normalize(request.message);
  const proposals: CorporateToolProposal[] = [];
  const taskSummary = text(request.task_context?.safe_summary);
  const meetingSummary = text(request.meeting_context?.safe_summary);
  if (/follow.?up|task|remind/.test(message) || /overdue|due|late/i.test(taskSummary)) {
    proposals.push({
      proposal_id: `office_task_${request.request_id}`,
      tool: "office.create_followup_task",
      governance: "office_validates_before_execution",
      reason: taskSummary
        ? `The linked task context indicates a follow-up may be needed ("${taskSummary.slice(0, 160)}"). Office must validate ownership and due date before persistence.`
        : "Office staff asked for a follow-up or task. Office must validate ownership and due date before persistence.",
      parameters: {
        business_unit: request.business_unit,
        selected_type: request.page_context.selected_type,
        selected_id: request.page_context.selected_id || request.task_context?.task_ref || null,
        review_required: true,
      },
    });
  }
  if (/quote|proposal|scope of work|commercial document/.test(message)) {
    proposals.push({
      proposal_id: `office_document_${request.request_id}`,
      tool: "office.prepare_commercial_document",
      governance: "office_validates_before_execution",
      reason: "Commercial document drafting must use approved Office templates and cannot invent pricing. Staff review is required before send/export.",
      parameters: {
        business_unit: request.business_unit,
        pricing_policy: "approved_truth_required",
        review_required: true,
      },
    });
  }
  if (/meeting|calendar|schedule/.test(message) && meetingSummary) {
    proposals.push({
      proposal_id: `office_meeting_${request.request_id}`,
      tool: "office.review_meeting_context",
      governance: "office_validates_before_execution",
      reason: `The linked meeting context is available ("${meetingSummary.slice(0, 160)}"). Office should confirm attendees and agenda before acting on it.`,
      parameters: {
        business_unit: request.business_unit,
        selected_type: "meeting",
        selected_id: request.meeting_context?.meeting_ref || null,
        review_required: true,
      },
    });
  }
  // Deliberately narrow, deliberately shallow: this only proposes that
  // staff open the real New Automation wizard, never a trigger/action
  // guess. Oyi Core has no reliable way to infer an exact schedule or
  // workflow target from conversation, and the wizard's own validation
  // (validateWorkflowActions on the backend) is the only place that's
  // allowed to decide an automation is well-formed. suggested_name is an
  // editable starting point, not a stored fact.
  if (/\b(automat|recurring|every (day|week|time)|whenever|set up a rule)\b/i.test(request.message)) {
    proposals.push({
      proposal_id: `office_automation_${request.request_id}`,
      tool: "office.create_automation",
      governance: "office_validates_before_execution",
      reason: "This sounds like it should run on a repeating schedule rather than as a one-off task. Office must define the exact trigger and action before anything is created.",
      parameters: {
        business_unit: request.business_unit,
        selected_type: request.page_context.selected_type,
        selected_id: request.page_context.selected_id || request.automation_context?.automation_ref || null,
        suggested_name: text(request.message).slice(0, 120),
        review_required: true,
      },
    });
  }
  return proposals;
}

// Oyi Core's canonical evidence engine resolves facts for Consumer/Facility objects (device, room,
// scene, wallet, etc.) and has no object-resolution path for corporate business records yet, so it
// commonly falls back to a generic "not enough evidence" reply for office_internal messages even when
// Office already sent a safe_summary for the exact record the staff member is looking at. Rather than
// let that generic reply stand, ground the answer in the safe_summary Office already vouched for -
// this surfaces real context without fabricating anything Oyi Core itself did not verify.
//
// These two literal openings are ConversationOrchestrator.ts's buildBusinessSurfaceFallbackResponse()
// output verbatim (the only two strings office_internal's business-surface fallback ever produces:
// "I can help with {topics}...", or "I don't have an enabled capability for that yet on this
// surface." when no capability is registered at all) -- office_internal never reaches the legacy
// engine's degraded-evidence phrasing, so matching that instead (as this pattern previously did) meant
// the rescue never fired. Anchored to these exact openings on purpose: a real capability module's
// answer is free-form prose about actual data and can never start with either literal, so this can
// only ever intercept the generic fallback -- it structurally cannot override a registered capability's
// answer.
const DEGRADED_ANSWER_PATTERN = /^I can help with|^I don't have an enabled capability for that yet on this surface\./i;

function composeAnswer(request: OfficeInternalOyiCoreRequest, canonical: CanonicalConversationResponse): string {
  const canonicalAnswer = text(canonical.message || (canonical as any).assistant_message);
  const isDegraded = !canonicalAnswer || DEGRADED_ANSWER_PATTERN.test(canonicalAnswer);
  if (!isDegraded) return canonicalAnswer;
  const slot = selectedContextSlot(request);
  if (slot && text(slot.safe_summary)) {
    return `Based on current Office records: ${text(slot.safe_summary)}`;
  }
  return text(canonicalAnswer, "I can help with the authorised Office context, but I need a clearer corporate object or question.");
}

export function buildOfficeInternalResponse(
  request: OfficeInternalOyiCoreRequest,
  canonical: CanonicalConversationResponse
): OfficeInternalOyiCoreResponse {
  const answer = composeAnswer(request, canonical);
  return {
    ok: true,
    contract_version: CORPORATE_INTELLIGENCE_CONTRACT_VERSION,
    source: "oyi_core",
    surface: "office_internal",
    request_id: request.request_id,
    office_session_id: request.office_session_id,
    conversation_thread_id: text(canonical.thread_id || request.conversation_thread_id, request.office_session_id),
    answer,
    understood_intent: text((canonical as any).intent || request.requested_capability, "office_internal_conversation"),
    business_domain: businessDomain(request),
    suggested_next_action: text((canonical as any).suggested_next_action) || null,
    attention_signal: attentionSignal(request),
    tool_proposals: toolProposals(request),
    // Oyi Conversational Runtime Completion Programme, Phase 3. Governed
    // action proposals (Tasks/Meetings/Support write capabilities, see
    // OfficeActionCapabilityModules.ts) surface their public view through
    // canonical.confirmations -- an existing, generic "things needing
    // confirmation" pass-through field (CapabilityResponseAdapter.ts),
    // reused here rather than inventing a parallel one.
    pending_action: Array.isArray(canonical.confirmations) && canonical.confirmations.length ? canonical.confirmations[0] : null,
    knowledge_references: request.knowledge_context,
    safe_metadata: {
      staff_role: request.staff.role,
      selected_type: request.page_context.selected_type,
      selected_id_present: Boolean(request.page_context.selected_id),
      crm_context_present: Boolean(request.crm_context),
      portfolio_context_present: Boolean(request.portfolio_context),
      support_context_present: Boolean(request.support_context),
      project_context_present: Boolean(request.project_context),
      task_context_present: Boolean(request.task_context),
      automation_context_present: Boolean(request.automation_context),
      meeting_context_present: Boolean(request.meeting_context),
      partnership_context_present: Boolean(request.partnership_context),
      document_context_present: Boolean(request.document_context),
      content_context_present: Boolean(request.content_context),
    },
  };
}
