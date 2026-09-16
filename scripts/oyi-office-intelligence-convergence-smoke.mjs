#!/usr/bin/env node
// Oyi Intelligence Convergence -- Wave 3: Office Intelligence Convergence.
// Real behavioral coverage against the actual compiled code:
//   - developmentJv.ts's assessJvOpportunity(): known/missing/inferred
//     separation, strategy is configurable data (not hardcoded), and the
//     decision table's four recommended_next_step outcomes.
//   - officeMaterialEventAdapter.ts: exactly-one Core ingestion per
//     material event, an idempotent retry (same idempotency_key) causing
//     no second logical observation (via the REAL, unmocked durable
//     canonicalIntelligenceStore), JV assessment embedding for
//     development_enquiry_received only, tenant/business-unit scope
//     preservation, and an unavailable Core not throwing/corrupting.
//   - corporateOfficeInternalPolicy.ts: the governed JV proposal only
//     fires for route_for_human_review, using the existing whitelisted
//     office.request_handoff tool -- never a broader/different tool --
//     and safe_metadata.jv_assessment is threaded through honestly.
//   - Structural proof (source-text, not live import -- see note below)
//     that the material-event route is wired, its event-type allowlist
//     is closed, and neither the adapter nor the JV capability ever
//     import NotificationService or any outbound HTTP/messaging call --
//     Core cannot mutate Office or send an external reply, by
//     construction.
//
// NOTE on scope: this file deliberately never live-imports
// dist/routes/officeExport.js. That module transitively pulls in
// src/services/communicationRuntime/CommunicationRuntime.ts, which in
// this sandbox tries to connect to a real external Redis Labs host via
// ioredis and retries forever with no bounded attempt count -- a
// pre-existing environment characteristic unrelated to this wave's
// changes (confirmed by running scripts/office-export-auth-compat-smoke.mjs
// standalone: its own assertions print PASS immediately, then the
// process hangs on that unrelated Redis retry loop). The route's
// contract is instead verified via source-text assertions below, the
// same style scripts/office-internal-surface-smoke.mjs already uses for
// this exact file.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "office-intelligence-convergence-local-only";

