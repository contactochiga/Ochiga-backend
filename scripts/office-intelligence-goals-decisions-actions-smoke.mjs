// Intelligence System Visibility, Slice 4 -- Goals & Decisions and
// Actions & Workflows. Same two-part convention as Slice 1/2/3's own
// smokes: static guards, then a real live HTTP integration test against
// the isolated Wave 11 fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import express from "express";

// ---------------------------------------------------------------------
// Part 1 -- static guards over the route source + presentation module.
// ---------------------------------------------------------------------
const routeSrc = fs.readFileSync("src/routes/officeExport.ts", "utf8");
const actionViewSrc = fs.readFileSync("src/oyi-core/presentation/actionWorkflowView.ts", "utf8");

for (const path of [
  '"/intelligence/goals"', '"/intelligence/goals/:id"',
  '"/intelligence/decisions"', '"/intelligence/decisions/:id"',
  '"/intelligence/actions"', '"/intelligence/actions/:id"',
]) {
  const re = new RegExp(`router\\.get\\(${path},\\s*requireOfficeExportKey`);
  assert.match(routeSrc, re, `route ${path} must reuse the existing Office export auth boundary`);
}

// Redaction guards -- the safe-projection function bodies must never
// reference a known-dangerous raw field. Comments are stripped first so
// this checks only real code, not this file's own safety documentation
// (which deliberately names the excluded fields in prose).
function stripLineCommentsEarly(src) {
  return src.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}
const goalProjectionBody = stripLineCommentsEarly(routeSrc.slice(routeSrc.indexOf("function safeGoalProjection"), routeSrc.indexOf("router.get(\"/intelligence/goals\"")));
for (const dangerous of ["target_entities.name", "target_entities.email", "target_entities.phone", "whatsapp_phone", ".body", "estate_id:", "home_id:", "device_id:"]) {
  assert.doesNotMatch(goalProjectionBody, new RegExp(dangerous.replace(/[.]/g, "\\.")), `goal projection must never forward "${dangerous}"`);
}
function stripLineComments(src) {
  return src.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}
const commDetailBody = stripLineComments(routeSrc.slice(routeSrc.indexOf("function safeCommunicationActionDetail"), routeSrc.indexOf("function safeFacilityAutomationActionDetail")));
for (const dangerous of ["subject", "body", "plain_text", "html", "recipient"]) {
  assert.doesNotMatch(commDetailBody, new RegExp(`\\b${dangerous}\\b`), `communication action detail must never forward "${dangerous}"`);
}
const deviceDetailBody = stripLineComments(routeSrc.slice(routeSrc.indexOf("function safeDeviceCommandActionDetail"), routeSrc.indexOf("function safeCommunicationActionDetail")));
for (const dangerous of ["home_id", "room_id", "canonical_device_id", "actor_id", "expected_state", "observed_state", "previous_state"]) {
  assert.doesNotMatch(deviceDetailBody, new RegExp(`\\b${dangerous}\\b:`), `device command detail must never forward raw "${dangerous}"`);
}
for (const truthField of ["request_status", "dispatch_status", "provider_status", "confirmation_status", "physical_effect_status", "final_status", "truth_state"]) {
  assert.match(deviceDetailBody, new RegExp(truthField), `device command truth detail must expose "${truthField}" (Section 10's explicit truth-model field list)`);
}

assert.match(routeSrc, /loadPlatformActionAggregate/, "actions route must reuse the cross-source aggregation, not a new attention engine");
assert.match(actionViewSrc, /officeActionProposal\.ts.*same reason conversation_proposal/s, "Office governed action proposal exclusion must be documented");
assert.match(actionViewSrc, /Goal plan-step dispatch -- represented within Goals/, "goal plan-step dispatch's non-duplication must be documented");
console.log("PASS static guards: auth reuse, redaction (goals/communication/device), truth-model fields present, exclusions documented");

