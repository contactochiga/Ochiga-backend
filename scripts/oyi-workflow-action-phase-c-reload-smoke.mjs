import assert from "node:assert/strict";
import path from "node:path";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase-c-reload-local-only";
delete process.env.OYI_WORKFLOW_MEMORY_REPOSITORY;
delete process.env.OYI_ACTION_MEMORY_REPOSITORY;

const root = process.cwd();
const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeSupabase() {
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
      capabilities: [],
      metadata: { aliases: ["3 gang living room", "3-gang living room", "3Gang living room"] },
      updated_at: now,
    }],
    rooms: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Living Room", home_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", metadata: {} }],
    device_states: [{
      device_id: "33333333-3333-4333-8333-333333333333",
      status: {
        online: true,
        normalized_state: { switches: { switch_1: true, switch_2: true, switch_3: false } },
        capability_codes: ["switch_1", "switch_2", "switch_3"],
        channel_definitions: [
          { code: "switch_1", name: "Channel 1", controllable: true },
          { code: "switch_2", name: "Channel 2", controllable: true },
          { code: "switch_3", name: "Channel 3", controllable: true },
        ],
      },
      last_seen: now,
      updated_at: now,
    }],
    oyi_conversation_threads: [],
    oyi_conversation_messages: [],
    oyi_conversation_workflows: [],
    oyi_conversation_workflow_inputs: [],
    oyi_actions: [],
    oyi_action_events: [],
    oyi_action_evidence: [],
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.inFilters = [];
      this.limitCount = null;
      this.patch = null;
      this.mode = "select";
      this.payload = null;
      this.countMode = false;
    }
    select(_columns, options = {}) {
      this.countMode = Boolean(options.count && options.head);
      return this;
    }
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
      return this.then((result) => ({ data: Array.isArray(result.data) ? result.data[0] || null : result.data || null, error: result.error || null }));
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
        const row = {
          id: this.payload.id || `${this.table}-${db[this.table].length + 1}`,
          created_at: this.payload.created_at || new Date().toISOString(),
          updated_at: this.payload.updated_at || new Date().toISOString(),
          ...this.payload,
        };
        const key = row.workflow_id ? "workflow_id" : row.action_id ? "action_id" : row.input_key ? "input_key" : "id";
        const idx = db[this.table].findIndex((item) => {
          if (this.table === "oyi_conversation_workflow_inputs") return item.workflow_id === row.workflow_id && item.input_key === row.input_key;
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
      if (this.countMode) return { data: null, count: rows.length, error: null };
      return { data: rows, error: null };
    }
    then(resolve, reject) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }
  }

  return {
    db,
    from(table) {
      if (!db[table]) db[table] = [];
      return new Query(table);
    },
  };
}

const fakeSupabase = createFakeSupabase();
supabaseModule.supabaseAdmin.from = fakeSupabase.from.bind(fakeSupabase);

const orchestratorModule = await import(path.join(root, "dist/oyi-core/orchestration/ConversationOrchestrator.js"));
const oyiService = await import(path.join(root, "dist/services/oyiUnifiedIntelligenceService.js"));

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

async function run(prompt, threadId, context = oisContext) {
  return orchestratorModule.conversationOrchestrator.run({
    actor: resident,
    oisContext,
    input: {
      message: prompt,
      surface: "consumer",
      estate_id: resident.estate_id,
      home_id: resident.home_id,
      thread_id: threadId,
      context,
    },
  });
}

async function restoreThread(threadId) {
  const restored = await oyiService.getOyiConversationMessages(resident, threadId);
  assert.equal(restored.ok, true);
  assert.equal(restored.thread.id, threadId);
  return restored.thread;
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

await check("reload restores pending channel clarification through canonical thread workflow metadata", async () => {
  const threadId = "11111111-1111-4111-8111-111111111111";
  const first = await run("Turn off 3Gang Living room", threadId);
  assert.match(first.answer, /Which channel on 3Gang Living room/i);
  assert.equal(fakeSupabase.db.oyi_conversation_workflows.length, 1);
  assert.equal(fakeSupabase.db.oyi_conversation_workflows[0].status, "awaiting_clarification");
  assert.deepEqual(fakeSupabase.db.oyi_conversation_workflows[0].unresolved_inputs, ["channel"]);

  const restoredThread = await restoreThread(threadId);
  assert.equal(restoredThread.active_workflow.workflow_id, fakeSupabase.db.oyi_conversation_workflows[0].workflow_id);
  assert.equal(restoredThread.active_workflow.missing_input, "channel");

  const afterReload = await run("Channel 1", threadId, { ...oisContext, active_workflow: restoredThread.active_workflow });
  assert.match(afterReload.answer, /Please confirm/i);
  assert.match(afterReload.answer, /Channel 1/i);
  assert.match(afterReload.answer, /3Gang Living room/i);
  assert.equal(afterReload.execution?.status, "pending_confirmation");
  assert.equal(fakeSupabase.db.oyi_actions.length, 1);
  assert.equal(fakeSupabase.db.oyi_actions[0].target_channel_code, "switch_1");
});

await check("cancelled workflow stays cancelled after restore and cannot be revived by channel text", async () => {
  const threadId = "22222222-2222-4222-8222-222222222222";
  await run("Turn off 3Gang Living room", threadId);
  const restoredThread = await restoreThread(threadId);
  const cancelled = await run("Cancel", threadId, { ...oisContext, active_workflow: restoredThread.active_workflow });
  assert.match(cancelled.answer, /Cancelled/i);
  const actionCount = fakeSupabase.db.oyi_actions.length;
  const reviveAttempt = await run("Channel 1", threadId, { ...oisContext, active_workflow: restoredThread.active_workflow });
  assert.doesNotMatch(reviveAttempt.answer, /Please confirm/i);
  assert.equal(fakeSupabase.db.oyi_actions.length, actionCount);
});

await check("expired workflow does not continue after reload", async () => {
  const threadId = "33333333-3333-4333-8333-333333333333";
  await run("Turn off 3Gang Living room", threadId);
  const workflow = fakeSupabase.db.oyi_conversation_workflows.find((row) => row.thread_id === threadId);
  workflow.expires_at = new Date(Date.now() - 1000).toISOString();
  const restoredThread = await restoreThread(threadId);
  const expired = await run("Channel 1", threadId, { ...oisContext, active_workflow: restoredThread.active_workflow });
  assert.doesNotMatch(expired.answer, /Please confirm/i);
  assert.equal(fakeSupabase.db.oyi_conversation_workflows.find((row) => row.workflow_id === workflow.workflow_id).status, "expired");
});

await check("pending confirmation survives restore without executing on Continue", async () => {
  const threadId = "44444444-4444-4444-8444-444444444444";
  const prepared = await run("Turn off 3Gang Living room channel 2", threadId);
  assert.match(prepared.answer, /Please confirm/i);
  assert.match(prepared.answer, /Channel 2/i);
  const restoredThread = await restoreThread(threadId);
  const continued = await run("Continue", threadId, { ...oisContext, active_workflow: restoredThread.active_workflow });
  assert.match(continued.answer, /pending action/i);
  assert.match(continued.answer, /Channel 2/i);
  assert.equal(fakeSupabase.db.oyi_actions.filter((row) => row.status === "awaiting_confirmation").length >= 1, true);
});

console.log("oyi-workflow-action-phase-c-reload-smoke passed");
process.exit(0);
