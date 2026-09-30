// Intelligence System Visibility, Slice 1 -- capability introspection +
// system summary. Two kinds of check, matching this repo's existing
// guard-smoke convention:
//   1. Static guards: computed-not-hardcoded, safe-field-only
//      serialization, governed-action-systems kept structurally
//      separate from the capability registry.
//   2. A real, live HTTP integration test: boots ONLY officeExport.ts's
//      router (not the full server) against the isolated Wave 11
//      fixture, issues real requests, and asserts the actual JSON
//      contract -- not a re-implementation of the route's own logic.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import express from "express";

// ---------------------------------------------------------------------
// Part 1 -- static guards over the route source itself.
// ---------------------------------------------------------------------
const src = fs.readFileSync("src/routes/officeExport.ts", "utf8");

assert.match(src, /router\.get\("\/intelligence\/capabilities",\s*requireOfficeExportKey/,
  "capabilities route must reuse the existing Office export auth boundary, not a second mechanism");
assert.match(src, /router\.get\("\/intelligence\/summary",\s*requireOfficeExportKey/,
  "summary route must reuse the existing Office export auth boundary, not a second mechanism");
assert.match(src, /capabilityRegistry\.all\(\)/,
  "capability counts must be computed from the live registry, not a stored/hardcoded list");
assert.doesNotMatch(src.slice(src.indexOf("INTELLIGENCE_WORKER_BY_SURFACE")), /total_registered:\s*78\b/,
  "the capability total must never be hardcoded in the route source");
assert.match(src, /INTELLIGENCE_GOVERNED_ACTION_SYSTEMS/,
  "communications and goal plan-step dispatch must be listed as a distinct, non-registry concept");
assert.doesNotMatch(src.slice(src.indexOf("INTELLIGENCE_GOVERNED_ACTION_SYSTEMS =")), /capabilityRegistry\.register/,
  "governed action systems must never be registered as capabilities -- they are explicitly NOT capabilities");
// Safety: the safe projection function must never forward a live
// function-valued field (resolver/collectEvidence/authorize/execute/
// buildReadResponse/createDraft/verify) from CapabilityModule.
const projectionBody = src.slice(src.indexOf("function safeIntelligenceCapabilityProjection"), src.indexOf("function countIntelligenceCapabilitiesBy"));
for (const dangerousField of ["resolver", "collectEvidence", "authorize", "execute", "buildReadResponse", "createDraft", "verify", "supports"]) {
  assert.doesNotMatch(projectionBody, new RegExp(`\\b${dangerousField}\\b`),
    `safe capability projection must never reference the live handler field "${dangerousField}"`);
}
console.log("PASS static guards: computed-not-hardcoded, safe-field-only, governed-action-systems structurally separate");

// ---------------------------------------------------------------------
// Part 2 -- live HTTP integration test against the compiled route,
// isolated Wave 11 fixture only (same refusal/isolation convention as
// the behavioural harness).
// ---------------------------------------------------------------------
const FIXTURE_URL = "http://127.0.0.1:55421";
if (!process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required for this local Supabase smoke test");
}
process.env.SUPABASE_URL = FIXTURE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.OFFICE_SYNC_API_KEY = "wave11-intelligence-smoke-test-key";

const require = createRequire(import.meta.url);
const queueModule = require.resolve("bullmq");
require.cache[queueModule] = { id: queueModule, filename: queueModule, loaded: true, exports: { Queue: class {}, Worker: class {} } };
const redisModule = require.resolve("ioredis");
class NoNetworkRedis { on() { return this; } quit() { return Promise.resolve(); } disconnect() {} }
NoNetworkRedis.default = NoNetworkRedis;
NoNetworkRedis.Redis = NoNetworkRedis;
require.cache[redisModule] = { id: redisModule, filename: redisModule, loaded: true, exports: NoNetworkRedis };

// Loaded via CJS require(), not ESM dynamic import -- this file's
// TypeScript-compiled CommonJS output confuses Node's synthetic-named-
// exports interop when dynamically imported (module.exports.default
// resolves to the whole exports object instead of the router), which
// require() does not have.
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

try {
  const noAuth = await request("/office/intelligence/capabilities");
  assert.equal(noAuth.status, 401, "capabilities route must reject a request with no credential");

  const wrongAuth = await request("/office/intelligence/capabilities", { "x-api-key": "wrong-key" });
  assert.equal(wrongAuth.status, 401, "capabilities route must reject an incorrect credential");

  const capabilities = await request("/office/intelligence/capabilities", { "x-api-key": "wave11-intelligence-smoke-test-key" });
  assert.equal(capabilities.status, 200, "capabilities route must accept the correct credential");
  assert.equal(capabilities.json.ok, true);
  assert.equal(capabilities.json.architecture, "one_core");
  assert.ok(Array.isArray(capabilities.json.capabilities), "capabilities must be a real array, not a placeholder");
  assert.ok(capabilities.json.capabilities.length > 0, "live registry must yield at least one capability");
  assert.equal(capabilities.json.summary.total_registered, capabilities.json.capabilities.length,
    "summary.total_registered must match the actual returned capability count, not a stale/separate number");
  assert.ok(Array.isArray(capabilities.json.governed_action_systems) && capabilities.json.governed_action_systems.length === 2,
    "communications and goal plan-step dispatch must both be listed");
  for (const key of ["communications", "goal_plan_dispatch"]) {
    assert.ok(capabilities.json.governed_action_systems.some((s) => s.key === key), `governed action system "${key}" must be present`);
  }
  const sample = capabilities.json.capabilities[0];
  for (const dangerousField of ["resolver", "collectEvidence", "authorize", "execute", "buildReadResponse", "createDraft", "verify", "supports"]) {
    assert.ok(!(dangerousField in sample), `serialized capability must never expose live field "${dangerousField}"`);
  }
  assert.ok(JSON.stringify(capabilities.json).indexOf("/Users/") === -1, "response must never leak an absolute filesystem path");
  assert.ok(JSON.stringify(capabilities.json).indexOf("SUPABASE") === -1, "response must never leak an environment/credential name");

  const summary = await request("/office/intelligence/summary", { "x-api-key": "wave11-intelligence-smoke-test-key" });
  assert.equal(summary.status, 200);
  assert.equal(summary.json.workers.length, 4, "summary must list exactly the four workers");
  const workerKeys = summary.json.workers.map((w) => w.key).sort();
  assert.deepEqual(workerKeys, ["consumer", "facility", "oma", "osa"], "workers must be exactly Oma/Osa/Facility/Consumer");
  assert.equal(summary.json.capability_counts.total_registered, capabilities.json.summary.total_registered,
    "summary and capabilities routes must agree on the live total -- both read the same registry");
  assert.equal(summary.json.governed_action_system_count, 2);

  console.log(`PASS live HTTP integration: auth gate enforced, ${capabilities.json.summary.total_registered} live capabilities returned, safe-field-only, workers exactly Oma/Osa/Facility/Consumer`);
} finally {
  server.close();
}
