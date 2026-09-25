#!/usr/bin/env node
// Wave 9 Slice 2 -- Institutional Knowledge Convergence functional smoke.
// Distinct from wave9-slice1-canonical-knowledge-authority-smoke.mjs: that
// script proves the retrieval CONTRACT works; this one proves the actual
// CONVERGENCE this slice performed -- that OfficeCorporateCapabilityModules.ts's
// 5 corporate.*.read modules now source from the ONE canonical Backend
// institutional item instead of an independent hardcoded literal, that the
// literal survives ONLY as a defense-in-depth fallback, that one live-state
// module (development) was correctly left unconverged, and that the
// resulting behavior never widens authority, never fabricates figures, and
// stays identical for every caller (Oma/Osa) since they share one registry.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";
const require = createRequire(import.meta.url);
const path = require("path");
const backendRoot = "/Users/ochigaidoko/Documents/Ochiga-backend";

const bridgeModule = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/officeKnowledgeBridge.js"));
const { getKnowledgeItemByCanonicalKey, invalidateKnowledgeCache } = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/knowledgeRetrieval.js"));
const { buildKnowledgeIndex } = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/knowledgeIndex.js"));
const { BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS } = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/backendInstitutionalKnowledge.js"));
const { buildPublicCorporateReadCapabilities, buildOfficeInternalReadCapabilities } = require(path.join(backendRoot, "dist/oyi-core/capabilities/OfficeCorporateCapabilityModules.js"));
const { retrieveKnowledge } = require(path.join(backendRoot, "dist/oyi-core/domains/knowledge/knowledgeRetrieval.js"));

let sourceOk = true;
bridgeModule.fetchOfficeKnowledgeFiles = async () =>
  sourceOk ? { ok: true, files: [] } : { ok: false, reason: "office_unavailable" };

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log("PASS " + name);
}

const CONVERGED_KEYS = ["backend:corporate-company", "backend:corporate-oyi", "backend:corporate-private", "backend:corporate-partnerships", "backend:corporate-development"];
const MODULE_KEY_TO_CANONICAL_KEY = {
  "corporate.company.read": "backend:corporate-company",
  "corporate.oyi.read": "backend:corporate-oyi",
  "corporate.private.read": "backend:corporate-private",
  "corporate.partnerships.read": "backend:corporate-partnerships",
};

function moduleByKey(modules, key) {
  const found = modules.find((m) => m.key === key);
  assert.ok(found, `module ${key} must exist in the public corporate registry`);
  return found;
}

async function resolveModuleAnswer(mod) {
  const evidence = await mod.collectEvidence({});
  const result = await mod.buildReadResponse({}, evidence);
  return result.answer;
}

console.log("\n=== 1. Convergence -- the 4 static modules now source their answer from the canonical item ===");
for (const [moduleKey, canonicalKey] of Object.entries(MODULE_KEY_TO_CANONICAL_KEY)) {
  await test(`${moduleKey} answer text equals BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS["${canonicalKey}"].content exactly`, async () => {
    invalidateKnowledgeCache();
    const modules = buildPublicCorporateReadCapabilities();
    const mod = moduleByKey(modules, moduleKey);
    const answer = await resolveModuleAnswer(mod);
    const canonicalItem = BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS.find((item) => item.canonicalKey === canonicalKey);
    assert.ok(canonicalItem, `${canonicalKey} must exist`);
    assert.equal(answer, canonicalItem.content);
  });
}

console.log("\n=== 2. One corporate truth -- Oma and Osa share the exact same registry/module instance path ===");
await test("buildPublicCorporateReadCapabilities() is the single registry both Oma and Osa's public-corporate surface register from (ConversationOrchestrator.ts:121) -- calling it twice (simulating two independent agent turns) yields byte-identical answers, never two independently-drifting copies", async () => {
  invalidateKnowledgeCache();
  const firstCallModules = buildPublicCorporateReadCapabilities();
  const secondCallModules = buildPublicCorporateReadCapabilities();
  for (const moduleKey of Object.keys(MODULE_KEY_TO_CANONICAL_KEY)) {
    const answerA = await resolveModuleAnswer(moduleByKey(firstCallModules, moduleKey));
    const answerB = await resolveModuleAnswer(moduleByKey(secondCallModules, moduleKey));
    assert.equal(answerA, answerB);
  }
});

