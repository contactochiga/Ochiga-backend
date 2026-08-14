import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Programme 4 Phase H — structural verification that the proactive
// intelligence scheduler is wired safely, following the same
// static-assertion pattern as scripts/canonical-runtime-structure-smoke.mjs.
// The underlying evaluation logic (runIntelligenceOrchestrator,
// evaluateOpenPredictions, runProactiveDelivery) is already behaviorally
// tested end-to-end by smoke:programme3-prediction-forecasting; this script
// only certifies the NEW scheduler wiring added in this programme.

const schedulerSource = await readFile(new URL("../src/oyi-core/runtime/proactiveIntelligenceScheduler.ts", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");

// Code-only view, comments stripped — this file's own comments legitimately
// document the absence of ActionService/WorkflowService/promoteLearningParameter
// calls, which would otherwise false-positive a bare word-match assertion.
const schedulerCode = schedulerSource
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

check("scheduler is disabled by default (explicit opt-in env var required)", () => {
  assert.match(schedulerSource, /OYI_PROACTIVE_SCHEDULER_ENABLED/);
  assert.match(schedulerSource, /ENABLED\s*=\s*String\(process\.env\.OYI_PROACTIVE_SCHEDULER_ENABLED[^)]*\)\.toLowerCase\(\)\s*===\s*"true"/);
  assert.match(schedulerSource, /if \(!ENABLED && !LEARNING_PROPOSAL_ENABLED\)/);
});

check("learning-proposal pass is independently disabled by default, not coupled to the proactive tick flag", () => {
  assert.match(schedulerSource, /OYI_LEARNING_PROPOSAL_ENABLED/);
  assert.match(schedulerSource, /LEARNING_PROPOSAL_ENABLED\s*=\s*String\(process\.env\.OYI_LEARNING_PROPOSAL_ENABLED[^)]*\)\.toLowerCase\(\)\s*===\s*"true"/);
  assert.match(schedulerSource, /if \(LEARNING_PROPOSAL_ENABLED\)/);
  assert.match(schedulerSource, /import \{ runLearningProposalPass \} from "\.\.\/domains\/intelligence\/learningProposalPass"/);
});

check("scheduler reuses existing BullMQ infrastructure, not a competing scheduler", () => {
  assert.match(schedulerSource, /from "bullmq"/);
  assert.match(schedulerSource, /new Queue\(/);
  assert.match(schedulerSource, /new Worker\(/);
  assert.doesNotMatch(schedulerSource, /node-cron|node-schedule|setInterval\(/);
});

check("scheduler queue name has no colon (BullMQ rule, matches automationWorker.ts convention)", () => {
  assert.doesNotMatch(schedulerSource, /new Queue\("[^"]*:[^"]*"/);
});

check("scheduler reuses Programme 3's tested evaluation functions, does not reimplement them", () => {
  assert.match(schedulerSource, /import \{ runIntelligenceOrchestrator \} from "\.\.\/domains\/intelligence\/intelligenceOrchestrator"/);
  assert.match(schedulerSource, /import \{ evaluateOpenPredictions \} from "\.\.\/domains\/intelligence\/outcomeEvaluation"/);
});

check("scheduler never performs physical device execution", () => {
  assert.doesNotMatch(schedulerCode, /ActionService|WorkflowService|routeAiCommand|executeDeviceCommandForActor|\.execute\(/);
});

check("scheduler never automatically promotes a learning parameter", () => {
  assert.doesNotMatch(schedulerCode, /promoteLearningParameter/);
});

check("scheduler enforces bounded batch size, a per-run delivery cap, and per-home failure isolation", () => {
  assert.match(schedulerSource, /OYI_PROACTIVE_SCHEDULER_BATCH_SIZE/);
  assert.match(schedulerSource, /OYI_PROACTIVE_SCHEDULER_MAX_DELIVERIES_PER_RUN/);
  assert.match(schedulerSource, /try \{\s*\n\s*const delivered = await runOneHome/);
  assert.match(schedulerSource, /catch \(error\) \{\s*\n\s*summary\.homes_failed \+= 1;/);
});

check("scheduler guards against overlapping ticks within one process", () => {
  assert.match(schedulerSource, /let runInProgress = false/);
  assert.match(schedulerSource, /if \(runInProgress\)/);
});

check("scheduler paginates homes with a wraparound cursor instead of loading every home every tick", () => {
  assert.match(schedulerSource, /cursorHomeId/);
  assert.match(schedulerSource, /Wrapped past the end/);
});

check("scheduler emits observable counters and a structured per-tick log", () => {
  assert.match(schedulerSource, /operationalMetrics\.increment\("oyi_proactive_scheduler_ticks_total"/);
  assert.match(schedulerSource, /operationalMetrics\.increment\("oyi_proactive_scheduler_homes_processed_total"/);
  assert.match(schedulerSource, /operationalMetrics\.increment\("oyi_proactive_scheduler_deliveries_sent_total"/);
  assert.match(schedulerSource, /logger\.info\("oyi_proactive_scheduler_tick_completed"/);
});

check("worker.ts starts the proactive intelligence scheduler alongside existing workers", () => {
  assert.match(workerSource, /import \{ startProactiveIntelligenceScheduler \} from "\.\/oyi-core\/runtime\/proactiveIntelligenceScheduler"/);
  assert.match(workerSource, /startProactiveIntelligenceScheduler\(\)/);
});

if (process.exitCode === 1) {
  console.error("oyi-programme4-proactive-scheduler-smoke: FAILED");
  process.exit(1);
}
console.log("oyi-programme4-proactive-scheduler-smoke: PASS");