const root = process.cwd();
const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));
const oyiCoreServiceModule = await import(path.join(root, "dist/oyi-core/service.js"));
const developmentJvModule = await import(path.join(root, "dist/oyi-core/domains/development/developmentJv.js"));
const { assessJvOpportunity, DEFAULT_JV_STRATEGY } = developmentJvModule;
const corporatePolicyModule = await import(path.join(root, "dist/oyi-core/policy/corporateOfficeInternalPolicy.js"));
const { buildOfficeInternalResponse } = corporatePolicyModule;

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    failures.push(`${name}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------
// 1. developmentJv.ts -- pure reasoning function.
// ---------------------------------------------------------------------
await check("assessJvOpportunity: known facts, missing information, and inferred considerations are honestly separated", () => {
  const evidence = {
    opportunityType: "land_jv",
    location: "Ikoyi, Lagos",
    landSize: "2.5 acres",
    structureOffered: null,
    landownerExpectation: null,
    titleDocumentStatus: null,
    commercialTerms: null,
    timeline: "6 months",
  };
  const result = assessJvOpportunity(evidence, DEFAULT_JV_STRATEGY);
  assert.equal(result.known_facts.opportunity_type, "land_jv");
  assert.equal(result.known_facts.location, "Ikoyi, Lagos");
  assert.ok(!("structure_offered" in result.known_facts), "structure_offered must not be fabricated into known_facts when absent");
  assert.ok(result.missing_information.includes("jv_structure_offered"), "missing jv_structure_offered must be reported honestly");
  assert.ok(result.missing_information.includes("landowner_expectation"));
  assert.ok(result.missing_information.includes("title_document_status"));
  assert.ok(result.missing_information.includes("commercial_terms"));
  assert.equal(result.strategic_alignment.status, "aligned");
  assert.equal(result.strategic_alignment.matchedArea.area, "Ikoyi");
});

await check("assessJvOpportunity: strategy is injectable data, not hardcoded -- a different strategy changes the answer for the SAME evidence", () => {
  const evidence = { opportunityType: "land_jv", location: "Enugu", landSize: "1 acre", commercialTerms: "negotiable" };
  const defaultResult = assessJvOpportunity(evidence, DEFAULT_JV_STRATEGY);
  assert.equal(defaultResult.strategic_alignment.status, "outside_current_focus", "Enugu is not in the default target areas");
  assert.equal(defaultResult.recommended_next_step, "mark_outside_current_strategy");

  const customStrategy = { ...DEFAULT_JV_STRATEGY, targetAreas: [{ region: "Lagos", area: "Enugu" }] };
  const customResult = assessJvOpportunity(evidence, customStrategy);
  assert.equal(customResult.strategic_alignment.status, "aligned", "a caller-supplied strategy must be able to reach a different, still-transparent answer for identical evidence");
  need(customResult.strategy_reference.target_area_count === 1, "strategy_reference must reflect the strategy actually used, not a hardcoded default");
});

await check("assessJvOpportunity: structure divergence from strategy is a consideration, never a disqualifier", () => {
  const alignedButDivergent = {
    opportunityType: "land_jv", location: "Lekki", landSize: "3 acres", structureOffered: "50/50", commercialTerms: "open to discussion",
  };
  const result = assessJvOpportunity(alignedButDivergent, DEFAULT_JV_STRATEGY);
  assert.ok(result.inferred_considerations.some((c) => c.includes("diverges from the current target range")), "a wide structure divergence must surface as a consideration");
  assert.notEqual(result.recommended_next_step, "mark_outside_current_strategy", "structure divergence alone must never disqualify an otherwise-aligned opportunity");
});

await check("assessJvOpportunity: the four-way decision table -- request_more_information / route_for_human_review / progress_opportunity / mark_outside_current_strategy", () => {
  const sparse = assessJvOpportunity({}, DEFAULT_JV_STRATEGY);
  assert.equal(sparse.recommended_next_step, "request_more_information", `expected request_more_information for near-empty evidence, got ${sparse.recommended_next_step}`);

  const outside = assessJvOpportunity({ opportunityType: "land_jv", location: "Enugu", landSize: "1 acre" }, DEFAULT_JV_STRATEGY);
  assert.equal(outside.recommended_next_step, "mark_outside_current_strategy");

  const strongAligned = assessJvOpportunity(
    { opportunityType: "land_jv", location: "Victoria Island", landSize: "4 acres", commercialTerms: "70/30 proposed, negotiable" },
    DEFAULT_JV_STRATEGY
  );
  assert.equal(strongAligned.recommended_next_step, "progress_opportunity", `expected progress_opportunity for strong aligned evidence, got ${strongAligned.recommended_next_step}`);

  const partialAligned = assessJvOpportunity({ opportunityType: "land_jv", location: "Ikeja", landSize: "2 acres" }, DEFAULT_JV_STRATEGY);
  assert.equal(partialAligned.recommended_next_step, "route_for_human_review", `expected route_for_human_review for aligned-but-incomplete evidence, got ${partialAligned.recommended_next_step}`);
});

await check("assessJvOpportunity: never fabricates land values, title validity, feasibility, financial returns or credibility", () => {
  const result = assessJvOpportunity({ opportunityType: "land_jv", location: "Asokoro", landSize: "2 acres" }, DEFAULT_JV_STRATEGY);
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ["feasibility_score", "estimated_value", "valuation", "credit_score", "land_value_ngn"]) {
    need(!serialized.includes(forbidden), `assessment must never fabricate a "${forbidden}" figure`);
  }
});

// ---------------------------------------------------------------------
// 2. officeMaterialEventAdapter.ts -- Office Signal Adapter.
// ---------------------------------------------------------------------
function matches(row, filters) {
  return filters.every(([col, op, val]) => {
    if (op === "eq") return row[col] === val;
    return true;
  });
}
function makeOperationalSignalsTable(store) {
  return {
    select() {
      const filters = [];
      const builder = {
        eq(col, val) { filters.push([col, "eq", val]); return builder; },
        maybeSingle() {
          const rows = store.filter((r) => matches(r, filters));
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
      };
      return builder;
    },
    insert(row) {
      const inserted = { id: `row-${store.length + 1}`, ...row };
      store.push(inserted);
      return { select() { return { single: () => Promise.resolve({ data: inserted, error: null }) }; } };
    },
    // recordBundle()'s own secondary hook (distinct from recordSignal's
    // dedup insert this test exercises) upserts here too; already
    // safely no-op'd by the runtime's own safeHook wrapper on failure,
    // this just avoids a noisy (harmless) warning in test output.
    upsert(row) {
      store.push(row);
      return { select() { return { single: () => Promise.resolve({ data: row, error: null }) }; } };
    },
  };
}
let operationalSignals = [];
const genericTables = new Map();
function fakeFrom(table) {
  if (table === "operational_signals") return makeOperationalSignalsTable(operationalSignals);
  if (!genericTables.has(table)) genericTables.set(table, []);
  const store = genericTables.get(table);
  return {
    select() { return { eq() { return this; }, maybeSingle: () => Promise.resolve({ data: null, error: null }), then: (resolve) => resolve({ data: [], error: null }) }; },
    insert(row) { store.push(row); return { select() { return { single: () => Promise.resolve({ data: row, error: null }) }; } }; },
    upsert(row) { store.push(row); return { select() { return { single: () => Promise.resolve({ data: row, error: null }) }; } }; },
  };
}
supabaseModule.supabaseAdmin.from = fakeFrom;

const officeMaterialEventAdapterModule = await import(path.join(root, "dist/oyi-core/ingress/officeMaterialEventAdapter.js"));
const { submitOfficeMaterialEventCanonicalSignal } = officeMaterialEventAdapterModule;

const originalReceiveSignal = oyiCoreServiceModule.oyiCoreRuntime.receiveSignal.bind(oyiCoreServiceModule.oyiCoreRuntime);

function spy(returnValue) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return typeof returnValue === "function" ? returnValue(...args) : Promise.resolve(returnValue); };
  fn.calls = calls;
  return fn;
}

function sampleLeadCreatedEvent(overrides = {}) {
  return {
    event_id: "office:lead-1:lead_created:idem-1",
    event_type: "lead_created",
    idempotency_key: "idem-1",
    occurred_at: new Date().toISOString(),
    source_system: "ochiga-office",
    request_id: "req-1",
    subject: { type: "lead", id: "lead-1", label: "Test Lead" },
    business_unit: "corporate",
    inquiry_type: "general_enquiry",
    source: { channel: "website", site: "ochiga_website", page: "/contact", form: "contact_form" },
    crm: { lead_id: "lead-1", status: "new", stage: "new", owner: null },
    metadata: {},
    ...overrides,
  };
}

function sampleDevelopmentEvent(overrides = {}) {
  return sampleLeadCreatedEvent({
    event_id: "office:lead-2:development_enquiry_received:idem-2",
    event_type: "development_enquiry_received",
    idempotency_key: "idem-2",
    subject: { type: "lead", id: "lead-2", label: "JV Enquiry" },
    business_unit: "development",
    inquiry_type: "land_jv",
    crm: { lead_id: "lead-2", status: "new", stage: "new", owner: null },
    metadata: { development: { opportunity_type: "land_jv", location: "Ikoyi, Lagos", land_size: "3 acres" } },
    ...overrides,
  });
}

await check("submitOfficeMaterialEventCanonicalSignal: exactly one Core ingestion; estate/business-unit scope preserved; no fabricated estate", async () => {
  operationalSignals = [];
  const receiveSpy = spy({ receipt: { accepted: true, duplicate: false } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;

  await submitOfficeMaterialEventCanonicalSignal(sampleLeadCreatedEvent());

  need(receiveSpy.calls.length === 1, `expected exactly one Core ingestion, got ${receiveSpy.calls.length}`);
  const signal = receiveSpy.calls[0][0];
  need(signal.type === "lead_created", "canonical type must be the raw material event type");
  need(signal.domain === "office", "canonical domain must be office");
  need(signal.source === "office", "canonical source must be office");
  need(signal.estateId === null, "a CRM/corporate event must not be given a fabricated estate scope");
  need(signal.metadata.business_unit === "corporate", "business_unit must be preserved on the signal");
  need(signal.metadata.provider_event_id === "idem-1", "the office idempotency_key must be carried as provider_event_id for durable dedup");

  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

await check("submitOfficeMaterialEventCanonicalSignal: development_enquiry_received embeds a JV assessment; other event types do not", async () => {
  operationalSignals = [];
  const receiveSpy = spy({ receipt: { accepted: true, duplicate: false } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;

  await submitOfficeMaterialEventCanonicalSignal(sampleDevelopmentEvent());
  const devSignal = receiveSpy.calls[0][0];
  need(devSignal.evidence.length === 2, `expected 2 evidence entries (event + jv_assessment) for development_enquiry_received, got ${devSignal.evidence.length}`);
  need(devSignal.evidence[1].type === "development_jv_assessment", "second evidence entry must be the JV assessment");
  need(devSignal.metadata.jv_assessment?.strategic_alignment?.status === "aligned", "Ikoyi must be assessed as aligned with the default strategy");

  await submitOfficeMaterialEventCanonicalSignal(sampleLeadCreatedEvent({ idempotency_key: "idem-3", event_id: "office:lead-3:lead_created:idem-3" }));
  const nonDevSignal = receiveSpy.calls[1][0];
  need(nonDevSignal.evidence.length === 1, `expected exactly 1 evidence entry for a non-development event, got ${nonDevSignal.evidence.length}`);
  need(!("jv_assessment" in nonDevSignal.metadata), "jv_assessment must never appear on a non-development-enquiry event");

  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

await check("submitOfficeMaterialEventCanonicalSignal: an idempotent retry (same idempotency_key) causes no second logical observation", async () => {
  operationalSignals = [];
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal; // exercise the REAL runtime + durable store

  const event = sampleLeadCreatedEvent({ idempotency_key: "idem-retry-1", event_id: "office:lead-9:lead_created:idem-retry-1" });
  const first = await submitOfficeMaterialEventCanonicalSignal(event);
  const second = await submitOfficeMaterialEventCanonicalSignal(event); // Office's publisher retrying the identical payload

  need(first?.receipt?.duplicate !== true, "the first, genuine observation must not be reported as a duplicate");
  need(second?.receipt?.duplicate === true, `a retry of the identical event must be recognized as a duplicate, got receipt=${JSON.stringify(second?.receipt)}`);
  need(operationalSignals.length === 1, `the durable store must contain exactly one row for this event after a retry, got ${operationalSignals.length}`);
});

await check("submitOfficeMaterialEventCanonicalSignal: an unavailable Core ingress does not throw and returns null (never corrupts established CRM truth)", async () => {
  operationalSignals = [];
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = () => Promise.reject(new Error("core_unavailable"));

  const result = await submitOfficeMaterialEventCanonicalSignal(sampleLeadCreatedEvent({ idempotency_key: "idem-fail-1", event_id: "office:lead-x:lead_created:idem-fail-1" }));
  need(result === null, "submitOfficeMaterialEventCanonicalSignal must resolve to null, never throw, when Core ingestion fails");

  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

await check("submitOfficeMaterialEventCanonicalSignal: malformed/incomplete development metadata does not crash and reports missing information honestly", async () => {
  operationalSignals = [];
  const receiveSpy = spy({ receipt: { accepted: true, duplicate: false } });
  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = receiveSpy;

  const malformed = sampleDevelopmentEvent({ metadata: { development: "not-an-object" }, idempotency_key: "idem-malformed-1", event_id: "office:lead-m:development_enquiry_received:idem-malformed-1" });
  const result = await submitOfficeMaterialEventCanonicalSignal(malformed);
  need(result !== null, "a malformed metadata.development shape must not break canonical ingestion");
  const signal = receiveSpy.calls[0][0];
  need(signal.metadata.jv_assessment?.missing_information?.includes("opportunity_type"), "malformed/absent development evidence must be reported as missing, never guessed");

  oyiCoreServiceModule.oyiCoreRuntime.receiveSignal = originalReceiveSignal;
});

// ---------------------------------------------------------------------
// 3. corporateOfficeInternalPolicy.ts -- governed JV proposal wiring.
// ---------------------------------------------------------------------
function baseOfficeInternalRequest(overrides = {}) {
  return {
    request_id: "req-office-jv-1",
    message: "What do you think of this JV opportunity?",
    office_session_id: "office-session-jv-1",
    conversation_thread_id: "thread-jv-1",
    staff: { staff_id: "staff-1", email: "staff@example.com", role: "ochiga_staff", permissions: ["office.read", "office.intelligence"] },
    page_context: { page: "/office/crm", selected_type: "lead", selected_id: "lead-2" },
    business_unit: "development",
    capability_context: ["crm"],
    crm_context: null,
    portfolio_context: null,
    support_context: null,
    project_context: null,
    task_context: null,
    task_batch_context: null,
    execution_failed: false,
    execution_failure_reason: null,
    automation_context: null,
    meeting_context: null,
    partnership_context: null,
    document_context: null,
    content_context: null,
    development_context: null,
    requested_capability: null,
    knowledge_context: [],
    metadata: {},
    ...overrides,
  };
}
const canonicalStub = { message: "Here is what I found.", thread_id: "thread-jv-1", confirmations: [], cards: [] };

await check("buildOfficeInternalResponse: route_for_human_review proposes exactly one office.request_handoff (the existing whitelisted tool), never a broader mutation", () => {
  const request = baseOfficeInternalRequest({
    development_context: { opportunity_ref: "opp-1", safe_summary: "JV enquiry", opportunity_type: "land_jv", location: "Ikeja", land_size: "2 acres" },
  });
  const response = buildOfficeInternalResponse(request, canonicalStub, null);
  const jvProposals = response.tool_proposals.filter((p) => p.proposal_id?.startsWith("office_jv_handoff_"));
  need(jvProposals.length === 1, `expected exactly one JV handoff proposal, got ${jvProposals.length}`);
  need(jvProposals[0].tool === "office.request_handoff", `JV proposal must use the existing whitelisted tool, got "${jvProposals[0].tool}"`);
  need(jvProposals[0].governance === "office_validates_before_execution", "the proposal must remain Office-governed");
  need(response.safe_metadata.jv_assessment?.recommended_next_step === "route_for_human_review", "safe_metadata.jv_assessment must carry the full structured assessment");
  need(response.safe_metadata.development_context_present === true);
});

await check("buildOfficeInternalResponse: progress_opportunity / mark_outside_current_strategy / request_more_information never propose a tool", () => {
  const progressRequest = baseOfficeInternalRequest({
    development_context: { opportunity_ref: "opp-2", safe_summary: "Strong JV", opportunity_type: "land_jv", location: "Victoria Island", land_size: "4 acres", commercial_terms: "70/30" },
  });
  const progressResponse = buildOfficeInternalResponse(progressRequest, canonicalStub, null);
  need(progressResponse.safe_metadata.jv_assessment?.recommended_next_step === "progress_opportunity");
  need(!progressResponse.tool_proposals.some((p) => p.proposal_id?.startsWith("office_jv_handoff_")), "progress_opportunity must never itself trigger a tool proposal -- Core does not mutate CRM");

  const outsideRequest = baseOfficeInternalRequest({
    development_context: { opportunity_ref: "opp-3", safe_summary: "Out of area", opportunity_type: "land_jv", location: "Enugu", land_size: "1 acre" },
  });
  const outsideResponse = buildOfficeInternalResponse(outsideRequest, canonicalStub, null);
  need(outsideResponse.safe_metadata.jv_assessment?.recommended_next_step === "mark_outside_current_strategy");
  need(!outsideResponse.tool_proposals.some((p) => p.proposal_id?.startsWith("office_jv_handoff_")));

  const emptyRequest = baseOfficeInternalRequest({ development_context: { opportunity_ref: "opp-4", safe_summary: "Sparse" } });
  const emptyResponse = buildOfficeInternalResponse(emptyRequest, canonicalStub, null);
  need(emptyResponse.safe_metadata.jv_assessment?.recommended_next_step === "request_more_information");
  need(!emptyResponse.tool_proposals.some((p) => p.proposal_id?.startsWith("office_jv_handoff_")));
});

await check("buildOfficeInternalResponse: jv_assessment is null when business_unit is not development or development_context is absent", () => {
  const notDevelopment = buildOfficeInternalResponse(baseOfficeInternalRequest({ business_unit: "technology", development_context: { opportunity_ref: "opp-5", safe_summary: "x" } }), canonicalStub, null);
  need(notDevelopment.safe_metadata.jv_assessment === null, "jv_assessment must be null when business_unit is not development, even if development_context is present");

  const noContext = buildOfficeInternalResponse(baseOfficeInternalRequest({ development_context: null }), canonicalStub, null);
  need(noContext.safe_metadata.jv_assessment === null, "jv_assessment must be null when Office supplied no development_context");
  need(noContext.safe_metadata.development_context_present === false);
});

await check("buildOfficeInternalResponse: existing non-JV tool proposals (follow-up task) are unaffected by the JV wiring", () => {
  const request = baseOfficeInternalRequest({
    business_unit: "technology",
    message: "Can you set a follow-up reminder for this?",
    task_context: { task_ref: "task-1", safe_summary: "Overdue: check back next week" },
  });
  const response = buildOfficeInternalResponse(request, canonicalStub, null);
  need(response.tool_proposals.some((p) => p.tool === "office.create_followup_task"), "existing follow-up task proposal logic must be unaffected by this wave's changes");
});

// ---------------------------------------------------------------------
// 4. Structural proof -- material-event route wiring, closed event-type
// allowlist, and no path to Office mutation or external reply.
// ---------------------------------------------------------------------
await check("structural: POST /office/events/material is registered, gated, validated, and wired to the canonical adapter", async () => {
  const routeSource = fs.readFileSync(path.join(root, "dist/routes/officeExport.js"), "utf8");
  need(/router\.post\(\s*["']\/events\/material["']\s*,\s*requireOfficeExportKey/.test(routeSource), "the route must be registered with the office auth gate");
  need(routeSource.includes("submitOfficeMaterialEventCanonicalSignal"), "the route must call the canonical Office Signal Adapter");
  need(routeSource.includes("idempotency_key is required"), "malformed events (missing idempotency_key) must be rejected");
  need(routeSource.includes('source_system must be'), 'a forged source_system must be rejected');
  need(routeSource.includes("CORPORATE_MATERIAL_EVENT_TYPES"), "event_type must be checked against the closed known-type set, not accepted blindly");
});

await check("structural: neither the material-event adapter nor the JV capability can mutate Office or send an external reply", async () => {
  const adapterSource = fs.readFileSync(path.join(root, "src/oyi-core/ingress/officeMaterialEventAdapter.ts"), "utf8");
  const jvSource = fs.readFileSync(path.join(root, "src/oyi-core/domains/development/developmentJv.ts"), "utf8");
  for (const source of [adapterSource, jvSource]) {
    need(!/NotificationService/.test(source), "must never reference NotificationService directly");
    need(!/axios|fetch\(|http\.request|https\.request/.test(source), "must never make an outbound HTTP call (no direct Office write, no external reply)");
    need(!/supabaseAdmin\s*\.\s*from\(\s*["']office_/.test(source), "must never write to an office_* table -- Backend has no Office database connection");
  }
});

if (failures.length) {
  console.error(`FAIL oyi-office-intelligence-convergence-smoke (${failures.length} failure(s)):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("oyi-office-intelligence-convergence-smoke passed");
process.exit(0);
