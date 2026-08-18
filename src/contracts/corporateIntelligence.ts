import type { IntelligenceAgentId, IntelligenceSurface } from "../intelligence-core/types";

export const CORPORATE_INTELLIGENCE_CONTRACT_VERSION = "corporate-intelligence.2026-08-11" as const;

export type CorporateBusinessUnit =
  | "development"
  | "technology"
  | "private"
  | "partnerships"
  | "corporate";

export type CorporateInquiryType =
  | "land_jv"
  | "development_enquiry"
  | "project_interest"
  | "sales_offtake"
  | "oyi_enquiry"
  | "oyi_deployment_request"
  | "integrator_interest"
  | "technology_partnership"
  | "membership_interest"
  | "membership_request"
  | "opportunity_interest"
  | "landowner_jv"
  | "capital_partner"
  | "buyer_offtake"
  | "delivery_professional"
  | "strategic_partner"
  | "media"
  | "general_enquiry";

export type CorporateAgentRole = Extract<IntelligenceAgentId, "oma" | "osa">;

export type PublicIntelligenceMode =
  | "collapsed"
  | "proactive_prompt"
  | "text_conversation"
  | "voice_conversation"
  | "human_handoff"
  | "call_requested"
  | "future_video_session";

export type CorporateLeadStage =
  | "anonymous"
  | "exploring"
  | "interested"
  | "qualified"
  | "handoff_requested"
  | "human_owned";

export type CorporateSourceContext = {
  source_site: "ochiga_website" | "oyi_website" | "future_public_surface";
  source_page: string;
  source_form: string | null;
  source_channel: "website" | "widget" | "voice" | "form" | "api";
  campaign: Record<string, string>;
};

export type PublicCorporateSession = {
  session_id: string;
  anonymous: boolean;
  known_contact: boolean;
  source: CorporateSourceContext;
  business_unit: CorporateBusinessUnit;
  inquiry_type: CorporateInquiryType;
  conversation_thread_id: string | null;
  crm_contact_ref: string | null;
  crm_opportunity_ref: string | null;
  secure_form_context_ref: string | null;
  active_agent_role: CorporateAgentRole;
  lead_stage: CorporateLeadStage;
  engagement_mode: PublicIntelligenceMode;
  handoff_state: "none" | "requested" | "task_created" | "assigned" | "completed";
  voice_state: "none" | "ready" | "active" | "ended";
  proactive_prompt_state: "eligible" | "shown" | "dismissed" | "cooldown" | "disabled";
  consent: {
    analytics: boolean;
    marketing_followup: boolean;
    voice_transcription: boolean;
  };
  created_at: string;
  last_activity_at: string;
};

export type CorporateOyiCoreRequest = {
  request_id: string;
  message: string;
  public_session_id: string;
  conversation_thread_id: string | null;
  public_identity: string;
  agent_role: CorporateAgentRole;
  business_unit: CorporateBusinessUnit;
  inquiry_type: CorporateInquiryType;
  source: CorporateSourceContext;
  visitor_state: "anonymous" | "known";
  crm_context: {
    contact_ref: string | null;
    opportunity_ref: string | null;
    lead_ref: string | null;
    safe_summary: string | null;
  };
  form_context_ref: string | null;
  engagement_mode: PublicIntelligenceMode;
  handoff_state: PublicCorporateSession["handoff_state"];
  requested_capability: PublicCorporateCapability | null;
  knowledge_context: CorporateKnowledgeReference[];
  metadata: Record<string, unknown>;
};

export type CorporateKnowledgeReference = { id: string; title: string; excerpt: string; source: string };

export type CorporateCommercialSignal =
  | "none"
  | "education"
  | "commercial_interest"
  | "qualification"
  | "proposal"
  | "handoff";

export type CorporateToolProposal = {
  proposal_id?: string;
  tool: "crm.update_journey" | "crm.create_or_update_lead" | "crm.create_opportunity" | "office.create_followup_task" | "office.prepare_commercial_document" | "office.request_handoff" | "office.review_meeting_context";
  governance: "office_validates_before_execution";
  reason: string;
  parameters: Record<string, unknown>;
};

export type CorporateOyiCoreResponse = {
  ok: boolean;
  request_id: string;
  public_session_id: string;
  conversation_thread_id: string | null;
  public_identity: string;
  answer: string;
  understood_intent: string;
  business_unit: CorporateBusinessUnit;
  inquiry_type: CorporateInquiryType;
  recommended_agent_role: CorporateAgentRole;
  commercial_signal: CorporateCommercialSignal;
  qualification_signal: "unknown" | "low" | "medium" | "high";
  suggested_next_action: string | null;
  tool_proposals: CorporateToolProposal[];
  handoff_recommended: boolean;
  knowledge_references: Array<{ id: string; title: string; source: string }>;
  canonical: {
    response_id: string;
    thread_id: string | null;
    persistence_saved: boolean | null;
    source: "oyi_canonical_runtime";
  };
  safe_metadata: Record<string, unknown>;
};

