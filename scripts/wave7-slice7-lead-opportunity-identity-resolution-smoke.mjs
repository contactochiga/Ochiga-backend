#!/usr/bin/env node
// Wave 7 Slice 7 -- Lead/Opportunity identity resolution. Proves the one
// narrow, no-migration convergence this slice adds on top of the
// UNMODIFIED Oyi Communications Convergence Slice 1 golden path (that
// smoke, re-run as regression, already proves the lead-scoped goal
// activation this slice must not break):
//
//   - CorporateMaterialEvent.crm.opportunity_id is a new, optional-in-
//     practice (required-nullable in the type) field. Absent -> every
//     existing behavior is byte-identical to pre-Slice-7 (Decision
//     targets office_lead, Goal dedups via findActiveForLead).
//   - Present -> the Decision targets office_opportunity (not office_lead),
//     the Goal's target_entities.opportunity_id is populated, and dedup
//     switches to GoalRuntime.findActiveForOpportunity -- so TWO
//     simultaneous, independent opportunities for the SAME lead (the
//     landowner-with-two-JV-sites scenario this slice's audit proved was
//     a real, code-verified collision before this change) each get their
//     own Decision and their own Goal, while a genuine retry of the SAME
//     opportunity still dedups to one.
//
// Same fake-in-memory-Supabase-table technique and real-loopback-HTTP
// Office-bridge stand-in as oyi-communications-convergence-slice1-smoke.mjs
// (not duplicated logic -- this file only adds the oyi_decisions table to
// the fake-table map, which that earlier smoke did not need).
import assert from "node:assert/strict";
import path from "node:path";
import http from "node:http";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "wave7-slice7-local-only";
process.env.OFFICE_SYNC_API_KEY ||= "test-only-shared-secret";

const root = process.cwd();
const { supabaseAdmin } = await import(path.join(root, "dist/supabase/supabaseClient.js"));
const { submitOfficeMaterialEventCanonicalSignal } = await import(path.join(root, "dist/oyi-core/ingress/officeMaterialEventAdapter.js"));
const { decisionKey } = await import(path.join(root, "dist/services/decisionStore/DecisionStore.js"));
const { GoalRuntime } = await import(path.join(root, "dist/services/goalRuntime/GoalRuntime.js"));

let nextBridgeResponse = { status: 200, body: { ok: true, delivered: true, external_message_id: "wamid.test" } };
const bridgeServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    res.writeHead(nextBridgeResponse.status, { "content-type": "application/json" });
    res.end(JSON.stringify(nextBridgeResponse.body));
  });
});
await new Promise((resolve) => bridgeServer.listen(0, "127.0.0.1", resolve));
const bridgePort = bridgeServer.address().port;
process.env.OFFICE_APP_URL = `http://127.0.0.1:${bridgePort}`;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  }
}

// ---------------------------------------------------------------------
// Generic fake table -- same technique as oyi-communications-convergence-
// slice1-smoke.mjs, extended with oyi_decisions (unique on decision_key,
// same 23505-style conflict shape DecisionStore.createDecision expects).
// ---------------------------------------------------------------------
const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

function containsMatch(rowValue, needleJson) {
  let needle;
  try { needle = JSON.parse(needleJson); } catch { return false; }
  if (needle && typeof needle === "object") {
    const hay = rowValue && typeof rowValue === "object" ? rowValue : {};
    return Object.entries(needle).every(([key, value]) => hay[key] === value);
  }
  return rowValue === needle;
}

function matches(row, filters) {
  return filters.every(([col, op, val]) => {
    if (op === "eq") return row[col] === val;
    if (op === "in") return Array.isArray(val) && val.includes(row[col]);
    if (op === "contains") return containsMatch(row[col], val);
    return true;
  });
}

