// Oyi Communication Actions Runtime.
//
// Provider-independent contract. Everything above this file (Oyi Core's
// conversational reasoning, the Automation Runtime, Task execution)
// speaks in these terms only; everything below (CommunicationRuntime,
// channel adapters) translates to/from a specific provider's own shape.
// Mirrors the existing GovernedActionProposal pattern's own separation
// of "what should happen" from "how it gets executed" (see
// governedAction.ts's own header note) — not a parallel philosophy,
// the same one applied to a domain where Backend, not Office, owns
// execution (Backend already holds the provider credentials for email;
// see CommunicationRuntime.ts's header note on why WhatsApp is the one
// channel that still calls out to Office).
//
// NOTE ON NAMING COLLISION: src/services/communications/ (existing,
// untouched by this work) is a live WebRTC session/hand-off/voice-
// transcription system (community live-streaming, office support
// hand-off) — entirely unrelated to outbound messaging. Deliberately
// named this file/module "communication" (singular) throughout to stay
// visually distinct from that existing "communications" (plural)
// directory in imports and greps.

export type CommunicationChannel = "email" | "sms" | "whatsapp" | "voice_call" | "internal_message";

// "auto" is a REQUEST-time-only value (the caller didn't specify a
// channel) — resolveChannel() in CommunicationRuntime.ts always turns
// it into a concrete channel before a CommunicationRequest is ever
// built, so persisted records only ever carry a real channel.
export type CommunicationChannelSelector = CommunicationChannel | "auto";

export type CommunicationDirection = "outbound" | "inbound";

export type CommunicationSourceRecordType =
  | "lead"
  | "contact"
  | "organization"
  | "opportunity"
  | "partnership"
  | "task"
  | "meeting"
  | "automation"
  | "workflow"
  | "support_case"
  | null;

// Every state a communication can be in end to end. Not every channel
// reaches every state (email has no "ringing"; a call has no
// "delivered"/"read") -- CommunicationOutcome (below) is the
// channel-appropriate terminal-state vocabulary; `status` here is the
// coarse lifecycle stage the governance/runtime layer reasons about.
export type CommunicationStatus =
  | "draft"
  | "awaiting_confirmation"
  | "confirmed"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "cancelled"
  | "expired";

// Message-channel outcomes (email/sms/whatsapp/internal_message).
export type CommunicationMessageOutcome =
  | "sent"
  | "delivered"
  | "read"
  | "replied"
  | "failed"
  | "bounced"
  | "blocked"
  | "opted_out"
  | "unreachable" // number/address is real but not currently reachable (e.g. carrier-reported dead line) -- distinct from "bounced" (provider rejected the send outright) and "failed" (send attempt itself errored).
  | "unknown";

// Call-channel outcomes (voice_call). "ringing" is the one non-terminal
// value here -- kept in the outcome vocabulary (not just the event
// stream) so a goal/automation checking mid-call status has a value to
// read, matching CommunicationEventType's own "call.ringing".
export type CommunicationCallOutcome =
  | "ringing"
  | "answered"
  | "no_answer"
  | "busy"
  | "failed"
  | "completed"
  | "voicemail"
  | "follow_up_required"
  | "unknown";

export type CommunicationOutcome = CommunicationMessageOutcome | CommunicationCallOutcome;

// voice_call's delivery_metadata shape -- documented here (not a new DB
// column) so every caller reads/writes the same keys instead of each
// inventing its own, same reuse-the-generic-bag pattern every other
// channel's provider-specific extras already use. recording_consent_disclosed
// must be true before recording_url is ever populated (Part I governance --
// a call is never recorded without disclosure being recorded first).
export type CommunicationCallDeliveryMetadata = {
  duration_seconds: number | null;
  ring_duration_seconds: number | null;
  recording_url: string | null;
  recording_consent_disclosed: boolean;
  dial_attempt_count: number;
  voicemail_left: boolean;
};

// Normalized provider failure reasons -- CommunicationRuntime/adapters
// translate every provider-specific error into one of these; nothing
// above this layer (Oyi Core, chat UI) ever sees a raw provider error
// string or stack trace (Phase T/U -- no secrets, no provider internals
// leaked to chat).
export type CommunicationFailureReason =
  | "invalid_recipient"
  | "missing_recipient"
  | "not_configured"
  | "authentication_failed"
  | "rate_limited"
  | "provider_unavailable"
  | "template_required"
  | "recipient_opted_out"
  | "permission_denied"
  | "delivery_failed"
  | "unsupported_channel"
  | "unknown";

export type CommunicationRecipient = {
  contact_id: string | null;
  lead_id: string | null;
  user_id: string | null;
  organization_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
};

// How the recipient's contact details were actually determined -- lets
// Oyi answer "who did you send that to and how did you know their
// email" honestly, and lets a later audit distinguish "the record's own
// on-file address" from "the staff member typed one in directly".
export type RecipientResolutionSource =
  | "selected_record"
  | "explicit_name_match"
  | "authenticated_user"
  | "explicit_address"
  | "batch_context"
  | "unresolved";

