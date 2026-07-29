import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtime = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalConversationRuntime.ts"), "utf8");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check("exact-target current reads request one bounded Runtime V2 refresh", () => {
  assert.match(runtime, /exactTargetLiveReadIntent/);
  assert.match(runtime, /deviceRuntimeStateService\.refresh\(deviceId,\s*"high",\s*"conversation_exact_target_live_read"\)/);
  assert.match(runtime, /Promise\.race\(\[refreshPromise,\s*timeoutPromise\]\)/);
});

check("broad reads are excluded from synchronous live refresh", () => {
  assert.match(runtime, /contract\.scope_mode === "exact_target"/);
  assert.match(runtime, /contract\.operation_class === "read"/);
  assert.doesNotMatch(runtime.match(/function requestBoundedLiveEvidence[\s\S]*?function truthFromFreshness/)?.[0] || "", /refreshMany/);
});

check("live evidence path is observable and falls back truthfully on timeout", () => {
  for (const token of [
    "conversation_live_evidence_requested",
    "conversation_live_evidence_completed",
    "conversation_live_evidence_timed_out",
  ]) assert.match(runtime, new RegExp(token));
  assert.match(runtime, /existing_freshness/);
});

console.log("exact-target-live-read-smoke passed");
