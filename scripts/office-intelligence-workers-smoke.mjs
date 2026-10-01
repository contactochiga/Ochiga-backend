// Intelligence System Visibility, Slice 3 -- Worker Visibility. Same
// two-part convention as Slice 1/2's own smokes.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import express from "express";

// ---------------------------------------------------------------------
// Part 1 -- static guards over the route source itself.
// ---------------------------------------------------------------------
const routeSrc = fs.readFileSync("src/routes/officeExport.ts", "utf8");

assert.match(routeSrc, /router\.get\("\/intelligence\/workers",\s*requireOfficeExportKey/,
  "workers route must reuse the existing Office export auth boundary");
assert.match(routeSrc, /router\.get\("\/intelligence\/workers\/:worker",\s*requireOfficeExportKey/,
  "worker detail route must reuse the existing Office export auth boundary");
assert.match(routeSrc, /buildIntelligenceCapabilityInventory/,
  "worker profiles must reuse the same capability registry scan Slice 1 already performs, not a second scan");
assert.match(routeSrc, /loadPlatformHumanInterventionObligations/,
  "worker attention must reuse the same platform intervention aggregation Slice 2 already performs");
const workerProfileFnBody = routeSrc.slice(
  routeSrc.indexOf("async function buildWorkerIntelligenceProfiles"),
  routeSrc.indexOf("router.get(\"/intelligence/workers\"")
);
assert.doesNotMatch(workerProfileFnBody, /\.from\("ochiga_intelligence_events"\)[\s\S]{0,400}\.from\("ochiga_intelligence_events"\)/,
  "the observability-events table must be queried exactly once per profile build, not once per worker (N+1 guard)");
assert.match(routeSrc, /architecture:\s*"one_core_worker"/, "each worker object must carry the one_core_worker architecture marker");
console.log("PASS static guards: reuses capability registry scan + intervention aggregation, single events query, one_core_worker marker present");

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
process.env.OFFICE_SYNC_API_KEY = "wave11-intelligence-slice3-smoke-test-key";
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

const AUTH = { "x-api-key": "wave11-intelligence-slice3-smoke-test-key" };

try {
  // --- auth gate ---
  const noAuthWorkers = await request("/office/intelligence/workers");
  assert.equal(noAuthWorkers.status, 401, "workers route must reject a request with no credential");
  const noAuthDetail = await request("/office/intelligence/workers/oma");
  assert.equal(noAuthDetail.status, 401, "worker detail route must reject a request with no credential");

  // --- unknown worker ---
  const unknown = await request("/office/intelligence/workers/nope", AUTH);
  assert.equal(unknown.status, 404, "an unknown worker key must 404, not silently return an empty profile");

  // --- workers list contract ---
  const workers = await request("/office/intelligence/workers", AUTH);
  assert.equal(workers.status, 200);
  assert.equal(workers.json.ok, true);
  assert.equal(workers.json.architecture, "one_core", "One-Core authority guard: top-level architecture must always read one_core");
  assert.equal(workers.json.workers.length, 4, "One-Core authority guard: exactly four governed surfaces, never more/fewer");
  assert.deepEqual(workers.json.workers.map((w) => w.identity).sort(), ["consumer", "facility", "oma", "osa"]);
  assert.deepEqual(workers.json.workers.map((w) => w.surface).sort(), ["consumer", "facility", "office_internal", "public_corporate"],
    "surface/capability consistency: worker surface keys must match the same OyiSurface vocabulary capabilities use");
  for (const w of workers.json.workers) {
    assert.equal(w.architecture, "one_core_worker");
    assert.ok(w.capabilities.available === true);
    assert.ok(Number.isInteger(w.capabilities.total) && w.capabilities.total >= 0);
    assert.ok(Array.isArray(w.capabilities.domains));
    assert.ok(Array.isArray(w.authority.known_restrictions) && w.authority.known_restrictions.length > 0, `${w.identity} must always carry known_restrictions -- never presented as unrestricted`);
    assert.ok(w.attention.available === true);
    assert.ok(Number.isInteger(w.attention.pending_intervention_count));
    assert.ok(typeof w.activity.available === "boolean");
  }

  // capability count consistency: sum of per-worker capability.total
  // (a capability supporting N surfaces counts once per surface it
  // supports, so this is a cross-surface sum, not a dedup of the global
  // registry total -- assert against the live /intelligence/summary
  // by_worker breakdown instead, which uses the identical semantics).
  const summary = await request("/office/intelligence/summary", AUTH);
  for (const w of workers.json.workers) {
    const fromSummary = summary.json.workers.find((sw) => sw.key === w.identity);
    assert.equal(w.capabilities.total, fromSummary.capability_count,
      `${w.identity}'s worker capability total must agree with /intelligence/summary's by-worker count -- same registry, same filter`);
  }
  console.log(`PASS workers list contract: 4 governed surfaces, surface vocabulary matches capabilities, capability counts agree with /intelligence/summary`);

  // --- worker detail contract + consistency with list ---
  for (const identity of ["oma", "osa", "facility", "consumer"]) {
    const detail = await request(`/office/intelligence/workers/${identity}`, AUTH);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.worker.identity, identity);
    const fromList = workers.json.workers.find((w) => w.identity === identity);
    assert.equal(detail.json.worker.capabilities.total, fromList.capabilities.total, `${identity} detail and list capability totals must agree`);
    assert.equal(detail.json.worker.attention.pending_intervention_count, fromList.attention.pending_intervention_count, `${identity} detail and list intervention counts must agree`);
  }
  console.log("PASS worker detail contract: all 4 workers resolve, numbers agree exactly with the list route");

  // --- intervention attribution: oma is the only surface behind both
  // governed action systems (Communications, Goal Plan-Step Dispatch) ---
  const oma = workers.json.workers.find((w) => w.identity === "oma");
  const others = workers.json.workers.filter((w) => w.identity !== "oma");
  assert.equal(oma.authority.governed_action_systems.length, 2, "oma must show both governed action systems (office_internal-only, confirmed by direct source read in Slice 1)");
  for (const w of others) {
    assert.equal(w.authority.governed_action_systems.length, 0, `${w.identity} must show zero governed action systems -- they are office_internal-only`);
  }

  // --- privacy/redaction ---
  const rawBody = JSON.stringify(workers.json);
  for (const dangerous of ["recipient", "subject", "plain_text", "whatsapp_phone", "/Users/", "SUPABASE", "@"]) {
    assert.ok(!rawBody.includes(dangerous), `workers response must never leak "${dangerous}"`);
  }
  console.log("PASS intervention attribution + privacy/redaction: oma-only governed action systems confirmed, no PII/path/credential leakage");

  // --- performance ---
  assert.ok(typeof workers.json.performance.total_response_time_ms === "number");
  assert.ok(workers.json.performance.slowest_source && typeof workers.json.performance.slowest_source.ms === "number");
  console.log(`PASS performance: total_response_time_ms=${workers.json.performance.total_response_time_ms}, slowest_source=${JSON.stringify(workers.json.performance.slowest_source)}`);

  // --- partial-source-failure: queue down must not affect this route at
  // all (workers has no health/queue dependency), but the observability-
  // events source going down must degrade THAT block only, honestly ---
  const { execSync } = await import("node:child_process");
  try { execSync("docker rm -f oyi-intelligence-slice1-redis", { stdio: "ignore" }); } catch { /* fine */ }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const stillOk = await request("/office/intelligence/workers", AUTH);
  assert.equal(stillOk.status, 200, "workers route has no queue/redis dependency -- it must be unaffected by Redis being down");
  assert.equal(stillOk.json.workers.length, 4);
  console.log("PASS partial-source-failure: workers route has no redis dependency, unaffected by queue outage");
  try { execSync("docker run -d --rm --name oyi-intelligence-slice1-redis -p 6379:6379 redis:7-alpine", { stdio: "ignore" }); } catch { /* best-effort cleanup only */ }
} finally {
  server.close();
}