export type CorporateMaterialEventType =
  | "lead_created"
  | "lead_qualified"
  | "opportunity_created"
  | "opportunity_stage_changed"
  | "membership_requested"
  | "membership_reviewed"
  | "technology_deployment_requested"
  | "development_enquiry_received"
  | "partnership_enquiry_received"
  | "proposal_created"
  | "proposal_accepted"
  | "followup_overdue"
  | "human_handoff_requested";

export type CorporateMaterialEvent = {
  event_id: string;
  event_type: CorporateMaterialEventType;
  idempotency_key: string;
  occurred_at: string;
  source_system: "ochiga-office";
  business_unit: CorporateBusinessUnit;
  inquiry_type: CorporateInquiryType;
  agent_role: CorporateAgentRole;
  crm: {
    contact_ref: string | null;
    organization_ref: string | null;
    opportunity_ref: string | null;
    lead_ref: string | null;
  };
  conversation: {
    public_session_id: string | null;
    oyi_thread_id: string | null;
  };
  metadata: Record<string, unknown>;
};

export type PublicCorporateCapability =
  | "corporate_knowledge_read"
  | "public_question_answer"
  | "crm_intake_create"
  | "crm_journey_update"
  | "conversation_continue"
  | "voice_session_prepare"
  | "human_handoff_request"
  | "proactive_prompt_decide"
  | "office_material_event_publish";

export type PublicCorporateSurfacePolicy = {
  surface: Extract<IntelligenceSurface, "website" | "widget" | "api"> | "oyi_website";
  allowed_agent_roles: CorporateAgentRole[];
  allowed_capabilities: PublicCorporateCapability[];
  blocked_operational_domains: readonly string[];
  blocked_actions: readonly string[];
  public_identity: string;
};

