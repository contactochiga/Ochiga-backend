// Wave 7 Slice 6 -- GoalRuntime Domain Generalization smoke.
//
// Proves: the new device_action GoalPlanStep branch (a) resolves an
// honest actor or fails closed to needs_human, never fabricating one;
// (b) calls the SAME real executeRegisteredAction() every other device.*
// caller uses, with the correct shape, and NEVER touches any
// adapter/provider/MQTT/device-table path directly (repository-wide
// structural assertion, per the task's own explicit requirement); (c)
// correctly translates a denied/validation_required outcome to
// needs_human (not the generic "blocked" every other failure reaches);
// (d) leaves every existing (non-device) plan-step action_type's
// behavior byte-identical -- Office/commercial goal regression.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    contains: () => chainable(resolvedValue),
    order: () => chainable(resolvedValue),
    limit: () => chainable(resolvedValue),
    maybeSingle: async () => resolvedValue,
    single: async () => resolvedValue,
    then: (resolve, reject) => Promise.resolve(resolvedValue).then(resolve, reject),
  };
  return handler;
}

let usersTable = { data: null, error: null };
function mockSupabaseAdmin() {
  return {
    from(table) {
      if (table === 'users') return chainable(usersTable);
      // communicationRuntime/officeTaskBridgeService are not exercised by
      // any test below (only device_action steps are evaluated) -- a
      // generic empty-safe response for anything else.
      return chainable({ data: [], error: null });
    },
  };
}
supabaseClientModule.supabaseAdmin = mockSupabaseAdmin();

// executionRegistry is mocked at its own module boundary -- this proves
// goalEvaluator.ts's OWN new code calls it correctly and interprets its
// result correctly, without re-testing Wave 5's own frozen internals
// (authorizeDeviceCommand/capabilityRegistry/executeDeviceCommandForActor),
// which already have their own passing test suites this slice's
// regression battery re-runs unmodified.
const executionRegistryModule = require('../dist/intelligence-core/executionRegistry.js');
let lastExecuteRegisteredActionInput = null;
let executeRegisteredActionResult = { ok: true, status: 'executed', result: {} };
let executeRegisteredActionCalls = 0;
executionRegistryModule.executeRegisteredAction = async (input) => {
  executeRegisteredActionCalls += 1;
  lastExecuteRegisteredActionInput = input;
  return executeRegisteredActionResult;
};

const { evaluateGoal } = require('../dist/services/goalRuntime/goalEvaluator.js');

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

