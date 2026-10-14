import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
process.env.OFFICE_SYNC_API_KEY ||= "smoke-key";
process.env.OFFICE_APP_URL = "http://office.invalid";
const axios = require("axios");
const posted = [];
axios.post = async (url, body) => { posted.push({ url, body }); return { status: 200, data: { delivered: true, external_message_id: "wamid.x", response_code: 200 } }; };
const { WhatsAppAdapter } = await import("../dist/services/communicationRuntime/adapters/WhatsAppAdapter.js");
const adapter = new WhatsAppAdapter();
const base = { communication_id: "c1", body: "hi", template_id: null, reply_to_message_id: null, recipient: { whatsapp_phone: "+2348012345678", phone: null, lead_id: "lead-1" } };
for (const [source, expected] of [["conversation", "staff_confirmed"], ["automation", "autonomous"], ["task", "autonomous"], ["workflow", "autonomous"]]) {
  posted.length = 0;
  const result = await adapter.send({ ...base, source });
  assert.equal(result.status, "sent");
  assert.equal(posted[0].body.send_origin, expected, `${source} -> ${expected}`);
}
posted.length = 0;
await adapter.send({ ...base, source: "automation", template_id: "hello_world@en_US", body: "" });
assert.equal(posted[0].body.send_origin, "autonomous"); assert.equal(posted[0].body.template_name, "hello_world");
console.log(JSON.stringify({ status: "PASS", suite: "whatsapp-send-origin" }));
