// Wave 7 Slice 3 -- Lifecycle Vocabulary Normalization smoke.
//
// Proves: (1) every REAL, evidence-verified status literal for each of
// the 10 object types resolves to its documented stage/terminal/
// awaitingHuman triple; (2) adversarial inputs (unknown literal, wrong
// object-type/status pairing, null/missing status, unexpected casing,
// the "monitoring"-on-a-recommendation case this slice's own research
// found to be a real-but-imprecise belief elsewhere in the codebase)
// always resolve honestly to stage "unknown", never to a false-positive
// active/pending/success guess; (3) the function is pure -- it never
// mutates its input object and produces identical output for identical
// input; (4) an end-to-end reporting pass across real-shaped objects of
// every type proves native status is untouched by normalization; (5)
// performance at 1 / 100 / 1,000 objects stays purely local (no DB/
// network), well under a generous budget.
//
// Pure-function proof only -- normalizeLifecycleStage() has no
// Supabase/network dependency.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { normalizeLifecycleStage, isKnownLifecycleObjectType } = require('../dist/oyi-core/presentation/lifecycleStage.js');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  - ${name}`);
    console.log(`        ${error.message}`);
  }
}

// -- 1. Real-literal coverage tables, one per object type, each entry
// grounded in the evidence recorded in
// docs/WAVE7_SLICE3_LIFECYCLE_VOCABULARY_NORMALIZATION.md --

const RECOMMENDATION = {
  open: ['awaiting_human_decision', false, true],
  pending: ['awaiting_human_decision', false, true],
  resolved: ['succeeded', true, false],
  dismissed: ['dismissed', true, false],
  expired: ['expired', true, false],
};
const PLAN = {
  planned: ['in_progress', false, false],
  awaiting_approval: ['awaiting_human_decision', false, true],
  prepared: ['in_progress', false, false],
  expired: ['expired', true, false],
  cancelled: ['cancelled', true, false],
};
const GOAL = {
  understood: ['not_started', false, false],
  proposed: ['awaiting_human_decision', false, true],
  confirmed: ['in_progress', false, false],
  active: ['in_progress', false, false],
  observing: ['in_progress', false, false],
  action_due: ['in_progress', false, false],
  executing: ['in_progress', false, false],
  verifying: ['in_progress', false, false],
  waiting: ['in_progress', false, false],
  reevaluating: ['in_progress', false, false],
  paused: ['paused', false, false],
  completed: ['succeeded', true, false],
  blocked: ['failed_execution', false, false],
  failed: ['failed_execution', true, false],
  cancelled: ['cancelled', true, false],
  expired: ['expired', true, false],
  needs_human: ['awaiting_human_input', false, true],
};
const TASK = {
  open: ['not_started', false, false],
  in_progress: ['in_progress', false, false],
  completed: ['succeeded', true, false],
  cancelled: ['cancelled', true, false],
};
const AUTOMATION_APPROVAL = {
  pending_approval: ['awaiting_human_decision', false, true],
  approved: ['in_progress', false, false],
  executing: ['in_progress', false, false],
  succeeded: ['succeeded', true, false],
  failed: ['failed_execution', true, false],
  verification_failed: ['failed_execution', true, false],
  rejected: ['rejected_by_human', true, false],
  cancelled: ['cancelled', true, false],
  expired: ['expired', true, false],
};
const AUTOMATION_RUN = {
  pending_confirmation: ['awaiting_human_decision', false, true],
  confirmed: ['in_progress', false, false],
  denied: ['rejected_by_human', true, false],
  expired: ['expired', true, false],
  recorded: ['in_progress', false, false],
  executed: ['succeeded', true, false],
  failed: ['failed_execution', true, false],
};
const WORKFLOW = {
  collecting_inputs: ['in_progress', false, false],
  awaiting_clarification: ['awaiting_human_input', false, true],
  ready_for_review: ['awaiting_human_decision', false, true],
  awaiting_approval: ['awaiting_human_decision', false, true],
  approved: ['in_progress', false, false],
  executing: ['in_progress', false, false],
  verifying: ['in_progress', false, false],
  answered: ['succeeded', true, false],
  empty: ['no_outcome', true, false],
  unavailable: ['no_outcome', true, false],
  unsupported: ['no_outcome', true, false],
  permission_restricted: ['policy_denied', true, false],
  completed: ['succeeded', true, false],
  failed: ['failed_execution', true, false],
  cancelled: ['cancelled', true, false],
  expired: ['expired', true, false],
  superseded: ['superseded', true, false],
};
const CONVERSATION_PROPOSAL = {
  pending: ['awaiting_human_decision', false, true],
  confirmed: ['in_progress', false, false],
  cancelled: ['cancelled', true, false],
  expired: ['expired', true, false],
  superseded: ['superseded', true, false],
  executed: ['succeeded', true, false],
};
const COMMUNICATION = {
  clarification_required: ['awaiting_human_input', false, true],
  rejected: ['policy_denied', true, false],
  ready: ['in_progress', false, false],
  confirmed: ['in_progress', false, false],
  sending: ['in_progress', false, false],
  sent: ['succeeded', true, false],
  failed: ['failed_execution', true, false],
  cancelled: ['cancelled', true, false],
};

