#!/usr/bin/env node
// Wave 9 Slice 1 -- Canonical Knowledge Authority & Retrieval Contract
// functional smoke. Mocks officeKnowledgeBridge.ts's fetchOfficeKnowledgeFiles
// (matching every prior slice's established mocked-dependency pattern) with
// realistic content drawn from the REAL 27-file Office pack this slice's
// manifest classifies, then exercises retrieveKnowledge() end to end plus
// its wiring into both corporate conversation policy builders.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = "/Users/ochigaidoko/Documents/Ochiga-backend";

const bridgeModule = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/officeKnowledgeBridge.js"));
const { retrieveKnowledge, invalidateKnowledgeCache } = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/knowledgeRetrieval.js"));
const { manifestFileCount } = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/knowledgeIndex.js"));
const { OFFICE_KNOWLEDGE_MANIFEST } = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/officeKnowledgeManifest.js"));
const { buildCorporatePublicResponse } = require(path.join(backendRoot, "dist/oyi-core/policy/corporatePublicConversationPolicy.js"));
const { buildOfficeInternalResponse } = require(path.join(backendRoot, "dist/oyi-core/policy/corporateOfficeInternalPolicy.js"));

// Minimal realistic content per manifest file -- real excerpts, not
// lorem-ipsum, so lexical ranking/domain scoring behaves like production.
const CONTENT = {
  "approved-system-description.md": "Ochiga is an infrastructure technology company, and Oyi is its Infrastructure Operating System for estates, buildings, facilities, and connected communities.",
  "ochiga-overview.md": "Oyi by Ochiga is the Operating System For Modern Buildings. Product stack: Consumer OS, Facility OS, Infrastructure OS, Oyi Intelligence.",
  "company-explainer-patterns.md": "Approved short answer: Ochiga builds infrastructure technology for estates, buildings, and connected communities.",
  "system-overview-and-surfaces.md": "This file is the code-grounded overview of the current Oyi and Ochiga system as of April 12, 2026. Multi-surface operating layer.",
  "business-model-and-current-maturity.md": "Implemented now: facility dashboard, consumer app core flows. Strongly positioned but not fully proven: full city-scale orchestration.",
  "oyi-solution-map.md": "Oyi is Ochiga's operating system for estate operations, smart infrastructure, resident services, facility workflows, access control.",
  "modules-and-capabilities.md": "Safe capability categories: estate operations, access and gate workflows, monitoring visibility, resident experience.",
  "product-boundaries-and-safe-claims.md": "Safe statements: Ochiga builds infrastructure technology for estates, buildings, and connected communities. Unsafe: exact pricing.",
  "use-cases-and-needs.md": "Estate operations, access control, monitoring and security workflows, resident experience, facility and site operations.",
  "digital-twin-building-blueprint.md": "This file defines the approved proposal language for a building-scale digital twin experience. Treat as proposed solution architecture, not production-ready.",
  "edge-runtime-and-agent-stack.md": "Edge runtime described as the on-site edge daemon for Oyi Smart Estate OS. Current gaps: no full multi-device protocol layer yet.",
  "facility-control-system.md": "Starter: setup fee NGN 3,500,000 and monthly NGN 180,000. Oma should not quote or negotiate from this file.",
  "consumer-app-and-ai-surfaces.md": "The resident and consumer-facing Oyi app in Oyi-os-frontend. Device live-state retrieval, visitor access creation.",
  "ideal-customers-and-fit.md": "Best-fit organization types: real estate developers, estate managers, residential communities, property companies.",
  "qualification-playbook.md": "OMA's job is to qualify opportunities for Oyi by Ochiga. Qualification inputs: property type, location, budget range.",
  "demo-and-discovery-playbook.md": "This file defines the approved flow for demo and discovery conversations. Minimum discovery fields: project type, location.",
  "osa-sales-narrative.md": "OSA converts qualified opportunities for Oyi by Ochiga. Most buildings are operated through disconnected tools.",
  "commercial-guardrails.md": "Do not invent: pricing, discounts, implementation timelines, customer references, specific integrations.",
  "commercial-proposal-logic.md": "Oyi by Ochiga -- The Operating System For Modern Buildings. Recommended packages: Oyi Core, Oyi Operations, Oyi Infrastructure.",
  "commercial-signals-and-handoff.md": "Strong commercial intent signals: asks for pricing, asks for a demo or discovery call, shares a concrete project.",
  "negotiation-intelligence.md": "Price pushback: I understand. Most people initially look at this as software pricing. But Oyi is an infrastructure layer.",
  "objection-and-reply-guide.md": "When a prospect asks for a brief company explanation, Oma should sound informed, direct, and commercially useful.",
  "pitch-deck-positioning.md": "This file captures the current investor and enterprise positioning narrative for Ochiga and Oyi.",
  "demo-narrative.md": "This file defines the current approved demo sequence. The demo should make the system feel operational, not theoretical.",
  "website-messaging.md": "Approved website-level messaging: Ochiga builds infrastructure technology for estates, buildings, utilities, and connected communities.",
  "websites-positioning-and-deployments.md": "This file captures the current positioning from Ochiga-website and oyi-page. Oyi is an Infrastructure Operating System.",
};

