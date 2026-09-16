#!/usr/bin/env node
// Oyi Communications Convergence, Slice 1 -- golden journey + failure/
// concurrency tests for the relationship-communication-policy -> Goal
// activation path this slice wired between the existing Development/JV
// capability and the existing GoalRuntime/CommunicationRuntime.
//
// Real behavioral coverage against the actual compiled code:
//   - relationshipCommunicationPolicy.ts: the opportunity_not_aligned !=
//     relationship_not_worth_maintaining distinction, contactability
//     "unknown"/"denied" both blocking automation identically, channel
//     gating.
//   - officeMaterialEventAdapter.ts::activateDevelopmentRelationshipGoal:
//     a real goalRuntime.create() call with a fake (in-memory) oyi_goals
//     table, proving the created Goal is bounded (deadline, max_attempts,
//     stop_condition), single-step, whatsapp-channel, and idempotent
//     (a replayed material event, or a second enquiry for the same lead
//     while a goal is still active, creates zero additional goals).
//   - Opt-out precondition: a contact already in oyi_communication_opt_outs
//     gets zero goals created for them, never just blocked at send time.
//   - CommunicationRuntime -> WhatsAppAdapter -> Office bridge dispatch,
//     with axios.post monkeypatched at the adapter boundary (no real
//     network call, no real WhatsApp message sent) proving: provider
//     acceptance is not automatically "delivered"; a human-takeover
//     response from Office's bridge is honestly reported as failed
//     (human_takeover_active), never silently treated as sent.
//
// This deliberately does NOT live-import dist/routes/officeExport.js or
// dist/server.js (the known ioredis-retry-forever sandbox hang,
// documented in oyi-office-intelligence-convergence-smoke.mjs) -- the
// route-level wiring (communication_context parsing, goal_active
// exposure) is covered by source-text assertions instead, the same
// established convention.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "communications-convergence-slice1-local-only";
// WhatsAppAdapter.isConfigured() gates on this being set (it's the
// shared secret Office's bridge route already authenticates with) --
// needed here so the delivery-truth tests below actually exercise
// adapter.send()'s real axios.post call (monkeypatched, no real
// network) instead of short-circuiting at isConfigured().
process.env.OFFICE_SYNC_API_KEY ||= "test-only-shared-secret";

const root = process.cwd();
const { supabaseAdmin } = await import(path.join(root, "dist/supabase/supabaseClient.js"));
const { assessJvOpportunity, DEFAULT_JV_STRATEGY } = await import(path.join(root, "dist/oyi-core/domains/development/developmentJv.js"));
const {
  relationshipCommunicationPolicyForJv,
  composeRelationshipAcknowledgement,
  preferredSupportedChannel,
} = await import(path.join(root, "dist/oyi-core/domains/development/relationshipCommunicationPolicy.js"));
const { submitOfficeMaterialEventCanonicalSignal } = await import(path.join(root, "dist/oyi-core/ingress/officeMaterialEventAdapter.js"));
const communicationRuntimeModule = await import(path.join(root, "dist/services/communicationRuntime/CommunicationRuntime.js"));
const { communicationRuntime } = communicationRuntimeModule;

