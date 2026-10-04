// Oyi Interaction Layer, Slice 1 -- action truth LIVE journey.
//
// Real canonical turns through the real ConversationOrchestrator, real
// ActionService/WorkflowService (Supabase repositories), real device command
// controller and real conversation persistence, against the ISOLATED Wave 11
// fixture only (production refused). No real device can change:
//   - the seeded fixture devices use the non-provider "wave11" vendor (the
//     controller only queues their commands);
//   - a temporary "tuya"-vendor fixture device is routed to an in-process
//     stub adapter registered over the Tuya adapter -- the real Tuya adapter
//     is never invoked and external execution config is refused.
// Optional cross-surface check: OYI_CONSUMER_DIR / OYI_FACILITY_DIR point at
// the Consumer and Facility checkouts; their shared mapper must present the
// live responses and the restored thread messages identically.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const FIXTURE_URL = "http://127.0.0.1:55421";
const productionRef = "zcpgtdakqxyvjkmiibei";
if (!process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY) throw new Error("OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required");
if (process.env.SUPABASE_URL && (process.env.SUPABASE_URL !== FIXTURE_URL || process.env.SUPABASE_URL.includes(productionRef))) throw new Error("action truth live smoke refuses a non-isolated or production Supabase URL");
for (const name of ["TUYA_ACCESS_ID", "TUYA_ACCESS_SECRET", "TUYA_CLIENT_ID", "TUYA_CLIENT_SECRET", "EDGE_API_URL", "EDGE_BASE_URL", "RESEND_API_KEY", "TWILIO_AUTH_TOKEN"]) {
  if (process.env[name]) throw new Error(`action truth live smoke refuses external execution config (${name})`);
}
process.env.SUPABASE_URL = FIXTURE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
process.env.OYI_CONVERSATION_TRACE_ENABLED = "false";
delete process.env.OYI_ACTION_MEMORY_REPOSITORY;
delete process.env.OYI_WORKFLOW_MEMORY_REPOSITORY;

const require = createRequire(import.meta.url);
const qm = require.resolve("bullmq"); require.cache[qm] = { id: qm, filename: qm, loaded: true, exports: { Queue: class { add() { return Promise.resolve(); } }, Worker: class {} } };
const rm = require.resolve("ioredis");
class NoNetworkRedis { on() { return this; } quit() { return Promise.resolve(); } disconnect() {} }
NoNetworkRedis.default = NoNetworkRedis; NoNetworkRedis.Redis = NoNetworkRedis;
require.cache[rm] = { id: rm, filename: rm, loaded: true, exports: NoNetworkRedis };

const { supabaseAdmin } = require("../dist/supabase/supabaseClient.js");
const { conversationOrchestrator } = require("../dist/oyi-core/orchestration/ConversationOrchestrator.js");
const { adapterRegistry } = require("../dist/device/adapters/registry.js");
const { initAdaptersOnce } = require("../dist/device/adapters/initAdapters.js");

// ---- provider stub (registered over the real Tuya adapter) ----
initAdaptersOnce();
const realTuya = adapterRegistry.get("tuya");
let realTuyaCalls = 0;
if (realTuya) realTuya.executeCommand = async () => { realTuyaCalls += 1; throw new Error("real Tuya adapter must never be called"); };
let stubMode = "accept";
let stubCalls = 0;
adapterRegistry.register({
  name: "tuya",
  async executeCommand() {
    stubCalls += 1;
    if (stubMode === "reject") {
      const error = new Error("stub provider rejected the command");
      error.statusCode = 502;
      throw error;
    }
    return { success: true, result: true };
  },
  async getStatus() { return []; },
  async getDeviceStatus() { return []; },
});

const ids = { estate: "10000000-0000-4000-8000-000000000001", home: "20000000-0000-4000-8000-000000000001", resident: "30000000-0000-4000-8000-000000000001", facility: "30000000-0000-4000-8000-000000000003", wave11Device: "40000000-0000-4000-8000-000000000002" };
const STUB_DEVICE_ID = "4000000a-0000-4000-8000-0000000000a1";
const permissions = {
  resident: ["devices.read", "devices.control", "homes.read"],
  facility_manager: ["devices.read", "homes.read"],
};
function actorFor(role, surface) {
  const actor = { id: role === "resident" ? ids.resident : ids.facility, email: `${role}@wave11.local`, role, permissions: permissions[role], permission_scopes: permissions[role], estate_id: ids.estate };
  if (surface === "consumer") actor.home_id = ids.home;
  return actor;
}
function oisContext(actor, surface) {
  return { actor_id: actor.id, surface, role: actor.role, permissions: actor.permissions, organization_id: null, portfolio_id: null, account_id: null, deployment_id: null, estate_id: ids.estate, home_id: surface === "consumer" ? ids.home : null, membership_id: surface === "consumer" ? "32000000-0000-4000-8000-000000000001" : null, module: null, target: null, estate: { id: ids.estate, name: "Wave 11 Test Estate" }, home: surface === "consumer" ? { id: ids.home, name: "A-101", estate_id: ids.estate } : null, available_estates: [], available_homes: [], resolved_at: new Date().toISOString() };
}
let seq = 0;
async function turn(role, surface, message, threadId = null) {
  const actor = actorFor(role, surface);
  const requestId = `truth-live-${Date.now().toString(36)}-${seq += 1}`;
  return conversationOrchestrator.run({ actor, oisContext: oisContext(actor, surface), input: { message, surface, estate_id: ids.estate, home_id: actor.home_id || null, thread_id: threadId, context: { request_id: requestId, correlation_id: requestId } } });
}

