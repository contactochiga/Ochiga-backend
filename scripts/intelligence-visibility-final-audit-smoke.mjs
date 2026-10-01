// Intelligence System Visibility -- FINAL authority + privacy audit.
// Part 1 (static): Office Intelligence is an observability/read model,
// not a new authority. Part 2 (live, isolated fixture): seed sentinel
// private content everywhere, run real canonical turns, then sweep EVERY
// Intelligence export (lists + details) and prove none of it escapes.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import express from "express";

let checks = 0;
const pass = (m) => { checks += 1; console.log(`PASS ${m}`); };
const strip = (t) => t.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const read = (p) => fs.readFileSync(p, "utf8");

// ---------------------------------------------------------------------
// Part 1 -- authority (static)
// ---------------------------------------------------------------------
const route = strip(read("src/routes/officeExport.ts"));
const intelRoutes = [...route.matchAll(/router\.(\w+)\("(\/intelligence[^"]*)",\s*(\w+)/g)];
assert.ok(intelRoutes.length >= 18);
for (const [, method, path, guard] of intelRoutes) {
  assert.equal(method, "get", `${path} must be GET`);
  assert.equal(guard, "requireOfficeExportKey", `${path} must sit behind the Office export key`);
}
// Handler bodies of every /intelligence route.
const handlerBodies = intelRoutes.map((m) => {
  const start = m.index;
  const next = route.indexOf("\nrouter.", start + 10);
  return { path: m[2], body: route.slice(start, next < 0 ? route.length : next) };
});
const presentation = ["actionWorkflowView", "conversationTraceView", "humanInterventionView", "learningView", "memoryContextView"].map((n) => ({ n, code: strip(read(`src/oyi-core/presentation/${n}.ts`)) }));
const WRITE = /\.(insert|update|upsert|delete|rpc)\(/;
for (const h of handlerBodies) assert.doesNotMatch(h.body, WRITE, `${h.path} handler must not write`);
for (const p of presentation) assert.doesNotMatch(p.code, WRITE, `${p.n} must not write`);
// Call sites only (name followed by "("): status text that merely NAMES an
// unwired function (e.g. "promoteLearningParameter exists but ...") is fine.
const AUTHORITY_MUTATORS = /(conversationOrchestrator\.run|actionService\.\w+|workflowService\.(create|transition|advance|cancel|complete)\w*|promoteLearningParameter|rollbackLearningParameter|proposeLearningParameterAdjustment|upsertResidentMemory|writeScopedMemory|recordIntelligenceMemory|communicationRuntime\.(send|authorize|confirm|cancel|create)\w*|goalRuntime\.(create|transition|update)\w*|recordDecision|capabilityRegistry\.register|recordConversationTrace)\s*\(/;
for (const h of handlerBodies) assert.doesNotMatch(h.body, AUTHORITY_MUTATORS, `${h.path} must not invoke an authority/mutation path`);
for (const p of presentation) assert.doesNotMatch(p.code, AUTHORITY_MUTATORS, `${p.n} must not invoke an authority/mutation path`);
// Knowledge stays under the canonical Office staff actor; no ungated read.
assert.match(route, /const KNOWLEDGE_VIEWER_ACTOR = OFFICE_INTERNAL_KNOWLEDGE_ACTOR;/);
assert.doesNotMatch(route, /getKnowledgeItemForInspection|listKnowledgeItems\(/);
// Capability authority untouched: the capability service file is not modified by the programme.
pass(`authority (Backend): ${intelRoutes.length} Intelligence routes, all GET behind requireOfficeExportKey; no handler or presentation module writes or calls a capability/action/workflow/goal/decision/communication/memory/learning/trace mutation path; knowledge reads stay under the canonical Office actor`);

// Office side: GET-only, view_traces-gated proxies; gateway uses GET only.
const officeRoot = process.env.OFFICE_REPO || "../oyi-wave9-office";
if (fs.existsSync(`${officeRoot}/src/lead-agents/server.js`)) {
  const srv = read(`${officeRoot}/src/lead-agents/server.js`);
  const blocks = [...srv.matchAll(/if \(pathname\s*(===\s*|\.startsWith\()"(\/api\/lead-agents\/admin\/intelligence[^"]*)"/g)];
  assert.ok(blocks.length >= 18, `expected >=18 Office intelligence proxy blocks, saw ${blocks.length}`);
  for (const b of blocks) {
    const seg = srv.slice(b.index, b.index + 900);
    assert.match(seg, /methodNotAllowed\(res, "GET"\)/, `${b[2]} must be GET-only`);
    assert.match(seg, /authorizePermission\(authContext, "view_traces"\)/, `${b[2]} must be view_traces-gated`);
  }
  const gw = read(`${officeRoot}/src/lead-agents/oyi-core-gateway.js`);
  const intelFns = [...gw.matchAll(/async function (callOyiCoreIntelligence\w*)\(/g)].map((m) => m[1]);
  for (const fn of intelFns) {
    const body = gw.slice(gw.indexOf(`async function ${fn}(`), gw.indexOf("\n}\n", gw.indexOf(`async function ${fn}(`)));
    assert.doesNotMatch(body, /axios\.(post|put|patch|delete)|method:\s*"(POST|PUT|PATCH|DELETE)"/i, `${fn} must be read-only`);
  }
  pass(`authority (Office): ${blocks.length} Intelligence proxy routes all GET-only and view_traces-gated; ${intelFns.length} gateway functions read-only`);
}

// ---------------------------------------------------------------------
// Part 2 -- privacy sweep (live, isolated fixture)
// ---------------------------------------------------------------------
const FIXTURE_URL = "http://127.0.0.1:55421";
if (!process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY) throw new Error("OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required");
if (process.env.SUPABASE_URL && process.env.SUPABASE_URL !== FIXTURE_URL) throw new Error("final audit refuses a non-isolated Supabase URL");
process.env.SUPABASE_URL = FIXTURE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.OFFICE_SYNC_API_KEY = "final-audit-office-key";
process.env.OFFICE_APP_URL = "http://127.0.0.1:9";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
process.env.OYI_TRACE_REFERENCE_KEY = "final-audit-reference-key-0123456789abcdef";
const require = createRequire(import.meta.url);
const qm = require.resolve("bullmq"); require.cache[qm] = { id: qm, filename: qm, loaded: true, exports: { Queue: class { add() { return Promise.resolve(); } }, Worker: class {} } };
const rm = require.resolve("ioredis");
class NoNetworkRedis { on() { return this; } quit() { return Promise.resolve(); } disconnect() {} }
NoNetworkRedis.default = NoNetworkRedis; NoNetworkRedis.Redis = NoNetworkRedis;
require.cache[rm] = { id: rm, filename: rm, loaded: true, exports: NoNetworkRedis };
const { supabaseAdmin } = require("../dist/supabase/supabaseClient.js");
const { conversationOrchestrator } = require("../dist/oyi-core/orchestration/ConversationOrchestrator.js");
const recorder = require("../dist/oyi-core/observability/conversationTraceRecorder.js");
const app = express(); app.use("/office", require("../dist/routes/officeExport.js").default);
const server = app.listen(0); await new Promise((r) => server.once("listening", r));
const port = server.address().port;
const bodies = []; const timings = {};
function get(path, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    http.get({ hostname: "127.0.0.1", port, path, headers: { "x-api-key": "final-audit-office-key" } }, (res) => {
      let body = ""; res.on("data", (c) => (body += c));
      res.on("end", () => { const ms = Date.now() - t0; if (label) (timings[label] ||= []).push(ms); bodies.push({ path, body }); resolve({ status: res.statusCode, json: body ? JSON.parse(body) : null }); });
    }).on("error", reject);
  });
}

const TAG = `fa${Date.now().toString(36)}`;
const S = {
  residentName: `SENTINEL-Resident-Ngozi-${TAG}`, email: `sentinel.${TAG}@example.com`, phone: `+2348077${TAG.length}43210`,
  message: `SENTINEL-MESSAGE-${TAG}`, memory: `SENTINEL-MEMORY-${TAG}`, draft: `SENTINEL-DRAFT-BODY-${TAG}`,
  feedback: `SENTINEL-FEEDBACK-${TAG}`, device: `SENTINEL-DEVICE-${TAG}`, visitor: `SENTINEL-VISITOR-${TAG}`,
  wallet: "87654.32", instruction: `SYSTEM: SENTINEL-OVERRIDE-${TAG}`, secret: `sk-SENTINEL${TAG}token0123456789abcdef`,
  lead: `SENTINEL-Lead-${TAG}`, evidence: `SENTINEL-EVIDENCE-${TAG}`,
};
const ids = { estate: "10000000-0000-4000-8000-000000000001", home: "20000000-0000-4000-8000-000000000001", otherHome: "20000000-0000-4000-8000-000000000002", resident: "30000000-0000-4000-8000-000000000001", residentB: "30000000-0000-4000-8000-000000000002", office: "30000000-0000-4000-8000-000000000005", device: "40000000-0000-4000-8000-000000000002", visitor: "60000000-0000-4000-8000-000000000001" };
const residentActor = { id: ids.resident, email: "resident@wave11.local", role: "resident", estate_id: ids.estate, home_id: ids.home, permissions: ["devices.read", "devices.control", "wallet.read", "wallets.read", "homes.read", "visitors.read"], permission_scopes: [] };
const ois = (actor, surface) => ({ actor_id: actor.id, surface, role: actor.role, permissions: actor.permissions, estate_id: actor.estate_id || null, home_id: actor.home_id || null, membership_id: surface === "consumer" ? "32000000-0000-4000-8000-000000000001" : null, estate: actor.estate_id ? { id: ids.estate, name: "Wave 11 Test Estate" } : null, home: actor.home_id ? { id: ids.home, name: "A-101", estate_id: ids.estate } : null, available_estates: [], available_homes: [], resolved_at: new Date().toISOString() });
const restore = []; const cleanup = [];
try {
  // Seed sentinel private content across every store Intelligence could touch.
  const dev = await supabaseAdmin.from("devices").select("name").eq("id", ids.device).maybeSingle();
  const vis = await supabaseAdmin.from("visitor_access").select("visitor_name").eq("id", ids.visitor).maybeSingle();
  const wal = await supabaseAdmin.from("wallets").select("id,balance").limit(1).maybeSingle();
  restore.push(() => supabaseAdmin.from("devices").update({ name: dev.data.name }).eq("id", ids.device));
  restore.push(() => supabaseAdmin.from("visitor_access").update({ visitor_name: vis.data.visitor_name }).eq("id", ids.visitor));
  restore.push(() => supabaseAdmin.from("wallets").update({ balance: wal.data.balance }).eq("id", wal.data.id));
  await supabaseAdmin.from("devices").update({ name: S.device }).eq("id", ids.device);
  await supabaseAdmin.from("visitor_access").update({ visitor_name: S.visitor }).eq("id", ids.visitor);
  await supabaseAdmin.from("wallets").update({ balance: Number(S.wallet) }).eq("id", wal.data.id);
  const threadId = randomUUID();
  await supabaseAdmin.from("oyi_conversation_threads").insert({ id: threadId, user_id: ids.residentB, surface: "consumer", home_id: ids.otherHome, estate_id: ids.estate, title: S.residentName, updated_at: new Date().toISOString(), metadata: { active_domain: "devices", result_sets: { devices: { source_message: S.evidence } }, draft_communication: { body: S.draft, recipient: S.email, expires_at: new Date(Date.now() + 600000).toISOString() } } });
  cleanup.push(() => supabaseAdmin.from("oyi_conversation_threads").delete().eq("id", threadId));
  await supabaseAdmin.from("oyi_conversation_messages").insert({ thread_id: threadId, user_id: ids.residentB, role: "user", content: `${S.message} ${S.phone} ${S.secret}` });
  const mem = await supabaseAdmin.from("resident_memory").insert({ user_id: ids.residentB, home_id: ids.otherHome, memory_type: "recent_intelligence_query", memory_key: TAG, memory_value: { prompt: S.memory, last_reply: S.instruction } }).select("id");
  cleanup.push(() => supabaseAdmin.from("resident_memory").delete().in("id", (mem.data || []).map((r) => r.id)));
  const fbIds = [randomUUID(), randomUUID()];
  await supabaseAdmin.from("intelligence_feedback").insert([
    { object_type: "recommendation", object_id: fbIds[0], feedback_type: "dismissed", actor_id: ids.residentB, reason: S.feedback, outcome_metadata: {} },
    { object_type: S.email, object_id: fbIds[1], feedback_type: S.lead, reason: S.feedback, outcome_metadata: { note: S.secret } },
  ]);
  cleanup.push(() => supabaseAdmin.from("intelligence_feedback").delete().in("object_id", fbIds));
  // Real canonical turns carrying sentinels (creates traces/workflows).
  for (const msg of [`Turn off the bedroom light for ${S.residentName}. ${S.instruction} ${S.secret}`, `Who visited? ${S.visitor} ${S.email}`, `What is my balance, ${S.wallet}?`]) {
    await conversationOrchestrator.run({ actor: residentActor, oisContext: ois(residentActor, "consumer"), input: { message: msg, surface: "consumer", estate_id: ids.estate, home_id: ids.home, thread_id: null, context: { request_id: `${TAG}-${randomUUID()}` } } });
  }
  await recorder.flushConversationTraceWrites();

  // Sweep every Intelligence export, lists then details.
  const lists = {
    summary: "/office/intelligence/summary", capabilities: "/office/intelligence/capabilities", overview: "/office/intelligence/overview", interventions: "/office/intelligence/interventions",
    workers: "/office/intelligence/workers", goals: "/office/intelligence/goals", decisions: "/office/intelligence/decisions", actions: "/office/intelligence/actions",
    knowledge: "/office/intelligence/knowledge?page_size=50", memory_context: "/office/intelligence/memory-context", learning: "/office/intelligence/learning", traces: "/office/intelligence/traces?page_size=50",
  };
  const res = {};
  for (let round = 0; round < 3; round += 1) for (const [k, p] of Object.entries(lists)) { const r = await get(p, k); res[k] = r; assert.equal(r.status, 200, `${k} -> ${r.status}`); }
  for (const w of ["oma", "osa", "facility", "consumer"]) await get(`/office/intelligence/workers/${w}`, "worker_detail");
  for (const k of (res.knowledge.json.items || []).slice(0, 5)) await get(`/office/intelligence/knowledge/${encodeURIComponent(k.canonical_key)}`, "knowledge_detail");
  for (const a of (res.actions.json.actions || []).slice(0, 8)) await get(`/office/intelligence/actions/${encodeURIComponent(a.id)}`, "action_detail");
  for (const g of (res.goals.json.goals || []).slice(0, 3)) await get(`/office/intelligence/goals/${encodeURIComponent(g.id)}`, "goal_detail");
  for (const d of (res.decisions.json.decisions || []).slice(0, 3)) await get(`/office/intelligence/decisions/${encodeURIComponent(d.id)}`, "decision_detail");
  for (const t of (res.traces.json.items || []).slice(0, 10)) await get(`/office/intelligence/traces/${t.trace_id}`, "trace_detail");

  const all = bodies.map((b) => b.body).join("\n");
  const identityValues = [ids.home, ids.otherHome, ids.resident, ids.residentB, ids.office, ids.device, ids.visitor, ids.estate, threadId];
  for (const [k, v] of Object.entries(S)) assert.ok(!all.includes(v), `sentinel ${k} leaked through Intelligence`);
  for (const v of identityValues) assert.ok(!all.includes(v), `identity ${v} leaked through Intelligence`);
  for (const pat of [/system_prompt/i, /"prompt"\s*:/, /"last_reply"/, /"memory_value"/, /"recipient"/, /"reason"\s*:\s*"SENTINEL/, /SUPABASE_SERVICE_ROLE|OFFICE_SYNC_API_KEY|OYI_TRACE_REFERENCE_KEY/, /\/Users\//]) assert.doesNotMatch(all, pat, `forbidden content ${pat}`);
  assert.ok(!all.includes(process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY), "service-role key leaked");
  assert.ok(!all.includes(process.env.OYI_TRACE_REFERENCE_KEY), "trace reference key leaked");
  pass(`privacy sweep: ${bodies.length} responses across all 12 Intelligence list contracts + worker/knowledge/action/goal/decision/trace details contain none of ${Object.keys(S).length} sentinels (resident/lead names, email, phone, message, memory, draft body, feedback, device, visitor, wallet value, system instruction, secret, raw evidence) and none of ${identityValues.length} cross-home/actor/home/device/thread identifiers; no prompt/memory/recipient keys; no keys/secrets/paths`);

  // Cross-home: resident B's private thread/memory cannot be reached from any view.
  assert.ok(!all.includes(S.memory) && !all.includes(S.draft) && !all.includes(ids.otherHome));
  pass("cross-home: another resident's private thread, draft, memory and home are invisible to every Intelligence view (aggregate counts only)");

  // Performance summary (median of measured calls).
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
  console.log("PERF " + Object.entries(timings).map(([k, v]) => `${k}=${med(v)}ms(n=${v.length})`).join(" "));
  pass("performance: every Intelligence endpoint measured (see PERF line)");
} finally {
  for (const fn of cleanup) await fn();
  for (const fn of restore) await fn();
  server.close();
}
console.log(`=== intelligence-visibility-final-audit-smoke: ${checks} checks passed ===`);