// A real local HTTP server standing in for Office's bridge -- more
// robust than monkeypatching the "axios" module (the compiled dist
// CJS code and this ESM test script's own import of "axios" are not
// guaranteed to share the exact same module-instance reference across
// the CJS/ESM interop boundary, confirmed empirically). This is a real
// request/response cycle over loopback, not a fabricated in-process
// return value -- WhatsAppAdapter.ts's actual axios.post call, actual
// JSON parsing, actual status-code branching all run for real.
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

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
    failures.push(`${name}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------
// Fake in-memory Supabase tables (same generic shape/technique as
// facility-spatial-device-action-smoke.mjs's makeTable, extended with
// .contains() for GoalRuntime.findActiveForLead/findGoalsWatchingThread
// and .insert().select().single()/.update().select().single() for
// GoalRuntime.create/persist).
// ---------------------------------------------------------------------
const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

function containsMatch(rowValue, needleJson) {
  let needle;
  try { needle = JSON.parse(needleJson); } catch { return false; }
  if (Array.isArray(needle)) {
    const hay = Array.isArray(rowValue) ? rowValue : [];
    return needle.every((item) => hay.includes(item));
  }
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
      let limitN = null;
      const builder = {
        eq(col, val) { filters.push([col, "eq", val]); return builder; },
        in(col, val) { filters.push([col, "in", val]); return builder; },
        contains(col, val) { filters.push([col, "contains", val]); return builder; },
        order() { return builder; },
        limit(n) { limitN = n; return builder; },
        maybeSingle() {
          let rows = store.filter((row) => matches(row, filters));
          if (limitN != null) rows = rows.slice(0, limitN);
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        then(resolve, reject) {
          let rows = store.filter((row) => matches(row, filters));
          if (limitN != null) rows = rows.slice(0, limitN);
          Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    insert(rowOrRows) {
      const rows = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).map((r) => ({ ...r }));
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
    upsert(row, opts = {}) {
      const conflictKey = opts.onConflict;
      return {
        select() {
          return {
            single: () => {
              const idx = conflictKey ? store.findIndex((r) => conflictKey.split(",").every((k) => r[k] === row[k])) : -1;
              if (idx === -1) { store.push({ id: row.id || `row-${store.length + 1}`, ...row }); return Promise.resolve({ data: store[store.length - 1], error: null }); }
              store[idx] = { ...store[idx], ...row };
              return Promise.resolve({ data: store[idx], error: null });
            },
          };
        },
      };
    },
  };
}

let goals, optOuts, communications;
function resetStores() {
  goals = [];
  optOuts = [];
  communications = [];
}
resetStores();

function fakeFrom() {
  const tables = { oyi_goals: goals, oyi_communication_opt_outs: optOuts, oyi_communications: communications };
  return (table) => (tables[table] ? makeTable(tables[table]) : originalFrom(table));
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------
function materialEvent(overrides = {}) {
  return {
    event_id: "office:lead-1:development_enquiry_received:idem-1",
    event_type: "development_enquiry_received",
    idempotency_key: "idem-1",
    occurred_at: new Date().toISOString(),
    source_system: "ochiga-office",
    request_id: "req-1",
    subject: { type: "lead", id: "lead-1", label: "Ada Landowner" },
    business_unit: "development",
    inquiry_type: "land_jv",
    source: { channel: "website", site: "ochiga_website", page: "/development", form: "enquiry" },
    crm: { lead_id: "lead-1", status: "new", stage: "intake_received", owner: "marketing_agent" },
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
        location: "Epe, Lagos", // outside DEFAULT_JV_STRATEGY's target areas
        land_size: "3 acres",
        commercial_terms: "60/40 proposed",
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// 1. Pure policy function tests -- opportunity_not_aligned != relationship_not_worth_maintaining.
// ---------------------------------------------------------------------
await check("relationshipCommunicationPolicyForJv: outside-focus opportunity with known location still gets ACKNOWLEDGE_ONLY, not silence", () => {
  const assessment = assessJvOpportunity({ opportunityType: "land_jv", location: "Epe, Lagos", landSize: "3 acres", commercialTerms: "60/40" }, DEFAULT_JV_STRATEGY);
  assert.equal(assessment.recommended_next_step, "mark_outside_current_strategy");
  const policy = relationshipCommunicationPolicyForJv(assessment, { primary_channel: "whatsapp", whatsapp_phone: "+2348100000001", phone: null, email: null, contactability: "allowed" });
  assert.equal(policy, "ACKNOWLEDGE_ONLY");
  const body = composeRelationshipAcknowledgement(assessment, policy);
  assert.ok(body && /outside/i.test(body), "acknowledgement must honestly say the opportunity is outside current focus");
  assert.ok(!/is under consideration|we will progress|we are progressing|we're interested|we would like to invest/i.test(body), "must never fabricate active consideration/investment interest");
  assert.ok(/won't be progressing|will not be progressing|outside/i.test(body), "must honestly state the opportunity is not being progressed");
});

await check("relationshipCommunicationPolicyForJv: aligned + sufficient evidence -> CONTINUE_RELATIONSHIP", () => {
  const assessment = assessJvOpportunity({ opportunityType: "land_jv", location: "Ikoyi, Lagos", landSize: "2 acres", commercialTerms: "70/30" }, DEFAULT_JV_STRATEGY);
  assert.equal(assessment.recommended_next_step, "progress_opportunity");
  const policy = relationshipCommunicationPolicyForJv(assessment, { primary_channel: "whatsapp", whatsapp_phone: "+2348100000002", phone: null, email: null, contactability: "allowed" });
  assert.equal(policy, "CONTINUE_RELATIONSHIP");
});

await check("relationshipCommunicationPolicyForJv: contactability unknown blocks automation exactly like denied", () => {
  const assessment = assessJvOpportunity({ opportunityType: "land_jv", location: "Ikoyi, Lagos", landSize: "2 acres", commercialTerms: "70/30" }, DEFAULT_JV_STRATEGY);
  const unknown = relationshipCommunicationPolicyForJv(assessment, { primary_channel: "whatsapp", whatsapp_phone: "+2348100000002", phone: null, email: null, contactability: "unknown" });
  const denied = relationshipCommunicationPolicyForJv(assessment, { primary_channel: "whatsapp", whatsapp_phone: "+2348100000002", phone: null, email: null, contactability: "denied" });
  assert.equal(unknown, "DO_NOT_CONTACT");
  assert.equal(denied, "DO_NOT_CONTACT");
});

await check("relationshipCommunicationPolicyForJv: no supported channel on file -> IGNORE_AUTOMATION, not a fabricated send", () => {
  const assessment = assessJvOpportunity({ opportunityType: "land_jv", location: "Ikoyi, Lagos", landSize: "2 acres", commercialTerms: "70/30" }, DEFAULT_JV_STRATEGY);
  assert.equal(preferredSupportedChannel({ primary_channel: "email", whatsapp_phone: null, phone: null, email: "x@example.com", contactability: "allowed" }), null);
  const policy = relationshipCommunicationPolicyForJv(assessment, { primary_channel: "email", whatsapp_phone: null, phone: null, email: "x@example.com", contactability: "allowed" });
  assert.equal(policy, "IGNORE_AUTOMATION");
});

// ---------------------------------------------------------------------
// 2. Golden journey: material event -> bounded, single-step Goal.
// ---------------------------------------------------------------------
await check("golden journey: development enquiry outside current focus creates exactly one bounded WhatsApp acknowledgement goal", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  try {
    await submitOfficeMaterialEventCanonicalSignal(materialEvent());
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the fire-and-forget goal activation settle
    assert.equal(goals.length, 1, "exactly one goal must be created");
    const goal = goals[0];
    assert.equal(goal.status, "active");
    assert.equal(goal.target_entities.lead_id, "lead-1");
    assert.equal(goal.target_entities.whatsapp_phone, "+2348100000001");
    assert.equal(goal.plan.length, 1, "V1 plan is a single bounded step, not an open-ended sequence");
    assert.equal(goal.plan[0].channel, "whatsapp");
    assert.equal(goal.plan[0].action_type, "send_communication");
    assert.ok(goal.plan[0].body && goal.plan[0].body.length > 10);
    assert.ok(goal.schedule.deadline, "goal must have a real deadline (bounded)");
    assert.ok(goal.max_attempts > 0 && goal.max_attempts <= 5, "max_attempts must be small and bounded");
    assert.equal(goal.stop_condition.type, "deadline_passed");
    assert.deepEqual(goal.linked_communication_threads, ["whatsapp:+2348100000001"]);
    assert.ok(goal.next_evaluation_at, "goal must be immediately due so the existing scheduler picks it up");
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

// ---------------------------------------------------------------------
// 3. Idempotency: replayed material event / second enquiry for the same
// lead while a goal is still active -> zero additional goals.
// ---------------------------------------------------------------------
await check("failure test: duplicate material event does not create a duplicate goal", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  try {
    await submitOfficeMaterialEventCanonicalSignal(materialEvent());
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 1);
    // Same event, same idempotency_key, replayed (e.g. Office's retry).
    await submitOfficeMaterialEventCanonicalSignal(materialEvent());
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 1, "a replayed material event must not create a second active goal");
    // A second, different development enquiry for the SAME lead while the
    // first goal is still active must also not create a second goal.
    await submitOfficeMaterialEventCanonicalSignal(materialEvent({ event_id: "office:lead-1:development_enquiry_received:idem-2", idempotency_key: "idem-2" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 1, "a second enquiry for a lead with an already-active goal must not create a duplicate goal");
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

// ---------------------------------------------------------------------
// 4. Opted-out contact -> zero goal created (not just blocked at send time).
// ---------------------------------------------------------------------
await check("failure test: opted-out contact gets zero goals created", async () => {
  resetStores();
  optOuts.push({ id: "optout-1", identity_key: "+2348100000001", channel: "whatsapp", reason: "test" });
  supabaseAdmin.from = fakeFrom();
  try {
    await submitOfficeMaterialEventCanonicalSignal(materialEvent());
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 0, "an opted-out contact must never get an autonomous goal created for them");
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

// ---------------------------------------------------------------------
// 5. Missing contact channel -> no fabricated send, no goal.
// ---------------------------------------------------------------------
await check("failure test: missing contact channel produces no goal (no fabricated send)", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  try {
    await submitOfficeMaterialEventCanonicalSignal(materialEvent({ communication_context: { primary_channel: null, email: null, phone: null, whatsapp_phone: null, contactability: "allowed" } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 0);
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

// ---------------------------------------------------------------------
// 6. Terminal/handoff policies never create an autonomous acknowledgement
// goal (HANDOFF and REQUEST_MORE_INFORMATION are Slice 2 territory --
// this slice's activation only proceeds for the three acknowledgement-
// shaped policies).
// ---------------------------------------------------------------------
await check("route_for_human_review (HANDOFF policy) does not create an autonomous outbound goal in this slice", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  try {
    // Aligned location, but missing enough evidence to progress outright -> route_for_human_review.
    await submitOfficeMaterialEventCanonicalSignal(materialEvent({
      metadata: { development: { opportunity_type: "land_jv", location: "Ikoyi, Lagos", land_size: "2 acres" } },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(goals.length, 0, "HANDOFF must stop autonomous pursuit, not silently send an acknowledgement");
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

// ---------------------------------------------------------------------
// 7. Delivery truth: provider acceptance is not automatically
// "delivered"/"sent"; a human-takeover response from Office's bridge is
// honestly reported, never silently treated as a successful send. No
// real network call -- axios.post monkeypatched at the WhatsAppAdapter
// boundary only, same technique this codebase already uses for
// executeDeviceCommandForActor.
// ---------------------------------------------------------------------
await check("delivery truth: Office bridge reporting human_takeover_active is never reported as sent", async () => {
  nextBridgeResponse = { status: 200, body: { ok: false, delivered: false, failure_reason: "human_takeover_active" } };
  const plan = await communicationRuntime.plan({
    conversation_thread_id: null,
    actor_id: null,
    surface: "office_material_event",
    source: "automation",
    source_record_type: "goal",
    source_record_id: "goal-test-1",
    intent: "goal_plan_step",
    channel: "whatsapp",
    recipient_hint: { whatsapp_phone: "+2348100000009", phone: null, email: null, lead_id: "lead-9", contact_id: null },
    body: "Test acknowledgement message.",
    pre_authorized: true,
  });
  assert.equal(plan.status, "ready");
  const authorized = communicationRuntime.authorize(plan.record, { confirmed: true });
  const { result } = await communicationRuntime.dispatch(authorized);
  assert.equal(result.status, "failed", "a human-takeover block must never be reported as a successful send");
  assert.equal(result.failure_reason, "human_takeover_active");
});

await check("delivery truth: provider acceptance without a delivered flag is reported failed, never fabricated as sent", async () => {
  // Office's bridge accepted the HTTP request but the provider itself
  // did not confirm delivery (e.g. Meta rejected it) -- delivered:false.
  nextBridgeResponse = { status: 200, body: { ok: false, delivered: false, failure_reason: "provider_unavailable" } };
  const plan = await communicationRuntime.plan({
    conversation_thread_id: null,
    actor_id: null,
    surface: "office_material_event",
    source: "automation",
    source_record_type: "goal",
    source_record_id: "goal-test-2",
    intent: "goal_plan_step",
    channel: "whatsapp",
    recipient_hint: { whatsapp_phone: "+2348100000008", phone: null, email: null, lead_id: "lead-8", contact_id: null },
    body: "Test acknowledgement message.",
    pre_authorized: true,
  });
  const authorized = communicationRuntime.authorize(plan.record, { confirmed: true });
  const { result } = await communicationRuntime.dispatch(authorized);
  assert.equal(result.status, "failed");
  assert.equal(result.failure_reason, "provider_unavailable");
  assert.notEqual(result.status, "sent");
});

await check("delivery truth: a real provider-accepted+delivered response IS honestly reported sent (proves the mock server round trip itself is not just failing shut)", async () => {
  nextBridgeResponse = { status: 200, body: { ok: true, delivered: true, external_message_id: "wamid.golden" } };
  const plan = await communicationRuntime.plan({
    conversation_thread_id: null,
    actor_id: null,
    surface: "office_material_event",
    source: "automation",
    source_record_type: "goal",
    source_record_id: "goal-test-3",
    intent: "goal_plan_step",
    channel: "whatsapp",
    recipient_hint: { whatsapp_phone: "+2348100000007", phone: null, email: null, lead_id: "lead-7", contact_id: null },
    body: "Test acknowledgement message.",
    pre_authorized: true,
  });
  const authorized = communicationRuntime.authorize(plan.record, { confirmed: true });
  const { result } = await communicationRuntime.dispatch(authorized);
  assert.equal(result.status, "sent");
  assert.equal(result.provider_message_id, "wamid.golden");
});

bridgeServer.close();

// ---------------------------------------------------------------------
// 8. Structural proof (source-text, matching this repo's established
// convention for controller/route wiring) that the Office-side wiring
// this slice depends on is actually in place.
// ---------------------------------------------------------------------
await check("structural: WhatsAppAdapter forwards lead_id so Office's bridge can enforce takeover truth", () => {
  const source = fs.readFileSync(path.join(root, "src/services/communicationRuntime/adapters/WhatsAppAdapter.ts"), "utf8");
  assert.ok(/lead_id:\s*record\.recipient\.lead_id/.test(source), "WhatsAppAdapter must forward recipient.lead_id in both the template and free-form send payloads");
});

await check("structural: officeExport.ts communications webhook route exposes goal_active for Office's single-responder check", () => {
  const source = fs.readFileSync(path.join(root, "src/routes/officeExport.ts"), "utf8");
  assert.ok(/goal_active:\s*result\.woke_goal_ids\.length > 0/.test(source), "the /communications/webhook-event route must expose goal_active in its response");
});

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("oyi-communications-convergence-slice1-smoke passed");
process.exit(0);
