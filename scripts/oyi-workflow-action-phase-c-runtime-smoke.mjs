import assert from "node:assert/strict";
import path from "node:path";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase-c-runtime-local-only";
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

async function run(prompt, threadId = "11111111-1111-4111-8111-111111111111") {
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

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await check("production repository path prepares exact device channel action", async () => {
  const response = await run("Turn off 3Gang Living room channel 2.");
  assert.match(response.answer, /Please confirm/i);
  assert.match(response.answer, /3Gang Living room/i);
  assert.match(response.answer, /Channel 2/i);
  assert.equal(response.execution?.status, "pending_confirmation");
  assert.equal(fakeSupabase.db.oyi_conversation_workflows.length, 1);
  assert.equal(fakeSupabase.db.oyi_actions.length, 1);
  assert.equal(fakeSupabase.db.oyi_actions[0].status, "awaiting_confirmation");
  assert.equal(fakeSupabase.db.oyi_actions[0].target_channel_code, "switch_2");
  assert.equal(fakeSupabase.db.oyi_actions[0].capability_key, "devices.power.control");
  assert.equal(fakeSupabase.db.oyi_action_events.length, 1);
});

await check("workflow persistence failure is structured and does not create action", async () => {
  fakeSupabase.db.oyi_conversation_workflows.length = 0;
  fakeSupabase.db.oyi_actions.length = 0;
  fakeSupabase.failures.workflowUpsert = { code: "23503", message: "insert or update on table oyi_conversation_workflows violates foreign key constraint" };
  const response = await run("Turn off 3Gang Living room channel 2.", "22222222-2222-4222-8222-222222222222");
  assert.match(response.answer, /could not safely save the pending workflow/i);
  assert.equal(response.truth?.truth_state, "unavailable");
  assert.equal(response.execution?.capability_result, "unavailable");
  assert.equal(response.execution?.failure_stage, "workflow_persistence");
  assert.equal(fakeSupabase.db.oyi_actions.length, 0);
  fakeSupabase.failures.workflowUpsert = null;
});

await check("action persistence failure is structured and never executes", async () => {
  fakeSupabase.db.oyi_conversation_workflows.length = 0;
  fakeSupabase.db.oyi_actions.length = 0;
  fakeSupabase.db.oyi_action_events.length = 0;
  fakeSupabase.failures.actionUpsert = { code: "23502", message: "null value in column requested_state violates not-null constraint" };
  const response = await run("Turn off 3Gang Living room channel 2.", "33333333-3333-4333-8333-333333333333");
  assert.match(response.answer, /could not safely save the pending action/i);
  assert.equal(response.truth?.truth_state, "unavailable");
  assert.equal(response.execution?.capability_result, "unavailable");
  assert.equal(response.execution?.failure_stage, "action_persistence");
  assert.equal(fakeSupabase.db.oyi_actions.length, 0);
  fakeSupabase.failures.actionUpsert = null;
});

console.log("oyi-workflow-action-phase-c-runtime-smoke passed");
process.exit(0);
