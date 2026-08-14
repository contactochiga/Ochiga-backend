import assert from "node:assert/strict";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "deep-conversation-smoke-service-role-key";

const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));

const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeSupabase() {
  const db = {
    wallets: [{ id: "wallet-1", home_id: "home-1", user_id: "resident-1", balance: 15000, currency: "NGN", is_frozen: false, updated_at: daysAgo(0) }],
    wallet_transactions: [
      { id: "tx-old", wallet_id: "wallet-1", home_id: "home-1", user_id: "resident-1", direction: "debit", type: "electricity", amount: 4200, reference: "ref-old", status: "confirmed", metadata: { service_category: "electricity" }, created_at: daysAgo(10), updated_at: daysAgo(10) },
      { id: "tx-new", wallet_id: "wallet-1", home_id: "home-1", user_id: "resident-1", direction: "debit", type: "electricity", amount: 6100, reference: "ref-new", status: "confirmed", metadata: { service_category: "electricity" }, created_at: daysAgo(1), updated_at: daysAgo(1) },
    ],
    maintenance_requests: [
      { id: "mr-old", estate_id: "estate-1", home_id: "home-1", resident_id: "resident-1", title: "Leaking kitchen tap", description: null, category: "plumbing", priority: "medium", status: "open", assigned_to: null, created_at: daysAgo(20), updated_at: daysAgo(20) },
      { id: "mr-new", estate_id: "estate-1", home_id: "home-1", resident_id: "resident-1", title: "AC not cooling", description: null, category: "hvac", priority: "high", status: "open", assigned_to: "Tech Dele", created_at: daysAgo(2), updated_at: daysAgo(2) },
    ],
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
    delete() {
      this.isDelete = true;
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
      if (this.orderColumn) rows.sort((a, b) => String(b[this.orderColumn] || "").localeCompare(String(a[this.orderColumn] || "")));
      if (this.limitCount) rows = rows.slice(0, this.limitCount);
      if (this.countMode) return { data: null, count: rows.length, error: null };
      if (this.isDelete) {
        const ids = new Set(rows.map((row) => String(row.id)));
        db[this.table] = (db[this.table] || []).filter((row) => !ids.has(String(row.id)));
        return { data: rows, error: null };
      }
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
const orchestratorModule = await import(path.join(root, "dist/oyi-core/orchestration/ConversationOrchestrator.js"));
const followUpModule = await import(path.join(root, "dist/oyi-core/interpretation/followUpResolver.js"));
const resultSetModule = await import(path.join(root, "dist/oyi-core/context/resultSetContext.js"));
const explainModule = await import(path.join(root, "dist/oyi-core/domains/explainAnswer.js"));
const hydrationModule = await import(path.join(root, "dist/oyi-core/runtime/canonicalTargetHydrationRegistry.js"));

for (const capability of readModules.buildPhaseBReadCapabilities()) registryModule.capabilityRegistry.register(capability);

const resident = { id: "resident-1", role: "resident", estate_id: "estate-1", home_id: "home-1", permissions: ["maintenance.read", "wallets.read"] };
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

// ---------- pure unit coverage: intent parsing + resolution ----------

check("ordinal parsing covers first/second/last/latest/oldest", () => {
  assert.equal(followUpModule.parseFollowUpIntent("Which one is oldest?").ordinal, "oldest");
  assert.equal(followUpModule.parseFollowUpIntent("Who was the latest?").ordinal, "latest");
  assert.equal(followUpModule.parseFollowUpIntent("the first one").ordinal, "first");
  assert.equal(followUpModule.parseFollowUpIntent("the second one").ordinal, "second");
  assert.equal(followUpModule.parseFollowUpIntent("the last one").ordinal, "last");
  assert.equal(followUpModule.parseFollowUpIntent("What was the latest one?").ordinal, "latest");
});

check("pronoun/detail/why/status/field parsing", () => {
  assert.equal(followUpModule.parseFollowUpIntent("Tell me more about that one.").type, "detail");
  assert.equal(followUpModule.parseFollowUpIntent("Why is it still open?").type, "why");
  assert.equal(followUpModule.parseFollowUpIntent("Is it resolved?").type, "status_check");
  assert.equal(followUpModule.parseFollowUpIntent("Did that person arrive?").type, "status_check");
  assert.equal(followUpModule.parseFollowUpIntent("Where did it happen?").field, "where");
  assert.equal(followUpModule.parseFollowUpIntent("How much was it?").field, "amount");
  assert.equal(followUpModule.parseFollowUpIntent("that one").type, "pronoun");
});

check("temporal follow-up and comparison parsing", () => {
  assert.equal(followUpModule.parseFollowUpIntent("What about last week?").type, "temporal_followup");
  assert.equal(followUpModule.parseFollowUpIntent("What about this month?").type, "temporal_followup");
  assert.equal(followUpModule.parseFollowUpIntent("Which was higher?").type, "comparison");
  assert.equal(followUpModule.parseFollowUpIntent("Random unrelated sentence with no cue.") , null);
});

function fact(overrides) {
  return {
    fact_id: "f1", domain: "maintenance", fact_type: "maintenance_request", scope: {},
    object: { object_type: "maintenance_request", canonical_id: "m1", label: "Leaking tap" },
    statement: "", value: {}, previous_value: null, occurred_at: daysAgo(5), observed_at: daysAgo(5),
    source_type: "database", source_id: "m1", truth_state: "confirmed", confidence: 0.9,
    freshness: daysAgo(5), privacy_class: "resident_home_private", permissions: [], evidence: [],
    ...overrides,
  };
}

check("buildResultSetContext excludes unavailable facts and orders object_refs deterministically", () => {
  const facts = [
    fact({ fact_id: "a", object: { object_type: "maintenance_request", canonical_id: "a", label: "A" }, occurred_at: daysAgo(1) }),
    fact({ fact_id: "b", object: { object_type: "maintenance_request", canonical_id: "b", label: "B" }, occurred_at: daysAgo(9) }),
    fact({ fact_id: "unavailable", truth_state: "unavailable", value: { reason: "query_failed" } }),
  ];
  const resultSet = resultSetModule.buildResultSetContext({
    domain: "maintenance", capabilityKey: "maintenance.requests.read", operation: "list", facts,
    contract: { conversation_request_id: "req-1", thread_id: "thread-1", temporal_scope: { mode: "current", from: null, to: null } },
    message: "What maintenance issues are open?",
  });
  assert.equal(resultSet.object_refs.length, 2, "unavailable sentinel fact must not appear as a candidate object");
  assert.equal(resultSet.object_refs[0].canonical_id, "a");
  assert.equal(resultSet.object_refs[1].canonical_id, "b");
});

check("ordinal resolution: oldest/latest sort by occurred_at, first/last use presented order", () => {
  const resultSet = {
    object_refs: [
      { object_type: "maintenance_request", canonical_id: "recent", label: "Recent", occurred_at: daysAgo(1), metric: null, metric_value: null, status: "open" },
      { object_type: "maintenance_request", canonical_id: "old", label: "Old", occurred_at: daysAgo(20), metric: null, metric_value: null, status: "open" },
    ],
    selected_object_ref: null,
  };
  assert.equal(followUpModule.resolveFollowUpReference(resultSet, { type: "ordinal", ordinal: "oldest" }).ref.canonical_id, "old");
  assert.equal(followUpModule.resolveFollowUpReference(resultSet, { type: "ordinal", ordinal: "latest" }).ref.canonical_id, "recent");
  assert.equal(followUpModule.resolveFollowUpReference(resultSet, { type: "ordinal", ordinal: "first" }).ref.canonical_id, "recent");
  assert.equal(followUpModule.resolveFollowUpReference(resultSet, { type: "ordinal", ordinal: "last" }).ref.canonical_id, "old");
});

check("attribute resolution: failed/unresolved/expensive, and ambiguous when multiple match", () => {
  const resultSet = {
    object_refs: [
      { object_type: "automation_run", canonical_id: "r1", label: "Run 1", occurred_at: daysAgo(1), metric: null, metric_value: null, status: "failed" },
      { object_type: "automation_run", canonical_id: "r2", label: "Run 2", occurred_at: daysAgo(2), metric: null, metric_value: null, status: "failed" },
      { object_type: "automation_run", canonical_id: "r3", label: "Run 3", occurred_at: daysAgo(3), metric: null, metric_value: null, status: "success" },
    ],
    selected_object_ref: null,
  };
  const resolution = followUpModule.resolveFollowUpReference(resultSet, { type: "attribute", attribute: "failed" });
  assert.equal(resolution.status, "ambiguous");
  assert.equal(resolution.candidates.length, 2);

  const priced = {
    object_refs: [
      { object_type: "utility_purchase", canonical_id: "p1", label: "P1", occurred_at: daysAgo(1), metric: "amount", metric_value: 2000, status: null },
      { object_type: "utility_purchase", canonical_id: "p2", label: "P2", occurred_at: daysAgo(2), metric: "amount", metric_value: 9000, status: null },
    ],
    selected_object_ref: null,
  };
  assert.equal(followUpModule.resolveFollowUpReference(priced, { type: "attribute", attribute: "expensive" }).ref.canonical_id, "p2");
});

check("pronoun resolution prefers selected_object_ref, then single-item sets, else ambiguous", () => {
  const withSelected = { object_refs: [{ canonical_id: "x" }, { canonical_id: "y" }], selected_object_ref: { canonical_id: "x" } };
  assert.equal(followUpModule.resolveFollowUpReference(withSelected, { type: "pronoun" }).ref.canonical_id, "x");
  const singleItem = { object_refs: [{ canonical_id: "solo" }], selected_object_ref: null };
  assert.equal(followUpModule.resolveFollowUpReference(singleItem, { type: "pronoun" }).ref.canonical_id, "solo");
  const multi = { object_refs: [{ canonical_id: "a" }, { canonical_id: "b" }], selected_object_ref: null };
  assert.equal(followUpModule.resolveFollowUpReference(multi, { type: "pronoun" }).status, "ambiguous");
  assert.equal(followUpModule.resolveFollowUpReference(null, { type: "pronoun" }).status, "unresolved");
});

check("explain grounding follows the required hierarchy and never invents a reason", () => {
  const withReason = fact({ value: { status: "failed", error_message: "device offline" } });
  assert.match(explainModule.buildExplainAnswer(withReason), /device offline/);
  const openNoReason = fact({ value: { status: "open", opened_at: daysAgo(12) } });
  assert.match(explainModule.buildExplainAnswer(openNoReason), /remained open since/);
  const noStatus = fact({ value: {} });
  assert.match(explainModule.buildExplainAnswer(noStatus), /do not have a recorded reason/);
  assert.equal(explainModule.buildExplainAnswer(null), "I could not confirm which item you mean, so I cannot explain it safely.");
});

check("status/field answers are grounded, never fabricated", () => {
  assert.match(explainModule.buildStatusCheckAnswer(fact({ value: { status: "resolved" } })), /resolved/);
  assert.match(explainModule.buildStatusCheckAnswer(fact({ value: {} })), /no recorded status/);
  assert.match(explainModule.buildFieldAnswer(fact({ value: { location: "Block C" } }), "where"), /Block C/);
  assert.match(explainModule.buildFieldAnswer(fact({ value: {} }), "where"), /do not have a recorded location/);
  assert.match(explainModule.buildFieldAnswer(fact({ value: { amount: 6100, currency: "NGN" } }), "amount"), /6,100/);
});

check("hydration returns unsupported (not a query error) for stale/invalid object references", async () => {
  const result = await hydrationModule.hydrateCanonicalTarget({
    target: { objectType: "maintenance_request", objectId: "does-not-exist", ambiguous: false },
    actor: null,
    oisContext: { estate_id: "estate-1", home_id: "home-1" },
    activeContext: null,
    visibleState: null,
  });
  assert.ok(["not_found", "unsupported", "query_failed"].includes(result.status), `unexpected status ${result.status}`);
  assert.notEqual(result.status, "hydrated");
});

// ---------- end-to-end: maintenance deep conversation thread ----------

await check("maintenance thread: list -> oldest -> detail -> why, fully resolved through the real orchestrator", async () => {
  const listResponse = await run("What maintenance issues are open?");
  assert.match(listResponse.answer, /2 maintenance requests/i);
  const threadId = listResponse.thread_id;
  assert.ok(threadId, "list turn must persist a thread");

  const threadRow = fakeSupabase.db.oyi_conversation_threads.find((row) => row.id === threadId);
  assert.ok(threadRow, "thread row must exist after the list turn");
  assert.equal(threadRow.metadata.last_result_set.domain, "maintenance");
  assert.equal(threadRow.metadata.last_result_set.object_refs.length, 2);

  const oldestResponse = await run("Which one is oldest?", threadId);
  assert.match(oldestResponse.answer, /Leaking kitchen tap/i);
  assert.equal(oldestResponse.execution.orchestrator_v2.followup.reference_type, "ordinal");
  assert.equal(oldestResponse.execution.orchestrator_v2.followup.resolution_status, "resolved");

  const narrowedThreadRow = fakeSupabase.db.oyi_conversation_threads.find((row) => row.id === threadId);
  assert.equal(narrowedThreadRow.metadata.last_result_set.object_refs.length, 1);
  assert.equal(narrowedThreadRow.metadata.last_result_set.selected_object_ref.canonical_id, "mr-old");

  const detailResponse = await run("Tell me more about that one.", threadId);
  assert.match(detailResponse.answer, /open/i);
  assert.equal(detailResponse.execution.orchestrator_v2.followup.reference_type, "detail");

  const whyResponse = await run("Why is it still open?", threadId);
  assert.match(whyResponse.answer, /remained open since|recorded as open/i);
  assert.equal(whyResponse.execution.orchestrator_v2.followup.reference_type, "why");
});

// ---------- end-to-end: wallet thread with "how much" field follow-up ----------

await check("wallet thread: recent transactions -> latest -> how much", async () => {
  const listResponse = await run("Show recent transactions.");
  const threadId = listResponse.thread_id;
  assert.ok(threadId);

  const latestResponse = await run("What was the latest one?", threadId);
  assert.equal(latestResponse.execution.orchestrator_v2.followup.reference_type, "ordinal");
  assert.equal(latestResponse.execution.orchestrator_v2.followup.resolved_object_ref, "tx-new");

  const amountResponse = await run("How much was it?", threadId);
  assert.match(amountResponse.answer, /6,100/);
});

// ---------- ambiguity: no silent guess ----------

await check("ambiguous attribute follow-up asks for clarification instead of guessing", async () => {
  const listResponse = await run("What maintenance issues are open?");
  const threadId = listResponse.thread_id;
  const ambiguousResponse = await run("the open one", threadId);
  assert.equal(ambiguousResponse.execution.orchestrator_v2.followup.resolution_status, "ambiguous");
  assert.match(ambiguousResponse.answer, /more than one match/i);
});

// ---------- cross-home isolation: a foreign/unknown thread has nothing to resolve against ----------

await check("a follow-up against an unknown thread id resolves nothing and falls through safely", async () => {
  const resultSet = await resultSetModule.loadThreadResultSetContext("00000000-0000-4000-8000-000000000000");
  assert.equal(resultSet, null);
});

console.log("oyi-programme1-deep-conversation-smoke passed");
process.exit(0);
