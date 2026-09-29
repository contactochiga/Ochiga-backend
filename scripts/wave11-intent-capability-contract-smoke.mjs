import assert from "node:assert/strict";
import { createRequire } from "node:module";

// This runs the production parser and registered capability predicates.  It
// deliberately does not call a database, provider, or action handler.
const require = createRequire(import.meta.url);
process.env.SUPABASE_URL = "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "wave11-contract-no-network";
const queueModule = require.resolve("bullmq");
require.cache[queueModule] = { id: queueModule, filename: queueModule, loaded: true, exports: { Queue: class {}, Worker: class {} } };
const redisModule = require.resolve("ioredis");
class NoNetworkRedis {
  on() { return this; }
  quit() { return Promise.resolve(); }
  disconnect() {}
}
NoNetworkRedis.default = NoNetworkRedis;
NoNetworkRedis.Redis = NoNetworkRedis;
require.cache[redisModule] = { id: redisModule, filename: redisModule, loaded: true, exports: NoNetworkRedis };
const { supabaseAdmin } = require("../dist/supabase/supabaseClient.js");
supabaseAdmin.from = () => { throw new Error("intent-capability contract must not read DB"); };
supabaseAdmin.rpc = () => { throw new Error("intent-capability contract must not call RPC"); };
const { ensureRegistered } = require("../dist/oyi-core/orchestration/ConversationOrchestrator.js");
const { capabilityRegistry } = require("../dist/oyi-core/capabilities/CapabilityRegistry.js");
const { capabilityService } = require("../dist/oyi-core/capabilities/CapabilityService.js");
const { parseSemanticFrame } = require("../dist/oyi-core/interpretation/SemanticFrameParser.js");
const { parseCommunicationSendIntent } = require("../dist/oyi-core/interpretation/communicationIntentParser.js");
const { parseDomainSwitchIntent } = require("../dist/oyi-core/interpretation/followUpResolver.js");

assert.equal(parseCommunicationSendIntent("Tell me about the second one."), null, "a CRM detail request must not propose a communication");
assert.ok(parseCommunicationSendIntent("Tell Ada that I will call."), "an explicit communication request remains recognized");
assert.deepEqual(parseDomainSwitchIntent("Go back to devices."), { type: "switch", domain: "devices" });
assert.equal(parseSemanticFrame("Turn the second device off.").operation, "device.power.off");

ensureRegistered();

const fixtures = [
  ["home_summary", "What's happening at home?", "home", "summarize", "home.summary.read"],
  ["home_attention", "Anything wrong at home?", "home", "inform", "home.attention.read"],
  ["home_activity", "What happened at home overnight?", "home", "inform", "home.activity.read"],
  ["room_status", "How is the kitchen?", "rooms", "inspect", "room.status.read"],
  ["room_attention", "Anything wrong in the kitchen?", "rooms", "inform", "room.attention.read"],
  ["room_activity", "What changed in the kitchen?", "rooms", "inform", "room.activity.read"],
  ["rooms_inventory", "Show my rooms", "rooms", "list", "rooms.inventory.read"],
  ["device_status", "Is the bedroom light on?", "devices", "device.status", "devices.status.read"],
  ["device_availability", "Which devices are offline?", "devices", "device.availability", "devices.availability.read"],
  ["device_activity", "Show device activity", "devices", "device.activity", "devices.activity.read"],
  ["device_failures", "Show device failures", "devices", "device.failures", "devices.failures.read"],
  ["device_diagnosis", "Why is the AC not working?", "devices", "device.diagnosis", "devices.diagnosis.read"],
  ["device_relationships", "What controls this light?", "devices", "inform", "devices.relationships.read"],
  ["wallet_history", "Show wallet history", "wallet", "wallet.history", "wallet.transactions.read"],
  ["wallet_balance", "What is my wallet balance?", "wallet", "inspect", "wallet.balance.read"],
  ["utilities_spending", "How much have I spent on electricity?", "utilities", "utilities.spending", "utilities.spending.read"],
  ["utilities_active", "Which utilities are active?", "utilities", "utilities.active", "utilities.active.read"],
  ["utilities_usage_declared", "What electricity have I used?", "utilities", "utilities.usage", "utilities.usage.read", "declared_disabled"],
  ["maintenance", "Show maintenance requests", "maintenance", "list", "maintenance.requests.read"],
  ["visitors", "Show pending visitors", "visitors", "list", "visitors.pending.read"],
  ["security", "Show security incidents", "security", "list", "security.incidents.read"],
  ["community", "Show community posts", "community", "list", "community.latest.read"],
  ["automations", "Show automations", "automations", "list", "automations.list.read"],
  ["reports_declared", "Show an operational report", "reports", "list", "reports.period_summary.read", "declared_disabled"],
  ["office_leads", "Show today's leads", "crm", "list", "crm.leads.read"],
  ["office_opportunities", "Show opportunities that need attention", "crm", "list", "crm.opportunities.read"],
  ["office_financial", "What is our financial position?", "office_financial", "inspect", "financial.summary.read"],
  ["office_tasks", "Show overdue tasks", "office_tasks", "list", "office_tasks.query.read"],
  ["office_meetings", "Show meetings", "office_meetings", "list", "office_meetings.query.read"],
  ["office_documents", "Show documents", "office_documents", "list", "office_documents.query.read"],
  ["public_company", "What does Ochiga do?", "corporate_company", "inform", "corporate.company.read"],
  ["public_oyi", "What is Oyi?", "corporate_oyi", "inspect", "corporate.oyi.read"],
  ["public_development", "Tell me about your developments", "corporate_development", "inform", "corporate.development.read"],
  ["public_partnership", "How can I partner with Ochiga?", "corporate_partnerships", "inform", "corporate.partnerships.read"],
];

