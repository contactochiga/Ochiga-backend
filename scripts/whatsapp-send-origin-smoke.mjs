import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
process.env.OFFICE_SYNC_API_KEY = "contract-key";
process.env.OFFICE_APP_URL = "http://office.invalid";
const axios = require("axios");
const posted = [];
axios.post = async (url, body) => { posted.push({ url, body }); return { status: 200, data: { delivered: true, external_message_id: "wamid.x", response_code: 200 } }; };
const mod = await import("../dist/services/communicationRuntime/adapters/WhatsAppAdapter.js");
const adapter = new mod.WhatsAppAdapter();
const recipient = { whatsapp_phone: "+2348012345678", phone: null, lead_id: "lead-1" };
const record = (over) => ({ communication_id: "comm-1", body: "Hello from staff", template_id: null, reply_to_message_id: null, recipient, actor_id: "user-1", source: "conversation", governance: { requires_confirmation: true, confirmation_id: "conf-1" }, ...over });

// Cross-repo contract vector: identical constants are asserted by ochiga-office's test-whatsapp-autonomy-control.js
const vector = mod.buildStaffConfirmation({ communicationId: "comm-1", actorId: "user-1", confirmationId: "conf-1", to: "+2348012345678", templateName: null, body: "Hello from staff", key: "contract-key", now: new Date("2026-10-14T12:00:00.000Z") });
assert.equal(vector.signature, "ac5d8e89cb402019cb4fcc924ee5813615b12350fdc42506671cfaee146bda56");
const tplVector = mod.buildStaffConfirmation({ communicationId: "comm-2", actorId: "user-1", confirmationId: "conf-2", to: "+2348012345678", templateName: "hello_world", templateLanguage: "en_US", body: "", key: "contract-key", now: new Date("2026-10-14T12:00:00.000Z") });
assert.equal(tplVector.signature, "6b827a44ad27b83ce00fb102feec0c7d37a0190383a42b2b400ddbf4528c8ff6");

// staff-confirmed: only a conversation record that required confirmation, carries a recorded confirmation id and a staff actor
posted.length = 0; await adapter.send(record({}));
assert.equal(posted[0].body.send_origin, "staff_confirmed"); assert.equal(posted[0].body.staff_confirmation.confirmed_by, "user-1"); assert.equal(posted[0].body.staff_confirmation.confirmation_id, "conf-1");
assert.match(posted[0].body.staff_confirmation.signature, /^[0-9a-f]{64}$/);
// template send is attested over the template, not a body
posted.length = 0; await adapter.send(record({ template_id: "hello_world@en_US", body: "" }));
assert.equal(posted[0].body.send_origin, "staff_confirmed"); assert.equal(posted[0].body.template_name, "hello_world"); assert.ok(posted[0].body.staff_confirmation);

// everything else is autonomous and carries NO attestation: goals, automations, tasks, workflows, and conversation records lacking confirmation evidence
const autonomous = [
  ["goal (automation source)", record({ source: "automation", source_record_type: "goal", governance: { requires_confirmation: false, confirmation_id: null } })],
  ["automation action", record({ source: "automation", governance: { requires_confirmation: false, confirmation_id: null } })],
  ["task", record({ source: "task" })], ["workflow", record({ source: "workflow" })],
  ["conversation record never confirmed (no confirmation id)", record({ governance: { requires_confirmation: true, confirmation_id: null } })],
  ["conversation record that skipped confirmation (pre-authorized)", record({ governance: { requires_confirmation: false, confirmation_id: null } })],
  ["conversation record with no staff actor", record({ actor_id: null })],
];
for (const [name, rec] of autonomous) {
  posted.length = 0; const result = await adapter.send(rec);
  assert.equal(result.status, "sent", name);
  assert.equal(posted[0].body.send_origin, "autonomous", name); assert.equal(posted[0].body.staff_confirmation, undefined, `${name}: no attestation`);
}
console.log(JSON.stringify({ status: "PASS", suite: "whatsapp-send-origin" }));
