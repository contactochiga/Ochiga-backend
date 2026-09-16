#!/usr/bin/env node
// Oyi Communications Convergence, Slice 2 -- Backend-side coverage for
// making Core's HANDOFF decision executable.
//
// Real behavioral coverage against the actual compiled code:
//   - officeHandoffBridge.ts::requestOfficeHandoff(): a real HTTP round
//     trip (local loopback mock standing in for Office's bridge route,
//     no real network call, same established technique as Slice 1's
//     WhatsAppAdapter coverage) proving it correctly parses a real
//     accepted response, an Office-side rejection, and a non-2xx/
//     network failure -- never fabricates success.
//   - officeMaterialEventAdapter.ts::activateDevelopmentRelationshipGoal's
//     HANDOFF branch: a real submitOfficeMaterialEventCanonicalSignal()
//     call for a HANDOFF-policy assessment proves it calls the bridge
//     with the real lead_id/business_unit/requested_capability/reason,
//     and -- critically -- creates ZERO Goal rows (a human, not
//     automation, owns this conversation from here).
//
// This deliberately does NOT live-import dist/server.js (the known
// ioredis-retry-forever sandbox hang) -- see Slice 1's smoke script.
import assert from "node:assert/strict";
import path from "node:path";
import http from "node:http";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "communications-convergence-slice2-local-only";
process.env.OFFICE_SYNC_API_KEY ||= "test-only-shared-secret";

const root = process.cwd();
const { supabaseAdmin } = await import(path.join(root, "dist/supabase/supabaseClient.js"));
const { assessJvOpportunity, DEFAULT_JV_STRATEGY } = await import(path.join(root, "dist/oyi-core/domains/development/developmentJv.js"));
const { submitOfficeMaterialEventCanonicalSignal } = await import(path.join(root, "dist/oyi-core/ingress/officeMaterialEventAdapter.js"));
const { requestOfficeHandoff } = await import(path.join(root, "dist/oyi-core/ingress/officeHandoffBridge.js"));

// Real local HTTP server standing in for Office's bridge -- path-aware
// (unlike Slice 1's single-response mock, this one distinguishes the
// handoff-request route so the request BODY can be captured and
// asserted on, and so other bridge paths this test doesn't touch keep
// getting a harmless default rather than accidentally matching).
let nextHandoffResponse = { status: 200, body: { ok: true, handoff: { handoff_id: "handoff-test-1", status: "requested" }, created: true, routing_status: "unavailable" } };
let lastHandoffRequestBody = null;
const bridgeServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    if (req.url === "/api/lead-agents/admin/communications/handoff-request") {
      try { lastHandoffRequestBody = raw ? JSON.parse(raw) : null; } catch { lastHandoffRequestBody = null; }
      res.writeHead(nextHandoffResponse.status, { "content-type": "application/json" });
      res.end(JSON.stringify(nextHandoffResponse.body));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, delivered: true, external_message_id: "wamid.unrelated" }));
  });
});
await new Promise((resolve) => bridgeServer.listen(0, "127.0.0.1", resolve));
const bridgePort = bridgeServer.address().port;
process.env.OFFICE_APP_URL = `http://127.0.0.1:${bridgePort}`;

const failures = [];
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
// Fake in-memory oyi_goals table (same makeTable technique as Slice 1)
// -- only used to prove HANDOFF creates zero Goal rows.
// ---------------------------------------------------------------------
const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
function matches(row, filters) {
  return filters.every(([col, op, val]) => {
    if (op === "eq") return row[col] === val;
    if (op === "in") return Array.isArray(val) && val.includes(row[col]);
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
        contains() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle: () => Promise.resolve({ data: store.filter((row) => matches(row, filters))[0] || null, error: null }),
        then(resolve, reject) { Promise.resolve({ data: store.filter((row) => matches(row, filters)), error: null }).then(resolve, reject); },
      };
      return builder;
    },
    insert(rowOrRows) {
      const rows = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).map((r) => ({ ...r }));
      store.push(...rows);
      return { select: () => ({ single: () => Promise.resolve({ data: rows[0] || null, error: null }), maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }) }) };
    },
  };
}
let goals;
function resetStores() { goals = []; }
resetStores();
function fakeFrom() {
  const tables = { oyi_goals: goals, oyi_communication_opt_outs: [], oyi_communications: [] };
  return (table) => (tables[table] ? makeTable(tables[table]) : originalFrom(table));
}

