#!/usr/bin/env node
// Runs the Backend checks that need environment configuration, with a LOCAL-ONLY configuration that cannot reach any real project:
//   * SUPABASE_URL points at a closed local port (127.0.0.1:9) with a placeholder key -- these checks only need the client to be constructible;
//   * REDIS_URL points at a throwaway redis:7-alpine container started here and removed afterwards;
//   * DATABASE_URL and every other inherited Supabase / Redis variable are removed, so nothing can fall back to a real project.
// It does NOT run `audit:security`: that audit reads the LINKED Supabase project (`supabase db query --linked`, i.e. production) by design, and must only be
// run with explicit authorization. Nothing here weakens a check -- each script is executed unmodified and its exit code reported as is.
// Run `npm run build` first. Requires Docker and the redis:7-alpine image.
import { execFileSync, spawnSync } from "node:child_process";

const CHECKS = [
  "office-export-auth-compat-smoke",
  "communications-office-auth-compat-smoke",
  "wave8-slice3-goal-outcome-workflow-separation-smoke",
  "communication-recipient-resolution-smoke",
  "oyi-office-intelligence-convergence-smoke",
];
const REDIS = `be-local-checks-redis-${process.pid}`;
const REDIS_PORT = 56379;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SUPABASE_|DATABASE_URL|REDIS_|OPENAI_API_KEY)/.test(k)));
Object.assign(env, { SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "local-only-placeholder", REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}` });
for (const key of ["SUPABASE_URL", "REDIS_URL"]) {
  if (!/^[a-z]+:\/\/127\.0\.0\.1:\d+$/.test(env[key])) throw new Error(`${key} must point at 127.0.0.1 only`);
}

try { docker("image", "inspect", "redis:7-alpine"); } catch { console.log("SKIP: Docker or the redis:7-alpine image is unavailable"); process.exit(0); }
const results = [];
try {
  docker("run", "-d", "--rm", "--name", REDIS, "-p", `127.0.0.1:${REDIS_PORT}:6379`, "redis:7-alpine");
  for (const check of CHECKS) {
    const run = spawnSync("node", [`scripts/${check}.mjs`], { env, encoding: "utf8", timeout: 180_000 });
    const output = `${run.stdout || ""}${run.stderr || ""}`;
    // a check that printed its own PASS line but then never exited (an open Redis handle) is reported as such, never as a clean pass; a FAIL line fails
    // the check even when the script exits 0
    const printedPass = new RegExp(`^${check}: PASS$|"status":\\s*"PASS"`, "m").test(output);
    const sawFail = /^FAIL\b/m.test(output);
    const result = sawFail ? "FAIL" : run.status === 0 ? "PASS" : run.status === null && printedPass ? "PASS_BUT_DID_NOT_EXIT" : "FAIL";
    results.push({ check, exit: run.status ?? (run.signal || "timeout"), result, first_error: result === "FAIL" ? (output.match(/^(?:FAIL .*|AssertionError.*|Error: .*)$/m) || ["(see output)"])[0].slice(0, 200) : null });
    console.log(`${result} ${check} (exit ${run.status ?? run.signal})`);
  }
} finally {
  try { docker("rm", "-f", REDIS); } catch { /* gone */ }
}
console.log(JSON.stringify({ suite: "local-only-env-checks", results }, null, 2));
process.exit(results.some((r) => r.result === "FAIL") ? 1 : 0);
