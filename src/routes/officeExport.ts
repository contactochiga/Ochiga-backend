import { Router, Request, Response, NextFunction } from "express";
import nodeCrypto from "crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { projectDeviceCurrentStateRows } from "../oyi-core/domains/devices/deviceCurrentStatePresentation";
import { CONTRACT_VERSION, emitAuditEvent } from "../core/foundation";
import { conversationOrchestrator, ensureRegistered } from "../oyi-core/orchestration/ConversationOrchestrator";
import { capabilityRegistry } from "../oyi-core/capabilities/CapabilityRegistry";
import type { CapabilityModule } from "../oyi-core/contracts/capability";
import { logger } from "../observability/logger";
import { processInboundEvent } from "../services/communicationRuntime/inboundEventPipeline";
import type { CanonicalInboundCommunicationEvent } from "../contracts/inboundCommunicationEvent";
import type { AuthUser } from "../middleware/auth";
import {
  officeCredentialTimingSafeEqual,
  resolveOfficeCredential,
  resolveOfficeSyncKey,
} from "../middleware/officeCredential";
import type { CorporateAgentRole, CorporateBusinessUnit, CorporateInquiryType, CorporateMaterialEvent, CorporateMaterialEventType, CorporateOyiCoreRequest, OfficeInternalOyiCoreRequest } from "../contracts/corporateIntelligence";
import { CORPORATE_INTELLIGENCE_CONTRACT_VERSION, PUBLIC_CORPORATE_SURFACE_POLICY } from "../contracts/corporateIntelligence";
import { submitOfficeMaterialEventCanonicalSignal } from "../oyi-core/ingress/officeMaterialEventAdapter";
import { buildCorporatePublicResponse, deniedPublicCorporateOperationalRequest } from "../oyi-core/policy/corporatePublicConversationPolicy";
import { buildOfficeInternalResponse, deniedOfficeInternalOperationalRequest } from "../oyi-core/policy/corporateOfficeInternalPolicy";
import { retrieveKnowledge } from "../oyi-core/domains/knowledge/knowledgeRetrieval";
import { publicConversationActor } from "../oyi-core/context/conversationOwnership";
import { normalizePlanReviewContext } from "../oyi-core/capabilities/PlanStudioCapability";
import type { KnowledgeDomain } from "../oyi-core/domains/knowledge/knowledgeContracts";
import { loadLastVerifiedOfficeAction } from "../oyi-core/context/officeAutomationSuggestionStore";
import { recordOyiObservabilityEvent, observabilityStatusFromTruthState } from "../intelligence-core/oyiObservabilityBridge";
import { analyzeCommunicationFrame, analyzeCommunicationDocument, synthesizeOyiSpeech } from "../services/communications/communicationsMediaAdapters";
import { createWorkflow, transitionWorkflow, listWorkflows, getWorkflow, type WorkflowStatus } from "../intelligence-core/workflows";
import type { IntelligenceAgentId } from "../intelligence-core/types";
// Tasks Domain UI (Office) — reuses the Shared Automation Runtime's own
// validation, not a second automation engine. These routes only ever
// read/write consumer_automations rows with surface forced to
// "office" server-side; the scheduler, executor, and workflow_action
// dispatch are entirely unmodified (src/routes/scenes.ts).
import {
  cleanWorkflowActions,
  validateWorkflowActions,
  cleanCommunicationActions,
  validateCommunicationActions,
  isCommunicationActionItem,
  isAutomationSurfaceEnabled,
  officeAutomationActor,
  executeConsumerAutomation,
  type AutomationSurface,
} from "./scenes";
import { validateAutomationTrigger, nextAutomationRunAt } from "../services/automationScheduleService";
import { rotateEstateInviteToken, revokeEstateInviteById, findPendingOwnerInvite } from "../services/estateInviteMutationService";
import { checkEstateDeletionEligibility } from "../services/estateDeletionEligibility";
import { loadPlatformHumanInterventionObligations, type HumanInterventionObligation, type HumanInterventionType } from "../oyi-core/presentation/humanInterventionView";
import { healthSummary } from "../observability/http";
import { goalRuntime } from "../services/goalRuntime/GoalRuntime";
import { countDecisionsByStatuses, countDecisionsResolvedSince, listDecisionsByStatuses, getDecision } from "../services/decisionStore/DecisionStore";
import type { DecisionRecord, DecisionStatus } from "../contracts/decision";
import type { GoalRecord, GoalStatus } from "../contracts/goal";
import { SupabaseWorkflowRepository, activeWorkflowStatuses } from "../oyi-core/workflows/WorkflowRepository";
import { normalizeLifecycleStage } from "../oyi-core/presentation/lifecycleStage";
import {
  loadPlatformActionAggregate,
  deviceCommandStage,
  communicationStage,
  facilityAutomationStage,
  conversationWorkflowStage,
} from "../oyi-core/presentation/actionWorkflowView";
import { getDeviceCommandExecution } from "../services/deviceCommandExecutionStore";
import { communicationRuntime } from "../services/communicationRuntime/CommunicationRuntime";
import { listKnowledgeItemsForActor, summarizeKnowledgeCorpusGovernance, getKnowledgeItemByCanonicalKey } from "../oyi-core/domains/knowledge/knowledgeRetrieval";
import { buildMemoryContextView } from "../oyi-core/presentation/memoryContextView";
import { buildLearningView } from "../oyi-core/presentation/learningView";
import { listConversationTraces, normalizeTraceFilters, summarizeConversationTraces, getConversationTrace, conversationTraceStoreConfig } from "../oyi-core/presentation/conversationTraceView";
import { KNOWLEDGE_AUTHORITY_RANK, OFFICE_INTERNAL_KNOWLEDGE_ACTOR, authorityRank as knowledgeAuthorityRank, type KnowledgeItem } from "../oyi-core/domains/knowledge/knowledgeContracts";

const router = Router();

type Row = Record<string, any>;

export function requireOfficeExportKey(req: Request, res: Response, next: NextFunction) {
  const expected = resolveOfficeSyncKey();
  if (!expected) {
    return res.status(503).json({ error: "OFFICE_SYNC_API_KEY is not configured" });
  }

  const provided = resolveOfficeCredential(req);
  if (!provided || !officeCredentialTimingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: "Invalid office sync key" });
  }

  return next();
}

function safeText(value: any, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

// Office Intelligence Convergence, Wave 3 -- the canonical set of Office
// material event types Backend will actually ingest. Deliberately closed
// (matches CorporateMaterialEventType exactly): "Do not migrate noisy
// CRUD/audit events blindly" -- an event type outside this set is
// rejected below rather than silently accepted and forwarded to Core.
const CORPORATE_MATERIAL_EVENT_TYPES: ReadonlySet<CorporateMaterialEventType> = new Set([
  "lead_created",
  "lead_qualified",
  "opportunity_created",
  "opportunity_stage_changed",
  "membership_requested",
  "membership_reviewed",
  "technology_deployment_requested",
  "development_enquiry_received",
  "partnership_enquiry_received",
  "proposal_created",
  "proposal_accepted",
  "followup_overdue",
  "human_handoff_requested",
]);

type MaterialEventValidation = { ok: true; event: CorporateMaterialEvent } | { ok: false; error: string };

// Validates and normalizes an inbound POST /office/events/material body
// into the exact CorporateMaterialEvent shape ochiga-office's
// backend-events.js::buildMaterialCrmEvent() actually produces. Rejects
// (400, no Core call) anything structurally malformed -- Office's own
// publisher does not retry a 4xx, so a genuinely malformed payload does
// not become a retry storm, only a real transient failure does.
export function validateMaterialEvent(body: any): MaterialEventValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "request body must be a JSON object" };
  const eventId = safeText(body.event_id);
  const eventType = safeText(body.event_type);
  const idempotencyKey = safeText(body.idempotency_key);
  const occurredAt = safeText(body.occurred_at);
  const sourceSystem = safeText(body.source_system);
  const requestId = safeText(body.request_id);
  const subject = recordOf(body.subject);
  const source = recordOf(body.source);
  const crm = recordOf(body.crm);
  const conversationRaw = recordOf(body.conversation);
  const communicationRaw = recordOf(body.communication_context);

  if (!eventId) return { ok: false, error: "event_id is required" };
  if (!CORPORATE_MATERIAL_EVENT_TYPES.has(eventType as CorporateMaterialEventType)) {
    return { ok: false, error: `event_type must be one of the known material event types, got "${eventType || "(missing)"}"` };
  }
  if (!idempotencyKey) return { ok: false, error: "idempotency_key is required" };
  if (!occurredAt || !Number.isFinite(Date.parse(occurredAt))) return { ok: false, error: "occurred_at must be a valid timestamp" };
  if (sourceSystem !== "ochiga-office") return { ok: false, error: 'source_system must be "ochiga-office"' };
  if (!requestId) return { ok: false, error: "request_id is required" };
  if (!safeText(subject.type) || !safeText(subject.id)) return { ok: false, error: "subject.type and subject.id are required" };

  return {
    ok: true,
    event: {
      event_id: eventId,
      event_type: eventType as CorporateMaterialEventType,
      idempotency_key: idempotencyKey,
      occurred_at: occurredAt,
      source_system: "ochiga-office",
      request_id: requestId,
      subject: { type: safeText(subject.type), id: safeText(subject.id), label: safeText(subject.label) },
      business_unit: safeText(body.business_unit, "corporate") as CorporateBusinessUnit,
      inquiry_type: safeText(body.inquiry_type, "general_enquiry") as CorporateInquiryType,
      agent_role: (safeText(body.agent_role) as CorporateAgentRole) || null,
      source: {
        channel: safeText(source.channel, "website"),
        site: safeText(source.site),
        page: safeText(source.page),
        form: safeText(source.form),
      },
      crm: {
        lead_id: safeText(crm.lead_id) || null,
        opportunity_id: safeText(crm.opportunity_id) || null,
        status: safeText(crm.status) || null,
        stage: safeText(crm.stage) || null,
        owner: safeText(crm.owner) || null,
      },
      conversation: Object.keys(conversationRaw).length
        ? { public_session_id: safeText(conversationRaw.public_session_id) || null, oyi_thread_id: safeText(conversationRaw.oyi_thread_id) || null }
        : null,
      // Oyi Communications Convergence, Slice 1 -- contactability is
      // never trusted as "allowed" from the wire; only a producer that
      // explicitly sends the literal string "allowed" or "denied" gets
      // anything other than "unknown". This is the conservative-by-
      // construction guard against consent_present silently becoming
      // allowed, enforced here (not just by convention in the producer).
      communication_context: Object.keys(communicationRaw).length
        ? {
            primary_channel: safeText(communicationRaw.primary_channel) || null,
            email: safeText(communicationRaw.email) || null,
            phone: safeText(communicationRaw.phone) || null,
            whatsapp_phone: safeText(communicationRaw.whatsapp_phone) || null,
            contactability: (["allowed", "denied"] as const).includes(communicationRaw.contactability) ? communicationRaw.contactability : "unknown",
          }
        : null,
      metadata: recordOf(body.metadata),
    },
  };
}

function safeNumber(value: any): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function recordOf(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// Wave 9 Slice 1 -- request.business_unit already IS a structured domain
// signal (Section 28: "use structured context first," never a second LLM
// call to formulate search); this just narrows it to the KnowledgeDomain
// values that carry real Office-pack content today.
function knowledgeDomainsForBusinessUnit(businessUnit: string | null | undefined): KnowledgeDomain[] {
  switch (businessUnit) {
    case "technology":
      return ["technology", "product"];
    case "development":
      return ["development"];
    case "private":
      return ["private"];
    case "partnerships":
      return ["partnerships"];
    default:
      return ["corporate", "commercial", "product", "website"];
  }
}

function knowledgeContext(value: any): CorporateOyiCoreRequest["knowledge_context"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item, index) => {
    const row = recordOf(item);
    return {
      id: safeText(row.id, `knowledge_${index + 1}`),
      title: safeText(row.title, "Corporate knowledge"),
      excerpt: safeText(row.excerpt).slice(0, 800),
      source: safeText(row.source, "office"),
    };
  });
}

function normalizeCorporateConversationRequest(body: any, requestId: string): CorporateOyiCoreRequest {
  const source = recordOf(body.source);
  const crm = recordOf(body.crm_context);
  return {
    request_id: safeText(body.request_id, requestId),
    message: safeText(body.message),
    public_session_id: safeText(body.public_session_id || body.session_id, `public_session_${requestId}`),
    conversation_thread_id: safeText(body.conversation_thread_id || body.thread_id) || null,
    public_identity: safeText(body.public_identity, PUBLIC_CORPORATE_SURFACE_POLICY.public_identity),
    agent_role: safeText(body.agent_role, "oma") === "osa" ? "osa" : "oma",
    business_unit: safeText(body.business_unit, "corporate") as CorporateOyiCoreRequest["business_unit"],
    inquiry_type: safeText(body.inquiry_type, "general_enquiry") as CorporateOyiCoreRequest["inquiry_type"],
    source: {
      source_site: safeText(source.source_site || body.source_site, "ochiga_website") as CorporateOyiCoreRequest["source"]["source_site"],
      source_page: safeText(source.source_page || body.source_page),
      source_form: safeText(source.source_form || body.source_form) || null,
      source_channel: safeText(source.source_channel || body.source_channel, "website") as CorporateOyiCoreRequest["source"]["source_channel"],
      campaign: recordOf(source.campaign || body.campaign),
    },
    visitor_state: safeText(body.visitor_state, crm.contact_ref || crm.lead_ref ? "known" : "anonymous") === "known" ? "known" : "anonymous",
    crm_context: {
      contact_ref: safeText(crm.contact_ref) || null,
      opportunity_ref: safeText(crm.opportunity_ref) || null,
      lead_ref: safeText(crm.lead_ref) || null,
      safe_summary: safeText(crm.safe_summary).slice(0, 800) || null,
    },
    form_context_ref: safeText(body.form_context_ref) || null,
    engagement_mode: safeText(body.engagement_mode, "text_conversation") as CorporateOyiCoreRequest["engagement_mode"],
    handoff_state: safeText(body.handoff_state, "none") as CorporateOyiCoreRequest["handoff_state"],
    requested_capability: safeText(body.requested_capability) as CorporateOyiCoreRequest["requested_capability"] || null,
    knowledge_context: knowledgeContext(body.knowledge_context),
    metadata: recordOf(body.metadata),
  };
}

// Oyi Runtime Contract, Domain 3 (Task) — synthetic actor for the
// office-backend-intelligence-events boundary contract
// (src/contracts/platformBoundaries.ts). Office calls these routes
// with its own shared-secret credential (requireOfficeExportKey), not
// a real Backend AuthUser, so a real getIntelligencePermissionPolicy()
// scope/role decision is still needed — "ochiga_admin" is the closest
// real role (global "office" scope per permissionEngine.ts, passes
// canViewWorkflows()'s allowlist unchanged). This reuses
// createWorkflow/transitionWorkflow/listWorkflows/getWorkflow exactly
// as written for every other caller; nothing in workflows.ts changes.
// "ochiga_admin" is a real PlatformRole (src/core/foundation/
// permissions.ts) that getIntelligencePermissionPolicy/canViewWorkflows
// already understand — it's just outside AuthUser's narrower `UserRole`
// type (src/types/user.ts), a pre-existing type/runtime gap elsewhere
// in this codebase, not something introduced here. Cast, not a new role.
const officeWorkflowActor = {
  id: "office_workflow_bridge",
  email: "office-workflow-bridge@ochiga.local",
  role: "ochiga_admin",
  permissions: [],
  permission_scopes: [],
} as unknown as AuthUser;