export type CommunicationSchedule = {
  mode: "now" | "scheduled";
  scheduled_at: string | null;
  recurrence: string | null; // reuses the SAME automation schedule shape (schedule_type/weekdays/local_time) as automationScheduleService.ts once wired to an actual automation -- not a second recurrence grammar.
  timezone: string | null;
};

export type CommunicationGovernance = {
  requires_confirmation: boolean;
  confirmation_id: string | null;
  permission_scope: string;
  risk_class: "low_risk_action" | "consequential_action";
};

export type CommunicationAttachment = {
  filename: string;
  content_type: string | null;
  url: string | null;
};

// The canonical, persisted record. A CommunicationRequest (what a
// caller asks for) becomes one of these once accepted; adapters only
// ever read/write the fields relevant to their channel.
export type CommunicationRecord = {
  communication_id: string;
  correlation_id: string;
  conversation_thread_id: string | null;
  actor_id: string | null;
  surface: string; // "office_internal" | "automation" | "task" | "workflow" -- free text, mirrors OyiDomain-adjacent surface tags already used elsewhere rather than a closed enum, since new invocation surfaces will keep appearing.
  source: "conversation" | "automation" | "task" | "workflow";
  source_record_type: CommunicationSourceRecordType;
  source_record_id: string | null;

  intent: string; // short human-readable label, e.g. "opportunity_review_request" -- free text, not a closed taxonomy (mirrors capability "operation" strings elsewhere).

  channel: CommunicationChannel;
  direction: CommunicationDirection;

  recipient: CommunicationRecipient;
  recipient_resolution_source: RecipientResolutionSource;

  subject: string | null;
  body: string | null;
  plain_text: string | null;
  html: string | null;
  template_id: string | null;
  template_variables: Record<string, string> | null;
  attachments: CommunicationAttachment[] | null;

  reply_to_message_id: string | null;
  thread_reference: string | null;

  priority: "normal" | "high";

  schedule: CommunicationSchedule;
  governance: CommunicationGovernance;

  provider: string | null;
  provider_message_id: string | null;
  provider_conversation_id: string | null;

  status: CommunicationStatus;
  outcome: CommunicationOutcome | null;
  failure_reason: CommunicationFailureReason | null;
  failure_detail: string | null;

  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;

  delivery_metadata: Record<string, unknown> | null;
  audit_metadata: Record<string, unknown> | null;
};

// A caller's REQUEST -- everything optional except what's needed to
// reason about intent; CommunicationRuntime.plan() fills in the rest
// (resolves recipient/channel, builds the CommunicationRecord).
export type CommunicationRequest = {
  correlation_id?: string;
  conversation_thread_id?: string | null;
  actor_id: string | null;
  surface: string;
  source: CommunicationRecord["source"];
  source_record_type?: CommunicationSourceRecordType;
  source_record_id?: string | null;

  intent?: string;
  channel: CommunicationChannelSelector;

  recipient_hint?: Partial<CommunicationRecipient> & { raw_reference?: string | null };

  subject?: string | null;
  body: string;
  html?: string | null;
  template_id?: string | null;
  template_variables?: Record<string, string> | null;

  reply_to_message_id?: string | null;
  priority?: "normal" | "high";
  schedule?: Partial<CommunicationSchedule>;

  // Automation/workflow-originated requests are pre-authorized by the
  // automation's own confirmed governance scope (Phase D) -- set true
  // ONLY by the Automation/Workflow execution paths, never by
  // conversational capability code, so a second redundant confirmation
  // is skipped exactly where the brief calls for it and nowhere else.
  pre_authorized?: boolean;
};

// What CommunicationRuntime.plan() returns BEFORE anything is sent --
// either a ready CommunicationRecord awaiting confirmation, or a
// structured clarification requirement (never a fabricated recipient).
export type CommunicationPlanResult =
  | { status: "ready"; record: CommunicationRecord }
  | { status: "clarification_required"; reason: string; missing: Array<"recipient" | "channel" | "body"> }
  | { status: "rejected"; reason: CommunicationFailureReason; detail: string };

export type CommunicationDispatchResult = {
  status: "sent" | "failed";
  provider: string | null;
  provider_message_id: string | null;
  failure_reason: CommunicationFailureReason | null;
  failure_detail: string | null;
  delivery_metadata: Record<string, unknown> | null;
};

// Canonical inbound/status event shape every adapter's normalizeWebhook()
// produces -- the rest of the system never sees a provider-shaped
// payload (Phase J).
export type CommunicationEventType =
  | "communication.queued"
  | "communication.sent"
  | "communication.delivered"
  | "communication.read"
  | "communication.failed"
  | "email.received"
  | "email.replied"
  | "whatsapp.received"
  | "whatsapp.replied"
  | "sms.received"
  | "call.started"
  | "call.ringing"
  | "call.answered"
  | "call.completed"
  | "call.failed";

export type CommunicationEvent = {
  event_id: string;
  communication_id: string | null; // null when an INBOUND event can't yet be matched to an existing outbound thread (a fresh inbound message).
  type: CommunicationEventType;
  occurred_at: string;
  channel: CommunicationChannel;
  provider: string;
  provider_event_id: string | null;
  from_address: string | null; // inbound sender (phone/email), for thread matching.
  text: string | null; // inbound message body, when the event carries one.
  metadata: Record<string, unknown> | null;
};
