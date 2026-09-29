#!/usr/bin/env node
// Wave 9 Slice 3 -- Knowledge Source Convergence & Agent Adoption Audit
// functional smoke. Proves the ONE code change this slice made (retiring
// corporatePublicConversationPolicy.ts's latent Ochiga/Oyi identity
// fallback onto canonical knowledge) is safe, and that the deliberately
// UNCONVERGED branches (development/private/partnerships routing,
// commercial-signal text, default fallback) are byte-identical to their
// pre-slice literals -- proving the audit's own finding that those are
// conversational routing acknowledgments, not competing factual claims,
// was correctly acted on (converge only what needed converging).
// Also proves the new backend:corporate-development identity item and
// the corrected backend:corporate-partnerships wording.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = require("node:url").fileURLToPath(new URL("../", import.meta.url));

const bridgeModule = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/officeKnowledgeBridge.js"));
const { invalidateKnowledgeCache, retrieveKnowledge, getKnowledgeItemByCanonicalKey } = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/knowledgeRetrieval.js"));
const { BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS } = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/backendInstitutionalKnowledge.js"));
const { buildCorporatePublicResponse } = require(path.join(backendRoot, "dist/oyi-core/policy/corporatePublicConversationPolicy.js"));

let sourceOk = true;
bridgeModule.fetchOfficeKnowledgeFiles = async () => (sourceOk ? { ok: true, files: [] } : { ok: false, reason: "office_unavailable" });

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log("PASS " + name);
}

function baseRequest(overrides) {
  return {
    request_id: "req-1",
    message: "",
    public_session_id: "sess-1",
    conversation_thread_id: null,
    public_identity: "ochiga_intelligence",
    agent_role: "oma",
    business_unit: "corporate",
    inquiry_type: "general_enquiry",
    source: { source_site: "ochiga_website", source_page: "/", source_form: null, source_channel: "widget", campaign: {} },
    visitor_state: "anonymous",
    crm_context: { contact_ref: null, opportunity_ref: null, lead_ref: null, safe_summary: null },
    form_context_ref: null,
    engagement_mode: "text_conversation",
    handoff_state: "none",
    requested_capability: null,
    knowledge_context: [],
    metadata: {},
    ...overrides,
  };
}

const EMPTY_CANONICAL = { reply: "", answer: "", id: "canon-empty", thread_id: null, persistence_saved: null };

console.log("\n=== 1. Retired: Ochiga/Oyi identity fallback now resolves canonical knowledge ===");
await test('"what is ochiga" (canonical.reply empty, capability pipeline missed) resolves to backend:corporate-company content, not the old hardcoded literal', async () => {
  invalidateKnowledgeCache();
  const request = baseRequest({ message: "what is ochiga" });
  const response = await buildCorporatePublicResponse(request, EMPTY_CANONICAL);
  const canonicalItem = BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS.find((i) => i.canonicalKey === "backend:corporate-company");
  assert.ok(response.answer.startsWith(canonicalItem.content), "canonical knowledge must remain the factual answer");
  assert.match(response.answer, /Are you exploring Oyi for an existing property, a development, or a partnership\?/, "an educational answer may make one non-operational continuation");
});

await test('"what is oyi" resolves to backend:corporate-oyi content, not the old hardcoded literal', async () => {
  invalidateKnowledgeCache();
  const request = baseRequest({ message: "what is oyi" });
  const response = await buildCorporatePublicResponse(request, EMPTY_CANONICAL);
  const canonicalItem = BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS.find((i) => i.canonicalKey === "backend:corporate-oyi");
  assert.ok(response.answer.startsWith(canonicalItem.content), "canonical knowledge must remain the factual answer");
  assert.match(response.answer, /Are you exploring Oyi for an existing property, a development, or a partnership\?/);
});

console.log("\n=== 2. Fallback -- index failure never blocks the response ===");
await test("when the knowledge index throws, the Ochiga/Oyi branches fall back to the original preserved literal, never throw up into the conversation turn", async () => {
  invalidateKnowledgeCache();
  const originalFetch = bridgeModule.fetchOfficeKnowledgeFiles;
  bridgeModule.fetchOfficeKnowledgeFiles = async () => {
    throw new Error("simulated hard failure");
  };
  const request = baseRequest({ message: "what does ochiga do" });
  const response = await buildCorporatePublicResponse(request, EMPTY_CANONICAL);
  assert.ok(response.answer.startsWith("Ochiga develops and powers intelligent places."));
  bridgeModule.fetchOfficeKnowledgeFiles = originalFetch;
  invalidateKnowledgeCache();
});