const outcomes = [];
for (const [id, prompt, domain, operation, capabilityKey, expected = "matched"] of fixtures) {
  const frame = parseSemanticFrame(prompt);
  assert.equal(frame.domain, domain, `${id}: parser domain drift`);
  assert.equal(frame.operation, operation, `${id}: parser operation drift`);
  const matches = capabilityRegistry.all().filter((capability) => capability.supports(frame));
  const capability = matches.find((item) => item.key === capabilityKey);
  assert.ok(capability, `${id}: no governed capability predicate matches ${domain}/${operation}; matches=${matches.map((item) => item.key).join(",") || "none"}`);
  assert.equal(expected === "declared_disabled" ? capability.rolloutStatus !== "enabled" : capability.rolloutStatus === "enabled", true, `${id}: rollout contract drift`);
  outcomes.push({ id, prompt, domain, operation, mutation_intent: frame.mutationIntent, expected, capability_key: capability.key, matching_keys: matches.map((item) => item.key) });
}

assert.ok(outcomes.length >= 30, "coverage matrix must retain at least 30 distinct parser/capability classes");
assert.ok(outcomes.some((item) => item.id === "home_summary" && item.capability_key === "home.summary.read"));
// Facility estate-scoped overview/camera selection must never resolve to
// Consumer Home authority, and Consumer Home selection must be unaffected.
for (const [surface, prompt, expectedKey] of [
  ["facility", "What's happening across the estate?", "facility.overview.read"],
  ["facility", "What needs attention?", "facility.overview.read"],
  ["facility", "Anything wrong?", "facility.overview.read"],
  ["facility", "Anything I should deal with immediately?", "facility.overview.read"],
  ["facility", "Show offline cameras.", "facility.cameras.read"],
  ["consumer", "What's happening at home?", "home.summary.read"],
  ["office_internal", "What is our development status?", "development.status.read"],
  ["public_corporate", "What does Ochiga do?", "corporate.company.read"],
]) {
  const frame = parseSemanticFrame(prompt);
  const actor = { id: "wave11-contract-actor", role: surface === "facility" ? "facility_manager" : surface === "consumer" ? "resident" : "admin", permissions: ["maintenance.read", "security.read", "homes.read", "development.manage"], permission_scopes: ["maintenance.read", "security.read", "homes.read", "development.manage"], estate_id: "wave11-estate", home_id: surface === "consumer" ? "wave11-home" : null };
  const selection = capabilityService.resolve({ actor, oisContext: { actor_id: actor.id, role: actor.role, surface, estate_id: actor.estate_id, home_id: actor.home_id }, input: { message: prompt, surface, estate_id: actor.estate_id, home_id: actor.home_id }, resolvedTurn: { request_id: `wave11-collision-${surface}`, semantic_frame: frame, target: null } });
  assert.equal(selection.matched_capability?.key, expectedKey, `${surface}: surface/scope collision for ${prompt}`);
}
if (process.argv.includes("--json")) console.log(JSON.stringify(outcomes, null, 2));
else console.log(`PASS Wave 11 semantic-to-capability contract: ${outcomes.length} parser classes; explicit matched/declared-disabled outcomes; no DB/provider/action calls`);
process.exit(0);