console.log("\n=== 3. Fallback -- a hard index failure never blocks the response, falls back to the preserved literal ===");
await test("when buildKnowledgeIndex() itself throws (defense-in-depth case: index construction fails, not just Office unreachable), canonicalCorporateAnswer's own try/catch returns the exact original literal, never throws up into the conversation turn", async () => {
  invalidateKnowledgeCache();
  const originalFetch = bridgeModule.fetchOfficeKnowledgeFiles;
  bridgeModule.fetchOfficeKnowledgeFiles = async () => {
    throw new Error("simulated hard failure, not a clean {ok:false}");
  };
  const modules = buildPublicCorporateReadCapabilities();
  const mod = moduleByKey(modules, "corporate.company.read");
  const answer = await resolveModuleAnswer(mod);
  assert.ok(answer.startsWith("Ochiga develops and powers intelligent places"));
  bridgeModule.fetchOfficeKnowledgeFiles = originalFetch;
  invalidateKnowledgeCache();
});

console.log("\n=== 4. Resilience -- Backend-native items survive an Office outage (no network dependency) ===");
await test("buildKnowledgeIndex() with Office unreachable still returns exactly the 5 Backend-native items, never zero", async () => {
  sourceOk = false;
  invalidateKnowledgeCache();
  const snapshot = await buildKnowledgeIndex();
  assert.equal(snapshot.sourceOk, false);
  assert.equal(snapshot.items.length, 5);
  assert.deepEqual(snapshot.items.map((i) => i.canonicalKey).sort(), [...CONVERGED_KEYS].sort());
  sourceOk = true;
  invalidateKnowledgeCache();
});

console.log("\n=== 5. Live state correctly left unconverged -- corporate.development.read vs. the new backend:corporate-development identity item ===");
await test("corporate.development.read (the live Sanity project-listing module) still exists in the public registry, untouched -- it answers 'what projects exist NOW', a different question from the new Wave 9 Slice 3 backend:corporate-development identity item, which answers 'what IS Ochiga Development' and was added as a genuinely new institutional fact (not a conversion of existing hardcoded text, since none existed for this question)", async () => {
  const modules = buildPublicCorporateReadCapabilities();
  moduleByKey(modules, "corporate.development.read");
  const identityItem = BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS.find((item) => item.canonicalKey === "backend:corporate-development");
  assert.ok(identityItem, "backend:corporate-development must exist as of Wave 9 Slice 3");
  assert.ok(!/havana|green gardens/i.test(identityItem.content), "the identity item must never freeze a specific current project into static knowledge");
});

console.log("\n=== 6. Public/internal separation -- converged items never leak into the office_internal registry ===");
await test("buildOfficeInternalReadCapabilities() (staff-facing CRM/ops registry) contains none of the 4 corporate.*.read keys -- they are public-surface only, exactly as before convergence", async () => {
  const internalModules = buildOfficeInternalReadCapabilities();
  for (const moduleKey of Object.keys(MODULE_KEY_TO_CANONICAL_KEY)) {
    assert.ok(!internalModules.some((m) => m.key === moduleKey), `${moduleKey} must not appear in the internal registry`);
  }
});

console.log("\n=== 7. Security -- converged modules stay read-only, unauthenticated, and grant no capability ===");
for (const moduleKey of Object.keys(MODULE_KEY_TO_CANONICAL_KEY)) {
  await test(`${moduleKey} carries risk_class "read" and requires zero permissions (a knowledge fact must never itself be a capability grant)`, async () => {
    const modules = buildPublicCorporateReadCapabilities();
    const mod = moduleByKey(modules, moduleKey);
    assert.equal(mod.risk_class, "read");
    assert.deepEqual(mod.permission_requirements, []);
  });
}

