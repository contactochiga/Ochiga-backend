import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildOfficeInternalResponse,
  deniedOfficeInternalOperationalRequest,
} from "../dist/oyi-core/policy/corporateOfficeInternalPolicy.js";

const serviceSource = fs.readFileSync(new URL("../dist/services/oyiUnifiedIntelligenceService.js", import.meta.url), "utf8");
const policySource = fs.readFileSync(new URL("../dist/oyi-core/policy/surfaceConversationPolicy.js", import.meta.url), "utf8");
const officeRouteSource = fs.readFileSync(new URL("../dist/routes/officeExport.js", import.meta.url), "utf8");

assert.ok(serviceSource.includes("office_internal"), "Oyi surface registry must include office_internal");
assert.ok(policySource.includes("Ochiga staff"), "Surface capability policy must describe Office Internal capabilities");
assert.ok(officeRouteSource.includes("/conversation/internal"), "Office Internal conversation route must be mounted");
assert.ok(officeRouteSource.includes("runCanonicalConversation"), "Office Internal route must call canonical Oyi conversation runtime");

assert.equal(deniedOfficeInternalOperationalRequest({ message: "Unlock the front door", permissions: [] }), true);
assert.equal(deniedOfficeInternalOperationalRequest({ message: "Which support cases are overdue?", permissions: [] }), false);
assert.equal(deniedOfficeInternalOperationalRequest({ message: "Unlock the front door", permissions: ["facility.deep_action"] }), false);

const request = {
  request_id: "req-office-1",
  message: "Prepare a follow-up task for this support case and draft a quote.",
  office_session_id: "office-session-1",
  conversation_thread_id: "thread-office-1",
  staff: {
    staff_id: "staff-1",
    email: "staff@example.com",
    role: "ochiga_staff",
    permissions: ["office.read", "office.intelligence"],
  },
  page_context: {
    page: "/office/support",
    selected_type: "support_case",
    selected_id: "support-1",
  },
  business_unit: "technology",
  capability_context: ["support", "documents"],
  crm_context: null,
  portfolio_context: {
    portfolio_ref: "portfolio-1",
    backend_building_ref: "building-1",
    safe_summary: "Deployment support case.",
  },
  support_context: {
    support_case_ref: "support-1",
    safe_summary: "Integration issue needs attention.",
  },
  requested_capability: "office_internal_conversation",
  knowledge_context: [{ id: "support", title: "Support SOP", excerpt: "Escalations need owner and due date.", source: "office" }],
  metadata: {},
};

const canonical = {
  id: "canonical-office-response-1",
  thread_id: "thread-office-1",
  intent: "office_internal_conversation",
  message: "This support case needs a follow-up owner and a pricing-safe quote draft.",
  persistence_saved: true,
};

const response = buildOfficeInternalResponse(request, canonical);
assert.equal(response.ok, true);
assert.equal(response.surface, "office_internal");
assert.equal(response.source, "oyi_core");
assert.equal(response.business_domain, "technology");
assert.equal(response.attention_signal, "support");
assert.equal(response.conversation_thread_id, "thread-office-1");
assert.ok(response.tool_proposals.some((proposal) => proposal.tool === "office.create_followup_task"));
assert.ok(response.tool_proposals.some((proposal) => proposal.tool === "office.prepare_commercial_document"));
assert.equal(response.safe_metadata.portfolio_context_present, true);
assert.equal(response.safe_metadata.support_context_present, true);

console.log("office-internal-surface-smoke: PASS");
