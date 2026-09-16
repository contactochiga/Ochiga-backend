// Office Intelligence Convergence, Wave 3 -- the Backend Office Signal
// Adapter. Office already builds a fully-typed CorporateMaterialEvent
// (see src/contracts/corporateIntelligence.ts) and POSTs it to
// POST /office/events/material (src/routes/officeExport.ts) -- this
// module owns turning that Office-domain event into ONE canonical
// signal via the existing submitCanonicalSignal() bridge, exactly like
// oyi-core/domains/camera/cameraCanonicalSignal.ts does for camera
// events. Office does not fabricate a Backend-internal signal shape;
// this adapter is the one place that normalization happens.
//
// EXACTLY-ONCE INGESTION ON RETRY: Office's publisher
// (backend-events.js's publishBackendMaterialEvent) retries the same
// event up to 5 times on 408/429/5xx/network failure. This adapter does
// not need its own idempotency table for that -- canonicalIntelligenceStore
// already deduplicates durably by a signalKey built from
// [provider||source, providerEventId||id, domain, entity.id, estateId,
// homeId] (see persistence/canonicalIntelligenceStore.ts). Setting
// metadata.provider_event_id to the event's own idempotency_key (stable
// across retries, unlike a regenerated timestamp) makes every retry of
// the same event resolve to the same signalKey, so a retry becomes a
// durable no-op (receiveSignal() returns accepted:false with a
// "duplicate signal ignored" awareness envelope, not an error) rather
// than a second observation.
import { submitCanonicalSignal } from "./canonicalSignalIngress";
import type { CorporateMaterialEvent, CorporateCommunicationContext } from "../../contracts/corporateIntelligence";
import { assessJvOpportunity, type JvAssessment, type JvEvidence, type JvStrategy } from "../domains/development/developmentJv";
import {
  relationshipCommunicationPolicyForJv,
  composeRelationshipAcknowledgement,
  preferredSupportedChannel,
} from "../domains/development/relationshipCommunicationPolicy";
import { goalRuntime } from "../../services/goalRuntime/GoalRuntime";
import { isOptedOut } from "../../services/communicationRuntime/optOutService";
import { requestOfficeHandoff } from "./officeHandoffBridge";
import { logger } from "../../observability/logger";
import type { GoalTargetEntities } from "../../contracts/goal";
import type { CommunicationRecipient } from "../../contracts/communication";

function text(value: unknown) {
  return String(value ?? "").trim() || null;
}

// Office does not yet have a dedicated JV schema (confirmed by this
// wave's audit) -- development_enquiry_received events may carry a
// best-effort `metadata.development` sub-object built from whatever real
// Lead fields Office actually has (location/city/country, property_size,
// project_type, budget_range, unit_count, timeline,
// decision_maker_status). Fields Office has no column for yet
// (jv_structure_offered, landowner_expectation, title_document_status)
// are honestly absent -- never guessed here.
function jvEvidenceFromMaterialEvent(event: CorporateMaterialEvent): JvEvidence {
  const development = (event.metadata?.development && typeof event.metadata.development === "object" ? event.metadata.development : {}) as Record<string, unknown>;
  return {
    opportunityType: text(development.opportunity_type),
    location: text(development.location),
    landSize: text(development.land_size),
    structureOffered: text(development.structure_offered),
    landownerExpectation: text(development.landowner_expectation),
    titleDocumentStatus: text(development.title_document_status),
    commercialTerms: text(development.commercial_terms),
    timeline: text(development.timeline),
    scaleUnits: typeof development.scale_units === "number" && Number.isFinite(development.scale_units) ? development.scale_units : null,
    sourceChannel: text(development.source_channel) || text(event.conversation?.public_session_id ? "widget" : null),
    decisionMakerStatus: text(development.decision_maker_status),
  };
}

