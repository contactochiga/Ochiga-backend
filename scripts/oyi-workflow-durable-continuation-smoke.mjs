#!/usr/bin/env node
// Oyi Intelligence Convergence, Wave 0 -- Objective 1 regression coverage.
//
// The bug: ConversationOrchestrator.ts's durableWorkflowContinuationResult
// used to transition a workflow directly from "awaiting_approval" to
// "completed"/"failed" after a confirmed device action finished executing.
// WorkflowStateMachine.ALLOWED["awaiting_approval"] only permits
// ["approved","cancelled","expired","superseded"] -- that direct jump threw
// an uncaught Error AFTER the physical device command had already
// succeeded, so the user was told the command failed (or got a generic
// 500) while the workflow row stayed stuck at "awaiting_approval" forever,
// re-surfacing as "still pending" on the next turn.
//
// The fix routes both ConversationOrchestrator.ts and
// SpatialDeviceActionService.ts through one shared, canonical helper --
// WorkflowService.advanceToTerminal() -- which walks the full legal chain
// (awaiting_approval -> approved -> executing -> verifying ->
// completed/failed).
//
// This test drives the REAL compiled ConversationOrchestrator.run()
// through the full confirmation journey end-to-end (initial request ->
// awaiting_confirmation -> confirmation reply -> capability/authority
// re-check -> action execution -> verification -> legal workflow terminal
// state -> user-facing result), against a fake Supabase client and a
// mocked device execution provider -- the same proven pattern used by
// scripts/oyi-workflow-action-phase-c-runtime-smoke.mjs (fake Supabase)
// and scripts/facility-spatial-device-action-smoke.mjs (device command
// mock). No live database, no real device adapter registry required.
import assert from "node:assert/strict";
import path from "node:path";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "durable-continuation-local-only";
delete process.env.OYI_WORKFLOW_MEMORY_REPOSITORY;
delete process.env.OYI_ACTION_MEMORY_REPOSITORY;

const root = process.cwd();
const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRuntimeSupabase() {
  const now = new Date().toISOString();
  const db = {
    devices: [{
      id: "33333333-3333-4333-8333-333333333333",
      name: "3Gang Living room",
      estate_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      home_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      room_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      category: "switch",
      type: "switch",
      capabilities: ["switch_1", "switch_2", "switch_3"],
      metadata: {
        aliases: ["3 gang living room", "3-gang living room", "3Gang living room"],
        channel_definitions: [
          { code: "switch_1", label: "Channel 1" },
          { code: "switch_2", label: "Channel 2" },
          { code: "switch_3", label: "Channel 3" },
        ],
      },
      updated_at: now,
    }],
    rooms: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Living Room", home_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", metadata: {} }],
    oyi_conversation_threads: [],
    oyi_conversation_messages: [],
    oyi_conversation_workflows: [],
    oyi_conversation_workflow_inputs: [],
    oyi_actions: [],
    oyi_action_events: [],
    oyi_action_evidence: [],
  };
  const failures = { workflowUpsert: null, actionUpsert: null };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.inFilters = [];
      this.limitCount = null;
      this.patch = null;
      this.mode = "select";
      this.payload = null;
    }
    select() { return this; }
    eq(column, value) {
      this.filters.push({ column, value });
      return this;
    }
    in(column, values) {
      this.inFilters.push({ column, values: values.map(String) });
      return this;
    }
    order() { return this; }
    limit(value) {
      this.limitCount = Number(value || 0) || null;
      return this;
    }
    maybeSingle() {
      return this.then((result) => ({
        data: Array.isArray(result.data) ? result.data[0] || null : result.data || null,
        error: result.error || null,
      }));
    }
    insert(rows) {
      const values = (Array.isArray(rows) ? rows : [rows]).map((row) => ({
        id: row.id || `${this.table}-${db[this.table].length + 1}`,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || new Date().toISOString(),
        ...row,
      }));
      db[this.table].push(...values);
      return {
        select: () => ({ maybeSingle: async () => ({ data: values[0] || null, error: null }) }),
        then: (resolve) => Promise.resolve({ data: values, error: null }).then(resolve),
      };
    }
    upsert(row) {
      this.mode = "upsert";
      this.payload = row;
      return this;
    }
    update(patch) {
      this.mode = "update";
      this.patch = patch;
      return this;
    }
    execute() {
      if (!db[this.table]) db[this.table] = [];
      if (this.mode === "upsert") {
        if (this.table === "oyi_conversation_workflows" && failures.workflowUpsert) return { data: null, error: failures.workflowUpsert };
        if (this.table === "oyi_actions" && failures.actionUpsert) return { data: null, error: failures.actionUpsert };
        const row = {
          id: this.payload.id || `${this.table}-${db[this.table].length + 1}`,
          created_at: this.payload.created_at || new Date().toISOString(),
          updated_at: this.payload.updated_at || new Date().toISOString(),
          ...this.payload,
        };
        const key = row.workflow_id ? "workflow_id" : row.action_id ? "action_id" : row.input_key ? "input_key" : "id";
        const idx = db[this.table].findIndex((item) => {
          if (this.table === "oyi_conversation_workflow_inputs") {
            return item.workflow_id === row.workflow_id && item.input_key === row.input_key;
          }
          return String(item[key]) === String(row[key]);
        });
        if (idx >= 0) db[this.table][idx] = { ...db[this.table][idx], ...row };
        else db[this.table].push(row);
        return { data: row, error: null };
      }
      let rows = clone(db[this.table] || []);
      for (const filter of this.filters) rows = rows.filter((row) => String(row[filter.column] || "") === String(filter.value));
      for (const filter of this.inFilters) rows = rows.filter((row) => filter.values.includes(String(row[filter.column])));
      if (this.patch) {
        rows = rows.map((row) => ({ ...row, ...this.patch }));
        for (const row of rows) {
          const key = row.workflow_id ? "workflow_id" : row.action_id ? "action_id" : "id";
          const idx = db[this.table].findIndex((item) => String(item[key]) === String(row[key]));
          if (idx >= 0) db[this.table][idx] = row;
        }
      }
      if (this.limitCount) rows = rows.slice(0, this.limitCount);
      return { data: rows, error: null };
    }
    then(resolve, reject) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }
  }

  return {
    db,
    failures,
    from(table) {
      if (!db[table]) db[table] = [];
      return new Query(table);
    },
  };
}

