import type { CanonicalConversationResponse } from "../contracts/canonicalConversation";
import type {
  CorporateCommercialSignal,
  CorporateOyiCoreRequest,
  CorporateOyiCoreResponse,
  CorporateToolProposal,
} from "../../contracts/corporateIntelligence";
import {
  PUBLIC_CORPORATE_SURFACE_POLICY,
  isPublicOperationalRequestBlocked,
  routeCorporateBusinessUnit,
  selectCorporateAgentRole,
} from "../../contracts/corporateIntelligence";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function norm(value: unknown) {
  return text(value).toLowerCase();
}

export function deniedPublicCorporateOperationalRequest(input: { message?: string | null; domain?: string | null; action?: string | null }) {
  if (isPublicOperationalRequestBlocked({ domain: input.domain, action: input.action })) {
    return true;
  }
  const message = norm(input.message);
  return /\b(unlock|lock my|front door|visitor code|gate code|wallet balance|fund wallet|turn on|turn off|show my visitors|security camera|private message|resident record|facility admin)\b/.test(message);
}

function commercialSignal(message: string): CorporateCommercialSignal {
  const value = norm(message);
  if (/\b(human|call me|talk to someone|sales rep|representative)\b/.test(value)) return "handoff";
  if (/\b(proposal|quote|pricing|price|budget|commercials)\b/.test(value)) return "proposal";
  if (/\b(we manage|we operate|i own|our building|six buildings|apartment building|portfolio|units|lekki|land|membership|join)\b/.test(value)) return "qualification";
  if (/\b(install|deployment|develop|partner|membership|interested|existing development)\b/.test(value)) return "commercial_interest";
  if (/\b(what is|what does|explain|tell me about|how does)\b/.test(value)) return "education";
  return "none";
}

function qualificationSignal(message: string) {
  const value = norm(message);
  if (/\b(proposal|pricing|six buildings|portfolio|government|procurement|budget)\b/.test(value)) return "high" as const;
  if (/\b(we manage|we operate|i own|apartment building|land|membership|deployment|partner)\b/.test(value)) return "medium" as const;
  if (/\b(what is|what does|explain|general)\b/.test(value)) return "low" as const;
  return "unknown" as const;
}

function answerFor(request: CorporateOyiCoreRequest, canonical: CanonicalConversationResponse, signal: CorporateCommercialSignal) {
  // Prefer a real Oyi Core answer (now that corporate.company.read,
  // corporate.development.read, corporate.oyi.read, corporate.private.read
  // and corporate.partnerships.read exist and run through the capability
  // pipeline) over the generic hardcoded/business-unit-routing text below.
  // Signal detection, business_unit routing and tool proposals are
  // computed independently of this function and are unaffected.
  const canonicalAnswer = text(canonical.reply) || text(canonical.answer);
  if (canonicalAnswer) return canonicalAnswer;
  const message = norm(request.message);
  if (/\bwhat does ochiga do|what is ochiga|about ochiga\b/.test(message)) {
    return "Ochiga develops and powers intelligent places. The company combines real estate development, building technology through Oyi, private relationship-led opportunities, and structured partnerships.";
  }
  if (/\bwhat does oyi do|what is oyi|oyi do\b/.test(message)) {
    return "Oyi is Ochiga's living intelligence and operating layer for buildings and communities. It helps authorised teams understand operations, coordinate services, manage resident workflows, and connect physical infrastructure to safer digital action.";
  }
  if (request.business_unit === "development") {
    return "That sounds like a Development or land/JV conversation. I can capture the site context, ownership position, location and intended partnership path so Office can review the opportunity properly.";
  }
  if (request.business_unit === "private") {
    return "Ochiga Private is handled by request and review. I can keep your membership interest connected to this session and route it for Office review without making any approval promises.";
  }
  if (request.business_unit === "partnerships") {
    return "That looks like a partnership enquiry. I can route it by partner type, such as landowner/JV, capital, buyer/offtake, professional delivery, technology integrator, or strategic relationship.";
  }
  if (signal === "proposal" || signal === "qualification") {
    return "This now sounds commercially specific. I can keep the same conversation context and move it into the Sales qualification path so the Office team has the project facts, source and next action together.";
  }
  return canonical.reply || canonical.answer || "I can help with Ochiga, Oyi, Development, Private membership and partnership enquiries, then route the right next step through Ochiga Office.";
}

