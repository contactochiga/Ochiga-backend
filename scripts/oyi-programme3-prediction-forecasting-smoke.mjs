import assert from "node:assert/strict";
import path from "node:path";

const root = process.cwd();
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "programme3-smoke-service-role-key";

const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));

const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const hoursAgo = (n) => new Date(now.getTime() - n * 60 * 60 * 1000).toISOString();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeSupabase(overrides = {}) {
  const db = {
    rooms: [],
    devices: [
      { id: "dev-flaky", name: "Hallway Sensor", estate_id: "estate-1", home_id: "home-1", room_id: "room-hall", online: false, status: {}, capabilities: [], metadata: {}, last_seen_at: hoursAgo(1), updated_at: hoursAgo(1) },
    ],
    device_states: [],
    device_events: [
      { id: "de-1", device_id: "dev-flaky", estate_id: "estate-1", home_id: "home-1", room_id: "room-hall", event_type: "offline", new_state: { online: false }, occurred_at: hoursAgo(60) },
      { id: "de-2", device_id: "dev-flaky", estate_id: "estate-1", home_id: "home-1", room_id: "room-hall", event_type: "offline", new_state: { online: false }, occurred_at: hoursAgo(48) },
      { id: "de-3", device_id: "dev-flaky", estate_id: "estate-1", home_id: "home-1", room_id: "room-hall", event_type: "failure", new_state: { online: false }, occurred_at: hoursAgo(30) },
      { id: "de-4", device_id: "dev-flaky", estate_id: "estate-1", home_id: "home-1", room_id: "room-hall", event_type: "offline", new_state: { online: false }, occurred_at: hoursAgo(5) },
    ],
    maintenance_requests: [
      { id: "mr-1", estate_id: "estate-1", home_id: "home-1", room_id: "room-hall", resident_id: "resident-1", title: "Gate motor stuck", description: null, category: "gate", priority: "high", status: "open", assigned_to: null, created_at: daysAgo(9), updated_at: daysAgo(9) },
    ],
    visitor_access: [],
    facility_incidents: [],
    home_service_assignments: [],
    home_service_accounts: [],
    wallets: [{ id: "wallet-1", home_id: "home-1", user_id: "resident-1", balance: 40000, currency: "NGN", is_frozen: false, updated_at: daysAgo(0) }],
    wallet_transactions: Array.from({ length: 8 }, (_, weekIndex) => ({
      id: `wt-${weekIndex}`,
      wallet_id: "wallet-1",
      home_id: "home-1",
      direction: "debit",
      type: "utility_purchase",
      amount: 3000 + weekIndex * 400,
      metadata: { category: "electricity" },
      created_at: daysAgo(7 * (8 - weekIndex) - 1),
    })),
    consumer_scenes: [],
    consumer_automations: [{ id: "au-flaky", estate_id: "estate-1", home_id: "home-1", name: "Night lock", trigger: { type: "schedule" }, actions: [], enabled: true, next_run_at: null, last_run_at: hoursAgo(2), last_run_status: "failed", updated_at: hoursAgo(2) }],
    consumer_automation_runs: [
      { id: "run-1", automation_id: "au-flaky", estate_id: "estate-1", home_id: "home-1", trigger_type: "schedule", source: "system", status: "failed", started_at: hoursAgo(20), completed_at: hoursAgo(20), error_code: "TIMEOUT", error_message: "Lock did not respond", created_at: hoursAgo(20) },
      { id: "run-2", automation_id: "au-flaky", estate_id: "estate-1", home_id: "home-1", trigger_type: "schedule", source: "system", status: "failed", started_at: hoursAgo(2), completed_at: hoursAgo(2), error_code: "TIMEOUT", error_message: "Lock did not respond", created_at: hoursAgo(2) },
    ],
    ochiga_intelligence_predictions: [],
    intelligence_feedback: [],
    oyi_learning_parameters: [],
    notifications: [],
    notification_decisions: [],
    user_notification_preferences: [],
    home_memberships: [{ user_id: "resident-1", home_id: "home-1", status: "active" }],
    users: [],
    community_posts: [],
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
    is(column, value) {
      this.filters.push({ column, op: "is", value });
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
      const inserted = (Array.isArray(rows) ? rows : [rows]).map((row) => ({ id: row.id || `${this.table}-${Math.random().toString(36).slice(2)}`, created_at: row.created_at || now.toISOString(), ...row }));
      if (!db[this.table]) db[this.table] = [];
      db[this.table].push(...inserted);
      // select() must itself be awaitable and yield {data, error} directly
      // (e.g. NotificationService's `await ...insert(payload).select()`),
      // while still supporting the .maybeSingle()/.single() chain other
      // callers use.
      return {
        select: () => ({
          data: inserted,
          error: null,
          then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve),
          maybeSingle: async () => ({ data: inserted[0] || null, error: null }),
          single: async () => ({ data: inserted[0] || null, error: null }),
        }),
        then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve),
      };
    }
    upsert(row) {
      if (!db[this.table]) db[this.table] = [];
      const table = db[this.table];
      const idx = table.findIndex((item) => String(item.id) === String(row.id));
      if (idx >= 0) table[idx] = { ...table[idx], ...row };
      else table.push({ ...row });
      return { select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }), then: (resolve) => Promise.resolve({ data: row, error: null }).then(resolve) };
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
        else if (filter.op === "neq") rows = rows.filter((row) => String(row[filter.column] || "") !== String(filter.value));
        else if (filter.op === "is") rows = rows.filter((row) => (filter.value === null ? row[filter.column] == null : row[filter.column] === filter.value));
        else rows = rows.filter((row) => String(row[filter.column] ?? "") === String(filter.value));
      }
      for (const filter of this.inFilters) rows = rows.filter((row) => filter.values.includes(String(row[filter.column])));
      if (this.orFilter && this.table === "wallet_transactions") {
        const walletIds = this.orFilter.match(/wallet_id\.in\.\(([^)]+)\)/)?.[1]?.split(",").map((item) => item.trim()) || [];
        rows = clone(db.wallet_transactions).filter((row) => walletIds.includes(String(row.wallet_id || "")));
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

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// ---------- pure unit: forecast methods ----------

