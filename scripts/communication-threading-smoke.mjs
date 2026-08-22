import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "communication-threading-smoke-service-role-key";

// Oyi Communication Actions Runtime -- Phase 5/7 (threading + reply
// queries) smoke coverage. Pure-logic checks only.
const { parseReplyOrThreadQuery, parseCommunicationSendIntent } = await import(
  "../dist/oyi-core/interpretation/communicationIntentParser.js"
);
const { computeThreadReference, CommunicationRuntime } = await import(
  "../dist/services/communicationRuntime/CommunicationRuntime.js"
);

// ============================= Thread reference computation =============================
assert.equal(computeThreadReference("whatsapp", { whatsapp_phone: "+2348100373353" }), "whatsapp:+2348100373353");
assert.equal(computeThreadReference("email", { email: "Daniel@Example.com" }), "email:daniel@example.com");
assert.equal(computeThreadReference("sms", { phone: "+2348100373353" }), "sms:+2348100373353");
assert.equal(computeThreadReference("whatsapp", {}), null, "no address on file -- no thread reference invented");

// ============================= Reply/thread query parsing =============================
assert.deepEqual(parseReplyOrThreadQuery("Has he replied?"), { kind: "reply_status", recipientToken: "he" });
assert.deepEqual(parseReplyOrThreadQuery("Did she reply?"), { kind: "reply_status", recipientToken: "she" });
assert.deepEqual(parseReplyOrThreadQuery("What did he say?"), { kind: "reply_content", recipientToken: "he" });
assert.deepEqual(parseReplyOrThreadQuery("What was her reply?"), { kind: "reply_content", recipientToken: "her" });
assert.deepEqual(parseReplyOrThreadQuery("Show me our WhatsApp conversation with Daniel"), { kind: "thread_history", recipientToken: "Daniel" });
assert.deepEqual(parseReplyOrThreadQuery("show our conversation with the lead"), { kind: "thread_history", recipientToken: "the lead" });
assert.equal(parseReplyOrThreadQuery("What's the weather?"), null);
assert.equal(parseReplyOrThreadQuery("did that email go through?"), null, "must not collide with the OUTBOUND-status history query");

// ============================= "Reply and tell him..." normalization =============================
assert.deepEqual(parseCommunicationSendIntent("Reply and tell him I'll call later."), {
  channel: "auto",
  recipientToken: "him",
  body: "I'll call later.",
});
assert.deepEqual(parseCommunicationSendIntent("Reply to her: on my way."), {
  channel: "auto",
  recipientToken: "her",
  body: "on my way.",
});

// ============================= getThread (mocked persistence) =============================
{
  const runtime = new CommunicationRuntime();
  const rows = [
    { id: "c2", channel: "whatsapp", direction: "outbound", body: "Following up", status: "sent", thread_reference: "whatsapp:+234", created_at: "2026-01-02T00:00:00Z", recipient_email: null, recipient_phone: null, recipient_whatsapp_phone: "+234", recipient_lead_id: null, recipient_contact_id: null, recipient_user_id: null, recipient_organization_id: null, recipient_name: null, recipient_resolution_source: "explicit_address", schedule_mode: "now", scheduled_at: null, recurrence: null, timezone: null, requires_confirmation: false, confirmation_id: null, permission_scope: "communication.send.whatsapp", risk_class: "consequential_action", correlation_id: "x", conversation_thread_id: null, actor_id: "a1", surface: "office_internal", source: "conversation", source_record_type: null, source_record_id: null, intent: "t", subject: null, plain_text: "Following up", html: null, template_id: null, template_variables: null, attachments: null, reply_to_message_id: null, priority: "normal", provider: "whatsapp_cloud_api", provider_message_id: "wamid1", provider_conversation_id: null, outcome: "sent", failure_reason: null, failure_detail: null, sent_at: "2026-01-02T00:00:00Z", delivered_at: null, completed_at: null, delivery_metadata: null, audit_metadata: null },
    { id: "c1", channel: "whatsapp", direction: "inbound", body: "Sounds good", status: "delivered", thread_reference: "whatsapp:+234", created_at: "2026-01-01T00:00:00Z", recipient_email: null, recipient_phone: null, recipient_whatsapp_phone: "+234", recipient_lead_id: null, recipient_contact_id: null, recipient_user_id: null, recipient_organization_id: null, recipient_name: null, recipient_resolution_source: "explicit_address", schedule_mode: "now", scheduled_at: null, recurrence: null, timezone: null, requires_confirmation: false, confirmation_id: null, permission_scope: "communication.receive", risk_class: "low_risk_action", correlation_id: "y", conversation_thread_id: null, actor_id: "a1", surface: "whatsapp_inbound", source: "inbound_webhook", source_record_type: null, source_record_id: null, intent: "inbound_reply", subject: null, plain_text: "Sounds good", html: null, template_id: null, template_variables: null, attachments: null, reply_to_message_id: null, priority: "normal", provider: "whatsapp_cloud_api", provider_message_id: "wamid0", provider_conversation_id: null, outcome: "received", failure_reason: null, failure_detail: null, sent_at: null, delivered_at: "2026-01-01T00:00:00Z", completed_at: null, delivery_metadata: null, audit_metadata: null },
  ];
  // Mock the Supabase call chain used inside getThread.
  const { supabaseAdmin } = await import("../dist/supabase/supabaseClient.js");
  const original = supabaseAdmin.from;
  supabaseAdmin.from = (table) => {
    if (table !== "oyi_communications") return original.call(supabaseAdmin, table);
    return {
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: rows, error: null }),
          }),
        }),
      }),
    };
  };
  const thread = await runtime.getThread("whatsapp:+234", 20);
  supabaseAdmin.from = original;
  assert.equal(thread.length, 2);
  assert.equal(thread[0].direction, "outbound", "getThread preserves the query's own order (newest first)");
  const lastInbound = thread.find((m) => m.direction === "inbound");
  assert.equal(lastInbound.body, "Sounds good");
}

console.log("communication-threading-smoke: PASS");
