// Oyi Communication Actions Runtime -- the ONE dispatcher every channel
// goes through (email/sms/whatsapp/voice_call/internal_message), so
// nothing above this layer (conversation capabilities, Task completion,
// Automation actions, Workflow steps) ever talks to a provider directly.
// Mirrors GovernedActionProposal's separation of "what should happen"
// from "how it gets executed" -- see contracts/communication.ts's header.
//
// Recipient resolution boundary: this runtime does NOT query Office's
// CRM tables (Backend has no DB access there -- the same constraint that
// shapes officeActionProposal.ts throughout this codebase). Callers
// (Office capability code, which DOES have CRM access) resolve "him"/
// "me"/a selected record into concrete contact fields BEFORE calling
// plan() -- passed via CommunicationRequest.recipient_hint. resolveRecipient()
// here is the final safety net: it accepts an already-populated hint and
// refuses to proceed (returns unresolved, never invents an address) if
// the hint doesn't carry a genuinely usable address for the chosen
// channel.
import { randomUUID } from "crypto";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { emitAuditEvent } from "../../core/foundation/audit";
import type {
  CommunicationAdapterValidation,
} from "./adapters/CommunicationAdapter";
import type { CommunicationAdapter } from "./adapters/CommunicationAdapter";
import { EmailAdapter } from "./adapters/EmailAdapter";
import { WhatsAppAdapter } from "./adapters/WhatsAppAdapter";
import { SmsAdapter } from "./adapters/SmsAdapter";
import { TelephonyAdapter } from "./adapters/TelephonyAdapter";
import type {
  CommunicationChannel,
  CommunicationChannelSelector,
  CommunicationDispatchResult,
  CommunicationFailureReason,
  CommunicationPlanResult,
  CommunicationRecipient,
  CommunicationRecord,
  CommunicationRequest,
  RecipientResolutionSource,
} from "../../contracts/communication";

function mapValidationReason(reason: string | null): CommunicationFailureReason {
  if (reason === "invalid_recipient") return "invalid_recipient";
  if (reason === "not_configured") return "not_configured";
  return "unknown";
}

const EMPTY_RECIPIENT: CommunicationRecipient = {
  contact_id: null,
  lead_id: null,
  user_id: null,
  organization_id: null,
  name: null,
  email: null,
  phone: null,
  whatsapp_phone: null,
};

function channelPermissionScope(channel: CommunicationChannel): string {
  return `communication.send.${channel}`;
}

// internal_message has no external provider -- it's a system/Office note,
// not sent anywhere -- so it "delivers" immediately without a provider
// round-trip. Kept minimal and honest: no fabricated provider status.
class InternalMessageAdapter implements CommunicationAdapter {
  readonly channel = "internal_message" as const;
  readonly provider = "internal";
  isConfigured() { return true; }
  validate(record: CommunicationRecord): CommunicationAdapterValidation {
    return record.body ? { valid: true, reason: null } : { valid: false, reason: "missing_body" };
  }
  async send(): Promise<CommunicationDispatchResult> {
    return { status: "sent", provider: this.provider, provider_message_id: null, failure_reason: null, failure_detail: null, delivery_metadata: null };
  }
  normalizeWebhook() { return []; }
}

export class CommunicationRuntime {
  private readonly adapters: Record<CommunicationChannel, CommunicationAdapter>;

  constructor() {
    this.adapters = {
      email: new EmailAdapter(),
      whatsapp: new WhatsAppAdapter(),
      sms: new SmsAdapter(),
      voice_call: new TelephonyAdapter(),
      internal_message: new InternalMessageAdapter(),
    };
  }

  adapterFor(channel: CommunicationChannel): CommunicationAdapter {
    return this.adapters[channel];
  }

  // Finalizes a recipient from an already-partially-resolved hint. Never
  // queries anything, never invents a value -- purely validates that
  // what the caller already resolved is genuinely usable.
  resolveRecipient(hint: CommunicationRequest["recipient_hint"]): { recipient: CommunicationRecipient; source: RecipientResolutionSource } {
    if (!hint) return { recipient: EMPTY_RECIPIENT, source: "unresolved" };
    const recipient: CommunicationRecipient = {
      contact_id: hint.contact_id ?? null,
      lead_id: hint.lead_id ?? null,
      user_id: hint.user_id ?? null,
      organization_id: hint.organization_id ?? null,
      name: hint.name ?? null,
      email: hint.email ?? null,
      phone: hint.phone ?? null,
      whatsapp_phone: hint.whatsapp_phone ?? null,
    };
    const hasAnyAddress = Boolean(recipient.email || recipient.phone || recipient.whatsapp_phone);
    if (!hasAnyAddress) return { recipient, source: "unresolved" };
    if (hint.user_id && !hint.contact_id && !hint.lead_id) return { recipient, source: "authenticated_user" };
    if (hint.contact_id || hint.lead_id) return { recipient, source: "selected_record" };
    return { recipient, source: "explicit_address" };
  }