function makeTable(store) {
  return {
    select() {
      const filters = [];
      const builder = {
        eq(col, val) { filters.push([col, "eq", val]); return builder; },
        in(col, val) { filters.push([col, "in", val]); return builder; },
        contains(col, val) { filters.push([col, "contains", val]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() {
          const rows = store.filter((row) => matches(row, filters));
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        then(resolve, reject) {
          const rows = store.filter((row) => matches(row, filters));
          Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    insert(rowOrRows) {
      const rows = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).map((r) => ({ ...r }));
      // Decision-store-shaped conflict simulation: a duplicate
      // decision_key must surface the same 23505 shape createDecision()
      // catches and treats as "already exists, re-select".
      if (rows[0]?.decision_key && store.some((r) => r.decision_key === rows[0].decision_key)) {
        return { select: () => ({ single: () => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } }) }) };
      }
      store.push(...rows);
      return {
        select() {
          return {
            single: () => Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: "no row" } }),
            maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
          };
        },
      };
    },
    update(patch) {
      const filters = [];
      const builder = {
        eq(col, val) { filters.push([col, "eq", val]); return builder; },
        is() { return builder; },
        select() {
          return {
            single: () => {
              const idx = store.findIndex((row) => matches(row, filters));
              if (idx === -1) return Promise.resolve({ data: null, error: { message: "no match" } });
              store[idx] = { ...store[idx], ...patch };
              return Promise.resolve({ data: store[idx], error: null });
            },
            maybeSingle: () => {
              const idx = store.findIndex((row) => matches(row, filters));
              if (idx === -1) return Promise.resolve({ data: null, error: null });
              store[idx] = { ...store[idx], ...patch };
              return Promise.resolve({ data: store[idx], error: null });
            },
          };
        },
      };
      return builder;
    },
  };
}

let goals, optOuts, communications, decisions;
function resetStores() {
  goals = [];
  optOuts = [];
  communications = [];
  decisions = [];
}
resetStores();

function fakeFrom() {
  const tables = { oyi_goals: goals, oyi_communication_opt_outs: optOuts, oyi_communications: communications, oyi_decisions: decisions };
  return (table) => (tables[table] ? makeTable(tables[table]) : originalFrom(table));
}

function materialEvent(overrides = {}) {
  return {
    event_id: "office:lead-tare:development_enquiry_received:idem-1",
    event_type: "development_enquiry_received",
    idempotency_key: "idem-1",
    occurred_at: new Date().toISOString(),
    source_system: "ochiga-office",
    request_id: "req-1",
    subject: { type: "lead", id: "lead-tare", label: "Abdullah / TARE" },
    business_unit: "development",
    inquiry_type: "land_jv",
    source: { channel: "website", site: "ochiga_website", page: "/development", form: "enquiry" },
    crm: { lead_id: "lead-tare", opportunity_id: null, status: "new", stage: "intake_received", owner: "marketing_agent" },
    conversation: null,
    communication_context: {
      primary_channel: "whatsapp",
      email: null,
      phone: "+2348100000001",
      whatsapp_phone: "+2348100000001",
      contactability: "allowed",
    },
    metadata: {
      development: {
        opportunity_type: "land_jv",
        location: "Epe, Lagos", // outside DEFAULT_JV_STRATEGY's target areas -> ACKNOWLEDGE_ONLY, a real single-step goal
        land_size: "3 acres",
        commercial_terms: "60/40 proposed",
      },
    },
    ...overrides,
  };
}

console.log("\n=== Backward compatibility: no opportunity_id -> byte-identical to pre-Slice-7 behavior ===");

await check("event with opportunity_id: null creates a Goal with target_entities.opportunity_id: null, and a Decision entity_type=office_lead", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  try {
    await submitOfficeMaterialEventCanonicalSignal(materialEvent());
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 1);
    assert.equal(goals[0].target_entities.opportunity_id, null);
    assert.equal(goals[0].target_entities.lead_id, "lead-tare");
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].entity_type, "office_lead");
    assert.equal(decisions[0].entity_id, "lead-tare");
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