export function normalizeOfficeInternalRequest(body: any, requestId: string): OfficeInternalOyiCoreRequest {
  const staff = recordOf(body.staff);
  const page = recordOf(body.page_context);
  const crm = recordOf(body.crm_context);
  const portfolio = recordOf(body.portfolio_context);
  const support = recordOf(body.support_context);
  const project = recordOf(body.project_context);
  const task = recordOf(body.task_context);
  const automation = recordOf(body.automation_context);
  const meeting = recordOf(body.meeting_context);
  const partnership = recordOf(body.partnership_context);
  const documentCtx = recordOf(body.document_context);
  const content = recordOf(body.content_context);
  const development = recordOf(body.development_context);
  return {
    plan_review_context: normalizePlanReviewContext(body.plan_review_context),
    request_id: safeText(body.request_id, requestId),
    message: safeText(body.message),
    office_session_id: safeText(body.office_session_id || body.session_id, `office_session_${requestId}`),
    conversation_thread_id: safeText(body.conversation_thread_id || body.thread_id) || null,
    staff: {
      staff_id: safeText(staff.staff_id || staff.id) || null,
      email: safeText(staff.email) || null,
      role: safeText(staff.role, "ochiga_staff"),
      permissions: Array.isArray(staff.permissions) ? staff.permissions.map((item: any) => safeText(item)).filter(Boolean) : [],
    },
    page_context: {
      page: safeText(page.page || body.page) || null,
      selected_type: safeText(page.selected_type || body.selected_type) || null,
      selected_id: safeText(page.selected_id || body.selected_id) || null,
    },
    business_unit: safeText(body.business_unit, "corporate") as CorporateBusinessUnit,
    capability_context: Array.isArray(body.capability_context) ? body.capability_context.map((item: any) => safeText(item)).filter(Boolean) : [],
    crm_context: Object.keys(crm).length ? {
      contact_ref: safeText(crm.contact_ref) || null,
      organization_ref: safeText(crm.organization_ref) || null,
      lead_ref: safeText(crm.lead_ref) || null,
      opportunity_ref: safeText(crm.opportunity_ref) || null,
      safe_summary: safeText(crm.safe_summary).slice(0, 800) || null,
    } : null,
    portfolio_context: Object.keys(portfolio).length ? {
      portfolio_ref: safeText(portfolio.portfolio_ref) || null,
      backend_building_ref: safeText(portfolio.backend_building_ref) || null,
      safe_summary: safeText(portfolio.safe_summary).slice(0, 800) || null,
      name: safeText(portfolio.name).slice(0, 180) || null,
      relationship_type: safeText(portfolio.relationship_type) || null,
      business_unit: safeText(portfolio.business_unit) || null,
      status: safeText(portfolio.status) || null,
      oyi_deployment_status: safeText(portfolio.oyi_deployment_status) || null,
      facility_os_status: safeText(portfolio.facility_os_status) || null,
      consumer_os_status: safeText(portfolio.consumer_os_status) || null,
      support_status: safeText(portfolio.support_status) || null,
      health_summary: safeText(portfolio.health_summary).slice(0, 500) || null,
      major_escalations: safeNumber(portfolio.major_escalations),
      projection_state: (["linked", "unavailable", "not_linked"] as const).includes(portfolio.projection_state) ? portfolio.projection_state : null,
      homes_total: safeNumber(portfolio.homes_total),
      homes_active: safeNumber(portfolio.homes_active),
      devices_total: safeNumber(portfolio.devices_total),
      devices_online: safeNumber(portfolio.devices_online),
      major_open_escalations: safeNumber(portfolio.major_open_escalations),
    } : null,
    support_context: Object.keys(support).length ? {
      support_case_ref: safeText(support.support_case_ref) || null,
      safe_summary: safeText(support.safe_summary).slice(0, 800) || null,
      title: safeText(support.title).slice(0, 180) || null,
      status: safeText(support.status) || null,
      severity: safeText(support.severity) || null,
      category: safeText(support.category) || null,
      product_area: safeText(support.product_area) || null,
      assigned_staff: safeText(support.assigned_staff) || null,
      sla_target_at: safeText(support.sla_target_at) || null,
      resolution_notes: safeText(support.resolution_notes).slice(0, 500) || null,
      customer_name: safeText(support.customer_name).slice(0, 180) || null,
      organization_name: safeText(support.organization_name).slice(0, 180) || null,
    } : null,
    project_context: Object.keys(project).length ? {
      project_ref: safeText(project.project_ref) || null,
      safe_summary: safeText(project.safe_summary).slice(0, 800) || null,
    } : null,
    task_context: Object.keys(task).length ? {
      task_ref: safeText(task.task_ref) || null,
      safe_summary: safeText(task.safe_summary).slice(0, 800) || null,
      title: safeText(task.title).slice(0, 180) || null,
      status: safeText(task.status) || null,
      priority: safeText(task.priority) || null,
      owner: safeText(task.owner) || null,
      due_at: safeText(task.due_at) || null,
      overdue: Boolean(task.overdue),
    } : null,
    // Milestone 2 bug found in live production verification: this used
    // to hardcode the remap to Task's own field shape (task_ref/title/
    // status/priority/owner/due_at/overdue) and then FILTER OUT any
    // entry lacking task_ref -- which is every non-Task domain's entry,
    // since each domain's own *OyiContext() (office.js) keys its ref by
    // a different field name entirely (support_case_ref/automation_ref/
    // meeting_ref/portfolio_ref/partnership_ref). Every batch confirm
    // for a non-Task domain silently arrived at Backend with an EMPTY
    // task_batch_context regardless of what Office actually sent,
    // making respondFromBatchVerification (ConversationOrchestrator.ts)
    // report 0/N verified even though the underlying PATCH had
    // genuinely succeeded (confirmed directly against the API).
    // Generalized to a plain pass-through of whatever object shape each
    // domain's own context builder produced -- recordOf() already
    // guarantees a safe plain object per entry (same helper used for
    // every other *_context field on this same request), and this is
    // an authenticated office_internal-only route where these entries
    // are Office's own already-computed output, not raw user input.
    task_batch_context: Array.isArray(body.task_batch_context)
      ? body.task_batch_context
          .slice(0, 50)
          .map((item: any) => recordOf(item))
          .filter((entry: Record<string, unknown>) => Object.keys(entry).length > 0)
      : null,
    execution_failed: Boolean(body.execution_failed),
    execution_failure_reason: safeText(body.execution_failure_reason).slice(0, 300) || null,
    automation_context: Object.keys(automation).length ? {
      automation_ref: safeText(automation.automation_ref) || null,
      safe_summary: safeText(automation.safe_summary).slice(0, 800) || null,
      name: safeText(automation.name).slice(0, 180) || null,
      enabled: Boolean(automation.enabled),
      trigger: safeText(automation.trigger) || null,
      action: safeText(automation.action) || null,
      owner: safeText(automation.owner) || null,
      last_run_status: safeText(automation.last_run_status) || null,
      last_run_at: safeText(automation.last_run_at) || null,
      next_run_at: safeText(automation.next_run_at) || null,
    } : null,
    meeting_context: Object.keys(meeting).length ? {
      meeting_ref: safeText(meeting.meeting_ref) || null,
      safe_summary: safeText(meeting.safe_summary).slice(0, 800) || null,
      title: safeText(meeting.title).slice(0, 180) || null,
      status: safeText(meeting.status) || null,
      scheduled_at: safeText(meeting.scheduled_at) || null,
      owner: safeText(meeting.owner) || null,
      outcome: safeText(meeting.outcome).slice(0, 500) || null,
      related_type: safeText(meeting.related_type) || null,
      related_name: safeText(meeting.related_name).slice(0, 180) || null,
      follow_up_task_title: safeText(meeting.follow_up_task_title).slice(0, 180) || null,
      follow_up_task_status: safeText(meeting.follow_up_task_status) || null,
    } : null,
    partnership_context: Object.keys(partnership).length ? {
      partnership_ref: safeText(partnership.partnership_ref) || null,
      safe_summary: safeText(partnership.safe_summary).slice(0, 800) || null,
      relationship_type: safeText(partnership.relationship_type) || null,
      review_status: safeText(partnership.review_status) || null,
      business_unit: safeText(partnership.business_unit) || null,
      relationship_manager: safeText(partnership.relationship_manager).slice(0, 180) || null,
      organization_name: safeText(partnership.organization_name).slice(0, 180) || null,
      opportunity_type: safeText(partnership.opportunity_type) || null,
      last_contact_status: safeText(partnership.last_contact_status) || null,
      last_contact_mode: safeText(partnership.last_contact_mode) || null,
    } : null,
    document_context: Object.keys(documentCtx).length ? {
      document_ref: safeText(documentCtx.document_ref) || null,
      safe_summary: safeText(documentCtx.safe_summary).slice(0, 800) || null,
      title: safeText(documentCtx.title).slice(0, 180) || null,
      document_type: safeText(documentCtx.document_type) || null,
      status: safeText(documentCtx.status) || null,
      owner: safeText(documentCtx.owner) || null,
      related_type: safeText(documentCtx.related_type) || null,
      related_name: safeText(documentCtx.related_name).slice(0, 180) || null,
    } : null,
    content_context: Object.keys(content).length ? {
      content_ref: safeText(content.content_ref) || null,
      safe_summary: safeText(content.safe_summary).slice(0, 800) || null,
      title: safeText(content.title).slice(0, 180) || null,
      workflow_status: safeText(content.workflow_status) || null,
      category: safeText(content.category).slice(0, 120) || null,
      author: safeText(content.author).slice(0, 120) || null,
      excerpt: safeText(content.excerpt).slice(0, 500) || null,
      scheduled_publish_at: safeText(content.scheduled_publish_at) || null,
      sanity_live_url: safeText(content.sanity_live_url) || null,
    } : null,
    // Office Intelligence Convergence, Wave 3 -- mirrors partnership_context's
    // exact normalization pattern. Every field is honest pass-through of
    // whatever Office actually computed; nothing here is inferred or
    // fabricated by Backend.
    development_context: Object.keys(development).length ? {
      opportunity_ref: safeText(development.opportunity_ref) || null,
      safe_summary: safeText(development.safe_summary).slice(0, 800) || null,
      opportunity_type: safeText(development.opportunity_type) || null,
      location: safeText(development.location) || null,
      land_size: safeText(development.land_size) || null,
      structure_offered: safeText(development.structure_offered) || null,
      landowner_expectation: safeText(development.landowner_expectation).slice(0, 500) || null,
      title_document_status: safeText(development.title_document_status) || null,
      commercial_terms: safeText(development.commercial_terms).slice(0, 500) || null,
      timeline: safeText(development.timeline) || null,
      scale_units: safeNumber(development.scale_units),
      source_channel: safeText(development.source_channel) || null,
      decision_maker_status: safeText(development.decision_maker_status) || null,
    } : null,
    requested_capability: safeText(body.requested_capability) || null,
    knowledge_context: knowledgeContext(body.knowledge_context),
    metadata: recordOf(body.metadata),
    operational_snapshot: body.operational_snapshot && typeof body.operational_snapshot === "object" ? body.operational_snapshot : null,
  };
}

function officeInternalActor(request: OfficeInternalOyiCoreRequest): AuthUser {
  return {
    id: request.staff.staff_id || `office-staff-${request.request_id}`,
    email: request.staff.email || "office-internal@ochiga.local",
    role: "ochiga_staff" as any,
    permissions: request.staff.permissions,
    permission_scopes: request.staff.permissions,
  };
}

