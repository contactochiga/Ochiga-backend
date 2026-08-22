import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "communication-runtime-smoke-service-role-key";

// Oyi Communication Actions Runtime -- Phase B/C/E/G smoke coverage.
// Pure-logic parsing/adapter checks only (no ConversationOrchestrator.js
// import in this process -- see other *-smoke.mjs header notes on the
// Redis-reconnect hang that import path triggers).
const { parseCommunicationSendIntent, resolveCommunicationRecipientTokenHint } = await import(
  "../dist/oyi-core/interpretation/communicationIntentParser.js"
);
const { normalizeToE164 } = await import("../dist/services/communicationRuntime/adapters/WhatsAppAdapter.js");
const { EmailAdapter } = await import("../dist/services/communicationRuntime/adapters/EmailAdapter.js");
const { SmsAdapter } = await import("../dist/services/communicationRuntime/adapters/SmsAdapter.js");
const { TelephonyAdapter } = await import("../dist/services/communicationRuntime/adapters/TelephonyAdapter.js");
const { CommunicationRuntime } = await import("../dist/services/communicationRuntime/CommunicationRuntime.js");

// ============================= NL parsing =============================
assert.deepEqual(parseCommunicationSendIntent("email idoko@ochiga.com.ng saying the proposal is ready"), {
  channel: "email",
  recipientToken: "idoko@ochiga.com.ng",
  body: "the proposal is ready",
});
assert.deepEqual(parseCommunicationSendIntent("whatsapp +2348100373353 saying we're on for tomorrow"), {
  channel: "whatsapp",
  recipientToken: "+2348100373353",
  body: "we're on for tomorrow",
});
assert.deepEqual(parseCommunicationSendIntent("send an email to me that the report is done"), {
  channel: "email",
  recipientToken: "me",
  body: "the report is done",
});
assert.deepEqual(parseCommunicationSendIntent("message him saying call me back"), {
  channel: "auto",
  recipientToken: "him",
  body: "call me back",
});
assert.equal(parseCommunicationSendIntent("what's his email?"), null, "a question must never be read as a send request");
assert.equal(parseCommunicationSendIntent("show me the email templates"), null, "no recipient/content structure -- must not fire");
assert.equal(parseCommunicationSendIntent(""), null);

// ========================= Recipient resolution =========================
assert.deepEqual(resolveCommunicationRecipientTokenHint("idoko@ochiga.com.ng", null), { email: "idoko@ochiga.com.ng" });
assert.deepEqual(resolveCommunicationRecipientTokenHint("+2348100373353", null), { phone: "+2348100373353", whatsapp_phone: "+2348100373353" });
assert.deepEqual(
  resolveCommunicationRecipientTokenHint("me", { id: "actor-1", email: "contactochiga@gmail.com" }),
  { email: "contactochiga@gmail.com", user_id: "actor-1" }
);
assert.equal(resolveCommunicationRecipientTokenHint("me", { id: "actor-1", email: null }), null, "must never invent an address for an actor with no on-file email");
assert.equal(resolveCommunicationRecipientTokenHint("him", null), null, "no CRM lookup capability exists yet -- must refuse, not guess");

// ========================= E.164 normalization =========================
assert.equal(normalizeToE164("08100373353"), "+2348100373353");
assert.equal(normalizeToE164("+2348100373353"), "+2348100373353");
assert.equal(normalizeToE164("2348100373353"), "+2348100373353");
assert.equal(normalizeToE164("8100373353"), "+2348100373353");
assert.equal(normalizeToE164(""), null);
assert.equal(normalizeToE164("not-a-phone"), null);

// ========================= Adapter honesty =========================
const sms = new SmsAdapter();
assert.equal(sms.isConfigured(), false, "no SMS provider exists in this codebase -- must never claim configured");
const smsResult = await sms.send({ recipient: { phone: "+2348100373353" }, body: "test" });
assert.equal(smsResult.status, "failed");
assert.equal(smsResult.failure_reason, "not_configured");

const voice = new TelephonyAdapter();
assert.equal(voice.isConfigured(), false, "no telephony provider exists in this codebase -- must never claim configured");
const voiceResult = await voice.send({ recipient: { phone: "+2348100373353" }, body: "test" });
assert.equal(voiceResult.status, "failed");
assert.equal(voiceResult.failure_reason, "not_configured");