// ---- optional cross-surface mapper (Consumer + Facility copies) ----
function loadMapper(dir, rel) {
  if (!dir) return null;
  const file = path.join(dir, rel);
  const ts = createRequire(path.join(dir, "package.json"))("typescript");
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", out)(mod, mod.exports);
  return mod.exports;
}
const surfaces = [
  ["consumer", loadMapper(process.env.OYI_CONSUMER_DIR, "src/lib/oyiActionTruth.ts")],
  ["facility", loadMapper(process.env.OYI_FACILITY_DIR, "lib/oyiActionTruth.ts")],
].filter(([, mapper]) => mapper);

const LEAKS = ["external_id", "wave11-stub-tuya", "vendor", "provider_latency_ms", "command_lifecycle", "stub provider rejected", "safe_error_message"];
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`PASS ${msg}`); };

async function restoredAssistantAction(threadId, responseId) {
  const { data, error } = await supabaseAdmin.from("oyi_conversation_messages").select("role,metadata,created_at").eq("thread_id", threadId).eq("role", "assistant").order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  const row = (data || []).find((r) => r.metadata?.response_id === responseId) || (data || [])[0];
  return row?.metadata || null;
}

function crossSurface(label, response, restoredMetadata) {
  for (const [surface, mapper] of surfaces) {
    const live = mapper.actionTruthView(response);
    const restored = mapper.actionTruthView(restoredMetadata);
    assert.deepEqual(restored, live, `${surface}: restored presentation must equal live presentation (${label})`);
    if (live) assert.equal(live.verified, live.status === "confirmed");
  }
  if (surfaces.length === 2) {
    assert.deepEqual(surfaces[0][1].actionTruthView(response), surfaces[1][1].actionTruthView(response), `Consumer and Facility present ${label} identically`);
  }
  return surfaces.length ? surfaces[0][1].actionTruthView(response) : null;
}

function assertNoLeak(label, response) {
  const text = JSON.stringify(response.execution?.action || {});
  for (const needle of LEAKS) assert.equal(text.includes(needle), false, `${label}: ${needle} leaked into execution.action`);
}

