// Intelligence System Visibility, Slice 6 -- Memory & Context + Learning.
// Same convention as Slices 1-5: static guards over source, then live HTTP
// against the compiled routes and the isolated Wave 11 fixture.
//
// The live part seeds uniquely-tagged rows carrying sentinel "private"
// content, asserts the aggregates move by exactly the seeded amounts, then
// proves no sentinel, seeded ID, or caller-supplied type string reaches
// either response. Seeded rows are removed in `finally`.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import express from "express";

const read = (p) => fs.readFileSync(p, "utf8");
const stripComments = (src) => src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
function srcFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? srcFiles(`${dir}/${e.name}`) : e.name.endsWith(".ts") ? [`${dir}/${e.name}`] : []));
}
const ALL_SRC = srcFiles("src").map((path) => ({ path, code: stripComments(read(path)) }));
const callersOf = (fn, exceptPath) => ALL_SRC.filter((f) => f.path !== exceptPath && new RegExp(`\\b${fn}\\(`).test(f.code.replace(new RegExp(`function ${fn}\\(`, "g"), ""))).map((f) => f.path);

const routeSrc = read("src/routes/officeExport.ts");
const memoryViewSrc = read("src/oyi-core/presentation/memoryContextView.ts");
const learningViewSrc = read("src/oyi-core/presentation/learningView.ts");