const fakeSupabase = createRuntimeSupabase();
supabaseModule.supabaseAdmin.from = fakeSupabase.from.bind(fakeSupabase);

const orchestratorModule = await import(path.join(root, "dist/oyi-core/orchestration/ConversationOrchestrator.js"));
// Same read-only-binding workaround already proven by
// facility-spatial-device-action-smoke.mjs: executeDeviceCommandForActor is
// a plain named export, so it must be monkeypatched via the CJS-interop
// `.default` object, not the ESM namespace directly.
const deviceCommandControllerNamespace = await import(path.join(root, "dist/controllers/deviceCommandController.js"));
const deviceCommandController = deviceCommandControllerNamespace.default;
const originalExecuteDeviceCommandForActor = deviceCommandController.executeDeviceCommandForActor;

const resident = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  role: "resident",
  estate_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  home_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  permissions: ["devices.read", "devices.control"],
};
const oisContext = {
  actor_id: resident.id,
  surface: "consumer",
  role: "resident",
  permissions: resident.permissions,
  estate_id: resident.estate_id,
  home_id: resident.home_id,
  module: "home",
  resolved_at: new Date().toISOString(),
};

async function run(prompt, threadId) {
  return orchestratorModule.conversationOrchestrator.run({
    actor: resident,
    oisContext,
    input: {
      message: prompt,
      surface: "consumer",
      estate_id: resident.estate_id,
      home_id: resident.home_id,
      thread_id: threadId,
      context: oisContext,
    },
  });
}