export type BusinessRoutingInput = {
  source_page?: string | null;
  source_form?: string | null;
  lead_type?: string | null;
  inquiry_type?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type BusinessRoutingDecision = {
  business_unit: CorporateBusinessUnit;
  inquiry_type: CorporateInquiryType;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type AgentRoleDecision = {
  agent_role: CorporateAgentRole;
  lead_stage: CorporateLeadStage;
  reason: string;
};

export const PUBLIC_CORPORATE_SURFACE_POLICY = Object.freeze({
  surface: "widget",
  allowed_agent_roles: ["oma", "osa"],
  allowed_capabilities: [
    "corporate_knowledge_read",
    "public_question_answer",
    "crm_intake_create",
    "crm_journey_update",
    "conversation_continue",
    "voice_session_prepare",
    "human_handoff_request",
    "proactive_prompt_decide",
    "office_material_event_publish",
  ],
  blocked_operational_domains: [
    "devices",
    "access",
    "security",
    "visitors",
    "maintenance_private",
    "wallet",
    "utilities_private",
    "community_private",
    "facility_admin",
    "resident_private",
  ],
  blocked_actions: [
    "device_control",
    "lock_unlock",
    "visitor_credential_display",
    "access_approval",
    "payment",
    "wallet_funding",
    "facility_admin_action",
    "private_record_read",
  ],
  public_identity: "ochiga_intelligence",
} satisfies PublicCorporateSurfacePolicy);

const norm = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function routeCorporateBusinessUnit(input: BusinessRoutingInput): BusinessRoutingDecision {
  const haystack = norm([
    input.source_page,
    input.source_form,
    input.lead_type,
    input.inquiry_type,
    input.message,
    input.metadata ? Object.values(input.metadata).join(" ") : "",
  ].filter(Boolean).join(" "));

  if (/\b(oyi|technology|deployment|integrator|smart building|facility os|edge)\b/.test(haystack)) {
    return { business_unit: "technology", inquiry_type: /integrator/.test(haystack) ? "integrator_interest" : "oyi_deployment_request", confidence: "high", reason: "technology_or_oyi_signal" };
  }
  if (/\b(private|membership|member|investor|investment circle)\b/.test(haystack)) {
    return { business_unit: "private", inquiry_type: /request|apply|application/.test(haystack) ? "membership_request" : "membership_interest", confidence: "high", reason: "private_membership_signal" };
  }
  if (/\b(development|land|jv|joint venture|offtake|project sales|site)\b/.test(haystack)) {
    return { business_unit: "development", inquiry_type: /offtake|buyer|sales/.test(haystack) ? "sales_offtake" : "land_jv", confidence: "high", reason: "development_or_land_signal" };
  }
  if (/\b(partner|partnership|capital|consultant|supplier|professional|strategic)\b/.test(haystack)) {
    return { business_unit: "partnerships", inquiry_type: /capital/.test(haystack) ? "capital_partner" : "strategic_partner", confidence: "medium", reason: "partnership_signal" };
  }
  if (/\b(media|press)\b/.test(haystack)) {
    return { business_unit: "corporate", inquiry_type: "media", confidence: "medium", reason: "media_signal" };
  }
  return { business_unit: "corporate", inquiry_type: "general_enquiry", confidence: "low", reason: "default_corporate_triage" };
}

export function selectCorporateAgentRole(input: {
  business_unit: CorporateBusinessUnit;
  inquiry_type: CorporateInquiryType;
  lead_stage?: CorporateLeadStage | null;
  message?: string | null;
}): AgentRoleDecision {
  const message = norm(input.message);
  const stage = input.lead_stage || "exploring";
  const salesSignal = stage === "qualified"
    || stage === "handoff_requested"
    || /\b(price|proposal|demo|meeting|install|deployment|buildings?|portfolio|quote|timeline|budget|procurement)\b/.test(message);

  if (salesSignal) {
    return { agent_role: "osa", lead_stage: stage === "exploring" ? "interested" : stage, reason: "commercial_or_sales_ready_signal" };
  }
  return { agent_role: "oma", lead_stage: stage, reason: "marketing_acquisition_context" };
}

export function isPublicCorporateCapabilityAllowed(capability: string, policy: PublicCorporateSurfacePolicy = PUBLIC_CORPORATE_SURFACE_POLICY) {
  return policy.allowed_capabilities.includes(capability as PublicCorporateCapability);
}

export function isPublicOperationalRequestBlocked(input: { domain?: string | null; action?: string | null }, policy: PublicCorporateSurfacePolicy = PUBLIC_CORPORATE_SURFACE_POLICY) {
  const domain = norm(input.domain);
  const action = norm(input.action);
  return policy.blocked_operational_domains.some((blocked) => norm(blocked) === domain)
    || policy.blocked_actions.some((blocked) => norm(blocked) === action);
}

export function assertOpaquePublicReference(ref: string | null | undefined) {
  const value = String(ref || "");
  if (!value) return false;
  if (/^(lead|contact|opportunity|crm|form)-[a-z0-9_-]+$/i.test(value)) return false;
  return /^pubctx_[a-z0-9_-]{12,}$/i.test(value);
}

export type OfficeInternalOyiCoreRequest = {
  request_id: string;
  message: string;
  office_session_id: string;
  conversation_thread_id: string | null;
  staff: {
    staff_id: string | null;
    email: string | null;
    role: string;
    permissions: string[];
  };
  page_context: {
    page: string | null;
    selected_type: string | null;
    selected_id: string | null;
  };
  business_unit: CorporateBusinessUnit;
  capability_context: string[];
  crm_context: {
    contact_ref: string | null;
    organization_ref: string | null;
    lead_ref: string | null;
    opportunity_ref: string | null;
    safe_summary: string | null;
  } | null;
  portfolio_context: {
    portfolio_ref: string | null;
    backend_building_ref: string | null;
    safe_summary: string | null;
  } | null;
  support_context: {
    support_case_ref: string | null;
    safe_summary: string | null;
  } | null;
  project_context: {
    project_ref: string | null;
    safe_summary: string | null;
  } | null;
  task_context: {
    task_ref: string | null;
    safe_summary: string | null;
  } | null;
  meeting_context: {
    meeting_ref: string | null;
    safe_summary: string | null;
  } | null;
  partnership_context: {
    partnership_ref: string | null;
    safe_summary: string | null;
  } | null;
  document_context: {
    document_ref: string | null;
    safe_summary: string | null;
  } | null;
  content_context: {
    content_ref: string | null;
    safe_summary: string | null;
  } | null;
  requested_capability: string | null;
  knowledge_context: CorporateKnowledgeReference[];
  metadata: Record<string, unknown>;
  // Compact, permission-gated read of Office's own CRM/reports/development
  // stores, computed by Office (using its own existing store + permission
  // functions) and attached to the outbound request. Oyi Core's office
  // capability modules read evidence from this rather than querying any
  // database directly — Backend has no direct connection to Office's data
  // store. A null section means "not computed for this actor/request" (the
  // capability must report unavailable, never fabricate); an empty array
  // means "computed, genuinely none right now".
  operational_snapshot?: {
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
  } | null;
};

export type OfficeInternalOyiCoreResponse = {
  ok: true;
  contract_version: typeof CORPORATE_INTELLIGENCE_CONTRACT_VERSION;
  source: "oyi_core";
  surface: "office_internal";
  request_id: string;
  office_session_id: string;
  conversation_thread_id: string;
  answer: string;
  understood_intent: string;
  business_domain: CorporateBusinessUnit;
  suggested_next_action: string | null;
  attention_signal: "none" | "follow_up" | "support" | "project" | "portfolio" | "private" | "partnership" | "handoff" | "meeting";
  tool_proposals: CorporateToolProposal[];
  knowledge_references: CorporateKnowledgeReference[];
  safe_metadata: Record<string, unknown>;
};