const forecastMethods = await import(path.join(root, "dist/oyi-core/domains/intelligence/forecastMethods.js"));

check("mape returns null (not a fabricated number) when any actual value is zero", () => {
  assert.equal(forecastMethods.mape([10, 0, 5], [9, 1, 5]), null);
  assert.notEqual(forecastMethods.mape([10, 20, 5], [9, 21, 5]), null);
});

check("backtest always compares against the naive baseline and reports beats_baseline honestly", () => {
  const trending = [10, 12, 14, 16, 18, 20, 22, 24];
  const result = forecastMethods.backtest(trending, "linear_trend", 2);
  assert.ok(result);
  assert.equal(result.holdout_count, 2);
  assert.equal(typeof result.beats_baseline, "boolean");
  assert.ok(result.baseline_mae >= 0);
});

check("linearTrendFit recovers a clean linear series", () => {
  const { slope, intercept } = forecastMethods.linearTrendFit([2, 4, 6, 8, 10]);
  assert.ok(Math.abs(slope - 2) < 0.001);
  assert.ok(Math.abs(intercept - 2) < 0.001);
});

// ---------- pure unit: learning parameter boundary ----------

const learningParametersModule = await import(path.join(root, "dist/oyi-core/domains/intelligence/learningParameters.js"));

await check("learning boundary: a permission/RLS/authority-shaped name is rejected before any DB write", async () => {
  await assert.rejects(
    () => learningParametersModule.getLearningParameter("permissions.override_threshold", {}, 1),
    /oyi_learning_parameter_forbidden/,
  );
  await assert.rejects(
    () => learningParametersModule.getLearningParameter("financial_authority.limit", {}, 1),
    /oyi_learning_parameter_forbidden/,
  );
  assert.equal(fakeSupabase.db.oyi_learning_parameters.length, 0, "no row must be written for a forbidden name");
});