function toNumber(value: any, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asArray<T = Row>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

type SelectResult = {
  rows: Row[];
  source: {
    available: boolean;
    reason?: string;
    required_source: string;
    count: number;
  };
};

async function safeSelectWithStatus(table: string, columns = "*"): Promise<SelectResult> {
  const { data, error } = await supabaseAdmin.from(table).select(columns);
  if (error) {
    console.warn(`[office-export] ${table}: ${error.message}`);
    return {
      rows: [],
      source: {
        available: false,
        reason: "table_or_service_missing",
        required_source: table,
        count: 0,
      },
    };
  }
  const rows = asArray<Row>(data);
  return {
    rows,
    source: {
      available: true,
      required_source: table,
      count: rows.length,
    },
  };
}

function exportRecord(kind: string, row: Row, index: number, nowIso: string) {
  return {
    id: String(row.id || row.event_id || `${kind}_${index + 1}`),
    estate_id: row.estate_id || null,
    building_id: row.building_id || null,
    home_id: row.home_id || null,
    user_id: row.user_id || row.created_by || null,
    title: row.title || row.name || row.subject || row.event_type || kind,
    category: row.category || row.type || kind,
    status: row.status || row.state || "recorded",
    priority: row.priority || row.severity || null,
    created_at: row.created_at || row.received_at || row.timestamp || nowIso,
    updated_at: row.updated_at || row.created_at || nowIso,
    metadata: row.metadata || row.payload || row,
  };
}

function sourceUnavailable(requiredSource: string) {
  return {
    available: false,
    reason: "table_or_service_missing",
    required_source: requiredSource,
  };
}

function makePackage(estate: Row, nowIso: string) {
  const code = String(
    estate.package_code || estate.package || estate.subscription_plan || estate.plan || estate.tier || "starter"
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const name = String(estate.package_name || estate.package || estate.subscription_plan || estate.plan || code)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return {
    id: `oyi_pkg_${code || "starter"}`,
    name,
    code: code || "starter",
    status: "active",
    setup_fee: toNumber(estate.setup_fee),
    monthly_fee: toNumber(estate.monthly_fee || estate.subscription_fee),
    estate_limit: estate.estate_limit ?? null,
    building_limit: estate.building_limit ?? null,
    home_limit: estate.home_limit ?? null,
    device_limit: estate.device_limit ?? null,
    api_access: Boolean(estate.api_access),
    support_tier: estate.support_tier || "standard",
    created_at: estate.created_at || nowIso,
    updated_at: estate.updated_at || nowIso,
  };
}

// Office Intelligence Convergence, Wave 3 -- canonical Office -> Core
// event ingress. Office's backend-events.js::publishBackendMaterialEvent
// already POSTs here (this exact path is its default
// officeBackendEventPath) with x-office-event-id/x-idempotency-key
// headers and retries on 408/429/5xx up to 5 times; this route does not
// need its own idempotency table for that -- see
// officeMaterialEventAdapter.ts's header comment for why the durable
// canonicalIntelligenceStore dedup already makes a retry a no-op.
// Backend never writes to Office's database here or anywhere else --
// this route only reads the event and forwards ONE canonical signal to
// Core; Office already persisted the underlying CRM record before ever
// calling this endpoint.
router.post("/events/material", requireOfficeExportKey, async (req: Request, res: Response) => {
  const requestId = safeText(req.headers["x-request-id"] || req.headers["x-office-event-id"], nodeCrypto.randomUUID());
  const validation = validateMaterialEvent(req.body || {});
  if (!validation.ok) {
    logger.warn("office_material_event_rejected", { reason: validation.error, request_id: requestId });
    return res.status(400).json({ ok: false, error: validation.error, request_id: requestId });
  }
  const { event } = validation;

  // Fire-and-forget from this route's perspective, same contract as
  // submitCanonicalSignal() itself: never throws. A Core-side failure is
  // logged inside the adapter and reported here as accepted:false --
  // never as an HTTP error -- so it cannot corrupt or roll back the CRM
  // truth Office already established, and does not trigger Office's
  // retryable-status retry loop for what would be a Core-internal issue,
  // not a transport failure.
  const envelope = await submitOfficeMaterialEventCanonicalSignal(event);
  const duplicate = envelope?.receipt?.duplicate === true;
  const accepted = Boolean(envelope?.receipt?.accepted);

  void emitAuditEvent({
    actorId: null,
    actorEmail: "office-material-event@ochiga.local",
    actorRole: "office_system",
    action: "office.material_event.ingested",
    resourceType: "office_material_event",
    resourceId: event.event_id,
    status: "success",
    metadata: { event_type: event.event_type, business_unit: event.business_unit, inquiry_type: event.inquiry_type, duplicate, accepted },
    req,
  });

  return res.status(200).json({
    ok: true,
    event_id: event.event_id,
    idempotency_key: event.idempotency_key,
    duplicate,
    accepted,
    request_id: requestId,
  });
});

router.post("/conversation/corporate", requireOfficeExportKey, async (req: Request, res: Response) => {
  const requestId = safeText(req.headers["x-request-id"], crypto.randomUUID());
  const corporateRequest = normalizeCorporateConversationRequest(req.body || {}, requestId);
  const publicCorporateActor = publicConversationActor(corporateRequest.public_session_id);
  if (!corporateRequest.message) {
    return res.status(400).json({ ok: false, error: "message is required", request_id: requestId });
  }
  if (deniedPublicCorporateOperationalRequest({ message: corporateRequest.message })) {
    void emitAuditEvent({
      actorId: publicCorporateActor.id,
      actorRole: "guest",
      action: "office.public_conversation.denied",
      resourceType: "public_session",
      resourceId: corporateRequest.public_session_id,
      status: "denied",
      metadata: { request_id: requestId, reason: "public_operational_capability_blocked" },
      req,
    });
    return res.status(403).json({
      ok: false,
      error: "public_capability_blocked",
      request_id: requestId,
      public_session_id: corporateRequest.public_session_id,
      message: "Corporate/Public intelligence cannot access or control private resident, Facility, device, visitor, wallet, security or operational systems.",
    });
  }

  const canonical = await conversationOrchestrator.run({
    actor: publicCorporateActor,
    oisContext: {
    surface: "public_corporate" as any,
    estate_id: null,
    home_id: null,
    module: "corporate_public",
    role: corporateRequest.agent_role,
  } as any,
    input: {
    message: corporateRequest.message,
    surface: "public_corporate",
    role: corporateRequest.agent_role,
    module: "corporate_public",
    thread_id: corporateRequest.conversation_thread_id,
    context: {
      request_id: corporateRequest.request_id,
      public_session_id: corporateRequest.public_session_id,
      public_identity: corporateRequest.public_identity,
      agent_role: corporateRequest.agent_role,
      business_unit: corporateRequest.business_unit,
      inquiry_type: corporateRequest.inquiry_type,
      source: corporateRequest.source,
      crm_context: corporateRequest.crm_context,
      form_context_ref: corporateRequest.form_context_ref,
      engagement_mode: corporateRequest.engagement_mode,
      surface_policy: PUBLIC_CORPORATE_SURFACE_POLICY,
      contract_version: CORPORATE_INTELLIGENCE_CONTRACT_VERSION,
    },
    conversation_context: {
      public_session_id: corporateRequest.public_session_id,
      business_unit: corporateRequest.business_unit,
      inquiry_type: corporateRequest.inquiry_type,
      agent_role: corporateRequest.agent_role,
      crm_safe_summary: corporateRequest.crm_context.safe_summary,
    },
    intent_hint: "corporate_public_conversation",
    operation_class_hint: "read",
    scope_mode_hint: "global",
    } as any,
  });
  // Wave 9 Slice 1 -- Core's own real, governed knowledge retrieval,
  // independent of request.knowledge_context (Office never populates it --
  // confirmed during this slice). A failure here (Office unreachable, etc.)
  // degrades to an empty result, never throws -- buildCorporatePublicResponse
  // falls back to the prior echo-input behavior in that case.
  const retrievedKnowledge = await retrieveKnowledge({
    actor: { agentRole: corporateRequest.agent_role, audienceScope: "PUBLIC" },
    domains: knowledgeDomainsForBusinessUnit(corporateRequest.business_unit),
    query: corporateRequest.message,
  }).then((result) => result.items).catch(() => []);
  const response = await buildCorporatePublicResponse(corporateRequest, canonical, retrievedKnowledge);
  // Oyi Cross-Surface Observability Closure — the corporate website
  // widget has no other path into Office's observability today (unlike
  // office_internal, which Office already self-instruments on its own
  // side). public_session_id is an anonymous session reference, never
  // PII; no raw message text is stored.
  void recordOyiObservabilityEvent({
    surface: "public_corporate",
    mode: "text",
    category: "conversation",
    event_type: "conversation.turn_completed",
    status: observabilityStatusFromTruthState((canonical as any)?.truth?.truth_state),
    actor_ref: corporateRequest.public_session_id || null,
    capability: (canonical as any)?.capability_key || null,
    conversation_id: response.conversation_thread_id || null,
    request_id: requestId,
    safe_summary: `Website conversation turn (${(canonical as any)?.intent || "general"})`,
    source_table: "oyi_conversation_messages",
    source_event_id: (canonical as any)?.id || requestId,
  });
  void emitAuditEvent({
    actorId: publicCorporateActor.id,
    actorRole: "guest",
    action: "office.public_conversation.completed",
    resourceType: "public_session",
    resourceId: corporateRequest.public_session_id,
    status: "success",
    metadata: {
      request_id: requestId,
      thread_id: response.conversation_thread_id,
      business_unit: response.business_unit,
      agent_role: response.recommended_agent_role,
      tool_proposal_count: response.tool_proposals.length,
    },
    req,
  });
  return res.status(200).json(response);
});

router.post("/conversation/internal", requireOfficeExportKey, async (req: Request, res: Response) => {
  const requestId = safeText(req.headers["x-request-id"], crypto.randomUUID());
  const internalRequest = normalizeOfficeInternalRequest(req.body || {}, requestId);
  if (!internalRequest.message) {
    return res.status(400).json({ ok: false, error: "message is required", request_id: requestId });
  }
  if (deniedOfficeInternalOperationalRequest({ message: internalRequest.message, permissions: internalRequest.staff.permissions })) {
    void emitAuditEvent({
      actorId: internalRequest.staff.staff_id || "office-internal",
      actorRole: internalRequest.staff.role,
      action: "office.internal_conversation.denied",
      resourceType: "office_session",
      resourceId: internalRequest.office_session_id,
      status: "denied",
      metadata: { request_id: requestId, reason: "operational_action_requires_facility_or_consumer_authorization" },
      req,
    });
    return res.status(403).json({
      ok: false,
      error: "office_internal_operational_capability_blocked",
      request_id: requestId,
      office_session_id: internalRequest.office_session_id,
      message: "Office Internal intelligence cannot bypass Facility or Consumer operational authorization for deep building actions.",
    });
  }

  const actor = officeInternalActor(internalRequest);

  // Oyi Office Intelligence Interaction Repositioning — a photo or file
  // attached to this turn is analyzed here, once, and folded into the
  // SAME message the orchestrator already reasons over (identical
  // pattern to visualObservationTurn() in communications.ts). On
  // failure, the orchestrator still answers the text-only portion of
  // the message normally, and a clean, honest note is prepended to the
  // real response afterward — never a raw provider error surfaced to
  // Office staff, and the real technical failure is still logged.
  let effectiveMessage = internalRequest.message;
  let mediaFailureNote: string | null = null;
  const rawImageDataUrl = safeText((req.body || {}).image_data_url);
  const rawDocumentDataUrl = safeText((req.body || {}).document_data_url);
  if (rawImageDataUrl) {
    try {
      const observation = await analyzeCommunicationFrame({
        image_data_url: rawImageDataUrl,
        prompt: internalRequest.message || null,
        surface: "office_internal",
        communications_session_id: internalRequest.office_session_id,
        source_participant_id: actor.id,
      });
      effectiveMessage = [
        internalRequest.message,
        "",
        "Authorized visual observation from this Office conversation:",
        `Summary: ${observation.summary}`,
        observation.visible_objects.length ? `Visible objects: ${observation.visible_objects.join(", ")}` : "",
        observation.visible_text.length ? `Visible text: ${observation.visible_text.join("; ")}` : "",
        observation.uncertainty ? `Uncertainty: ${observation.uncertainty}` : "",
      ].filter(Boolean).join("\n");
    } catch (error: any) {
      logger.error("office_internal.visual_analysis_failed", { request_id: requestId, detail: safeText(error?.message, "visual_analysis_failed") });
      mediaFailureNote = "Oyi couldn't complete the visual analysis right now. Try again in a moment.";
    }
  } else if (rawDocumentDataUrl) {
    try {
      const analysis = await analyzeCommunicationDocument({
        file_data_url: rawDocumentDataUrl,
        filename: safeText((req.body || {}).document_filename, "document"),
        prompt: internalRequest.message || null,
        surface: "office_internal",
      });
      effectiveMessage = [
        internalRequest.message,
        "",
        `Authorized file analysis from this Office conversation (${analysis.filename}):`,
        `Summary: ${analysis.summary}`,
        analysis.key_points.length ? `Key points: ${analysis.key_points.join("; ")}` : "",
        analysis.document_type_guess ? `Likely document type: ${analysis.document_type_guess}` : "",
        analysis.uncertainty ? `Uncertainty: ${analysis.uncertainty}` : "",
      ].filter(Boolean).join("\n");
    } catch (error: any) {
      logger.error("office_internal.document_analysis_failed", { request_id: requestId, detail: safeText(error?.message, "document_analysis_failed") });
      const unsupported = /document_type_unsupported/.test(safeText(error?.message));
      mediaFailureNote = unsupported
        ? "Oyi can't read that file type yet — try a PDF, plain text file, or image."
        : "Oyi couldn't finish analysing that file right now. Try again in a moment.";
    }
  }

  const canonical = await conversationOrchestrator.run({
    actor,
    oisContext: {
    surface: "office_internal" as any,
    estate_id: null,
    home_id: null,
    module: "office_internal",
    role: internalRequest.staff.role,
  } as any,
    input: {
    message: effectiveMessage,
    surface: "office_internal" as any,
    role: internalRequest.staff.role,
    module: "office_internal",
    thread_id: internalRequest.conversation_thread_id,
    context: {
      request_id: internalRequest.request_id,
      office_session_id: internalRequest.office_session_id,
      staff: internalRequest.staff,
      plan_review_context: internalRequest.plan_review_context,
      page_context: internalRequest.page_context,
      business_unit: internalRequest.business_unit,
      crm_context: internalRequest.crm_context,
      portfolio_context: internalRequest.portfolio_context,
      support_context: internalRequest.support_context,
      project_context: internalRequest.project_context,
      task_context: internalRequest.task_context,
      task_batch_context: internalRequest.task_batch_context,
      execution_failed: internalRequest.execution_failed,
      execution_failure_reason: internalRequest.execution_failure_reason,
      automation_context: internalRequest.automation_context,
      meeting_context: internalRequest.meeting_context,
      partnership_context: internalRequest.partnership_context,
      document_context: internalRequest.document_context,
      content_context: internalRequest.content_context,
      operational_snapshot: internalRequest.operational_snapshot || null,
      contract_version: CORPORATE_INTELLIGENCE_CONTRACT_VERSION,
    },
    conversation_context: {
      office_session_id: internalRequest.office_session_id,
      business_unit: internalRequest.business_unit,
      selected_type: internalRequest.page_context.selected_type,
      selected_id: internalRequest.page_context.selected_id,
      crm_safe_summary: internalRequest.crm_context?.safe_summary || null,
      portfolio_safe_summary: internalRequest.portfolio_context?.safe_summary || null,
      support_safe_summary: internalRequest.support_context?.safe_summary || null,
      project_safe_summary: internalRequest.project_context?.safe_summary || null,
      task_safe_summary: internalRequest.task_context?.safe_summary || null,
      automation_safe_summary: internalRequest.automation_context?.safe_summary || null,
      meeting_safe_summary: internalRequest.meeting_context?.safe_summary || null,
      partnership_safe_summary: internalRequest.partnership_context?.safe_summary || null,
      document_safe_summary: internalRequest.document_context?.safe_summary || null,
      content_safe_summary: internalRequest.content_context?.safe_summary || null,
    },
    intent_hint: "office_internal_conversation",
    operation_class_hint: "read",
    scope_mode_hint: "global",
    } as any,
  });
  // Phase 4, PR 6 -- loaded here (not carried on internalRequest, which
  // represents INBOUND Office data) so "do that every Friday" can
  // reference whatever governed-action proposal was just verified in
  // this same thread. Own try/catch inside the loader already returns
  // null on any failure -- never blocks the response.
  const lastVerifiedAction = await loadLastVerifiedOfficeAction(internalRequest.conversation_thread_id, actor.id);
  // Wave 9 Slice 1 -- same real retrieval as the public route, staff
  // audience ceiling (may see INTERNAL_COMMERCIAL knowledge public callers
  // cannot).
  const retrievedKnowledge = await retrieveKnowledge({
    actor: OFFICE_INTERNAL_KNOWLEDGE_ACTOR,
    domains: knowledgeDomainsForBusinessUnit(internalRequest.business_unit),
    query: effectiveMessage,
  }).then((result) => result.items).catch(() => []);
  const response = buildOfficeInternalResponse(internalRequest, canonical, lastVerifiedAction, retrievedKnowledge);
  if (mediaFailureNote) {
    response.answer = response.answer ? `${mediaFailureNote}\n\n${response.answer}` : mediaFailureNote;
  }
  void emitAuditEvent({
    actorId: actor.id,
    actorRole: internalRequest.staff.role,
    action: "office.internal_conversation.completed",
    resourceType: "office_session",
    resourceId: internalRequest.office_session_id,
    status: "success",
    metadata: {
      request_id: requestId,
      thread_id: response.conversation_thread_id,
      business_unit: response.business_domain,
      attention_signal: response.attention_signal,
      tool_proposal_count: response.tool_proposals.length,
    },
    req,
  });
  return res.status(200).json(response);
});

// Oyi Office Intelligence Interaction Repositioning — speech synthesis
// for the turn-based Voice Chat shell (record -> existing transcribe
// route -> existing /conversation/internal -> this route -> playback).
// Reuses synthesizeOyiSpeech() verbatim (same function already proven
// live on the consumer website's voice turns) behind the SAME
// requireOfficeExportKey gate Office already authenticates every other
// call with -- no new auth boundary, no new voice capability.
router.post("/conversation/speech", requireOfficeExportKey, async (req: Request, res: Response) => {
  const requestId = safeText(req.headers["x-request-id"], crypto.randomUUID());
  const text = safeText(req.body?.text).slice(0, 4000);
  if (!text) {
    return res.status(400).json({ ok: false, error: "text_required", request_id: requestId });
  }
  try {
    const audio = await synthesizeOyiSpeech({ text });
    return res.status(200).json({
      ok: true,
      request_id: requestId,
      audio_data_url: audio.audio_data_url,
      mime_type: audio.mime_type,
    });
  } catch (error: any) {
    logger.error("office_internal.speech_synthesis_failed", { request_id: requestId, detail: safeText(error?.message, "speech_synthesis_failed") });
    return res.status(502).json({
      ok: false,
      error: "speech_synthesis_failed",
      message: "Oyi couldn't generate speech for that reply right now.",
      request_id: requestId,
    });
  }
});

// Commercial production-hardening: this is the ONLY way a new production
// estate/facility deployment gets created now that POST /auth/signup no
// longer auto-provisions one. Gated by the same requireOfficeExportKey
// machine trust every other Office<->Backend call already uses -- Office is
// the sole authorized provisioning caller. Creates the estate plus a
// pending, hashed-token, estate-scoped owner invite (reusing the invites
// table + validate_estate_owner_invite/activate_estate_owner_invite RPCs);
// returns the raw activation token ONCE so Office can build/send its own
// branded invitation email (mirroring exactly how Office's existing staff-
// invite flow already works) -- Backend never sends this email itself.
router.post("/facility/provision", requireOfficeExportKey, async (req: Request, res: Response) => {
  const requestId = safeText(req.headers["x-request-id"], nodeCrypto.randomUUID());
  const body = req.body || {};
  const name = safeText(body.name);
  const adminEmail = safeText(body.admin_email).toLowerCase();
  if (!name) return res.status(400).json({ ok: false, error: "name_required", request_id: requestId });
  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return res.status(400).json({ ok: false, error: "valid_admin_email_required", request_id: requestId });
  }

  try {
    const { data: estate, error: estateErr } = await supabaseAdmin
      .from("estates")
      .insert({
        name,
        address: safeText(body.address) || null,
        lat: typeof body.lat === "number" ? body.lat : null,
        lng: typeof body.lng === "number" ? body.lng : null,
        type: safeText(body.type, "estate"),
        timezone: safeText(body.timezone) || null,
      })
      .select()
      .single();
    if (estateErr) throw new Error(estateErr.message);

    const rawToken = nodeCrypto.randomBytes(32).toString("hex");
    const tokenHash = nodeCrypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresInDays = Math.min(30, Math.max(1, Number(body.expires_in_days) || 14));
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from("invites")
      .insert({
        estate_id: estate.id,
        home_id: null,
        room_id: null,
        role: "owner",
        invite_type: "email",
        token_hash: tokenHash,
        invited_email: adminEmail,
        status: "pending",
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (inviteErr) throw new Error(inviteErr.message);

    void emitAuditEvent({
      actorId: null,
      actorRole: "office_staff",
      action: "facility.provisioned",
      resourceType: "estate",
      resourceId: estate.id,
      estateId: estate.id,
      status: "success",
      metadata: { request_id: requestId, name, invited_by_office: safeText(body.requested_by) || null },
      req,
    } as any);
    void emitAuditEvent({
      actorId: null,
      actorRole: "office_staff",
      action: "facility.invitation.created",
      resourceType: "invite",
      resourceId: invite.id,
      estateId: estate.id,
      status: "success",
      metadata: { request_id: requestId, invited_email: adminEmail, expires_at: expiresAt },
      req,
    } as any);

    return res.status(200).json({
      ok: true,
      request_id: requestId,
      estate: { id: estate.id, name: estate.name },
      invite: { id: invite.id, expires_at: expiresAt },
      activation_token: rawToken,
    });
  } catch (error: any) {
    logger.error("office.facility_provision_failed", { request_id: requestId, detail: safeText(error?.message, "facility_provision_failed") });
    return res.status(500).json({ ok: false, error: "facility_provision_failed", request_id: requestId });
  }
});

// Office-callable owner-invite resend/revoke -- reuses the exact same
// rotate/revoke SQL estateInvites.controller.ts already uses for team
// invites (estateInviteMutationService.ts), the only difference is
// authorization: there is no Facility session yet for a not-yet-activated
// estate, so these are gated by the same requireOfficeExportKey machine
// trust as /facility/provision, scoped to the estate Office already knows
// about (never a client-guessable invite id). Mirrors the provision
// route's own boundary: Backend never sends this email -- it only rotates
// the token and returns it once, so Office can build/send its own branded
// resend email exactly like it does for the original invite.
router.post("/facility/estates/:estateId/owner-invite/resend", requireOfficeExportKey, async (req: Request, res: Response) => {
  const requestId = safeText(req.headers["x-request-id"], nodeCrypto.randomUUID());
  const estateId = safeText(req.params.estateId);
  if (!estateId) return res.status(400).json({ ok: false, error: "estate_id_required", request_id: requestId });

  const pending = await findPendingOwnerInvite(estateId);
  if (!pending.ok) return res.status(404).json({ ok: false, error: pending.error, request_id: requestId });

  const rotated = await rotateEstateInviteToken(pending.invite.id);
  if (!rotated.ok) {
    logger.error("office.facility_owner_invite_resend_failed", { request_id: requestId, estate_id: estateId, detail: rotated.error });
    return res.status(500).json({ ok: false, error: "resend_failed", request_id: requestId });
  }

  void emitAuditEvent({
    actorId: null,
    actorRole: "office_staff",
    action: "facility.invitation.resent",
    resourceType: "invite",
    resourceId: pending.invite.id,
    estateId,
    status: "success",
    metadata: { request_id: requestId, invited_email: pending.invite.invited_email, expires_at: rotated.expiresAt },
    req,
  } as any);

  return res.status(200).json({
    ok: true,
    request_id: requestId,
    invite: { id: pending.invite.id, invited_email: pending.invite.invited_email, expires_at: rotated.expiresAt },
    activation_token: rotated.rawToken,
  });
});

router.post("/facility/estates/:estateId/owner-invite/revoke", requireOfficeExportKey, async (req: Request, res: Response) => {
  const requestId = safeText(req.headers["x-request-id"], nodeCrypto.randomUUID());
  const estateId = safeText(req.params.estateId);
  if (!estateId) return res.status(400).json({ ok: false, error: "estate_id_required", request_id: requestId });

  const pending = await findPendingOwnerInvite(estateId);
  if (!pending.ok) return res.status(404).json({ ok: false, error: pending.error, request_id: requestId });

  const revoked = await revokeEstateInviteById(pending.invite.id, null);
  if (!revoked.ok) {
    logger.error("office.facility_owner_invite_revoke_failed", { request_id: requestId, estate_id: estateId, detail: revoked.error });
    return res.status(500).json({ ok: false, error: "revoke_failed", request_id: requestId });
  }

  void emitAuditEvent({
    actorId: null,
    actorRole: "office_staff",
    action: "facility.invitation.revoked",
    resourceType: "invite",
    resourceId: pending.invite.id,
    estateId,
    status: "success",
    metadata: { request_id: requestId, invited_email: pending.invite.invited_email },
    req,
  } as any);

  return res.status(200).json({ ok: true, request_id: requestId, invite: { id: pending.invite.id } });
});

// Office -> Facility provisioning lifecycle -- governed Portfolio delete.
// Only ever removes an estate that has NEVER been activated (zero
// estate_memberships -- the same signal every activation path upserts in
// the same transaction as users.estate_id, so this is the true "has
// anyone ever done anything here" gate) and has none of the real
// operational dependencies a genuine live Facility would have. This is
// intentionally NOT a general-purpose estate-deletion capability -- it
// exists only to let Office clean up abandoned/failed provisioning
// attempts, never an activated tenant. Idempotent: deleting an estate
// that is already gone returns ok:true rather than erroring, so a
// repeated click from Office's UI can never be a dangerous failure.
router.delete("/facility/estates/:estateId", requireOfficeExportKey, async (req: Request, res: Response) => {
  const requestId = safeText(req.headers["x-request-id"], nodeCrypto.randomUUID());
  const estateId = safeText(req.params.estateId);
  if (!estateId) return res.status(400).json({ ok: false, error: "estate_id_required", request_id: requestId });

  const { data: estate, error: estateErr } = await supabaseAdmin
    .from("estates")
    .select("id, name")
    .eq("id", estateId)
    .maybeSingle();
  if (estateErr) {
    logger.error("office.facility_delete_lookup_failed", { request_id: requestId, estate_id: estateId, detail: safeText(estateErr.message) });
    return res.status(500).json({ ok: false, error: "facility_delete_failed", request_id: requestId });
  }
  if (!estate) {
    return res.status(200).json({ ok: true, request_id: requestId, already_deleted: true, estate_id: estateId });
  }

  let eligibility;
  try {
    eligibility = await checkEstateDeletionEligibility(estateId);
  } catch (error: any) {
    logger.error("office.facility_delete_eligibility_failed", { request_id: requestId, estate_id: estateId, detail: safeText(error?.message) });
    return res.status(500).json({ ok: false, error: "facility_delete_failed", request_id: requestId });
  }
  if (!eligibility.eligible) {
    return res.status(409).json({
      ok: false,
      error: "facility_has_operational_dependencies",
      blocking: eligibility.blocking,
      request_id: requestId,
    });
  }

  const { data: invites, error: invitesErr } = await supabaseAdmin
    .from("invites")
    .select("id, invited_email, status")
    .eq("estate_id", estateId);
  if (invitesErr) {
    logger.error("office.facility_delete_invites_lookup_failed", { request_id: requestId, estate_id: estateId, detail: safeText(invitesErr.message) });
    return res.status(500).json({ ok: false, error: "facility_delete_failed", request_id: requestId });
  }

  const { error: deleteInvitesErr } = await supabaseAdmin.from("invites").delete().eq("estate_id", estateId);
  if (deleteInvitesErr) {
    logger.error("office.facility_delete_invites_failed", { request_id: requestId, estate_id: estateId, detail: safeText(deleteInvitesErr.message) });
    return res.status(500).json({ ok: false, error: "facility_delete_failed", request_id: requestId });
  }

  const { error: deleteEstateErr } = await supabaseAdmin.from("estates").delete().eq("id", estateId);
  if (deleteEstateErr) {
    logger.error("office.facility_delete_estate_failed", { request_id: requestId, estate_id: estateId, detail: safeText(deleteEstateErr.message) });
    return res.status(500).json({ ok: false, error: "facility_delete_failed", request_id: requestId });
  }

  for (const invite of invites || []) {
    void emitAuditEvent({
      actorId: null,
      actorRole: "office_staff",
      action: "facility.invitation.revoked",
      resourceType: "invite",
      resourceId: invite.id,
      estateId,
      status: "success",
      metadata: { request_id: requestId, invited_email: invite.invited_email, reason: "facility_provisioning_deleted" },
      req,
    } as any);
  }
  void emitAuditEvent({
    actorId: null,
    actorRole: "office_staff",
    action: "facility.deleted",
    resourceType: "estate",
    resourceId: estateId,
    estateId,
    status: "success",
    metadata: { request_id: requestId, name: estate.name, invites_removed: (invites || []).length },
    req,
  } as any);

  return res.status(200).json({
    ok: true,
    request_id: requestId,
    deleted: true,
    estate_id: estateId,
    invites_removed: (invites || []).length,
  });
});

function groupBuildings(homes: Row[], devices: Row[], nowIso: string) {
  const groups = new Map<string, Row>();

  for (const home of homes) {
    const estateId = String(home.estate_id || "unassigned_estate");
    const block = String(home.building || home.block || home.wing || home.cluster || "Main Block").trim();
    const id = `oyi_building_${estateId}_${block.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        estate_id: estateId,
        name: block || "Main Block",
        type: home.type || "estate block",
        homes_count: 0,
        devices_count: 0,
        permitted_users: 0,
        live_cameras: null, // No canonical camera relationship exists for this device inventory count.
        configured_camera_devices: 0,
        occupancy_pct: 0,
        created_at: home.created_at || nowIso,
        updated_at: nowIso,
      });
    }

    const group = groups.get(id)!;
    group.homes_count += 1;
    group.permitted_users += toNumber(home.residents_count || home.users_count || home.occupants_count);
  }

  for (const device of devices) {
    const estateId = String(device.estate_id || "unassigned_estate");
    const block = String(device.building || device.block || "Main Block").trim();
    const id = `oyi_building_${estateId}_${block.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        estate_id: estateId,
        name: block || "Main Block",
        type: "device cluster",
        homes_count: 0,
        devices_count: 0,
        permitted_users: 0,
        live_cameras: null,
        configured_camera_devices: 0,
        occupancy_pct: 0,
        created_at: device.created_at || nowIso,
        updated_at: nowIso,
      });
    }

    const group = groups.get(id)!;
    group.devices_count += 1;
    if (/camera|cctv|video/i.test(String(device.category || device.type || device.name || ""))) {
      group.configured_camera_devices += 1;
    }
  }

  return Array.from(groups.values()).map((building) => ({
    ...building,
    occupancy_pct: building.homes_count ? Math.min(100, Math.round((building.permitted_users / building.homes_count) * 100)) : 0,
  }));
}

router.get("/export", requireOfficeExportKey, async (req: Request, res: Response) => {
  const nowIso = new Date().toISOString();

  const [
    estatesResult,
    homesResult,
    devicesResult,
    estateWalletsResult,
    walletsResult,
    maintenanceRequestsResult,
    notificationsResult,
    estateMembershipsResult,
    homeMembershipsResult,
    visitorsResult,
    communityPostsResult,
    usersResult,
    roomsResult,
    incidentsResult,
    edgeHeartbeatsResult,
    utilityEventsResult,
    automationsResult,
    deviceTelemetryResult,
    providerWebhookEventsResult,
  ] = await Promise.all([
    safeSelectWithStatus("estates"),
    safeSelectWithStatus("homes"),
    safeSelectWithStatus("devices"),
    safeSelectWithStatus("estate_wallets"),
    safeSelectWithStatus("wallets"),
    safeSelectWithStatus("maintenance_requests"),
    safeSelectWithStatus("notifications"),
    safeSelectWithStatus("estate_memberships"),
    safeSelectWithStatus("home_memberships"),
    safeSelectWithStatus("visitors"),
    safeSelectWithStatus("community_posts"),
    safeSelectWithStatus("users", "id,email,full_name,username,role,estate_id,home_id,account_status,created_at,updated_at"),
    safeSelectWithStatus("rooms"),
    safeSelectWithStatus("incidents"),
    safeSelectWithStatus("edge_heartbeats"),
    safeSelectWithStatus("utility_events"),
    safeSelectWithStatus("automations"),
    safeSelectWithStatus("device_telemetry"),
    safeSelectWithStatus("provider_webhook_events"),
  ]);

  const estates = estatesResult.rows;
  const homes = homesResult.rows;
  const devices = await projectDeviceCurrentStateRows(devicesResult.rows);
  const estateWallets = estateWalletsResult.rows;
  const wallets = walletsResult.rows;
  const maintenanceRequests = maintenanceRequestsResult.rows;
  const notifications = notificationsResult.rows;
  const estateMemberships = estateMembershipsResult.rows;
  const homeMemberships = homeMembershipsResult.rows;
  const visitors = visitorsResult.rows;
  const communityPosts = communityPostsResult.rows;
  const users = usersResult.rows;
  const rooms = roomsResult.rows;
  const incidents = incidentsResult.rows;
  const edgeHeartbeats = edgeHeartbeatsResult.rows;
  const utilityEvents = utilityEventsResult.rows;
  const automations = automationsResult.rows;
  const deviceTelemetry = deviceTelemetryResult.rows;
  const providerWebhookEvents = providerWebhookEventsResult.rows;

  const packageMap = new Map<string, Row>();
  const officeEstates = estates.map((estate) => {
    const pkg = makePackage(estate, nowIso);
    packageMap.set(pkg.id, pkg);
    const estateId = String(estate.id);
    const estateHomes = homes.filter((home) => String(home.estate_id) === estateId);
    const estateDevices = devices.filter((device) => String(device.estate_id) === estateId);
    const estateWallet = estateWallets.find((wallet) => String(wallet.estate_id) === estateId);
    const memberCount = estateMemberships.filter((member) => String(member.estate_id) === estateId).length;
    const openSupport = maintenanceRequests.filter(
      (ticket) => String(ticket.estate_id) === estateId && ["open", "in_progress", "pending"].includes(String(ticket.status || "open"))
    ).length;
    const unreadAlerts = notifications.filter(
      (notice) => String(notice.estate_id) === estateId && (notice.read === false || notice.read_at == null)
    ).length;

    return {
      id: estateId,
      name: estate.name || "Unnamed Estate",
      package_id: pkg.id,
      status: estate.status || "active",
      subscription_status: estate.subscription_status || estate.membership_status || "live",
      location: estate.address || estate.location || "",
      latitude: estate.latitude ?? estate.lat ?? estate.geo?.latitude ?? estate.geo?.lat ?? null,
      longitude: estate.longitude ?? estate.lng ?? estate.geo?.longitude ?? estate.geo?.lng ?? null,
      health_score: estate.health_score ?? estate.health_pct ?? null,
      metadata: {
        community_posts: communityPosts.filter((post) => String(post.estate_id) === estateId).length,
        utility_count: toNumber(estate.utility_count || estate.utilities_count),
        source: "oyi_backend_export",
      },
      buildings_count: new Set(estateHomes.map((home) => home.building || home.block || "Main Block")).size,
      homes_count: estateHomes.length,
      devices_count: estateDevices.length,
      resident_count: memberCount,
      wallet_balance: toNumber(estateWallet?.balance),
      support_open: openSupport + unreadAlerts,
      support_escalated: maintenanceRequests.filter(
        (ticket) => String(ticket.estate_id) === estateId && String(ticket.priority || "").toLowerCase() === "critical"
      ).length,
      connected_at: estate.created_at || nowIso,
      updated_at: estate.updated_at || nowIso,
    };
  });

  const officeHomes = homes.map((home) => ({
    id: String(home.id),
    estate_id: String(home.estate_id || ""),
    building_id: `oyi_building_${String(home.estate_id || "unassigned_estate")}_${String(home.building || home.block || "Main Block")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")}`,
    name: home.name || home.unit || "Unnamed Home",
    residents_count: home.residents_count || home.users_count || homeMemberships.filter((member) => String(member.home_id) === String(home.id)).length,
    devices_count: devices.filter((device) => String(device.home_id) === String(home.id)).length,
    automation_state: home.automation_state || home.status || "standby",
    created_at: home.created_at || nowIso,
    updated_at: home.updated_at || nowIso,
  }));

  const officeDevices = devices.map((device) => ({
    id: String(device.id || device.device_id || device.external_id),
    estate_id: device.estate_id || null,
    building_id: device.building_id || null,
    home_id: device.home_id || null,
    name: device.name || device.label || "Unnamed Device",
    category: device.category || device.type || "hardware",
    provider: device.provider || device.adapter || "oyi-os",
    status: device.status,
    current_state: device.current_state,
    battery_level: device.battery_level ?? device.battery ?? null,
    last_seen_at: device.last_seen_at || device.last_seen || device.updated_at || null,
    metadata: device.metadata || {},
    created_at: device.created_at || nowIso,
    updated_at: device.updated_at || nowIso,
  }));

  const officeWallets = estateWallets.map((wallet, index) => ({
    id: String(wallet.id || `oyi_wallet_${index + 1}`),
    scope_type: "estate",
    scope_id: String(wallet.estate_id || ""),
    label: wallet.label || wallet.name || "Oyi Wallet",
    balance: toNumber(wallet.balance),
    currency: wallet.currency || "NGN",
    pending_charges: toNumber(wallet.pending_charges || wallet.outstanding_dues),
    created_at: wallet.created_at || nowIso,
    updated_at: wallet.updated_at || nowIso,
  }));

  const supportMappings = maintenanceRequests.map((ticket, index) => ({
    id: String(ticket.id || `oyi_support_${index + 1}`),
    estate_id: ticket.estate_id || null,
    building_id: ticket.building_id || null,
    home_id: ticket.home_id || null,
    title: ticket.title || ticket.subject || ticket.description || "Maintenance request",
    category: ticket.category || "maintenance",
    channel: ticket.channel || "facility",
    priority: ticket.priority || "medium",
    status: ticket.status || "open",
    assigned_team: ticket.assigned_team || ticket.assigned_to || "customer_support",
    created_at: ticket.created_at || nowIso,
    updated_at: ticket.updated_at || nowIso,
  }));

  const analytics = [
    {
      id: "oyi_facility_live_export",
      surface: "facility_system",
      label: "Oyi Facility Live Export",
      period: "live",
      sessions: visitors.length,
      unique_visitors: new Set(visitors.map((visitor) => visitor.user_id || visitor.email || visitor.phone)).size,
      conversions: 0,
      active_agent: "Oyi OS",
      top_source: "Oyi Backend",
      top_location: officeEstates[0]?.location || "",
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: "oyi_consumer_live_export",
      surface: "consumer_sync",
      label: "Oyi Smart Home Live Export",
      period: "live",
      sessions: homes.length,
      unique_visitors: homeMemberships.length,
      conversions: devices.length,
      active_agent: "Oyi Consumer",
      top_source: "Smart Home OS",
      top_location: "",
      created_at: nowIso,
      updated_at: nowIso,
    },
  ];

  const officeUsers = users.map((user) => ({
    id: String(user.id),
    email: user.email || "",
    display_name: user.full_name || user.username || user.email || "User",
    role: user.role || "resident",
    status: user.account_status || "active",
    estate_id: user.estate_id || null,
    home_id: user.home_id || null,
    created_at: user.created_at || nowIso,
    updated_at: user.updated_at || nowIso,
  }));

  const officeVisitors = visitors.map((visitor, index) => ({
    id: String(visitor.id || `oyi_visitor_${index + 1}`),
    estate_id: visitor.estate_id || null,
    home_id: visitor.home_id || null,
    name: visitor.name || visitor.visitor_name || "Visitor",
    status: visitor.status || "pending",
    created_at: visitor.created_at || nowIso,
    updated_at: visitor.updated_at || nowIso,
    metadata: visitor,
  }));

  const officeRooms = rooms.map((room, index) => ({
    id: String(room.id || `oyi_room_${index + 1}`),
    estate_id: room.estate_id || null,
    home_id: room.home_id || null,
    name: room.name || room.label || "Room",
    type: room.type || "room",
    created_at: room.created_at || nowIso,
    updated_at: room.updated_at || nowIso,
    metadata: room.metadata || {},
  }));

  const maintenance = maintenanceRequests.map((ticket, index) => exportRecord("maintenance", ticket, index, nowIso));
  const incidentRecords = incidents.map((incident, index) => exportRecord("incident", incident, index, nowIso));
  const edgeHeartbeatRecords = edgeHeartbeats.map((heartbeat, index) => exportRecord("edge_heartbeat", heartbeat, index, nowIso));
  const utilityEventRecords = utilityEvents.map((event, index) => exportRecord("utility_event", event, index, nowIso));
  const community = communityPosts.map((post, index) => exportRecord("community", post, index, nowIso));
  const support = supportMappings.map((ticket) => ({ ...ticket, metadata: { source: "maintenance_requests" } }));
  const automationRecords = automations.map((automation, index) => exportRecord("automation", automation, index, nowIso));
  const telemetryRecords = deviceTelemetry.map((telemetry, index) => exportRecord("device_telemetry", telemetry, index, nowIso));
  const webhookDeliveryRecords = providerWebhookEvents.map((event, index) => ({
    id: String(event.id || `provider_webhook_${index + 1}`),
    provider: event.provider || "unknown",
    event_type: event.event_type || event.type || "provider.event",
    received_at: event.received_at || event.created_at || nowIso,
    verified: Boolean(event.verified),
    signature_status: event.signature_status || "unknown",
    delivery_status: event.delivery_status || event.status || "recorded",
    error_message: event.error_message || "",
    payload_summary: event.payload_summary || event.metadata || {},
    related_estate_id: event.related_estate_id || event.estate_id || null,
    related_user_id: event.related_user_id || event.user_id || null,
  }));

  const sourceStatus = {
    estates: estatesResult.source,
    homes: homesResult.source,
    devices: devicesResult.source,
    estate_wallets: estateWalletsResult.source,
    wallets: walletsResult.source,
    maintenance_requests: maintenanceRequestsResult.source,
    notifications: notificationsResult.source,
    estate_memberships: estateMembershipsResult.source,
    home_memberships: homeMembershipsResult.source,
    visitors: visitorsResult.source,
    community_posts: communityPostsResult.source,
    users: usersResult.source,
    rooms: roomsResult.source,
    incidents: incidentsResult.source,
    edge_heartbeats: edgeHeartbeatsResult.source,
    utility_events: utilityEventsResult.source,
    automations: automationsResult.source,
    device_telemetry: deviceTelemetryResult.source,
    provider_webhook_events: providerWebhookEventsResult.source,
  };

  const completeness = {
    facility: {
      estates: estatesResult.source.available,
      buildings: homesResult.source.available || devicesResult.source.available,
      homes: homesResult.source.available,
      devices: devicesResult.source.available,
      maintenance: maintenanceRequestsResult.source.available,
      incidents: incidentsResult.source.available,
      edge_heartbeats: edgeHeartbeatsResult.source.available,
      utility_events: utilityEventsResult.source.available,
    },
    consumer: {
      homes: homesResult.source.available,
      rooms: roomsResult.source.available,
      residents: usersResult.source.available || homeMembershipsResult.source.available,
      users: usersResult.source.available,
      devices: devicesResult.source.available,
      community: communityPostsResult.source.available,
      support: maintenanceRequestsResult.source.available,
      automations: automationsResult.source.available,
      notifications: notificationsResult.source.available,
      device_telemetry: deviceTelemetryResult.source.available,
    },
    webhooks: {
      provider_events: providerWebhookEventsResult.source.available,
      delivery_history: providerWebhookEventsResult.source.available,
    },
  };

  void emitAuditEvent({
    actorId: "office_sync",
    actorEmail: "office-sync@ochiga.local",
    actorRole: "system",
    action: "office.export.accessed",
    resourceType: "office_export",
    resourceId: "office/export",
    status: "success",
    metadata: {
      completeness,
      source_counts: Object.fromEntries(Object.entries(sourceStatus).map(([key, value]) => [key, value.count])),
    },
    req,
  } as any);

  return res.json({
    source: "oyi-os",
    contract_version: CONTRACT_VERSION,
    generated_at: nowIso,
    collections: {
      packages: Array.from(packageMap.values()),
      estates: officeEstates,
      buildings: groupBuildings(homes, devices, nowIso),
      homes: officeHomes,
      devices: officeDevices,
      wallets: officeWallets,
      analytics,
      support_mappings: supportMappings,
      users: officeUsers,
      visitors: officeVisitors,
      rooms: officeRooms,
      maintenance,
      incidents: incidentRecords,
      edge_heartbeats: edgeHeartbeatRecords,
      utility_events: utilityEventRecords,
      community,
      support,
      automations: automationRecords,
      notifications,
      device_telemetry: telemetryRecords,
      webhook_events: webhookDeliveryRecords,
    },
    completeness,
    meta: {
      sources: sourceStatus,
      missing_sources: Object.fromEntries(Object.entries(sourceStatus).filter(([, value]) => !value.available).map(([key, value]) => [key, sourceUnavailable(value.required_source)])),
      webhook_delivery: {
        available: providerWebhookEventsResult.source.available,
        count: providerWebhookEvents.length,
        required_source: "provider_webhook_events",
      },
      raw_counts: {
        estates: estates.length,
        homes: homes.length,
        devices: devices.length,
        estate_wallets: estateWallets.length,
        wallets: wallets.length,
        maintenance_requests: maintenanceRequests.length,
        notifications: notifications.length,
        community_posts: communityPosts.length,
        users: users.length,
        rooms: rooms.length,
        maintenance: maintenance.length,
        incidents: incidentRecords.length,
        edge_heartbeats: edgeHeartbeatRecords.length,
        utility_events: utilityEventRecords.length,
        community: community.length,
        support: support.length,
        automations: automationRecords.length,
        notification_records: notifications.length,
        device_telemetry: telemetryRecords.length,
        webhook_events: webhookDeliveryRecords.length,
      },
    },
  });
});

// ---------------------------------------------------------------
// Safe Office Portfolio projection — the ONLY Facility/Consumer data
// source Ochiga Office's Portfolio module should read from. Unlike
// /office/export (a broad raw dump used for internal sync tooling),
// this route computes and returns AGGREGATE COUNTS ONLY, per estate
// and per building: homes, occupied homes, connected devices, devices
// online, open major escalations, and a generic last-activity signal.
// It never returns wallet balances, camera counts, resident/member
// identities, visitor records, community posts, or any other
// Facility/Consumer internal — those fields are simply never selected
// or computed here, so there is nothing sensitive to accidentally leak
// downstream. Office's own office_portfolio_entries table remains the
// corporate identity/relationship record; this endpoint supplies only
// the live operational numbers layered on top of it.
// ---------------------------------------------------------------
function isOpenEscalation(row: Row) {
  const status = String(row.status || "open").toLowerCase();
  if (!["open", "in_progress", "pending"].includes(status)) return false;
  const priority = String(row.priority || row.severity || "").toLowerCase();
  return ["high", "critical", "urgent"].includes(priority);
}

function buildingKey(estateId: string, block: string) {
  return `oyi_building_${estateId}_${String(block || "main").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

router.get("/portfolio/projection", requireOfficeExportKey, async (req: Request, res: Response) => {
  const nowIso = new Date().toISOString();
  const estateIdFilter = safeText(req.query.estate_id as string) || null;
  const buildingIdFilter = safeText(req.query.building_id as string) || null;

  const [estatesResult, homesResult, devicesResult, maintenanceResult, incidentsResult, membershipsResult] = await Promise.all([
    safeSelectWithStatus("estates"),
    safeSelectWithStatus("homes"),
    safeSelectWithStatus("devices"),
    safeSelectWithStatus("maintenance_requests"),
    safeSelectWithStatus("incidents"),
    safeSelectWithStatus("estate_memberships"),
  ]);

  const estates = estatesResult.rows;
  const homes = homesResult.rows;
  const devices = await projectDeviceCurrentStateRows(devicesResult.rows);
  const escalationRows = [...maintenanceResult.rows, ...incidentsResult.rows];
  // Office-provisioning lifecycle: the one signal Office needs to learn a
  // just-invited owner actually activated -- reusing this already-polled-
  // on-every-Portfolio-list-load aggregate rather than a new webhook lane.
  const activeOwnerEstateIds = new Set(
    membershipsResult.rows
      .filter((m) => ["owner", "admin"].includes(String(m.role || "").toLowerCase()) && String(m.status || "").toLowerCase() === "active")
      .map((m) => String(m.estate_id))
  );

  const buildingMap = new Map<string, Row>();
  for (const home of homes) {
    const estateId = String(home.estate_id || "");
    if (!estateId) continue;
    const block = String(home.building || home.block || home.wing || home.cluster || "Main Block").trim();
    const id = buildingKey(estateId, block);
    if (!buildingMap.has(id)) {
      buildingMap.set(id, {
        id,
        estate_id: estateId,
        name: block || "Main Block",
        homes_total: 0,
        homes_active: 0,
        devices_total: 0,
        devices_online: 0,
        devices_reporting: 0,
      });
    }
    const b = buildingMap.get(id)!;
    b.homes_total += 1;
    if (toNumber(home.residents_count || home.users_count) > 0) b.homes_active += 1;
  }
  for (const device of devices) {
    const estateId = String(device.estate_id || "");
    if (!estateId) continue;
    const home = homes.find((h) => String(h.id) === String(device.home_id));
    const block = String(device.building || device.block || home?.building || home?.block || "Main Block").trim();
    const id = buildingKey(estateId, block);
    if (!buildingMap.has(id)) {
      buildingMap.set(id, {
        id,
        estate_id: estateId,
        name: block || "Main Block",
        homes_total: 0,
        homes_active: 0,
        devices_total: 0,
        devices_online: 0,
        devices_reporting: 0,
      });
    }
    const b = buildingMap.get(id)!;
    b.devices_total += 1;
    if (device.current_state?.freshness === "fresh" && ["online", "offline"].includes(device.current_state.availability)) b.devices_reporting += 1;
    if (device.current_state?.availability === "online") b.devices_online += 1;
  }

  function escalationsFor(estateId: string, id: string | null) {
    return escalationRows.filter((row) => {
      if (String(row.estate_id || "") !== estateId) return false;
      if (id && row.building_id && String(row.building_id) !== id) return false;
      return isOpenEscalation(row);
    }).length;
  }

  function lastActivityFor(estateId: string, buildingId: string | null) {
    const scoped = [
      ...homes.filter((h) => String(h.estate_id) === estateId),
      ...devices.filter((d) => String(d.estate_id) === estateId && (!buildingId || true)),
      ...escalationRows.filter((r) => String(r.estate_id) === estateId),
    ];
    let latest: string | null = null;
    let label = "No recent activity recorded";
    for (const row of scoped) {
      const ts = String(row.updated_at || row.created_at || "");
      if (ts && (!latest || ts > latest)) {
        latest = ts;
        label = row.residents_count !== undefined || row.users_count !== undefined
          ? "Home activity recorded"
          : row.priority !== undefined || row.severity !== undefined
          ? "Support/maintenance activity recorded"
          : "Device activity recorded";
      }
    }
    return { last_activity_at: latest, last_activity_label: latest ? label : "No recent activity recorded" };
  }

  const officeEstates = estates
    .filter((estate) => !estateIdFilter || String(estate.id) === estateIdFilter)
    .map((estate) => {
      const estateId = String(estate.id);
      const estateHomes = homes.filter((h) => String(h.estate_id) === estateId);
      const estateDevices = devices.filter((d) => String(d.estate_id) === estateId);
      const activity = lastActivityFor(estateId, null);
      return {
        id: estateId,
        name: estate.name || "Unnamed Estate",
        location: estate.address || estate.location || "",
        status: estate.status || estate.membership_status || "active",
        subscription_status: estate.subscription_status || "unknown",
        owner_activated: activeOwnerEstateIds.has(estateId),
        homes_total: estateHomes.length,
        homes_active: estateHomes.filter((h) => toNumber(h.residents_count || h.users_count) > 0).length,
        devices_total: estateDevices.length,
        devices_online: estateDevices.filter((d) => d.current_state?.availability === "online").length,
        major_open_escalations: escalationsFor(estateId, null),
        last_activity_at: activity.last_activity_at,
        last_activity_label: activity.last_activity_label,
        updated_at: estate.updated_at || nowIso,
      };
    });

  const officeBuildings = Array.from(buildingMap.values())
    .filter((b) => !estateIdFilter || b.estate_id === estateIdFilter)
    .filter((b) => !buildingIdFilter || b.id === buildingIdFilter)
    .map((b) => {
      const activity = lastActivityFor(b.estate_id, b.id);
      return {
        id: b.id,
        estate_id: b.estate_id,
        name: b.name,
        homes_total: b.homes_total,
        homes_active: b.homes_active,
        devices_total: b.devices_total,
        devices_online: b.devices_reporting ? b.devices_online : null,
        major_open_escalations: escalationsFor(b.estate_id, b.id),
        last_activity_at: activity.last_activity_at,
        last_activity_label: activity.last_activity_label,
        updated_at: nowIso,
      };
    });

  void emitAuditEvent({
    actorId: "office_portfolio_projection",
    actorEmail: "office-sync@ochiga.local",
    actorRole: "system",
    action: "office.portfolio_projection.accessed",
    resourceType: "office_portfolio_projection",
    resourceId: estateIdFilter || buildingIdFilter || "all",
    status: "success",
    metadata: { estate_count: officeEstates.length, building_count: officeBuildings.length },
    req,
  } as any);

  return res.json({
    source: "oyi-os",
    contract_version: CONTRACT_VERSION,
    generated_at: nowIso,
    estates: officeEstates,
    buildings: officeBuildings,
  });
});

// ---------------------------------------------------------------
// Canonical Office financial aggregation contract — the ONE aggregate-only
// financial view Office (and, later, Oyi Core) should read for corporate
// financial reasoning. It never returns a resident/home-keyed row and never
// touches consumer wallets/wallet_transactions — only genuinely estate-scoped
// financial records: estate_wallets (a balance snapshot) and
// service_transactions (utility purchases and facility service-charge
// collections, both estate_id-scoped at the row level, filtered to
// status="completed" so only settled money counts). Every figure here is
// either a raw snapshot column or a SUM/COUNT over real rows for the
// requested period — fields that have no real backing data (recurring
// revenue, receivables, payables, operating expenses) are simply omitted
// rather than shipped as fabricated zeros.
// ---------------------------------------------------------------
const UTILITY_SERVICE_TYPES = new Set(["power", "water", "gas", "internet"]);
const FACILITY_SERVICE_TYPES = new Set(["service_charge"]);

router.get("/financial-summary", requireOfficeExportKey, async (req: Request, res: Response) => {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const estateIdFilter = safeText(req.query.estate_id as string) || null;
  const periodDays = Math.min(Math.max(toNumber(req.query.period_days, 30) || 30, 1), 365);
  const periodStartMs = nowMs - periodDays * 24 * 60 * 60 * 1000;
  const periodStart = new Date(periodStartMs).toISOString();
  const periodEnd = nowIso;

  const [estatesResult, estateWalletsResult, serviceTxResult] = await Promise.all([
    safeSelectWithStatus("estates", "id,name,status"),
    safeSelectWithStatus("estate_wallets", "estate_id,balance,currency,updated_at"),
    safeSelectWithStatus(
      "service_transactions",
      "estate_id,service_type,service_key,amount,net_service_amount,status,currency,created_at"
    ),
  ]);

  const estates = estatesResult.rows.filter((estate) => !estateIdFilter || String(estate.id) === estateIdFilter);
  const estateWallets = estateWalletsResult.rows;
  const completedTx = serviceTxResult.rows.filter((row) => {
    if (String(row.status || "") !== "completed") return false;
    const createdMs = Date.parse(String(row.created_at || ""));
    return Number.isFinite(createdMs) && createdMs >= periodStartMs && createdMs <= nowMs;
  });

  function round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  function estateFigures(estateId: string) {
    const estateTx = completedTx.filter((row) => String(row.estate_id) === estateId);
    const amountOf = (row: Row) => toNumber(row.net_service_amount ?? row.amount);
    const revenuePeriod = estateTx.reduce((sum, row) => sum + amountOf(row), 0);
    const utilitySalesPeriod = estateTx
      .filter((row) => UTILITY_SERVICE_TYPES.has(String(row.service_type)))
      .reduce((sum, row) => sum + amountOf(row), 0);
    const serviceChargePeriod = estateTx
      .filter((row) => FACILITY_SERVICE_TYPES.has(String(row.service_type)))
      .reduce((sum, row) => sum + amountOf(row), 0);
    return {
      revenue_period: round2(revenuePeriod),
      utility_sales_period: round2(utilitySalesPeriod),
      service_charge_period: round2(serviceChargePeriod),
      transaction_count: estateTx.length,
    };
  }

  const officeFinancialEstates = estates.map((estate) => {
    const estateId = String(estate.id);
    const wallet = estateWallets.find((row) => String(row.estate_id) === estateId);
    const figures = estateFigures(estateId);
    return {
      estate_id: estateId,
      name: estate.name || "Unnamed Estate",
      current_balance: wallet ? toNumber(wallet.balance) : null,
      currency: wallet?.currency || "NGN",
      ...figures,
      period_start: periodStart,
      period_end: periodEnd,
      freshness: nowIso,
      evidence_refs: wallet ? ["estate_wallets", "service_transactions"] : ["service_transactions"],
    };
  });

  const portfolioTotals = officeFinancialEstates.reduce(
    (totals, estate) => {
      totals.current_balance_total += estate.current_balance || 0;
      totals.revenue_period_total += estate.revenue_period;
      totals.utility_sales_period_total += estate.utility_sales_period;
      totals.service_charge_period_total += estate.service_charge_period;
      totals.transaction_count_total += estate.transaction_count;
      return totals;
    },
    {
      current_balance_total: 0,
      revenue_period_total: 0,
      utility_sales_period_total: 0,
      service_charge_period_total: 0,
      transaction_count_total: 0,
    }
  );

  void emitAuditEvent({
    actorId: "office_financial_summary",
    actorEmail: "office-sync@ochiga.local",
    actorRole: "system",
    action: "office.financial_summary.accessed",
    resourceType: "office_financial_summary",
    resourceId: estateIdFilter || "all",
    status: "success",
    metadata: { estate_count: officeFinancialEstates.length, period_days: periodDays },
    req,
  } as any);

  return res.json({
    source: "oyi-os",
    contract_version: CONTRACT_VERSION,
    generated_at: nowIso,
    period_start: periodStart,
    period_end: periodEnd,
    estates: officeFinancialEstates,
    portfolio: {
      estate_count: officeFinancialEstates.length,
      currency: "NGN",
      current_balance_total: round2(portfolioTotals.current_balance_total),
      revenue_period_total: round2(portfolioTotals.revenue_period_total),
      utility_sales_period_total: round2(portfolioTotals.utility_sales_period_total),
      service_charge_period_total: round2(portfolioTotals.service_charge_period_total),
      transaction_count_total: portfolioTotals.transaction_count_total,
    },
    meta: {
      sources: {
        estates: estatesResult.source,
        estate_wallets: estateWalletsResult.source,
        service_transactions: serviceTxResult.source,
      },
    },
  });
});

// Oyi Cross-Surface Observability Closure — the one read endpoint
// Office's AI Agents page uses to see Consumer/Facility/Website
// conversation, voice, vision and device-execution activity that its
// own local traces table has no visibility into. Reads only rows this
// closure's bridge wrote (source = "oyi_observability_bridge") —
// ochiga_intelligence_events also carries unrelated workflow/camera-
// intel/edge-discovery rows, deliberately excluded here. Returns a
// safe projection only: no actor_id (matches the existing safeEvent()
// convention in security/securityObservability.ts — internal
// references are stored, never handed to a lower-trust reader), no
// raw metadata, no message/transcript/image content (none was ever
// stored in the first place).
router.get("/observability/events", requireOfficeExportKey, async (req: Request, res: Response) => {
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 1000) : 200;
  try {
    const { data, error } = await supabaseAdmin
      .from("ochiga_intelligence_events")
      .select("id, occurred_at, surface, mode, category, event_type, status, capability, tool, conversation_id, request_id, latency_ms, estate_id, home_id, summary")
      .eq("source", "oyi_observability_bridge")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return res.json({ ok: true, events: data || [] });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load observability events" });
  }
});

// Oyi Runtime Contract, Domain 3 (Task) — fulfills the already-declared
// "office-backend-intelligence-events" platform boundary contract
// (src/contracts/platformBoundaries.ts): Office stays the source of
// truth for crm_tasks/leads/proposals/deployments; these routes let it
// additively project a subset of that state into ochiga_workflows for
// cross-agent operational visibility (Facility's operator queue,
// Consumer's dashboard counts already read this table). Thin wrappers
// only — createWorkflow/transitionWorkflow/listWorkflows/getWorkflow
// (src/intelligence-core/workflows.ts) do all the real work,
// unmodified. See docs/architecture/OYI_RUNTIME_DOMAIN_MODEL.md.
const OFFICE_ALLOWED_WORKFLOW_TYPES = new Set([
  "customer_converted",
  "proposal_accepted",
  "meeting_requested",
  "deployment_required",
]);
const OFFICE_ALLOWED_AGENTS = new Set(["oma", "osa"]);

router.get("/workflows", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const result = await listWorkflows(officeWorkflowActor, {
      status: typeof req.query.status === "string" ? req.query.status : null,
      escalated: req.query.escalated === "true",
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load workflows", workflows: [] });
  }
});

router.post("/workflows", requireOfficeExportKey, async (req: Request, res: Response) => {
  const body = req.body || {};
  const workflowType = safeText(body.workflow_type);
  if (!OFFICE_ALLOWED_WORKFLOW_TYPES.has(workflowType)) {
    return res.status(400).json({ ok: false, error: `workflow_type must be one of: ${Array.from(OFFICE_ALLOWED_WORKFLOW_TYPES).join(", ")}` });
  }
  const originAgent = OFFICE_ALLOWED_AGENTS.has(body.origin_agent) ? (body.origin_agent as IntelligenceAgentId) : "oma";
  const responsibleAgent = OFFICE_ALLOWED_AGENTS.has(body.responsible_agent) || body.responsible_agent === "facility"
    ? (body.responsible_agent as IntelligenceAgentId)
    : "osa";
  if (!body.title || !body.summary) {
    return res.status(400).json({ ok: false, error: "title and summary are required" });
  }
  try {
    const result = await createWorkflow({
      workflow_type: workflowType,
      title: safeText(body.title).slice(0, 180),
      summary: safeText(body.summary).slice(0, 500),
      priority: ["low", "medium", "high", "critical"].includes(body.priority) ? body.priority : undefined,
      origin_agent: originAgent,
      responsible_agent: responsibleAgent,
      actor: officeWorkflowActor,
      estate_id: body.estate_id || null,
      home_id: body.home_id || null,
      source_event_id: safeText(body.source_event_id) || null,
      recommended_action: safeText(body.recommended_action) || null,
      metadata: { ...recordOf(body.metadata), office_source_ref: safeText(body.source_ref) || null },
    });
    return res.status(result.ok ? 201 : 500).json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to create workflow" });
  }
});

const WORKFLOW_STATUS_VALUES = new Set(["created", "reviewed", "assigned", "accepted", "in_progress", "completed", "verified", "cancelled", "failed", "blocked", "escalated"]);

router.patch("/workflows/:id", requireOfficeExportKey, async (req: Request, res: Response) => {
  const body = req.body || {};
  if (!WORKFLOW_STATUS_VALUES.has(body.status)) {
    return res.status(400).json({ ok: false, error: `status must be one of: ${Array.from(WORKFLOW_STATUS_VALUES).join(", ")}` });
  }
  try {
    const existing = await getWorkflow(String(req.params.id), officeWorkflowActor);
    if (!existing.ok || !existing.workflow) {
      return res.status(404).json({ ok: false, error: existing.error || "Workflow not found" });
    }
    const result = await transitionWorkflow({
      workflow: existing.workflow,
      status: body.status as WorkflowStatus,
      actor: officeWorkflowActor,
      summary: safeText(body.summary) || undefined,
      metadata: recordOf(body.metadata),
    });
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to update workflow" });
  }
});

router.get("/workflows/:id", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const result = await getWorkflow(String(req.params.id), officeWorkflowActor);
    return res.status(result.ok ? 200 : result.error === "Workflow not found" ? 404 : 500).json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load workflow" });
  }
});

// Tasks Domain UI (Office) — additive bridge to the Shared Automation
// Runtime (src/routes/scenes.ts). Office never gets its own scheduler,
// executor, or table: every route below reads/writes the exact same
// consumer_automations / consumer_automation_runs rows the live 30s
// scheduler already claims, with surface hardcoded to "office" so
// Office can never see or create a consumer/facility row through this
// door. AUTOMATION_SURFACE_OFFICE_ENABLED still gates whether a
// created row will ever actually run — creating one while the flag is
// off is allowed (so the UI isn't blocked on ops turning the flag on),
// but it will simply sit unclaimed, exactly like today.
const OFFICE_AUTOMATION_SURFACE: AutomationSurface = "office";

router.get("/automations", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    let query = supabaseAdmin.from("consumer_automations").select("*").eq("surface", OFFICE_AUTOMATION_SURFACE).order("created_at", { ascending: false });
    if (typeof req.query.status === "string" && req.query.status === "enabled") query = query.eq("enabled", true);
    if (typeof req.query.status === "string" && req.query.status === "disabled") query = query.eq("enabled", false);
    const limit = req.query.limit ? Math.max(1, Math.min(200, Number(req.query.limit))) : 100;
    const { data, error } = await query.limit(limit);
    if (error) return res.status(500).json({ ok: false, error: error.message, automations: [] });
    return res.status(200).json({ ok: true, automations: data || [] });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load automations", automations: [] });
  }
});

router.get("/automations/:id", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin.from("consumer_automations").select("*").eq("id", req.params.id).eq("surface", OFFICE_AUTOMATION_SURFACE).maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(404).json({ ok: false, error: "Automation not found" });
    return res.status(200).json({ ok: true, automation: data });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load automation" });
  }
});

router.post("/automations", requireOfficeExportKey, async (req: Request, res: Response) => {
  const body = req.body || {};
  const name = safeText(body.name).slice(0, 80);
  const triggerResult = validateAutomationTrigger(body.trigger);
  if (!triggerResult.ok) return res.status(422).json({ ok: false, error: triggerResult.error, code: triggerResult.code });
  const rawActions = Array.isArray(body.actions) ? body.actions : [];
  const requestedCommunicationActions = rawActions.length > 0 && rawActions.every(isCommunicationActionItem);
  let finalActions: any[];
  if (requestedCommunicationActions) {
    const communicationActions = cleanCommunicationActions(rawActions);
    const validation = validateCommunicationActions(communicationActions);
    if (!validation.ok) return res.status(422).json({ ok: false, error: validation.error, code: validation.code });
    finalActions = communicationActions.map((action) => ({ action_type: "communication_action", ...action }));
  } else {
    const workflowActions = cleanWorkflowActions(rawActions);
    const validation = validateWorkflowActions(workflowActions);
    if (!validation.ok) return res.status(422).json({ ok: false, error: validation.error, code: validation.code });
    finalActions = workflowActions.map((action) => ({ action_type: "workflow_action", ...action }));
  }
  if (!name) return res.status(400).json({ ok: false, error: "A name is required" });
  const trigger = triggerResult.trigger;
  const nextRun = body.enabled === false ? null : nextAutomationRunAt(trigger);
  const row = {
    estate_id: null,
    home_id: null,
    created_by: null,
    owner: safeText(body.owner) || null,
    name,
    surface: OFFICE_AUTOMATION_SURFACE,
    trigger,
    condition: body.condition && typeof body.condition === "object" ? body.condition : {},
    actions: finalActions,
    enabled: body.enabled !== false,
    timezone: trigger.timezone,
    schedule_version: 1,
    next_run_at: nextRun ? nextRun.toISOString() : null,
  };
  try {
    const { data, error } = await supabaseAdmin.from("consumer_automations").insert(row as any).select("*").single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(201).json({ ok: true, automation: data });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to create automation" });
  }
});

router.patch("/automations/:id", requireOfficeExportKey, async (req: Request, res: Response) => {
  const body = req.body || {};
  const current = await supabaseAdmin.from("consumer_automations").select("*").eq("id", req.params.id).eq("surface", OFFICE_AUTOMATION_SURFACE).maybeSingle();
  if (!current.data) return res.status(404).json({ ok: false, error: "Automation not found" });
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (body.name != null) {
    const name = safeText(body.name).slice(0, 80);
    if (!name) return res.status(400).json({ ok: false, error: "Automation name is required" });
    updates.name = name;
  }
  if (body.owner != null) updates.owner = safeText(body.owner) || null;
  if (body.enabled != null) updates.enabled = body.enabled === true;
  if (body.condition != null) updates.condition = body.condition && typeof body.condition === "object" ? body.condition : {};
  let validatedTrigger: ReturnType<typeof validateAutomationTrigger> | null = null;
  if (body.trigger != null) {
    validatedTrigger = validateAutomationTrigger(body.trigger);
    if (!validatedTrigger.ok) return res.status(422).json({ ok: false, error: validatedTrigger.error, code: validatedTrigger.code });
    updates.trigger = validatedTrigger.trigger;
    updates.timezone = validatedTrigger.trigger.timezone;
    updates.schedule_version = 1;
  }
  if (body.actions != null) {
    const rawActions = Array.isArray(body.actions) ? body.actions : [];
    const requestedCommunicationActions = rawActions.length > 0 && rawActions.every(isCommunicationActionItem);
    if (requestedCommunicationActions) {
      const communicationActions = cleanCommunicationActions(rawActions);
      const validation = validateCommunicationActions(communicationActions);
      if (!validation.ok) return res.status(422).json({ ok: false, error: validation.error, code: validation.code });
      updates.actions = communicationActions.map((action) => ({ action_type: "communication_action", ...action }));
    } else {
      const workflowActions = cleanWorkflowActions(rawActions);
      const validation = validateWorkflowActions(workflowActions);
      if (!validation.ok) return res.status(422).json({ ok: false, error: validation.error, code: validation.code });
      updates.actions = workflowActions.map((action) => ({ action_type: "workflow_action", ...action }));
    }
  }
  const triggerForNext = validatedTrigger || validateAutomationTrigger(current.data.trigger);
  const enabledForNext = updates.enabled == null ? current.data.enabled !== false : updates.enabled === true;
  updates.next_run_at = enabledForNext && triggerForNext.ok ? nextAutomationRunAt(triggerForNext.trigger)?.toISOString() || null : null;
  try {
    const { data, error } = await supabaseAdmin.from("consumer_automations").update(updates).eq("id", req.params.id).eq("surface", OFFICE_AUTOMATION_SURFACE).select("*").single();
    if (error) return res.status(404).json({ ok: false, error: error.message || "Automation not found" });
    return res.status(200).json({ ok: true, automation: data });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to update automation" });
  }
});

router.delete("/automations/:id", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin.from("consumer_automations").delete().eq("id", req.params.id).eq("surface", OFFICE_AUTOMATION_SURFACE).select("id").maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(404).json({ ok: false, error: "Automation not found" });
    return res.status(200).json({ ok: true, id: req.params.id });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to delete automation" });
  }
});

router.get("/automations/:id/runs", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const automation = await supabaseAdmin.from("consumer_automations").select("id").eq("id", req.params.id).eq("surface", OFFICE_AUTOMATION_SURFACE).maybeSingle();
    if (!automation.data) return res.status(404).json({ ok: false, error: "Automation not found" });
    const limit = req.query.limit ? Math.max(1, Math.min(200, Number(req.query.limit))) : 20;
    const { data, error } = await supabaseAdmin.from("consumer_automation_runs").select("*").eq("automation_id", req.params.id).order("created_at", { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ ok: false, error: error.message, runs: [] });
    return res.status(200).json({ ok: true, runs: data || [] });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load automation runs", runs: [] });
  }
});

router.post("/automations/:id/test", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const automation = await supabaseAdmin.from("consumer_automations").select("*").eq("id", req.params.id).eq("surface", OFFICE_AUTOMATION_SURFACE).maybeSingle();
    if (!automation.data) return res.status(404).json({ ok: false, error: "Automation not found" });
    if (!isAutomationSurfaceEnabled(OFFICE_AUTOMATION_SURFACE)) {
      return res.status(403).json({ ok: false, error: "The office automation surface is not yet enabled.", code: "automation_surface_disabled" });
    }
    const actor = officeAutomationActor(automation.data);
    const result = await executeConsumerAutomation({
      automation: automation.data,
      actor,
      req: { user: actor, headers: {}, body: { source: "automation" }, oisContext: { estate_id: automation.data.estate_id, home_id: automation.data.home_id } },
      source: "manual_test",
      // Wave 4B Slice 1 -- the requireOfficeExportKey shared secret above
      // proves which trusted SYSTEM called this route; it does not by
      // itself prove authority over a physical device. This is the only
      // call site in the codebase that sets this flag -- see the gate's
      // full rationale in executeConsumerAutomation (scenes.ts).
      officeDeviceCommandAuthority: true,
    });
    return res.status(200).json({ ok: true, run: result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Automation test could not run.", code: "automation_test_failed" });
  }
});

// Communication delivery/outcome normalization (Phase 7/9 of the
// Communication Runtime programme). Office's EXISTING WhatsApp webhook
// (/webhooks/whatsapp, already live and receiving real Meta callbacks)
// forwards status events here, in the NORMAL Office->Backend direction
// (requireOfficeExportKey, same as every other officeExport.ts route) --
// this is not a new inbound webhook surface, just the missing link that
// turns an already-arriving provider event into a canonical
// oyi_communication_events row and an oyi_communications status update.
// Idempotent by construction: the (provider, provider_event_id) unique
// index on oyi_communication_events means a duplicate delivery is a
// no-op insert, not a double-processed event. Never touches CRM lead/
// contact/opportunity state -- delivery is not evidence of engagement.
// Meta's real WhatsApp Cloud API error codes for a failed send -- mapped
// to the canonical failure-reason vocabulary so "template required" is
// a real, provider-confirmed limitation, not a guess (Phase 2). Source:
// Meta's documented WhatsApp Business Platform error codes.
function mapWhatsAppErrorCode(code: unknown): string {
  const numeric = Number(code);
  if (numeric === 131047 || numeric === 470) return "template_required"; // outside the 24h customer-service window
  if (numeric === 131026 || numeric === 131053) return "delivery_failed"; // undeliverable / media error
  if (numeric === 131021) return "invalid_recipient"; // recipient cannot receive messages
  if (numeric === 131031 || numeric === 190) return "authentication_failed";
  if (numeric === 131048 || numeric === 131056) return "rate_limited";
  return "unknown";
}

const WHATSAPP_STATUS_TO_CANONICAL: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

router.post("/communications/webhook-event", requireOfficeExportKey, async (req: Request, res: Response) => {
  const body = req.body || {};
  const channel = String(body.channel || "");
  const providerMessageId = String(body.provider_message_id || "").trim();
  const providerEventType = String(body.provider_event_type || "");
  logger.info("communication_webhook_event_received", {
    channel,
    provider_event_type: providerEventType,
    has_provider_message_id: Boolean(providerMessageId),
    status: body.status || null,
    error_code: body.error_code ?? null,
  });
  if (channel !== "whatsapp" || !providerMessageId) {
    return res.status(200).json({ ok: false, reason: "unsupported_or_missing_fields" });
  }

  if (providerEventType === "message") {
    const from = String(body.from || "").trim();
    if (!from) {
      logger.warn("communication_webhook_event_missing_sender", { provider_message_id: providerMessageId });
      return res.status(200).json({ ok: false, reason: "missing_sender" });
    }
    try {
      // Thin normalization into the ONE canonical inbound event contract
      // -- everything else (atomic persist, classification, opt-out
      // governance, decision-trail logging, goal wake) lives in
      // inboundEventPipeline.ts, shared by every provider, not
      // WhatsApp-specific business logic bolted onto this route.
      const leadId = body.lead_id ? String(body.lead_id) : null;
      const canonicalEvent: CanonicalInboundCommunicationEvent = {
        provider: "whatsapp_cloud_api",
        provider_event_id: providerMessageId,
        channel: "whatsapp",
        sender_identifier: from,
        recipient_business_identifier: body.phone_number_id ? String(body.phone_number_id) : null,
        resolved_contact_id: null,
        resolved_lead_id: leadId,
        resolved_customer_id: null,
        organization_id: null,
        thread_reference: null,
        related_opportunity_id: null,
        related_task_id: null,
        related_goal_id: null,
        previous_communication_id: null,
        body: String(body.text || ""),
        message_type: "text",
        attachments: null,
        occurred_at: body.occurred_at || new Date().toISOString(),
        provider_delivery_state: null,
        source_surface: "whatsapp_inbound",
        resolution_confidence: leadId ? "high" : "unresolved",
        resolution_evidence: leadId ? `Matched an existing CRM lead by whatsapp_phone (${from}).` : `No CRM lead found for whatsapp_phone ${from}.`,
      };
      const result = await processInboundEvent(canonicalEvent);
      logger.info("communication_webhook_inbound_persisted", {
        provider_message_id: providerMessageId,
        thread_reference: result.thread_reference,
        duplicate: result.duplicate,
        outcome_classification: result.outcome_classification,
        woke_goal_count: result.woke_goal_ids.length,
      });
      // Oyi Communications Convergence, Slice 1 -- goal_active tells
      // Office whether an autonomous follow-up Goal is already watching
      // this thread (findGoalsWatchingThread ran synchronously inside
      // processInboundEvent above; only the goal's own evaluation/
      // dispatch is fire-and-forget). Office's direct AI-reply path
      // (processWhatsAppEvent) must defer to the Goal rather than also
      // replying -- this is the single field that makes "at most one
      // Oyi outbound reply per inbound message" enforceable without a
      // second round trip.
      return res.status(200).json({ ok: result.ok, thread_reference: result.thread_reference, duplicate: result.duplicate, matched_outbound: Boolean(result.communication_id), goal_active: result.woke_goal_ids.length > 0 });
    } catch (err: any) {
      logger.error("communication_webhook_inbound_failed", { provider_message_id: providerMessageId, error: err?.message || String(err) });
      return res.status(200).json({ ok: false, error: err?.message || "inbound_processing_failed" });
    }
  }

  const canonicalStatus = WHATSAPP_STATUS_TO_CANONICAL[String(body.status || "").toLowerCase()];
  if (!canonicalStatus) {
    return res.status(200).json({ ok: false, reason: "unrecognized_status" });
  }
  try {
    const eventId = `whatsapp:${providerMessageId}:${canonicalStatus}`;
    const { error: eventError } = await supabaseAdmin.from("oyi_communication_events").insert({
      communication_id: null,
      event_type: `communication.${canonicalStatus}`,
      channel: "whatsapp",
      provider: "whatsapp_cloud_api",
      provider_event_id: eventId,
      occurred_at: body.occurred_at || new Date().toISOString(),
      metadata: { provider_event_type: providerEventType, provider_message_id: providerMessageId },
    } as any);
    // A unique-constraint violation here means this exact status event
    // was already recorded -- idempotent no-op, not an error.
    if (eventError && !String(eventError.message || "").toLowerCase().includes("duplicate")) {
      throw eventError;
    }
    const { data: existing } = await supabaseAdmin
      .from("oyi_communications")
      .select("id,status")
      .eq("provider_message_id", providerMessageId)
      .eq("channel", "whatsapp")
      .maybeSingle();
    if (existing && !["failed", "cancelled"].includes(existing.status)) {
      const patch: Record<string, unknown> = { status: canonicalStatus, outcome: canonicalStatus };
      if (canonicalStatus === "delivered") patch.delivered_at = body.occurred_at || new Date().toISOString();
      if (canonicalStatus === "failed") {
        patch.failure_reason = mapWhatsAppErrorCode(body.error_code);
        patch.failure_detail = body.error_title ? String(body.error_title).slice(0, 500) : "WhatsApp delivery failed.";
      }
      await supabaseAdmin.from("oyi_communications").update(patch).eq("id", existing.id);
    }
    logger.info("communication_webhook_status_processed", { provider_message_id: providerMessageId, canonical_status: canonicalStatus, matched: Boolean(existing) });
    return res.status(200).json({ ok: true, matched: Boolean(existing) });
  } catch (err: any) {
    logger.error("communication_webhook_status_failed", { provider_message_id: providerMessageId, error: err?.message || String(err) });
    return res.status(200).json({ ok: false, error: err?.message || "webhook_event_processing_failed" });
  }
});

// ---------------------------------------------------------------------
// Intelligence System Visibility, Slice 1 -- capability introspection +
// system summary. Office-safe projection of the LIVE capability
// registry (capabilityRegistry.all()) -- every count and per-item field
// below is computed fresh from the running registry on each request,
// never hardcoded, so this contract can never silently drift from the
// real system the way a doc or comment could.
//
// Two governed-action systems exist that are NOT registered capabilities
// at all -- Communications (draft/propose/confirm/dispatch via
// CommunicationRuntime) and Goal plan-step dispatch (GoalRuntime) -- both
// reached directly inside ConversationOrchestrator.ts
// (handleCommunicationTurn / handleGoalConversationTurn), both confirmed
// office_internal-only by direct read of their own surface guard. They
// are listed separately below and never folded into the capability
// count, so this contract can truthfully describe the complete governed-
// action surface without fabricating a registry entry for either.
//
// Exposes only structural/governance metadata: key, domain, rollout
// status, supported surfaces, required permission/scope, risk class,
// confirmation policy, operations, and a safe evidence-requirement
// summary (domain + type + required/optional -- never the internal
// evidence-loader implementation itself). No implementation file paths,
// no provider secrets, no prompts, no private evidence content.
// ---------------------------------------------------------------------
const INTELLIGENCE_WORKER_BY_SURFACE: Record<string, { key: string; label: string }> = {
  office_internal: { key: "oma", label: "Oma" },
  public_corporate: { key: "osa", label: "Osa" },
  facility: { key: "facility", label: "Facility" },
  consumer: { key: "consumer", label: "Consumer" },
};

// Presentation-only, deliberately separate from ConversationOrchestrator.
// ts's own BUSINESS_CAPABILITY_LABELS (a per-CAPABILITY conversational
// label, not exported and not what this needs) -- this is a generic
// per-DOMAIN humanizer for a structural inventory page.
function humanizeIntelligenceDomain(domain: string): string {
  return domain
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function classifyIntelligenceCapability(capability: CapabilityModule): "read" | "action" {
  if (capability.risk_class && capability.risk_class !== "read") return "action";
  if (capability.confirmation_policy && capability.confirmation_policy !== "none") return "action";
  return "read";
}

function safeIntelligenceCapabilityProjection(capability: CapabilityModule) {
  const surfaces = capability.supported_surfaces || [];
  return {
    key: capability.key,
    domain: capability.domain,
    domain_label: humanizeIntelligenceDomain(capability.domain),
    rollout_status: capability.rolloutStatus,
    supported_surfaces: surfaces,
    supported_workers: surfaces.map((surface) => INTELLIGENCE_WORKER_BY_SURFACE[surface]?.label || surface),
    required_permissions: capability.permission_requirements || [],
    required_scope: capability.scope_requirements || [],
    risk_class: capability.risk_class || "read",
    confirmation_policy: capability.confirmation_policy || "none",
    classification: classifyIntelligenceCapability(capability),
    operations: capability.operations || [],
    evidence_requirement_summary: (capability.evidence_requirements || []).map(
      (req) => `${req.domain}:${req.evidence_type}${req.required ? " (required)" : " (optional)"}`
    ),
  };
}

function countIntelligenceCapabilitiesBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] || 0) + 1;
  return out;
}

// Not registered capabilities (see header note above) -- surfaces
// confirmed by direct read of handleCommunicationTurn/
// handleGoalConversationTurn's own guard clause, not assumed.
const INTELLIGENCE_GOVERNED_ACTION_SYSTEMS = [
  {
    key: "communications",
    label: "Communications",
    description:
      "Email / WhatsApp / SMS / voice / internal-message sends. Governed by a draft -> propose -> confirm -> dispatch cycle (CommunicationRuntime), reached directly inside the conversation orchestrator rather than through the capability registry.",
    worker: "oma",
    supported_surfaces: ["office_internal"],
  },
  {
    key: "goal_plan_dispatch",
    label: "Goal Plan-Step Dispatch",
    description:
      "Staged, multi-step goal plans (GoalRuntime) whose individual steps dispatch through the same governed systems each step's own action already owns (e.g. a communication step through Communications above). Goal creation itself is confirmation-gated.",
    worker: "oma",
    supported_surfaces: ["office_internal"],
  },
];

function buildIntelligenceCapabilityInventory() {
  ensureRegistered();
  const all = capabilityRegistry.all();
  const projected = all.map(safeIntelligenceCapabilityProjection);
  const bySurface: Record<string, number> = {};
  for (const capability of all) {
    for (const surface of capability.supported_surfaces || []) {
      bySurface[surface] = (bySurface[surface] || 0) + 1;
    }
  }
  const byWorker: Record<string, number> = {};
  for (const [surface, count] of Object.entries(bySurface)) {
    const workerKey = INTELLIGENCE_WORKER_BY_SURFACE[surface]?.key || surface;
    byWorker[workerKey] = (byWorker[workerKey] || 0) + count;
  }
  return {
    projected,
    totalRegistered: all.length,
    byRolloutStatus: countIntelligenceCapabilitiesBy(all.map((c) => c.rolloutStatus)),
    readShaped: projected.filter((c) => c.classification === "read").length,
    actionShaped: projected.filter((c) => c.classification === "action").length,
    bySurface,
    byWorker,
    byRiskClass: countIntelligenceCapabilitiesBy(all.map((c) => c.risk_class || "read")),
    byConfirmationPolicy: countIntelligenceCapabilitiesBy(all.map((c) => c.confirmation_policy || "none")),
  };
}

router.get("/intelligence/capabilities", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const inv = buildIntelligenceCapabilityInventory();
    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      architecture: "one_core",
      summary: {
        total_registered: inv.totalRegistered,
        by_rollout_status: inv.byRolloutStatus,
        read_shaped: inv.readShaped,
        action_shaped: inv.actionShaped,
      },
      by_surface: inv.bySurface,
      by_worker: inv.byWorker,
      by_risk_class: inv.byRiskClass,
      by_confirmation_policy: inv.byConfirmationPolicy,
      capabilities: inv.projected,
      governed_action_systems: INTELLIGENCE_GOVERNED_ACTION_SYSTEMS,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load capability inventory" });
  }
});

router.get("/intelligence/summary", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const inv = buildIntelligenceCapabilityInventory();
    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      architecture: "one_core",
      workers: [
        { key: "oma", label: "Oma", surface: "office_internal", capability_count: inv.bySurface.office_internal || 0 },
        { key: "osa", label: "Osa", surface: "public_corporate", capability_count: inv.bySurface.public_corporate || 0 },
        { key: "facility", label: "Facility", surface: "facility", capability_count: inv.bySurface.facility || 0 },
        { key: "consumer", label: "Consumer", surface: "consumer", capability_count: inv.bySurface.consumer || 0 },
      ],
      capability_counts: {
        total_registered: inv.totalRegistered,
        by_rollout_status: inv.byRolloutStatus,
        read_shaped: inv.readShaped,
        action_shaped: inv.actionShaped,
      },
      governed_action_system_count: INTELLIGENCE_GOVERNED_ACTION_SYSTEMS.length,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load intelligence summary" });
  }
});

// ---------------------------------------------------------------------
// Intelligence System Visibility, Slice 2 -- Overview + Attention/Human
// Intervention. A READ MODEL over existing intelligence authority: every
// number below is computed from a canonical store this codebase already
// treats as authoritative (GoalRuntime/DecisionStore/WorkflowRepository/
// CommunicationRuntime/facilityAutomationService, plus the same
// capability registry and cross-surface observability table Slice 1
// already exposes) -- nothing here is a new attention engine, a new
// table, or a new intervention state.
// ---------------------------------------------------------------------
const overviewWorkflowRepository = new SupabaseWorkflowRepository();

function requiredHumanStep(interventionType: HumanInterventionType): string {
  switch (interventionType) {
    case "AUTHORIZATION":
      return "Approve or reject";
    case "CONFIRMATION":
      return "Confirm or cancel";
    case "INPUT_REQUIRED":
      return "Provide the missing information";
    case "ESCALATION":
      return "Review and decide the next step";
    default:
      return "Review";
  }
}

// Safe projection of a HumanInterventionObligation for Office. Exposes
// exactly what Section 2 of this slice's own brief lists (type, status,
// priority/severity if real, created/updated time, worker/surface if
// known, safe title/summary, why human intervention is needed, source
// type, safe source identifier, next required human step) and nothing
// the underlying source object itself didn't already mark safe for this
// obligation's own title/reason fields (see humanInterventionView.ts's
// per-source title/reason construction -- communication in particular
// never carries subject/body/recipient here). No priority/severity field
// exists on any of the five sources today, so none is fabricated.
function safeInterventionProjection(obligation: HumanInterventionObligation) {
  return {
    id: obligation.id,
    source_type: obligation.source_type,
    intervention_type: obligation.intervention_type,
    status: obligation.native_status,
    stage: obligation.normalized_stage.stage,
    title: obligation.title,
    reason: obligation.reason,
    created_at: obligation.created_at,
    due_at: obligation.due_at,
    worker: obligation.surface ? (INTELLIGENCE_WORKER_BY_SURFACE[obligation.surface]?.label || obligation.surface) : null,
    source_id: obligation.source_id,
    required_human_step: requiredHumanStep(obligation.intervention_type),
  };
}

// GET /office/intelligence/interventions -- the canonical "what needs a
// human right now" list, platform-wide. Reuses loadPlatformHumanInterventionObligations
// (itself reusing the same per-source query shapes/types as the existing,
// per-conversation humanInterventionView.ts) -- this route adds no new
// aggregation logic of its own beyond the safe projection above.
router.get("/intelligence/interventions", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 200) : 50;
    const result = await loadPlatformHumanInterventionObligations(limit);
    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      complete: result.complete,
      sources: result.sources,
      interventions: result.obligations.map(safeInterventionProjection),
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load human intervention obligations" });
  }
});

function sourceCount(sources: { source_type: string; ok: boolean; count: number }[], sourceType: string): { available: boolean; count: number } {
  const source = sources.find((s) => s.source_type === sourceType);
  if (!source) return { available: false, count: 0 };
  return { available: source.ok, count: source.ok ? source.count : 0 };
}

// GET /office/intelligence/overview -- the safe summary read model
// composing existing truth across capabilities, workers, attention
// (human intervention), goals, decisions, workflows/actions, activity,
// and failures. Every constituent read runs in parallel (Section 12);
// a metric whose source failed or has no safe unscoped query today is
// marked unavailable/omitted, never silently reported as 0 or folded
// into "everything is fine."
router.get("/intelligence/overview", requireOfficeExportKey, async (req: Request, res: Response) => {
  const overallStartedAt = Date.now();
  const timings: Record<string, number> = {};

  async function timed<T>(name: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    const startedAt = Date.now();
    try {
      const value = await fn();
      timings[name] = Date.now() - startedAt;
      return { ok: true, value };
    } catch (err: any) {
      timings[name] = Date.now() - startedAt;
      return { ok: false, error: err?.message || String(err) };
    }
  }

  const sinceIso24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    capabilitiesResult,
    interventionsResult,
    healthResult,
    goalsActiveResult,
    goalsBlockedResult,
    decisionsActiveResult,
    decisionsResolvedResult,
    workflowsActiveResult,
    workflowsFailedResult,
    activityResult,
    activityFailedResult,
    canonicalTracesResult,
  ] = await Promise.all([
    timed("capabilities", async () => buildIntelligenceCapabilityInventory()),
    timed("interventions", async () => loadPlatformHumanInterventionObligations(50)),
    timed("health", async () => healthSummary()),
    timed("goals_active", async () => goalRuntime.countByStatuses(["active", "observing", "action_due", "executing", "verifying", "reevaluating"])),
    timed("goals_blocked", async () => goalRuntime.countByStatuses(["blocked", "waiting"])),
    timed("decisions_active", async () => countDecisionsByStatuses(["selected", "awaiting_human", "approved"])),
    timed("decisions_resolved", async () => countDecisionsResolvedSince(sinceIso24h)),
    timed("workflows_active", async () => overviewWorkflowRepository.countByStatuses(activeWorkflowStatuses)),
    timed("workflows_failed", async () => overviewWorkflowRepository.countByStatuses(["failed"], sinceIso24h)),
    timed("activity", async () => {
      const { count, error } = await supabaseAdmin
        .from("ochiga_intelligence_events")
        .select("id", { count: "exact", head: true })
        .eq("source", "oyi_observability_bridge")
        .gte("occurred_at", sinceIso24h);
      if (error) throw error;
      return count || 0;
    }),
    timed("activity_failed", async () => {
      const { count, error } = await supabaseAdmin
        .from("ochiga_intelligence_events")
        .select("id", { count: "exact", head: true })
        .eq("source", "oyi_observability_bridge")
        .neq("status", "success")
        .gte("occurred_at", sinceIso24h);
      if (error) throw error;
      return count || 0;
    }),
    // Slice 7 -- compact durable-trace summary (same aggregate as Activity & Trace).
    timed("canonical_traces", async () => summarizeConversationTraces(24)),
  ]);

  const slowestSource = Object.entries(timings).sort((a, b) => b[1] - a[1])[0];
  const totalMs = Date.now() - overallStartedAt;

  const capabilities = capabilitiesResult.ok ? capabilitiesResult.value : null;
  const interventions = interventionsResult.ok ? interventionsResult.value : null;
  const interventionSources = interventions?.sources || [];

  const automationApprovals = sourceCount(interventionSources, "automation_approval");
  const goalEscalations = sourceCount(interventionSources, "goal_escalation");
  const decisionAuthorizations = sourceCount(interventionSources, "decision");
  const workflowGates = sourceCount(interventionSources, "workflow");
  const communicationConfirmations = sourceCount(interventionSources, "communication_confirmation");

  return res.json({
    ok: true,
    generated_at: new Date().toISOString(),
    architecture: "one_core",

    system: {
      health: healthResult.ok
        ? { available: true, status: healthResult.value.status, database: healthResult.value.database.status, queue: healthResult.value.queue.status }
        : { available: false, reason: healthResult.ok === false ? healthResult.error : "unavailable" },
    },

    capabilities: capabilities
      ? {
          available: true,
          total_registered: capabilities.totalRegistered,
          by_rollout_status: capabilities.byRolloutStatus,
          read_shaped: capabilities.readShaped,
          action_shaped: capabilities.actionShaped,
        }
      : { available: false },

    workers: capabilities
      ? [
          { key: "oma", label: "Oma", capability_count: capabilities.bySurface.office_internal || 0, pending_intervention_count: interventions ? interventions.obligations.filter((o) => o.surface === "office_internal").length : null },
          { key: "osa", label: "Osa", capability_count: capabilities.bySurface.public_corporate || 0, pending_intervention_count: interventions ? interventions.obligations.filter((o) => o.surface === "public_corporate").length : null },
          { key: "facility", label: "Facility", capability_count: capabilities.bySurface.facility || 0, pending_intervention_count: interventions ? interventions.obligations.filter((o) => o.surface === "facility").length : null },
          { key: "consumer", label: "Consumer", capability_count: capabilities.bySurface.consumer || 0, pending_intervention_count: interventions ? interventions.obligations.filter((o) => o.surface === "consumer").length : null },
        ]
      : [],

    attention: {
      available: Boolean(interventions),
      complete: interventions ? interventions.complete : false,
      total: interventions ? interventions.obligations.length : 0,
      by_source: {
        automation_approval: automationApprovals,
        goal_escalation: goalEscalations,
        decision: decisionAuthorizations,
        workflow: workflowGates,
        communication_confirmation: communicationConfirmations,
      },
      oldest_outstanding: interventions && interventions.obligations.length
        ? interventions.obligations.reduce((oldest, o) => (String(o.created_at) < String(oldest.created_at) ? o : oldest)).created_at
        : null,
      // conversation_proposal is a real, documented fifth source
      // (humanInterventionView.ts) that structurally cannot be listed
      // platform-wide -- its only storage is a JSONB sibling key on
      // oyi_conversation_threads.metadata, with no index that would make
      // an unscoped scan safe or fast. Reported, not silently dropped.
      excluded_sources: [{ source_type: "conversation_proposal", reason: "no_platform_wide_listing_capability" }],
    },

    goals: {
      active: goalsActiveResult.ok ? { available: true, count: goalsActiveResult.value } : { available: false },
      needs_human: goalEscalations.available ? { available: true, count: goalEscalations.count } : { available: false },
      blocked_or_waiting: goalsBlockedResult.ok ? { available: true, count: goalsBlockedResult.value } : { available: false },
    },

    decisions: {
      active: decisionsActiveResult.ok ? { available: true, count: decisionsActiveResult.value } : { available: false },
      awaiting_human: decisionAuthorizations.available ? { available: true, count: decisionAuthorizations.count } : { available: false },
      recently_resolved: decisionsResolvedResult.ok ? { available: true, count: decisionsResolvedResult.value, window: "24h" } : { available: false },
    },

    workflows_actions: {
      active_workflow: workflowsActiveResult.ok ? { available: true, count: workflowsActiveResult.value } : { available: false },
      pending_confirmation: workflowGates.available ? { available: true, count: workflowGates.count } : { available: false },
      automation_approvals_pending: automationApprovals.available ? { available: true, count: automationApprovals.count } : { available: false },
      communication_awaiting_confirmation: communicationConfirmations.available ? { available: true, count: communicationConfirmations.count } : { available: false },
      recent_failures: workflowsFailedResult.ok ? { available: true, count: workflowsFailedResult.value, window: "24h" } : { available: false },
    },

    activity: activityResult.ok
      ? { available: true, recent_count: activityResult.value, window: "24h" }
      : { available: false },
    canonical_traces: canonicalTracesResult.ok
      ? {
          available: true,
          window: "24h",
          turns: canonicalTracesResult.value.turns,
          structural_failures: canonicalTracesResult.value.structural_failures,
          no_match: canonicalTracesResult.value.no_match,
          authority_denied: canonicalTracesResult.value.authority_denied,
          runtime_errors: canonicalTracesResult.value.runtime_errors,
          persistence_failures: canonicalTracesResult.value.persistence_failures,
          truncated: canonicalTracesResult.value.truncated,
        }
      : { available: false },

    failures: {
      workflow_failed: workflowsFailedResult.ok ? { available: true, count: workflowsFailedResult.value, window: "24h" } : { available: false },
      activity_failed: activityFailedResult.ok ? { available: true, count: activityFailedResult.value, window: "24h" } : { available: false },
      // operationalMetrics (src/observability/metrics.ts) is deliberately
      // NOT a source here -- it is an in-memory, per-process counter
      // registry with no persistence and no cross-instance aggregation,
      // so it cannot honestly answer a durable "what has recently failed"
      // question the way the two real, queryable tables above can.
      note: "operationalMetrics (in-process counters) intentionally excluded -- not a durable/cross-instance source.",
    },

    performance: {
      total_response_time_ms: totalMs,
      slowest_source: slowestSource ? { name: slowestSource[0], ms: slowestSource[1] } : null,
      source_timings_ms: timings,
    },
  });
});

// ---------------------------------------------------------------------
// Intelligence System Visibility, Slice 3 -- Worker Visibility.
//
// THEY ARE NOT FOUR BRAINS: every field below is either (a) a live
// filter of the SAME capability registry scan Slice 1's /intelligence/
// capabilities already performs, (b) a live filter of the SAME platform
// intervention aggregation Slice 2's /intelligence/interventions already
// performs, or (c) a small, explicitly-labeled presentation mapping for
// facts that have no live registry today (scope/permission model,
// negative restrictions) -- never a fabricated per-worker "process
// health". No new registry scan, no new intervention aggregation, no new
// table.
// ---------------------------------------------------------------------

// Section 10 -- locked presentation terminology. Machine identifiers
// (oma/osa/facility/consumer, and the OyiSurface values they map to)
// remain the only authority identifiers anywhere in this file; these
// labels are display-only.
const WORKER_DEFINITIONS: Array<{
  identity: string;
  display_name: string;
  surface: string;
  purpose: string;
  // "Can do" is always derived live from the capability registry (see
  // buildWorkerIntelligenceProfiles). scope_model/permission_model/
  // known_restrictions are real architectural facts this codebase's own
  // authority boundaries already enforce (estate_id/home_id scoping,
  // getIntelligencePermissionPolicy's policyScope, the public-corporate
  // policy's own denial list) but have no single live registry endpoint
  // to read from today -- presented here as an explicit, stable mapping
  // per this slice's own instruction, not inferred from absence.
  scope_model: string;
  permission_model: string;
  known_restrictions: string[];
}> = [
  {
    identity: "oma",
    display_name: "Office Intelligence",
    surface: "office_internal",
    purpose: "Staff-facing intelligence for Office CRM, tasks, meetings, development, partnerships, reports, and internal operations.",
    scope_model: "Office/staff-scoped -- no estate or home boundary; governed by the signed-in staff member's Office role.",
    permission_model: "Office permission scopes (e.g. crm.read, tasks.manage, planstudio.read).",
    known_restrictions: [
      "Cannot automatically access resident-private home or device truth.",
      "Cannot execute Consumer-only device/wallet authority.",
    ],
  },
  {
    identity: "osa",
    display_name: "Public / Ochiga Website",
    surface: "public_corporate",
    purpose: "Public-facing corporate intelligence for the Ochiga website -- anonymous visitors and JV/partnership inquiries.",
    scope_model: "Public/anonymous -- no authenticated actor, no estate or home binding.",
    permission_model: "Public corporate policy allow-list (no user permission scopes; see corporatePublicConversationPolicy).",
    known_restrictions: [
      "Cannot access private CRM records.",
      "Cannot access internal finance.",
      "Cannot access resident data.",
      "Cannot access Facility-sensitive operational truth.",
    ],
  },
  {
    identity: "facility",
    display_name: "Operational Intelligence",
    surface: "facility",
    purpose: "Estate operational intelligence -- maintenance, security, cameras, and facility-scoped devices.",
    scope_model: "Estate-scoped -- bound to a verified estate_id.",
    permission_model: "Facility/estate operator permission scopes.",
    known_restrictions: [
      "Cannot access resident wallet or private-home information without proper authority.",
    ],
  },
  {
    identity: "consumer",
    display_name: "Home Intelligence",
    surface: "consumer",
    purpose: "Resident home intelligence -- authorised home, device, wallet, visitor, and service context.",
    scope_model: "Home-scoped -- bound to a verified home_id within an estate.",
    permission_model: "Resident permission scopes, home-boundary enforced.",
    known_restrictions: [
      "Cannot access estate-wide private security information.",
      "Cannot access other residents' homes.",
      "Cannot access Office-private corporate data.",
    ],
  },
];

const INTERVENTION_TYPES_ALL = ["AUTHORIZATION", "CONFIRMATION", "INPUT_REQUIRED", "ESCALATION"];

// One combined computation for both /intelligence/workers and
// /intelligence/workers/:worker -- the registry scan, the intervention
// aggregation, and the observability-events aggregate each run exactly
// once regardless of which route (or how many workers) is being served,
// per this slice's own "avoid repeated registry scans" instruction.
async function buildWorkerIntelligenceProfiles() {
  const timings: Record<string, number> = {};
  async function timed<T>(name: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    const startedAt = Date.now();
    try {
      const value = await fn();
      timings[name] = Date.now() - startedAt;
      return { ok: true, value };
    } catch (err: any) {
      timings[name] = Date.now() - startedAt;
      return { ok: false, error: err?.message || String(err) };
    }
  }

  const sinceIso24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [capabilitiesResult, interventionsResult, eventsResult, tracesResult] = await Promise.all([
    timed("capabilities", async () => buildIntelligenceCapabilityInventory()),
    timed("interventions", async () => loadPlatformHumanInterventionObligations(200)),
    timed("observability_events", async () => {
      const { data, error } = await supabaseAdmin
        .from("ochiga_intelligence_events")
        .select("surface,status")
        .eq("source", "oyi_observability_bridge")
        .gte("occurred_at", sinceIso24h)
        .limit(2000);
      if (error) throw error;
      return (data || []) as Array<{ surface: string | null; status: string | null }>;
    }),
    // Slice 7 -- durable canonical traces (one bounded 24h aggregate).
    timed("canonical_traces", async () => summarizeConversationTraces(24)),
  ]);

  const inv = capabilitiesResult.ok ? capabilitiesResult.value : null;
  const interventions = interventionsResult.ok ? interventionsResult.value : null;
  const events = eventsResult.ok ? eventsResult.value : null;
  const traceSummary = tracesResult.ok ? tracesResult.value : null;

  const workers = WORKER_DEFINITIONS.map((def) => {
    const capsForWorker = inv ? inv.projected.filter((c) => c.supported_surfaces.includes(def.surface as any)) : [];
    const domainCounts = new Map<string, { domain: string; domain_label: string; count: number }>();
    for (const cap of capsForWorker) {
      const existing = domainCounts.get(cap.domain);
      if (existing) existing.count += 1;
      else domainCounts.set(cap.domain, { domain: cap.domain, domain_label: cap.domain_label, count: 1 });
    }
    const domains = Array.from(domainCounts.values()).sort((a, b) => b.count - a.count);
    const byRiskClass = countIntelligenceCapabilitiesBy(capsForWorker.map((c) => c.risk_class));
    const byConfirmationPolicy = countIntelligenceCapabilitiesBy(capsForWorker.map((c) => c.confirmation_policy));
    const byRolloutStatus = countIntelligenceCapabilitiesBy(capsForWorker.map((c) => c.rollout_status));
    const governedActionSystems = INTELLIGENCE_GOVERNED_ACTION_SYSTEMS.filter((s) => s.supported_surfaces.includes(def.surface)).map((s) => ({ key: s.key, label: s.label }));

    const workerObligations = interventions ? interventions.obligations.filter((o) => o.surface === def.surface) : [];
    const byInterventionType: Record<string, number> = {};
    for (const type of INTERVENTION_TYPES_ALL) byInterventionType[type] = 0;
    for (const o of workerObligations) byInterventionType[o.intervention_type] = (byInterventionType[o.intervention_type] || 0) + 1;

    const workerEvents = events ? events.filter((e) => e.surface === def.surface) : [];
    const workerFailedEvents = workerEvents.filter((e) => e.status && e.status !== "success");

    return {
      identity: def.identity,
      display_name: def.display_name,
      surface: def.surface,
      purpose: def.purpose,
      architecture: "one_core_worker",
      capabilities: inv
        ? {
            available: true,
            total: capsForWorker.length,
            enabled: byRolloutStatus.enabled || 0,
            read: capsForWorker.filter((c) => c.classification === "read").length,
            action: capsForWorker.filter((c) => c.classification === "action").length,
            domains,
            by_risk_class: byRiskClass,
            by_confirmation_policy: byConfirmationPolicy,
          }
        : { available: false },
      authority: {
        scope_model: def.scope_model,
        permission_model: def.permission_model,
        governed_action_systems: governedActionSystems,
        known_restrictions: def.known_restrictions,
      },
      attention: interventions
        ? { available: true, pending_intervention_count: workerObligations.length, by_intervention_type: byInterventionType }
        : { available: false, pending_intervention_count: null, by_intervention_type: null },
      activity: events
        ? { available: true, recent_count: workerEvents.length, window: "24h" }
        : { available: false, recent_count: null, note: "Detailed worker activity becomes available with durable Intelligence Trace." },
      failures: events
        ? { available: true, recent_count: workerFailedEvents.length, window: "24h" }
        : { available: false, recent_count: null },
      // Slice 7 -- canonical turns handled through this worker's surface,
      // from the durable trace store. Workers are not processes: there is
      // deliberately no uptime and no synthetic score here.
      canonical_turns: traceSummary && (traceSummary.by_worker as any)[def.identity]
        ? { available: true, window: "24h", ...(traceSummary.by_worker as any)[def.identity], sample_truncated: traceSummary.truncated }
        : { available: false },
    };
  });

  const slowestSource = Object.entries(timings).sort((a, b) => b[1] - a[1])[0];
  return {
    workers,
    capabilitiesAvailable: Boolean(inv),
    capabilitiesTotal: inv ? inv.totalRegistered : null,
    interventionsComplete: interventions ? interventions.complete : null,
    timings,
    slowestSource,
  };
}

router.get("/intelligence/workers", requireOfficeExportKey, async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const result = await buildWorkerIntelligenceProfiles();
    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      architecture: "one_core",
      workers: result.workers,
      capabilities_summary: { available: result.capabilitiesAvailable, total_registered: result.capabilitiesTotal },
      attention_complete: result.interventionsComplete,
      performance: {
        total_response_time_ms: Date.now() - startedAt,
        slowest_source: result.slowestSource ? { name: result.slowestSource[0], ms: result.slowestSource[1] } : null,
        source_timings_ms: result.timings,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load worker intelligence profiles" });
  }
});

router.get("/intelligence/workers/:worker", requireOfficeExportKey, async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const workerKey = String(req.params.worker || "").toLowerCase();
  if (!WORKER_DEFINITIONS.some((d) => d.identity === workerKey)) {
    return res.status(404).json({ ok: false, error: `Unknown worker "${workerKey}". Valid workers: oma, osa, facility, consumer.` });
  }
  try {
    const result = await buildWorkerIntelligenceProfiles();
    const worker = result.workers.find((w) => w.identity === workerKey);
    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      architecture: "one_core",
      worker,
      performance: {
        total_response_time_ms: Date.now() - startedAt,
        slowest_source: result.slowestSource ? { name: result.slowestSource[0], ms: result.slowestSource[1] } : null,
        source_timings_ms: result.timings,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load worker intelligence profile" });
  }
});

// ---------------------------------------------------------------------
// Intelligence System Visibility, Slice 4 -- Goals & Decisions and
// Actions & Workflows.
//
// GOAL != DECISION != RECOMMENDATION != PLAN != WORKFLOW != ACTION
// PROPOSAL != CONFIRMATION != EXECUTION != VERIFICATION -- every
// projection below reads its own canonical store's own real fields;
// nothing here re-derives one object's meaning from another's shape.
// ---------------------------------------------------------------------

const ALL_GOAL_STATUSES: GoalStatus[] = [
  "understood", "proposed", "confirmed", "active", "observing", "action_due", "executing", "verifying",
  "waiting", "reevaluating", "paused", "completed", "blocked", "failed", "cancelled", "expired", "needs_human",
];

// Safe step projection -- channel/action_type/status/wait_hours/skip_if/
// executed_at only. `body` (message content) and `device_command` (raw
// command payload) are deliberately omitted -- never safe to expose.
function safeGoalStepProjection(step: GoalRecord["plan"][number]) {
  return {
    step_index: step.step_index,
    channel: step.channel,
    action_type: step.action_type,
    status: step.status,
    wait_hours: step.wait_hours,
    skip_if: step.skip_if,
    executed_at: step.executed_at,
  };
}

// Safe execution-history projection -- `detail` is free text that may
// echo reply/message content (see GoalExecutionHistoryItem's own
// contract comment), deliberately omitted.
function safeGoalExecutionHistoryProjection(item: GoalRecord["execution_history"][number]) {
  return {
    occurred_at: item.occurred_at,
    step_index: item.step_index,
    action: item.action,
    outcome: item.outcome,
  };
}

// target_entities is deliberately narrowed to opaque COMMERCIAL lineage
// ids only (lead/contact/opportunity/organization) -- name/email/phone/
// whatsapp_phone (real PII fields on the same object) are never
// forwarded, and the OPERATIONAL fields (estate_id/home_id/device_id/
// camera_id/maintenance_request_id/visitor_access_id) are excluded
// entirely per Section 17's "home/unit identity unnecessarily" /
// "private device identity" restrictions -- goals are overwhelmingly
// commercial in practice (confirmed during this slice's own audit), so
// this loses little real value.
function safeGoalProjection(goal: GoalRecord, includeDetail: boolean) {
  const stepStatusCounts = countIntelligenceCapabilitiesBy((goal.plan || []).map((s) => s.status));
  const base = {
    id: goal.id,
    status: goal.status,
    stage: normalizeLifecycleStage({ objectType: "goal", status: goal.status }).stage,
    title: goal.objective,
    surface: goal.surface,
    created_at: goal.created_at,
    updated_at: goal.updated_at,
    due_at: goal.schedule?.deadline || null,
    last_evaluated_at: goal.last_evaluated_at,
    next_evaluation_at: goal.next_evaluation_at,
    current_step_index: goal.current_step_index,
    step_count: (goal.plan || []).length,
    step_status_counts: stepStatusCounts,
    max_attempts: goal.max_attempts,
    attempts_completed: goal.attempts_completed,
    needs_human: goal.status === "needs_human",
    blocked_or_waiting: goal.status === "blocked" || goal.status === "waiting",
    completion_reason: goal.completion_reason,
    lineage: { canonical_signal_key: goal.canonical_signal_key },
    reference_ids: {
      lead_id: goal.target_entities?.lead_id || null,
      contact_id: goal.target_entities?.contact_id || null,
      opportunity_id: goal.target_entities?.opportunity_id || null,
      organization_id: goal.target_entities?.organization_id || null,
    },
  };
  if (!includeDetail) return base;
  return {
    ...base,
    plan: (goal.plan || []).map(safeGoalStepProjection),
    execution_history: (goal.execution_history || []).slice(-20).map(safeGoalExecutionHistoryProjection),
    // Structural condition literals only (e.g. {type:"reply_received"},
    // {type:"max_attempts_reached"}) -- no message content, safe as-is.
    success_condition: goal.success_condition,
    stop_condition: goal.stop_condition,
    reply_branches: (goal.reply_branches || []).map((b) => ({ on_outcomes: b.on_outcomes, action: b.action, task_title: b.task_title })),
  };
}

router.get("/intelligence/goals", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 200) : 100;
    const goals = await goalRuntime.listByStatuses(ALL_GOAL_STATUSES, limit);
    return res.json({ ok: true, generated_at: new Date().toISOString(), goals: goals.map((g) => safeGoalProjection(g, false)) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load goals" });
  }
});

router.get("/intelligence/goals/:id", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const goal = await goalRuntime.get(String(req.params.id || ""));
    if (!goal) return res.status(404).json({ ok: false, error: "Goal not found" });
    return res.json({ ok: true, generated_at: new Date().toISOString(), goal: safeGoalProjection(goal, true) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load goal" });
  }
});

const ALL_DECISION_STATUSES: DecisionStatus[] = ["selected", "awaiting_human", "approved", "rejected", "superseded", "cancelled"];

// metadata (an arbitrary Record) is deliberately never forwarded -- see
// Section 17's "no raw evidence" instruction; every other field here is
// a real, typed, structural DecisionRecord column.
function safeDecisionProjection(decision: DecisionRecord) {
  return {
    id: decision.id,
    decision_key: decision.decision_key,
    entity_type: decision.entity_type,
    entity_id: decision.entity_id,
    action_type: decision.action_type,
    title: decision.title,
    reason: decision.reason,
    status: decision.status,
    stage: normalizeLifecycleStage({ objectType: "decision", status: decision.status }).stage,
    requires_human: decision.requires_human,
    selected_by: decision.selected_by,
    authority_mode: decision.authority_mode,
    policy_source: decision.policy_source,
    lineage: {
      canonical_signal_key: decision.canonical_signal_key,
      recommendation_key: decision.recommendation_key,
      goal_id: decision.goal_id,
      plan_id: decision.plan_id,
      incident_id: decision.incident_id,
      awareness_key: decision.awareness_key,
    },
    superseded_by: decision.superseded_by,
    created_at: decision.created_at,
    updated_at: decision.updated_at,
    decided_at: decision.decided_at,
    closed_at: decision.closed_at,
  };
}

router.get("/intelligence/decisions", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 200) : 100;
    const decisions = await listDecisionsByStatuses(ALL_DECISION_STATUSES, limit);
    return res.json({ ok: true, generated_at: new Date().toISOString(), decisions: decisions.map(safeDecisionProjection) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load decisions" });
  }
});

router.get("/intelligence/decisions/:id", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const decision = await getDecision(String(req.params.id || ""));
    if (!decision) return res.status(404).json({ ok: false, error: "Decision not found" });
    return res.json({ ok: true, generated_at: new Date().toISOString(), decision: safeDecisionProjection(decision) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load decision" });
  }
});

router.get("/intelligence/actions", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 200) : 50;
    const result = await loadPlatformActionAggregate(limit);
    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      complete: result.complete,
      sources: result.sources,
      actions: result.items,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load actions and workflows" });
  }
});

// Device command truth detail -- the full safe truth-model fields
// Section 10 asks for (request/dispatch/provider/confirmation/
// physical_effect/final status + truth_state), explicitly WITHOUT
// home_id/room_id/canonical_device_id/actor_id (private device/home/
// resident identity) or expected_state/observed_state/previous_state
// (raw device state blobs that could carry arbitrary sensor/settings
// data). estate_id is kept (estate-level, not home/device-level).
function safeDeviceCommandActionDetail(record: any) {
  const canonicalStatus = String(record.final_status || record.confirmation_status || record.provider_status || record.dispatch_status || record.request_status || "requested");
  return {
    source_type: "device_command" as const,
    source_id: record.command_execution_id,
    title: record.command_key ? `Device command: ${record.command_key}` : "A device command",
    canonical_status: canonicalStatus,
    presentation_stage: deviceCommandStage(canonicalStatus),
    requested_at: record.requested_at,
    completed_at: record.completed_at,
    estate_id: record.estate_id || null,
    channel_code: record.channel_code || null,
    command_key: record.command_key || null,
    truth: {
      request_status: record.request_status || null,
      dispatch_status: record.dispatch_status || null,
      provider_status: record.provider_status || null,
      confirmation_status: record.confirmation_status || null,
      physical_effect_status: record.physical_effect_status || null,
      final_status: record.final_status || null,
      truth_state: record.truth_state || null,
    },
    safe_error_message: record.safe_error_message || null,
    retryable: record.retryable ?? null,
    timeline: (Array.isArray(record.lifecycle) ? record.lifecycle : []).map((entry: any) => ({ status: entry?.status || null, occurred_at: entry?.occurred_at || null })),
  };
}

function safeCommunicationActionDetail(record: any) {
  const status = String(record.status);
  return {
    source_type: "communication" as const,
    source_id: record.communication_id,
    title: record.intent ? `${record.channel}: ${record.intent}` : `A ${record.channel} message`,
    canonical_status: status,
    presentation_stage: communicationStage(status),
    channel: record.channel,
    intent: record.intent || null,
    created_at: record.created_at,
    sent_at: record.sent_at,
    delivered_at: record.delivered_at,
    completed_at: record.completed_at,
    confirmation_required: Boolean(record.governance?.requires_confirmation),
    outcome: record.outcome || null,
    failure_reason: record.failure_reason || null,
    worker: SURFACE_LABEL_FOR_ACTIONS[record.surface] || null,
    // subject/body/plain_text/html/recipient deliberately never forwarded.
  };
}

function safeFacilityAutomationActionDetail(row: any) {
  const status = String(row.status);
  return {
    source_type: "facility_automation" as const,
    source_id: String(row.id),
    title: row.target_label || `${row.action_id || "automation"} on ${row.entity_type || "an entity"}`,
    canonical_status: status,
    presentation_stage: facilityAutomationStage(status),
    action_id: row.action_id || null,
    entity_type: row.entity_type || null,
    created_at: row.created_at,
    decided_at: row.decided_at || null,
    executed_at: row.executed_at || null,
    decision_note: row.decision_note || null,
    worker: "Facility",
    // entity_id / estate_id omitted -- facility-private operational identity.
  };
}

function safeConversationWorkflowActionDetail(workflow: import("../oyi-core/contracts/workflow").OyiWorkflow) {
  const status = String(workflow.status);
  return {
    source_type: "conversation_workflow" as const,
    source_id: workflow.workflow_id,
    title: workflow.operation || workflow.capability_key || "A conversation workflow",
    canonical_status: status,
    presentation_stage: conversationWorkflowStage(status),
    domain: workflow.domain,
    capability_key: workflow.capability_key,
    operation: workflow.operation,
    created_at: workflow.created_at,
    updated_at: workflow.updated_at,
    completed_at: workflow.completed_at,
    cancelled_at: workflow.cancelled_at,
    unresolved_inputs: workflow.unresolved_inputs || [],
    worker: SURFACE_LABEL_FOR_ACTIONS[workflow.surface] || null,
    target_label: workflow.target?.label || null,
    // inputs/proposed_action/execution_record/evidence/metadata/target
    // identity fields deliberately never forwarded -- raw workflow state.
  };
}

const SURFACE_LABEL_FOR_ACTIONS: Record<string, string> = { office_internal: "Oma", public_corporate: "Osa", facility: "Facility", consumer: "Consumer" };

router.get("/intelligence/actions/:id", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const compoundId = String(req.params.id || "");
    const separatorIndex = compoundId.indexOf(":");
    if (separatorIndex < 0) return res.status(400).json({ ok: false, error: "Invalid action id" });
    const sourceType = compoundId.slice(0, separatorIndex);
    const sourceId = compoundId.slice(separatorIndex + 1);
    if (!sourceId) return res.status(400).json({ ok: false, error: "Invalid action id" });

    if (sourceType === "device_command") {
      const record = await getDeviceCommandExecution(sourceId);
      if (!record) return res.status(404).json({ ok: false, error: "Device command not found" });
      return res.json({ ok: true, generated_at: new Date().toISOString(), action: safeDeviceCommandActionDetail(record) });
    }
    if (sourceType === "communication") {
      const record = await communicationRuntime.verify(sourceId);
      if (!record) return res.status(404).json({ ok: false, error: "Communication not found" });
      return res.json({ ok: true, generated_at: new Date().toISOString(), action: safeCommunicationActionDetail(record) });
    }
    if (sourceType === "facility_automation") {
      const { data, error } = await supabaseAdmin.from("automation_approvals").select("*").eq("id", sourceId).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ ok: false, error: "Automation approval not found" });
      return res.json({ ok: true, generated_at: new Date().toISOString(), action: safeFacilityAutomationActionDetail(data) });
    }
    if (sourceType === "conversation_workflow") {
      const workflow = await overviewWorkflowRepository.get(sourceId);
      if (!workflow) return res.status(404).json({ ok: false, error: "Workflow not found" });
      return res.json({ ok: true, generated_at: new Date().toISOString(), action: safeConversationWorkflowActionDetail(workflow) });
    }
    return res.status(404).json({ ok: false, error: `Unknown action source type "${sourceType}"` });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load this action" });
  }
});

// ---------------------------------------------------------------------
// Intelligence System Visibility, Slice 5 -- Governed Knowledge
// Visibility.
//
// Exposure model (governance correction):
//   A. Corpus-wide governance aggregates -- counts over classification
//      labels only (authority/audience/freshness/claim boundary/source
//      family/worker visibility), via summarizeKnowledgeCorpusGovernance.
//      No title, key, tag, statement or subject-matter domain.
//   B. Inspectable items -- enumeration and detail run under
//      OFFICE_INTERNAL_KNOWLEDGE_ACTOR, the same canonical Office staff
//      knowledge authority the Office-internal conversation route uses,
//      through the canonical audienceAllowed/agentAllowed gate.
//      requireOfficeExportKey authenticates the Office bridge; it grants
//      NO additional knowledge authority. There is no admin bypass.
//   Worker filters narrow the actor's own visible set by governed
//   agentVisibility; they never act as that worker.
//   Detail uses getKnowledgeItemByCanonicalKey() unchanged; a forbidden
//   key and a nonexistent key return the identical 404.
//   do_not_state_verbatim items expose their classification but never
//   their statement text (see KNOWLEDGE_WITHHELD_CLAIM_BOUNDARIES).
// ---------------------------------------------------------------------

const KNOWLEDGE_VIEWER_ACTOR = OFFICE_INTERNAL_KNOWLEDGE_ACTOR;
const KNOWLEDGE_WORKER_ROLES = ["oma", "osa", "facility", "consumer"] as const;
const KNOWLEDGE_WORKER_LABEL: Record<string, string> = { oma: "Oma", osa: "Osa", facility: "Facility", consumer: "Consumer" };
const KNOWLEDGE_OTHER_ROLE_LABEL: Record<string, string> = { office_internal: "Office Internal", executive: "Executive" };

// Section 6 -- claim-boundary presentation, transcribed directly from
// knowledgeContracts.ts's own inline comments (not a new policy).
const CLAIM_BOUNDARY_EXPLANATION: Record<string, string> = {
  safe_to_state: "May be stated directly, in the agent's own words.",
  requires_qualification: "May be stated but must be hedged/qualified (e.g. \"positioned as\", \"proposed\").",
  requires_human_confirmation: "May only be referenced as existing; exact figures/scope must route to a human.",
  do_not_state_verbatim: "Informs the agent's own reasoning only; must never be quoted or paraphrased to an external party.",
};

// Claim boundaries whose statement text Intelligence never renders.
// do_not_state_verbatim restricts quoting/paraphrasing the statement
// itself, so printing it on a visibility page -- even beside a warning
// -- would be the very act the classification forbids. The other three
// boundaries govern how an AGENT phrases the fact to a counterparty; the
// Office viewer inspecting them is the human those boundaries route to,
// so their text is shown.
const KNOWLEDGE_WITHHELD_CLAIM_BOUNDARIES = new Set(["do_not_state_verbatim"]);

// Section 7 -- authority-class presentation, in KNOWLEDGE_AUTHORITY_RANK's
// own real, existing order (never re-derived). PROJECT_SOURCE currently
// has zero real items -- kept in the vocabulary since it is a real,
// declared class, not removed to match today's live data.
const AUTHORITY_CLASS_EXPLANATION: Record<string, string> = {
  APPROVED_INSTITUTIONAL: "Approved institutional fact -- highest trust.",
  TECHNICAL_SOURCE: "Code-grounded technical description.",
  APPROVED_COMMERCIAL: "Approved commercial doctrine.",
  PRODUCT_SOURCE: "Product-team sourced description.",
  PROJECT_SOURCE: "Project-specific sourced description.",
  MARKETING_REFERENCE: "Marketing/positioning reference -- lower trust.",
  UNVERIFIED_REFERENCE: "Unverified reference -- lowest trust; requires confirmation before relying on it.",
};

function knowledgeSourceFamilyForRepo(sourceRepo: string): string {
  return sourceRepo === "ochiga-office" ? "Office Knowledge Pack" : "Backend Institutional Knowledge";
}

// Section 5/12 -- converts an internal repo/file path into a safe source
// label: the bare filename only, directories stripped, never the full
// path. Multi-path (semicolon-separated) items resolve to the source
// family name instead of a fabricated single file. A trailing prose
// annotation (e.g. "x.ts (content checked against ...page.tsx)") is
// dropped -- only the leading path is the real source file.
function safeKnowledgeSourceIdentifier(item: KnowledgeItem): string {
  if (item.sourceFile.includes(";")) return knowledgeSourceFamilyForRepo(item.sourceRepo);
  const primaryPath = item.sourceFile.split(/[\s(]/)[0] || "";
  return primaryPath.split("/").pop() || knowledgeSourceFamilyForRepo(item.sourceRepo);
}

function safeKnowledgeListProjection(item: KnowledgeItem) {
  const workerVisibility = item.agentVisibility.filter((r) => (KNOWLEDGE_WORKER_ROLES as readonly string[]).includes(r)).map((r) => KNOWLEDGE_WORKER_LABEL[r]);
  const otherRoleVisibility = item.agentVisibility.filter((r) => r in KNOWLEDGE_OTHER_ROLE_LABEL).map((r) => KNOWLEDGE_OTHER_ROLE_LABEL[r]);
  return {
    canonical_key: item.canonicalKey,
    title: item.title,
    domain: item.domain,
    domain_label: humanizeIntelligenceDomain(item.domain),
    authority_class: item.authorityClass,
    authority_rank: knowledgeAuthorityRank(item.authorityClass),
    authority_explanation: AUTHORITY_CLASS_EXPLANATION[item.authorityClass] || null,
    audience: item.audience,
    claim_boundary: item.claimBoundary,
    claim_boundary_explanation: CLAIM_BOUNDARY_EXPLANATION[item.claimBoundary] || null,
    freshness_class: item.freshnessClass,
    worker_visibility: workerVisibility,
    other_role_visibility: otherRoleVisibility,
    source_family: knowledgeSourceFamilyForRepo(item.sourceRepo),
    version_summary: item.version,
    updated_at: item.updatedAt,
  };
}

function safeKnowledgeDetailProjection(item: KnowledgeItem) {
  const withheld = KNOWLEDGE_WITHHELD_CLAIM_BOUNDARIES.has(item.claimBoundary);
  return {
    ...safeKnowledgeListProjection(item),
    content: withheld ? null : item.content,
    content_withheld: withheld,
    content_withheld_reason: withheld ? "This item's claim boundary forbids quoting or paraphrasing its statement, so Intelligence shows its governance classification only." : null,
    tags: item.tags,
    safe_source_identifier: safeKnowledgeSourceIdentifier(item),
  };
}

// Section 9 KPIs over the viewer's OWN inspectable items only (domain is
// subject matter, so it is never counted over hidden items).
function inspectableKnowledgeSummary(items: KnowledgeItem[]) {
  const byDomain: Record<string, number> = {};
  const byAuthority: Record<string, number> = {};
  const byAudience: Record<string, number> = {};
  const byFreshness: Record<string, number> = {};
  const workerCoverage = new Set<string>();
  let highAuthority = 0; // APPROVED_INSTITUTIONAL or TECHNICAL_SOURCE -- the two highest real ranks
  for (const item of items) {
    byDomain[item.domain] = (byDomain[item.domain] || 0) + 1;
    byAuthority[item.authorityClass] = (byAuthority[item.authorityClass] || 0) + 1;
    byAudience[item.audience] = (byAudience[item.audience] || 0) + 1;
    byFreshness[item.freshnessClass] = (byFreshness[item.freshnessClass] || 0) + 1;
    if (item.authorityClass === "APPROVED_INSTITUTIONAL" || item.authorityClass === "TECHNICAL_SOURCE") highAuthority += 1;
    for (const role of item.agentVisibility) {
      if ((KNOWLEDGE_WORKER_ROLES as readonly string[]).includes(role)) workerCoverage.add(role);
    }
  }
  return {
    total: items.length,
    by_domain: byDomain,
    by_authority_class: byAuthority,
    by_audience: byAudience,
    by_freshness_class: byFreshness,
    // "Volatile" is the real, disclosed freshness class for items that
    // "should be treated with more caution the older they get" -- there
    // is no separate canonical stale/expired signal to infer from dates.
    potentially_stale: byFreshness.volatile || 0,
    high_authority: highAuthority,
    workers_covered: workerCoverage.size,
    workers_covered_list: Array.from(workerCoverage).map((r) => KNOWLEDGE_WORKER_LABEL[r]),
  };
}

function corpusGovernanceAggregates(summary: Awaited<ReturnType<typeof summarizeKnowledgeCorpusGovernance>>) {
  const bySourceFamily: Record<string, number> = {};
  for (const [repo, count] of Object.entries(summary.bySourceRepo)) {
    const family = knowledgeSourceFamilyForRepo(repo);
    bySourceFamily[family] = (bySourceFamily[family] || 0) + count;
  }
  const byWorker: Record<string, number> = {};
  for (const role of KNOWLEDGE_WORKER_ROLES) byWorker[KNOWLEDGE_WORKER_LABEL[role]] = summary.byAgentVisibility[role] || 0;
  return {
    total: summary.total,
    inspectable: summary.visibleToActor,
    not_inspectable: summary.total - summary.visibleToActor,
    by_authority_class: summary.byAuthorityClass,
    by_audience: summary.byAudience,
    by_freshness_class: summary.byFreshnessClass,
    by_claim_boundary: summary.byClaimBoundary,
    by_source_family: bySourceFamily,
    by_worker_visibility: byWorker,
  };
}

router.get("/intelligence/knowledge", requireOfficeExportKey, async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const query = req.query;
    const toArray = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

    const t0 = Date.now();
    const [corpusSummary, inspectableResult] = await Promise.all([
      summarizeKnowledgeCorpusGovernance(KNOWLEDGE_VIEWER_ACTOR),
      listKnowledgeItemsForActor(KNOWLEDGE_VIEWER_ACTOR, {}),
    ]);
    const indexMs = Date.now() - t0;

    const filters = {
      domains: toArray(query.domain) as any,
      authorityClasses: toArray(query.authority_class) as any,
      audiences: toArray(query.audience) as any,
      freshnessClasses: toArray(query.freshness) as any,
      claimBoundaries: toArray(query.claim_boundary) as any,
      agentRoles: toArray(query.worker) as any,
    };
    const hasFilters = Object.values(filters).some((v) => Array.isArray(v) && v.length);
    const t1 = Date.now();
    const filteredResult = hasFilters ? await listKnowledgeItemsForActor(KNOWLEDGE_VIEWER_ACTOR, filters) : inspectableResult;
    const filterMs = Date.now() - t1;

    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.page_size) || 20));
    const totalFiltered = filteredResult.items.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
    const pageItems = filteredResult.items.slice((page - 1) * pageSize, page * pageSize);

    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      source: { available: corpusSummary.sourceOk, reason: corpusSummary.sourceOk ? null : corpusSummary.sourceReason },
      viewer_authority: { agent_role: KNOWLEDGE_VIEWER_ACTOR.agentRole, audience_ceiling: KNOWLEDGE_VIEWER_ACTOR.audienceScope },
      corpus: corpusGovernanceAggregates(corpusSummary),
      summary: inspectableKnowledgeSummary(inspectableResult.items),
      pagination: { page, page_size: pageSize, total: totalFiltered, total_pages: totalPages },
      items: pageItems.map(safeKnowledgeListProjection),
      authority_class_order: KNOWLEDGE_AUTHORITY_RANK,
      performance: {
        total_response_time_ms: Date.now() - startedAt,
        slowest_source: indexMs >= filterMs ? { name: "index_build_or_cache", ms: indexMs } : { name: "filter", ms: filterMs },
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load knowledge" });
  }
});

router.get("/intelligence/knowledge/:key", requireOfficeExportKey, async (req: Request, res: Response) => {
  try {
    const key = String(req.params.key || "");
    // Fails closed through the canonical exact-key lookup: a key outside
    // the viewer's authority and a key that does not exist are
    // indistinguishable (same status, same body).
    const item = await getKnowledgeItemByCanonicalKey(key, KNOWLEDGE_VIEWER_ACTOR);
    if (!item) return res.status(404).json({ ok: false, error: "Knowledge item not found" });
    return res.json({ ok: true, generated_at: new Date().toISOString(), item: safeKnowledgeDetailProjection(item) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load this knowledge item" });
  }
});

// ---------------------------------------------------------------------
// Intelligence System Visibility, Slice 6 -- Memory & Context, Learning.
//
// Both are aggregate/structural only (see memoryContextView.ts /
// learningView.ts for exactly what is and is never selected). Same
// requireOfficeExportKey boundary as Slices 1-5; read-only; no control
// endpoints (no promote/approve/reset/delete/clear/force-admission).
// ---------------------------------------------------------------------

router.get("/intelligence/memory-context", requireOfficeExportKey, async (_req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const view = await buildMemoryContextView();
    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      privacy: "aggregate_structural_deidentified",
      ...view,
      performance: { ...view.performance, total_response_time_ms: Date.now() - startedAt },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: "Unable to load memory and context visibility" });
  }
});

router.get("/intelligence/learning", requireOfficeExportKey, async (_req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const view = await buildLearningView();
    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      ...view,
      performance: { ...view.performance, total_response_time_ms: Date.now() - startedAt },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: "Unable to load learning visibility" });
  }
});

// ---------------------------------------------------------------------
// Intelligence System Visibility, Slice 7 -- durable canonical traces.
// Read-only projection of oyi_conversation_traces (sanitized structural
// telemetry only; see conversationTraceProjection.ts). Paginated, bounded
// (page_size <= 50), filters narrowed to closed vocabularies. No route
// here retrieves conversation messages: thread correlation is an opaque
// reference plus a count.
// ---------------------------------------------------------------------

router.get("/intelligence/traces", requireOfficeExportKey, async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const filters = normalizeTraceFilters(req.query as Record<string, unknown>);
  const timings: Record<string, number> = {};
  const time = async <T>(name: string, fn: () => Promise<T>) => {
    const t0 = Date.now();
    try { const value = await fn(); timings[name] = Date.now() - t0; return { ok: true as const, value }; }
    catch { timings[name] = Date.now() - t0; return { ok: false as const }; }
  };
  const [list, summary] = await Promise.all([
    time("trace_list", () => listConversationTraces(filters, Number(req.query.page) || 1, Number(req.query.page_size) || 20)),
    time("trace_summary", () => summarizeConversationTraces(24)),
  ]);
  return res.json({
    ok: true,
    generated_at: new Date().toISOString(),
    store: { available: list.ok || summary.ok, ...conversationTraceStoreConfig() },
    filters,
    summary: summary.ok ? { available: true, ...summary.value } : { available: false },
    items: list.ok ? list.value.items : [],
    pagination: list.ok ? list.value.pagination : null,
    list_available: list.ok,
    performance: { total_response_time_ms: Date.now() - startedAt, source_timings_ms: timings },
  });
});

router.get("/intelligence/traces/:id", requireOfficeExportKey, async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const trace = await getConversationTrace(String(req.params.id || ""));
    if (!trace) return res.status(404).json({ ok: false, error: "Trace not found" });
    return res.json({ ok: true, generated_at: new Date().toISOString(), trace, performance: { total_response_time_ms: Date.now() - startedAt } });
  } catch {
    return res.status(503).json({ ok: false, available: false, error: "Trace store unavailable" });
  }
});

export default router;
