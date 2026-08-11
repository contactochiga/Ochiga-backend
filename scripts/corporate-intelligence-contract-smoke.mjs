import assert from "node:assert/strict";
import {
  CORPORATE_INTELLIGENCE_CONTRACT_VERSION,
  PUBLIC_CORPORATE_SURFACE_POLICY,
  assertOpaquePublicReference,
  isPublicCorporateCapabilityAllowed,
  isPublicOperationalRequestBlocked,
  routeCorporateBusinessUnit,
  selectCorporateAgentRole,
} from "../dist/contracts/corporateIntelligence.js";
import { getIntelligenceAgent } from "../dist/intelligence-core/agentRegistry.js";
import { PLATFORM_SOURCE_OF_TRUTH, getPlatformBoundaryContract } from "../dist/contracts/platformBoundaries.js";

assert.equal(CORPORATE_INTELLIGENCE_CONTRACT_VERSION, "corporate-intelligence.2026-08-11");
assert.equal(PLATFORM_SOURCE_OF_TRUTH.corporate_crm, "ochiga-office");
assert.equal(PLATFORM_SOURCE_OF_TRUTH.oyi_core_intelligence, "ochiga-backend");
assert.ok(getPlatformBoundaryContract("office-backend-intelligence-events"));
assert.ok(getPlatformBoundaryContract("website-office-crm-intake"));

const oma = getIntelligenceAgent("oma");
const osa = getIntelligenceAgent("osa");
assert.ok(oma?.allowed_surfaces.includes("widget"));
assert.ok(osa?.allowed_surfaces.includes("website"));
assert.ok(oma?.tools.every((tool) => tool.startsWith("office:")));
assert.ok(osa?.tools.every((tool) => tool.startsWith("office:")));

assert.equal(routeCorporateBusinessUnit({ source_page: "/technology", message: "Can Oyi be installed in an existing development?" }).business_unit, "technology");
assert.equal(routeCorporateBusinessUnit({ source_page: "/private", message: "I want to request membership" }).business_unit, "private");
assert.equal(routeCorporateBusinessUnit({ source_page: "/partnerships/landowners", message: "We have land for a JV" }).business_unit, "development");
assert.equal(routeCorporateBusinessUnit({ source_page: "/partnerships/capital", message: "Capital partnership" }).business_unit, "partnerships");
assert.equal(routeCorporateBusinessUnit({ source_page: "/contact", message: "General question" }).business_unit, "corporate");

assert.equal(selectCorporateAgentRole({ business_unit: "technology", inquiry_type: "oyi_enquiry", message: "What exactly does Oyi do?" }).agent_role, "oma");
const salesReady = selectCorporateAgentRole({
  business_unit: "technology",
  inquiry_type: "oyi_deployment_request",
  lead_stage: "interested",
  message: "We manage four apartment buildings and want a deployment proposal.",
});
assert.equal(salesReady.agent_role, "osa");
assert.equal(salesReady.reason, "commercial_or_sales_ready_signal");

assert.ok(isPublicCorporateCapabilityAllowed("corporate_knowledge_read"));
assert.ok(isPublicCorporateCapabilityAllowed("voice_session_prepare"));
assert.ok(!isPublicCorporateCapabilityAllowed("device_control"));
assert.ok(isPublicOperationalRequestBlocked({ domain: "devices", action: "device_control" }));
assert.ok(isPublicOperationalRequestBlocked({ domain: "security", action: "private_record_read" }));
assert.ok(!isPublicOperationalRequestBlocked({ domain: "corporate", action: "public_question_answer" }));

assert.equal(PUBLIC_CORPORATE_SURFACE_POLICY.public_identity, "ochiga_intelligence");
assert.deepEqual(PUBLIC_CORPORATE_SURFACE_POLICY.allowed_agent_roles, ["oma", "osa"]);
assert.ok(PUBLIC_CORPORATE_SURFACE_POLICY.blocked_operational_domains.includes("resident_private"));

assert.equal(assertOpaquePublicReference("pubctx_123456789abc"), true);
assert.equal(assertOpaquePublicReference("lead-123"), false);
assert.equal(assertOpaquePublicReference("contact-123"), false);

const textSession = {
  session_id: "pubsess_1",
  conversation_thread_id: "oyi_thread_1",
  engagement_mode: "text_conversation",
};
const voiceSession = {
  ...textSession,
  engagement_mode: "voice_conversation",
  voice_state: "active",
};
assert.equal(voiceSession.session_id, textSession.session_id);
assert.equal(voiceSession.conversation_thread_id, textSession.conversation_thread_id);

console.log("corporate-intelligence-contract-smoke: PASS");