console.log("\n=== 3. Deliberately NOT converged -- routing/process branches stay byte-identical (audit found these are not factual claims) ===");
await test('business_unit "development" routing text is unchanged (conversational acknowledgment, not a competing factual claim -- correctly left alone)', async () => {
  invalidateKnowledgeCache();
  const request = baseRequest({ message: "we have land for a JV", business_unit: "development" });
  const response = await buildCorporatePublicResponse(request, EMPTY_CANONICAL);
  assert.equal(
    response.answer,
    "That sounds like a Development or land/JV conversation. I can capture the site context, ownership position, location and intended partnership path so Office can review the opportunity properly."
  );
});

await test('business_unit "private" routing text is unchanged', async () => {
  invalidateKnowledgeCache();
  const request = baseRequest({ message: "tell me about membership review", business_unit: "private" });
  const response = await buildCorporatePublicResponse(request, EMPTY_CANONICAL);
  assert.equal(
    response.answer,
    "Ochiga Private is handled by request and review. I can keep your membership interest connected to this session and route it for Office review without making any approval promises."
  );
});

await test('business_unit "partnerships" routing text is unchanged', async () => {
  invalidateKnowledgeCache();
  const request = baseRequest({ message: "interested in a partnership", business_unit: "partnerships" });
  const response = await buildCorporatePublicResponse(request, EMPTY_CANONICAL);
  assert.equal(
    response.answer,
    "That looks like a partnership enquiry. I can route it by partner type, such as landowner/JV, capital, buyer/offtake, professional delivery, technology integrator, or strategic relationship."
  );
});

await test("commercial-signal qualification/proposal text is unchanged", async () => {
  invalidateKnowledgeCache();
  const request = baseRequest({ message: "we manage six buildings and want a proposal" });
  const response = await buildCorporatePublicResponse(request, EMPTY_CANONICAL);
  assert.equal(
    response.answer,
    "This now sounds commercially specific. I can keep the same conversation context and move it into the Sales qualification path so the Office team has the project facts, source and next action together."
  );
});

await test("default fallback text is unchanged", async () => {
  invalidateKnowledgeCache();
  const request = baseRequest({ message: "random unrelated chatter" });
  const response = await buildCorporatePublicResponse(request, EMPTY_CANONICAL);
  assert.equal(response.answer, "I can help with Ochiga, Oyi, Development, Private membership and partnership enquiries, then route the right next step through Ochiga Office.");
});

console.log("\n=== 4. New backend:corporate-development identity item -- reachable via the real production domain routing ===");
await test('a "development" business_unit query (matching officeExport.ts\'s own knowledgeDomainsForBusinessUnit mapping to domains:["development"]) retrieves the new identity item', async () => {
  invalidateKnowledgeCache();
  const result = await retrieveKnowledge({ actor: { agentRole: "oma", audienceScope: "PUBLIC" }, query: "what is ochiga development", domains: ["development"] });
  assert.ok(result.items.some((item) => item.canonicalKey === "backend:corporate-development"));
});

await test("backend:corporate-development never freezes a specific current project (Havana, Green Gardens) into static institutional knowledge", async () => {
  const item = await getKnowledgeItemByCanonicalKey("backend:corporate-development", { agentRole: "oma", audienceScope: "PUBLIC" });
  assert.ok(item);
  assert.ok(!/havana|green gardens/i.test(item.content));
  assert.ok(/current development projects.*live information/i.test(item.content));
});

console.log("\n=== 5. Partnerships terminology correction -- resolved, not just renamed ===");
await test("backend:corporate-partnerships now names all 3 real sub-categories the website's 2026-08-11 rebuild introduced, not the single stale label", async () => {
  const item = await getKnowledgeItemByCanonicalKey("backend:corporate-partnerships", { agentRole: "oma", audienceScope: "PUBLIC" });
  assert.ok(item);
  assert.ok(/Delivery Professionals/.test(item.content));
  assert.ok(/Technology\/Oyi Integrators/.test(item.content));
  assert.ok(/Strategic Partners/.test(item.content));
});

console.log(`\n=== wave9-slice3-knowledge-source-convergence-smoke: ${passed} checks passed ===`);
