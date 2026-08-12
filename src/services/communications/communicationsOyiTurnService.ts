import crypto from "crypto";
import type { AuthUser } from "../../middleware/auth";
import { runCanonicalConversation } from "../../oyi-core/runtime/canonicalConversationRuntime";
import type { CanonicalConversationResponse } from "../../oyi-core/contracts/canonicalConversation";
import {
  CORPORATE_INTELLIGENCE_CONTRACT_VERSION,
  PUBLIC_CORPORATE_SURFACE_POLICY,
} from "../../contracts/corporateIntelligence";
import { deniedPublicCorporateOperationalRequest } from "../../oyi-core/policy/corporatePublicConversationPolicy";
import { deniedOfficeInternalOperationalRequest } from "../../oyi-core/policy/corporateOfficeInternalPolicy";
import type { CommunicationSurface } from "./communicationContracts";

export class CommunicationOyiTurnError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type OyiCommunicationTurnInput = {
  surface: CommunicationSurface;
  message: string;
  communications_session_id: string;
  public_session_id?: string | null;
  office_session_id?: string | null;
  oyi_thread_id?: string | null;
  business_unit?: string | null;
  inquiry_type?: string | null;
  agent_role?: "oma" | "osa" | string | null;
  engagement_mode?: string | null;
  source?: Record<string, unknown> | null;
  crm_context?: Record<string, unknown> | null;
  visual_observation?: Record<string, unknown> | null;
  actor?: AuthUser | null;
  staff?: Record<string, unknown> | null;
  request_id?: string | null;
};

