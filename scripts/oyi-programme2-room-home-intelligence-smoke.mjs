import assert from "node:assert/strict";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "programme2-smoke-service-role-key";

const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));

const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const hoursAgo = (n) => new Date(now.getTime() - n * 60 * 60 * 1000).toISOString();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeSupabase(overrides = {}) {
  const db = {
    rooms: [
      { id: "room-living", estate_id: "estate-1", home_id: "home-1", name: "Living Room", type: "living_room", floor: 1, ai_profile: {}, created_at: daysAgo(400) },
      { id: "room-kitchen", estate_id: "estate-1", home_id: "home-1", name: "Kitchen", type: "kitchen", floor: 1, ai_profile: {}, created_at: daysAgo(400) },
    ],
    devices: [
      { id: "dev-1", name: "Living Room Switch", estate_id: "estate-1", home_id: "home-1", room_id: "room-living", parent_device_id: null, is_virtual: false, category: "switch", type: "switch", online: true, status: {}, capabilities: [], metadata: {}, last_seen_at: hoursAgo(0.1), updated_at: hoursAgo(0.1) },
      { id: "dev-2", name: "Living Room Lamp", estate_id: "estate-1", home_id: "home-1", room_id: "room-living", parent_device_id: null, is_virtual: false, category: "switch", type: "switch", online: false, status: {}, capabilities: [], metadata: {}, last_seen_at: hoursAgo(10), updated_at: hoursAgo(10) },
      { id: "dev-3", name: "Kitchen Socket", estate_id: "estate-1", home_id: "home-1", room_id: "room-kitchen", parent_device_id: null, is_virtual: false, category: "switch", type: "switch", online: true, status: {}, capabilities: [], metadata: {}, last_seen_at: hoursAgo(0.1), updated_at: hoursAgo(0.1) },
    ],
    device_states: [
      { device_id: "dev-1", status: { online: true }, last_seen: hoursAgo(0.1), updated_at: hoursAgo(0.1) },
      { device_id: "dev-2", status: { online: false }, last_seen: hoursAgo(10), updated_at: hoursAgo(10) },
      { device_id: "dev-3", status: { online: true }, last_seen: hoursAgo(0.1), updated_at: hoursAgo(0.1) },
    ],
    maintenance_requests: [
      { id: "mr-1", estate_id: "estate-1", home_id: "home-1", room_id: "room-living", resident_id: "resident-1", title: "AC not cooling", description: null, category: "hvac", priority: "high", status: "open", assigned_to: null, created_at: daysAgo(6), updated_at: daysAgo(6) },
    ],
    visitor_access: [
      { id: "va-1", estate_id: "estate-1", home_id: "home-1", visitor_name: "Amara Bello", purpose: "Guest", access_code: "4471", status: "expected", expires_at: daysAgo(-1), created_at: hoursAgo(2), updated_at: hoursAgo(2) },
    ],
    facility_incidents: [],
    home_service_assignments: [
      { home_id: "home-1", service_key: "utility_token", enabled: true, scope: "home", updated_at: daysAgo(2) },
    ],
    home_service_accounts: [
      { id: "hsa-1", home_id: "home-1", service_key: "utility_token", provider: "PowerCo", status: "active", linked: true, due_date: null, expires_at: null, updated_at: daysAgo(2) },
    ],
    wallets: [{ id: "wallet-1", home_id: "home-1", user_id: "resident-1", balance: 15000, currency: "NGN", is_frozen: false, updated_at: daysAgo(0) }],
    wallet_transactions: [],
    community_posts: [],
    users: [],
    consumer_scenes: [{ id: "sc-1", estate_id: "estate-1", home_id: "home-1", name: "Evening lights", actions: [], enabled: true, updated_at: daysAgo(3) }],
    consumer_automations: [{ id: "au-1", estate_id: "estate-1", home_id: "home-1", name: "Low battery alert", trigger: { type: "battery_low" }, actions: [], enabled: true, next_run_at: null, last_run_at: hoursAgo(9), last_run_status: "failed", updated_at: hoursAgo(9) }],
    consumer_automation_runs: [
      { id: "run-1", automation_id: "au-1", estate_id: "estate-1", home_id: "home-1", trigger_type: "battery_low", source: "system", status: "failed", started_at: hoursAgo(9), completed_at: hoursAgo(9), error_code: "SENSOR_TIMEOUT", error_message: "Sensor did not respond in time", created_at: hoursAgo(9) },
    ],
    oyi_conversation_threads: [],
    oyi_conversation_messages: [],
    ...overrides,
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.inFilters = [];
      this.orFilter = "";
      this.limitCount = null;
      this.updatePatch = null;
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
    neq(column, value) {
      this.filters.push({ column, op: "neq", value });
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
    in(column, values) {
      this.inFilters.push({ column, values: values.map(String) });
      return this;
    }
    or(value) {
      this.orFilter = String(value || "");
      return this;
    }
    order(column) {
      this.orderColumn = column;
      return this;
    }
    limit(value) {
      this.limitCount = Number(value || 0) || null;
      return this;
    }
    maybeSingle() {
      return this.then((result) => ({ data: Array.isArray(result.data) ? result.data[0] || null : result.data || null, error: result.error || null }));
    }
    single() {
      return this.maybeSingle();
    }
    insert(rows) {
      const inserted = (Array.isArray(rows) ? rows : [rows]).map((row) => ({ ...row }));
      if (!db[this.table]) db[this.table] = [];
      db[this.table].push(...inserted);
      return {
        select: () => ({ maybeSingle: async () => ({ data: inserted[0] || null, error: null }), single: async () => ({ data: inserted[0] || null, error: null }) }),
        then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve),
      };
    }
    upsert(row) {
      if (!db[this.table]) db[this.table] = [];
      const table = db[this.table];
      const idx = table.findIndex((item) => String(item.id) === String(row.id));
      if (idx >= 0) table[idx] = { ...table[idx], ...row };
      else table.push({ ...row });
      return Promise.resolve({ data: row, error: null });
    }
    update(patch) {
      this.updatePatch = patch;
      return this;
    }
    execute() {
      if (this.table === "__throw__") return { data: null, error: { message: "simulated failure" } };
      let rows = clone(db[this.table] || []);
      for (const filter of this.filters) {
        if (filter.op === "gte") rows = rows.filter((row) => String(row[filter.column] || "") >= String(filter.value));
        else if (filter.op === "lte") rows = rows.filter((row) => String(row[filter.column] || "") <= String(filter.value));
        else if (filter.op === "neq") rows = rows.filter((row) => String(row[filter.column] || "") !== String(filter.value));
        else rows = rows.filter((row) => String(row[filter.column] || "") === String(filter.value));
      }
      for (const filter of this.inFilters) rows = rows.filter((row) => filter.values.includes(String(row[filter.column])));
      if (this.orFilter && this.table === "wallet_transactions") {
        const home = this.orFilter.match(/home_id\.eq\.([^,]+)/)?.[1] || "";
        const walletIds = this.orFilter.match(/wallet_id\.in\.\(([^)]+)\)/)?.[1]?.split(",").map((item) => item.trim()) || [];
        rows = clone(db.wallet_transactions).filter((row) => String(row.home_id || "") === home || walletIds.includes(String(row.wallet_id || "")));
      }
      if (this.orderColumn) rows.sort((a, b) => String(b[this.orderColumn] || "").localeCompare(String(a[this.orderColumn] || "")));
      if (this.limitCount) rows = rows.slice(0, this.limitCount);
      if (this.countMode) return { data: null, count: rows.length, error: null };
      if (this.updatePatch) {
        const table = db[this.table];
        const ids = new Set(rows.map((row) => String(row.id)));
        for (let i = 0; i < table.length; i += 1) if (ids.has(String(table[i].id))) table[i] = { ...table[i], ...this.updatePatch };
        return { data: rows.map((row) => ({ ...row, ...this.updatePatch })), error: null };
      }
      if (this.table === "security_incidents_should_fail") return { data: null, error: { message: "simulated security failure" } };
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

let fakeSupabase = createFakeSupabase();
supabaseModule.supabaseAdmin.from = (table) => fakeSupabase.from(table);

const registryModule = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityRegistry.js"));
const readModules = await import(path.join(root, "dist/oyi-core/capabilities/ReadCapabilityModules.js"));
const orchestratorModule = await import(path.join(root, "dist/oyi-core/orchestration/ConversationOrchestrator.js"));
const aggregateContractModule = await import(path.join(root, "dist/oyi-core/domains/roomHome/aggregateContract.js"));
const roomTargetModule = await import(path.join(root, "dist/oyi-core/domains/roomHome/roomTargetResolution.js"));

for (const capability of readModules.buildPhaseBReadCapabilities()) registryModule.capabilityRegistry.register(capability);

const resident = { id: "resident-1", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: ["devices.read", "maintenance.read", "visitors.read", "security.read", "utilities.read", "wallet.read", "services.read", "community.read", "automations.read", "scenes.read", "homes.read"] };
const context = { actor_id: "resident-1", surface: "consumer", role: "resident", permissions: resident.permissions, estate_id: "estate-1", home_id: "home-1", module: "home", resolved_at: now.toISOString() };

async function run(prompt, threadId = null) {
  return orchestratorModule.conversationOrchestrator.run({
    actor: resident,
    oisContext: context,
    input: { message: prompt, surface: "consumer", estate_id: "estate-1", home_id: "home-1", thread_id: threadId || undefined, context },
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

// ---------- unit-level: aggregate contract ----------

check("overallStateFor: a real finding wins over a coverage gap", () => {
  const critical = aggregateContractModule.overallStateFor("critical", { requested: 3, answered: 2, empty: 0, degraded: 0, unavailable: 1 });
  assert.equal(critical, "critical");
  const partial = aggregateContractModule.overallStateFor("none", { requested: 3, answered: 2, empty: 0, degraded: 0, unavailable: 1 });
  assert.equal(partial, "partial");
  const stable = aggregateContractModule.overallStateFor("none", { requested: 3, answered: 3, empty: 0, degraded: 0, unavailable: 0 });
  assert.equal(stable, "stable");
});

check("dedupeAttentionItems collapses the same object, keeps distinct ones, keeps highest severity", () => {
  const items = [
    { domain: "devices", severity: "attention", summary: "a", object_ref: { object_type: "device", canonical_id: "dev-2", label: "Lamp", domain: "devices" }, dedup_key: "device:dev-2" },
    { domain: "security", severity: "critical", summary: "b", object_ref: { object_type: "device", canonical_id: "dev-2", label: "Lamp", domain: "security" }, dedup_key: "device:dev-2" },
    { domain: "maintenance", severity: "warning", summary: "c", object_ref: { object_type: "maintenance_request", canonical_id: "mr-1", label: "AC", domain: "maintenance" }, dedup_key: "maintenance_request:mr-1" },
  ];
  const deduped = aggregateContractModule.dedupeAttentionItems(items);
  assert.equal(deduped.length, 2, "same object_type:canonical_id must collapse to one");
  assert.equal(deduped[0].severity, "critical", "highest severity for the collapsed object must win, and sort first");
});

check("roomPhraseForIntelligence extracts room nouns from broad 'how is' questions the stricter device-command extractor misses", () => {
  assert.equal(roomTargetModule.roomPhraseForIntelligence("How is the living room?"), "living room");
  assert.equal(roomTargetModule.roomPhraseForIntelligence("Anything wrong in the kitchen?"), "kitchen");
  assert.equal(roomTargetModule.roomPhraseForIntelligence("How is my home?"), "", "must not misfire on a home-level question");
});

// ---------- end-to-end: Home Intelligence ----------

await check("home summary: attention item surfaced, not a device inventory dump, no wallet balance stated", async () => {
  const response = await run("How is my home?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "home.summary.read");
  assert.doesNotMatch(response.answer, /\d+ devices? connected|\d+ devices? on record/i, "must not degrade into a device list — §17 regression guard");
  assert.match(response.answer, /AC not cooling|maintenance/i, "the open high-priority maintenance request must be the headline finding");
  assert.doesNotMatch(response.answer, /15,000|NGN 15/i, "must not state the wallet balance unnecessarily in a broad Home summary — §45");
  assert.equal(response.persistence_saved, true);
});

await check("home attention: explicit attention-only phrasing routes to home.attention.read", async () => {
  const response = await run("What needs my attention?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "home.attention.read");
  assert.match(response.answer, /AC not cooling|maintenance/i);
});

await check("home partial coverage: a contributor exception is isolated, not a total failure", async () => {
  const originalFrom = fakeSupabase.from.bind(fakeSupabase);
  fakeSupabase.from = (table) => {
    if (table === "facility_incidents") throw new Error("simulated security contributor crash");
    return originalFrom(table);
  };
  try {
    const response = await run("How is my home?");
    assert.notEqual(response.answer, undefined);
    assert.doesNotMatch(response.answer, /couldn't reach Oyi|could not reach Oyi/i, "one contributor failing must not collapse to a generic failure");
    assert.match(response.answer, /could not confirm current security/i, "the coverage gap must be stated honestly, not silently dropped");
  } finally {
    fakeSupabase.from = originalFrom;
  }
});

// ---------- end-to-end: Room Intelligence ----------

await check("room status: living room surfaces its own maintenance issue and offline device, not home-wide data", async () => {
  const response = await run("How is the living room?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "room.status.read");
  assert.match(response.answer, /AC not cooling|maintenance/i);
  assert.doesNotMatch(response.answer, /Kitchen Socket/i, "kitchen's device must not appear in the living room's answer");
});

await check("room not found: a truthful failure, not a silent fallback to home-wide data", async () => {
  const response = await run("How is the garage?");
  assert.match(response.answer, /could not find a room called "garage"/i);
});

await check("room with no relevant maintenance: kitchen is calm, no fabricated issues", async () => {
  const response = await run("Anything wrong in the kitchen?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "room.attention.read");
  assert.doesNotMatch(response.answer, /AC not cooling/i, "the living room's maintenance issue must not leak into the kitchen's answer");
});

// ---------- cross-domain follow-up / drill-down (reuses Programme 1) ----------

await check("cross-domain drill-down: home summary -> automation detail -> why -> maintenance detail, all via Programme 1 follow-up", async () => {
  const homeResponse = await run("How is my home?");
  const threadId = homeResponse.thread_id;
  assert.ok(threadId);

  const threadRow = fakeSupabase.db.oyi_conversation_threads.find((row) => row.id === threadId);
  assert.ok(threadRow.metadata.result_sets.maintenance, "maintenance must have its own per-domain result set from the multi-domain home turn");
  assert.ok(threadRow.metadata.result_sets.automations, "automations must have its own per-domain result set from the same turn");

  const automationResponse = await run("Tell me about the automation.", threadId);
  assert.equal(automationResponse.execution.orchestrator_v2.followup.reference_type, "pronoun");
  assert.equal(automationResponse.execution.orchestrator_v2.followup.source_domain, "automations");

  const whyResponse = await run("Why did it fail?", threadId);
  assert.match(whyResponse.answer, /SENSOR_TIMEOUT|Sensor did not respond/i);

  const maintenanceResponse = await run("What about the maintenance issue?", threadId);
  assert.equal(maintenanceResponse.execution.orchestrator_v2.followup.source_domain, "maintenance");
  assert.match(maintenanceResponse.answer, /open/i);
});

// ---------- Home <-> Room continuity ----------

await check("home -> room -> home: each answer is scoped correctly and both stay in one thread", async () => {
  const homeResponse = await run("How is my home?");
  const threadId = homeResponse.thread_id;

  const roomResponse = await run("How is the living room?", threadId);
  assert.equal(roomResponse.execution.orchestrator_v2.capability_key, "room.status.read");

  const backToHome = await run("What needs my attention?", threadId);
  assert.equal(backToHome.execution.orchestrator_v2.capability_key, "home.attention.read");
  assert.equal(backToHome.thread_id, threadId, "must stay in the same canonical thread throughout");
});

// ---------- reload continuity ----------

await check("reload continuity: the maintenance result set from a home summary survives and resolves after a simulated reload", async () => {
  const homeResponse = await run("How is my home?");
  const threadId = homeResponse.thread_id;
  // Simulate a Consumer reload: nothing is held in memory, the next turn
  // only carries the thread_id, exactly like run() already does — the
  // assertion is that persisted metadata (not frontend state) drives this.
  const maintenanceResponse = await run("What about the maintenance issue?", threadId);
  assert.equal(maintenanceResponse.execution.orchestrator_v2.followup.source_domain, "maintenance");
  assert.match(maintenanceResponse.answer, /open/i);
});

console.log("oyi-programme2-room-home-intelligence-smoke passed");
process.exit(0);
