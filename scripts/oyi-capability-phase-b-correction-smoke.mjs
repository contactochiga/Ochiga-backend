import assert from "node:assert/strict";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase-b-correction-smoke-service-role-key";

const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));

const now = new Date();
const oldDate = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();
const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeSupabase() {
  const db = {
    wallets: [{ id: "wallet-1", home_id: "home-1", user_id: "resident-1" }],
    wallet_transactions: [
      { id: "tx-old", wallet_id: "wallet-1", home_id: null, user_id: "resident-1", direction: "credit", type: "funding", amount: 20000, reference: "funding_25x7jo92c5", status: "confirmed", metadata: {}, created_at: oldDate, updated_at: oldDate },
      { id: "tx-recent", wallet_id: "wallet-1", home_id: null, user_id: "resident-1", direction: "debit", type: "electricity", amount: 5000, reference: "uuid-like-reference", status: "confirmed", metadata: { service_category: "electricity" }, created_at: recentDate, updated_at: recentDate },
    ],
    devices: [{ id: "dev-1", name: "Living Room Switch", estate_id: "estate-1", home_id: "home-1", room_id: null, parent_device_id: null, is_virtual: false, category: "switch", type: "switch", online: false, status: {}, capabilities: [], metadata: {}, last_seen_at: now.toISOString(), updated_at: now.toISOString() }],
    rooms: [],
    device_states: [{ device_id: "dev-1", status: { online: false }, last_seen: now.toISOString(), updated_at: now.toISOString() }],
    oyi_conversation_threads: [],
    oyi_conversation_messages: [],
  };
  const calls = [];

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.inFilters = [];
      this.orFilter = "";
      this.limitCount = null;
      this.insertRows = null;
      this.upsertRow = null;
      this.updatePatch = null;
      this.deleteMode = false;
      this.singleMode = false;
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
    order() {
      return this;
    }
    limit(value) {
      this.limitCount = Number(value || 0) || null;
      return this;
    }
    maybeSingle() {
      this.singleMode = true;
      return this.then((result) => ({ data: Array.isArray(result.data) ? result.data[0] || null : result.data || null, error: result.error || null }));
    }
    single() {
      return this.maybeSingle();
    }
    insert(rows) {
      this.insertRows = Array.isArray(rows) ? rows : [rows];
      const inserted = this.insertRows.map((row) => ({ ...row }));
      db[this.table].push(...inserted);
      calls.push({ table: this.table, op: "insert", count: inserted.length });
      return { select: () => ({ maybeSingle: async () => ({ data: inserted[0] || null, error: null }), single: async () => ({ data: inserted[0] || null, error: null }) }), then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve) };
    }
    upsert(row) {
      this.upsertRow = row;
      const table = db[this.table];
      const idx = table.findIndex((item) => String(item.id) === String(row.id));
      if (idx >= 0) table[idx] = { ...table[idx], ...row };
      else table.push({ ...row });
      calls.push({ table: this.table, op: "upsert", id: row.id });
      return Promise.resolve({ data: row, error: null });
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
      if (this.orFilter && this.table === "wallet_transactions") {
        const home = this.orFilter.match(/home_id\.eq\.([^,]+)/)?.[1] || "";
        const walletIds = this.orFilter.match(/wallet_id\.in\.\(([^)]+)\)/)?.[1]?.split(",").map((item) => item.trim()) || [];
        rows = clone(db.wallet_transactions).filter((row) => String(row.home_id || "") === home || walletIds.includes(String(row.wallet_id || "")));
      }
      if (this.table === "wallet_transactions" || this.table === "oyi_conversation_messages") rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      if (this.limitCount) rows = rows.slice(0, this.limitCount);
      if (this.countMode) return { data: null, count: rows.length, error: null };
      if (this.updatePatch) {
        const table = db[this.table];
        const ids = new Set(rows.map((row) => String(row.id)));
        for (let i = 0; i < table.length; i += 1) if (ids.has(String(table[i].id))) table[i] = { ...table[i], ...this.updatePatch };
        return { data: rows.map((row) => ({ ...row, ...this.updatePatch })), error: null };
      }
      return { data: rows, error: null };
    }
    then(resolve, reject) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }
  }

  return {
    db,
    calls,
    from(table) {
      if (!db[table]) db[table] = [];
      return new Query(table);
    },
  };
}

const fakeSupabase = createFakeSupabase();
supabaseModule.supabaseAdmin.from = fakeSupabase.from.bind(fakeSupabase);

const registryModule = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityRegistry.js"));
const readModules = await import(path.join(root, "dist/oyi-core/capabilities/ReadCapabilityModules.js"));
const serviceModule = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityService.js"));
const parser = await import(path.join(root, "dist/oyi-core/interpretation/SemanticFrameParser.js"));
const orchestratorModule = await import(path.join(root, "dist/oyi-core/orchestration/ConversationOrchestrator.js"));
const walletEvidence = await import(path.join(root, "dist/oyi-core/domains/wallet/walletEvidence.js"));

for (const capability of readModules.buildPhaseBReadCapabilities()) registryModule.capabilityRegistry.register(capability);

const resident = { id: "resident-1", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: ["devices.read", "wallets.read", "services.read"] };
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

await check("capability-owned reads persist canonical history", async () => {
  const capability = await run("What can you do?");
  const wallet = await run("Show wallet history.", capability.thread_id);
  const devices = await run("Which devices are offline?", wallet.thread_id);
  for (const response of [capability, wallet, devices]) {
    assert.equal(response.persistence_saved, true);
    assert.ok(response.thread_id);
  }
  assert.ok(fakeSupabase.db.oyi_conversation_threads.length >= 1);
  assert.equal(fakeSupabase.db.oyi_conversation_messages.filter((row) => row.role === "user").length, 3);
  assert.equal(fakeSupabase.db.oyi_conversation_messages.filter((row) => row.role === "assistant").length, 3);
});