function materialEvent(overrides = {}) {
  return {
    event_id: "office:lead-handoff-1:development_enquiry_received:idem-1",
    event_type: "development_enquiry_received",
    idempotency_key: "idem-handoff-1",
    occurred_at: new Date().toISOString(),
    source_system: "ochiga-office",
    request_id: "req-handoff-1",
    subject: { type: "lead", id: "lead-handoff-1", label: "Chidi Landowner" },
    business_unit: "development",
    inquiry_type: "land_jv",
    source: { channel: "website", site: "ochiga_website", page: "/development", form: "enquiry" },
    crm: { lead_id: "lead-handoff-1", status: "new", stage: "intake_received", owner: "marketing_agent" },
    conversation: null,
    communication_context: {
      primary_channel: "whatsapp",
      email: null,
      phone: "+2348100000099",
      whatsapp_phone: "+2348100000099",
      contactability: "allowed",
    },
    metadata: {
      // Aligned location + enough evidence for route_for_human_review
      // (see assessJvOpportunity: aligned but not enough to auto-progress).
      development: {
        opportunity_type: "land_jv",
        location: "Ikoyi, Lagos",
        land_size: "2 acres",
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// 1. requestOfficeHandoff() delivery-truth: a real accepted response.
// ---------------------------------------------------------------------
await check("requestOfficeHandoff: a real Office-accepted response is parsed honestly", async () => {
  nextHandoffResponse = { status: 200, body: { ok: true, handoff: { handoff_id: "handoff-abc", status: "offered" }, created: true, routing_status: "matched" } };
  const result = await requestOfficeHandoff({ lead_id: "lead-x", business_unit: "development", requested_capability: "development.commercial_jv", reason: "test" });
  assert.equal(result.ok, true);
  assert.equal(result.handoff_id, "handoff-abc");
  assert.equal(result.status, "offered");
  assert.equal(result.created, true);
  assert.equal(result.routing_status, "matched");
});

// ---------------------------------------------------------------------
// 2. requestOfficeHandoff(): Office-side rejection is reported honestly,
// never silently treated as success.
// ---------------------------------------------------------------------
await check("requestOfficeHandoff: an Office rejection (ok:false) is never reported as success", async () => {
  nextHandoffResponse = { status: 200, body: { ok: false, error: "lead_not_found" } };
  const result = await requestOfficeHandoff({ lead_id: "missing-lead", business_unit: "development", requested_capability: "development.commercial_jv", reason: "test" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "lead_not_found");
});

// ---------------------------------------------------------------------
// 3. requestOfficeHandoff(): a non-2xx transport failure is reported
// honestly, not fabricated as success.
// ---------------------------------------------------------------------
await check("requestOfficeHandoff: a non-2xx bridge response is never reported as success", async () => {
  nextHandoffResponse = { status: 503, body: { error: "unavailable" } };
  const result = await requestOfficeHandoff({ lead_id: "lead-x", business_unit: "development", requested_capability: "development.commercial_jv", reason: "test" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "office_http_503");
});

// ---------------------------------------------------------------------
// 4. Golden journey: HANDOFF policy calls the real bridge with the real
// lead/business_unit/capability/reason, and creates ZERO Goal rows.
// ---------------------------------------------------------------------
await check("golden journey: HANDOFF policy requests a real Office handoff and creates zero autonomous goals", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  nextHandoffResponse = { status: 200, body: { ok: true, handoff: { handoff_id: "handoff-golden-1", status: "requested" }, created: true, routing_status: "unavailable" } };
  lastHandoffRequestBody = null;
  try {
    const assessment = assessJvOpportunity({ opportunityType: "land_jv", location: "Ikoyi, Lagos", landSize: "2 acres" }, DEFAULT_JV_STRATEGY);
    assert.equal(assessment.recommended_next_step, "route_for_human_review", "fixture must actually exercise the HANDOFF policy branch");

    await submitOfficeMaterialEventCanonicalSignal(materialEvent());
    await new Promise((resolve) => setTimeout(resolve, 30)); // let the fire-and-forget handoff request settle

    assert.ok(lastHandoffRequestBody, "the bridge must actually receive a handoff-request call");
    assert.equal(lastHandoffRequestBody.lead_id, "lead-handoff-1");
    assert.equal(lastHandoffRequestBody.business_unit, "development");
    assert.equal(lastHandoffRequestBody.requested_capability, "development.commercial_jv");
    assert.ok(lastHandoffRequestBody.reason && lastHandoffRequestBody.reason.length > 5, "reason must be a real, non-empty string");

    assert.equal(goals.length, 0, "HANDOFF must never create an autonomous outbound goal -- a human owns this conversation");
  } finally {
    supabaseAdmin.from = originalFrom;
  }
});

// ---------------------------------------------------------------------
// 5. HANDOFF must never crash the material-event ingestion path even
// when Office's bridge is unreachable -- same "never throws, never
// blocks the CRM event this was triggered by" contract as
// activateDevelopmentRelationshipGoal's other branches.
// ---------------------------------------------------------------------
await check("failure test: HANDOFF branch never throws when Office's bridge is unavailable", async () => {
  resetStores();
  supabaseAdmin.from = fakeFrom();
  const savedUrl = process.env.OFFICE_APP_URL;
  process.env.OFFICE_APP_URL = "http://127.0.0.1:1"; // reserved, connection refused
  try {
    const assessment = assessJvOpportunity({ opportunityType: "land_jv", location: "Ikoyi, Lagos", landSize: "2 acres" }, DEFAULT_JV_STRATEGY);
    assert.equal(assessment.recommended_next_step, "route_for_human_review");
    await submitOfficeMaterialEventCanonicalSignal(materialEvent({ event_id: "office:lead-handoff-2:development_enquiry_received:idem-2", idempotency_key: "idem-handoff-2", subject: { type: "lead", id: "lead-handoff-2", label: "Unreachable Bridge Test" }, crm: { lead_id: "lead-handoff-2", status: "new", stage: "intake_received", owner: "marketing_agent" } }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(goals.length, 0, "an unreachable Office bridge must still never fall back to creating an autonomous goal");
  } finally {
    process.env.OFFICE_APP_URL = savedUrl;
    supabaseAdmin.from = originalFrom;
  }
});

bridgeServer.close();

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("oyi-communications-convergence-slice2-smoke passed");