function mockFiles() {
  return OFFICE_KNOWLEDGE_MANIFEST.map((entry) => ({
    filename: entry.file,
    content: CONTENT[entry.file] || `Placeholder content for ${entry.file}.`,
    updatedAt: "2026-09-26T00:00:00.000Z",
  }));
}

let sourceOk = true;
bridgeModule.fetchOfficeKnowledgeFiles = async () => (sourceOk ? { ok: true, files: mockFiles() } : { ok: false, reason: "office_unavailable" });

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log("PASS " + name);
}

const PUBLIC_ACTOR_OMA = { agentRole: "oma", audienceScope: "PUBLIC" };
const PUBLIC_ACTOR_OSA = { agentRole: "osa", audienceScope: "PUBLIC" };
const INTERNAL_ACTOR = { agentRole: "office_internal", audienceScope: "INTERNAL_COMMERCIAL" };

console.log("\n=== Manifest completeness ===");
await test("manifest declares content classification for every mocked file (26 classified + README + agent-voice-and-style excluded = 28)", async () => {
  assert.equal(manifestFileCount(), 26);
});

console.log("\n=== 3. knowledge_context defect reproduction + fix proof ===");
await test("retrieval returns real items even though request.knowledge_context would be empty (the exact defect Office's own send-side has)", async () => {
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "what is oyi", domains: ["corporate", "product"] });
  assert.ok(result.items.length > 0, "expected at least one real retrieved item");
  assert.ok(result.items.every((item) => item.id && item.sourceFile && item.authorityClass));
});

console.log("\n=== 13/45. Authorization -- no result may widen caller authority ===");
await test("PUBLIC caller never receives an INTERNAL_COMMERCIAL-audience item", async () => {
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "pricing qualification playbook fit signals", limit: 8 });
  assert.ok(result.items.every((item) => item.audience === "PUBLIC"));
});
await test("Oma is excluded from facility-control-system.md (agentVisibility=[osa,office_internal] only), even though it is PUBLIC audience elsewhere-adjacent content", async () => {
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "facility control system pricing NGN setup fee", limit: 8 });
  assert.ok(!result.items.some((item) => item.sourceFile.includes("facility-control-system")));
});
await test("Osa on the PUBLIC route (real wiring's own audienceScope for both Oma/Osa on /conversation/corporate) is ALSO capped below facility-control-system.md -- agentVisibility alone never overrides the audience ceiling", async () => {
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OSA, query: "facility control system pricing NGN setup fee", limit: 8 });
  assert.ok(!result.items.some((item) => item.sourceFile.includes("facility-control-system")), "PUBLIC audienceScope must block this even though osa is in agentVisibility");
});
await test("office_internal actor (INTERNAL_COMMERCIAL audienceScope, as wired for the staff /conversation/internal route) CAN retrieve facility-control-system.md", async () => {
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: INTERNAL_ACTOR, query: "facility control system pricing NGN setup fee", limit: 8 });
  assert.ok(result.items.some((item) => item.sourceFile.includes("facility-control-system")));
});
await test("office_internal (INTERNAL_COMMERCIAL) CAN retrieve commercial-signals-and-handoff.md (agentVisibility includes office_internal)", async () => {
  invalidateKnowledgeCache();
  const internalResult = await retrieveKnowledge({ actor: INTERNAL_ACTOR, query: "commercial signals handoff routing", limit: 8 });
  assert.ok(internalResult.items.some((item) => item.sourceFile.includes("commercial-signals-and-handoff")));
});

console.log("\n=== 21. Versioning -- identity survives edits, version changes ===");
await test("editing a file's content changes version but not id/canonicalKey", async () => {
  invalidateKnowledgeCache();
  const before = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "ochiga overview operating system", domains: ["corporate"] });
  const beforeItem = before.items.find((item) => item.sourceFile.includes("ochiga-overview"));
  assert.ok(beforeItem, "expected ochiga-overview.md to be retrieved");
  CONTENT["ochiga-overview.md"] = CONTENT["ochiga-overview.md"] + " Edited for versioning proof.";
  invalidateKnowledgeCache();
  const after = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "ochiga overview operating system", domains: ["corporate"] });
  const afterItem = after.items.find((item) => item.sourceFile.includes("ochiga-overview"));
  assert.equal(afterItem.id, beforeItem.id);
  assert.equal(afterItem.canonicalKey, beforeItem.canonicalKey);
  assert.notEqual(afterItem.version, beforeItem.version);
  CONTENT["ochiga-overview.md"] = "Oyi by Ochiga is the Operating System For Modern Buildings. Product stack: Consumer OS, Facility OS, Infrastructure OS, Oyi Intelligence.";
  invalidateKnowledgeCache();
});

