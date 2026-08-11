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

function attentionSignal(request: OfficeInternalOyiCoreRequest): OfficeInternalOyiCoreResponse["attention_signal"] {
  const message = normalize(request.message);
  if (/support|case|ticket|escalat|sla/.test(message)) return "support";
  if (/project|milestone|development|site/.test(message)) return "project";
  if (/portfolio|building|deployment|health/.test(message)) return "portfolio";
  if (/private|member|membership/.test(message)) return "private";
  if (/partner|partnership|integrator|capital|landowner/.test(message)) return "partnership";
  if (/handoff|human|assign/.test(message)) return "handoff";
  if (/follow.?up|overdue|attention|due/.test(message)) return "follow_up";
  return "none";
}

function toolProposals(request: OfficeInternalOyiCoreRequest): CorporateToolProposal[] {
  const message = normalize(request.message);
  const proposals: CorporateToolProposal[] = [];
  if (/follow.?up|task|remind/.test(message)) {
    proposals.push({
      proposal_id: `office_task_${request.request_id}`,
      tool: "office.create_followup_task",
      governance: "office_validates_before_execution",
      reason: "Office staff asked for a follow-up or task. Office must validate ownership and due date before persistence.",
      parameters: {
        business_unit: request.business_unit,
        selected_type: request.page_context.selected_type,
        selected_id: request.page_context.selected_id,
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
  return proposals;
}

export function buildOfficeInternalResponse(
  request: OfficeInternalOyiCoreRequest,
  canonical: CanonicalConversationResponse
): OfficeInternalOyiCoreResponse {
  const answer = text(canonical.message || (canonical as any).assistant_message, "I can help with the authorised Office context, but I need a clearer corporate object or question.");
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
    knowledge_references: request.knowledge_context,
    safe_metadata: {
      staff_role: request.staff.role,
      selected_type: request.page_context.selected_type,
      selected_id_present: Boolean(request.page_context.selected_id),
      crm_context_present: Boolean(request.crm_context),
      portfolio_context_present: Boolean(request.portfolio_context),
      support_context_present: Boolean(request.support_context),
    },
  };
}