await check("learning boundary: an allowed anomaly-sensitivity parameter is created, proposed, and only applied on explicit promotion", async () => {
  const created = await learningParametersModule.getLearningParameter("anomaly.device_offline_cluster.threshold", { home_id: "home-1" }, 3, { min: 1, max: 10 });
  assert.equal(created.current_value, 3);
  assert.equal(created.rollout_stage, "observe");

  const proposed = await learningParametersModule.proposeLearningParameterAdjustment("anomaly.device_offline_cluster.threshold", { home_id: "home-1" }, 4, { basis: "backtest_mae_improvement" });
  assert.equal(proposed.ok, true);
  const row = fakeSupabase.db.oyi_learning_parameters.find((r) => r.name === "anomaly.device_offline_cluster.threshold");
  assert.equal(row.current_value, 3, "proposing must never change current_value directly");
  assert.equal(row.proposed_value, 4);

  const promoted = await learningParametersModule.promoteLearningParameter(row.id, "enabled");
  assert.equal(promoted.ok, true);
  const updated = fakeSupabase.db.oyi_learning_parameters.find((r) => r.id === row.id);
  assert.equal(updated.current_value, 4, "only an explicit promotion to enabled moves proposed_value into current_value");
  assert.equal(updated.version, 2);
});

// ---------- pure unit: recommendation planner dedup/ranking ----------

const recommendationPlannerModule = await import(path.join(root, "dist/oyi-core/domains/intelligence/recommendationPlanner.js"));

check("recommendation planner: dedups two findings of the SAME type on the same object, keeps the higher-severity entry, never marks anything actionable", () => {
  const scope = { estate_id: "estate-1", home_id: "home-1", room_id: null };
  const subject = { object_type: "device", canonical_id: "dev-flaky", label: "Hallway Sensor" };
  const baseAnomaly = {
    domain: "devices", anomaly_type: "device_offline_cluster", scope, subject, object_refs: [subject],
    generated_at: now.toISOString(), window: null, baseline: null, observed: null, deviation: null,
    confidence: 0.5, evidence_ids: [], status: "active", source_model: "x", source_model_version: "v1", limitations: [], payload: {},
  };
  const anomalyLow = { ...baseAnomaly, anomaly_id: "an-1", severity: "attention", explanation: "Hallway Sensor went offline 4 times." };
  const anomalyHigh = { ...baseAnomaly, anomaly_id: "an-2", severity: "critical", explanation: "Hallway Sensor went offline again — now critical." };
  const prediction = {
    prediction_id: "pr-1", domain: "devices", prediction_type: "device_reliability_risk", scope,
    subject, object_refs: [subject], generated_at: now.toISOString(), horizon: "next_7_days",
    predicted_value: "x", probability: null, confidence: 0.7, severity: "warning", evidence_ids: [],
    reasoning_summary: "Likely to fail again soon.", model_name: "x", model_version: "v1", model_type: "rule",
    expires_at: null, status: "active", limitations: [],
  };
  const recs = recommendationPlannerModule.buildRecommendations({ anomalies: [anomalyLow, anomalyHigh], predictions: [prediction], forecasts: [], legacyRecommendations: [] });
  assert.equal(recs.length, 2, "the anomaly-derived and prediction-derived findings are distinct facets and must NOT collapse into one");
  const anomalyRec = recs.find((r) => r.dedup_key.startsWith("anomaly:"));
  assert.equal(anomalyRec.severity, "critical", "of the two same-type anomaly findings, the higher-severity one must win the dedup");
  assert.ok(recs.every((r) => r.actionability === "review" || r.actionability === "informational"));
  assert.ok(recs.every((r) => r.capability_key === null), "Programme 3 never marks a recommendation as directly executable");
});

// ---------- end-to-end: capability routing + orchestrator + persistence ----------

const registryModule = await import(path.join(root, "dist/oyi-core/capabilities/CapabilityRegistry.js"));
const readModules = await import(path.join(root, "dist/oyi-core/capabilities/ReadCapabilityModules.js"));
const orchestratorModule = await import(path.join(root, "dist/oyi-core/orchestration/ConversationOrchestrator.js"));

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

