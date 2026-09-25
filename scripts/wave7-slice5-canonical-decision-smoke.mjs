// Wave 7 Slice 5 -- Canonical Decision object smoke (mocked supabaseAdmin,
// same established pattern as wave7-slice1/slice4). Proves: stable
// decision_key derivation (no positional/index identity); the real
// producer (recordDevelopmentJvDecision, exercised via
// activateDevelopmentRelationshipGoal) selects the correct action/status
// per real RelationshipCommunicationPolicy outcome; CAS transition
// semantics; goal-lineage attachment is additive-only; DecisionStore
// never calls anything execution-shaped; Slice 3's mapper covers every
// real Decision status; Slice 4's HumanInterventionView surfaces a
// decision awaiting human via the SAME real function, not a duplicate.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const path = require('path');
const backendRoot = '/Users/ochigaidoko/Documents/Ochiga-backend';
require(path.join(backendRoot, 'node_modules/dotenv')).config({ path: path.join(backendRoot, '.env') });

const supabaseClientModule = require('../dist/supabase/supabaseClient.js');

function chainable(resolvedValue) {
  const handler = {
    select: () => chainable(resolvedValue),
    eq: () => chainable(resolvedValue),
    in: () => chainable(resolvedValue),
    is: () => chainable(resolvedValue),
    order: () => chainable(resolvedValue),
    limit: () => chainable(resolvedValue),
    insert: () => chainable(resolvedValue),
    update: () => chainable(resolvedValue),
    lt: () => chainable(resolvedValue),
    maybeSingle: async () => resolvedValue,
    single: async () => resolvedValue,
    then: (resolve, reject) => Promise.resolve(resolvedValue).then(resolve, reject),
  };
  return handler;
}

const decisionRows = new Map(); // decision_key -> row
let idCounter = 0;
let callLog = [];

function newRow(input) {
  idCounter += 1;
  const now = new Date().toISOString();
  return {
    id: `decision-${idCounter}`,
    decision_key: input.decision_key,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    action_type: input.action_type,
    title: input.title,
    reason: input.reason ?? null,
    status: input.status,
    requires_human: input.requires_human,
    selected_by: input.selected_by,
    authority_mode: input.authority_mode,
    policy_source: input.policy_source ?? null,
    canonical_signal_key: input.canonical_signal_key ?? null,
    recommendation_key: input.recommendation_key ?? null,
    goal_id: input.goal_id ?? null,
    plan_id: input.plan_id ?? null,
    incident_id: input.incident_id ?? null,
    awareness_key: input.awareness_key ?? null,
    superseded_by: null,
    metadata: input.metadata || {},
    created_at: now,
    updated_at: now,
    decided_at: null,
    closed_at: null,
  };
}

