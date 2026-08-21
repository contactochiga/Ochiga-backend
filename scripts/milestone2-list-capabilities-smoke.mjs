import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "milestone2-list-capabilities-smoke-service-role-key";

// Oyi Office Conversational Runtime, Milestone 2 — five new list/
// aggregate capabilities (automations, meetings, support, portfolio,
// partnerships), same template as office_tasks.query.read (Phase 4,
// PR 2): supports()/collectEvidence()/buildReadResponse() called
// directly (unit-level, no Supabase/network touched), mutual exclusion
// against the single-record module verified by construction.
const { buildOfficeInternalReadCapabilities } = await import("../dist/oyi-core/capabilities/OfficeCorporateCapabilityModules.js");

const modules = buildOfficeInternalReadCapabilities();
function moduleByKey(key) {
  const found = modules.find((m) => m.key === key);
  assert.ok(found, `${key} must be registered`);
  return found;
}

function frame(domain, normalizedText) {
  return { domain, normalizedText };
}
function contextWithSnapshot(message, section, value) {
  return { input: { message, context: { operational_snapshot: { [section]: value } } } };
}
function factsFrom(evidence) {
  return evidence.map((e) => e.payload.fact);
}

// ============================= Automations =============================
{
  const list = moduleByKey("office_automations.query.read");
  const single = moduleByKey("office_automations.read");
  assert.equal(list.supports(frame("automations", "show me the active automations")), true);
  assert.equal(single.supports(frame("automations", "show me the active automations")), false, "single-record module must not also claim a list query");
  assert.equal(list.supports(frame("automations", "is this automation active")), false, "singular question must not be claimed by the list module");
  assert.equal(single.supports(frame("automations", "is this automation active")), true);

  const automations = {
    items: [
      { id: "auto-1", name: "Weekly follow-up sweep", enabled: true, trigger_summary: "Weekly on Fri at 09:00", last_run_status: "succeeded", last_run_at: "2026-08-20T09:00:00.000Z" },
      { id: "auto-2", name: "Stale lead nudge", enabled: false, trigger_summary: "Daily at 08:00", last_run_status: "failed", last_run_at: "2026-08-18T08:00:00.000Z" },
    ],
    total: 2,
  };
  const ctx = contextWithSnapshot("show me the active automations", "automations", automations);
  const evidence = await list.collectEvidence(ctx);
  assert.equal(evidence.length, 1, "collect() must filter to active-only, matching what 'active' phrasing displays");
  assert.equal(evidence[0].object_id, "auto-1");
  assert.equal(evidence[0].privacy_class, "corporate_private");
  const facts = factsFrom(evidence);
  assert.equal(facts[0].object.canonical_id, "auto-1");
  assert.equal(facts[0].object.object_type, "automation");

  const answer = await list.buildReadResponse(ctx, evidence);
  assert.equal(answer.status, "answered");
  assert.ok(answer.answer.includes("Weekly follow-up sweep"));
  assert.ok(!answer.answer.includes("Stale lead nudge"), "a paused automation must not appear when 'active' was asked");
  assert.equal(answer.blocks[0].type, "record_list");

  const failedCtx = contextWithSnapshot("which ones failed this week", "automations", automations);
  const failedAnswer = await list.buildReadResponse(failedCtx, await list.collectEvidence(failedCtx));
  assert.ok(failedAnswer.answer.includes("Stale lead nudge"), "'failed' phrasing must surface the failed automation");
  assert.ok(!failedAnswer.answer.includes("Weekly follow-up sweep"));
}

// ============================== Meetings ================================
{
  const list = moduleByKey("office_meetings.query.read");
  const single = moduleByKey("office_meetings.read");
  assert.equal(list.supports(frame("office_meetings", "what meetings do I have tomorrow")), true);
  assert.equal(single.supports(frame("office_meetings", "what meetings do I have tomorrow")), false);
  assert.equal(list.supports(frame("office_meetings", "when is this meeting")), false);
  assert.equal(single.supports(frame("office_meetings", "when is this meeting")), true);
  assert.equal(list.supports(frame("office_meetings", "move the first one to 3pm")), false, "mutation intent must not be claimed by the list module");

  const tomorrowIso = new Date(Date.now() + 86_400_000).toISOString();
  const meetings = {
    items: [
      { id: "meet-1", title: "Deployment review", status: "scheduled", scheduled_at: tomorrowIso, owner: "Tony", participants: ["Tony", "Ada"] },
      { id: "meet-2", title: "Unrelated next-week sync", status: "scheduled", scheduled_at: new Date(Date.now() + 8 * 86_400_000).toISOString(), owner: "Ada", participants: [] },
    ],
    total: 2,
  };
  const ctx = contextWithSnapshot("what meetings do I have tomorrow", "meetings", meetings);
  const evidence = await list.collectEvidence(ctx);
  assert.equal(evidence.length, 1, "collect() must filter to tomorrow-only, matching what's displayed");
  assert.equal(evidence[0].object_id, "meet-1");
  const answer = await list.buildReadResponse(ctx, evidence);
  assert.ok(answer.answer.includes("Deployment review"));
  assert.ok(!answer.answer.includes("Unrelated next-week sync"));
}

