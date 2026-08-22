// Oyi Communication Runtime -- Live Reply Loop programme. The ONE
// canonical inbound-communication-event contract every provider webhook
// normalizes into before anything downstream (persistence,
// classification, goal wake, Office presentation) touches it. Audit
// finding: the production WhatsApp webhook path built an ad hoc insert
// object inline in officeExport.ts with no shared shape at all --
// WhatsApp-specific fields threaded directly into what was effectively
// automation-engine business logic. This contract is the fix: a
// provider-independent shape a future channel (inbound SMS/email) can
// also normalize into, reusing the SAME pipeline
// (inboundEventPipeline.ts) rather than duplicating it.
//
// Every "resolved_*"/"related_*" field is null, honestly, when genuinely
// unknown -- never guessed. resolution_confidence/resolution_evidence
// describe HOW (or whether) the sender was identified, so a caller can
// distinguish "we know exactly who this is" from "we persisted an
// inbound message from an unrecognized number."
import type { CommunicationChannel } from "./communication";

export type InboundResolutionConfidence = "high" | "medium" | "low" | "unresolved";

export type CanonicalInboundCommunicationEvent = {
  provider: string; // e.g. "whatsapp_cloud_api"
  provider_event_id: string; // provider_message_id -- the idempotency key together with channel+direction
  channel: CommunicationChannel;

  sender_identifier: string; // phone/email exactly as the provider reported it
  recipient_business_identifier: string | null; // our own WABA number/phone_number_id, when the provider payload carries it

  resolved_contact_id: string | null;
  resolved_lead_id: string | null;
  resolved_customer_id: string | null; // reserved -- this CRM doesn't yet distinguish a "customer" record type from lead/contact; always null until it does, never aliased silently
  organization_id: string | null;

  thread_reference: string | null; // computeThreadReference()'s own key -- set by the pipeline, not the caller
  related_opportunity_id: string | null;
  related_task_id: string | null;
  related_goal_id: string | null; // set by the pipeline once a waiting goal is found watching this thread -- null on the initial normalized event
  previous_communication_id: string | null; // most recent OUTBOUND communication on the same thread, if any

  body: string;
  message_type: string; // "text" | "image" | "document" | ... -- whatever the provider reports; "text" when unspecified
  attachments: Record<string, unknown>[] | null;

  occurred_at: string;
  provider_delivery_state: string | null; // for a "message" event this is usually null; populated for a "status" event

  source_surface: string; // e.g. "whatsapp_inbound"

  resolution_confidence: InboundResolutionConfidence;
  resolution_evidence: string; // short human-readable note on HOW resolution was attempted, e.g. "matched lead by whatsapp_phone" or "no CRM match for this number"
};

export type InboundEventProcessingResult = {
  ok: boolean;
  duplicate: boolean;
  communication_id: string | null;
  thread_reference: string | null;
  outcome_classification: string | null;
  woke_goal_ids: string[];
  reason: string | null;
};