  // Turns "auto" into a concrete channel. An explicit channel word always
  // wins; otherwise picks the first verified contact method available,
  // in a fixed, predictable order -- never guesses beyond what's on file.
  resolveChannel(selector: CommunicationChannelSelector, recipient: CommunicationRecipient): CommunicationChannel | null {
    if (selector !== "auto") return selector;
    if (recipient.whatsapp_phone) return "whatsapp";
    if (recipient.email) return "email";
    if (recipient.phone) return "sms";
    return null;
  }

  async plan(request: CommunicationRequest): Promise<CommunicationPlanResult> {
    const { recipient, source } = this.resolveRecipient(request.recipient_hint);
    const channel = this.resolveChannel(request.channel, recipient);

    if (!channel) {
      const missing: Array<"recipient" | "channel" | "body"> = [];
      if (source === "unresolved") missing.push("recipient");
      if (request.channel === "auto") missing.push("channel");
      return { status: "clarification_required", reason: "No verified contact method is available to determine or reach the recipient on the requested channel.", missing: missing.length ? missing : ["recipient"] };
    }
    if (source === "unresolved") {
      return { status: "clarification_required", reason: "Could not determine a recipient for this communication from the current conversation context.", missing: ["recipient"] };
    }
    if (!request.body || !request.body.trim()) {
      return { status: "clarification_required", reason: "No message content was provided.", missing: ["body"] };
    }

    const now = new Date().toISOString();
    const record: CommunicationRecord = {
      communication_id: randomUUID(),
      correlation_id: request.correlation_id || randomUUID(),
      conversation_thread_id: request.conversation_thread_id ?? null,
      actor_id: request.actor_id,
      surface: request.surface,
      source: request.source,
      source_record_type: request.source_record_type ?? null,
      source_record_id: request.source_record_id ?? null,
      intent: request.intent || "conversation_message",
      channel,
      direction: "outbound",
      recipient,
      recipient_resolution_source: source,
      subject: request.subject ?? null,
      body: request.body,
      plain_text: request.body,
      html: request.html ?? null,
      template_id: request.template_id ?? null,
      template_variables: request.template_variables ?? null,
      attachments: null,
      reply_to_message_id: request.reply_to_message_id ?? null,
      thread_reference: null,
      priority: request.priority || "normal",
      schedule: {
        mode: request.schedule?.mode || "now",
        scheduled_at: request.schedule?.scheduled_at ?? null,
        recurrence: request.schedule?.recurrence ?? null,
        timezone: request.schedule?.timezone ?? null,
      },
      governance: {
        requires_confirmation: !request.pre_authorized,
        confirmation_id: null,
        permission_scope: channelPermissionScope(channel),
        risk_class: "consequential_action",
      },
      provider: null,
      provider_message_id: null,
      provider_conversation_id: null,
      status: request.pre_authorized ? "confirmed" : "awaiting_confirmation",
      outcome: null,
      failure_reason: null,
      failure_detail: null,
      created_at: now,
      sent_at: null,
      delivered_at: null,
      completed_at: null,
      delivery_metadata: null,
      audit_metadata: null,
    };

    const validation = this.validate(record);
    if (!validation.valid) {
      return { status: "rejected", reason: mapValidationReason(validation.reason), detail: validation.reason || "Validation failed." };
    }
    // Persisted immediately, even in draft/awaiting_confirmation state --
    // Phase V wants a full audit trail per communication, including ones
    // never confirmed, not just ones that were sent.
    const persisted = await this.persist(record);
    return { status: "ready", record: persisted };
  }

  validate(record: CommunicationRecord): CommunicationAdapterValidation {
    return this.adapterFor(record.channel).validate(record);
  }

  async loadDraft(communicationId: string): Promise<CommunicationRecord | null> {
    return this.verify(communicationId);
  }

