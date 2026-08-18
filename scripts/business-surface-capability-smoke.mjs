// End-to-end proof that office_internal/public_corporate now resolve
// real capabilities through the actual Oyi Core pipeline
// (conversationOrchestrator.run) instead of falling into the
// Consumer/Facility device/room target resolver. Unlike the two
// existing surface smoke tests (which hand-build a canonical response
// and only exercise the presentation-policy wrappers), this calls the
// real orchestrator so capability resolution, authority/RBAC and the
// new business-surface fallback gate are all genuinely exercised.
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();
const { conversationOrchestrator } = await import("../dist/oyi-core/orchestration/ConversationOrchestrator.js");

function officeActor(id, permissions) {
  return { id, email: `${id}@example.com`, role: "ochiga_staff", permissions, permission_scopes: permissions };
}

const publicActor = {
  id: "office-public-intelligence",
  email: "public-intelligence@ochiga.local",
  role: "guest",
  permissions: [],
  permission_scopes: [],
};

const snapshot = {
  generated_at: new Date().toISOString(),
  leads: {
    needing_attention: [
      { id: "lead-1", name: "Adaeze Okafor", status: "new", reason: "No response in 5 days", last_activity_at: "2026-08-10T00:00:00Z" },
    ],
    total_open: 12,
  },
  opportunities: {
    stale: [
      { id: "opp-1", name: "Havana Residences — Unit 4B", stage: "negotiation", days_since_activity: 9, owner: "Tomi A." },
    ],
    total_open: 6,
  },
  reports: {
    pending_approval: [
      { id: "rep-1", title: "August Site Progress — Havana", submitted_by: "Site Manager", submitted_at: "2026-08-12T00:00:00Z" },
    ],
  },
  development: {
    projects: [
      { id: "dev-1", name: "Havana Residences (internal)", status: "under construction", percent_complete: 62, units_sold: 40, units_total: 80 },
    ],
  },
};

let requestSeq = 0;

async function runOfficeInternal(message, actor, withSnapshot = true) {
  requestSeq += 1;
  return conversationOrchestrator.run({
    actor,
    oisContext: { surface: "office_internal", estate_id: null, home_id: null, module: "office_internal", role: actor.role },
    input: {
      message,
      surface: "office_internal",
      role: actor.role,
      module: "office_internal",
      thread_id: null,
      context: {
        request_id: `req-office-smoke-${requestSeq}`,
        office_session_id: "office-session-smoke",
        staff: { staff_id: actor.id, email: actor.email, role: actor.role, permissions: actor.permissions },
        page_context: { page: null, selected_type: null, selected_id: null },
        business_unit: "corporate",
        operational_snapshot: withSnapshot ? snapshot : null,
        contract_version: "smoke",
      },
      conversation_context: {},
      intent_hint: "office_internal_conversation",
      operation_class_hint: "read",
      scope_mode_hint: "global",
    },
  });
}

async function runPublicCorporate(message) {
  requestSeq += 1;
  return conversationOrchestrator.run({
    actor: publicActor,
    oisContext: { surface: "public_corporate", estate_id: null, home_id: null, module: "corporate_public", role: "oma" },
    input: {
      message,
      surface: "public_corporate",
      role: "oma",
      module: "corporate_public",
      thread_id: null,
      context: { request_id: `req-public-smoke-${requestSeq}`, public_session_id: "public-session-smoke", contract_version: "smoke" },
      conversation_context: {},
      intent_hint: "corporate_public_conversation",
      operation_class_hint: "read",
      scope_mode_hint: "global",
    },
  });
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} :: ${name}`);
  console.log(`    → ${JSON.stringify(detail).slice(0, 300)}`);
}

const FULL_PERMS = ["crm.read", "reports.write", "development.manage"];
const privileged = officeActor("staff-privileged", FULL_PERMS);
const restricted = officeActor("staff-restricted", []);

async function main() {
  let r;

  r = await runOfficeInternal("What needs my attention today?", privileged);
  record("office: needs_attention_today_no_device_clarifier", !/which item should i inspect/i.test(r.answer || ""), r.answer);
  record("office: needs_attention_today_has_real_data", /Adaeze Okafor|Havana Residences/.test(r.answer || ""), r.answer);

  r = await runOfficeInternal("Show me the leads that need attention.", privileged);
  record("office: leads_needing_attention", /Adaeze Okafor/.test(r.answer || ""), r.answer);

  r = await runOfficeInternal("Which opportunities haven't been followed up this week?", privileged);
  record("office: stale_opportunities", /Havana Residences — Unit 4B/.test(r.answer || ""), r.answer);

  r = await runOfficeInternal("What reports are awaiting approval?", privileged);
  record("office: reports_awaiting_approval", /August Site Progress/.test(r.answer || ""), r.answer);

  r = await runOfficeInternal("What's happening across our developments?", privileged);
  record("office: development_status", /Havana Residences \(internal\)/.test(r.answer || ""), r.answer);

  r = await runOfficeInternal("What can you do on this page?", privileged);
  record(
    "office: capability_advertising_not_empty",
    !/I do not have any enabled read capabilities/i.test(r.answer || "") && /lead|opportunit|report|development/i.test(r.answer || ""),
    r.answer
  );

  // Lower-permission actor — RBAC denial must still work correctly, and
  // must never leak the privileged actor's data.
  r = await runOfficeInternal("Show me the leads that need attention.", restricted);
  record(
    "office: restricted_actor_denied_not_leaked",
    !/Adaeze Okafor/.test(r.answer || "") && /not authoris|permission/i.test(r.answer || ""),
    r.answer
  );

  // No operational_snapshot attached — must be honest, never fabricate.
  r = await runOfficeInternal("Show me the leads that need attention.", privileged, false);
  record(
    "office: no_snapshot_reports_unavailable_not_fabricated",
    !/Adaeze Okafor/.test(r.answer || "") && /unavailable|wasn't attached|don't have/i.test((r.answer || "").toLowerCase()),
    r.answer
  );

  r = await runPublicCorporate("What does Ochiga do?");
  record("public: what_does_ochiga_do", /development|oyi|private/i.test(r.answer || ""), r.answer);

  r = await runPublicCorporate("Tell me about your developments.");
  record("public: tell_me_about_developments_no_clarifier", !/which item should i inspect/i.test(r.answer || ""), r.answer);

  r = await runPublicCorporate("What is Oyi?");
  record("public: what_is_oyi", /operating technology|intelligence layer/i.test(r.answer || ""), r.answer);

  r = await runPublicCorporate("What is Ochiga Private?");
  record("public: what_is_ochiga_private", /membership|private/i.test(r.answer || ""), r.answer);

  r = await runPublicCorporate("How can I partner with Ochiga?");
  record("public: how_can_i_partner", /landowner|capital|partner/i.test(r.answer || ""), r.answer);

  r = await runPublicCorporate("What can you do?");
  record("public: capability_advertising_not_empty", !/I do not have any enabled read capabilities/i.test(r.answer || ""), r.answer);

  console.log("\n=== business-surface-capability-smoke SUMMARY ===");
  const failed = results.filter((item) => !item.ok);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("FAILED:", failed.map((item) => item.name).join(", "));
    process.exitCode = 1;
  } else {
    console.log("business-surface-capability-smoke: ALL PASS");
  }
}

main().catch((error) => {
  console.error("SMOKE_SCRIPT_FAILED", error && error.stack ? error.stack : error);
  process.exit(1);
});