// ---------------------------------------------------------------------
// Part 1b -- lifecycle normalization: every mapping function must be
// total over its own source's real status vocabulary (no silent
// undefined -- verified by calling each with every real literal).
// Requires SUPABASE_URL/SERVICE_ROLE_KEY set first -- the compiled
// module transitively imports supabaseAdmin (via communicationRuntime/
// deviceCommandExecutionStore/facilityAutomationService/WorkflowRepository),
// which throws at import time if unset.
// ---------------------------------------------------------------------
if (!process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required for this local Supabase smoke test");
}
process.env.SUPABASE_URL = "http://127.0.0.1:55421";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
{
  const require = createRequire(import.meta.url);
  const mod = require("../dist/oyi-core/presentation/actionWorkflowView.js");
  const VALID_STAGES = new Set(["proposed", "waiting_confirmation", "confirmed", "executing", "executed", "verified", "cancelled", "failed", "timed_out"]);

  const COMMUNICATION_STATUSES = ["draft", "awaiting_confirmation", "confirmed", "queued", "sending", "sent", "delivered", "read", "failed", "cancelled", "expired"];
  for (const s of COMMUNICATION_STATUSES) assert.ok(VALID_STAGES.has(mod.communicationStage(s)), `communicationStage("${s}") must resolve to a real stage`);

  const DEVICE_STATUSES = ["requested", "validated", "accepted_for_processing", "dispatching", "provider_accepted", "awaiting_state_confirmation", "state_confirmed", "state_mismatch", "confirmation_timed_out", "provider_rejected", "failed", "cancelled"];
  for (const s of DEVICE_STATUSES) assert.ok(VALID_STAGES.has(mod.deviceCommandStage(s)), `deviceCommandStage("${s}") must resolve to a real stage`);
  assert.equal(mod.deviceCommandStage("state_confirmed"), "verified", "state_confirmed is the ONLY device status honestly mapping to verified");
  assert.notEqual(mod.deviceCommandStage("provider_accepted"), "verified", "provider_accepted must NOT be presented as verified -- Section 10's own explicit warning");
  assert.equal(mod.deviceCommandStage("state_mismatch"), "failed", "a contradicted physical state must present as failed, never success");

  const FACILITY_STATUSES = ["pending_approval", "executing", "succeeded", "verification_failed", "failed", "rejected", "expired"];
  for (const s of FACILITY_STATUSES) assert.ok(VALID_STAGES.has(mod.facilityAutomationStage(s)), `facilityAutomationStage("${s}") must resolve to a real stage`);

  const WORKFLOW_STATUSES = ["collecting_inputs", "awaiting_clarification", "ready_for_review", "awaiting_approval", "approved", "executing", "verifying", "answered", "empty", "unavailable", "unsupported", "permission_restricted", "completed", "failed", "cancelled", "expired", "superseded"];
  for (const s of WORKFLOW_STATUSES) assert.ok(VALID_STAGES.has(mod.conversationWorkflowStage(s)), `conversationWorkflowStage("${s}") must resolve to a real stage`);

  console.log("PASS lifecycle normalization: all four source vocabularies map totally to real presentation stages; device-command-truth (state_confirmed-only-verified, provider_accepted != verified, state_mismatch -> failed) confirmed");
}

// ---------------------------------------------------------------------
// Part 2 -- live HTTP integration test against the compiled route,
// isolated Wave 11 fixture only.
// ---------------------------------------------------------------------
const FIXTURE_URL = "http://127.0.0.1:55421";
if (!process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required for this local Supabase smoke test");
}
process.env.SUPABASE_URL = FIXTURE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.OFFICE_SYNC_API_KEY = "wave11-intelligence-slice4-smoke-test-key";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

{
  const { execSync } = await import("node:child_process");
  try { execSync("docker rm -f oyi-intelligence-slice1-redis", { stdio: "ignore" }); } catch { /* fine if it didn't exist */ }
  execSync("docker run -d --rm --name oyi-intelligence-slice1-redis -p 6379:6379 redis:7-alpine", { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 800));
}