// Oyi Communications Convergence, Slice 1 -- connects the EXISTING
// Development/JV assessment to the EXISTING GoalRuntime. No new
// scheduler, no new execution mechanism: this only decides WHETHER a
// bounded, single-step follow-up goal should exist, then hands it to
// goalRuntime.create() exactly as ConversationOrchestrator's own
// conversational goal creation does. Never throws -- a failure here
// must never corrupt or roll back the CRM material event this was
// triggered by (same contract as submitCanonicalSignal() itself).
async function activateDevelopmentRelationshipGoal(event: CorporateMaterialEvent, assessment: JvAssessment): Promise<void> {
  try {
    const leadId = event.crm?.lead_id || null;
    if (!leadId) return;

    const communicationContext: CorporateCommunicationContext | null = event.communication_context || null;
    const policy = relationshipCommunicationPolicyForJv(assessment, communicationContext);

    // Oyi Communications Convergence, Slice 2 -- HANDOFF becomes
    // executable: a real office_handoffs record, not just a logged
    // decision. requestOfficeHandoff() is idempotent on Office's side
    // (findActiveHandoffForLead), so a replayed material event or a
    // repeated HANDOFF decision for the same lead never creates a
    // duplicate. Never creates a Goal -- a human, not automation, owns
    // this conversation from here.
    if (policy === "HANDOFF") {
      const result = await requestOfficeHandoff({
        lead_id: leadId,
        business_unit: "development",
        requested_capability: "development.commercial_jv",
        reason: `Oyi Core recommends human review (${assessment.recommended_next_step}).`,
      });
      logger.info("development_relationship_handoff_requested", {
        lead_id: leadId,
        event_id: event.event_id,
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
      });
      return;
    }

    if (policy !== "ACKNOWLEDGE_ONLY" && policy !== "CONTINUE_RELATIONSHIP" && policy !== "REQUEST_MORE_INFORMATION") {
      logger.info("development_relationship_goal_skipped", { lead_id: leadId, policy, event_id: event.event_id });
      return;
    }

    const channel = preferredSupportedChannel(communicationContext);
    if (!channel) return; // relationshipCommunicationPolicyForJv already implies this, re-checked for type-narrowing safety.

    const whatsappPhone = communicationContext?.whatsapp_phone || communicationContext?.phone || null;
    if (!whatsappPhone) return;

    // Precondition: not opted out. This mirrors the SAME chokepoint
    // CommunicationRuntime.plan() checks before any send -- checked here
    // too so an opted-out contact never even gets a goal created for
    // them, not just blocked at send time.
    const recipient: CommunicationRecipient = {
      contact_id: null,
      lead_id: leadId,
      user_id: null,
      organization_id: null,
      name: null,
      email: communicationContext?.email || null,
      phone: communicationContext?.phone || null,
      whatsapp_phone: whatsappPhone,
    };
    if (await isOptedOut("whatsapp", recipient)) {
      logger.info("development_relationship_goal_skipped", { lead_id: leadId, policy, reason: "opted_out" });
      return;
    }

    // Idempotency: the same material event replayed (or a second
    // development_enquiry_received for a lead that already has one
    // in flight) must never create a second active goal.
    const existing = await goalRuntime.findActiveForLead(leadId);
    if (existing.length > 0) {
      logger.info("development_relationship_goal_skipped", { lead_id: leadId, policy, reason: "active_goal_exists", existing_goal_id: existing[0].id });
      return;
    }

    const body = composeRelationshipAcknowledgement(assessment, policy);
    if (!body) return;

    const targetEntities: GoalTargetEntities = {
      lead_id: leadId,
      contact_id: null,
      user_id: null,
      organization_id: null,
      name: event.subject?.label || null,
      email: communicationContext?.email || null,
      phone: communicationContext?.phone || null,
      whatsapp_phone: whatsappPhone,
    };
    const nowIso = new Date().toISOString();
    // A single bounded step -- send the acknowledgement once. Follow-up
    // beyond this first message (a real staged plan, reply_branches
    // tuned per policy) is explicitly Slice 2 scope; this proves the
    // activation path end to end without overreaching this slice.
    const threadReference = `whatsapp:${whatsappPhone}`;
    const goal = await goalRuntime.create({
      correlation_id: event.idempotency_key,
      requesting_actor_id: null,
      surface: "office_material_event",
      conversation_thread_id: null,
      organization_scope: null,
      objective: `Development/JV relationship communication for ${event.subject?.label || "lead"} (${policy}).`,
      target_entities: targetEntities,
      status: "active",
      success_condition: { type: "reply_received" },
      stop_condition: { type: "deadline_passed" },
      reply_branches: [],
      plan: [
        {
          step_index: 0,
          channel: "whatsapp",
          action_type: "send_communication",
          body,
          wait_hours: 0,
          skip_if: null,
          status: "pending",
          executed_at: null,
          result: null,
        },
      ],
      current_step_index: 0,
      // Bounded: a real deadline and a small max_attempts, per the
      // task's explicit "Goal has a bounded maximum attempt/deadline;
      // stop conditions exist" requirement.
      schedule: { deadline: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(), recurrence: null, timezone: null },
      event_conditions: [],
      communication_preferences: { allowed_channels: ["whatsapp"], escalation_policy: "notify_requester" },
      max_attempts: 3,
      attempts_completed: 0,
      observations: [],
      evidence: [],
      linked_crm_records: { lead_id: leadId },
      linked_tasks: [],
      linked_meetings: [],
      linked_automations: [],
      linked_communication_threads: [threadReference],
      execution_history: [],
      last_evaluated_at: null,
      // Due immediately -- the next scheduler tick (or an operator
      // triggering one) picks this up and dispatches step 0 through the
      // existing evaluateGoal() -> CommunicationRuntime path, no new
      // execution mechanism.
      next_evaluation_at: nowIso,
      completion_reason: null,
    });
    logger.info("development_relationship_goal_created", { lead_id: leadId, goal_id: goal.id, policy, channel });
  } catch (error) {
    logger.error("development_relationship_goal_activation_failed", { error, event_id: event.event_id });
  }
}