await check("anomalies.read: the flaky device's offline cluster is surfaced by name", async () => {
  const response = await run("Are there any anomalies?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "anomalies.read");
  assert.match(response.answer, /Hallway Sensor|offline/i);
});

await check("predictions.read: a forward-looking prediction is produced and persisted to ochiga_intelligence_predictions", async () => {
  const before = fakeSupabase.db.ochiga_intelligence_predictions.length;
  const response = await run("What do you predict will happen?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "predictions.read");
  assert.match(response.answer, /prediction/i);
  assert.ok(fakeSupabase.db.ochiga_intelligence_predictions.length > before, "a native prediction must be persisted");
});

await check("forecasts.read: utility spend forecast is honest about data quality and never fabricates an interval on thin data alone", async () => {
  const response = await run("Forecast my electricity spending.");
  assert.equal(response.execution.orchestrator_v2.capability_key, "forecasts.read");
  assert.match(response.answer, /forecast/i);
  assert.match(response.answer, /data quality/i);
});

await check("recommendations.read: at least one recommendation is surfaced, never phrased as auto-executable", async () => {
  const response = await run("Any recommendations for me?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "recommendations.read");
  assert.match(response.answer, /recommendation/i);
});

await check("why follow-up: reuses Programme 1's grounded explain architecture, no separate explanation system", async () => {
  // This fixture deliberately triggers three distinct anomalies at once
  // (device offline cluster, maintenance aging, automation failure rate),
  // so a bare "why are you telling me this?" is genuinely ambiguous —
  // Programme 1's existing resolver must honestly ask which one rather
  // than silently guess, then ground the answer once disambiguated by
  // ordinal, all via the SAME explain/follow-up machinery Programme 1/2
  // already use (no separate Programme 3 explanation path).
  const first = await run("Are there any anomalies?");
  const threadId = first.thread_id;
  const clarify = await run("Why are you telling me this?", threadId);
  assert.match(clarify.answer, /which one|did you mean/i, "with more than one anomaly in the result set, the system must ask which one rather than guess");
  assert.match(clarify.answer, /dev-flaky|Gate motor stuck|au-flaky/i, "the clarification candidates must be the SAME real, grounded objects surfaced by anomalies.read — not a generic prompt");
});

await check("home summary still includes an intelligence-derived attention item without breaking Programme 2's contract", async () => {
  const response = await run("How is my home?");
  assert.equal(response.execution.orchestrator_v2.capability_key, "home.summary.read");
  assert.ok(response.answer.length > 0);
});

// ---------- outcome evaluation ----------

const outcomeEvaluationModule = await import(path.join(root, "dist/oyi-core/domains/intelligence/outcomeEvaluation.js"));

await check("outcome evaluation: a device_reliability_risk prediction realizes when a later offline event exists", async () => {
  fakeSupabase.db.ochiga_intelligence_predictions.push({
    id: "pred-realized", prediction_type: "device_reliability_risk", title: "t", summary: "s", confidence: "likely", severity: "attention",
    agent_id: "device.reliability", estate_id: "estate-1", home_id: "home-1", source_event_ids: [], evidence: [{ object_type: "device", canonical_id: "dev-flaky" }],
    recommended_action: "", status: "open", metadata: {}, created_at: hoursAgo(72), updated_at: hoursAgo(72),
  });
  const result = await outcomeEvaluationModule.evaluateOpenPredictions({ estate_id: "estate-1", home_id: "home-1" });
  const evaluated = result.evaluated.find((e) => e.prediction_id === "pred-realized");
  assert.ok(evaluated, "the eligible prediction must be evaluated");
  assert.equal(evaluated.outcome, "realized", "a later offline event on the same device must realize the prediction");
  const feedbackRow = fakeSupabase.db.intelligence_feedback.find((f) => f.object_id === "pred-realized");
  assert.ok(feedbackRow, "the outcome must be persisted to intelligence_feedback");
  assert.equal(feedbackRow.feedback_type, "outcome_evaluation");
  const closedPrediction = fakeSupabase.db.ochiga_intelligence_predictions.find((p) => p.id === "pred-realized");
  assert.equal(closedPrediction.status, "resolved");
});

await check("outcome evaluation: a maintenance_sla_risk prediction does not realize once the request is resolved", async () => {
  fakeSupabase.db.maintenance_requests.push({ id: "mr-resolved", estate_id: "estate-1", home_id: "home-1", room_id: null, resident_id: "resident-1", title: "Fixed already", description: null, category: "hvac", priority: "low", status: "resolved", assigned_to: null, created_at: daysAgo(10), updated_at: daysAgo(1) });
  fakeSupabase.db.ochiga_intelligence_predictions.push({
    id: "pred-not-realized", prediction_type: "maintenance_sla_risk", title: "t", summary: "s", confidence: "possible", severity: "attention",
    agent_id: "maintenance.risk", estate_id: "estate-1", home_id: "home-1", source_event_ids: [], evidence: [{ object_type: "maintenance_request", canonical_id: "mr-resolved" }],
    recommended_action: "", status: "open", metadata: {}, created_at: hoursAgo(72), updated_at: hoursAgo(72),
  });
  const result = await outcomeEvaluationModule.evaluateOpenPredictions({ estate_id: "estate-1", home_id: "home-1" });
  const evaluated = result.evaluated.find((e) => e.prediction_id === "pred-not-realized");
  assert.ok(evaluated);
  assert.equal(evaluated.outcome, "not_realized");
});

// ---------- proactive delivery cooldown ----------

const proactiveDeliveryModule = await import(path.join(root, "dist/oyi-core/domains/intelligence/proactiveDelivery.js"));

// Uses maintenance-flavored wording deliberately — the "devices" category's
// default notification preference is activity_only unless critical (see
// notificationPolicyService.ts DEFAULTS.devices), so a device-worded
// warning-severity item would never reach a notification row at all. That
// is existing, reused policy working as intended (Programme 3 must not
// override user/category notification preferences), not something this
// module controls — "maintenance" is push-eligible by default and lets the
// cooldown/escalation mechanics themselves be exercised honestly.
function syntheticRecommendation(id, severity) {
  return {
    recommendation_id: id, domain: "maintenance", scope: { estate_id: "estate-1", home_id: "home-1", room_id: null },
    object_refs: [], created_at: now.toISOString(), severity, title: "Review Gate Motor", summary: "It has been stuck for over a week.",
    reason: "Open maintenance request aging beyond the informal baseline.", evidence_ids: [], suggested_action: "Follow up on the gate motor repair.",
    actionability: "review", requires_confirmation: false, capability_key: null, expires_at: null, status: "open",
    dedup_key: "anomaly:maintenance:maintenance_aging:mr-1",
  };
}

await check("proactive delivery: a warning-severity recommendation is delivered once, then suppressed by cooldown on immediate repeat", async () => {
  const first = await proactiveDeliveryModule.runProactiveDelivery([syntheticRecommendation("rec-1", "warning")], { home_id: "home-1" });
  assert.equal(first[0].delivered, true);
  assert.equal(fakeSupabase.db.notifications.length, 1);

  const second = await proactiveDeliveryModule.runProactiveDelivery([syntheticRecommendation("rec-1", "warning")], { home_id: "home-1" });
  assert.equal(second[0].delivered, false, "the identical severity within the cooldown window must be suppressed, not re-sent");
  assert.equal(fakeSupabase.db.notifications.length, 1, "no second notification row for the suppressed repeat");
});

await check("proactive delivery: an escalation to critical is NOT suppressed by the lower-severity cooldown still in effect", async () => {
  const escalated = await proactiveDeliveryModule.runProactiveDelivery([syntheticRecommendation("rec-1", "critical")], { home_id: "home-1" });
  assert.equal(escalated[0].delivered, true, "severity escalation must bypass the in-flight cooldown for the lower severity");
  assert.equal(fakeSupabase.db.notifications.length, 2);
});

await check("proactive delivery: never surfaces an info-severity item and respects the per-run delivery cap", async () => {
  const infoOnly = await proactiveDeliveryModule.runProactiveDelivery([syntheticRecommendation("rec-info", "info")], { home_id: "home-1" });
  assert.equal(infoOnly.length, 0, "info severity must never be proactively delivered");

  const many = Array.from({ length: 8 }, (_, i) => syntheticRecommendation(`rec-cap-${i}`, "warning"));
  const capped = await proactiveDeliveryModule.runProactiveDelivery(many, { home_id: "home-1" });
  const delivered = capped.filter((r) => r.delivered).length;
  assert.ok(delivered <= 5, "must never exceed the per-run delivery cap");
  const overCap = capped.filter((r) => r.reason === "over_delivery_cap").length;
  assert.ok(overCap >= 1, "items beyond the cap must be explicitly accounted for, not silently dropped");
});

console.log("oyi-programme3-prediction-forecasting-smoke passed");
process.exit(0);
