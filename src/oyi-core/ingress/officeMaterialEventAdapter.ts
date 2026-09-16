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
import type { CorporateMaterialEvent } from "../../contracts/corporateIntelligence";
import { assessJvOpportunity, type JvEvidence, type JvStrategy } from "../domains/development/developmentJv";

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

export async function submitOfficeMaterialEventCanonicalSignal(event: CorporateMaterialEvent, options: { jvStrategy?: JvStrategy } = {}) {
  const isDevelopmentEnquiry = event.event_type === "development_enquiry_received";
  const jvAssessment = isDevelopmentEnquiry ? assessJvOpportunity(jvEvidenceFromMaterialEvent(event), options.jvStrategy) : null;

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