const email = new EmailAdapter();
assert.equal(email.validate({ recipient: { email: "not-an-email" }, body: "hi" }).valid, false);
assert.equal(email.validate({ recipient: { email: "a@b.com" }, body: "hi" }).valid, true);
assert.equal(email.validate({ recipient: { email: "a@b.com" }, body: "" , html: null}).valid, false);

// ========================= CommunicationRuntime.plan/resolveChannel =========================
const runtime = new CommunicationRuntime();
assert.equal(runtime.resolveChannel("email", { email: "a@b.com" }), "email");
assert.equal(runtime.resolveChannel("auto", { whatsapp_phone: "+234...", email: "a@b.com" }), "whatsapp", "explicit whatsapp_phone must win over email when channel is auto");
assert.equal(runtime.resolveChannel("auto", { email: "a@b.com" }), "email");
assert.equal(runtime.resolveChannel("auto", { phone: "+234..." }), "sms");
assert.equal(runtime.resolveChannel("auto", {}), null, "no verified contact method -- must never guess a channel");

const clarify = await runtime.plan({
  actor_id: "actor-1",
  surface: "office_internal",
  source: "conversation",
  channel: "auto",
  recipient_hint: {},
  body: "hello",
});
assert.equal(clarify.status, "clarification_required", "no recipient at all -- must ask, never invent");

const rejectedBadEmail = await runtime.plan({
  actor_id: "actor-1",
  surface: "office_internal",
  source: "conversation",
  channel: "email",
  recipient_hint: { email: "not-an-email" },
  body: "hello",
});
assert.equal(rejectedBadEmail.status, "rejected");
assert.equal(rejectedBadEmail.reason, "invalid_recipient");

const ready = await runtime.plan({
  actor_id: "actor-1",
  surface: "office_internal",
  source: "conversation",
  channel: "email",
  recipient_hint: { email: "contactochiga@gmail.com" },
  subject: "Test",
  body: "hello there",
});
assert.equal(ready.status, "ready");
assert.equal(ready.record.status, "awaiting_confirmation");
assert.equal(ready.record.governance.requires_confirmation, true);
assert.equal(ready.record.recipient_resolution_source, "explicit_address");

const preAuthorized = await runtime.plan({
  actor_id: "actor-1",
  surface: "automation",
  source: "automation",
  channel: "email",
  recipient_hint: { email: "contactochiga@gmail.com" },
  body: "automated message",
  pre_authorized: true,
});
assert.equal(preAuthorized.status, "ready");
assert.equal(preAuthorized.record.status, "confirmed", "pre_authorized (automation/workflow only) must skip the redundant confirmation step");
assert.equal(preAuthorized.record.governance.requires_confirmation, false);

// dispatch() against an unconfigured channel must report not_configured
// honestly, never a fabricated send.
const { result: smsDispatch } = await runtime.dispatch({
  communication_id: "00000000-0000-4000-8000-000000000000",
  correlation_id: "c1",
  conversation_thread_id: null,
  actor_id: "actor-1",
  surface: "office_internal",
  source: "conversation",
  source_record_type: null,
  source_record_id: null,
  intent: "test",
  channel: "sms",
  direction: "outbound",
  recipient: { contact_id: null, lead_id: null, user_id: null, organization_id: null, name: null, email: null, phone: "+2348100373353", whatsapp_phone: null },
  recipient_resolution_source: "explicit_address",
  subject: null,
  body: "hi",
  plain_text: "hi",
  html: null,
  template_id: null,
  template_variables: null,
  attachments: null,
  reply_to_message_id: null,
  thread_reference: null,
  priority: "normal",
  schedule: { mode: "now", scheduled_at: null, recurrence: null, timezone: null },
  governance: { requires_confirmation: false, confirmation_id: null, permission_scope: "communication.send.sms", risk_class: "consequential_action" },
  provider: null,
  provider_message_id: null,
  provider_conversation_id: null,
  status: "confirmed",
  outcome: null,
  failure_reason: null,
  failure_detail: null,
  created_at: new Date().toISOString(),
  sent_at: null,
  delivered_at: null,
  completed_at: null,
  delivery_metadata: null,
  audit_metadata: null,
});
assert.equal(smsDispatch.status, "failed");
assert.equal(smsDispatch.failure_reason, "not_configured");

console.log("communication-runtime-smoke: PASS");
