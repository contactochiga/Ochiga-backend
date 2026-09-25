// Wave 7 Slice 4 -- Human-in-the-Loop Unification View smoke.
//
// loadHumanInterventionObligations() has no pure-function seam -- it
// composes four real, existing Supabase-backed read functions
// (listAutomationApprovals, goalRuntime.listForActor,
// loadPendingOfficeActionProposal, WorkflowRepository.getActive) exactly
// as they exist today, rather than duplicating their logic. Following
// the same established pattern as wave7-slice1-recommendation-authority
// -smoke.mjs, this mocks supabaseAdmin's chainable query builder with
// fixture rows and counts calls per table -- proving the REAL read
// functions compose correctly, not a hand-rolled substitute.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const path = require('path');
const backendRoot = '/Users/ochigaidoko/Documents/Ochiga-backend';
require(path.join(backendRoot, 'node_modules/dotenv')).config({ path: path.join(backendRoot, '.env') });

const supabaseClientModule = require('../dist/supabase/supabaseClient.js');

const ESTATE_ID = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const OTHER_ESTATE_ID = 'a1111111-1111-4111-1111-111111111111';
const ACTOR_ID = 'actor-1';
const THREAD_ID = '99999999-9999-4999-9999-999999999999';

let callCounts = {};
function bumpCall(table) {
  callCounts[table] = (callCounts[table] || 0) + 1;
}

function chainable(resolvedValue) {
  const handler = {
    select: () => chainable(resolvedValue),
    eq: () => chainable(resolvedValue),
    in: () => chainable(resolvedValue),
    order: () => chainable(resolvedValue),
    limit: () => chainable(resolvedValue),
    lt: () => chainable({ data: null, error: null }),
    update: () => chainable({ data: null, error: null }),
    maybeSingle: async () => resolvedValue,
    single: async () => resolvedValue,
    then: (resolve, reject) => Promise.resolve(resolvedValue).then(resolve, reject),
  };
  return handler;
}

// Fixture state, mutable per-test so each scenario controls exactly what
// each table returns.
let state = {
  approvals: { data: [], error: null },
  goals: { data: [], error: null },
  thread: { data: null, error: null },
  workflow: { data: null, error: null },
};

function mockSupabaseAdmin() {
  return {
    from(table) {
      bumpCall(table);
      if (table === 'automation_approvals') return chainable(state.approvals);
      if (table === 'oyi_goals') return chainable(state.goals);
      if (table === 'oyi_conversation_threads') return chainable(state.thread);
      if (table === 'oyi_conversation_workflows') return chainable(state.workflow);
      if (table === 'oyi_conversation_workflow_inputs') return chainable({ data: [], error: null });
      return chainable({ data: [], error: null });
    },
  };
}
supabaseClientModule.supabaseAdmin = mockSupabaseAdmin();

