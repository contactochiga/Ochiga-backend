import assert from "node:assert/strict";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase-b-final-smoke-service-role-key";

const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));

const now = new Date();
const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
const olderDate = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeSupabase() {
  const db = {
    wallets: [{ id: "wallet-1", home_id: "home-1", user_id: "resident-1" }],
    wallet_transactions: [
      { id: "tx-1", wallet_id: "wallet-1", home_id: null, user_id: "resident-1", direction: "credit", type: "funding", amount: 10000, reference: "funding_25x7jo92c5", status: "confirmed", metadata: {}, created_at: olderDate, updated_at: olderDate },
      { id: "tx-2", wallet_id: "wallet-1", home_id: null, user_id: "resident-1", direction: "credit", type: "funding", amount: 10000, reference: "funding_9az7jo92c5", status: "confirmed", metadata: {}, created_at: recentDate, updated_at: recentDate },
      { id: "tx-3", wallet_id: "wallet-1", home_id: null, user_id: "resident-1", direction: "debit", type: "electricity", amount: 2500, reference: "uuid-like-reference", status: "confirmed", metadata: { service_category: "electricity" }, created_at: recentDate, updated_at: recentDate },
    ],
    devices: [{ id: "dev-1", name: "Living Room Switch", estate_id: "estate-1", home_id: "home-1", room_id: null, parent_device_id: null, is_virtual: false, category: "switch", type: "switch", online: false, status: {}, capabilities: [], metadata: {}, last_seen_at: now.toISOString(), updated_at: now.toISOString() }],
    rooms: [],
    device_states: [{ device_id: "dev-1", status: { online: false }, last_seen: now.toISOString(), updated_at: now.toISOString() }],
    oyi_conversation_threads: [],
    oyi_conversation_messages: [],
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
      return this.then((result) => ({ data: Array.isArray(result.data) ? result.data[0] || null : result.data || null, error: result.error || null }));
    }
    single() {
      return this.maybeSingle();
    }
    insert(rows) {
      const inserted = (Array.isArray(rows) ? rows : [rows]).map((row) => ({ ...row }));
      db[this.table].push(...inserted);
      return {
        select: () => ({ maybeSingle: async () => ({ data: inserted[0] || null, error: null }), single: async () => ({ data: inserted[0] || null, error: null }) }),
        then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve),
      };
    }
    upsert(row) {
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

for (const capability of readModules.buildPhaseBReadCapabilities()) registryModule.capabilityRegistry.register(capability);

const resident = { id: "resident-1", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: ["devices.read", "wallets.read", "services.read", "maintenance.read"] };
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

await check("capability advertising is registry-backed without Home update artifact", async () => {
  const response = await run("What can you do?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "global.capabilities.read");
  assert.equal(response.persistence_saved, true);
  assert.match(response.answer, /device status and availability/i);
  assert.match(response.answer, /wallet transaction history/i);
  assert.match(response.answer, /utility spending/i);
  assert.doesNotMatch(response.answer, /enabled capability registry|declared|shadowed|Home update/i);
  assert.equal((response.cards || []).length, 0);
  assert.equal((response.suggested_actions || []).some((action) => /home update/i.test(`${action.label} ${action.title} ${action.route}`)), false);
});

await check("active utility capability is enabled and answers directly (Programme 1 promotion)", async () => {
  // utilities.active.read was promoted to a real evidence-backed capability
  // in the Programme 1 pass (see oyi-direct-evidence-programme1-smoke.mjs).
  // It now resolves directly instead of falling back to the legacy canned
  // "can't confirm active utility services" line.
  const frame = parser.parseSemanticFrame("Which utilities are active?");
  assert.equal(frame.operation, "utilities.active");
  const selection = serviceModule.capabilityService.resolve({ actor: resident, oisContext: context, input: { message: frame.rawText, surface: "consumer", estate_id: "estate-1", home_id: "home-1", context }, resolvedTurn: { request_id: "active", correlation_id: "active", runtime_id: "runtime", thread_id: null, actor: resident, semantic_frame: frame, operation: frame.operation, capability_key: frame.operation, domain: frame.domain, scope: { estate_id: "estate-1", building_id: null, home_id: "home-1", room_id: null }, target: null, target_source: "none", active_workflow_id: null, authority: { allowed: true, tier: 0, approval_required: false, secure_review_required: false, required_permissions: [], denial_reason: null }, temporal_scope: frame.temporalScope, presentation_policy: { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false }, context } });
  assert.equal(selection.capability?.key, "utilities.active.read");
  assert.equal(selection.rollout_status, "enabled");
  assert.equal(selection.legacy_fallback_reason, null);
  const response = await run("Which utilities are active?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "utilities.active.read");
  assert.equal(response.execution.orchestrator_v2.capability_rollout_status, "enabled");
  assert.equal(response.persistence_saved, true);
  assert.doesNotMatch(response.answer, /couldn't reach Oyi|could not reach Oyi|can.t confirm.*active utility services/i);
  assert.match(response.answer, /do not see any registered utility accounts/i);
});

await check("maintenance capability answers directly for another domain", async () => {
  // This assertion predates the maintenance direct-evidence pass (ca170bd),
  // which converted maintenance.requests.read from a declared/"implemented"
  // stub into a real, enabled readModule — its rollout_status is correctly
  // "enabled" now, not the old "implemented" placeholder value.
  const response = await run("Show open maintenance requests.");
  assert.equal(response.execution.orchestrator_v2.capability_key, "maintenance.requests.read");
  assert.equal(response.execution.orchestrator_v2.capability_rollout_status, "enabled");
  assert.equal(response.persistence_saved, true);
  assert.doesNotMatch(response.answer, /couldn't reach Oyi|could not reach Oyi/i);
});

await check("wallet history keeps rows and deduplicates resident-facing sources", async () => {
  const response = await run("Show wallet history.");
  assert.equal(response.execution.orchestrator_v2.capability_key, "wallet.transactions.read");
  assert.equal(response.persistence_saved, true);
  assert.match(response.answer, /3 wallet transactions?/i);
  const structured = JSON.stringify(response.cards || []);
  assert.match(structured, /Wallet funding/i);
  assert.doesNotMatch(`${response.answer} ${structured}`, /funding_25x7jo92c5|funding_9az7jo92c5|tx-1|tx-2|tx-3/i);
  assert.equal((response.sources || []).length, 1);
  assert.equal(response.sources[0].label, "Wallet transactions");
  assert.notEqual(response.sources[0].label, "Source");
  assert.equal(response.sources[0].evidence_count, 3);
});

await check("utility spending still uses spending capability", async () => {
  const response = await run("How much did I spend on utilities?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "utilities.spending.read");
  assert.equal(response.persistence_saved, true);
  assert.doesNotMatch(response.answer, /active utility services|couldn't reach Oyi/i);
});

await check("device availability keeps offline evidence path", async () => {
  const response = await run("Which devices are offline?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "devices.availability.read");
  assert.equal(response.persistence_saved, true);
  assert.doesNotMatch(response.answer, /couldn't reach Oyi/i);
});

console.log("oyi capability phase-b final smoke passed");
process.exit(0);