export async function submitOfficeMaterialEventCanonicalSignal(event: CorporateMaterialEvent, options: { jvStrategy?: JvStrategy } = {}) {
  const isDevelopmentEnquiry = event.event_type === "development_enquiry_received";
  const jvAssessment = isDevelopmentEnquiry ? assessJvOpportunity(jvEvidenceFromMaterialEvent(event), options.jvStrategy) : null;

  if (jvAssessment) void activateDevelopmentRelationshipGoal(event, jvAssessment);

  return submitCanonicalSignal({
    // Reuses the event's own type verbatim as the canonical type --
    // Office's material event types (lead_created,
    // development_enquiry_received, etc.) are already stable, namespaced
    // event names, same reuse pattern as camera's raw detection type.
    type: event.event_type,
    domain: "office",
    source: "office",
    origin: "office_app",
    // CRM/corporate events are not tied to any estate/building/home --
    // this is a genuinely new case (no physical scope), left honestly
    // null rather than fabricated. intelligencePolicyResolver.ts already
    // handles a null estate/home scope safely (falls through to
    // "organization_restricted" privacy class).
    estateId: null,
    entity: {
      id: event.subject?.id || null,
      type: event.subject?.type || "office_lead",
      name: event.subject?.label || null,
      status: event.crm?.status || null,
    },
    // Reuses the existing canonical severity classifier, fed the raw
    // event type -- not a new Office-specific severity engine.
    severity: event.event_type,
    triggerReason: event.inquiry_type ? `${event.event_type} (${event.inquiry_type})` : event.event_type,
    correlationId: `office_material_event:${event.idempotency_key}`,
    // Office is the authoritative source of truth for its own domain
    // facts (crm_source_of_truth: "ochiga-office") -- this is a verified
    // fact from Office, not an unverified inference.
    verified: true,
    evidence: [
      {
        id: event.event_id,
        type: "office_material_event",
        source: event.source_system,
        summary: `${event.event_type} for ${event.subject?.label || event.subject?.type || "office record"}`,
        timestamp: event.occurred_at,
        metadata: {
          request_id: event.request_id,
          business_unit: event.business_unit,
          inquiry_type: event.inquiry_type,
          agent_role: event.agent_role || null,
          source: event.source,
          crm: event.crm,
          conversation: event.conversation || null,
          ...event.metadata,
        },
      },
      ...(jvAssessment
        ? [
            {
              id: `${event.event_id}:jv_assessment`,
              type: "development_jv_assessment",
              source: "oyi_core_development_jv_capability",
              summary: `JV assessment: ${jvAssessment.recommended_next_step}`,
              timestamp: event.occurred_at,
              metadata: jvAssessment as unknown as Record<string, unknown>,
            },
          ]
        : []),
    ],
    metadata: {
      // The dedup key described above.
      provider_event_id: event.idempotency_key,
      event_id: event.event_id,
      request_id: event.request_id,
      business_unit: event.business_unit,
      inquiry_type: event.inquiry_type,
      source_system: event.source_system,
      crm: event.crm,
      conversation: event.conversation || null,
      ...(jvAssessment ? { jv_assessment: jvAssessment } : {}),
    },
  });
}
