import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "communication-automation-action-smoke-service-role-key";

// Oyi Communication Actions Runtime -- Phase M/N (Automation Runtime
// integration) smoke coverage: the communication_action shape added to
// the Shared Automation Runtime (scenes.ts), same allowlist/normalizer/
// validator pattern as registered_action/workflow_action.
//
// Imports scenes.js directly (unlike the other communication-runtime
// smoke script) -- this pulls in the same dependency chain as
// office-export-auth-compat-smoke.mjs, which is known to leave a
// lingering Redis reconnect handle open after its assertions complete
// (does not affect correctness, just process exit) -- explicit
// process.exit(0) at the end works around it, same as that script.
const {
  isCommunicationActionItem,
  cleanCommunicationActions,
  validateCommunicationActions,
} = await import("../dist/routes/scenes.js");

// ============================= isCommunicationActionItem =============================
assert.equal(isCommunicationActionItem({ action_type: "communication_action", channel: "email" }), true);
assert.equal(isCommunicationActionItem({ action_type: "workflow_action" }), false);
assert.equal(isCommunicationActionItem(null), false);

// ============================= cleanCommunicationActions =============================
const rawMixed = [
  { action_type: "communication_action", channel: "email", recipient_email: "contactochiga@gmail.com", subject: "Weekly digest", body: "Automated summary." },
  { action_type: "workflow_action", operation: "create" }, // must be filtered out -- not a communication_action item
];
const cleaned = cleanCommunicationActions(rawMixed);
assert.equal(cleaned.length, 1, "a mixed-type array must only keep communication_action items");
assert.deepEqual(cleaned[0], {
  channel: "email",
  recipient_email: "contactochiga@gmail.com",
  recipient_phone: null,
  subject: "Weekly digest",
  body: "Automated summary.",
  label: null,
});

// An unrecognized channel string falls back to "auto" rather than being rejected outright.
const cleanedBadChannel = cleanCommunicationActions([{ action_type: "communication_action", channel: "carrier_pigeon", recipient_email: "a@b.com", body: "hi" }]);
assert.equal(cleanedBadChannel[0].channel, "auto");

// ============================= validateCommunicationActions =============================
assert.equal(validateCommunicationActions([]).ok, false, "an empty action list must be rejected");

const missingRecipient = validateCommunicationActions([{ channel: "email", recipient_email: null, recipient_phone: null, body: "hi", subject: null, label: null }]);
assert.equal(missingRecipient.ok, false);
assert.equal(missingRecipient.code, "communication_recipient_required");

const missingBody = validateCommunicationActions([{ channel: "email", recipient_email: "a@b.com", recipient_phone: null, body: "", subject: null, label: null }]);
assert.equal(missingBody.ok, false);
assert.equal(missingBody.code, "communication_body_required");

const valid = validateCommunicationActions([{ channel: "email", recipient_email: "a@b.com", recipient_phone: null, body: "hi", subject: null, label: null }]);
assert.equal(valid.ok, true);

console.log("communication-automation-action-smoke: PASS");
process.exit(0);