// ---------------------------------------------------------------------
// Part 1 -- static guards: the wiring the pages claim is the wiring code has.
// ---------------------------------------------------------------------
for (const path of ['"/intelligence/memory-context"', '"/intelligence/learning"']) {
  assert.match(routeSrc, new RegExp(`router\\.get\\(${path},\\s*requireOfficeExportKey`), `${path} must reuse the Office export auth boundary`);
}
assert.doesNotMatch(routeSrc, /router\.(post|put|patch|delete)\("\/intelligence\/(memory|learning)/, "no control endpoints (promote/approve/reset/delete/clear/force-admission)");
console.log("PASS routes: both GET-only behind requireOfficeExportKey; no control endpoints");

// Resident memory write/read paths.
assert.deepEqual(callersOf("writeScopedMemory", "src/intelligence-core/memory.ts"), [], "writeScopedMemory must still have no live caller (page says not_wired)");
assert.deepEqual(callersOf("recordIntelligenceMemory", "src/services/intelligenceMemoryService.ts"), ["src/routes/aiRoutes.ts"], "legacy writer's only caller must be /ai/chat");
assert.match(read("src/app.ts"), /app\.use\("\/ai", aiRateLimit, aiRoutes\);/, "/ai routes must be mounted (legacy writer is live)");
assert.match(read("src/routes/aiRoutes.ts"), /router\.post\("\/chat"[\s\S]*void recordIntelligenceMemory\(/, "/ai/chat must be the route that calls it");
assert.match(read("src/routes/aiRoutes.ts"), /status: runtime\.requiresConfirmation \? "pending_confirmation" : "processed"/, "legacy route never passes an \"executed\" result (so only recent_intelligence_query is written)");
assert.deepEqual(callersOf("loadResidentMemoryContext", "src/oyi-core/context/residentMemoryContext.ts"), ["src/oyi-core/context/governedContextAssembly.ts"], "read path must be wired through governed context assembly");
assert.match(memoryViewSrc, /function_name: "writeScopedMemory",\s*status: "not_wired" as const,\s*live_callers: 0,/);
assert.match(memoryViewSrc, /function_name: "recordIntelligenceMemory",\s*status: "active" as const,\s*live_callers: 1,/);
console.log("PASS resident-memory wiring re-derived: writeScopedMemory 0 callers (not_wired); recordIntelligenceMemory live via mounted /ai/chat (active, no admission); read path wired via governedContextAssembly");

// Learning wiring.
assert.deepEqual(callersOf("promoteLearningParameter", "src/oyi-core/domains/intelligence/learningParameters.ts"), [], "promoteLearningParameter must still have no caller (page says inactive_unwired)");
assert.deepEqual(callersOf("rollbackLearningParameter", "src/oyi-core/domains/intelligence/learningParameters.ts"), [], "rollbackLearningParameter must still have no caller");
assert.deepEqual(callersOf("runLearningProposalPass", "src/oyi-core/domains/intelligence/learningProposalPass.ts"), ["src/oyi-core/runtime/proactiveIntelligenceScheduler.ts"], "proposal pass runs only from the scheduler");
assert.match(read("src/oyi-core/runtime/proactiveIntelligenceScheduler.ts"), /const LEARNING_PROPOSAL_ENABLED = learningProposalPassEnabledInThisProcess\(\);/);
assert.match(read("src/oyi-core/domains/intelligence/learningProposalPass.ts"), /return String\(process\.env\.OYI_LEARNING_PROPOSAL_ENABLED \|\| ""\)\.toLowerCase\(\) === "true";/, "proposal pass is off unless explicitly enabled");
assert.deepEqual(callersOf("startProactiveIntelligenceScheduler", "src/oyi-core/runtime/proactiveIntelligenceScheduler.ts"), ["src/worker.ts"], "scheduler runs in the worker process");
const providersSrc = read("src/oyi-core/domains/intelligence/predictionProviders.ts");
assert.ok(!/model_type: "(?!rule")/.test(providersSrc) && /model_type: "rule"/.test(providersSrc), "all prediction providers are rule-based (no trained model)");
assert.ok(!ALL_SRC.some((f) => /\b(trainModel|fitModel|model\.fit|train\()/.test(f.code)), "no model-training code exists");
assert.match(providersSrc, /if \(parameter\.rollout_stage !== "enabled" \|\|/, "calibration only changes behaviour at rollout_stage enabled");
console.log("PASS learning wiring re-derived: promote/rollback 0 callers; proposal pass scheduler-only and env-gated (default off); worker process; rule-based providers, no training; behaviour change only at enabled");

// Boundary vocabulary is the enforced vocabulary.
const lpSrc = read("src/oyi-core/domains/intelligence/learningParameters.ts");
assert.match(lpSrc, /const FORBIDDEN_NAME_PATTERN = new RegExp\(LEARNING_FORBIDDEN_NAME_TERMS\.join\("\|"\), "i"\);/, "forbidden pattern must be built from the exported list");
assert.match(learningViewSrc, /forbidden_terms: \[\.\.\.LEARNING_FORBIDDEN_NAME_TERMS\]/);
assert.match(learningViewSrc, /allowed_namespaces: \[\.\.\.ALLOWED_NAME_PREFIXES\]/);
console.log("PASS safety-boundary source: displayed namespaces/forbidden terms are the exported enforcement constants");

// TTLs come from canonical constants, never restated.
const descriptorBlock = stripComments(memoryViewSrc.slice(memoryViewSrc.indexOf("export const CONTEXT_TYPE_DESCRIPTORS"), memoryViewSrc.indexOf("export const RESIDENT_MEMORY_WRITE_PATHS")));
const ttlValues = [...descriptorBlock.matchAll(/ttl_ms: ([^,\n]+),/g)].map((m) => m[1].trim());
assert.ok(ttlValues.length === 10 && ttlValues.every((v) => v === "null" || /^[A-Z][A-Z0-9_]*_MS$/.test(v)), `every descriptor ttl_ms must be null or an imported *_MS constant, saw ${ttlValues.join(", ")}`);
for (const c of ["OFFICE_ACTIVE_CONTEXT_TTL_MS", "PUBLIC_OPPORTUNITY_OBJECTIVE_TTL_MS", "COMMUNICATION_DRAFT_TTL_MS", "COMMUNICATION_PROPOSAL_TTL_MS", "PROPOSAL_TTL_MS", "GOAL_PROPOSAL_TTL_MS", "PERSON_CONTEXT_TTL_MS", "LAST_VERIFIED_ACTION_TTL_MS"]) {
  assert.match(memoryViewSrc, new RegExp(`ttl_ms: ${c},`), `${c} must be the descriptor's TTL source`);
}
console.log("PASS TTL structural contract: 8 TTLs sourced from owning modules' exported constants; result sets/workflows declared as non-TTL");

// Vocabulary mirrors.
assert.match(read("src/services/oyiUnifiedIntelligenceService.ts"), /export type OyiSurface = "consumer" \| "facility" \| "office" \| "watch" \| "edge" \| "public_corporate" \| "office_internal";/, "CONVERSATION_SURFACES mirrors OyiSurface");
assert.match(read("src/oyi-core/domains/intelligence/outcomeEvaluation.ts"), /export type EvaluationOutcome = "realized" \| "not_realized" \| "partial" \| "unobservable";/);
assert.match(read("src/oyi-core/domains/devices/deviceOutcomeEvaluator.ts"), /export type DeviceOutcomeResult = "achieved" \| "contradicted" \| "unverified" \| "unsupported";/);
assert.match(read("src/modules/cameras/cameraOutcomeEvaluator.ts"), /export type CameraOutcomeResult = "achieved" \| "contradicted" \| "unverified";/);
assert.match(read("src/services/maintenanceOutcomeEvaluator.ts"), /export type MaintenanceOutcomeResult = "achieved" \| "unverified";/);
assert.match(read("src/services/visitorOutcomeEvaluator.ts"), /export type VisitorOutcomeResult = "achieved" \| "not_achieved" \| "unverified";/);
console.log("PASS vocabulary mirrors: surfaces and all 5 outcome result vocabularies match their source types");

// What the views may select.
const memoryCode = stripComments(memoryViewSrc);
for (const m of memoryCode.matchAll(/\.select\(([^)]*)\)/g)) assert.match(m[1], /^"\*", \{ count: method, head: true \}$/, `memory view may only issue head counts, saw select(${m[1]})`);
const learningCode = stripComments(learningViewSrc);
const learningSelects = [...learningCode.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1]);
assert.deepEqual(learningSelects.sort(), [
  '"*", { count: "exact", head: true }',
  '"id,name,scope_estate_id,scope_home_id,version,current_value,proposed_value,min_bound,max_bound,rollout_stage,evaluation_basis,created_at,updated_at"',
  '"parameter_id,is_rollback"',
].sort(), "learning view selects only head counts plus two fixed column lists");
assert.doesNotMatch(learningCode, /\b(reason|actor_id|object_id)\b[^\n]*select|select[^\n]*\b(reason|actor_id)\b/, "feedback reason/actor never selected");
console.log("PASS query shape: memory view is head-count only; learning view reads only fixed columns (no feedback reason/actor/object id)");

// ---------------------------------------------------------------------
// Part 2 -- live HTTP against the isolated Wave 11 fixture.
// ---------------------------------------------------------------------
const FIXTURE_URL = "http://127.0.0.1:55421";
if (!process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY) throw new Error("OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required for this local Supabase smoke test");
process.env.SUPABASE_URL = FIXTURE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.OFFICE_SYNC_API_KEY = "wave11-intelligence-slice6-smoke-test-key";
process.env.OFFICE_APP_URL = "http://127.0.0.1:9";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const require = createRequire(import.meta.url);
const q = require.resolve("bullmq");
require.cache[q] = { id: q, filename: q, loaded: true, exports: { Queue: class {}, Worker: class {} } };
const r = require.resolve("ioredis");
class NoNetworkRedis { on() { return this; } quit() { return Promise.resolve(); } disconnect() {} }
NoNetworkRedis.default = NoNetworkRedis; NoNetworkRedis.Redis = NoNetworkRedis;
require.cache[r] = { id: r, filename: r, loaded: true, exports: NoNetworkRedis };

const { supabaseAdmin } = require("../dist/supabase/supabaseClient.js");
const router = require("../dist/routes/officeExport.js").default;
const app = express();
app.use("/office", router);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;
const AUTH = { "x-api-key": "wave11-intelligence-slice6-smoke-test-key" };
function get(path, headers = AUTH) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, raw: body, json: body ? JSON.parse(body) : null }));
    }).on("error", reject);
  });
}
const responses = [];
async function intel(path) { const res = await get(path); responses.push(res); return res; }
const ctx = (body, key) => body.context_types.find((t) => t.key === key).active.count;
const fb = (body, key) => body.feedback.canonical.find((c) => c.key === key).count;
const out = (body, key) => body.outcomes.find((o) => o.key === key);

