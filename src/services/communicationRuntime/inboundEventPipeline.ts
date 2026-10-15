// Oyi Communication Runtime -- Live Reply Loop programme. The ONE
// canonical inbound-processing pipeline: atomic persist -> classify ->
// governance -> decision-trail log -> goal wake. Every provider webhook
// (today: WhatsApp) normalizes its own payload into a
// CanonicalInboundCommunicationEvent and calls processInboundEvent() --
// nothing provider-specific happens past that normalization step, and
// nothing downstream (goal evaluation, Office presentation) reaches
// into a provider-shaped payload directly.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import { computeThreadReference } from "./CommunicationRuntime";
import { goalRuntime } from "../goalRuntime/GoalRuntime";
import { claimAndEvaluateGoal } from "../goalRuntime/goalScheduler";
import { classifyInboundReply } from "./replyClassifier";
import { recordOptOut, identityKeyForRecipient } from "./optOutService";
import type { CanonicalInboundCommunicationEvent, InboundEventProcessingResult } from "../../contracts/inboundCommunicationEvent";
import type { CommunicationRecipient } from "../../contracts/communication";

function recipientForEvent(event: CanonicalInboundCommunicationEvent): CommunicationRecipient {
  return {
    contact_id: event.resolved_contact_id,
    lead_id: event.resolved_lead_id,
    user_id: null,
    organization_id: event.organization_id,
    name: null,
    email: event.channel === "email" ? event.sender_identifier : null,
    phone: event.channel === "sms" || event.channel === "voice_call" ? event.sender_identifier : null,
    whatsapp_phone: event.channel === "whatsapp" ? event.sender_identifier : null,
  };
}