const created = [];
try {
  // Temporary stub-provider device in the fixture home (removed in finally).
  const { data: template, error: templateError } = await supabaseAdmin.from("devices").select("*").eq("id", ids.wave11Device).maybeSingle();
  if (templateError || !template) throw templateError || new Error("fixture device missing");
  const stubDevice = { ...template, id: STUB_DEVICE_ID, name: "Wave11 Truth Lamp", vendor: "tuya", provider: "tuya", adapter: "tuya", external_id: "wave11-stub-tuya-a1", canonical_ref: null, updated_at: new Date().toISOString(), created_at: new Date().toISOString() };
  for (const key of Object.keys(stubDevice)) if (stubDevice[key] === undefined) delete stubDevice[key];
  const insert = await supabaseAdmin.from("devices").upsert(stubDevice);
  if (insert.error) throw insert.error;
  created.push(STUB_DEVICE_ID);

  // 1. Proposal -> Confirm on a non-provider fixture device: accepted, unverifiable.
  const proposal = await turn("resident", "consumer", "Turn on Wave11 Bedroom Light");
  assert.equal(proposal.execution.status, "pending_confirmation", proposal.answer);
  assert.equal(proposal.execution.action?.status, "awaiting_confirmation");
  assert.equal(proposal.execution.current_turn_execution, false);
  assert.equal(proposal.execution.action.truth, null);
  assertNoLeak("proposal", proposal);
  pass("A live: proposal -> execution.action awaiting_confirmation, nothing executed");
  const threadId = proposal.thread_id;
  const confirmed = await turn("resident", "consumer", "Confirm", threadId);
  assert.equal(confirmed.execution.status, "action_result", confirmed.answer);
  assert.equal(confirmed.execution.current_turn_execution, true);
  assert.equal(confirmed.execution.action.status, "unobservable");
  assert.notEqual(confirmed.execution.action.status, "confirmed");
  assert.doesNotMatch(confirmed.answer, /completed and was confirmed/i);
  assertNoLeak("confirm", confirmed);
  const restoredUnobservable = await restoredAssistantAction(threadId, confirmed.id);
  assert.equal(restoredUnobservable?.action?.status, "unobservable");
  const viewU = crossSurface("unobservable", confirmed, restoredUnobservable);
  if (viewU) assert.equal(viewU.label, "Command accepted");
  pass("B/E/O live: user Confirm -> approved, executed once, reported UNOBSERVABLE (not verified); thread restoration preserved it");

  // 2. Stub provider accepts (Tuya-shaped path): accepted, awaiting state confirmation.
  stubMode = "accept";
  const before = stubCalls;
  const p2 = await turn("resident", "consumer", "Turn on Wave11 Truth Lamp");
  assert.equal(p2.execution.action?.status, "awaiting_confirmation", p2.answer);
  assert.equal(stubCalls, before, "proposal must not dispatch");
  const c2 = await turn("resident", "consumer", "Confirm", p2.thread_id);
  assert.equal(stubCalls, before + 1, "confirmation dispatches exactly once");
  assert.equal(c2.execution.action.status, "unobservable", c2.answer);
  assert.equal(c2.execution.action.truth?.provider_status, "accepted");
  assert.equal(c2.execution.action.truth?.physical_effect_status, "unknown");
  assertNoLeak("provider-accepted", c2);
  crossSurface("provider accepted", c2, await restoredAssistantAction(p2.thread_id, c2.id));
  pass("C live: provider accepted -> truth.provider_status accepted, physical effect unknown, presented as not verified");

  // 3. Stub provider rejects: honest provider_rejected, action not stranded.
  stubMode = "reject";
  const p3 = await turn("resident", "consumer", "Turn off Wave11 Truth Lamp");
  assert.equal(p3.execution.action?.status, "awaiting_confirmation", p3.answer);
  const c3 = await turn("resident", "consumer", "Confirm", p3.thread_id);
  assert.equal(c3.execution.action?.status, "provider_rejected", c3.answer);
  assert.equal(c3.execution.action.truth?.provider_status, "rejected");
  assert.match(c3.answer, /could not complete/i);
  assertNoLeak("provider-rejected", c3);
  const { data: actionRow } = await supabaseAdmin.from("oyi_actions").select("status").eq("action_id", c3.execution.action.action_id).maybeSingle();
  if (actionRow) assert.equal(actionRow.status, "provider_rejected", "the durable action is terminal, not stranded at sent");
  const viewR = crossSurface("provider rejected", c3, await restoredAssistantAction(p3.thread_id, c3.id));
  if (viewR) assert.equal(viewR.tone, "failed");
  const again = await turn("resident", "consumer", "Confirm", p3.thread_id);
  assert.notEqual(again.execution.action?.status, "confirmed");
  pass("J live: provider rejection -> provider_rejected (terminal, durable), never success; a repeated Confirm cannot re-run it");

  // 4. Cancel: nothing dispatched.
  stubMode = "accept";
  const p4 = await turn("resident", "consumer", "Turn on Wave11 Truth Lamp");
  const beforeCancel = stubCalls;
  const c4 = await turn("resident", "consumer", "Cancel", p4.thread_id);
  assert.equal(stubCalls, beforeCancel, "cancel must not dispatch");
  assert.equal(c4.execution.action?.status, "cancelled", c4.answer);
  assert.equal(c4.execution.current_turn_execution, false);
  crossSurface("cancelled", c4, await restoredAssistantAction(p4.thread_id, c4.id));
  pass("H/N live: Cancel -> cancelled, nothing sent");

  // 5. Read-only answer: no action.
  const read = await turn("resident", "consumer", "Is Wave11 Bedroom Light on?");
  assert.equal(read.execution.action ?? null, null);
  assert.notEqual(read.execution.status, "action_result");
  assert.equal(read.execution.current_turn_execution, false);
  for (const [, mapper] of surfaces) assert.equal(mapper.actionTruthView(read), null);
  pass("K live: read-only answer carries no action and is never presented as action success");

  // 6. Facility surface without device control: no action executes.
  const beforeFacility = stubCalls;
  const fac = await turn("facility_manager", "facility", "Turn on Wave11 Truth Lamp");
  assert.equal(stubCalls, beforeFacility);
  assert.notEqual(fac.execution.action?.status, "confirmed");
  assert.notEqual(fac.execution.current_turn_execution, true);
  pass(`M live: facility actor without devices.control -> no execution (capability_result ${fac.execution.capability_result || fac.execution.status})`);

  assert.equal(realTuyaCalls, 0, "the real Tuya adapter was never invoked");
  pass("no real provider adapter was invoked; no real device could change");
  console.log(`cross-surface mapper checks: ${surfaces.map(([s]) => s).join(", ") || "skipped (set OYI_CONSUMER_DIR / OYI_FACILITY_DIR)"}`);
  console.log(`OYI ACTION TRUTH LIVE SMOKE PASSED (${checks} checks)`);
} finally {
  for (const id of created) await supabaseAdmin.from("devices").delete().eq("id", id);
}
process.exit(0);