// Seed data: tags + sentinels.
const TAG = `slice6smoke${Date.now()}`;
const S = {
  title: `SENTINEL-THREAD-TITLE-${TAG}`,
  message: `SENTINEL-MESSAGE-BODY-${TAG}`,
  draft: `SENTINEL-DRAFT-BODY-${TAG}`,
  resultRecord: `SENTINEL-RESULT-RECORD-${TAG}`,
  objective: `SENTINEL-OPPORTUNITY-FACT-${TAG}`,
  memory: `SENTINEL-RESIDENT-MEMORY-${TAG}`,
  feedbackReason: `SENTINEL-FEEDBACK-REASON-${TAG}`,
  piiType: `alice.${TAG}@example.com`,
  evidenceNote: `SENTINEL-EVIDENCE-NOTE-${TAG}`,
  token: `sk-SENTINEL-${TAG}`,
};
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const ids = { threadA: randomUUID(), threadB: randomUUID(), fbObjects: [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()], memory: [], params: [] };
let seedUserId = null;
let seedHomeId = null;

async function must(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

try {
  // --- auth gate ---
  for (const p of ["/office/intelligence/memory-context", "/office/intelligence/learning"]) assert.equal((await get(p, {})).status, 401, `${p} must reject no credential`);
  console.log("PASS auth gate: both endpoints 401 without the Office export key");

  const memBefore = (await intel("/office/intelligence/memory-context")).json;
  const learnBefore = (await intel("/office/intelligence/learning")).json;
  assert.equal(memBefore.ok, true); assert.equal(learnBefore.ok, true);
  assert.equal(memBefore.complete, true); assert.equal(learnBefore.complete, true);

  // --- seed ---
  const users = await must(supabaseAdmin.from("users").select("id").limit(1), "users");
  seedUserId = users?.[0]?.id;
  assert.ok(seedUserId, "fixture must have at least one user to own seeded resident memory");
  const homes = await must(supabaseAdmin.from("homes").select("id").limit(1), "homes");
  seedHomeId = homes?.[0]?.id || null;

  await must(supabaseAdmin.from("oyi_conversation_threads").insert([
    {
      id: ids.threadA, user_id: seedUserId, surface: "office_internal", title: S.title, updated_at: iso(now),
      metadata: {
        active_domain: "maintenance",
        result_sets: { maintenance: { result_set_id: TAG, source_message: S.resultRecord, object_refs: [{ label: S.resultRecord }] } },
        business_active_context: { record: S.objective, expires_at: iso(now + 20 * 60000) },
        draft_communication: { body: S.draft, recipient: S.piiType, expires_at: iso(now + 20 * 60000) },
        pending_action_proposal: { summary: S.draft, expires_at: iso(now + 5 * 60000) },
        pending_communication: { body: S.draft, expires_at: iso(now - 60000) }, // already expired: must NOT count
        last_verified_office_action: { summary: S.draft, verified_at: iso(now) },
      },
    },
    {
      id: ids.threadB, user_id: null, surface: "public_corporate", title: S.title, updated_at: iso(now),
      metadata: {
        public_opportunity_objective: { facts: S.objective, updated_at: iso(now) },
        pending_goal: { title: S.objective, expires_at: iso(now + 5 * 60000) },
      },
    },
  ]), "threads");
  await must(supabaseAdmin.from("oyi_conversation_messages").insert({ thread_id: ids.threadA, user_id: seedUserId, role: "user", content: `${S.message} ${S.token}` }), "messages");

  const memRows = await must(supabaseAdmin.from("resident_memory").insert([
    { user_id: seedUserId, home_id: seedHomeId, memory_type: "recent_intelligence_query", memory_key: `${TAG}_a`, memory_value: { prompt: S.memory, last_reply: S.memory }, last_seen_at: iso(now) },
    { user_id: seedUserId, home_id: seedHomeId, memory_type: "favorite_scene", memory_key: `${TAG}_b`, memory_value: { scene_name: S.memory }, last_seen_at: iso(now - 8 * 86400000) },
    { user_id: seedUserId, home_id: seedHomeId, memory_type: `smoke_not_admitted_${TAG}`, memory_key: `${TAG}_c`, memory_value: { note: S.memory }, last_seen_at: iso(now - 40 * 86400000) },
  ]).select("id"), "resident_memory");
  ids.memory = memRows.map((row) => row.id);

  await must(supabaseAdmin.from("intelligence_feedback").insert([
    { object_type: "recommendation", object_id: ids.fbObjects[0], feedback_type: "dismissed", actor_id: seedUserId, reason: S.feedbackReason, outcome_metadata: {} },
    { object_type: "oyi_prediction", object_id: ids.fbObjects[1], feedback_type: "outcome_evaluation", outcome_metadata: { outcome: "realized", notes: S.feedbackReason } },
    { object_type: "oyi_prediction", object_id: ids.fbObjects[2], feedback_type: "outcome_evaluation", outcome_metadata: { outcome: "unobservable" } },
    { object_type: "device_state_outcome", object_id: ids.fbObjects[3], feedback_type: "device_state_outcome_evaluation", reason: S.feedbackReason, outcome_metadata: { result: "achieved" } },
    { object_type: S.piiType, object_id: ids.fbObjects[4], feedback_type: `free text ${S.feedbackReason}`, reason: S.feedbackReason, outcome_metadata: {} },
  ]), "feedback");

  const paramRows = await must(supabaseAdmin.from("oyi_learning_parameters").insert([
    { name: `ranking.${TAG}_weight`, scope_home_id: seedHomeId, version: 2, current_value: 0.5, proposed_value: 0.7, min_bound: 0, max_bound: 1, rollout_stage: "reviewed", evaluation_basis: { method: "empirical_accuracy_calibration", sample_size: 42, accuracy: 0.7, evaluated_at: iso(now), note: S.evidenceNote, actor_email: S.piiType } },
    { name: `anomaly.${TAG}_threshold`, version: 3, current_value: 0.4, proposed_value: null, min_bound: 0, max_bound: 1, rollout_stage: "enabled", evaluation_basis: { method: `free text ${S.evidenceNote}` } },
    { name: `permission.${TAG}_override`, version: 1, current_value: { secret: S.token }, rollout_stage: "observe", evaluation_basis: {} },
  ]).select("id"), "learning params");
  ids.params = paramRows.map((row) => row.id);

  const mem = (await intel("/office/intelligence/memory-context")).json;
  const learn = (await intel("/office/intelligence/learning")).json;

  // --- memory-context aggregate ---
  assert.equal(mem.continuity.active_threads_24h - memBefore.continuity.active_threads_24h, 2);
  assert.equal(mem.continuity.active_threads_7d_by_surface.office_internal - memBefore.continuity.active_threads_7d_by_surface.office_internal, 1);
  assert.equal(mem.continuity.active_threads_7d_by_surface.public_corporate - memBefore.continuity.active_threads_7d_by_surface.public_corporate, 1);
  assert.equal(mem.continuity.totals_count_method, "estimated");
  console.log(`PASS memory-context aggregate: active_threads_24h ${memBefore.continuity.active_threads_24h}->${mem.continuity.active_threads_24h} (+2), by-surface office_internal/public_corporate each +1, totals reported as estimated`);

  // --- context TTL / structural contract ---
  const expectDelta = { result_set: 1, business_active_context: 1, public_opportunity_objective: 1, communication_draft: 1, communication_proposal: 0, action_proposal: 1, goal_proposal: 1, recipient_disambiguation: 0, last_verified_action: 1 };
  for (const [key, delta] of Object.entries(expectDelta)) assert.equal(ctx(mem, key) - ctx(memBefore, key), delta, `context ${key} must move by ${delta}`);
  assert.equal(mem.context_summary.pending_contextual_actions - memBefore.context_summary.pending_contextual_actions, 2, "pending = action + goal (expired communication excluded)");
  const types = Object.fromEntries(mem.context_types.map((t) => [t.key, t]));
  assert.equal(types.business_active_context.ttl_ms, 45 * 60000);
  assert.equal(types.public_opportunity_objective.ttl_ms, 30 * 60000);
  assert.equal(types.communication_draft.ttl_ms, 30 * 60000);
  for (const k of ["communication_proposal", "action_proposal", "goal_proposal", "recipient_disambiguation", "last_verified_action"]) assert.equal(types[k].ttl_ms, 10 * 60000);
  assert.equal(types.result_set.ttl_ms, null); assert.equal(types.result_set.persistence, "thread_scoped");
  assert.equal(types.workflow.ttl_ms, null); assert.equal(types.workflow.persistence, "durable");
  for (const t of mem.context_types) assert.ok(t.purpose && t.expiry_model && t.active_definition, `${t.key} must explain purpose/expiry`);
  console.log("PASS context TTL/structural contract: each type moved by exactly its seeded live instance (expired one excluded); TTLs 45m/30m/30m/10m x5; result sets thread-scoped, workflows durable");

  // --- resident memory status ---
  const rm = mem.resident_memory, rmB = memBefore.resident_memory;
  assert.equal(rm.total_items - rmB.total_items, 3);
  assert.equal(rm.by_admitted_type.recent_intelligence_query - rmB.by_admitted_type.recent_intelligence_query, 1);
  assert.equal(rm.by_admitted_type.favorite_scene - rmB.by_admitted_type.favorite_scene, 1);
  assert.equal(rm.not_admitted_by_read_path - rmB.not_admitted_by_read_path, 1);
  assert.equal(rm.within_retention - rmB.within_retention, 2);
  assert.equal(rm.beyond_retention - rmB.beyond_retention, 1);
  assert.equal(rm.age_by_last_seen.within_24h - rmB.age_by_last_seen.within_24h, 1);
  assert.equal(rm.age_by_last_seen.within_retention_window - rmB.age_by_last_seen.within_retention_window, 1);
  assert.equal(rm.read_path.status, "active");
  assert.deepEqual(rm.write_paths.map((w) => [w.key, w.status, w.live_callers]), [["governed_scoped_admission", "not_wired", 0], ["legacy_chat_compatibility", "active", 1]]);
  assert.equal(rm.admission_status, "ungoverned_legacy_writer_only");
  assert.ok(rm.visibility_classes.every((v) => v.audience === "actor_private" && v.trust === "context_only"), "visibility classes derived from the real read projection");
  assert.equal(rm.retention_ms, 30 * 86400000);
  console.log("PASS resident-memory status: +3 items (2 admitted types +1 each, 1 not admitted), retention/age buckets exact; read active; governed admission not_wired; legacy writer active; all admitted memory actor_private/context_only");

  // --- learning status ---
  const m = learn.mechanisms;
  assert.deepEqual(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.status])), {
    evidence_collection: "active", parameter_proposal: "config_gated", human_promotion: "inactive_unwired", automatic_promotion: "not_implemented", model_training: "not_implemented",
  });
  assert.equal(m.parameter_proposal.enabled_in_this_process, false);
  assert.equal(m.evidence_collection.observed.evidence_rows - learnBefore.mechanisms.evidence_collection.observed.evidence_rows, 5);
  assert.equal(learn.behaviour_change.parameters_changing_behaviour - learnBefore.behaviour_change.parameters_changing_behaviour, 1, "only the enabled-stage parameter changes behaviour");
  assert.equal(learn.parameters.pending_proposals - learnBefore.parameters.pending_proposals, 1);
  assert.equal(learn.parameters.non_conforming_hidden - learnBefore.parameters.non_conforming_hidden, 1, "a forbidden-name row is hidden, only counted");
  assert.equal(fb(learn, "recommendation_dismissed") - fb(learnBefore, "recommendation_dismissed"), 1);
  assert.equal(fb(learn, "prediction_evaluation") - fb(learnBefore, "prediction_evaluation"), 2);
  assert.equal(fb(learn, "device_state_evaluation") - fb(learnBefore, "device_state_evaluation"), 1);
  assert.equal(learn.feedback.other - learnBefore.feedback.other, 1, "a non-canonical caller-supplied pair is counted as other");
  const pred = out(learn, "prediction"), predB = out(learnBefore, "prediction");
  assert.equal(pred.evaluated - predB.evaluated, 2); assert.equal(pred.observable - predB.observable, 1); assert.equal(pred.unobservable - predB.unobservable, 1);
  assert.equal(out(learn, "device_state").results.find((x) => x.value === "achieved").count - out(learnBefore, "device_state").results.find((x) => x.value === "achieved").count, 1);
  console.log(`PASS learning status: evidence active / proposals config_gated (off here) / human promotion inactive_unwired / automatic promotion + training not_implemented; behaviour-changing +1 (enabled only); feedback +5 (dismissal 1, prediction 2, device 1, other 1); outcomes observable/unobservable split exact`);

  // --- learning-parameter redaction ---
  const seededReviewed = learn.parameters.items.find((i) => i.name === `ranking.${TAG}_weight`);
  const seededEnabled = learn.parameters.items.find((i) => i.name === `anomaly.${TAG}_threshold`);
  assert.ok(seededReviewed && seededEnabled);
  assert.ok(!learn.parameters.items.some((i) => i.name.startsWith("permission.")), "forbidden-namespace parameter must never be listed");
  assert.equal(seededReviewed.scope, "scoped", "scope is a label only");
  assert.deepEqual(seededReviewed.evidence, { method: "empirical_accuracy_calibration", sample_size: 42, realized: null, not_realized: null, accuracy: 0.7, evaluated_at: seededReviewed.evidence.evaluated_at });
  assert.equal(seededReviewed.proposed_value, 0.7); assert.equal(seededReviewed.changes_behaviour, false);
  assert.equal(seededEnabled.evidence.method, null, "non-identifier free text in method is dropped");
  assert.equal(seededEnabled.changes_behaviour, true);
  assert.deepEqual(Object.keys(seededReviewed).sort(), ["bounds", "changes_behaviour", "created_at", "evidence", "has_pending_proposal", "name", "namespace", "promotions", "proposed_value", "rollbacks", "rollout_stage", "scope", "current_value", "updated_at", "version"].sort(), "parameter projection is a fixed whitelist");
  console.log("PASS learning-parameter redaction: forbidden-name row hidden; scope IDs reduced to scoped/global; evidence whitelisted to numbers/ISO/identifier method; fixed field set");

  // --- learning safety boundary ---
  const lp = require("../dist/oyi-core/domains/intelligence/learningParameters.js");
  assert.deepEqual(learn.safety_boundary.allowed_namespaces, ["anomaly.", "prediction.", "forecast.", "recommendation.", "ranking.", "notification.cooldown.", "notification.suppression."]);
  assert.deepEqual(learn.safety_boundary.forbidden_terms, [...lp.LEARNING_FORBIDDEN_NAME_TERMS]);
  for (const ns of learn.safety_boundary.allowed_namespaces) assert.doesNotThrow(() => lp.assertLearnableParameter(`${ns}x`), `${ns} must actually be learnable`);
  for (const term of learn.safety_boundary.forbidden_terms) assert.throws(() => lp.assertLearnableParameter(`ranking.${term.replace(/\./g, "_")}`), /forbidden/, `"${term}" must actually be rejected`);
  console.log(`PASS learning safety boundary: ${learn.safety_boundary.allowed_namespaces.length} namespaces accepted and ${learn.safety_boundary.forbidden_terms.length} forbidden terms rejected by the real assertLearnableParameter`);

  // --- memory/learning privacy & redaction (every response so far) ---
  const seededIds = [ids.threadA, ids.threadB, seedUserId, seedHomeId, ...ids.fbObjects, ...ids.memory, ...ids.params].filter(Boolean);
  const forbiddenKeys = new Set(["user_id", "home_id", "estate_id", "thread_id", "actor_id", "owner_id", "memory_value", "memory_key", "content", "reason", "prompt", "last_reply", "body", "recipient", "title_text", "source_message", "object_refs", "outcome_metadata", "scope_home_id", "scope_estate_id", "evaluation_basis"]);
  function walkKeys(value, path = "") {
    if (Array.isArray(value)) return value.forEach((v, i) => walkKeys(v, `${path}[${i}]`));
    if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { assert.ok(!forbiddenKeys.has(k), `forbidden key "${k}" at ${path}`); walkKeys(v, `${path}.${k}`); }
  }
  for (const res of responses) {
    for (const s of Object.values(S)) assert.ok(!res.raw.includes(s), `sentinel leaked: ${s.slice(0, 30)}`);
    for (const id of seededIds) assert.ok(!res.raw.includes(id), "seeded ID leaked");
    for (const bad of ["SUPABASE", "SERVICE_ROLE", "system_prompt", "OFFICE_SYNC_API_KEY", "/Users/", process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY]) assert.ok(!res.raw.includes(bad), "secret/path leaked");
    walkKeys(res.json);
  }
  console.log(`PASS privacy/redaction: ${responses.length} responses carry no conversation/message/draft/result-set/objective/memory/feedback text, no seeded thread/user/home/feedback/memory/parameter IDs, no caller-supplied type strings, no tokens/secrets/prompts, and no identifying keys`);

  // --- partial source failure ---
  const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
  const failing = new Set(["resident_memory", "intelligence_feedback"]);
  supabaseAdmin.from = (table) => {
    if (!failing.has(table)) return realFrom(table);
    const chain = new Proxy({}, { get: (_t, prop) => (prop === "then" ? (resolve) => resolve({ data: null, count: null, error: { message: "simulated outage" } }) : () => chain) });
    return chain;
  };
  try {
    const memPartial = await get("/office/intelligence/memory-context");
    const learnPartial = await get("/office/intelligence/learning");
    assert.equal(memPartial.status, 200); assert.equal(learnPartial.status, 200);
    assert.equal(memPartial.json.complete, false);
    assert.equal(memPartial.json.resident_memory.available, false);
    assert.equal(memPartial.json.resident_memory.read_path.status, "active", "structural facts survive a data outage");
    assert.equal(memPartial.json.continuity.available, true, "unaffected sources stay available");
    assert.ok(memPartial.json.context_types.every((t) => t.active.available));
    assert.equal(learnPartial.json.complete, false);
    assert.equal(learnPartial.json.feedback.available, false);
    assert.ok(learnPartial.json.outcomes.every((o) => o.available === false));
    assert.equal(learnPartial.json.parameters.available, true);
    assert.equal(learnPartial.json.mechanisms.model_training.status, "not_implemented", "status vocabulary is not unavailability");
    assert.equal(learnPartial.json.mechanisms.evidence_collection.observed.available, false);
    console.log("PASS partial-source-failure: resident_memory + intelligence_feedback outages -> 200, complete=false, only those sources unavailable; structural/status facts intact; zero-not-unavailable preserved");
  } finally {
    supabaseAdmin.from = realFrom;
  }

  // --- performance ---
  for (const body of [mem, learn]) {
    assert.ok(body.performance.query_count <= 40, `bounded query count (${body.performance.query_count})`);
    assert.ok(body.performance.total_response_time_ms < 5000);
  }
  console.log(`PASS performance: memory-context ${mem.performance.query_count} queries / ${mem.performance.total_response_time_ms}ms (slowest ${mem.performance.slowest_source.name}); learning ${learn.performance.query_count} queries / ${learn.performance.total_response_time_ms}ms (slowest ${learn.performance.slowest_source.name})`);
} finally {
  // Cleanup: messages cascade with threads.
  await supabaseAdmin.from("oyi_conversation_threads").delete().in("id", [ids.threadA, ids.threadB]);
  if (ids.memory.length) await supabaseAdmin.from("resident_memory").delete().in("id", ids.memory);
  await supabaseAdmin.from("intelligence_feedback").delete().in("object_id", ids.fbObjects);
  if (ids.params.length) await supabaseAdmin.from("oyi_learning_parameters").delete().in("id", ids.params);
  const left = await supabaseAdmin.from("oyi_conversation_threads").select("id", { count: "exact", head: true }).in("id", [ids.threadA, ids.threadB]);
  console.log(`cleanup: seeded rows removed (threads remaining=${left.count ?? "?"})`);
  server.close();
}