const TABLES = {
  recommendation: RECOMMENDATION,
  plan: PLAN,
  goal: GOAL,
  task: TASK,
  automation_approval: AUTOMATION_APPROVAL,
  automation_run: AUTOMATION_RUN,
  workflow: WORKFLOW,
  conversation_proposal: CONVERSATION_PROPOSAL,
  communication: COMMUNICATION,
};

for (const [objectType, table] of Object.entries(TABLES)) {
  for (const [status, [stage, terminal, awaitingHuman]] of Object.entries(table)) {
    check(`${objectType}:${status} -> ${stage}`, () => {
      const result = normalizeLifecycleStage({ objectType, status });
      assert.equal(result.stage, stage);
      assert.equal(result.terminal, terminal);
      assert.equal(result.awaitingHuman, awaitingHuman);
      assert.equal(result.mapped, true);
      assert.equal(result.rawStatus, status);
      assert.equal(result.objectType, objectType);
    });
  }
}

// -- 2. handoff has no real Backend-side vocabulary: every status must
// honestly resolve to unknown --
check('handoff:anything -> unknown (Backend has no typed handoff vocabulary)', () => {
  for (const status of ['open', 'assigned', 'resolved', 'pending', '']) {
    const result = normalizeLifecycleStage({ objectType: 'handoff', status });
    assert.equal(result.stage, 'unknown');
    assert.equal(result.mapped, false);
  }
});

// -- 3. adversarial: unknown/wrong-pairing/null/casing must never
// silently resolve to a false-positive stage --
check('unrecognized literal -> unknown, not a guess', () => {
  const result = normalizeLifecycleStage({ objectType: 'goal', status: 'quantum_entangled' });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
  assert.equal(result.terminal, false);
});

check('"monitoring" on a recommendation -> unknown, not silently accepted', () => {
  // This is the exact literal this slice's own research found treated as
  // a live recommendation status elsewhere in the codebase (Slice 1's own
  // LIVE_CANONICAL_RECOMMENDATION_STATUSES constant, and independently in
  // executive.ts's unresolvedIssues filter) despite no real writer ever
  // setting operational_recommendations.status = "monitoring". The mapper
  // must not repeat that imprecision.
  const result = normalizeLifecycleStage({ objectType: 'recommendation', status: 'monitoring' });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
});

check('a real plan literal against the wrong object type -> unknown', () => {
  // "awaiting_approval" is real for plan/workflow but was never a
  // recommendation status.
  const result = normalizeLifecycleStage({ objectType: 'recommendation', status: 'awaiting_approval' });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
});

check('null status -> unknown', () => {
  const result = normalizeLifecycleStage({ objectType: 'goal', status: null });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
  assert.equal(result.rawStatus, null);
});

check('undefined status -> unknown', () => {
  const result = normalizeLifecycleStage({ objectType: 'goal', status: undefined });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
});

check('empty-string status -> unknown', () => {
  const result = normalizeLifecycleStage({ objectType: 'goal', status: '' });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
});

check('whitespace-only status -> unknown', () => {
  const result = normalizeLifecycleStage({ objectType: 'goal', status: '   ' });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
});

check('non-string status (number) -> unknown, no throw', () => {
  const result = normalizeLifecycleStage({ objectType: 'goal', status: 42 });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
});

check('unrecognized objectType -> unknown, no throw', () => {
  const result = normalizeLifecycleStage({ objectType: 'not_a_real_object_type', status: 'active' });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
});

check('missing objectType -> unknown, no throw', () => {
  const result = normalizeLifecycleStage({ status: 'active' });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
});

check('casing is normalized: "ACTIVE"/"Active"/"active" for goal all resolve the same', () => {
  const lower = normalizeLifecycleStage({ objectType: 'goal', status: 'active' });
  const upper = normalizeLifecycleStage({ objectType: 'goal', status: 'ACTIVE' });
  const mixed = normalizeLifecycleStage({ objectType: 'goal', status: ' Active ' });
  assert.equal(lower.stage, 'in_progress');
  assert.equal(upper.stage, 'in_progress');
  assert.equal(mixed.stage, 'in_progress');
  assert.equal(upper.mapped, true);
});

