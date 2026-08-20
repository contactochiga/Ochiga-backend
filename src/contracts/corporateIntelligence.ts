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
  tool: "crm.update_journey" | "crm.create_or_update_lead" | "crm.create_opportunity" | "office.create_followup_task" | "office.prepare_commercial_document" | "office.request_handoff" | "office.review_meeting_context" | "office.create_automation";
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
  // projection_state is derived client-side (mirrors office.js's
  // portfolioOyiSafeSummary 3-branch logic exactly: linked/unavailable/
  // not_linked) rather than re-derived here, so the honest distinction
  // between "no live Oyi deployment reference" and "linked but the live
  // read failed right now" is preserved without duplicating that logic.
  // homes_*/devices_*/major_open_escalations are only ever real numbers
  // when projection_state is "linked" -- otherwise null, never guessed.
  portfolio_context: {
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
  support_context: {
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
  project_context: {
    project_ref: string | null;
    safe_summary: string | null;
  } | null;
  // status/priority/owner/due_at/overdue are optional, additive structured
  // fields alongside safe_summary — added so a real capability module can
  // answer a specific sub-question (who owns it, is it overdue) instead of
  // only ever echoing the whole pre-composed summary string. safe_summary
  // is unchanged and still used by every other existing consumer of this
  // slot (tool-proposal reasoning, the degraded-answer rescue).
  task_context: {
    task_ref: string | null;
    safe_summary: string | null;
    title?: string | null;
    status?: string | null;
    priority?: string | null;
    owner?: string | null;
    due_at?: string | null;
    overdue?: boolean;
  } | null;
  // Mirrors task_context exactly — set when staff have a Tasks-domain
  // automation open (Office's Automations detail panel). Lets Oyi Core
  // reason about the automation's real trigger/action/status instead of
  // guessing from free text, same as every other context slot here.
  // trigger/action are pre-formatted human-readable strings (Office
  // already computes these via humanizeAutomationTrigger/
  // automationActionSummary for its own UI) rather than raw structured
  // objects, since the trigger/action shape varies by type
  // (create/transition) and Office's own formatter is the single place
  // that already knows how to render it -- not duplicated here.
  automation_context: {
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
  // follow_up_task_title/status are a REAL existing cross-reference
  // (office.js resolves record.follow_up_task_id to a real task before
  // building this) -- unlike Tasks/Automations, which never have a real
  // task/automation link and say so, a meeting genuinely can have a
  // linked follow-up task, so this is answered truthfully either way
  // (present or absent), never a blanket "not tracked" statement.
  meeting_context: {
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
  // Mirrors task_context's additive-structured-fields pattern. org/
  // opportunity/handoff are real cross-references office.js already
  // resolves for partnershipOyiSafeSummary — surfaced here as flat
  // strings (not nested objects) so answer() can reason about them
  // without re-deriving Office's own lookups.
  partnership_context: {
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
  // title/document_type/status/owner/related_type/related_name are
  // metadata ONLY -- never the file body/contents, which may carry
  // sensitive commercial detail (mirrors office.js's documentOyiSafeSummary
  // comment exactly). office_documents.read is a strictly read-only
  // capability: no drafting, generation, sending, approval or publishing.
  document_context: {
    document_ref: string | null;
    safe_summary: string | null;
    title?: string | null;
    document_type?: string | null;
    status?: string | null;
    owner?: string | null;
    related_type?: string | null;
    related_name?: string | null;
  } | null;
  // excerpt is real short-form metadata Office already surfaces on the
  // Content editor page (never the full article body) -- office_content.read
  // is strictly read-only: no drafting, generation, review-state changes
  // or publishing.
  content_context: {
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