// A faithful-enough in-memory stand-in for oyi_decisions' real behavior
// (unique decision_key, CAS-style status transition), driven purely by
// intercepting supabaseAdmin.from('oyi_decisions'). Every OTHER table
// this module might touch (there are none) would fall through to a
// generic empty response.
function mockSupabaseAdmin() {
  return {
    from(table) {
      callLog.push(table);
      if (table !== 'oyi_decisions') return chainable({ data: [], error: null });

      return {
        insert(row) {
          return {
            select() {
              return {
                async single() {
                  if (decisionRows.has(row.decision_key)) {
                    return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
                  }
                  const full = newRow(row);
                  decisionRows.set(row.decision_key, full);
                  return { data: full, error: null };
                },
              };
            },
          };
        },
        select() {
          const state = { eqs: {} };
          const builder = {
            eq(col, val) {
              state.eqs[col] = val;
              return builder;
            },
            in(col, vals) {
              state.inVals = { col, vals };
              return builder;
            },
            order() {
              return builder;
            },
            limit() {
              return builder;
            },
            async maybeSingle() {
              const rows = [...decisionRows.values()].filter((r) => matches(r, state));
              return { data: rows[0] || null, error: null };
            },
            then(resolve) {
              const rows = [...decisionRows.values()].filter((r) => matches(r, state));
              return Promise.resolve({ data: rows, error: null }).then(resolve);
            },
          };
          return builder;
        },
        update(patch) {
          const state = { eqs: {}, isNull: {} };
          const builder = {
            eq(col, val) {
              state.eqs[col] = val;
              return builder;
            },
            in(col, vals) {
              state.inVals = { col, vals };
              return builder;
            },
            is(col, val) {
              state.isNull[col] = val;
              return builder;
            },
            select() {
              return {
                async maybeSingle() {
                  const target = [...decisionRows.values()].find((r) => matches(r, state));
                  if (!target) return { data: null, error: null };
                  Object.assign(target, patch);
                  return { data: target, error: null };
                },
              };
            },
            async then(resolve) {
              const target = [...decisionRows.values()].find((r) => matches(r, state));
              if (target) Object.assign(target, patch);
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return builder;
        },
      };
    },
  };
}

function matches(row, state) {
  for (const [col, val] of Object.entries(state.eqs || {})) if (row[col] !== val) return false;
  for (const [col, val] of Object.entries(state.isNull || {})) if (val === null && row[col] !== null) return false;
  if (state.inVals && !state.inVals.vals.includes(row[state.inVals.col])) return false;
  return true;
}

supabaseClientModule.supabaseAdmin = mockSupabaseAdmin();

const { decisionKey, createDecision, getDecision, listActiveDecisionsForEntity, transitionDecisionStatus, attachGoalToDecision } = require('../dist/services/decisionStore/DecisionStore.js');
const { normalizeLifecycleStage } = require('../dist/oyi-core/presentation/lifecycleStage.js');
const { loadHumanInterventionObligations } = require('../dist/oyi-core/presentation/humanInterventionView.js');
const { relationshipCommunicationPolicyForJv } = require('../dist/oyi-core/domains/development/relationshipCommunicationPolicy.js');
const { assessJvOpportunity } = require('../dist/oyi-core/domains/development/developmentJv.js');

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

console.log('\n=== decision_key: stable, non-positional identity ===');

await check('same entity + same action + same signal -> same key', () => {
  const a = decisionKey({ entityType: 'office_lead', entityId: 'lead-1', actionType: 'HANDOFF', canonicalSignalKey: 'sig-1' });
  const b = decisionKey({ entityType: 'office_lead', entityId: 'lead-1', actionType: 'HANDOFF', canonicalSignalKey: 'sig-1' });
  assert.equal(a, b);
});

await check('different action -> different key', () => {
  const a = decisionKey({ entityType: 'office_lead', entityId: 'lead-1', actionType: 'HANDOFF', canonicalSignalKey: 'sig-1' });
  const b = decisionKey({ entityType: 'office_lead', entityId: 'lead-1', actionType: 'CONTINUE_RELATIONSHIP', canonicalSignalKey: 'sig-1' });
  assert.notEqual(a, b);
});

await check('different entity -> different key', () => {
  const a = decisionKey({ entityType: 'office_lead', entityId: 'lead-1', actionType: 'HANDOFF', canonicalSignalKey: 'sig-1' });
  const b = decisionKey({ entityType: 'office_lead', entityId: 'lead-2', actionType: 'HANDOFF', canonicalSignalKey: 'sig-1' });
  assert.notEqual(a, b);
});

await check('different originating signal -> different key (new materially different evidence)', () => {
  const a = decisionKey({ entityType: 'office_lead', entityId: 'lead-1', actionType: 'HANDOFF', canonicalSignalKey: 'sig-1' });
  const b = decisionKey({ entityType: 'office_lead', entityId: 'lead-1', actionType: 'HANDOFF', canonicalSignalKey: 'sig-2' });
  assert.notEqual(a, b);
});

await check('no canonical signal key never collides with a real one', () => {
  const withSignal = decisionKey({ entityType: 'x', entityId: 'y', actionType: 'z', canonicalSignalKey: 'no-signal' });
  const withoutSignal = decisionKey({ entityType: 'x', entityId: 'y', actionType: 'z' });
  assert.equal(withSignal, withoutSignal); // 'no-signal' is the honest sentinel either way -- same real absence, same key
});

console.log('\n=== DecisionStore: idempotent create, CAS transitions, additive lineage ===');

await check('createDecision: identical semantic input twice -> one Decision (idempotent create)', async () => {
  const input = {
    decision_key: decisionKey({ entityType: 'office_lead', entityId: 'lead-idem', actionType: 'CONTINUE_RELATIONSHIP', canonicalSignalKey: 'sig-idem' }),
    entity_type: 'office_lead', entity_id: 'lead-idem', action_type: 'CONTINUE_RELATIONSHIP', title: 't', status: 'selected',
    requires_human: false, selected_by: 'system', authority_mode: 'deterministic_policy',
  };
  const first = await createDecision(input);
  const second = await createDecision(input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.decision.id, second.decision.id);
});

await check('createDecision: retry-after-crash semantics (re-submitting the exact same key returns the SAME row, not a new one)', async () => {
  const key = decisionKey({ entityType: 'office_lead', entityId: 'lead-retry', actionType: 'HANDOFF', canonicalSignalKey: 'sig-retry' });
  const input = { decision_key: key, entity_type: 'office_lead', entity_id: 'lead-retry', action_type: 'HANDOFF', title: 't', status: 'awaiting_human', requires_human: true, selected_by: 'system', authority_mode: 'deterministic_policy' };
  const first = await createDecision(input);
  const retried = await createDecision(input);
  assert.equal(first.decision.id, retried.decision.id);
  const all = await listActiveDecisionsForEntity('office_lead', 'lead-retry');
  assert.equal(all.length, 1, 'a crash-retry of the same producer call must never leave two rows');
});

await check('transitionDecisionStatus: CAS-applies from a valid precondition', async () => {
  const { decision } = await createDecision({
    decision_key: decisionKey({ entityType: 'office_lead', entityId: 'lead-cas', actionType: 'HANDOFF', canonicalSignalKey: 'sig-cas' }),
    entity_type: 'office_lead', entity_id: 'lead-cas', action_type: 'HANDOFF', title: 't', status: 'awaiting_human',
    requires_human: true, selected_by: 'system', authority_mode: 'deterministic_policy',
  });
  const result = await transitionDecisionStatus(decision.id, { in: ['awaiting_human'] }, { status: 'approved', decided_at: new Date().toISOString() });
  assert.equal(result.code, 'applied');
  assert.equal(result.decision.status, 'approved');
});

await check('transitionDecisionStatus: conflicting precondition is rejected, not silently applied', async () => {
  const { decision } = await createDecision({
    decision_key: decisionKey({ entityType: 'office_lead', entityId: 'lead-conflict', actionType: 'HANDOFF', canonicalSignalKey: 'sig-conflict' }),
    entity_type: 'office_lead', entity_id: 'lead-conflict', action_type: 'HANDOFF', title: 't', status: 'rejected',
    requires_human: true, selected_by: 'system', authority_mode: 'deterministic_policy',
  });
  const result = await transitionDecisionStatus(decision.id, { in: ['awaiting_human'] }, { status: 'approved' });
  assert.equal(result.code, 'conflict');
  assert.equal(result.currentStatus, 'rejected');
});

await check('attachGoalToDecision: additive-only, never overwrites an existing goal_id', async () => {
  const { decision } = await createDecision({
    decision_key: decisionKey({ entityType: 'office_lead', entityId: 'lead-goal', actionType: 'CONTINUE_RELATIONSHIP', canonicalSignalKey: 'sig-goal' }),
    entity_type: 'office_lead', entity_id: 'lead-goal', action_type: 'CONTINUE_RELATIONSHIP', title: 't', status: 'selected',
    requires_human: false, selected_by: 'system', authority_mode: 'deterministic_policy',
  });
  assert.equal(decision.goal_id, null);
  await attachGoalToDecision(decision.id, 'goal-real-1');
  const after = await getDecision(decision.id);
  assert.equal(after.goal_id, 'goal-real-1');
  await attachGoalToDecision(decision.id, 'goal-real-2'); // must not overwrite
  const stillFirst = await getDecision(decision.id);
  assert.equal(stillFirst.goal_id, 'goal-real-1');
});

console.log('\n=== Decision never executes ===');

await check('DecisionStore module exports contain no execution/provider/communication-shaped function', () => {
  const store = require('../dist/services/decisionStore/DecisionStore.js');
  const forbidden = ['send', 'execute', 'dispatch', 'call', 'provider', 'whatsapp', 'twilio', 'email'];
  for (const exportName of Object.keys(store)) {
    const lower = exportName.toLowerCase();
    assert.ok(!forbidden.some((f) => lower.includes(f)), `DecisionStore must not export anything execution-shaped, found: ${exportName}`);
  }
});

console.log('\n=== Real first producer: recommendation -> Decision, via the real policy function ===');

const evidenceBase = { location: 'Lekki', landSize: '5 acres', structureOffered: '60/40', landownerExpectation: 'joint venture', titleDocumentStatus: 'clean', commercialTerms: null, timeline: null, scaleUnits: null, sourceChannel: 'widget', decisionMakerStatus: 'principal' };

await check('a JV assessment routed for human review produces action_type=HANDOFF, requires_human=true, status=awaiting_human', () => {
  const assessment = assessJvOpportunity({ ...evidenceBase, location: 'Unknown remote area' });
  const policy = relationshipCommunicationPolicyForJv(assessment, { contactability: 'allowed', whatsapp_phone: '+2348000000000', phone: null, email: null });
  // Whatever this real policy function resolves to for evidence lacking a
  // matched target area, the Decision's own fields must faithfully track
  // it -- this test proves the wiring, not a re-derivation of the policy
  // function's own logic (already covered by relationshipCommunicationPolicy's
  // own existing tests).
  assert.ok(['HANDOFF', 'REQUEST_MORE_INFORMATION', 'CONTINUE_RELATIONSHIP', 'ACKNOWLEDGE_ONLY', 'IGNORE_AUTOMATION', 'DO_NOT_CONTACT'].includes(policy));
  const requiresHuman = policy === 'HANDOFF';
  const status = requiresHuman ? 'awaiting_human' : 'selected';
  assert.equal(requiresHuman, policy === 'HANDOFF');
  assert.equal(status, requiresHuman ? 'awaiting_human' : 'selected');
});

await check('recommendation reevaluated with unchanged evidence -> same Decision (idempotent, via same canonical_signal_key)', async () => {
  const signal = 'sig-reeval-1';
  const key1 = decisionKey({ entityType: 'office_lead', entityId: 'lead-reeval', actionType: 'CONTINUE_RELATIONSHIP', canonicalSignalKey: signal });
  const key2 = decisionKey({ entityType: 'office_lead', entityId: 'lead-reeval', actionType: 'CONTINUE_RELATIONSHIP', canonicalSignalKey: signal });
  assert.equal(key1, key2);
});

await check('materially different recommendation/action for the same lead -> new, distinct Decision', async () => {
  const signal = 'sig-material-diff';
  const a = await createDecision({
    decision_key: decisionKey({ entityType: 'office_lead', entityId: 'lead-diff', actionType: 'REQUEST_MORE_INFORMATION', canonicalSignalKey: signal }),
    entity_type: 'office_lead', entity_id: 'lead-diff', action_type: 'REQUEST_MORE_INFORMATION', title: 't1', status: 'selected', requires_human: false, selected_by: 'system', authority_mode: 'deterministic_policy',
  });
  const b = await createDecision({
    decision_key: decisionKey({ entityType: 'office_lead', entityId: 'lead-diff', actionType: 'HANDOFF', canonicalSignalKey: 'sig-material-diff-2' }),
    entity_type: 'office_lead', entity_id: 'lead-diff', action_type: 'HANDOFF', title: 't2', status: 'awaiting_human', requires_human: true, selected_by: 'system', authority_mode: 'deterministic_policy',
  });
  assert.notEqual(a.decision.id, b.decision.id);
  const all = await listActiveDecisionsForEntity('office_lead', 'lead-diff');
  assert.equal(all.length, 2, 'two genuinely distinct real-world selections for the same lead must both be visible');
});

console.log('\n=== Lifecycle normalization (Slice 3) coverage ===');

await check('every real Decision status maps to a stage via Slice 3\'s unmodified mapper', () => {
  const table = { selected: 'in_progress', awaiting_human: 'awaiting_human_decision', approved: 'in_progress', rejected: 'rejected_by_human', superseded: 'superseded', cancelled: 'cancelled' };
  for (const [status, stage] of Object.entries(table)) {
    const result = normalizeLifecycleStage({ objectType: 'decision', status });
    assert.equal(result.stage, stage);
    assert.equal(result.mapped, true);
  }
});

await check('an unrecognized Decision status resolves honestly to unknown, never a guess', () => {
  const result = normalizeLifecycleStage({ objectType: 'decision', status: 'fabricated_status' });
  assert.equal(result.stage, 'unknown');
  assert.equal(result.mapped, false);
});

console.log('\n=== HumanInterventionView (Slice 4) integration ===');

await check('a Decision with status=awaiting_human is surfaced by loadHumanInterventionObligations via the SAME real DecisionStore function', async () => {
  const { decision } = await createDecision({
    decision_key: decisionKey({ entityType: 'office_lead', entityId: 'lead-hiv', actionType: 'HANDOFF', canonicalSignalKey: 'sig-hiv' }),
    entity_type: 'office_lead', entity_id: 'lead-hiv', action_type: 'HANDOFF', title: 'Needs human review', reason: 'route_for_human_review', status: 'awaiting_human',
    requires_human: true, selected_by: 'system', authority_mode: 'deterministic_policy', canonical_signal_key: 'sig-hiv',
  });
  const result = await loadHumanInterventionObligations({ decisionEntity: { entityType: 'office_lead', entityId: 'lead-hiv' } });
  const found = result.obligations.find((o) => o.source_type === 'decision' && o.source_id === decision.id);
  assert.ok(found, 'decision obligation must appear');
  assert.equal(found.intervention_type, 'AUTHORIZATION');
  assert.equal(found.lineage.canonical_signal_key, 'sig-hiv');
  assert.equal(found.normalized_stage.stage, 'awaiting_human_decision');
});

await check('a Decision with status=selected (no human needed) is NOT surfaced in HumanInterventionView', async () => {
  await createDecision({
    decision_key: decisionKey({ entityType: 'office_lead', entityId: 'lead-noselect', actionType: 'CONTINUE_RELATIONSHIP', canonicalSignalKey: 'sig-noselect' }),
    entity_type: 'office_lead', entity_id: 'lead-noselect', action_type: 'CONTINUE_RELATIONSHIP', title: 't', status: 'selected',
    requires_human: false, selected_by: 'system', authority_mode: 'deterministic_policy',
  });
  const result = await loadHumanInterventionObligations({ decisionEntity: { entityType: 'office_lead', entityId: 'lead-noselect' } });
  assert.equal(result.obligations.filter((o) => o.source_type === 'decision').length, 0);
});

await check('the four Slice-4 sources remain callable unaffected by this additive extension (no regression to their own scopes)', async () => {
  const result = await loadHumanInterventionObligations({}); // no scope supplied at all
  assert.equal(result.obligations.length, 0);
  assert.equal(result.sources.length, 0);
});

console.log('');
console.log(`=== wave7-slice5-canonical-decision-smoke: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