// Appends a decision-trail row to the (previously unused) oyi_communication_events
// table -- reused, not duplicated: it already existed with the right shape
// and its own provider/provider_event_id uniqueness, just never wired
// into the live path. Every reply-driven transition gets one of these,
// so "incoming communication -> resolved entity/thread -> interpreted
// outcome -> decision -> ..." is reconstructible from this table alone.
async function logDecisionEvent(input: {
  communicationId: string | null;
  eventType: string;
  channel: string;
  provider: string;
  providerEventId: string | null;
  fromAddress: string | null;
  eventText: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("oyi_communication_events").insert({
    communication_id: input.communicationId,
    event_type: input.eventType,
    channel: input.channel,
    provider: input.provider,
    // oyi_communication_events has a unique index on (provider, provider_event_id). Every decision event of ONE inbound message used to share the message's id, so only
    // the first ("inbound.classified") was ever stored and "governance.opt_out_recorded", "goal.wake_triggered" ... were silently dropped as duplicates. The event
    // type is appended so the decision trail is complete and still idempotent per (message, event type).
    provider_event_id: input.providerEventId ? `${input.providerEventId}:${input.eventType}` : null,
    from_address: input.fromAddress,
    event_text: input.eventText,
    metadata: input.metadata,
  });
  if (error && !String(error.message || "").includes("duplicate key")) {
    logger.error("communication_decision_event_log_failed", { error, event_type: input.eventType });
  }
}

// True only for a unique violation on the inbound idempotency index. Any other unique violation, or any other error, is a real failure.
export function isInboundDuplicateError(error: { code?: string; message?: string; details?: string } | null | undefined): boolean {
  if (!error || String(error.code || "") !== "23505") return false;
  return `${error.message || ""} ${error.details || ""}`.includes("uq_oyi_communications_inbound_provider_message");
}

export type ProcessInboundOptions = {
  // Historical recovery (e.g. re-delivering inbound messages Office stored while Backend could not persist them). A replayed message is persisted with its ORIGINAL
  // timestamp, classified and subject to opt-out governance (a past STOP must still be honoured), but it NEVER wakes goals: no goal evaluation, no automated
  // follow-up, no outbound message can result from history being re-delivered. Idempotent on the provider message id like any live delivery.
  replay?: boolean;
};

export async function processInboundEvent(event: CanonicalInboundCommunicationEvent, options: ProcessInboundOptions = {}): Promise<InboundEventProcessingResult> {
  const replay = options.replay === true;
  const recipient = recipientForEvent(event);
  const threadReference = event.thread_reference || computeThreadReference(event.channel, recipient);

  // 1) ATOMIC persist -- a plain INSERT, with the database's own unique index as the arbiter. The idempotency index
  // (uq_oyi_communications_inbound_provider_message) is a PARTIAL unique index (WHERE provider_message_id IS NOT NULL AND direction = 'inbound'). The
  // previous code used .upsert(..., { onConflict: "provider,provider_message_id,direction", ignoreDuplicates: true }); PostgREST turns that into
  // ON CONFLICT (provider, provider_message_id, direction), which PostgreSQL cannot match to a partial index (it would need the index predicate), so every
  // inbound message failed with 42P10 and nothing was ever persisted. An insert never needs conflict inference: two webhook deliveries racing each other
  // resolve at the database layer -- exactly one insert wins, the loser gets unique_violation (23505) on that index and is reported as a duplicate.
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("oyi_communications")
    .insert(
      {
        correlation_id: `inbound-${event.provider_event_id}`,
        surface: event.source_surface,
        source: "inbound_webhook",
        source_record_type: event.resolved_lead_id ? "lead" : event.resolved_contact_id ? "contact" : null,
        source_record_id: event.resolved_lead_id || event.resolved_contact_id || null,
        intent: "inbound_reply",
        channel: event.channel,
        direction: "inbound",
        recipient_contact_id: event.resolved_contact_id,
        recipient_lead_id: event.resolved_lead_id,
        recipient_organization_id: event.organization_id,
        recipient_whatsapp_phone: event.channel === "whatsapp" ? event.sender_identifier : null,
        recipient_phone: event.channel === "sms" || event.channel === "voice_call" ? event.sender_identifier : null,
        recipient_email: event.channel === "email" ? event.sender_identifier : null,
        recipient_resolution_source: event.resolved_lead_id || event.resolved_contact_id ? "selected_record" : "unresolved",
        body: event.body,
        plain_text: event.body,
        attachments: event.attachments,
        thread_reference: threadReference,
        priority: "normal",
        schedule_mode: "now",
        requires_confirmation: false,
        permission_scope: "communication.receive",
        risk_class: "low_risk_action",
        provider: event.provider,
        provider_message_id: event.provider_event_id,
        status: "delivered",
        outcome: "received",
        created_at: event.occurred_at || now,
        delivered_at: event.occurred_at || now,
      } as any
    )
    .select("id")
    .maybeSingle();

  if (insertError && isInboundDuplicateError(insertError)) {
    // The duplicate-webhook-delivery case, handled honestly rather than re-processing (re-classifying, re-waking goals) a message twice.
    logger.info("inbound_event_duplicate", { provider_event_id: event.provider_event_id, channel: event.channel, replay });
    return { ok: true, duplicate: true, communication_id: null, thread_reference: threadReference, outcome_classification: null, woke_goal_ids: [], reason: null };
  }
  if (insertError || !inserted) {
    logger.error("inbound_event_persist_failed", { error: insertError, provider_event_id: event.provider_event_id });
    return { ok: false, duplicate: false, communication_id: null, thread_reference: threadReference, outcome_classification: null, woke_goal_ids: [], reason: insertError?.message || "insert_returned_no_row" };
  }
  const communicationId = inserted.id as string;

  // Correlate to the most recent OUTBOUND message on the same thread, if
  // any, purely for the reply_to_message_id link (best-effort, not
  // required for the row to exist).
  if (threadReference) {
    const { data: lastOutbound } = await supabaseAdmin
      .from("oyi_communications")
      .select("id")
      .eq("thread_reference", threadReference)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastOutbound?.id) {
      await supabaseAdmin.from("oyi_communications").update({ reply_to_message_id: lastOutbound.id }).eq("id", communicationId);
    }
  }

  // 2) Classify -- ONE shared classifier, run once, stored on the row so
  // goal evaluation and Office presentation both READ it instead of
  // re-classifying (never a second, parallel intelligence system).
  const classification = await classifyInboundReply(event.body);
  await supabaseAdmin
    .from("oyi_communications")
    .update({
      outcome_classification: classification.outcome,
      outcome_confidence: classification.confidence,
      outcome_evidence: classification.evidence,
    })
    .eq("id", communicationId);

  await logDecisionEvent({
    communicationId,
    eventType: "inbound.classified",
    channel: event.channel,
    provider: event.provider,
    providerEventId: event.provider_event_id,
    fromAddress: event.sender_identifier,
    eventText: event.body,
    metadata: { outcome: classification.outcome, confidence: classification.confidence, evidence: classification.evidence, resolution_confidence: event.resolution_confidence, resolution_evidence: event.resolution_evidence },
  });

  // 3) Governance -- a real STOP/unsubscribe reply takes effect
  // IMMEDIATELY, not just labeled. Recorded here, at the moment the
  // reply is received, rather than waiting for a goal (there may not
  // even BE one) to wake and notice it.
  if (classification.outcome === "unsubscribe") {
    const identityKey = identityKeyForRecipient(event.channel, recipient);
    if (identityKey) {
      await recordOptOut({
        channel: event.channel,
        identityKey,
        reason: `Inbound ${event.channel} message classified as unsubscribe: "${classification.evidence || event.body.slice(0, 100)}"`,
        sourceCommunicationId: communicationId,
        leadId: event.resolved_lead_id,
        contactId: event.resolved_contact_id,
      });
      await logDecisionEvent({
        communicationId,
        eventType: "governance.opt_out_recorded",
        channel: event.channel,
        provider: event.provider,
        providerEventId: event.provider_event_id,
        fromAddress: event.sender_identifier,
        eventText: null,
        metadata: { identity_key: identityKey },
      });
    }
  }

  // 4) Event-driven goal wake (prefer events over polling) -- fire-and-
  // forget so it never delays the webhook's response to the provider;
  // the scheduler tick remains the fallback if this fails for any
  // reason. claimAndEvaluateGoal's CAS claim (goalRuntime.ts) already
  // guarantees exactly-once evaluation even if this fires more than once
  // for the same goal (e.g. a wake here AND a concurrent scheduler tick).
  const wokeGoalIds: string[] = [];
  if (replay) {
    // history is never allowed to trigger autonomous behaviour; record that the wake was deliberately skipped
    await logDecisionEvent({ communicationId, eventType: "inbound.replayed", channel: event.channel, provider: event.provider, providerEventId: event.provider_event_id, fromAddress: event.sender_identifier, eventText: null, metadata: { goal_wake: "skipped_replay", original_occurred_at: event.occurred_at } });
  } else if (threadReference) {
    try {
      const goals = await goalRuntime.findGoalsWatchingThread(threadReference);
      for (const goal of goals) {
        wokeGoalIds.push(goal.id);
        void claimAndEvaluateGoal(goal).catch((error) =>
          logger.error("goal_evaluation_failed", { error, goal_id: goal.id, source: "event_wake", thread_reference: threadReference })
        );
      }
      if (goals.length) {
        await logDecisionEvent({
          communicationId,
          eventType: "goal.wake_triggered",
          channel: event.channel,
          provider: event.provider,
          providerEventId: event.provider_event_id,
          fromAddress: event.sender_identifier,
          eventText: null,
          metadata: { goal_ids: goals.map((g) => g.id) },
        });
      }
    } catch (error) {
      logger.error("goal_wake_lookup_failed", { error, thread_reference: threadReference });
    }
  }

  logger.info("inbound_event_processed", {
    provider_event_id: event.provider_event_id,
    channel: event.channel,
    communication_id: communicationId,
    thread_reference: threadReference,
    outcome_classification: classification.outcome,
    resolution_confidence: event.resolution_confidence,
    woke_goal_count: wokeGoalIds.length,
  });

  return {
    ok: true,
    duplicate: false,
    communication_id: communicationId,
    thread_reference: threadReference,
    outcome_classification: classification.outcome,
    woke_goal_ids: wokeGoalIds,
    reason: null,
  };
}
