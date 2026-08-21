import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "milestone2-adaptive-blocks-coverage-smoke-service-role-key";

// Oyi Office Conversational Runtime, Milestone 2 — adaptive response
// block coverage. Two things:
//  (1) single-record read modules now pair their prose "digest" fallback
//      with a compact key_value block (short answer + structured detail,
//      matching the brief's own "a single partnership status question"
//      example) -- previously plain text only.
//  (2) CRM/Reports/Development/Financial aggregate modules previously
//      emitted a legacy {type:"list", items} block office.js's renderer
//      has no case for at all (silently dropped, confirmed by reading
//      renderResponseBlock's switch) -- converted to real record_list/
//      key_value blocks the renderer actually draws.
const { buildOfficeInternalReadCapabilities } = await import("../dist/oyi-core/capabilities/OfficeCorporateCapabilityModules.js");

const modules = buildOfficeInternalReadCapabilities();
function readModule(key) {
  const found = modules.find((m) => m.key === key);
  assert.ok(found, `${key} must be registered`);
  return found;
}

// --- Single-record key_value coverage ---
{
  const mod = readModule("office_partnerships.read");
  const ctx = {
    input: {
      message: "how is this partnership doing",
      context: { partnership_context: { partnership_ref: "pt-1", organization_name: "Greenview Ltd", review_status: "active", relationship_type: "technology_integrator", relationship_manager: "Ada Okafor", safe_summary: "x" } },
    },
  };
  const evidence = await mod.collectEvidence(ctx);
  const answer = await mod.buildReadResponse(ctx, evidence);
  assert.equal(answer.status, "answered");
  assert.ok(Array.isArray(answer.blocks) && answer.blocks.length, "the digest fallback must now carry a key_value block");
  assert.equal(answer.blocks[0].type, "key_value");
  assert.ok(answer.blocks[0].items.some((i) => i.label === "Manager" && i.value === "Ada Okafor"));
  assert.ok(!answer.blocks[0].items.some((i) => i.value === null || i.value === undefined || i.value === ""), "must never render an empty/absent field");
}

{
  const mod = readModule("office_automations.read");
  const ctx = {
    input: {
      message: "tell me about this",
      context: { automation_context: { automation_ref: "auto-1", name: "Weekly sweep", enabled: true, trigger: "every Friday at 9am", owner: "Tony", safe_summary: "x" } },
    },
  };
  const evidence = await mod.collectEvidence(ctx);
  const answer = await mod.buildReadResponse(ctx, evidence);
  assert.equal(answer.blocks[0].type, "key_value");
  assert.ok(answer.blocks[0].items.some((i) => i.label === "Status" && i.value === "Active"));
}

// --- CRM leads: record_list, not the dropped legacy {type:"list"} shape ---
{
  const mod = readModule("crm.leads.read");
  const ctx = {
    input: {
      message: "which leads need attention",
      context: { operational_snapshot: { leads: { needing_attention: [{ id: "lead-1", name: "Ada", status: "new", reason: "No activity in 6 days", last_activity_at: null }], total_open: 5 } } },
    },
  };
  const evidence = await mod.collectEvidence(ctx);
  const answer = await mod.buildReadResponse(ctx, evidence);
  assert.equal(answer.blocks[0].type, "record_list", "must be a renderer-supported block type, not the legacy dropped 'list' shape");
  assert.equal(answer.blocks[0].rows[0].id, "lead-1");
  assert.equal(answer.blocks[0].columns.length, 3);
}

// --- Financial summary: mixed composition (key_value totals + table of estates) ---
{
  const mod = readModule("financial.summary.read");
  const ctx = {
    input: {
      message: "what's our financial position",
      context: {
        operational_snapshot: {
          financial: {
            generated_at: "2026-08-20T00:00:00Z",
            period_start: "2026-08-01T00:00:00Z",
            period_end: "2026-08-31T00:00:00Z",
            portfolio: { estate_count: 2, currency: "NGN", current_balance_total: 500000, revenue_period_total: 100000, utility_sales_period_total: 20000, service_charge_period_total: 30000, transaction_count_total: 40 },
            estates: [{ estate_id: "estate-1", name: "Greenview", current_balance: 250000, currency: "NGN", revenue_period: 50000, utility_sales_period: 10000, service_charge_period: 15000, transaction_count: 20 }],
          },
        },
      },
    },
  };
  const evidence = await mod.collectEvidence(ctx);
  const answer = await mod.buildReadResponse(ctx, evidence);
  assert.equal(answer.blocks.length, 2, "must be a mixed composition: KPI summary + table");
  assert.equal(answer.blocks[0].type, "key_value");
  assert.equal(answer.blocks[1].type, "record_list");
  assert.equal(answer.blocks[1].rows[0].id, "estate-1");
}

console.log("milestone2-adaptive-blocks-coverage-smoke: PASS");
