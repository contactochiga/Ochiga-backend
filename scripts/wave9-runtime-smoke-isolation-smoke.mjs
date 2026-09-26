import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";

// Deliberately hostile inherited configuration: no real credentials or targets.
// Each child must finish naturally; no process.exit masking Redis retry loops.
for (const script of ["production-readiness-smoke.mjs", "provider-health-smoke.mjs", "oyi-runtime-smoke.mjs"]) {
  const result = spawnSync(process.execPath, [new URL(script, import.meta.url).pathname], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 30000,
    env: { ...process.env, SUPABASE_URL: "https://configured-database.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "configured-fixture-key-must-not-escape",
      REDIS_URL: "redis://configured-redis.invalid:6379", REDIS_ENABLED: "false" },
  });
  assert.equal(result.error, undefined, `${script} must not hang`);
  assert.equal(result.status, 0, `${script}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS/);
  console.log(`PASS ${script}: real Core assertions, isolated ports, natural exit`);
}

const { isolation, assertRuntimeIsolation } = await import("./helpers/runtime-smoke-isolation.mjs");
const require = createRequire(import.meta.url);
const { supabaseAdmin } = require("../dist/supabase/supabaseClient.js");
assert.equal(process.env.SUPABASE_URL, "http://127.0.0.1:1");
assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY, "runtime-smoke-fixture-only");
assert.throws(() => supabaseAdmin.from("unexpected_table"), /forbidden external port/);
await assert.rejects(supabaseAdmin.rpc("unexpected_rpc", {}), /forbidden external port/);
assert.throws(() => new (require("bullmq").Queue)().add("unexpected"), /forbidden external port/);
assert.throws(() => require("../dist/config/redis.js").redis.connect(), /forbidden external port/);
assert.throws(() => net.connect({ host: "192.0.2.1", port: 5432 }), /forbidden external port/);
assert.throws(() => tls.connect({ host: "example.invalid", port: 443 }), /forbidden external port/);
const udp = dgram.createSocket("udp4");
assert.throws(() => udp.send(Buffer.from("fixture"), 1900, "239.255.255.250"), /forbidden external port/);
udp.close();
await assert.rejects(fetch("https://example.invalid"));
assert.ok(isolation.violations.length >= 8);
assert.throws(() => assertRuntimeIsolation(), /Unexpected access/,
  "Caught failures still make the smoke fail; never silently swallow an escape");
const workflow = readFileSync(new URL("../.github/workflows/backend-ci.yml", import.meta.url), "utf8");
assert.doesNotMatch(workflow.split("jobs:")[0], /secrets\.SUPABASE_(URL|SERVICE_ROLE_KEY)/);
const runtimeJob = workflow.split("  runtime-smoke:")[1].split("  ecosystem-smoke:")[0];
assert.doesNotMatch(runtimeJob, /secrets\.SUPABASE_(URL|SERVICE_ROLE_KEY)/);
assert.match(runtimeJob, /ci-fixture-only-not-a-service-credential/);
console.log("PASS fail-closed DB/RPC/queue/Redis/TCP/TLS/UDP/fetch boundaries and credential-free runtime CI");