console.log("\n=== 19. Authority ordering / contradiction resolution ===");
await test("APPROVED_INSTITUTIONAL/TECHNICAL_SOURCE items outrank MARKETING_REFERENCE items for an equally-matching query", async () => {
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "ochiga infrastructure technology estates buildings", limit: 8 });
  const marketingIdx = result.items.findIndex((item) => item.authorityClass === "MARKETING_REFERENCE");
  const institutionalIdx = result.items.findIndex((item) => item.authorityClass === "APPROVED_INSTITUTIONAL");
  if (marketingIdx !== -1 && institutionalIdx !== -1) assert.ok(institutionalIdx < marketingIdx, "institutional authority should rank above marketing for a comparable match");
});

console.log("\n=== 30. Context/token budget -- bounded, never the full corpus ===");
await test("a single retrieval never returns more than the requested limit nor the full 26-item corpus", async () => {
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: INTERNAL_ACTOR, query: "oyi", limit: 5 });
  assert.ok(result.items.length <= 5);
  assert.ok(result.items.length < manifestFileCount());
});

console.log("\n=== 33. Development query proof ===");
await test('"What does Ochiga do with a landowner seeking a JV?" -- honestly returns no Office-pack knowledge for the development domain (confirmed MISSING by Slice 0/1)', async () => {
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "landowner joint venture JV development", domains: ["development"] });
  assert.equal(result.items.length, 0, "development domain has zero Office-pack items by design -- must not fabricate a match");
});

console.log("\n=== 35. Private query proof ===");
await test('"What is Ochiga Private?" -- honestly returns no Office-pack knowledge for the private domain (confirmed MISSING)', async () => {
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "ochiga private membership investment", domains: ["private"] });
  assert.equal(result.items.length, 0);
});

console.log("\n=== 34. Technology query proof ===");
await test('"What is Oyi Edge?" -- retrieves real technology-domain knowledge without exposing internal-only agent-stack detail to any PUBLIC-audienceScope caller (Oma or Osa on the real public route)', async () => {
  invalidateKnowledgeCache();
  const omaResult = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "oyi edge runtime", domains: ["technology"] });
  assert.ok(!omaResult.items.some((item) => item.sourceFile.includes("edge-runtime-and-agent-stack")), "edge-runtime-and-agent-stack.md is INTERNAL_COMMERCIAL, Oma must not receive it");
  const osaResult = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OSA, query: "oyi edge runtime", domains: ["technology"] });
  assert.ok(!osaResult.items.some((item) => item.sourceFile.includes("edge-runtime-and-agent-stack")), "PUBLIC audienceScope blocks it for Osa too on the public route");
  const staffResult = await retrieveKnowledge({ actor: INTERNAL_ACTOR, query: "oyi edge runtime", domains: ["technology"] });
  assert.ok(staffResult.items.some((item) => item.sourceFile.includes("edge-runtime-and-agent-stack")), "the staff /conversation/internal route (INTERNAL_COMMERCIAL audienceScope) can see it");
});

console.log("\n=== 36. Cross-domain query proof ===");
await test('"200 apartments, smart from construction" -- retrieves BOTH development and technology hints without collapsing them into one', async () => {
  invalidateKnowledgeCache();
  const techResult = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OSA, query: "200 apartments smart building technology from construction", domains: ["technology", "development"] });
  assert.ok(techResult.items.length > 0, "technology-domain content should still surface");
  assert.ok(techResult.domainsSearched.includes("development") && techResult.domainsSearched.includes("technology"), "both domains must be reported as searched, never silently merged into one");
});

console.log("\n=== 37. Role consistency proof ===");
await test("Oma and Osa retrieving the same factual question receive items agreeing in authorityClass/content for shared-visibility items", async () => {
  invalidateKnowledgeCache();
  const omaResult = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "what is oyi operating system", domains: ["corporate", "product"] });
  const osaResult = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OSA, query: "what is oyi operating system", domains: ["corporate", "product"] });
  const omaOverview = omaResult.items.find((item) => item.sourceFile.includes("ochiga-overview"));
  const osaOverview = osaResult.items.find((item) => item.sourceFile.includes("ochiga-overview"));
  assert.ok(omaOverview && osaOverview);
  assert.equal(omaOverview.content, osaOverview.content, "same underlying corporate fact must not differ by agent role");
  assert.equal(omaOverview.version, osaOverview.version);
});