  // Marks a planned record as authorized to send. `confirmed` covers the
  // interactive propose->confirm flow; pre_authorized (set only by
  // Automation/Workflow execution, never conversational code -- see
  // CommunicationRequest.pre_authorized) skips the redundant second
  // confirmation per Phase D.
  authorize(record: CommunicationRecord, opts: { confirmed?: boolean; confirmationId?: string | null } = {}): CommunicationRecord {
    if (record.status === "confirmed") return record;
    if (!opts.confirmed) return record;
    return {
      ...record,
      status: "confirmed",
      governance: { ...record.governance, confirmation_id: opts.confirmationId ?? record.governance.confirmation_id },
    };
  }

  // Idempotency guard -- a retry after a client timeout (the confirm
  // request genuinely reached the server and dispatched, but the
  // response was lost) must never send the same email/message twice.
  // The authoritative source of truth is the DB row's CURRENT status,
  // not the in-memory record the caller passed in -- re-read it first.
  async dispatch(record: CommunicationRecord): Promise<{ record: CommunicationRecord; result: CommunicationDispatchResult }> {
    const current = await this.verify(record.communication_id);
    if (current && (current.status === "sent" || current.status === "sending" || current.status === "delivered" || current.status === "read")) {
      return {
        record: current,
        result: {
          status: current.status === "sending" ? "failed" : "sent",
          provider: current.provider,
          provider_message_id: current.provider_message_id,
          failure_reason: current.status === "sending" ? "provider_unavailable" : null,
          failure_detail: current.status === "sending" ? "A send for this communication is already in progress." : null,
          delivery_metadata: current.delivery_metadata,
        },
      };
    }
    const persisted = await this.persist({ ...record, status: "sending" });
    const adapter = this.adapterFor(persisted.channel);
    if (!adapter.isConfigured()) {
      const result: CommunicationDispatchResult = { status: "failed", provider: adapter.provider, provider_message_id: null, failure_reason: "not_configured", failure_detail: `${persisted.channel} channel is not configured.`, delivery_metadata: null };
      const updated = await this.recordOutcome(persisted, result);
      return { record: updated, result };
    }
    const result = await adapter.send(persisted);
    const updated = await this.recordOutcome(persisted, result);
    return { record: updated, result };
  }

  async recordOutcome(record: CommunicationRecord, result: CommunicationDispatchResult): Promise<CommunicationRecord> {
    const now = new Date().toISOString();
    const updated: CommunicationRecord = {
      ...record,
      status: result.status === "sent" ? "sent" : "failed",
      outcome: result.status === "sent" ? "sent" : "failed",
      provider: result.provider,
      provider_message_id: result.provider_message_id,
      failure_reason: result.failure_reason,
      failure_detail: result.failure_detail,
      sent_at: result.status === "sent" ? now : record.sent_at,
      delivery_metadata: result.delivery_metadata,
    };
    const persisted = await this.persist(updated);
    await emitAuditEvent({
      actorId: record.actor_id,
      action: result.status === "sent" ? "communication.sent" : "communication.failed",
      resourceType: "communication",
      resourceId: record.communication_id,
      status: result.status === "sent" ? "success" : "failed",
      metadata: {
        channel: record.channel,
        provider: result.provider,
        source: record.source,
        source_record_type: record.source_record_type,
        source_record_id: record.source_record_id,
        correlation_id: record.correlation_id,
        failure_reason: result.failure_reason,
      },
    } as any);
    return persisted;
  }

  async verify(communicationId: string): Promise<CommunicationRecord | null> {
    const { data, error } = await supabaseAdmin.from("oyi_communications").select("*").eq("id", communicationId).maybeSingle();
    if (error || !data) return null;
    return rowToRecord(data);
  }

  async cancel(communicationId: string): Promise<CommunicationRecord | null> {
    const draft = await this.verify(communicationId);
    if (!draft) return null;
    return this.persist({ ...draft, status: "cancelled" });
  }

  // Phase K/L -- "what did you just send?" / "was that delivered?".
  // Scoped to the actor, and to the thread when given, so this never
  // surfaces another staff member's communications.
  async mostRecentForActor(actorId: string, threadId?: string | null): Promise<CommunicationRecord | null> {
    let query = supabaseAdmin.from("oyi_communications").select("*").eq("actor_id", actorId).order("created_at", { ascending: false }).limit(1);
    if (threadId) query = query.eq("conversation_thread_id", threadId);
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return rowToRecord(data);
  }