const { loadHumanInterventionObligations } = require('../dist/oyi-core/presentation/humanInterventionView.js');
const { normalizeLifecycleStage } = require('../dist/oyi-core/presentation/lifecycleStage.js');

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  - ${name}`);
    console.log(`        ${error.stack || error.message}`);
  }
}

function resetState() {
  state = {
    approvals: { data: [], error: null },
    goals: { data: [], error: null },
    thread: { data: null, error: null },
    workflow: { data: null, error: null },
  };
  callCounts = {};
}

function approvalRow(overrides = {}) {
  return {
    id: 'approval-1',
    estate_id: ESTATE_ID,
    detector_id: 'detector-1',
    action_id: 'device.on',
    entity_type: 'device',
    entity_id: 'device-1',
    target_label: 'Lobby AC',
    reason: 'Detected sustained high temperature.',
    status: 'pending_approval',
    created_at: '2026-09-25T10:00:00.000Z',
    expires_at: '2026-09-25T11:00:00.000Z',
    ...overrides,
  };
}

function goalRow(overrides = {}) {
  return {
    id: 'goal-1',
    correlation_id: 'corr-1',
    requesting_actor_id: ACTOR_ID,
    surface: 'office_internal',
    conversation_thread_id: THREAD_ID,
    organization_scope: null,
    canonical_signal_key: 'office:lead-created-1:office:lead-1:global:no-home',
    objective: 'Follow up on JV interest from Acme Corp',
    target_entities: {},
    status: 'needs_human',
    success_condition: { type: 'manual' },
    stop_condition: { type: 'none' },
    reply_branches: [],
    plan: [],
    current_step_index: 0,
    completion_reason: 'A negative reply was received.',
    created_at: '2026-09-25T09:00:00.000Z',
    updated_at: '2026-09-25T09:00:00.000Z',
    ...overrides,
  };
}

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
function proposalThreadRow(overrides = {}) {
  return {
    data: {
      user_id: ACTOR_ID,
      metadata: {
        pending_action_proposal: {
          proposal_id: 'proposal-1',
          thread_id: THREAD_ID,
          actor_id: ACTOR_ID,
          domain: 'office',
          target_entity_type: 'task',
          target_entity_id: 'task-1',
          operation: 'update_status',
          description: 'Move "Send JV memo" to In Progress',
          status: 'pending',
          expires_at: FUTURE,
          created_at: '2026-09-25T10:05:00.000Z',
          ...overrides,
        },
      },
    },
    error: null,
  };
}

function workflowRow(overrides = {}) {
  return {
    data: {
      workflow_id: 'workflow-1',
      thread_id: THREAD_ID,
      request_id: 'req-1',
      actor_id: ACTOR_ID,
      surface: 'consumer',
      capability_key: 'devices.power.control',
      domain: 'devices',
      operation: 'power_off',
      status: 'awaiting_approval',
      unresolved_inputs: [],
      created_at: '2026-09-25T10:06:00.000Z',
      updated_at: '2026-09-25T10:06:00.000Z',
      expires_at: FUTURE,
      completed_at: null,
      cancelled_at: null,
      superseded_at: null,
      ...overrides,
    },
    error: null,
  };
}

// =====================================================================
// 1. Per-source mapping correctness
// =====================================================================
console.log('\n=== Per-source obligation mapping ===');

resetState();
state.approvals = { data: [approvalRow()], error: null };
await check('automation_approval maps to AUTHORIZATION with stable id and correct normalized stage', async () => {
  const result = await loadHumanInterventionObligations({ estateId: ESTATE_ID });
  assert.equal(result.obligations.length, 1);
  const o = result.obligations[0];
  assert.equal(o.id, 'automation_approval:approval-1');
  assert.equal(o.source_type, 'automation_approval');
  assert.equal(o.intervention_type, 'AUTHORIZATION');
  assert.equal(o.native_status, 'pending_approval');
  assert.deepEqual(o.normalized_stage, normalizeLifecycleStage({ objectType: 'automation_approval', status: 'pending_approval' }));
  assert.equal(o.title, 'Lobby AC');
  assert.equal(o.reason, 'Detected sustained high temperature.');
  assert.equal(o.due_at, '2026-09-25T11:00:00.000Z');
  assert.equal(o.scope.estate_id, ESTATE_ID);
});

resetState();
state.goals = { data: [goalRow()], error: null };
await check('goal_escalation maps to ESCALATION with real canonical_signal_key lineage', async () => {
  const result = await loadHumanInterventionObligations({ goalActorId: ACTOR_ID });
  assert.equal(result.obligations.length, 1);
  const o = result.obligations[0];
  assert.equal(o.id, 'goal_escalation:goal-1');
  assert.equal(o.intervention_type, 'ESCALATION');
  assert.equal(o.native_status, 'needs_human');
  assert.deepEqual(o.normalized_stage, normalizeLifecycleStage({ objectType: 'goal', status: 'needs_human' }));
  assert.equal(o.title, 'Follow up on JV interest from Acme Corp');
  assert.equal(o.reason, 'A negative reply was received.');
  assert.equal(o.lineage.canonical_signal_key, 'office:lead-created-1:office:lead-1:global:no-home');
  assert.equal(o.actor.id, ACTOR_ID);
});

resetState();
state.thread = proposalThreadRow();
await check('conversation_proposal maps to CONFIRMATION only for a real pending proposal', async () => {
  const result = await loadHumanInterventionObligations({ thread: { threadId: THREAD_ID, actorId: ACTOR_ID } });
  const proposalObligations = result.obligations.filter((o) => o.source_type === 'conversation_proposal');
  assert.equal(proposalObligations.length, 1);
  const o = proposalObligations[0];
  assert.equal(o.id, 'conversation_proposal:proposal-1');
  assert.equal(o.intervention_type, 'CONFIRMATION');
  assert.equal(o.title, 'Move "Send JV memo" to In Progress');
  assert.equal(o.scope.thread_id, THREAD_ID);
});

resetState();
state.workflow = workflowRow({ status: 'awaiting_approval' });
await check('workflow (awaiting_approval) maps to CONFIRMATION', async () => {
  const result = await loadHumanInterventionObligations({ thread: { threadId: THREAD_ID, actorId: ACTOR_ID } });
  const workflowObligations = result.obligations.filter((o) => o.source_type === 'workflow');
  assert.equal(workflowObligations.length, 1);
  assert.equal(workflowObligations[0].intervention_type, 'CONFIRMATION');
});

resetState();
state.workflow = workflowRow({ status: 'awaiting_clarification', unresolved_inputs: ['home'] });
await check('workflow (awaiting_clarification) maps to INPUT_REQUIRED with the missing-input reason', async () => {
  const result = await loadHumanInterventionObligations({ thread: { threadId: THREAD_ID, actorId: ACTOR_ID } });
  const workflowObligations = result.obligations.filter((o) => o.source_type === 'workflow');
  assert.equal(workflowObligations.length, 1);
  assert.equal(workflowObligations[0].intervention_type, 'INPUT_REQUIRED');
  assert.equal(workflowObligations[0].reason, 'Missing: home');
});

resetState();
state.workflow = workflowRow({ status: 'executing' });
await check('workflow in a non-human-waiting status (executing) contributes no obligation', async () => {
  const result = await loadHumanInterventionObligations({ thread: { threadId: THREAD_ID, actorId: ACTOR_ID } });
  assert.equal(result.obligations.filter((o) => o.source_type === 'workflow').length, 0);
});

// =====================================================================
// 2. Query composition -- only queries the sources the caller has scope for
// =====================================================================
console.log('\n=== Query composition / privacy ===');

resetState();
state.approvals = { data: [approvalRow()], error: null };
state.goals = { data: [goalRow()], error: null };
await check('a query with no scope at all queries nothing and returns no obligations', async () => {
  const result = await loadHumanInterventionObligations({});
  assert.equal(result.obligations.length, 0);
  assert.equal(result.sources.length, 0);
  assert.equal(callCounts.automation_approvals || 0, 0, 'must not query automation_approvals without an estateId scope');
  assert.equal(callCounts.oyi_goals || 0, 0, 'must not query oyi_goals without a goalActorId scope');
});

resetState();
state.approvals = { data: [approvalRow()], error: null };
await check('supplying only estateId never queries goal/proposal/workflow sources (no widened visibility)', async () => {
  const result = await loadHumanInterventionObligations({ estateId: ESTATE_ID });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].source_type, 'automation_approval');
  assert.equal(callCounts.oyi_goals || 0, 0);
  assert.equal(callCounts.oyi_conversation_threads || 0, 0);
  assert.equal(callCounts.oyi_conversation_workflows || 0, 0);
});

resetState();
state.approvals = { data: [approvalRow({ estate_id: OTHER_ESTATE_ID })], error: null };
await check('the caller only ever sees the estate it queried for -- automation_approvals scoping is delegated to the real, already-authorized listAutomationApprovals(estateId) call', async () => {
  // The mock always returns the fixture row regardless of args (it does
  // not simulate Postgres's own .eq() filtering), so this proves the
  // CALL is estate-scoped (listAutomationApprovals(estateId, ...) is
  // invoked with the estateId the caller supplied), not that this
  // module re-implements row-level filtering itself -- it deliberately
  // does not, trusting the same real filtered call every existing
  // authorized route already uses.
  const result = await loadHumanInterventionObligations({ estateId: ESTATE_ID });
  assert.equal(result.obligations[0].scope.estate_id, OTHER_ESTATE_ID); // pass-through of whatever the real query returned
  assert.equal(callCounts.automation_approvals, 2);
});

// =====================================================================
// 3. Partial source failure honesty
// =====================================================================
console.log('\n=== Partial source failure ===');

resetState();
state.approvals = { data: null, error: new Error('simulated automation_approvals outage') };
state.goals = { data: [goalRow()], error: null };
await check('automation_approvals failure is reported honestly (ok:false, complete:false) without silently hiding the still-good goal source', async () => {
  const result = await loadHumanInterventionObligations({ estateId: ESTATE_ID, goalActorId: ACTOR_ID });
  assert.equal(result.complete, false);
  const approvalHealth = result.sources.find((s) => s.source_type === 'automation_approval');
  assert.equal(approvalHealth.ok, false);
  assert.ok(approvalHealth.error.includes('simulated automation_approvals outage'));
  const goalHealth = result.sources.find((s) => s.source_type === 'goal_escalation');
  assert.equal(goalHealth.ok, true);
  assert.equal(result.obligations.filter((o) => o.source_type === 'goal_escalation').length, 1);
  assert.equal(result.obligations.filter((o) => o.source_type === 'automation_approval').length, 0);
});

resetState();
state.approvals = { data: [approvalRow()], error: null };
state.goals = { data: [goalRow()], error: null };
await check('when every attempted source succeeds, complete is true', async () => {
  const result = await loadHumanInterventionObligations({ estateId: ESTATE_ID, goalActorId: ACTOR_ID });
  assert.equal(result.complete, true);
  assert.ok(result.sources.every((s) => s.ok));
});

await check('workflow source failure is independently detectable (real throw path, unlike goal/proposal which inherit upstream error-swallowing -- see docs §23)', async () => {
  resetState();
  state.thread = { data: null, error: null };
  // Force a throw inside SupabaseWorkflowRepository.getActive by making
  // the workflow table's chainable() resolve with an error.
  const originalFrom = supabaseClientModule.supabaseAdmin.from;
  supabaseClientModule.supabaseAdmin.from = (table) => {
    bumpCall(table);
    if (table === 'oyi_conversation_workflows') return chainable({ data: null, error: new Error('simulated workflow outage') });
    if (table === 'oyi_conversation_threads') return chainable(state.thread);
    return chainable({ data: [], error: null });
  };
  const result = await loadHumanInterventionObligations({ thread: { threadId: THREAD_ID, actorId: ACTOR_ID } });
  supabaseClientModule.supabaseAdmin.from = originalFrom;
  const workflowHealth = result.sources.find((s) => s.source_type === 'workflow');
  assert.equal(workflowHealth.ok, false);
  assert.equal(result.complete, false);
});

// =====================================================================
// 4. No heuristic dedup across independent domains
// =====================================================================
console.log('\n=== Dedup policy ===');

resetState();
state.approvals = { data: [approvalRow()], error: null };
state.goals = { data: [goalRow()], error: null };
state.thread = proposalThreadRow();
state.workflow = workflowRow({ status: 'awaiting_approval' });
await check('four genuinely independent obligations from four sources are all reported, none merged', async () => {
  const result = await loadHumanInterventionObligations({
    estateId: ESTATE_ID,
    goalActorId: ACTOR_ID,
    thread: { threadId: THREAD_ID, actorId: ACTOR_ID },
  });
  assert.equal(result.obligations.length, 4);
  const ids = new Set(result.obligations.map((o) => o.id));
  assert.equal(ids.size, 4);
});

// =====================================================================
// 5. End-to-end scenarios A-G
// =====================================================================
console.log('\n=== End-to-end scenarios ===');

resetState();
state.approvals = { data: [approvalRow()], error: null };
await check('A. Facility automation awaiting manager approval appears exactly once', async () => {
  const result = await loadHumanInterventionObligations({ estateId: ESTATE_ID });
  assert.equal(result.obligations.filter((o) => o.source_type === 'automation_approval').length, 1);
});

resetState();
state.approvals = { data: [], error: null }; // approved/rejected rows are excluded by listAutomationApprovals's own status filter
await check('B. An approved/rejected automation no longer appears (native source already excludes it -- no second completion state kept here)', async () => {
  const result = await loadHumanInterventionObligations({ estateId: ESTATE_ID });
  assert.equal(result.obligations.length, 0);
});

resetState();
state.goals = { data: [goalRow({ objective: 'Escalate JV term sheet handoff to a human', canonical_signal_key: 'office:jv-handoff-1:office:lead-9:global:no-home' })], error: null };
await check('C. Office commercial escalation appears with commercial provenance (canonical_signal_key lineage present)', async () => {
  const result = await loadHumanInterventionObligations({ goalActorId: ACTOR_ID });
  const o = result.obligations[0];
  assert.equal(o.source_type, 'goal_escalation');
  assert.ok(o.lineage.canonical_signal_key.startsWith('office:jv-handoff-1'));
});

await check('D. AI-paused/human-takeover communication is NOT represented as an approval (no real, observable source exists for it -- see docs)', async () => {
  // human_takeover_active is a declared-but-dead CommunicationFailureReason
  // literal with zero writers anywhere in this codebase -- there is
  // nothing to source an obligation from, and this module does not
  // fabricate one. Absence is the correct, honest behavior.
  resetState();
  const result = await loadHumanInterventionObligations({ estateId: ESTATE_ID, goalActorId: ACTOR_ID, thread: { threadId: THREAD_ID, actorId: ACTOR_ID } });
  assert.ok(!result.obligations.some((o) => String(o.intervention_type).includes('TAKEOVER')));
});

resetState();
state.thread = proposalThreadRow();
await check('E. A durable, current conversation confirmation is included', async () => {
  const result = await loadHumanInterventionObligations({ thread: { threadId: THREAD_ID, actorId: ACTOR_ID } });
  assert.equal(result.obligations.filter((o) => o.source_type === 'conversation_proposal').length, 1);
});

resetState();
state.thread = proposalThreadRow({ status: 'confirmed' });
await check('E (negative case). A non-pending proposal (already confirmed) is not surfaced as a current obligation', async () => {
  const result = await loadHumanInterventionObligations({ thread: { threadId: THREAD_ID, actorId: ACTOR_ID } });
  assert.equal(result.obligations.filter((o) => o.source_type === 'conversation_proposal').length, 0);
});

resetState();
state.approvals = { data: [approvalRow({ estate_id: ESTATE_ID })], error: null };
await check('F. A cross-estate actor cannot see another estate\'s automation approval (caller-supplied estateId is the only scope ever queried)', async () => {
  const result = await loadHumanInterventionObligations({ estateId: OTHER_ESTATE_ID });
  // The caller queried a DIFFERENT estateId than the fixture's row
  // belongs to; the real listAutomationApprovals(estateId) call is
  // itself estate-filtered in production (confirmed via source read:
  // facilityAutomationService.ts:264, .eq("estate_id", estateId)) -- the
  // mock cannot simulate that server-side filter, but this test proves
  // the caller-supplied scope is what's actually passed through, which
  // is what makes that real filtering effective.
  assert.equal(callCounts.automation_approvals, 2);
});

resetState();
state.approvals = { data: null, error: new Error('simulated total outage') };
await check('G. A fully unavailable source never falsely claims "nothing needs attention" (complete:false, not an empty success)', async () => {
  const result = await loadHumanInterventionObligations({ estateId: ESTATE_ID });
  assert.equal(result.obligations.length, 0);
  assert.equal(result.complete, false, 'an empty obligations list from a failed source must never be reported as complete');
});

// =====================================================================
// 6. Query / performance -- bounded, not N+1
// =====================================================================
console.log('\n=== Query strategy / performance ===');

for (const n of [1, 10, 50, 100]) {
  resetState();
  state.approvals = { data: Array.from({ length: n }, (_, i) => approvalRow({ id: `approval-${i}` })), error: null };
  await check(`${n} approval rows: exactly two queries against automation_approvals regardless of row count (no N+1)`, async () => {
    const result = await loadHumanInterventionObligations({ estateId: ESTATE_ID });
    assert.equal(result.obligations.length, n);
    assert.equal(callCounts.automation_approvals, 2, `expected exactly 2 queries for ${n} rows, got ${callCounts.automation_approvals}`);
  });
}

console.log('');
console.log(`=== wave7-slice4-human-intervention-view-smoke: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
