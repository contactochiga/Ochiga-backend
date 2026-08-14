import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

// Programme 4 Phase I — behavioral verification of the automated
// learning-proposal pass: minimum sample threshold, bounds enforcement,
// versioned/evidence-basis proposals, and (via structural check) that
// promotion is never automatic. Uses a minimal fake Supabase tailored to
// exactly the three tables this pass touches.

const root = process.cwd();
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "programme4-learning-smoke-service-role-key";
process.env.OYI_LEARNING_MIN_SAMPLE_THRESHOLD = "5";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeSupabase() {
  const db = {
    ochiga_intelligence_predictions: [],
    intelligence_feedback: [],
    oyi_learning_parameters: [],
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.inFilter = null;
      this.limitCount = null;
      this.updatePatch = null;
    }
    select() {
      return this;
    }
    eq(column, value) {
      this.filters.push({ column, value });
      return this;
    }
    is(column, value) {
      this.filters.push({ column, value, isNull: true, expected: value });
      return this;
    }
    in(column, values) {
      this.inFilter = { column, values: values.map(String) };
      return this;
    }
    order() {
      return this;
    }
    limit(value) {
      this.limitCount = Number(value) || null;
      return this;
    }
    update(patch) {
      this.updatePatch = patch;
      return this;
    }
    insert(row) {
      const inserted = { id: row.id || `${this.table}-${Math.random().toString(36).slice(2)}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
      db[this.table].push(inserted);
      return { select: () => ({ maybeSingle: async () => ({ data: clone(inserted), error: null }) }) };
    }
    async _rows() {
      let rows = clone(db[this.table] || []);
      for (const filter of this.filters) {
        if (filter.isNull) rows = rows.filter((row) => row[filter.column] === null || row[filter.column] === undefined);
        else rows = rows.filter((row) => String(row[filter.column]) === String(filter.value));
      }
      if (this.inFilter) rows = rows.filter((row) => this.inFilter.values.includes(String(row[this.inFilter.column])));
      if (this.limitCount) rows = rows.slice(0, this.limitCount);
      return rows;
    }
    then(resolve, reject) {
      (async () => {
        if (this.updatePatch) {
          const rows = await this._rows();
          for (const row of rows) {
            const idx = db[this.table].findIndex((item) => item.id === row.id);
            if (idx >= 0) db[this.table][idx] = { ...db[this.table][idx], ...this.updatePatch };
          }
          return { data: rows, error: null };
        }
        const rows = await this._rows();
        return { data: rows, error: null };
      })().then(resolve, reject);
    }
    async maybeSingle() {
      const rows = await this._rows();
      return { data: rows[0] || null, error: null };
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

const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));
let fakeSupabase = createFakeSupabase();
supabaseModule.supabaseAdmin.from = (table) => fakeSupabase.from(table);

const { runLearningProposalPass } = await import(path.join(root, "dist/oyi-core/domains/intelligence/learningProposalPass.js"));

function seedEvaluatedPredictions(predictionType, realizedCount, notRealizedCount) {
  const rows = [];
  for (let i = 0; i < realizedCount + notRealizedCount; i++) {
    const id = `${predictionType}-pred-${i}`;
    fakeSupabase.db.ochiga_intelligence_predictions.push({ id, prediction_type: predictionType, created_at: new Date().toISOString() });
    fakeSupabase.db.intelligence_feedback.push({
      object_id: id,
      object_type: "oyi_prediction",
      feedback_type: "outcome_evaluation",
      outcome_metadata: { outcome: i < realizedCount ? "realized" : "not_realized", prediction_type: predictionType },
    });
    rows.push(id);
  }
  return rows;
}

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

async function acheck(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

// --- Below the minimum sample threshold (5, set via env above): must not propose ---
fakeSupabase = createFakeSupabase();
supabaseModule.supabaseAdmin.from = (table) => fakeSupabase.from(table);
seedEvaluatedPredictions("device_reliability_risk", 2, 1); // total 3 < threshold 5

await acheck("below the minimum sample threshold, the pass reports insufficient_evidence and writes no proposal", async () => {
  const result = await runLearningProposalPass();
  const entry = result.outcomes.find((o) => o.prediction_type === "device_reliability_risk");
  assert.equal(entry.status, "insufficient_evidence");
  assert.equal(entry.sample_size, 3);
  assert.equal(fakeSupabase.db.oyi_learning_parameters.length, 0);
});

// --- At/above threshold: must propose, with bounds, evidence basis, and no auto-promotion ---
fakeSupabase = createFakeSupabase();
supabaseModule.supabaseAdmin.from = (table) => fakeSupabase.from(table);
seedEvaluatedPredictions("maintenance_sla_risk", 8, 2); // total 10 >= threshold 5, accuracy 0.8

await acheck("at/above threshold, the pass proposes a bounded, evidence-backed calibration without touching current_value", async () => {
  const result = await runLearningProposalPass();
  const entry = result.outcomes.find((o) => o.prediction_type === "maintenance_sla_risk");
  assert.equal(entry.status, "proposed");
  assert.equal(entry.parameter_name, "prediction.maintenance_sla_risk.confidence_calibration");
  assert.equal(entry.sample_size, 10);
  assert.equal(entry.accuracy, 0.8);
  assert.equal(entry.evidence_basis.realized, 8);
  assert.equal(entry.evidence_basis.not_realized, 2);
  assert.equal(entry.evidence_basis.method, "empirical_accuracy_calibration");

  const row = fakeSupabase.db.oyi_learning_parameters.find((p) => p.name === "prediction.maintenance_sla_risk.confidence_calibration");
  assert.ok(row, "expected a learning parameter row to be created");
  assert.equal(row.proposed_value, 0.8);
  assert.equal(row.min_bound, 0);
  assert.equal(row.max_bound, 1);
  assert.equal(row.rollout_stage, "observe", "must never auto-advance rollout_stage");
  assert.notEqual(row.current_value, 0.8, "current_value must never be set by an automated proposal");
});

// --- Running the pass twice must not duplicate the parameter row (idempotent by name+scope) ---
await acheck("re-running the pass for the same type updates the same row, not a duplicate", async () => {
  await runLearningProposalPass();
  const rows = fakeSupabase.db.oyi_learning_parameters.filter((p) => p.name === "prediction.maintenance_sla_risk.confidence_calibration");
  assert.equal(rows.length, 1);
});

// --- Structural: never auto-promotes, only proposes for real evaluators ---
const passSource = await readFile(new URL("../src/oyi-core/domains/intelligence/learningProposalPass.ts", import.meta.url), "utf8");
const passCode = passSource.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");

check("learning proposal pass never imports or calls promoteLearningParameter", () => {
  assert.doesNotMatch(passCode, /promoteLearningParameter/);
});

check("learning proposal pass only targets prediction types with a real evaluator", () => {
  assert.match(passSource, /device_reliability_risk.*maintenance_sla_risk.*automation_failure_risk/s);
});

if (process.exitCode === 1) {
  console.error("oyi-programme4-learning-proposal-smoke: FAILED");
  process.exit(1);
}
console.log("oyi-programme4-learning-proposal-smoke: PASS");
