import assert from "node:assert/strict";
import { createRequire } from "node:module";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
const require = createRequire(import.meta.url);
const bridge = require("../dist/oyi-core/domains/knowledge/officeKnowledgeBridge.js");
bridge.fetchOfficeKnowledgeFiles = async () => ({ ok: false, reason: "isolated_test" });
const { getKnowledgeItemByCanonicalKey, retrieveKnowledge } = require("../dist/oyi-core/domains/knowledge/knowledgeRetrieval.js");
for (const agentRole of ["oma", "osa", "office_internal", "executive", "facility", "consumer"]) {
  const actor = { agentRole, audienceScope: "PUBLIC" };
  const item = await getKnowledgeItemByCanonicalKey("backend:product-oyi-architecture", actor);
  assert.ok(item);
  assert.equal(item.sourceRepo, "ochiga-backend");
  assert.equal(item.claimBoundary, "requires_qualification");
  assert.match(item.content, /simulation is not proof/);
  assert.match(item.content, /delegating its Oyi conversations to Core/);
  const result = await retrieveKnowledge({ actor, domains: ["product"], query: "Oyi architecture" });
  assert.equal(result.items[0].canonicalKey, item.canonicalKey);
}
console.log("PASS product architecture: six governed audiences, provenance, qualified claims, Office outage");
const { OFFICE_KNOWLEDGE_MANIFEST } = require("../dist/oyi-core/domains/knowledge/officeKnowledgeManifest.js");
const maturity = OFFICE_KNOWLEDGE_MANIFEST.find(item => item.file === "business-model-and-current-maturity.md");
assert.equal(maturity.authorityClass, "UNVERIFIED_REFERENCE");
assert.equal(maturity.claimBoundary, "requires_human_confirmation");
assert.equal(maturity.audience, "INTERNAL_COMMERCIAL");
assert.equal(OFFICE_KNOWLEDGE_MANIFEST.find(item => item.file === "pitch-deck-positioning.md").authorityClass, "MARKETING_REFERENCE");
console.log("PASS inferred maturity prose cannot rank as technical implementation authority; pitch narrative remains marketing");