function mockExecute(fn) {
  let calls = 0;
  deviceCommandController.executeDeviceCommandForActor = async (input) => {
    calls += 1;
    return fn(input, calls);
  };
  return { callCount: () => calls };
}
function restoreExecute() {
  deviceCommandController.executeDeviceCommandForActor = originalExecuteDeviceCommandForActor;
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// 1. Golden path: initial request -> awaiting_confirmation -> "Yes" ->
// capability/authority re-check -> execute -> verify -> legal workflow
// terminal state ("completed", never stuck at "awaiting_approval") ->
// correct, non-error, user-facing result. This is the exact journey that
// used to throw an uncaught "Invalid workflow transition: awaiting_approval
// -> completed" AFTER the physical device command had already succeeded.
await check("confirmation journey reaches a legal completed workflow, not a failure, after a successful action", async () => {
  const threadId = "11111111-1111-4111-8111-111111111111";
  const exec = mockExecute(async (input) => {
    assert.equal(input.deviceId, "33333333-3333-4333-8333-333333333333", "device execution must receive the real resolved device id");
    return { final_status: "state_confirmed", command_execution_id: "exec-durable-golden" };
  });

  const pending = await run("Turn off 3Gang Living room channel 2.", threadId);
  assert.match(pending.answer, /Please confirm/i);
  assert.equal(pending.execution?.status, "pending_confirmation");
  assert.equal(fakeSupabase.db.oyi_conversation_workflows.length, 1);
  const pendingWorkflowRow = fakeSupabase.db.oyi_conversation_workflows[0];
  assert.equal(pendingWorkflowRow.status, "awaiting_approval");
  assert.equal(fakeSupabase.db.oyi_actions[0].status, "awaiting_confirmation");
  assert.equal(exec.callCount(), 0, "no device execution before confirmation");

  // The confirmation reply -- this is the call that used to throw.
  const confirmed = await run("Yes", threadId);

  assert.equal(exec.callCount(), 1, "confirmation must execute the device command exactly once");
  // Correct, non-error, user-facing result -- the underlying action
  // succeeded and the answer must say so, not report a failure.
  assert.match(confirmed.answer, /completed and was confirmed/i, `expected a success answer, got: ${confirmed.answer}`);
  assert.doesNotMatch(confirmed.answer, /could not complete/i, "a successful action must never be reported as failed");
  assert.equal(confirmed.truth?.truth_state === "unavailable", false, "a successful confirmation must not resolve as unavailable");

  // The action itself reached a real terminal, successful status.
  const actionRow = fakeSupabase.db.oyi_actions.find((row) => row.action_id === pendingWorkflowRow.action_id);
  assert.ok(actionRow, "the confirmed action row must still exist");
  assert.equal(actionRow.status, "confirmed");

  // The workflow reached the matching LEGAL terminal status. Before the
  // fix this update either never landed (thrown, uncaught) or attempted
  // an illegal write -- assertWorkflowTransition throws synchronously
  // before any write, so the row would still show "awaiting_approval"
  // here if the defect were still present.
  const workflowRow = fakeSupabase.db.oyi_conversation_workflows.find((row) => row.workflow_id === pendingWorkflowRow.workflow_id);
  assert.ok(workflowRow, "the workflow row must still exist");
  assert.equal(workflowRow.status, "completed", "the workflow must reach the legal 'completed' terminal state");
  assert.notEqual(workflowRow.status, "awaiting_approval", "the workflow must NOT remain incorrectly awaiting_approval after the physical action succeeded");
  assert.notEqual(workflowRow.status, "failed", "a successful action must not leave the workflow in 'failed'");

  restoreExecute();
});

// 2. A device execution that only reaches provider_accepted (no
// observable confirmation) still must complete the workflow legally --
// action.status "unobservable" also maps to the workflow's "completed"
// terminal state (per terminalWorkflowStatusForAction), proving the fix
// does not special-case only the "confirmed" outcome.
await check("unobservable action outcome still reaches a legal completed workflow", async () => {
  const threadId = "22222222-2222-4222-8222-222222222222";
  const exec = mockExecute(async () => ({ final_status: "provider_accepted", command_execution_id: "exec-durable-unobservable" }));

  await run("Turn off 3Gang Living room channel 3.", threadId);
  const confirmed = await run("Yes", threadId);

  assert.match(confirmed.answer, /cannot directly observe the final physical effect/i, `expected the unobservable answer, got: ${confirmed.answer}`);
  const workflowRow = fakeSupabase.db.oyi_conversation_workflows.slice().reverse().find((row) => row.thread_id === threadId);
  assert.ok(workflowRow, "the workflow row must exist for this thread");
  assert.equal(workflowRow.status, "completed", "unobservable actions must also reach the legal completed workflow state");

  restoreExecute();
});

// 3. A device execution that genuinely fails must reach the workflow's
// "failed" terminal state -- proving the fix does not silently mark
// every outcome as completed.
await check("failed action outcome reaches a legal failed workflow, not completed", async () => {
  const threadId = "33333333-3333-4333-8333-333333333335";
  const exec = mockExecute(async () => ({ final_status: "failed", command_execution_id: "exec-durable-failed" }));

  await run("Turn off 3Gang Living room channel 1.", threadId);
  const confirmed = await run("Yes", threadId);

  assert.match(confirmed.answer, /could not complete/i, `expected a failure answer, got: ${confirmed.answer}`);
  const workflowRow = fakeSupabase.db.oyi_conversation_workflows.slice().reverse().find((row) => row.thread_id === threadId);
  assert.ok(workflowRow, "the workflow row must exist for this thread");
  assert.equal(workflowRow.status, "failed", "a genuinely failed action must reach the legal failed workflow state");

  restoreExecute();
});

// 4. Cancellation path is untouched by this fix (cancelled is already a
// legal transition from awaiting_approval) -- regression guard.
await check("cancellation still transitions the workflow to cancelled and never executes", async () => {
  const threadId = "44444444-4444-4444-8444-444444444444";
  const exec = mockExecute(async () => ({ final_status: "state_confirmed" }));

  await run("Turn off 3Gang Living room channel 2.", threadId);
  const cancelled = await run("Cancel", threadId);

  assert.match(cancelled.answer, /Cancelled/i);
  assert.equal(exec.callCount(), 0, "cancellation must never reach device execution");
  const workflowRow = fakeSupabase.db.oyi_conversation_workflows.slice().reverse().find((row) => row.thread_id === threadId);
  assert.ok(workflowRow, "the workflow row must exist for this thread");
  assert.equal(workflowRow.status, "cancelled");

  restoreExecute();
});

console.log("oyi-workflow-durable-continuation-smoke passed");
process.exit(0);