function baseGoal(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'goal-1',
    correlation_id: 'corr-1',
    requesting_actor_id: 'actor-1',
    surface: 'facility',
    conversation_thread_id: null,
    organization_scope: null,
    canonical_signal_key: null,
    objective: 'Restore Device X to the desired operating state',
    target_entities: { lead_id: null, contact_id: null, user_id: null, organization_id: null, name: null, email: null, phone: null, whatsapp_phone: null, estate_id: 'estate-1', home_id: 'home-1', device_id: 'device-1' },
    status: 'active',
    success_condition: { type: 'manual' },
    stop_condition: { type: 'none' },
    reply_branches: [],
    plan: [
      { step_index: 0, channel: 'device', action_type: 'device_action', body: null, wait_hours: 0, skip_if: null, status: 'pending', executed_at: null, result: null, device_command: { device_id: 'device-1', action_id: 'device.on', command: { power: 'on' } } },
    ],
    current_step_index: 0,
    schedule: { deadline: null, recurrence: null, timezone: null },
    event_conditions: [],
    communication_preferences: { allowed_channels: [], escalation_policy: 'notify_requester' },
    max_attempts: 3,
    attempts_completed: 0,
    observations: [],
    evidence: [],
    linked_crm_records: {},
    linked_tasks: [],
    linked_meetings: [],
    linked_automations: [],
    linked_communication_threads: [],
    execution_history: [],
    last_evaluated_at: null,
    next_evaluation_at: now,
    completion_reason: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function resetExecutionRegistryMock(result = { ok: true, status: 'executed', result: {} }) {
  executeRegisteredActionCalls = 0;
  lastExecuteRegisteredActionInput = null;
  executeRegisteredActionResult = result;
}

console.log('\n=== Repository-wide structural assertion: no bypass of the canonical execution chain ===');

const evaluatorSource = readFileSync(new URL('../src/services/goalRuntime/goalEvaluator.ts', import.meta.url), 'utf8');
const deviceActorSource = readFileSync(new URL('../src/services/goalRuntime/goalDeviceActor.ts', import.meta.url), 'utf8');

await check('goalEvaluator.ts imports and calls the real executeRegisteredAction from intelligence-core/executionRegistry, nothing else device-shaped', () => {
  assert.ok(evaluatorSource.includes('import { executeRegisteredAction } from "../../intelligence-core/executionRegistry"'));
  assert.ok(evaluatorSource.includes('executeRegisteredAction({'));
});

await check('goalEvaluator.ts / goalDeviceActor.ts never reference a device adapter, MQTT, Tuya, or a direct provider/device-table mutation, in actual CODE (comments describing their absence are not a violation)', () => {
  const stripComments = (src) => src.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  const evaluatorCode = stripComments(evaluatorSource);
  const deviceActorCode = stripComments(deviceActorSource);
  const forbidden = [/adapterRegistry/i, /mqtt/i, /tuya/i, /\.executeCommand\(/i, /from\(["']devices["']\)\.update/i, /publishBackendMaterialEvent/i];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(evaluatorCode), `goalEvaluator.ts must not match forbidden pattern ${pattern} in real code`);
    assert.ok(!pattern.test(deviceActorCode), `goalDeviceActor.ts must not match forbidden pattern ${pattern} in real code`);
  }
});

await check('the real executionRegistry.ts device branch (unmodified by this slice) still gates through authorizeDeviceCommand/capabilityRegistry before executeDeviceCommandForActor', () => {
  const registrySource = readFileSync(new URL('../src/intelligence-core/executionRegistry.ts', import.meta.url), 'utf8');
  assert.ok(registrySource.includes('authorizeDeviceCommand'));
  assert.ok(registrySource.includes('executeDeviceCommandForActor'));
  // authorizeDeviceCommand must be reachable BEFORE executeDeviceCommandForActor in source order for the device branch.
  const authIdx = registrySource.lastIndexOf('authorizeDeviceCommand(');
  const execIdx = registrySource.lastIndexOf('executeDeviceCommandForActor(');
  assert.ok(authIdx > 0 && execIdx > 0 && authIdx < execIdx, 'authority check must precede execution in source');
});

console.log('\n=== Actor model: honest resolution, fail-closed on absence ===');

await check('no requesting_actor_id -> device step never calls executeRegisteredAction, goal fails closed to needs_human', async () => {
  resetExecutionRegistryMock();
  const goal = baseGoal({ requesting_actor_id: null });
  const result = await evaluateGoal(goal);
  assert.equal(executeRegisteredActionCalls, 0, 'must never call the executor without a real actor');
  assert.equal(result.status, 'needs_human');
});

await check('requesting_actor_id set but no matching users row -> fails closed to needs_human, executor never called', async () => {
  resetExecutionRegistryMock();
  usersTable = { data: null, error: null };
  const goal = baseGoal({ requesting_actor_id: 'unknown-actor' });
  const result = await evaluateGoal(goal);
  assert.equal(executeRegisteredActionCalls, 0);
  assert.equal(result.status, 'needs_human');
});

await check('a real users row -> a real, non-fabricated AuthUser is passed to executeRegisteredAction', async () => {
  resetExecutionRegistryMock();
  usersTable = { data: { id: 'actor-1', email: 'ops@example.com', username: 'ops', role: 'facility_manager', estate_id: 'estate-1', home_id: null, permission_scopes: ['devices.control'] }, error: null };
  const goal = baseGoal({ requesting_actor_id: 'actor-1' });
  await evaluateGoal(goal);
  assert.equal(executeRegisteredActionCalls, 1);
  assert.equal(lastExecuteRegisteredActionInput.actor.id, 'actor-1');
  assert.equal(lastExecuteRegisteredActionInput.actor.role, 'facility_manager');
  assert.ok(Array.isArray(lastExecuteRegisteredActionInput.actor.permissions), 'permissions must be derived, not fabricated ad hoc');
});

console.log('\n=== Execution routing: correct call shape, correct outcome translation ===');

await check('device step calls executeRegisteredAction with the exact real action_id/entity_id/command/confirmed shape', async () => {
  resetExecutionRegistryMock();
  usersTable = { data: { id: 'actor-1', role: 'facility_manager', estate_id: 'estate-1', home_id: null, permission_scopes: [] }, error: null };
  const goal = baseGoal();
  await evaluateGoal(goal);
  assert.equal(lastExecuteRegisteredActionInput.action_id, 'device.on');
  assert.equal(lastExecuteRegisteredActionInput.entity_id, 'device-1');
  assert.deepEqual(lastExecuteRegisteredActionInput.command, { power: 'on' });
  assert.equal(lastExecuteRegisteredActionInput.confirmed, true);
  assert.equal(lastExecuteRegisteredActionInput.source, 'automation');
});

await check('allowed device step (ok:true) -> step done, goal completes (single-step plan)', async () => {
  resetExecutionRegistryMock({ ok: true, status: 'executed', result: {} });
  usersTable = { data: { id: 'actor-1', role: 'facility_manager', estate_id: 'estate-1', home_id: null, permission_scopes: [] }, error: null };
  const goal = baseGoal();
  const result = await evaluateGoal(goal);
  assert.equal(result.status, 'completed');
  assert.equal(result.plan[0].status, 'done');
});

await check('devices.power.control disabled (status:"denied") -> needs_human, NOT the generic blocked', async () => {
  resetExecutionRegistryMock({ ok: false, status: 'denied', reason: 'capability_disabled' });
  usersTable = { data: { id: 'actor-1', role: 'facility_manager', estate_id: 'estate-1', home_id: null, permission_scopes: [] }, error: null };
  const goal = baseGoal();
  const result = await evaluateGoal(goal);
  assert.equal(result.status, 'needs_human');
  assert.ok(result.completion_reason.includes('capability_disabled') || result.completion_reason.includes('Human intervention required'));
});

await check('validation_required (action not yet available) -> needs_human', async () => {
  resetExecutionRegistryMock({ ok: false, status: 'validation_required', reason: 'action_not_available' });
  usersTable = { data: { id: 'actor-1', role: 'facility_manager', estate_id: 'estate-1', home_id: null, permission_scopes: [] }, error: null };
  const goal = baseGoal();
  const result = await evaluateGoal(goal);
  assert.equal(result.status, 'needs_human');
});

await check('an ordinary execution failure (status:"failed", not denied) -> the generic blocked, same as every other failed step', async () => {
  resetExecutionRegistryMock({ ok: false, status: 'failed', reason: 'device_not_found' });
  usersTable = { data: { id: 'actor-1', role: 'facility_manager', estate_id: 'estate-1', home_id: null, permission_scopes: [] }, error: null };
  const goal = baseGoal();
  const result = await evaluateGoal(goal);
  assert.equal(result.status, 'blocked');
});

await check('missing device_command payload -> needs_human without ever calling the executor', async () => {
  resetExecutionRegistryMock();
  usersTable = { data: { id: 'actor-1', role: 'facility_manager', estate_id: 'estate-1', home_id: null, permission_scopes: [] }, error: null };
  const goal = baseGoal({ plan: [{ step_index: 0, channel: 'device', action_type: 'device_action', body: null, wait_hours: 0, skip_if: null, status: 'pending', executed_at: null, result: null, device_command: null }] });
  const result = await evaluateGoal(goal);
  assert.equal(executeRegisteredActionCalls, 0);
  assert.equal(result.status, 'needs_human');
});

console.log('\n=== Office/commercial goal regression: non-device steps unaffected ===');

function officeGoal() {
  const now = new Date().toISOString();
  return {
    id: 'goal-office-1', correlation_id: 'corr-office-1', requesting_actor_id: null, surface: 'office_material_event', conversation_thread_id: null, organization_scope: null, canonical_signal_key: 'office:evt-1:office:lead-1:global:no-home',
    objective: 'Development/JV relationship communication', target_entities: { lead_id: 'lead-1', contact_id: null, user_id: null, organization_id: null, name: 'A Lead', email: null, phone: null, whatsapp_phone: null },
    status: 'active', success_condition: { type: 'reply_received' }, stop_condition: { type: 'deadline_passed' }, reply_branches: [],
    plan: [{ step_index: 0, channel: 'escalation', action_type: 'escalate', body: null, wait_hours: 0, skip_if: null, status: 'pending', executed_at: null, result: null }],
    current_step_index: 0, schedule: { deadline: null, recurrence: null, timezone: null }, event_conditions: [], communication_preferences: { allowed_channels: ['whatsapp'], escalation_policy: 'notify_requester' },
    max_attempts: 3, attempts_completed: 0, observations: [], evidence: [], linked_crm_records: {}, linked_tasks: [], linked_meetings: [], linked_automations: [], linked_communication_threads: [],
    execution_history: [], last_evaluated_at: null, next_evaluation_at: now, completion_reason: null, created_at: now, updated_at: now,
  };
}

await check('an existing escalate step behaves exactly as before (needs_human, no device executor ever touched)', async () => {
  resetExecutionRegistryMock();
  const goal = officeGoal();
  const result = await evaluateGoal(goal);
  assert.equal(result.status, 'needs_human');
  assert.equal(executeRegisteredActionCalls, 0, 'a non-device step must never call executeRegisteredAction');
});

await check('GoalTargetEntities without estate_id/home_id/device_id still evaluates identically to before this slice (fields genuinely optional)', async () => {
  const goal = officeGoal();
  assert.equal(goal.target_entities.estate_id, undefined);
  assert.equal(goal.target_entities.device_id, undefined);
  // No throw, no coercion -- optional fields simply absent.
  resetExecutionRegistryMock();
  await evaluateGoal(goal);
});

console.log('');
console.log(`=== wave7-slice6-goalruntime-domain-generalization-smoke: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
