// Intelligence System Visibility, Slice 7 -- trace PROJECTION CONTRACT.
// Pure (no database): proves the allow-listed projection before any trace
// store exists. Uses the real ConversationTracer and the real capability
// registry.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:55421";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "projection-contract-placeholder-not-used";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const require = createRequire(import.meta.url);
for (const [mod, exp] of [["bullmq", { Queue: class {}, Worker: class {} }]]) {
  const p = require.resolve(mod); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
const rp = require.resolve("ioredis");
class NoNetworkRedis { on() { return this; } quit() { return Promise.resolve(); } disconnect() {} }
NoNetworkRedis.default = NoNetworkRedis; NoNetworkRedis.Redis = NoNetworkRedis;
require.cache[rp] = { id: rp, filename: rp, loaded: true, exports: NoNetworkRedis };

const P = require("../dist/oyi-core/observability/conversationTraceProjection.js");
const { ConversationTracer } = require("../dist/oyi-core/observability/ConversationTracer.js");
const { ensureRegistered } = require("../dist/oyi-core/orchestration/ConversationOrchestrator.js");
ensureRegistered();

let checks = 0;
const pass = (msg) => { checks += 1; console.log(`PASS ${msg}`); };

const S = {
  name: "SENTINEL-Resident-Adaeze-Okonkwo",
  email: "sentinel.adaeze@example.com",
  phone: "+2348011112222",
  home: "11111111-2222-4333-8444-555555555555",
  device: "SENTINEL-DEVICE-tuya-bf88",
  message: "SENTINEL-MESSAGE-turn-on-the-heater",
  reply: "SENTINEL-REPLY-done",
  secret: "sk-SENTINELsecretTOKEN1234567890",
  thread: "99999999-8888-4777-8666-555555555555",
  request: "SENTINEL-REQUEST-ID-abc",
  errorMessage: "SENTINEL-ERROR-contains alice@example.com",
};

// --- 1. classification covers exactly the record ---
const tracer = new ConversationTracer({ requestId: S.request });
tracer.stage("request_received", { surface: "consumer", thread_id: S.thread, actor_id: S.name, message: S.message });
tracer.stage("turn_normalized", { domain: "devices", operation: "device.power.on", mutation_intent: true, correction_count: 0, raw_text: S.message });
tracer.stage("workflow_restored", { workflow_id: S.home, status: "not_restored" });
tracer.stage("turn_resolved", { domain: "devices", operation: "device.power.on", capability_key: "devices.power.control", target_type: "device", target_source: "current_turn", target_id: S.device, target_label: S.name });
tracer.stage("authority_decided", { domain: "devices", operation: "device.power.on", authority_result: "allowed", tier: 2 });
tracer.stage("capability_selected", { domain: "devices", operation: "device.power.on", capability_key: "devices.power.control", rollout_status: "enabled", resolution_outcome: "matched", authority_allowed: true, authority_reason: null });
tracer.stage("evidence_planned", { capability_key: "devices.power.control" });
tracer.stage("evidence_loaded", { capability_key: "devices.power.control", evidence_count: 1, evidence: [{ email: S.email }] });
tracer.stage("response_composed", { capability_key: "devices.power.control" });
tracer.stage("persistence_completed", { thread_id: S.thread, persistence_saved: "true" });
tracer.finish({ thread_id: S.thread, response_state: "returned" });
const response = {
  thread_id: S.thread, reply: S.reply, answer: S.reply, message: S.reply, persistence_saved: true,
  facts: [{ phone: S.phone, home_id: S.home }],
  execution: { status: "pending_confirmation", workflow_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", action_id: S.device, workflow: { status: "awaiting_approval", target_id: S.device }, goal_id: "not-a-uuid " + S.name },
};
const record = P.projectConversationTrace({ events: tracer.events(), startedAt: tracer.startedAt, completedAt: Date.now(), requestId: tracer.requestId, surface: "consumer", threadId: S.thread, actor: { id: S.name, role: "resident", email: S.email }, response, error: null });
assert.deepEqual(Object.keys(record).sort(), Object.keys(P.TRACE_FIELD_CLASSIFICATION).sort(), "record keys == classified fields");
for (const [k, c] of Object.entries(P.TRACE_FIELD_CLASSIFICATION)) assert.ok(c === "AVAILABLE_NOW" || c === "DERIVED_SAFELY", `${k} classified`);
for (const k of Object.keys(P.TRACE_EXCLUDED_FIELDS)) assert.ok(!(k in record), `excluded field ${k} absent`);
pass(`classification: record has exactly the ${Object.keys(P.TRACE_FIELD_CLASSIFICATION).length} classified fields; ${Object.keys(P.TRACE_EXCLUDED_FIELDS).length} excluded fields absent`);

// --- 2. sentinel exclusion ---
const json = JSON.stringify(record);
for (const [k, v] of Object.entries(S)) assert.ok(!json.includes(v), `sentinel ${k} must not reach the record`);
assert.ok(!json.includes("@"), "no email-like text anywhere");
pass("privacy: none of 11 sentinels (name/email/phone/home/device/message/reply/secret/thread/request/error) reach the record, even when passed as stage metadata or response fields");

// --- 3. structural content is right ---
assert.equal(record.worker, "consumer"); assert.equal(record.actor_class, "resident");
assert.equal(record.domain, "devices"); assert.equal(record.operation, "device.power.on"); assert.equal(record.mutation_intent, true);
assert.equal(record.target_class, "device"); assert.equal(record.target_resolution_source, "current_turn");
assert.equal(record.capability_key, "devices.power.control"); assert.equal(record.capability_rollout, "enabled");
assert.equal(record.authority_result, "allowed"); assert.equal(record.authority_tier, 2);
assert.equal(record.evidence_planned, true); assert.equal(record.evidence_count, 1);
assert.equal(record.terminal_outcome, "capability_response"); assert.equal(record.confirmation_required, true);
assert.equal(record.workflow_state, "awaiting_approval"); assert.equal(record.response_status, "returned"); assert.equal(record.persistence_saved, true);
assert.deepEqual(record.lineage, { workflow_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, "lineage keeps UUIDs only (non-UUID action/goal dropped)");
assert.match(record.thread_ref, /^th_[0-9a-f]{20}$/); assert.match(record.turn_ref, /^tu_[0-9a-f]{20}$/);
assert.deepEqual(record.stages.map((s) => s.stage), ["request_received", "turn_normalized", "workflow_restored", "turn_resolved", "authority_decided", "capability_selected", "evidence_planned", "evidence_loaded", "response_composed", "persistence_completed", "response_sent"]);
assert.ok(record.stages.every((s) => Object.keys(s).sort().join() === "duration_ms,offset_ms,stage"), "stage entries carry name + timings only");
assert.equal(new Date(record.expires_at) - new Date(record.started_at), 30 * 86400000, "30-day default retention");
pass("structure: worker/actor class/domain/operation/mutation/target class+source/capability/rollout/authority/evidence/workflow/confirmation/lineage/opaque refs/observed stages/30d expiry");

// --- 4. only observed stages; declared-but-never-emitted never fabricated ---
const t2 = new ConversationTracer({});
for (const st of ["request_received", "context_loaded", "action_created", "execution_started", "verification_completed", "legacy_fallback_used"]) t2.stage(st, {});
const r2 = P.projectConversationTrace({ events: t2.events(), startedAt: t2.startedAt, completedAt: Date.now(), requestId: null, surface: "facility", threadId: null, actor: null, response: {}, error: null });
assert.deepEqual(r2.stages.map((s) => s.stage), ["request_received"]);
assert.ok(!P.OBSERVED_TRACE_STAGES.some((s) => ["context_loaded", "action_created", "execution_started", "verification_completed", "legacy_fallback_used"].includes(s)));
pass("stages: only the 12 audited emitted stages can be persisted; never-emitted stages are dropped");

// --- 5. Wave 11 taxonomy translation (incl. legacy label) ---
function project(stages, extra = {}) {
  const t = new ConversationTracer({});
  for (const [st, md] of stages) t.stage(st, md);
  return P.projectConversationTrace({ events: t.events(), startedAt: t.startedAt, completedAt: Date.now(), requestId: null, surface: extra.surface || "office_internal", threadId: null, actor: { role: "manager" }, response: extra.response === undefined ? { persistence_saved: true } : extra.response, error: extra.error || null });
}
const noMatch = project([["capability_selected", { capability_key: "legacy", rollout_status: "legacy_fallback", resolution_outcome: "no_match" }], ["canonical_terminal_response", { outcome: "capability_no_match", reason: "unimplemented_capability" }]], { surface: "consumer" });
assert.equal(noMatch.terminal_outcome, "capability_no_match"); assert.equal(noMatch.capability_key, null); assert.equal(noMatch.compatibility_label_seen, true);
assert.ok(!JSON.stringify(noMatch).includes("legacy"), "the word legacy is never persisted as semantic content");
const bsf = project([["capability_selected", { capability_key: "legacy", rollout_status: "legacy_fallback", resolution_outcome: "no_match" }], ["canonical_terminal_response", { outcome: "business_surface_fallback" }]]);
assert.equal(bsf.terminal_outcome, "business_surface_fallback");
const unsup = project([["capability_selected", { capability_key: "legacy", resolution_outcome: "surface_restricted" }], ["canonical_terminal_response", { outcome: "canonical_unsupported" }]], { surface: "consumer" });
assert.equal(unsup.terminal_outcome, "canonical_unsupported");
const disabled = project([["capability_selected", { capability_key: "utilities.usage.read", rollout_status: "declared", resolution_outcome: "declared_disabled" }]], { surface: "consumer" });
assert.equal(disabled.terminal_outcome, "declared_disabled"); assert.equal(disabled.capability_key, "utilities.usage.read");
const denied = project([["authority_decided", { authority_result: "allowed", tier: 1 }], ["capability_selected", { capability_key: "crm.leads.read", rollout_status: "enabled", resolution_outcome: "permission_restricted", authority_allowed: false, authority_reason: "missing_permission" }]]);
assert.equal(denied.terminal_outcome, "authority_denied"); assert.equal(denied.authority_result, "denied"); assert.equal(denied.authority_denial_reason, "missing_permission");
const cont = project([["request_received", {}], ["workflow_restored", { status: "awaiting_approval" }]], { response: { persistence_saved: false } });
assert.equal(cont.terminal_outcome, "governed_continuation"); assert.equal(cont.workflow_restored, true); assert.equal(cont.response_status, "returned_unsaved"); assert.equal(cont.persistence_saved, false);
pass("taxonomy: capability_no_match / business_surface_fallback / canonical_unsupported / declared_disabled / authority_denied / governed_continuation / persistence failure; legacy label -> compatibility flag only");

// --- 6. exception traces: class only ---
class SentinelError extends Error { constructor() { super(S.errorMessage); this.name = "CapabilityTimeoutError"; this.stack = S.errorMessage; } }
const failed = project([["request_received", {}], ["turn_normalized", { domain: "crm", operation: "list" }]], { response: null, error: new SentinelError() });
assert.equal(failed.terminal_outcome, "runtime_error"); assert.equal(failed.response_status, "failed"); assert.equal(failed.error_class, "CapabilityTimeoutError"); assert.equal(failed.persistence_saved, null);
const weird = project([], { response: null, error: { name: `Error: ${S.email}`, message: S.errorMessage } });
assert.equal(weird.error_class, "Error");
assert.ok(!JSON.stringify([failed, weird]).includes("SENTINEL") && !JSON.stringify(weird).includes("@"));
pass("exceptions: runtime_error trace with structural state; error class name only, never message/stack; malformed names collapse to Error");

// --- 7. token/capability validation rejects user text ---
const hostile = project([["turn_normalized", { domain: "Adaeze Okonkwo", operation: "call +2348011112222" }], ["turn_resolved", { target_type: "alice@example.com", target_source: "made_up" }], ["capability_selected", { capability_key: "crm.leads.read.SENTINEL", resolution_outcome: "matched" }]]);
assert.equal(hostile.domain, null); assert.equal(hostile.operation, null); assert.equal(hostile.target_class, null); assert.equal(hostile.target_resolution_source, null); assert.equal(hostile.capability_key, null);
pass("validation: free text in domain/operation/target/capability fields is rejected to null (tokens, closed enums, registered keys only)");

const hostile2 = project([["turn_normalized", { domain: "adaeze", operation: "okonkwo" }]]);
assert.equal(hostile2.domain, null); assert.equal(hostile2.operation, null);
const lu = fs.readFileSync("src/oyi-core/runtime/languageUnderstanding.ts", "utf8");
const domainSrc = [...lu.match(/export type OyiDomain =([\s\S]*?);/)[1].replace(/\/\/[^\n]*/g, "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
assert.deepEqual([...P.TRACE_DOMAINS], domainSrc, "TRACE_DOMAINS mirrors OyiDomain");
const sfSrc = fs.readFileSync("src/oyi-core/contracts/semanticFrame.ts", "utf8");
const opSrc = [...sfSrc.match(/export type SemanticOperation =([\s\S]*?);/)[1].matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]);
assert.deepEqual([...P.TRACE_OPERATIONS], [...opSrc, "automation.suggest"], "TRACE_OPERATIONS mirrors SemanticOperation");
pass(`closed vocabularies: domain in OyiDomain (${domainSrc.length}), operation in SemanticOperation (${opSrc.length}) + override; lowercase single-word user text rejected`);

// --- 8. opaque references ---
const before = P.opaqueReference("thread", S.thread);
process.env.OYI_TRACE_REFERENCE_KEY = "local-test-reference-key";
const keyed = P.opaqueReference("thread", S.thread);
assert.notEqual(before, keyed); assert.equal(P.opaqueReference("thread", S.thread), keyed, "stable for correlation");
assert.ok(!keyed.includes(S.thread.slice(0, 8)));
delete process.env.OYI_TRACE_REFERENCE_KEY;
pass("references: thread/turn refs are one-way, stable for correlation, keyed when OYI_TRACE_REFERENCE_KEY is set");

// --- 9. static: no spreading into the record ---
const src = fs.readFileSync("src/oyi-core/observability/conversationTraceProjection.ts", "utf8").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const projectBody = src.slice(src.indexOf("export function projectConversationTrace"));
assert.doesNotMatch(projectBody, /\.\.\.(input|response|execution|ev|fields|metadata)/, "no object spreading from inputs into the record");
pass("static: projectConversationTrace builds every field explicitly (no spread of tracer/response payloads)");

// --- 10. single writer, single boundary ---
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".ts") ? [`${dir}/${e.name}`] : [])); }
const strip = (t) => t.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const files = walk("src").map((f) => ({ f, code: strip(fs.readFileSync(f, "utf8")) }));
const callers = files.flatMap(({ f, code }) => [...code.matchAll(/recordConversationTrace\(/g)].map(() => f)).filter((f) => !f.endsWith("conversationTraceRecorder.ts"));
assert.deepEqual(callers, ["src/oyi-core/orchestration/ConversationOrchestrator.ts"], "exactly one call site, in the orchestrator");
const orch = files.find((x) => x.f.endsWith("ConversationOrchestrator.ts")).code;
const runBody = orch.slice(orch.indexOf("  async run(context: CanonicalConversationRequestContext)"), orch.indexOf("  private async runTurn("));
assert.match(runBody, /response = await this\.runTurn\(context, traceHolder\);\s*\} catch \(error\) \{\s*finalize\(null, error\);\s*throw error;\s*\}\s*finalize\(response, null\);\s*return response;/, "run() finalizes exactly once on return or throw and rethrows");
assert.equal((orch.match(/recordConversationTrace\(/g) || []).length, 1, "single call inside the finalize boundary");
const writers = files.filter(({ code }) => /oyi_conversation_traces["'`]\)\s*\.insert|CONVERSATION_TRACE_TABLE\)\s*\.insert/.test(code)).map((x) => x.f);
assert.deepEqual(writers, ["src/oyi-core/observability/conversationTraceRecorder.ts"], "only the recorder inserts traces");
const recSrc = strip(fs.readFileSync("src/oyi-core/observability/conversationTraceRecorder.ts", "utf8"));
assert.doesNotMatch(recSrc, /export async function recordConversationTrace\(/, "entry point is synchronous (never awaited by the conversation path)");
assert.match(recSrc, /export function recordConversationTrace\(/);
pass("single writer: one recordConversationTrace call (the run() finalize boundary, return + throw), recorder is the only inserter, entry point synchronous/non-awaited");

console.log(`=== intelligence-trace-projection-contract-smoke: ${checks} checks passed ===`);
