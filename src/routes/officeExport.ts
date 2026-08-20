import { Router, Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { CONTRACT_VERSION, emitAuditEvent } from "../core/foundation";
import { conversationOrchestrator } from "../oyi-core/orchestration/ConversationOrchestrator";
import type { AuthUser } from "../middleware/auth";
import {
  officeCredentialTimingSafeEqual,
  resolveOfficeCredential,
  resolveOfficeSyncKey,
} from "../middleware/officeCredential";
import type { CorporateBusinessUnit, CorporateOyiCoreRequest, OfficeInternalOyiCoreRequest } from "../contracts/corporateIntelligence";
import { CORPORATE_INTELLIGENCE_CONTRACT_VERSION, PUBLIC_CORPORATE_SURFACE_POLICY } from "../contracts/corporateIntelligence";
import { buildCorporatePublicResponse, deniedPublicCorporateOperationalRequest } from "../oyi-core/policy/corporatePublicConversationPolicy";
import { buildOfficeInternalResponse, deniedOfficeInternalOperationalRequest } from "../oyi-core/policy/corporateOfficeInternalPolicy";
import { recordOyiObservabilityEvent, observabilityStatusFromTruthState } from "../intelligence-core/oyiObservabilityBridge";
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
  isAutomationSurfaceEnabled,
  officeAutomationActor,
  executeConsumerAutomation,
  type AutomationSurface,
} from "./scenes";
import { validateAutomationTrigger, nextAutomationRunAt } from "../services/automationScheduleService";

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

function safeNumber(value: any): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function recordOf(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

const publicCorporateActor: AuthUser = {
  id: "office-public-intelligence",
  email: "public-intelligence@ochiga.local",
  role: "guest",
  permissions: [],
  permission_scopes: [],
};

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

function normalizeOfficeInternalRequest(body: any, requestId: string): OfficeInternalOyiCoreRequest {
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
  return {
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
    } : null,
    content_context: Object.keys(content).length ? {
      content_ref: safeText(content.content_ref) || null,
      safe_summary: safeText(content.safe_summary).slice(0, 800) || null,
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

router.post("/conversation/corporate", requireOfficeExportKey, async (req: Request, res: Response) => {
  const requestId = safeText(req.headers["x-request-id"], crypto.randomUUID());
  const corporateRequest = normalizeCorporateConversationRequest(req.body || {}, requestId);
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
  const response = buildCorporatePublicResponse(corporateRequest, canonical);
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
    message: internalRequest.message,
    surface: "office_internal" as any,
    role: internalRequest.staff.role,
    module: "office_internal",
    thread_id: internalRequest.conversation_thread_id,
    context: {
      request_id: internalRequest.request_id,
      office_session_id: internalRequest.office_session_id,
      staff: internalRequest.staff,
      page_context: internalRequest.page_context,
      business_unit: internalRequest.business_unit,
      crm_context: internalRequest.crm_context,
      portfolio_context: internalRequest.portfolio_context,
      support_context: internalRequest.support_context,
      project_context: internalRequest.project_context,
      task_context: internalRequest.task_context,
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
  const response = buildOfficeInternalResponse(internalRequest, canonical);
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
        live_cameras: 0,
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
        live_cameras: 0,
        occupancy_pct: 0,
        created_at: device.created_at || nowIso,
        updated_at: nowIso,
      });
    }

    const group = groups.get(id)!;
    group.devices_count += 1;
    if (/camera|cctv|video/i.test(String(device.category || device.type || device.name || ""))) {
      group.live_cameras += 1;
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
  const devices = devicesResult.rows;
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
    status: device.status || (device.online ? "online" : "offline"),
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

  const [estatesResult, homesResult, devicesResult, maintenanceResult, incidentsResult] = await Promise.all([
    safeSelectWithStatus("estates"),
    safeSelectWithStatus("homes"),
    safeSelectWithStatus("devices"),
    safeSelectWithStatus("maintenance_requests"),
    safeSelectWithStatus("incidents"),
  ]);

  const estates = estatesResult.rows;
  const homes = homesResult.rows;
  const devices = devicesResult.rows;
  const escalationRows = [...maintenanceResult.rows, ...incidentsResult.rows];

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
    b.devices_reporting += 1;
    const status = String(device.status || (device.online ? "online" : "offline")).toLowerCase();
    if (status === "online") b.devices_online += 1;
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
        homes_total: estateHomes.length,
        homes_active: estateHomes.filter((h) => toNumber(h.residents_count || h.users_count) > 0).length,
        devices_total: estateDevices.length,
        devices_online: estateDevices.filter((d) => String(d.status || (d.online ? "online" : "offline")).toLowerCase() === "online").length,
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
  const workflowActions = cleanWorkflowActions(rawActions);
  const validation = validateWorkflowActions(workflowActions);
  if (!validation.ok) return res.status(422).json({ ok: false, error: validation.error, code: validation.code });
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
    actions: workflowActions.map((action) => ({ action_type: "workflow_action", ...action })),
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
    const workflowActions = cleanWorkflowActions(Array.isArray(body.actions) ? body.actions : []);
    const validation = validateWorkflowActions(workflowActions);
    if (!validation.ok) return res.status(422).json({ ok: false, error: validation.error, code: validation.code });
    updates.actions = workflowActions.map((action) => ({ action_type: "workflow_action", ...action }));
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
    });
    return res.status(200).json({ ok: true, run: result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Automation test could not run.", code: "automation_test_failed" });
  }
});

export default router;
