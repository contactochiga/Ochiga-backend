import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtime = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalConversationRuntime.ts"), "utf8");
const turnResolution = fs.readFileSync(path.join(root, "src/oyi-core/runtime/canonicalTurnResolution.ts"), "utf8");
const deviceAnswers = fs.readFileSync(path.join(root, "src/oyi-core/domains/devices/deviceConversationAnswers.ts"), "utf8");
const deviceEvidence = fs.readFileSync(path.join(root, "src/oyi-core/domains/devices/deviceEvidence.ts"), "utf8");
const answerPresentation = fs.readFileSync(path.join(root, "src/oyi-core/presentation/conversationAnswerPresentation.ts"), "utf8");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const healthBuilder = deviceAnswers.match(/function buildDeviceHealthAnswer[\s\S]*?export function buildDeviceFailureHistoryAnswer/)?.[0] || "";
const activityBuilder = deviceEvidence.match(/function loadRecentDeviceChangeFacts[\s\S]*?export async function loadLatestCommandFact/)?.[0] || "";
const relationshipBuilder = deviceAnswers.match(/function buildDeviceRelationshipsAnswer[\s\S]*?export function buildDeviceControlProposal/)?.[0] || "";
const commandBuilder = answerPresentation.match(/function buildCommandOutcomeAnswer[\s\S]*?export function buildDeviceAvailabilityInventoryAnswer/)?.[0] || "";

check("stale evidence cannot produce unqualified current health", () => {
  assert.match(deviceEvidence, /truthFromFreshness/);
  assert.match(deviceAnswers, /providerHealthSentence/);
  assert.match(healthBuilder, /truth\.current/);
  assert.doesNotMatch(healthBuilder, /The controller connection is \$\{provider\}/);
});

check("device activity excludes internal noise and duplicate timestamps", () => {
  assert.match(turnResolution, /isUsefulDeviceActivityFact/);
  assert.doesNotMatch(runtime, /function isUsefulDeviceActivityFact/);
  assert.match(deviceEvidence, /proximity\\\.awareness|tool\\\.requested|response\\\.generated|audit\\\.recorded/);
  assert.match(answerPresentation, /safeDateLabel\(fact\.occurred_at,\s*""\)/);
  assert.doesNotMatch(activityBuilder, /system event/);
  assert.match(answerPresentation, /safeDateLabel\(fact\.occurred_at,\s*""\)/);
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
  assert.match(turnResolution, /enforceResidentAnswerQuality/);
  assert.match(turnResolution, /conversation_answer_quality_blocked/);
  for (const token of ["raw_uuid", "invalid_date", "internal_event_code", "privacy_policy_term", "freshness_contradiction"]) {
    assert.match(turnResolution, new RegExp(token));
  }
});

console.log("evidence-presentation-smoke passed");