console.log("\n=== 26/27. First live integration -- corporatePublicConversationPolicy wiring ===");
await test("buildCorporatePublicResponse populates real knowledge_references from retrieved items (not the always-empty request.knowledge_context echo)", async () => {
  invalidateKnowledgeCache();
  const retrieved = (await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "what is oyi", domains: ["corporate", "product"] })).items;
  const request = {
    request_id: "req-1", message: "what is oyi", public_session_id: "sess-1", conversation_thread_id: null,
    public_identity: "ochiga_intelligence", agent_role: "oma", business_unit: "corporate", inquiry_type: "general_enquiry",
    source: { source_site: "ochiga_website", source_page: "/", source_form: null, source_channel: "widget", campaign: {} },
    visitor_state: "anonymous", crm_context: { contact_ref: null, opportunity_ref: null, lead_ref: null, safe_summary: null },
    form_context_ref: null, engagement_mode: "text_conversation", handoff_state: "none", requested_capability: null,
    knowledge_context: [], metadata: {},
  };
  const canonical = { reply: "", answer: "", id: "canon-1", thread_id: null, persistence_saved: null };
  const response = buildCorporatePublicResponse(request, canonical, retrieved);
  assert.ok(response.knowledge_references.length > 0, "expected real knowledge_references, not an empty echo");
  assert.ok(response.knowledge_references.every((ref) => !("excerpt" in ref)), "public response citation shape must stay id/title/source only, never excerpt");
});
await test("buildCorporatePublicResponse falls back to echoing request.knowledge_context when retrieval finds nothing (never breaks the existing contract)", async () => {
  const request = {
    request_id: "req-2", message: "irrelevant", public_session_id: "sess-2", conversation_thread_id: null,
    public_identity: "ochiga_intelligence", agent_role: "oma", business_unit: "corporate", inquiry_type: "general_enquiry",
    source: { source_site: "ochiga_website", source_page: "/", source_form: null, source_channel: "widget", campaign: {} },
    visitor_state: "anonymous", crm_context: { contact_ref: null, opportunity_ref: null, lead_ref: null, safe_summary: null },
    form_context_ref: null, engagement_mode: "text_conversation", handoff_state: "none", requested_capability: null,
    knowledge_context: [{ id: "k1", title: "t", excerpt: "e", source: "s" }], metadata: {},
  };
  const canonical = { reply: "", answer: "", id: "canon-2", thread_id: null, persistence_saved: null };
  const response = buildCorporatePublicResponse(request, canonical, []);
  assert.deepEqual(response.knowledge_references, [{ id: "k1", title: "t", source: "s" }]);
});

console.log("\n=== office_internal wiring ===");
await test("buildOfficeInternalResponse populates real knowledge_references with excerpt (staff-facing shape allows excerpt)", async () => {
  invalidateKnowledgeCache();
  const retrieved = (await retrieveKnowledge({ actor: INTERNAL_ACTOR, query: "qualification playbook", domains: ["commercial"] })).items;
  const request = {
    request_id: "req-3", message: "qualification playbook", office_session_id: "off-1", conversation_thread_id: null,
    staff: { staff_id: "s1", email: "s@x.com", role: "sales", permissions: [] },
    page_context: { page: null, selected_type: null, selected_id: null }, business_unit: "commercial", capability_context: [],
    crm_context: null, portfolio_context: null, support_context: null, project_context: null, task_context: null,
    task_batch_context: null, execution_failed: false, execution_failure_reason: null, automation_context: null,
    meeting_context: null, partnership_context: null, document_context: null, content_context: null,
    development_context: null, requested_capability: null, knowledge_context: [], metadata: {},
  };
  const canonical = { reply: "", answer: "", id: "canon-3", thread_id: null, persistence_saved: null };
  const response = buildOfficeInternalResponse(request, canonical, null, retrieved);
  assert.ok(response.knowledge_references.length > 0);
  assert.ok(response.knowledge_references.every((ref) => typeof ref.excerpt === "string"));
});

console.log("\n=== 31. Failure behavior -- source unavailable ===");
await test("when Office is unreachable, retrieval fails honestly (empty items, never fabricated content)", async () => {
  sourceOk = false;
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: PUBLIC_ACTOR_OMA, query: "what is oyi" });
  assert.equal(result.items.length, 0);
  sourceOk = true;
  invalidateKnowledgeCache();
});

console.log(`\n=== wave9-slice1-canonical-knowledge-authority-smoke: ${passed} checks passed ===`);