check('isKnownLifecycleObjectType distinguishes real vs fabricated object types', () => {
  assert.equal(isKnownLifecycleObjectType('goal'), true);
  assert.equal(isKnownLifecycleObjectType('handoff'), true);
  assert.equal(isKnownLifecycleObjectType('decision'), false);
  assert.equal(isKnownLifecycleObjectType(''), false);
  assert.equal(isKnownLifecycleObjectType(null), false);
});

// -- 4. purity: never mutates input, deterministic for identical input --
check('normalizeLifecycleStage never mutates its input object', () => {
  const input = { objectType: 'goal', status: 'active' };
  const snapshot = JSON.parse(JSON.stringify(input));
  normalizeLifecycleStage(input);
  assert.deepEqual(input, snapshot);
});

check('normalizeLifecycleStage is deterministic for identical input', () => {
  const a = normalizeLifecycleStage({ objectType: 'plan', status: 'awaiting_approval' });
  const b = normalizeLifecycleStage({ objectType: 'plan', status: 'awaiting_approval' });
  assert.deepEqual(a, b);
});

// -- 5. end-to-end reporting pass across real-shaped native objects of
// every type, proving native status is untouched --
check('end-to-end: normalizing a heterogeneous batch never touches native status fields', () => {
  const nativeObjects = [
    { kind: 'recommendation', id: 'recommendation:abc', status: 'pending', summary: 'Investigate device offline pattern.' },
    { kind: 'plan', id: 'automation:xyz', status: 'awaiting_approval', approval_state: 'required' },
    { kind: 'goal', id: 'goal:1', status: 'active', objective: 'Follow up on a development enquiry.' },
    { kind: 'task', id: 'task:1', status: 'in_progress', title: 'Prepare JV memo' },
    { kind: 'automation_approval', id: 'approval:1', status: 'pending_approval' },
    { kind: 'automation_run', id: 'execution:1', status: 'executed' },
    { kind: 'workflow', id: 'workflow:1', status: 'awaiting_clarification' },
    { kind: 'handoff', id: 'handoff:1', status: 'unknown_remote_value' },
  ];
  const before = JSON.parse(JSON.stringify(nativeObjects));
  const report = nativeObjects.map((item) => ({
    id: item.id,
    nativeStatus: item.status,
    ...normalizeLifecycleStage({ objectType: item.kind, status: item.status }),
  }));
  assert.deepEqual(nativeObjects, before);
  assert.equal(report.find((r) => r.id === 'recommendation:abc').stage, 'awaiting_human_decision');
  assert.equal(report.find((r) => r.id === 'automation:xyz').stage, 'awaiting_human_decision');
  assert.equal(report.find((r) => r.id === 'goal:1').stage, 'in_progress');
  assert.equal(report.find((r) => r.id === 'task:1').stage, 'in_progress');
  assert.equal(report.find((r) => r.id === 'approval:1').stage, 'awaiting_human_decision');
  assert.equal(report.find((r) => r.id === 'execution:1').stage, 'succeeded');
  assert.equal(report.find((r) => r.id === 'workflow:1').stage, 'awaiting_human_input');
  assert.equal(report.find((r) => r.id === 'handoff:1').stage, 'unknown');
  // every native status field must be readable, unchanged, from the
  // original object after normalization
  for (const item of nativeObjects) {
    assert.ok(typeof item.status === 'string');
  }
});

// -- 6. performance: 1 / 100 / 1,000 objects, purely local --
check('performance: 1,000 normalizations complete quickly with no I/O', () => {
  const objectTypes = Object.keys(TABLES);
  const start = process.hrtime.bigint();
  for (let i = 0; i < 1000; i += 1) {
    const objectType = objectTypes[i % objectTypes.length];
    const statuses = Object.keys(TABLES[objectType]);
    const status = statuses[i % statuses.length];
    normalizeLifecycleStage({ objectType, status });
  }
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(elapsedMs < 200, `1,000 normalizations took ${elapsedMs}ms, expected < 200ms`);
});

check('performance: 100 normalizations complete quickly', () => {
  const start = process.hrtime.bigint();
  for (let i = 0; i < 100; i += 1) normalizeLifecycleStage({ objectType: 'goal', status: 'active' });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(elapsedMs < 50, `100 normalizations took ${elapsedMs}ms, expected < 50ms`);
});

check('performance: a single normalization completes quickly', () => {
  const start = process.hrtime.bigint();
  normalizeLifecycleStage({ objectType: 'goal', status: 'active' });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(elapsedMs < 20, `1 normalization took ${elapsedMs}ms, expected < 20ms`);
});

console.log('');
console.log(`=== wave7-slice3-lifecycle-vocabulary-smoke: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
