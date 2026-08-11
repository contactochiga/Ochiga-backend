import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildCorporatePublicResponse,
  deniedPublicCorporateOperationalRequest,
} from "../dist/oyi-core/policy/corporatePublicConversationPolicy.js";
import {
  PUBLIC_CORPORATE_SURFACE_POLICY,
} from "../dist/contracts/corporateIntelligence.js";

const officeRouteSource = fs.readFileSync(new URL("../dist/routes/officeExport.js", import.meta.url), "utf8");
assert.ok(officeRouteSource.includes("/conversation/corporate"), "Office corporate conversation route must be mounted");
assert.ok(officeRouteSource.includes("runCanonicalConversation"), "Corporate route must call canonical Oyi conversation runtime");

assert.equal(deniedPublicCorporateOperationalRequest({ message: "Unlock my front door." }), true);
assert.equal(deniedPublicCorporateOperationalRequest({ message: "Show my wallet balance." }), true);
assert.equal(deniedPublicCorporateOperationalRequest({ message: "What does Oyi do?" }), false);

const request = {
  request_id: "req-1",
  message: "We manage six buildings and want an Oyi deployment proposal.",
  public_session_id: "pubsess_1",
  conversation_thread_id: "thread_1",
  public_identity: "ochiga_intelligence",
  agent_role: "oma",
  business_unit: "technology",
  inquiry_type: "oyi_enquiry",
  source: {
    source_site: "ochiga_website",
    source_page: "/technology",
    source_form: null,
    source_channel: "website",
    campaign: {},
  },
  visitor_state: "anonymous",
  crm_context: {
    contact_ref: null,
    opportunity_ref: null,
    lead_ref: null,
    safe_summary: null,
  },
  form_context_ref: null,
  engagement_mode: "text_conversation",
  handoff_state: "none",
  requested_capability: "public_question_answer",
  knowledge_context: [{ id: "oyi", title: "Oyi", excerpt: "Oyi is Ochiga's operating layer.", source: "office_knowledge" }],
  metadata: {},
};

const canonical = {
  id: "canonical-response-1",
  thread_id: "thread_1",
  intent: "corporate_public_conversation",
  understood: "Technology deployment enquiry",
  answer: "Canonical answer",
  reply: "Canonical answer",
  message: "Canonical answer",
  persistence_saved: true,
};

const response = buildCorporatePublicResponse(request, canonical);
assert.equal(response.ok, true);
assert.equal(response.public_identity, PUBLIC_CORPORATE_SURFACE_POLICY.public_identity);
assert.equal(response.business_unit, "technology");
assert.equal(response.recommended_agent_role, "osa");
assert.equal(response.commercial_signal, "proposal");
assert.equal(response.qualification_signal, "high");
assert.equal(response.canonical.source, "oyi_canonical_runtime");
assert.equal(response.canonical.thread_id, "thread_1");
assert.ok(response.tool_proposals.some((proposal) => proposal.tool === "crm.create_or_update_lead"));
assert.ok(response.tool_proposals.some((proposal) => proposal.tool === "crm.create_opportunity"));
assert.ok(response.tool_proposals.every((proposal) => proposal.governance === "office_validates_before_execution"));

const voiceRequest = { ...request, engagement_mode: "voice_conversation" };
const voiceResponse = buildCorporatePublicResponse(voiceRequest, canonical);
assert.equal(voiceResponse.conversation_thread_id, response.conversation_thread_id);

console.log("corporate-public-integration-smoke: PASS");
