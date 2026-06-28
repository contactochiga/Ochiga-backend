#!/usr/bin/env node
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";

const { shouldUseOyiCoreCompatibilityChatForTest } = await import("../dist/services/oyiUnifiedIntelligenceService.js");

const cases = [
  ["What needs attention right now?", true],
  ["Explain the current security posture.", true],
  ["What should we do next?", true],
  ["Approve the pending visitor.", false],
  ["Assign this request to Ade.", false],
  ["Turn off the living room light.", false],
];

let failed = 0;

for (const [message, expected] of cases) {
  const actual = shouldUseOyiCoreCompatibilityChatForTest(message);
  if (actual !== expected) {
    failed += 1;
    console.error(`FAIL compatibility chat routing: "${message}" -> ${actual} (expected ${expected})`);
  } else {
    console.log(`PASS compatibility chat routing: "${message}"`);
  }
}

if (failed) process.exit(1);

