import assert from "node:assert/strict";
import path from "node:path";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase-c-multigang-local-only";
process.env.OYI_WORKFLOW_MEMORY_REPOSITORY = "true";
process.env.OYI_ACTION_MEMORY_REPOSITORY = "true";

const root = process.cwd();
const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeSupabase() {
  const now = new Date().toISOString();
  const db = {
    devices: [
      {
        id: "device-3gang-living",
        name: "3Gang Living room",
        estate_id: "estate-1",
        home_id: "home-1",
        room_id: "room-living",
        category: "switch",
        type: "switch",
        capabilities: [],
        metadata: {
          aliases: ["3 gang living room", "3-gang living room", "3Gang living room"],
        },
        updated_at: now,
      },
      {
        id: "device-bedroom-light",
        name: "Bedroom light",
        estate_id: "estate-1",
        home_id: "home-1",
        room_id: "room-bedroom",
        category: "light",
        type: "switch",
        capabilities: ["switch_1"],
        metadata: {
          aliases: ["bedroom lamp"],
          channel_definitions: [{ code: "switch_1", label: "Channel 1" }],
        },
        updated_at: now,
      },
    ],
    rooms: [
      { id: "room-living", name: "Living Room", home_id: "home-1", metadata: {} },
      { id: "room-bedroom", name: "Bedroom", home_id: "home-1", metadata: {} },
    ],
    device_states: [
      {
        device_id: "device-3gang-living",
        status: {
          online: true,
          normalized_state: { power: true, switches: { switch_1: true, switch_2: true, switch_3: false } },
          supported_controls: ["power"],
          capability_codes: ["switch_1", "switch_2", "switch_3"],
          channel_definitions: [
            { code: "switch_1", name: "Channel 1", controllable: true },
            { code: "switch_2", name: "Channel 2", controllable: true },
            { code: "switch_3", name: "Channel 3", controllable: true },
          ],
          control_profile: "switch",
          device_family: "switch",
        },
        last_seen: now,
        updated_at: now,
      },
    ],
    oyi_conversation_threads: [],
    oyi_conversation_messages: [],
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.inFilters = [];
      this.limitCount = null;
      this.countMode = false;
      this.updatePatch = null;
      this.deleteMode = false;
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
    gte(column, value) {
      this.filters.push({ column, op: "gte", value });
      return this;
    }
    lte(column, value) {
      this.filters.push({ column, op: "lte", value });
      return this;
    }
    or() { return this; }
    order() { return this; }
    limit(value) {
      this.limitCount = Number(value || 0) || null;
      return this;
    }
    maybeSingle() {
      return this.then((result) => ({ data: Array.isArray(result.data) ? result.data[0] || null : result.data || null, error: result.error || null }));
    }
    insert(rows) {
      const inserted = (Array.isArray(rows) ? rows : [rows]).map((row) => ({ ...row, created_at: row.created_at || new Date().toISOString() }));
      db[this.table].push(...inserted);
      return {
        select: () => ({ maybeSingle: async () => ({ data: inserted[0] || null, error: null }) }),
        then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve),
      };
    }
    upsert(row) {
      const key = row.id ? "id" : row.workflow_id ? "workflow_id" : row.action_id ? "action_id" : null;
      const table = db[this.table];
      const idx = key ? table.findIndex((item) => String(item[key]) === String(row[key])) : -1;
      if (idx >= 0) table[idx] = { ...table[idx], ...row };
      else table.push({ ...row });
      return {
        select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        then: (resolve) => Promise.resolve({ data: row, error: null }).then(resolve),
      };
    }
    update(patch) {
      this.updatePatch = patch;
      return this;
    }
    delete() {
      this.deleteMode = true;
      return this;
    }
    execute() {
      let rows = clone(db[this.table] || []);
      for (const filter of this.filters) {
        if (filter.op === "gte") rows = rows.filter((row) => String(row[filter.column] || "") >= String(filter.value));
        else if (filter.op === "lte") rows = rows.filter((row) => String(row[filter.column] || "") <= String(filter.value));
        else rows = rows.filter((row) => String(row[filter.column] || "") === String(filter.value));
      }
      for (const filter of this.inFilters) rows = rows.filter((row) => filter.values.includes(String(row[filter.column])));
      if (this.limitCount) rows = rows.slice(0, this.limitCount);
      if (this.countMode) return { data: null, count: rows.length, error: null };
      if (this.deleteMode) return { data: rows, error: null };
      if (this.updatePatch) return { data: rows.map((row) => ({ ...row, ...this.updatePatch })), error: null };
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
const services = await import(path.join(root, "dist/oyi-core/workflows/defaultWorkflowActionServices.js"));

const resident = {
  id: "resident-1",
  role: "resident",
  estate_id: "estate-1",
  home_id: "home-1",
  permissions: ["devices.read", "devices.control"],
};
const oisContext = {
  actor_id: "resident-1",
  surface: "consumer",
  role: "resident",
  permissions: resident.permissions,
  estate_id: "estate-1",
  home_id: "home-1",
  module: "home",
  resolved_at: new Date().toISOString(),
};

async function run(prompt, threadId, extraInput = {}) {
  return orchestratorModule.conversationOrchestrator.run({
    actor: resident,
    oisContext,
    input: {
      message: prompt,
      surface: "consumer",
      estate_id: "estate-1",
      home_id: "home-1",
      thread_id: threadId,
      context: oisContext,
      ...extraInput,
    },
  });
}

function labelsFromActions(response) {
  return (response.suggested_actions || response.actions || []).map((action) => String(action.label || ""));
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

await check("multi-gang without channel asks channel and does not prepare confirmation", async () => {
  const response = await run("Turn off 3Gang Living room", "thread-multigang-no-channel");
  assert.match(response.answer, /Which channel on 3Gang Living room/i);
  assert.equal(response.execution?.capability_result, "draft");
  assert.notEqual(response.execution?.status, "pending_confirmation");
  assert.equal(response.confirmations?.length || 0, 0);
  assert.deepEqual(labelsFromActions(response), ["Channel 1", "Channel 2", "Channel 3"]);
});

await check("stale selected channel metadata cannot satisfy fresh multi-gang request", async () => {
  const response = await run("Turn off 3Gang Living room", "thread-stale-selected-channel", {
    target: {
      object_type: "device_channel",
      canonical_id: "device-3gang-living:switch_1",
      parent_id: "device-3gang-living",
      label: "3Gang Living room Channel 1",
      channel_code: "switch_1",
      home_id: "home-1",
      estate_id: "estate-1",
    },
    context: {
      ...oisContext,
      active_intelligence_context: {
        selected_subobject: {
          object_type: "device_channel",
          canonical_id: "device-3gang-living:switch_1",
          parent_id: "device-3gang-living",
          label: "3Gang Living room Channel 1",
          channel_code: "switch_1",
        },
      },
    },
  });
  assert.match(response.answer, /Which channel on 3Gang Living room/i);
  assert.equal(response.execution?.capability_result, "draft");
  assert.equal(response.confirmations?.length || 0, 0);
});

await check("multi-gang explicit channel reaches exact confirmation", async () => {
  const response = await run("Turn off 3Gang Living room channel 2", "thread-multigang-channel-2");
  assert.match(response.answer, /Please confirm/i);
  assert.match(response.answer, /turn off Channel 2 on 3Gang Living room/i);
  assert.equal(response.execution?.status, "pending_confirmation");
  assert.equal(response.confirmations?.[0]?.channel_code, "switch_2");
});

await check("single-channel device reaches confirmation without redundant channel clarification", async () => {
  const response = await run("Turn off Bedroom light", "thread-single-channel");
  assert.match(response.answer, /Please confirm/i);
  assert.match(response.answer, /Bedroom light/i);
  assert.doesNotMatch(response.answer, /Which channel/i);
  assert.equal(response.execution?.status, "pending_confirmation");
});

await check("invalid channel remains clarification and offers real device channels", async () => {
  const response = await run("Turn off 3Gang Living room channel 4", "thread-invalid-channel");
  assert.match(response.answer, /Channel 1/i);
  assert.match(response.answer, /Channel 2/i);
  assert.match(response.answer, /Channel 3/i);
  assert.equal(response.execution?.capability_result, "draft");
  assert.notEqual(response.execution?.status, "pending_confirmation");
  assert.deepEqual(labelsFromActions(response), ["Channel 1", "Channel 2", "Channel 3"]);
});

await check("channel continuation stays inside pending workflow", async () => {
  const thread = "thread-channel-continuation";
  const first = await run("Turn off 3Gang Living room", thread);
  assert.match(first.answer, /Which channel/i);
  const second = await run("Channel 1", thread);
  assert.match(second.answer, /Please confirm/i);
  assert.match(second.answer, /Channel 1/i);
  assert.doesNotMatch(second.answer, /offline|availability|stale|expired/i);
  assert.equal(second.confirmations?.[0]?.channel_code, "switch_1");
});

await check("channel clarification survives workflow restore", async () => {
  const thread = "thread-channel-restore";
  await run("Turn off 3Gang Living room", thread);
  const active = await services.workflowService.restoreActive({ threadId: thread, actorId: resident.id });
  assert.equal(active?.status, "awaiting_clarification");
  assert.equal(active?.target?.canonical_id, "device-3gang-living");
  assert.equal(active?.metadata?.missing_input, "channel");
  assert.equal(active?.metadata?.channel_definitions?.length, 3);
  const resumed = await run("Channel 2", thread);
  assert.equal(resumed.execution?.status, "pending_confirmation");
  assert.equal(resumed.confirmations?.[0]?.channel_code, "switch_2");
});

await check("confirmation survives workflow restore without executing", async () => {
  const thread = "thread-confirmation-restore";
  await run("Turn off 3Gang Living room channel 2", thread);
  const active = await services.workflowService.restoreActive({ threadId: thread, actorId: resident.id });
  assert.equal(active?.status, "awaiting_approval");
  const continued = await run("Continue", thread);
  assert.match(continued.answer, /3Gang Living room/i);
  assert.match(continued.answer, /Channel 2/i);
  assert.equal(continued.execution?.status, "pending_confirmation");
});

await check("cancel before channel completes workflow cleanly", async () => {
  const thread = "thread-cancel-before-channel";
  await run("Turn off 3Gang Living room", thread);
  const cancelled = await run("Cancel", thread);
  assert.match(cancelled.answer, /Cancelled/i);
  const yes = await run("Yes", thread);
  assert.doesNotMatch(yes.answer, /completed and was confirmed/i);
});

await check("cancel after confirmation prevents later approval", async () => {
  const thread = "thread-cancel-after-confirmation";
  await run("Turn off 3Gang Living room channel 2", thread);
  const cancelled = await run("Cancel", thread);
  assert.match(cancelled.answer, /Cancelled/i);
  const yes = await run("Yes", thread);
  assert.doesNotMatch(yes.answer, /completed and was confirmed/i);
});

console.log("oyi-workflow-action-phase-c-multigang-smoke passed");
process.exit(0);