const require = createRequire(import.meta.url);
const queueModule = require.resolve("bullmq");
require.cache[queueModule] = { id: queueModule, filename: queueModule, loaded: true, exports: { Queue: class {}, Worker: class {} } };
const redisModule = require.resolve("ioredis");
class NoNetworkRedis { on() { return this; } quit() { return Promise.resolve(); } disconnect() {} }
NoNetworkRedis.default = NoNetworkRedis;
NoNetworkRedis.Redis = NoNetworkRedis;
require.cache[redisModule] = { id: redisModule, filename: redisModule, loaded: true, exports: NoNetworkRedis };

const officeExportModule = require("../dist/routes/officeExport.js");
const officeExportRouter = officeExportModule.default;
const app = express();
app.use(express.json());
app.use("/office", officeExportRouter);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;

function request(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: body ? JSON.parse(body) : null });
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", reject);
  });
}

const AUTH = { "x-api-key": "wave11-intelligence-slice4-smoke-test-key" };

try {
  // --- auth gate ---
  for (const path of ["/office/intelligence/goals", "/office/intelligence/decisions", "/office/intelligence/actions"]) {
    const noAuth = await request(path);
    assert.equal(noAuth.status, 401, `${path} must reject a request with no credential`);
  }

  // --- goals contract ---
  const goals = await request("/office/intelligence/goals", AUTH);
  assert.equal(goals.status, 200);
  assert.equal(goals.json.ok, true);
  assert.ok(Array.isArray(goals.json.goals), "goals must be a real array");
  for (const g of goals.json.goals) {
    assert.ok(typeof g.needs_human === "boolean");
    assert.ok(typeof g.blocked_or_waiting === "boolean");
    assert.ok(g.lineage && "canonical_signal_key" in g.lineage);
    assert.ok(!("target_entities" in g), "goal projection must never forward the raw target_entities object");
    assert.ok(!("plan" in g), "goal LIST projection must not include full plan detail (list vs detail distinction)");
  }
  console.log(`PASS goals contract: ${goals.json.goals.length} live goals, needs_human/blocked_or_waiting/lineage present, no raw target_entities`);

  if (goals.json.goals.length) {
    const firstGoalId = goals.json.goals[0].id;
    const goalDetail = await request(`/office/intelligence/goals/${encodeURIComponent(firstGoalId)}`, AUTH);
    assert.equal(goalDetail.status, 200);
    assert.equal(goalDetail.json.goal.id, firstGoalId);
    assert.ok(Array.isArray(goalDetail.json.goal.plan), "goal DETAIL must include plan steps");
    for (const step of goalDetail.json.goal.plan) {
      assert.ok(!("body" in step), "goal plan step detail must never forward message body content");
      assert.ok(!("device_command" in step), "goal plan step detail must never forward the raw device command payload");
    }
    for (const entry of goalDetail.json.goal.execution_history) {
      assert.ok(!("detail" in entry), "goal execution history detail must never forward free-text detail (may echo reply content)");
    }
    console.log(`PASS goal detail: ${firstGoalId}, plan steps redacted (no body/device_command), execution history redacted (no detail)`);
  }
  const missingGoal = await request("/office/intelligence/goals/00000000-0000-4000-8000-000000000000", AUTH);
  assert.equal(missingGoal.status, 404, "an unknown goal id must 404, not silently return an empty object");

  // --- decisions contract ---
  const decisions = await request("/office/intelligence/decisions", AUTH);
  assert.equal(decisions.status, 200);
  assert.ok(Array.isArray(decisions.json.decisions));
  for (const d of decisions.json.decisions) {
    assert.ok(["deterministic_policy", "human_selection"].includes(d.authority_mode), "authority_mode must be a real DecisionAuthorityMode literal");
    assert.ok(d.lineage && "recommendation_key" in d.lineage && "goal_id" in d.lineage && "incident_id" in d.lineage && "awareness_key" in d.lineage);
    assert.ok(!("metadata" in d), "decision projection must never forward the arbitrary metadata blob");
  }
  console.log(`PASS decisions contract: ${decisions.json.decisions.length} live decisions, full lineage present, authority_mode is a real canonical literal, no metadata leak`);

  // --- actions/workflows contract ---
  const actions = await request("/office/intelligence/actions", AUTH);
  assert.equal(actions.status, 200);
  assert.ok(Array.isArray(actions.json.sources) && actions.json.sources.length === 4, "actions aggregate must query exactly 4 sources (Office action proposals + goal plan-step dispatch are documented exclusions)");
  assert.deepEqual(actions.json.sources.map((s) => s.source_type).sort(), ["communication", "conversation_workflow", "device_command", "facility_automation"]);
  assert.ok(typeof actions.json.complete === "boolean");
  for (const item of actions.json.actions) {
    assert.ok(["communication", "device_command", "facility_automation", "conversation_workflow"].includes(item.source_type));
    assert.ok(["proposed", "waiting_confirmation", "confirmed", "executing", "executed", "verified", "cancelled", "failed", "timed_out"].includes(item.presentation_stage));
    assert.ok(typeof item.canonical_status === "string" && item.canonical_status.length > 0, "canonical_status must be preserved verbatim alongside presentation_stage -- Section 9's own explicit requirement");
  }
  console.log(`PASS actions/workflows contract: ${actions.json.actions.length} live items across exactly 4 sources, canonical_status preserved alongside presentation_stage`);

  const rawActionsBody = JSON.stringify(actions.json);
  for (const dangerous of ["subject", "plain_text", "recipient", "/Users/", "SUPABASE", "whatsapp_phone"]) {
    assert.ok(!rawActionsBody.includes(dangerous), `actions response must never leak "${dangerous}"`);
  }

  if (actions.json.actions.length) {
    const firstAction = actions.json.actions[0];
    const detail = await request(`/office/intelligence/actions/${encodeURIComponent(firstAction.id)}`, AUTH);
    assert.equal(detail.status, 200, `detail lookup for a live action id (${firstAction.id}) must succeed`);
    assert.equal(detail.json.action.source_type, firstAction.source_type);
    if (firstAction.source_type === "device_command") {
      assert.ok("truth" in detail.json.action, "device_command detail must carry the full truth sub-object");
      assert.ok(!("home_id" in detail.json.action) && !("canonical_device_id" in detail.json.action), "device_command detail must never forward home_id/canonical_device_id");
    }
    console.log(`PASS action detail: ${firstAction.id} resolves correctly through per-source-type dispatch`);
  }
  const unknownSourceType = await request("/office/intelligence/actions/not_a_real_source%3Aabc", AUTH);
  assert.equal(unknownSourceType.status, 404, "an unrecognized action source_type must 404, not silently succeed");

  // --- privacy/redaction (whole-payload scan) ---
  const rawGoalsBody = JSON.stringify(goals.json);
  const rawDecisionsBody = JSON.stringify(decisions.json);
  for (const dangerous of ["/Users/", "SUPABASE", "whatsapp_phone"]) {
    assert.ok(!rawGoalsBody.includes(dangerous), `goals response must never leak "${dangerous}"`);
    assert.ok(!rawDecisionsBody.includes(dangerous), `decisions response must never leak "${dangerous}"`);
  }
  console.log("PASS privacy/redaction: no PII/path/credential leakage across goals, decisions, actions");

  // --- partial-source-failure: queue down must not affect these routes
  // at all (none of them have a Redis/queue dependency) ---
  const { execSync } = await import("node:child_process");
  try { execSync("docker rm -f oyi-intelligence-slice1-redis", { stdio: "ignore" }); } catch { /* fine */ }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const goalsStillOk = await request("/office/intelligence/goals", AUTH);
  const actionsStillOk = await request("/office/intelligence/actions", AUTH);
  assert.equal(goalsStillOk.status, 200, "goals route has no queue/redis dependency");
  assert.equal(actionsStillOk.status, 200, "actions route has no queue/redis dependency");
  console.log("PASS partial-source-failure: goals/actions routes unaffected by queue outage");
  try { execSync("docker run -d --rm --name oyi-intelligence-slice1-redis -p 6379:6379 redis:7-alpine", { stdio: "ignore" }); } catch { /* best-effort cleanup only */ }
} finally {
  server.close();
}