function buildToolProposals(request: CorporateOyiCoreRequest, signal: CorporateCommercialSignal): CorporateToolProposal[] {
  const proposals: CorporateToolProposal[] = [];
  if (signal !== "none" && signal !== "education") {
    proposals.push({
      tool: "crm.create_or_update_lead",
      governance: "office_validates_before_execution",
      reason: "commercial_interest_detected",
      parameters: {
        business_unit: request.business_unit,
        inquiry_type: request.inquiry_type,
        public_session_id: request.public_session_id,
        form_context_ref: request.form_context_ref,
      },
    });
  }
  if (signal === "qualification" || signal === "proposal") {
    proposals.push({
      tool: "crm.create_opportunity",
      governance: "office_validates_before_execution",
      reason: signal === "proposal" ? "proposal_interest_detected" : "qualification_signal_detected",
      parameters: {
        business_unit: request.business_unit,
        inquiry_type: request.inquiry_type,
        source_page: request.source.source_page,
      },
    });
  }
  if (signal === "handoff" || signal === "proposal") {
    proposals.push({
      tool: "office.request_handoff",
      governance: "office_validates_before_execution",
      reason: signal === "handoff" ? "human_handoff_requested" : "sales_followup_recommended",
      parameters: {
        public_session_id: request.public_session_id,
        agent_role: "osa",
        business_unit: request.business_unit,
      },
    });
  }
  return proposals;
}

export function buildCorporatePublicResponse(request: CorporateOyiCoreRequest, canonical: CanonicalConversationResponse): CorporateOyiCoreResponse {
  const routed = routeCorporateBusinessUnit({
    source_page: request.source.source_page,
    source_form: request.source.source_form,
    inquiry_type: request.inquiry_type,
    message: request.message,
    metadata: request.metadata,
  });
  const signal = commercialSignal(request.message);
  const role = selectCorporateAgentRole({
    business_unit: routed.business_unit,
    inquiry_type: routed.inquiry_type,
    lead_stage: signal === "qualification" || signal === "proposal" ? "interested" : "exploring",
    message: request.message,
  });
  const toolProposals = buildToolProposals({ ...request, business_unit: routed.business_unit, inquiry_type: routed.inquiry_type }, signal);
  return {
    ok: true,
    request_id: request.request_id,
    public_session_id: request.public_session_id,
    conversation_thread_id: canonical.thread_id || request.conversation_thread_id,
    public_identity: PUBLIC_CORPORATE_SURFACE_POLICY.public_identity,
    answer: answerFor({ ...request, business_unit: routed.business_unit, inquiry_type: routed.inquiry_type }, canonical, signal),
    understood_intent: canonical.understood || canonical.intent || "corporate_public_conversation",
    business_unit: routed.business_unit,
    inquiry_type: routed.inquiry_type,
    recommended_agent_role: role.agent_role,
    commercial_signal: signal,
    qualification_signal: qualificationSignal(request.message),
    suggested_next_action: toolProposals.length ? "Office should validate the proposed CRM workflow before mutating CRM state." : null,
    tool_proposals: toolProposals,
    handoff_recommended: toolProposals.some((proposal) => proposal.tool === "office.request_handoff"),
    knowledge_references: request.knowledge_context.map((item) => ({ id: item.id, title: item.title, source: item.source })),
    canonical: {
      response_id: canonical.id,
      thread_id: canonical.thread_id,
      persistence_saved: canonical.persistence_saved ?? null,
      source: "oyi_canonical_runtime",
    },
    safe_metadata: {
      oyi_surface: "public_corporate",
      canonical_intelligence_authority: "ochiga-backend",
      crm_source_of_truth: "ochiga-office",
      blocked_operational_domains: PUBLIC_CORPORATE_SURFACE_POLICY.blocked_operational_domains,
    },
  };
}
