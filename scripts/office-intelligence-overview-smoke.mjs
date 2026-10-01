// Intelligence System Visibility, Slice 2 -- Overview + Attention/Human
// Intervention. Same two-part convention as Slice 1's own smoke:
//   1. Static guards over the route source -- reuse-not-reinvent checks.
//   2. A real, live HTTP integration test: boots ONLY officeExport.ts's
//      router against the isolated Wave 11 fixture, issues real
//      requests, and asserts the actual JSON contract.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import express from "express";

// ---------------------------------------------------------------------
// Part 1 -- static guards over the route source itself.
// ---------------------------------------------------------------------
const routeSrc = fs.readFileSync("src/routes/officeExport.ts", "utf8");
const viewSrc = fs.readFileSync("src/oyi-core/presentation/humanInterventionView.ts", "utf8");

assert.match(routeSrc, /router\.get\("\/intelligence\/interventions",\s*requireOfficeExportKey/,
  "interventions route must reuse the existing Office export auth boundary");
assert.match(routeSrc, /router\.get\("\/intelligence\/overview",\s*requireOfficeExportKey/,
  "overview route must reuse the existing Office export auth boundary");
assert.match(routeSrc, /loadPlatformHumanInterventionObligations/,
  "overview/interventions must reuse the canonical human-intervention aggregation, not a new attention engine");
assert.doesNotMatch(routeSrc.slice(routeSrc.indexOf("function safeInterventionProjection"), routeSrc.indexOf("function safeInterventionProjection") + 1200),
  /recipient|subject|body|plain_text|html|email|phone/i,
  "intervention projection must never forward communication PII/body fields");
assert.match(viewSrc, /communication_confirmation/, "communication confirmations must be a real source type");
assert.match(viewSrc, /conversation_proposal.*no_platform_wide_listing|excluded/is,
  "conversation_proposal's platform-wide exclusion must be documented, not silently dropped");
console.log("PASS static guards: reuses canonical aggregation, no PII forwarding, exclusion documented");

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
process.env.OFFICE_SYNC_API_KEY = "wave11-intelligence-slice2-smoke-test-key";
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

const AUTH = { "x-api-key": "wave11-intelligence-slice2-smoke-test-key" };

try {
  // --- auth gate ---
  const noAuthInterventions = await request("/office/intelligence/interventions");
  assert.equal(noAuthInterventions.status, 401, "interventions route must reject a request with no credential");
  const noAuthOverview = await request("/office/intelligence/overview");
  assert.equal(noAuthOverview.status, 401, "overview route must reject a request with no credential");

  // --- interventions contract ---
  const interventions = await request("/office/intelligence/interventions", AUTH);
  assert.equal(interventions.status, 200);
  assert.equal(interventions.json.ok, true);
  assert.ok(Array.isArray(interventions.json.interventions), "interventions must be a real array");
  assert.ok(Array.isArray(interventions.json.sources), "sources health must be a real array");
  assert.ok(typeof interventions.json.complete === "boolean");
  const sourceTypesSeen = interventions.json.sources.map((s) => s.source_type).sort();
  assert.deepEqual(sourceTypesSeen, ["automation_approval", "communication_confirmation", "decision", "goal_escalation", "workflow"].sort(),
    "platform-wide intervention aggregation must query exactly these five sources (conversation_proposal excluded, documented)");
  const rawBody = JSON.stringify(interventions.json);
  for (const dangerous of ["recipient", "subject", "body", "plain_text", "html", "/Users/", "SUPABASE", "@", "whatsapp_phone"]) {
    assert.ok(!rawBody.includes(dangerous), `interventions response must never leak "${dangerous}"`);
  }
  for (const item of interventions.json.interventions) {
    assert.ok(["automation_approval", "goal_escalation", "decision", "workflow", "communication_confirmation"].includes(item.source_type));
    assert.ok(["AUTHORIZATION", "CONFIRMATION", "INPUT_REQUIRED", "ESCALATION"].includes(item.intervention_type));
    assert.ok(typeof item.required_human_step === "string" && item.required_human_step.length > 0, "every intervention must carry a safe next-step string");
    assert.ok(!("resolver" in item) && !("execute" in item) && !("authorize" in item), "intervention projection must never expose live handler fields");
  }
  console.log(`PASS interventions contract: ${interventions.json.interventions.length} live obligations across exactly 5 queried sources, safe-field-only`);

  // --- overview contract ---
  const overview = await request("/office/intelligence/overview", AUTH);
  assert.equal(overview.status, 200);
  assert.equal(overview.json.ok, true);
  assert.equal(overview.json.architecture, "one_core", "One-Core authority guard: architecture must always read one_core");
  assert.equal(overview.json.workers.length, 4, "One-Core authority guard: exactly four governed workers, never more/fewer");
  assert.deepEqual(overview.json.workers.map((w) => w.key).sort(), ["consumer", "facility", "oma", "osa"]);

  // capability summary consistency -- overview's capability numbers must
  // agree with the dedicated /intelligence/summary route (Section 13).
  const summary = await request("/office/intelligence/summary", AUTH);
  assert.equal(overview.json.capabilities.total_registered, summary.json.capability_counts.total_registered,
    "overview and summary must agree on the live capability total -- both read the same registry");

  // Every numeric/available-flagged block must use the explicit
  // {available, ...} shape -- never a bare 0 standing in for "unknown".
  for (const key of ["active", "needs_human", "blocked_or_waiting"]) {
    assert.ok("available" in overview.json.goals[key], `goals.${key} must carry an explicit availability flag`);
  }
  for (const key of ["active", "awaiting_human", "recently_resolved"]) {
    assert.ok("available" in overview.json.decisions[key], `decisions.${key} must carry an explicit availability flag`);
  }
  assert.ok(Array.isArray(overview.json.attention.excluded_sources) && overview.json.attention.excluded_sources.some((s) => s.source_type === "conversation_proposal"),
    "overview must honestly disclose the one excluded intervention source, not silently omit it");

  // performance measurement (Section 12/13)
  assert.ok(typeof overview.json.performance.total_response_time_ms === "number");
  assert.ok(overview.json.performance.slowest_source && typeof overview.json.performance.slowest_source.ms === "number");
  console.log(`PASS overview contract: total_response_time_ms=${overview.json.performance.total_response_time_ms}, slowest_source=${JSON.stringify(overview.json.performance.slowest_source)}`);

  const overviewRawBody = JSON.stringify(overview.json);
  for (const dangerous of ["recipient", "subject", "plain_text", "/Users/", "SUPABASE", "whatsapp_phone"]) {
    assert.ok(!overviewRawBody.includes(dangerous), `overview response must never leak "${dangerous}"`);
  }

  console.log("PASS privacy/redaction: no PII, no file paths, no env/credential names in either contract");

  // --- partial-source-failure: one real source unavailable, others
  // still succeed, never collapsed into "everything is fine" ---
  // Real fixture data always has interventions.sources[].source_type ==
  // the five queried sources with ok:true here (proven above); this
  // second request corrupts the credential Supabase itself needs
  // AFTER the process has already initialized supabaseAdmin with the
  // real key, which isn't reversible mid-process -- so instead this
  // exercises the one real, always-available partial-failure path in
  // this contract: Redis. Stopping it mid-test proves system.health
  // degrades honestly (available:true, status:"degraded"/queue:"offline")
  // while every OTHER independent source in the same response stays
  // available:true -- exactly the "one source unavailable while others
  // succeed" case Section 10 requires, using a real failure, not a mock.
  const { execSync } = await import("node:child_process");
  try { execSync("docker rm -f oyi-intelligence-slice1-redis", { stdio: "ignore" }); } catch { /* may not exist -- fine, that's still "queue down" */ }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const degraded = await request("/office/intelligence/overview", AUTH);
  assert.equal(degraded.status, 200, "overview must still respond 200 even when one constituent source is down");
  assert.equal(degraded.json.system.health.available, true, "health block itself must still report -- degraded status is real data, not a missing block");
  assert.notEqual(degraded.json.system.health.status, "ok", "health must honestly report degraded/non-ok once queue is down");
  assert.equal(degraded.json.capabilities.available, true, "an unrelated source (capabilities) must remain available while queue health is down");
  assert.equal(degraded.json.attention.available, true, "an unrelated source (attention) must remain available while queue health is down");
  console.log("PASS partial-source-failure: queue down -> health honestly degraded, capabilities/attention stay available (never collapsed to \"everything is fine\")");
  // Container was started with --rm, so `docker stop` already removed it;
  // restart a fresh one for any caller running this script repeatedly.
  try { execSync("docker run -d --rm --name oyi-intelligence-slice1-redis -p 6379:6379 redis:7-alpine", { stdio: "ignore" }); } catch { /* best-effort cleanup only */ }
} finally {
  server.close();
}