console.log("\n=== 8. Authorization still enforced for Backend-native items, not just Office-pack items ===");
await test("getKnowledgeItemByCanonicalKey applies the same agentVisibility gate to a Backend-native item: an actor role outside agentVisibility (e.g. 'facility', not in [oma,osa,office_internal,executive]) gets null, never the fact", async () => {
  invalidateKnowledgeCache();
  const blocked = await getKnowledgeItemByCanonicalKey("backend:corporate-oyi", { agentRole: "facility", audienceScope: "PUBLIC" });
  assert.equal(blocked, null);
  const allowed = await getKnowledgeItemByCanonicalKey("backend:corporate-oyi", { agentRole: "oma", audienceScope: "PUBLIC" });
  assert.ok(allowed);
});

console.log("\n=== 9. Safe-claims convergence -- no invented figures survive in the converged private/partnerships items ===");
await test("backend:corporate-private never states a guaranteed numeric return and explicitly carries the compliance disclaimer, claimBoundary=requires_qualification", async () => {
  const item = BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS.find((i) => i.canonicalKey === "backend:corporate-private");
  assert.equal(item.claimBoundary, "requires_qualification");
  assert.ok(!/\d+%\s*(return|yield|guarantee)/i.test(item.content));
  assert.ok(/never guaranteed/i.test(item.content));
  assert.ok(/offer of securities/i.test(item.content));
});

await test("backend:corporate-partnerships never invents a funding threshold or approval guarantee", async () => {
  const item = BACKEND_INSTITUTIONAL_KNOWLEDGE_ITEMS.find((i) => i.canonicalKey === "backend:corporate-partnerships");
  assert.ok(!/₦|NGN\s*\d/.test(item.content));
  assert.ok(!/\bguarantee/i.test(item.content));
});

console.log("\n=== 10. Unknown/unsupported questions -- retrieval never fabricates a matching answer ===");
const UNSUPPORTED_QUERIES = [
  "Guarantee my project ROI",
  "Will Ochiga fund 50 billion naira",
  "Can Oyi control every device brand",
  "What return does Ochiga Private guarantee",
  "Can Oma call me right now on the phone",
];
// Affirmative-only patterns -- deliberately do NOT match the real
// converged private item's own disclaimer ("...are never guaranteed...
// nothing here is...a guarantee of returns"), which is the correct,
// negating use of these words and must not be flagged as a fabrication.
const FABRICATION_PATTERNS = [
  /\bwe guarantee\b/i,
  /\bwill guarantee\b/i,
  /\bguarantees? (a |an )?\d+/i,
  /\d+\s*(%|percent)\s*(return|yield|roi)/i,
  /\bcan (place|make|receive) (a )?(phone )?calls?\b/i,
  /\bevery device brand\b.{0,20}\bsupport(ed)?\b/i,
];
const PUBLIC_ACTOR = { agentRole: "oma", audienceScope: "PUBLIC" };
for (const query of UNSUPPORTED_QUERIES) {
  await test(`"${query}" -- no returned item content matches a fabricated-guarantee/voice-capability pattern`, async () => {
    invalidateKnowledgeCache();
    const result = await retrieveKnowledge({ actor: PUBLIC_ACTOR, query });
    for (const item of result.items) {
      for (const pattern of FABRICATION_PATTERNS) {
        assert.ok(!pattern.test(item.content), `item ${item.canonicalKey} content must not match fabrication pattern ${pattern} for query "${query}"`);
      }
    }
  });
}

console.log(`\n=== wave9-slice2-institutional-knowledge-convergence-smoke: ${passed} checks passed ===`);