await check("wallet history, typo and recent transaction prompts share capability and rows", async () => {
  const prompts = ["Show wallet history.", "Show wallet histry.", "Show my recent transactions."];
  for (const prompt of prompts) {
    const response = await run(prompt);
    assert.equal(response.execution.orchestrator_v2.capability_key, "wallet.transactions.read");
    assert.equal(response.execution.orchestrator_v2.legacy_fallback_used, false);
    assert.match(response.answer, /2 wallet transactions?/i);
    assert.doesNotMatch(response.answer, /funding_25x7jo92c5|tx-old|tx-recent/i);
  }
});

await check("wallet evidence loads by authorised home wallet id and preserves historical rows", async () => {
  const frame = parser.parseSemanticFrame("Show wallet history.");
  const facts = await walletEvidence.loadWalletTransactionFacts(
    { message: "Show wallet history.", surface: "consumer", estate_id: "estate-1", home_id: "home-1", context },
    context,
    { conversation_request_id: "wallet-test", temporal_scope: { mode: "historical", from: null, to: null } },
  );
  assert.equal(facts.filter((fact) => fact.truth_state === "confirmed").length, 2);
  assert.equal(frame.operation, "wallet.history");
});

await check("utility spending and active utility requests resolve to distinct capabilities", () => {
  const spending = parser.parseSemanticFrame("How much did I spend on utilities?");
  const active = parser.parseSemanticFrame("Which utilities are active?");
  assert.equal(spending.operation, "utilities.spending");
  assert.equal(active.operation, "utilities.active");
  const spendingSelection = serviceModule.capabilityService.resolve({ actor: resident, oisContext: context, input: { message: spending.rawText, surface: "consumer", estate_id: "estate-1", home_id: "home-1", context }, resolvedTurn: { request_id: "spend", correlation_id: "spend", runtime_id: "runtime", thread_id: null, actor: resident, semantic_frame: spending, operation: spending.operation, capability_key: spending.operation, domain: spending.domain, scope: { estate_id: "estate-1", building_id: null, home_id: "home-1", room_id: null }, target: null, target_source: "none", active_workflow_id: null, authority: { allowed: true, tier: 0, approval_required: false, secure_review_required: false, required_permissions: [], denial_reason: null }, temporal_scope: spending.temporalScope, presentation_policy: { primary: "table", allowed_supporting_blocks: ["text", "table"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "current_state_snapshot", auto_navigation: false }, context } });
  const activeSelection = serviceModule.capabilityService.resolve({ actor: resident, oisContext: context, input: { message: active.rawText, surface: "consumer", estate_id: "estate-1", home_id: "home-1", context }, resolvedTurn: { request_id: "active", correlation_id: "active", runtime_id: "runtime", thread_id: null, actor: resident, semantic_frame: active, operation: active.operation, capability_key: active.operation, domain: active.domain, scope: { estate_id: "estate-1", building_id: null, home_id: "home-1", room_id: null }, target: null, target_source: "none", active_workflow_id: null, authority: { allowed: true, tier: 0, approval_required: false, secure_review_required: false, required_permissions: [], denial_reason: null }, temporal_scope: active.temporalScope, presentation_policy: { primary: "table", allowed_supporting_blocks: ["text", "table"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "current_state_snapshot", auto_navigation: false }, context } });
  assert.equal(spendingSelection.capability?.key, "utilities.spending.read");
  // utilities.active.read was promoted to a real evidence-backed capability
  // in the Programme 1 pass (see oyi-direct-evidence-programme1-smoke.mjs);
  // it now resolves directly instead of falling back to legacy.
  assert.equal(activeSelection.capability?.key, "utilities.active.read");
  assert.equal(activeSelection.rollout_status, "enabled");
  assert.equal(activeSelection.legacy_fallback_reason, null);
  assert.notEqual(spendingSelection.capability?.key, activeSelection.capability?.key);
});

await check("empty, unavailable and permission-restricted remain distinct", async () => {
  const emptyFake = createFakeSupabase();
  emptyFake.db.wallets = [{ id: "wallet-empty", home_id: "home-1" }];
  emptyFake.db.wallet_transactions = [];
  supabaseModule.supabaseAdmin.from = emptyFake.from.bind(emptyFake);
  const empty = await walletEvidence.loadWalletTransactionFacts({ message: "Show wallet history.", surface: "consumer", estate_id: "estate-1", home_id: "home-1", context }, context, { conversation_request_id: "empty-test", temporal_scope: { mode: "historical", from: null, to: null } });
  assert.equal(empty.length, 0);

  const failing = createFakeSupabase();
  failing.from = (table) => {
    if (table === "wallets") return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: null, error: new Error("db_down") }) }) }) };
    return createFakeSupabase().from(table);
  };
  supabaseModule.supabaseAdmin.from = failing.from.bind(failing);
  const unavailable = await walletEvidence.loadWalletTransactionFacts({ message: "Show wallet history.", surface: "consumer", estate_id: "estate-1", home_id: "home-1", context }, context, { conversation_request_id: "unavailable-test", temporal_scope: { mode: "historical", from: null, to: null } });
  assert.equal(unavailable[0].truth_state, "unavailable");

  const denied = serviceModule.capabilityService.canUse("wallet.transactions.read", { actor: resident, oisContext: context, surface: "consumer", scope: { estate_id: "estate-1", building_id: null, home_id: "home-2", room_id: null } });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "home_scope_not_owned_by_actor");
});

console.log("oyi capability phase-b correction smoke passed");
process.exit(0);
