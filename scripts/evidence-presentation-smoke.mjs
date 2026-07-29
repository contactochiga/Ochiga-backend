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

const healthBuilder = runtime.match(/function buildHealthAnswer[\s\S]*?function buildCapabilityAnswer/)?.[0] || "";
const activityBuilder = runtime.match(/function buildRecentChangesAnswer[\s\S]*?function buildFailureHistoryAnswer/)?.[0] || "";
const relationshipBuilder = runtime.match(/function buildRelationshipsAnswer[\s\S]*?function buildCommandOutcomeAnswer/)?.[0] || "";
const commandBuilder = runtime.match(/function buildCommandOutcomeAnswer[\s\S]*?function buildReportAnswer/)?.[0] || "";

check("stale evidence cannot produce unqualified current health", () => {
  assert.match(runtime, /truthFromFreshness/);
  assert.match(runtime, /providerHealthSentence/);
  assert.match(healthBuilder, /truth\.current/);
  assert.doesNotMatch(healthBuilder, /The controller connection is \$\{provider\}/);
});

check("device activity excludes internal noise and duplicate timestamps", () => {
  assert.match(runtime, /isUsefulDeviceActivityFact/);
  assert.match(runtime, /proximity\\\.awareness|tool\\\.requested|response\\\.generated|audit\\\.recorded/);
  assert.match(runtime, /safeDateLabel\(fact\.occurred_at,\s*""\)/);
  assert.doesNotMatch(activityBuilder, /system event/);
  assert.match(activityBuilder, /safeDateLabel\(fact\.occurred_at,\s*""\)/);
});

check("relationship answer is resident-facing and contains no raw identifiers or policy terms", () => {
  assert.match(relationshipBuilder, /Parent hub/);
  assert.match(relationshipBuilder, /Home:/);
  assert.doesNotMatch(relationshipBuilder, /object\.home_id|object\.parent_id|Provider:|Permitted surface|Facility projection|resident-private/);
});

check("command outcome uses natural truth wording instead of raw lifecycle enums", () => {
  assert.match(commandBuilder, /accepted, and a fresh follow-up reading confirmed/);
  assert.match(commandBuilder, /did not directly observe the connected appliance/);
  assert.doesNotMatch(commandBuilder, /Provider status:|State confirmation:|Physical effect:/);
});

check("answer quality gate blocks leaked internal language before persistence", () => {
  assert.match(runtime, /enforceResidentAnswerQuality/);
  assert.match(runtime, /conversation_answer_quality_blocked/);
  for (const token of ["raw_uuid", "invalid_date", "internal_event_code", "privacy_policy_term", "freshness_contradiction"]) {
    assert.match(runtime, new RegExp(token));
  }
});

console.log("evidence-presentation-smoke passed");