  private async persist(record: CommunicationRecord): Promise<CommunicationRecord> {
    const row = recordToRow(record);
    const { data, error } = await supabaseAdmin.from("oyi_communications").upsert(row, { onConflict: "id" }).select("*").single();
    if (error || !data) return record;
    return rowToRecord(data);
  }
}

function recordToRow(record: CommunicationRecord): Record<string, unknown> {
  return {
    id: record.communication_id,
    correlation_id: record.correlation_id,
    conversation_thread_id: record.conversation_thread_id,
    actor_id: record.actor_id,
    surface: record.surface,
    source: record.source,
    source_record_type: record.source_record_type,
    source_record_id: record.source_record_id,
    intent: record.intent,
    channel: record.channel,
    direction: record.direction,
    recipient_contact_id: record.recipient.contact_id,
    recipient_lead_id: record.recipient.lead_id,
    recipient_user_id: record.recipient.user_id,
    recipient_organization_id: record.recipient.organization_id,
    recipient_name: record.recipient.name,
    recipient_email: record.recipient.email,
    recipient_phone: record.recipient.phone,
    recipient_whatsapp_phone: record.recipient.whatsapp_phone,
    recipient_resolution_source: record.recipient_resolution_source,
    subject: record.subject,
    body: record.body,
    plain_text: record.plain_text,
    html: record.html,
    template_id: record.template_id,
    template_variables: record.template_variables,
    attachments: record.attachments,
    reply_to_message_id: record.reply_to_message_id,
    thread_reference: record.thread_reference,
    priority: record.priority,
    schedule_mode: record.schedule.mode,
    scheduled_at: record.schedule.scheduled_at,
    recurrence: record.schedule.recurrence ? { value: record.schedule.recurrence } : null,
    timezone: record.schedule.timezone,
    requires_confirmation: record.governance.requires_confirmation,
    confirmation_id: record.governance.confirmation_id,
    permission_scope: record.governance.permission_scope,
    risk_class: record.governance.risk_class,
    provider: record.provider,
    provider_message_id: record.provider_message_id,
    provider_conversation_id: record.provider_conversation_id,
    status: record.status,
    outcome: record.outcome,
    failure_reason: record.failure_reason,
    failure_detail: record.failure_detail,
    created_at: record.created_at,
    sent_at: record.sent_at,
    delivered_at: record.delivered_at,
    completed_at: record.completed_at,
    delivery_metadata: record.delivery_metadata,
    audit_metadata: record.audit_metadata,
  };
}

function rowToRecord(row: any): CommunicationRecord {
  return {
    communication_id: row.id,
    correlation_id: row.correlation_id,
    conversation_thread_id: row.conversation_thread_id,
    actor_id: row.actor_id,
    surface: row.surface,
    source: row.source,
    source_record_type: row.source_record_type,
    source_record_id: row.source_record_id,
    intent: row.intent,
    channel: row.channel,
    direction: row.direction,
    recipient: {
      contact_id: row.recipient_contact_id,
      lead_id: row.recipient_lead_id,
      user_id: row.recipient_user_id,
      organization_id: row.recipient_organization_id,
      name: row.recipient_name,
      email: row.recipient_email,
      phone: row.recipient_phone,
      whatsapp_phone: row.recipient_whatsapp_phone,
    },
    recipient_resolution_source: row.recipient_resolution_source,
    subject: row.subject,
    body: row.body,
    plain_text: row.plain_text,
    html: row.html,
    template_id: row.template_id,
    template_variables: row.template_variables,
    attachments: row.attachments,
    reply_to_message_id: row.reply_to_message_id,
    thread_reference: row.thread_reference,
    priority: row.priority,
    schedule: {
      mode: row.schedule_mode,
      scheduled_at: row.scheduled_at,
      recurrence: row.recurrence?.value ?? null,
      timezone: row.timezone,
    },
    governance: {
      requires_confirmation: row.requires_confirmation,
      confirmation_id: row.confirmation_id,
      permission_scope: row.permission_scope,
      risk_class: row.risk_class,
    },
    provider: row.provider,
    provider_message_id: row.provider_message_id,
    provider_conversation_id: row.provider_conversation_id,
    status: row.status,
    outcome: row.outcome,
    failure_reason: row.failure_reason,
    failure_detail: row.failure_detail,
    created_at: row.created_at,
    sent_at: row.sent_at,
    delivered_at: row.delivered_at,
    completed_at: row.completed_at,
    delivery_metadata: row.delivery_metadata,
    audit_metadata: row.audit_metadata,
  };
}

export const communicationRuntime = new CommunicationRuntime();