await check("a second, lead-scoped (no opportunity_id) enquiry for the same lead with an active goal is still skipped (findActiveForLead dedup unchanged)", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  try {
    await submitOfficeMaterialEventCanonicalSignal(materialEvent());
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 1);
    await submitOfficeMaterialEventCanonicalSignal(materialEvent({ event_id: "office:lead-tare:development_enquiry_received:idem-2", idempotency_key: "idem-2" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 1, "unchanged lead-scoped dedup must still block a second enquiry for the same lead");
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

console.log("\n=== Mandatory same-person/different-deal proof (Slice 7 Section 26) ===");

await check("same lead, TWO independent opportunities (two JV sites for one landowner) -> TWO separate goals, not one shared goal", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  try {
    await submitOfficeMaterialEventCanonicalSignal(materialEvent({
      event_id: "office:lead-tare:development_enquiry_received:site-a",
      idempotency_key: "site-a",
      crm: { lead_id: "lead-tare", opportunity_id: "opp-site-a", status: "new", stage: "intake_received", owner: "marketing_agent" },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 1, "site A's enquiry must create its own goal");

    await submitOfficeMaterialEventCanonicalSignal(materialEvent({
      event_id: "office:lead-tare:development_enquiry_received:site-b",
      idempotency_key: "site-b",
      crm: { lead_id: "lead-tare", opportunity_id: "opp-site-b", status: "new", stage: "intake_received", owner: "marketing_agent" },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 2, "site B's independent opportunity must NOT be silently skipped because site A's goal for the same lead is still active -- this is the exact collision the audit proved exists without opportunity-scoped dedup");

    const oppIds = goals.map((g) => g.target_entities.opportunity_id).sort();
    assert.deepEqual(oppIds, ["opp-site-a", "opp-site-b"], "each goal must be scoped to its own opportunity, never merged");
    assert.ok(goals.every((g) => g.target_entities.lead_id === "lead-tare"), "both goals still correctly reference the shared lead identity");

    assert.equal(decisions.length, 2, "each opportunity must get its own Decision, not a shared one");
    const decisionEntities = decisions.map((d) => `${d.entity_type}:${d.entity_id}`).sort();
    assert.deepEqual(decisionEntities, ["office_opportunity:opp-site-a", "office_opportunity:opp-site-b"], "Decisions must target the specific pursuit, not the shared lead, when an opportunity id is known");
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

await check("a genuine retry of the SAME opportunity (replayed material event) still dedups to exactly one goal", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  try {
    const event = materialEvent({
      event_id: "office:lead-tare:development_enquiry_received:site-a",
      idempotency_key: "site-a",
      crm: { lead_id: "lead-tare", opportunity_id: "opp-site-a", status: "new", stage: "intake_received", owner: "marketing_agent" },
    });
    await submitOfficeMaterialEventCanonicalSignal(event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 1);
    await submitOfficeMaterialEventCanonicalSignal(event); // exact replay
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 1, "a replay of the same opportunity's event must not create a second goal");
    assert.equal(decisions.length, 1, "createDecision's own idempotent-create (23505 catch) must also prevent a duplicate Decision row for the identical decision_key");
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

await check("linked_crm_records carries opportunity_id alongside lead_id when known", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  try {
    await submitOfficeMaterialEventCanonicalSignal(materialEvent({
      crm: { lead_id: "lead-tare", opportunity_id: "opp-site-a", status: "new", stage: "intake_received", owner: "marketing_agent" },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 1);
    assert.deepEqual(goals[0].linked_crm_records, { lead_id: "lead-tare", opportunity_id: "opp-site-a" });
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

console.log("\n=== decision_key: office_opportunity and office_lead never collide for the same underlying id string ===");

await check("decisionKey({entityType:'office_opportunity', entityId:'x', ...}) != decisionKey({entityType:'office_lead', entityId:'x', ...})", () => {
  const a = decisionKey({ entityType: "office_opportunity", entityId: "x", actionType: "ACKNOWLEDGE_ONLY", canonicalSignalKey: "sig-1" });
  const b = decisionKey({ entityType: "office_lead", entityId: "x", actionType: "ACKNOWLEDGE_ONLY", canonicalSignalKey: "sig-1" });
  assert.notEqual(a, b);
});

console.log("\n=== GoalRuntime.findActiveForOpportunity: real dedup query shape ===");

await check("findActiveForOpportunity returns only non-terminal goals matching the given opportunity_id", async () => {
  resetStores();
  goals.push(
    { id: "g1", status: "active", target_entities: { opportunity_id: "opp-1" } },
    { id: "g2", status: "completed", target_entities: { opportunity_id: "opp-1" } },
    { id: "g3", status: "active", target_entities: { opportunity_id: "opp-2" } }
  );
  supabaseAdmin.from = fakeFrom();
  try {
    const runtime = new GoalRuntime();
    const found = await runtime.findActiveForOpportunity("opp-1");
    assert.equal(found.length, 1);
    assert.equal(found[0].id, "g1");
    const empty = await runtime.findActiveForOpportunity("");
    assert.deepEqual(empty, []);
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

console.log("");
console.log(`=== wave7-slice7-lead-opportunity-identity-resolution-smoke: ${passed} passed, ${failed} failed ===`);
bridgeServer.close();
if (failed > 0) process.exit(1);