function safeText(value: unknown, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assistantText(canonical: CanonicalConversationResponse) {
  return safeText(canonical.message || canonical.reply || canonical.answer || canonical.summary, "I’m here, but I could not shape a safe response for that turn.");
}

const publicCorporateActor: AuthUser = {
  id: "office-public-intelligence",
  email: "public-intelligence@ochiga.local",
  role: "guest",
  permissions: [],
  permission_scopes: [],
};

function officeActor(input: OyiCommunicationTurnInput): AuthUser {
  const staff = recordOf(input.staff);
  const actor = input.actor;
  const permissions = Array.isArray((staff as any).permissions)
    ? (staff as any).permissions.map((item: unknown) => safeText(item)).filter(Boolean)
    : actor?.permissions || [];
  return {
    id: actor?.id || safeText((staff as any).staff_id || (staff as any).id, `office-staff-${input.request_id || crypto.randomUUID()}`),
    email: actor?.email || safeText((staff as any).email, "office-internal@ochiga.local"),
    role: actor?.role || safeText((staff as any).role, input.surface === "support" ? "support_agent" : "ochiga_staff") as any,
    permissions,
    permission_scopes: actor?.permission_scopes || permissions,
  };
}

function safeCrmContext(value: unknown) {
  const crm = recordOf(value);
  return {
    contact_ref: safeText(crm.contact_ref) || null,
    organization_ref: safeText(crm.organization_ref) || null,
    lead_ref: safeText(crm.lead_ref) || null,
    opportunity_ref: safeText(crm.opportunity_ref) || null,
    safe_summary: safeText(crm.safe_summary).slice(0, 800) || null,
  };
}

export async function runOyiCommunicationTurn(input: OyiCommunicationTurnInput): Promise<{
  canonical: CanonicalConversationResponse;
  response_text: string;
  oyi_thread_id: string | null;
}> {
  const requestId = safeText(input.request_id, crypto.randomUUID());
  const message = safeText(input.message);
  if (!message) throw new CommunicationOyiTurnError(400, "message_required", "A transcript or visual prompt is required.");

  if (input.surface === "office_public") {
    if (deniedPublicCorporateOperationalRequest({ message })) {
      throw new CommunicationOyiTurnError(403, "public_capability_blocked", "Corporate/Public intelligence cannot access or control private operational systems.");
    }
    const publicSessionId = safeText(input.public_session_id, `public_session_${requestId}`);
    const canonical = await runCanonicalConversation(publicCorporateActor, {
      surface: "public_corporate" as any,
      estate_id: null,
      home_id: null,
      module: "corporate_public",
      role: safeText(input.agent_role, "oma"),
    } as any, {
      message,
      surface: "public_corporate",
      role: safeText(input.agent_role, "oma"),
      module: "corporate_public",
      thread_id: input.oyi_thread_id || null,
      context: {
        request_id: requestId,
        public_session_id: publicSessionId,
        communications_session_id: input.communications_session_id,
        public_identity: PUBLIC_CORPORATE_SURFACE_POLICY.public_identity,
        agent_role: safeText(input.agent_role, "oma"),
        business_unit: safeText(input.business_unit, "corporate"),
        inquiry_type: safeText(input.inquiry_type, "general_enquiry"),
        source: recordOf(input.source),
        crm_context: safeCrmContext(input.crm_context),
        engagement_mode: safeText(input.engagement_mode, "voice_conversation"),
        visual_observation: input.visual_observation || null,
        surface_policy: PUBLIC_CORPORATE_SURFACE_POLICY,
        contract_version: CORPORATE_INTELLIGENCE_CONTRACT_VERSION,
      },
      conversation_context: {
        public_session_id: publicSessionId,
        communications_session_id: input.communications_session_id,
        business_unit: safeText(input.business_unit, "corporate"),
        inquiry_type: safeText(input.inquiry_type, "general_enquiry"),
        agent_role: safeText(input.agent_role, "oma"),
        visual_observation_summary: safeText(input.visual_observation?.summary),
        crm_safe_summary: safeText(safeCrmContext(input.crm_context).safe_summary),
      },
      intent_hint: "corporate_public_conversation",
      operation_class_hint: "read",
      scope_mode_hint: "global",
    });
    return { canonical, response_text: assistantText(canonical), oyi_thread_id: canonical.thread_id || input.oyi_thread_id || null };
  }

  const actor = officeActor(input);
  if (deniedOfficeInternalOperationalRequest({ message, permissions: actor.permissions || [] })) {
    throw new CommunicationOyiTurnError(403, "office_operational_capability_blocked", "Office intelligence cannot bypass Facility or Consumer operational authorization.");
  }
  const canonical = await runCanonicalConversation(actor, {
    surface: "office_internal" as any,
    estate_id: null,
    home_id: null,
    module: input.surface === "support" ? "support_communications" : "office_internal",
    role: actor.role,
  } as any, {
    message,
    surface: "office_internal" as any,
    role: actor.role,
    module: input.surface === "support" ? "support_communications" : "office_internal",
    thread_id: input.oyi_thread_id || null,
    context: {
      request_id: requestId,
      office_session_id: input.office_session_id || input.communications_session_id,
      communications_session_id: input.communications_session_id,
      staff: { staff_id: actor.id, email: actor.email, role: actor.role, permissions: actor.permissions || [] },
      business_unit: safeText(input.business_unit, input.surface === "support" ? "support" : "corporate"),
      crm_context: safeCrmContext(input.crm_context),
      visual_observation: input.visual_observation || null,
      contract_version: CORPORATE_INTELLIGENCE_CONTRACT_VERSION,
    },
    conversation_context: {
      office_session_id: input.office_session_id || input.communications_session_id,
      communications_session_id: input.communications_session_id,
      business_unit: safeText(input.business_unit, input.surface === "support" ? "support" : "corporate"),
      visual_observation_summary: safeText(input.visual_observation?.summary),
      crm_safe_summary: safeText(safeCrmContext(input.crm_context).safe_summary),
    },
    intent_hint: input.surface === "support" ? "support_conversation" : "office_internal_conversation",
    operation_class_hint: "read",
    scope_mode_hint: "global",
  } as any);
  return { canonical, response_text: assistantText(canonical), oyi_thread_id: canonical.thread_id || input.oyi_thread_id || null };
}