// =============================== Support ================================
{
  const list = moduleByKey("office_support.query.read");
  const single = moduleByKey("office_support.read");
  assert.equal(list.supports(frame("office_support", "show me unresolved support issues")), true);
  assert.equal(single.supports(frame("office_support", "show me unresolved support issues")), false);
  assert.equal(list.supports(frame("office_support", "what severity is this")), false);
  assert.equal(single.supports(frame("office_support", "what severity is this")), true);

  const support = {
    items: [
      { id: "case-1", title: "Escalation for Havana deployment", status: "open", priority: "high", severity: "critical", owner: "Adoyi" },
      { id: "case-2", title: "Minor billing question", status: "open", priority: "low", severity: "low", owner: null },
    ],
    total: 2,
  };
  const ctx = contextWithSnapshot("which ones are critical", "support", support);
  const evidence = await list.collectEvidence(ctx);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].object_id, "case-1");
  const answer = await list.buildReadResponse(ctx, evidence);
  assert.ok(answer.answer.includes("Escalation for Havana deployment"));
  assert.ok(!answer.answer.includes("Minor billing question"));
}

// =============================== Portfolio ==============================
{
  const list = moduleByKey("office_portfolio.query.read");
  const single = moduleByKey("office_portfolio.read");
  assert.equal(list.supports(frame("office_portfolio", "show me the portfolio projects at risk")), true);
  assert.equal(single.supports(frame("office_portfolio", "show me the portfolio projects at risk")), false);
  assert.equal(list.supports(frame("office_portfolio", "how is this deployment going")), false);
  assert.equal(single.supports(frame("office_portfolio", "how is this deployment going")), true);

  const portfolio = {
    items: [
      { id: "pf-1", name: "Greenview Tower B", status: "attention", support_status: "escalated", health_summary: null, owner: "Tony" },
      { id: "pf-2", name: "Havana Court", status: "normal", support_status: "stable", health_summary: "Deployment healthy.", owner: "Ada" },
    ],
    total: 2,
  };
  const ctx = contextWithSnapshot("which portfolio projects have no health summary", "portfolio", portfolio);
  const evidence = await list.collectEvidence(ctx);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].object_id, "pf-1");
  const answer = await list.buildReadResponse(ctx, evidence);
  assert.ok(answer.answer.includes("Greenview Tower B"));
  assert.ok(!answer.answer.includes("Havana Court"));

  const topCtx = contextWithSnapshot("give me the top 1 portfolio projects", "portfolio", portfolio);
  const topAnswer = await list.buildReadResponse(topCtx, await list.collectEvidence(topCtx));
  assert.equal(topAnswer.blocks[0].rows.length, 1, "'top N' phrasing must cap the result set");
}

// ============================= Partnerships =============================
{
  const list = moduleByKey("office_partnerships.query.read");
  const single = moduleByKey("office_partnerships.read");
  assert.equal(list.supports(frame("corporate_partnerships", "show me the partnerships")), true);
  assert.equal(single.supports(frame("corporate_partnerships", "show me the partnerships")), false);
  assert.equal(list.supports(frame("corporate_partnerships", "who manages this partnership")), false);
  assert.equal(single.supports(frame("corporate_partnerships", "who manages this partnership")), true);

  const partnerships = {
    items: [{ id: "pt-1", name: "technology_integrator", status: "active", review_status: "active", relationship_type: "technology_integrator", owner: "Ada Okafor" }],
    total: 1,
  };
  const ctx = contextWithSnapshot("show me the partnerships", "partnerships", partnerships);
  const evidence = await list.collectEvidence(ctx);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].object_id, "pt-1");
  const answer = await list.buildReadResponse(ctx, evidence);
  assert.ok(answer.answer.includes("technology_integrator"));
}

// ==================== Absent-snapshot honesty (no permission) ====================
{
  const list = moduleByKey("office_support.query.read");
  const emptyCtx = { input: { message: "show me unresolved support issues", context: {} } };
  const answer = await list.buildReadResponse(emptyCtx, []);
  assert.equal(answer.status, "unavailable");
  assert.ok(!/undefined|null/i.test(answer.answer), "must never leak a raw undefined/null into the answer text");
}

console.log("milestone2-list-capabilities-smoke: PASS");
