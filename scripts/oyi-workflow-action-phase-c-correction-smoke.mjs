import assert from "node:assert/strict";
import path from "node:path";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase-c-correction-local-only";
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
      },
      {
        id: "device-living-lamp",
        name: "Living room lamp",
        estate_id: "estate-1",
        home_id: "home-1",
        room_id: "room-living",
        category: "light",
        type: "switch",
        capabilities: ["switch_1"],
        metadata: { channel_definitions: [{ code: "switch_1", label: "Channel 1" }] },
        updated_at: now,
      },
    ],
    rooms: [{ id: "room-living", name: "Living Room", home_id: "home-1", metadata: {} }],
    wallets: [{ id: "wallet-1", home_id: "home-1", user_id: "resident-1" }],
    wallet_transactions: [{ id: "tx-1", wallet_id: "wallet-1", user_id: "resident-1", direction: "credit", type: "funding", amount: 100, status: "confirmed", created_at: now, updated_at: now, metadata: {} }],
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
    or(value) {
      this.orFilter = String(value || "");
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
      const inserted = (Array.isArray(rows) ? rows : [rows]).map((row) => ({ ...row, created_at: row.created_at || new Date().toISOString() }));
      db[this.table].push(...inserted);
      return { select: () => ({ maybeSingle: async () => ({ data: inserted[0] || null, error: null }) }), then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve) };
    }
    upsert(row) {
      const key = row.id ? "id" : row.workflow_id ? "workflow_id" : row.action_id ? "action_id" : null;
      const table = db[this.table];
      const idx = key ? table.findIndex((item) => String(item[key]) === String(row[key])) : -1;
      if (idx >= 0) table[idx] = { ...table[idx], ...row };
      else table.push({ ...row });
      return { select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }), then: (resolve) => Promise.resolve({ data: row, error: null }).then(resolve) };
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
      if (this.orFilter && this.table === "wallet_transactions") rows = clone(db.wallet_transactions);
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

const resident = { id: "resident-1", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: ["devices.read", "devices.control", "wallets.read", "services.read"] };
const oisContext = { actor_id: "resident-1", surface: "consumer", role: "resident", permissions: resident.permissions, estate_id: "estate-1", home_id: "home-1", module: "home", resolved_at: new Date().toISOString() };

async function run(prompt, threadId = "11111111-1111-4111-8111-111111111111") {
  return orchestratorModule.conversationOrchestrator.run({
    actor: resident,
    oisContext,
    input: { message: prompt, surface: "consumer", estate_id: "estate-1", home_id: "home-1", thread_id: threadId, context: oisContext },
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

await check("exact device target resolves and asks channel, not exact device", async () => {
  const response = await run("Turn off 3Gang Living room", "thread-exact-target-000000000001");
  assert.match(response.answer, /Which channel/i);
  assert.match(response.answer, /3Gang Living room/i);
  assert.doesNotMatch(response.answer, /exact device/i);
  assert.equal(response.execution?.capability_result, "draft");
});

await check("exact device plus channel reaches confirmation in one turn", async () => {
  const response = await run("Turn off 3Gang Living room channel 2.", "thread-complete-command-0001");
  assert.match(response.answer, /Please confirm/i);
  assert.match(response.answer, /3Gang Living room/i);
  assert.match(response.answer, /Channel 2/i);
  assert.equal(response.execution?.status, "pending_confirmation");
  assert.equal(response.confirmations?.[0]?.channel_code, "switch_2");
});

await check("typed continuation selects channel and does not route availability read", async () => {
  const thread = "thread-continuation-000000001";
  const first = await run("Turn off 3Gang Living room", thread);
  assert.match(first.answer, /Which channel/i);
  const second = await run("Channel 1", thread);
  assert.match(second.answer, /Please confirm/i);
  assert.match(second.answer, /Channel 1/i);
  assert.doesNotMatch(second.answer, /offline|availability|stale|expired/i);
  assert.equal(second.execution?.status, "pending_confirmation");
});

await check("wrong target continuation type cannot escape to availability read", async () => {
  const thread = "thread-wrong-type-0000000001";
  await run("Turn off unknown hallway thing", thread);
  const response = await run("Channel 1", thread);
  assert.match(response.answer, /need the device/i);
  assert.doesNotMatch(response.answer, /offline|availability|stale|expired/i);
});

await check("unrelated read while channel pending uses read path and preserves workflow", async () => {
  const thread = "thread-unrelated-read-0000001";
  await run("Turn off 3Gang Living room", thread);
  const wallet = await run("Show wallet history", thread);
  assert.match(wallet.answer, /Wallet|transaction|funding/i);
  const resumed = await run("Channel 2", thread);
  assert.match(resumed.answer, /Please confirm/i);
  assert.match(resumed.answer, /Channel 2/i);
});

await check("restart restoration continues channel clarification", async () => {
  const thread = "thread-restart-000000000001";
  await run("Turn off 3Gang Living room", thread);
  const restartedWorkflowService = services.workflowService;
  const active = await restartedWorkflowService.restoreActive({ threadId: thread, actorId: resident.id });
  assert.equal(active?.status, "awaiting_clarification");
  const resumed = await run("Channel 2", thread);
  assert.equal(resumed.execution?.status, "pending_confirmation");
});

await check("cancellation after confirmation prevents execution", async () => {
  const thread = "thread-cancel-0000000000001";
  await run("Turn off 3Gang Living room channel 2.", thread);
  const cancelled = await run("Cancel", thread);
  assert.match(cancelled.answer, /Cancelled/i);
  const yes = await run("Yes", thread);
  assert.doesNotMatch(yes.answer, /completed and was confirmed/i);
});

console.log("oyi-workflow-action-phase-c-correction-smoke passed");
process.exit(0);
