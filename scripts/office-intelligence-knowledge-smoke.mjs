// Intelligence System Visibility, Slice 5 -- Governed Knowledge
// Visibility. Same two-part convention as Slices 1-4's own smokes:
// static guards over the route source, then a real live HTTP
// integration test against the isolated Wave 11 fixture.
//
// Governance correction: Intelligence reads knowledge under the canonical
// Office staff knowledge authority (OFFICE_INTERNAL_KNOWLEDGE_ACTOR) through
// the canonical audienceAllowed/agentAllowed gate. The Office export key
// authenticates the bridge only; it grants no knowledge authority. Part 3
// holds the adversarial tests for exactly that.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import express from "express";

// ---------------------------------------------------------------------
// Part 1 -- static guards over the route source + the underlying
// knowledge retrieval module.
// ---------------------------------------------------------------------
const routeSrc = fs.readFileSync("src/routes/officeExport.ts", "utf8");
const retrievalSrc = fs.readFileSync("src/oyi-core/domains/knowledge/knowledgeRetrieval.ts", "utf8");
const contractsSrc = fs.readFileSync("src/oyi-core/domains/knowledge/knowledgeContracts.ts", "utf8");

function stripLineComments(src) {
  return src.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}
function between(src, from, to) {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `missing ${from}`);
  const end = to ? src.indexOf(to, start + from.length) : src.length;
  return src.slice(start, end < 0 ? src.length : end);
}

for (const path of ['"/intelligence/knowledge"', '"/intelligence/knowledge/:key"']) {
  const re = new RegExp(`router\\.get\\(${path},\\s*requireOfficeExportKey`);
  assert.match(routeSrc, re, `route ${path} must reuse the existing Office export auth boundary`);
}

// One canonical Office knowledge authority, shared with the existing
// Office-internal conversation route -- never restated per caller.
assert.match(contractsSrc, /export const OFFICE_INTERNAL_KNOWLEDGE_ACTOR[^=]*= Object\.freeze\(\{\s*agentRole: "office_internal",\s*audienceScope: "INTERNAL_COMMERCIAL",\s*\}\)/, "Office staff knowledge authority must be office_internal / INTERNAL_COMMERCIAL, declared once");
assert.match(routeSrc, /const KNOWLEDGE_VIEWER_ACTOR = OFFICE_INTERNAL_KNOWLEDGE_ACTOR;/, "Intelligence viewer must use the canonical Office staff knowledge authority");
assert.match(routeSrc, /actor: OFFICE_INTERNAL_KNOWLEDGE_ACTOR,\s*\n\s*domains: knowledgeDomainsForBusinessUnit/, "the Office-internal conversation route must share the same declared actor");
assert.doesNotMatch(stripLineComments(routeSrc), /agentRole: "office_internal", audienceScope:/, "no route may restate an ad-hoc office_internal actor literal");

// No ungated enumeration/lookup remains anywhere.
assert.doesNotMatch(retrievalSrc, /getKnowledgeItemForInspection|export async function listKnowledgeItems\(/, "the pre-correction ungated inspection functions must be gone");
const routeCode = stripLineComments(between(routeSrc, "const KNOWLEDGE_VIEWER_ACTOR", "export default router;"));
for (const m of routeCode.matchAll(/listKnowledgeItemsForActor\(([^,)]+)/g)) assert.equal(m[1].trim(), "KNOWLEDGE_VIEWER_ACTOR", "every enumeration must run as the viewer actor");
for (const m of routeCode.matchAll(/getKnowledgeItemByCanonicalKey\([^,]+,\s*([^)]+)\)/g)) assert.equal(m[1].trim(), "KNOWLEDGE_VIEWER_ACTOR", "detail must run as the viewer actor");
assert.match(routeCode, /summarizeKnowledgeCorpusGovernance\(KNOWLEDGE_VIEWER_ACTOR\)/);
assert.doesNotMatch(routeCode, /req\.(query|headers|body)[^\n]*(agent_?[Rr]ole|audience_?[Ss]cope|actor)/, "no request field may influence the knowledge actor");

// The enumeration gate is the canonical one, applied BEFORE any filter.
const listFnBody = stripLineComments(between(retrievalSrc, "export async function listKnowledgeItemsForActor(", "export type KnowledgeCorpusGovernanceSummary"));
assert.match(listFnBody, /\.filter\(\(item\) => knowledgeItemVisibleTo\(item, actor\)\)\s*\n\s*\.filter\(/, "canonical visibility gate must run first, filters only narrow afterwards");
assert.match(stripLineComments(retrievalSrc), /export function knowledgeItemVisibleTo\([^)]*\): boolean \{\s*return audienceAllowed\(item\.audience, actor\.audienceScope\) && agentAllowed\(item, actor\.agentRole\);\s*\}/, "visibility predicate must be exactly the two canonical gates");

// Live conversational retrieval stays byte-for-byte on its own gate.
assert.match(retrievalSrc, /function audienceAllowed/);
assert.match(retrievalSrc, /function agentAllowed/);
assert.match(retrievalSrc, /audienceAllowed\(item\.audience, request\.actor\.audienceScope\) &&\s*\n\s*agentAllowed\(item, request\.actor\.agentRole\) &&/, "retrieveKnowledge must keep its own per-actor gate");
const liveLookupBody = between(retrievalSrc, "export async function getKnowledgeItemByCanonicalKey(");
assert.match(liveLookupBody, /if \(!audienceAllowed\(item\.audience, actor\.audienceScope\) \|\| !agentAllowed\(item, actor\.agentRole\)\) return null;/, "live exact-key lookup must keep its per-actor gate");

// Corpus aggregates never carry item-identifying or subject-matter fields.
const aggregateFnBody = stripLineComments(between(retrievalSrc, "export async function summarizeKnowledgeCorpusGovernance(", "// Wave 9 Slice 2"));
assert.doesNotMatch(aggregateFnBody, /\.title|\.canonicalKey|\.content|\.tags|\.domain\b|\.id\b/, "corpus aggregates must count governance labels only");

// Redaction guards over the projection function bodies.
const listProjectionBody = stripLineComments(between(routeSrc, "function safeKnowledgeListProjection", "function safeKnowledgeDetailProjection"));
for (const dangerous of ["sourceFile", "/Users/", "process.env"]) {
  assert.doesNotMatch(listProjectionBody, new RegExp(dangerous.replace(/[/.]/g, "\\$&")), `knowledge LIST projection must never forward raw "${dangerous}"`);
}
assert.doesNotMatch(listProjectionBody, /\bcontent\b/, "knowledge LIST projection must never include full content");
const detailProjectionBody = stripLineComments(between(routeSrc, "function safeKnowledgeDetailProjection", "function inspectableKnowledgeSummary"));
assert.doesNotMatch(detailProjectionBody, /sourceFile/, "knowledge DETAIL projection must never forward a raw source path");
assert.match(detailProjectionBody, /content: withheld \? null : item\.content/, "withheld claim boundaries must null the statement at the source");
assert.match(routeSrc, /const KNOWLEDGE_WITHHELD_CLAIM_BOUNDARIES = new Set\(\["do_not_state_verbatim"\]\);/);
console.log("PASS static guards: auth reuse, one canonical Office knowledge actor, no ungated enumeration/lookup, gate-before-filter, live retrieval gates untouched, aggregate/list/detail redaction");

// ---------------------------------------------------------------------
// Part 1b -- vocabulary recomputation: assert the CURRENT real
// vocabulary counts/order, never hardcoded from an earlier phase.
// ---------------------------------------------------------------------
assert.match(contractsSrc, /"APPROVED_INSTITUTIONAL",\s*\n\s*"TECHNICAL_SOURCE",\s*\n\s*"APPROVED_COMMERCIAL",\s*\n\s*"PRODUCT_SOURCE",\s*\n\s*"PROJECT_SOURCE",\s*\n\s*"MARKETING_REFERENCE",\s*\n\s*"UNVERIFIED_REFERENCE",/, "authority class order must be the current real 7-class order");
assert.match(contractsSrc, /export type KnowledgeFreshnessClass = "evergreen" \| "volatile";/, "freshness vocabulary must be the current real 2-class set");
assert.match(contractsSrc, /export type KnowledgeAgentRole = "oma" \| "osa" \| "office_internal" \| "executive" \| "facility" \| "consumer";/, "agent role vocabulary must be the current real 6-role set");
assert.match(contractsSrc, /export type KnowledgeAudience = "PUBLIC" \| "INTERNAL_COMMERCIAL" \| "INTERNAL_ONLY";/);
console.log("PASS vocabulary recomputation: 7 authority classes (ranked), 2 freshness classes, 6 agent roles, 3 audiences -- all read live from contracts, not assumed");

// ---------------------------------------------------------------------
// Part 2 -- live HTTP integration test against the compiled route,
// isolated Wave 11 fixture only.
// ---------------------------------------------------------------------
const FIXTURE_URL = "http://127.0.0.1:55421";
if (!process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required for this local Supabase smoke test");
}
process.env.SUPABASE_URL = FIXTURE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.OFFICE_SYNC_API_KEY = "wave11-intelligence-slice5-smoke-test-key";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// A local stub stands in for Office's knowledge-pack endpoint so this
// smoke never reaches the real (production-default) Office host.
// Governance of each file comes from the real officeKnowledgeManifest:
//   inspectable by office_internal / INTERNAL_COMMERCIAL:
//     ochiga-overview (PUBLIC, safe_to_state)
//     business-model-and-current-maturity (INTERNAL_COMMERCIAL, requires_human_confirmation)
//     commercial-signals-and-handoff (INTERNAL_COMMERCIAL, do_not_state_verbatim -> statement withheld)
//   NOT inspectable (no office_internal in agentVisibility):
//     commercial-guardrails (Oma/Osa only, do_not_state_verbatim)
//     company-explainer-patterns (PUBLIC, Oma/Osa only)
//     osa-sales-narrative (PUBLIC, Osa only)
//   plus one manifest-excluded and one unclassified file.
// Protected files carry sentinels that must never reach any Intelligence response.
let officeStubDown = false;
const SENTINEL = {
  guardrails: "SENTINEL-OMA-OSA-ONLY-GUARDRAILS-7f3a",
  explainer: "SENTINEL-PUBLIC-OMA-OSA-EXPLAINER-2b91",
  osaNarrative: "SENTINEL-OSA-ONLY-NARRATIVE-c4d8",
  signals: "SENTINEL-DNSV-OFFICE-SIGNALS-91e0",
};
const STUB_FILES = [
  { filename: "ochiga-overview.md", content: "Ochiga overview (stub fixture content).", updated_at: "2026-09-01T00:00:00Z" },
  { filename: "business-model-and-current-maturity.md", content: "Business model (stub fixture content).", updated_at: "2026-09-03T00:00:00Z" },
  { filename: "commercial-signals-and-handoff.md", content: `Commercial signals handoff ${SENTINEL.signals}.`, updated_at: "2026-09-04T00:00:00Z" },
  { filename: "commercial-guardrails.md", content: `Commercial guardrails pricing discounts ${SENTINEL.guardrails}.`, updated_at: "2026-09-02T00:00:00Z" },
  { filename: "company-explainer-patterns.md", content: `Company explainer patterns ${SENTINEL.explainer}.`, updated_at: "2026-09-05T00:00:00Z" },
  { filename: "osa-sales-narrative.md", content: `Osa sales narrative ${SENTINEL.osaNarrative}.`, updated_at: "2026-09-06T00:00:00Z" },
  { filename: "README.md", content: "Excluded readme.", updated_at: null },
  { filename: "not-in-manifest.md", content: "Unclassified file.", updated_at: null },
];
const officeStub = http.createServer((req, res) => {
  if (officeStubDown) { res.writeHead(503); return res.end(); }
  if (req.url !== "/api/lead-agents/admin/knowledge-pack" || req.headers["x-office-api-key"] !== "wave11-intelligence-slice5-smoke-test-key") { res.writeHead(401); return res.end(); }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ files: STUB_FILES }));
});
officeStub.listen(0, "127.0.0.1");
await new Promise((resolve) => officeStub.once("listening", resolve));
process.env.OFFICE_APP_URL = `http://127.0.0.1:${officeStub.address().port}`;

const require = createRequire(import.meta.url);
const queueModule = require.resolve("bullmq");
require.cache[queueModule] = { id: queueModule, filename: queueModule, loaded: true, exports: { Queue: class {}, Worker: class {} } };
const redisModule = require.resolve("ioredis");
class NoNetworkRedis { on() { return this; } quit() { return Promise.resolve(); } disconnect() {} }
NoNetworkRedis.default = NoNetworkRedis;
NoNetworkRedis.Redis = NoNetworkRedis;
require.cache[redisModule] = { id: redisModule, filename: redisModule, loaded: true, exports: NoNetworkRedis };

const officeExportModule = require("../dist/routes/officeExport.js");
const knowledgeRetrieval = require("../dist/oyi-core/domains/knowledge/knowledgeRetrieval.js");
const { OFFICE_INTERNAL_KNOWLEDGE_ACTOR } = require("../dist/oyi-core/domains/knowledge/knowledgeContracts.js");
const app = express();
app.use(express.json());
app.use("/office", officeExportModule.default);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;

function request(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, raw: body, json: body ? JSON.parse(body) : null });
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", reject);
  });
}
const AUTH = { "x-api-key": "wave11-intelligence-slice5-smoke-test-key" };
const detailPath = (key) => `/office/intelligence/knowledge/${encodeURIComponent(key)}`;
const allResponses = []; // every Intelligence response body, scanned for sentinels at the end
async function intel(path, headers = AUTH) {
  const r = await request(path, headers);
  allResponses.push({ path, raw: r.raw });
  return r;
}

const AUTHORITY_ORDER = ["APPROVED_INSTITUTIONAL", "TECHNICAL_SOURCE", "APPROVED_COMMERCIAL", "PRODUCT_SOURCE", "PROJECT_SOURCE", "MARKETING_REFERENCE", "UNVERIFIED_REFERENCE"];
const DOMAINS = ["corporate", "commercial", "product", "technology", "website", "development", "private", "partnerships"];
const AUDIENCES = ["PUBLIC", "INTERNAL_COMMERCIAL", "INTERNAL_ONLY"];
const CLAIM_BOUNDARIES = ["safe_to_state", "requires_qualification", "requires_human_confirmation", "do_not_state_verbatim"];
const FRESHNESS = ["evergreen", "volatile"];
const EXPECTED_INSPECTABLE_OFFICE = ["office:business-model-and-current-maturity", "office:commercial-signals-and-handoff", "office:ochiga-overview"];
const EXPECTED_HIDDEN_OFFICE = ["office:commercial-guardrails", "office:company-explainer-patterns", "office:osa-sales-narrative"];

try {
  // --- auth gate ---
  for (const path of ["/office/intelligence/knowledge", detailPath("office:ochiga-overview")]) {
    const noAuth = await request(path);
    assert.equal(noAuth.status, 401, `${path} must reject a request with no credential`);
  }

  // --- browse contract ---
  const browse = await intel("/office/intelligence/knowledge?page_size=50");
  assert.equal(browse.status, 200);
  assert.equal(browse.json.ok, true);
  assert.ok(Array.isArray(browse.json.items), "items must be a real array");
  assert.ok(browse.json.summary && typeof browse.json.summary.total === "number", "summary must be present and computed");
  assert.ok(browse.json.pagination && typeof browse.json.pagination.page === "number");
  assert.equal(browse.json.source.available, true, "with the local Office stub reachable, the Office pack source must report available");
  assert.deepEqual(browse.json.authority_class_order, AUTHORITY_ORDER, "authority order in the response must match the live canonical rank order");
  assert.deepEqual(browse.json.viewer_authority, { agent_role: "office_internal", audience_ceiling: "INTERNAL_COMMERCIAL" }, "response must disclose the authority it was evaluated under");
  console.log(`PASS browse contract: ${browse.json.items.length} inspectable items (page 1 of ${browse.json.pagination.total_pages}), viewer=office_internal/INTERNAL_COMMERCIAL, source.available=true`);

  for (const item of browse.json.items) {
    assert.ok(DOMAINS.includes(item.domain), `domain "${item.domain}" must be a real KnowledgeDomain`);
    assert.ok(AUTHORITY_ORDER.includes(item.authority_class), `authority_class "${item.authority_class}" must be real`);
    assert.ok(AUDIENCES.includes(item.audience), `audience "${item.audience}" must be real`);
    assert.ok(CLAIM_BOUNDARIES.includes(item.claim_boundary), `claim_boundary "${item.claim_boundary}" must be real`);
    assert.ok(FRESHNESS.includes(item.freshness_class), `freshness_class "${item.freshness_class}" must be real`);
    assert.ok(Array.isArray(item.worker_visibility));
    assert.ok(!("content" in item), "list item must never include full content");
  }
  console.log("PASS per-item vocabulary: domain/authority/audience/claim_boundary/freshness all real canonical values, no content in list");

  // --- both real sources merged; manifest gate + canonical authority gate honored ---
  const keys = browse.json.items.map((i) => i.canonical_key);
  const officeKeys = keys.filter((k) => k.startsWith("office:")).sort();
  const backendKeys = keys.filter((k) => k.startsWith("backend:"));
  assert.deepEqual(officeKeys, EXPECTED_INSPECTABLE_OFFICE, "exactly the office_internal-visible Office files must be inspectable");
  assert.equal(backendKeys.length, 6, "all 6 Backend institutional items are office_internal-visible and must be inspectable");
  assert.ok(!keys.includes("office:README") && !keys.includes("office:not-in-manifest"), "excluded/unclassified Office files must never become items");
  console.log(`PASS source merge under canonical authority: ${officeKeys.length} Office + ${backendKeys.length} Backend inspectable; excluded/unclassified absent`);

  // --- summary/KPI sanity (inspectable set only) ---
  const summary = browse.json.summary;
  assert.equal(summary.total, keys.length, "inspectable summary total must equal the inspectable item count");
  assert.equal(Object.values(summary.by_domain).reduce((a, b) => a + b, 0), summary.total, "by_domain counts must sum to total");
  assert.equal(Object.values(summary.by_authority_class).reduce((a, b) => a + b, 0), summary.total, "by_authority_class counts must sum to total");
  assert.equal(summary.potentially_stale, summary.by_freshness_class.volatile || 0, "potentially_stale must map directly to the real volatile freshness count");
  assert.ok(summary.workers_covered <= 4, "workers_covered must only count the 4 real worker roles");
  console.log(`PASS summary/KPI (inspectable only): total=${summary.total}, domains summed, authority summed, potentially_stale=${summary.potentially_stale}, workers_covered=${summary.workers_covered}`);

  // --- domain + authority filters ---
  const domainFiltered = await intel("/office/intelligence/knowledge?domain=corporate");
  assert.equal(domainFiltered.status, 200);
  for (const item of domainFiltered.json.items) assert.equal(item.domain, "corporate");
  const authorityFiltered = await intel("/office/intelligence/knowledge?authority_class=APPROVED_INSTITUTIONAL");
  assert.equal(authorityFiltered.status, 200);
  for (const item of authorityFiltered.json.items) assert.equal(item.authority_class, "APPROVED_INSTITUTIONAL");
  console.log(`PASS domain/authority filters: domain=corporate -> ${domainFiltered.json.pagination.total}, authority_class=APPROVED_INSTITUTIONAL -> ${authorityFiltered.json.pagination.total}`);

  // --- unknown-worker-filter ---
  const unknownWorker = await intel("/office/intelligence/knowledge?worker=not_a_real_role");
  assert.equal(unknownWorker.status, 200, "an unrecognized worker filter must not 500");
  assert.equal(unknownWorker.json.pagination.total, 0);
  console.log("PASS unknown-worker-filter: returns 200 with zero honest matches, not an error");

  // --- pagination ---
  const paged = await intel("/office/intelligence/knowledge?page=1&page_size=2");
  assert.equal(paged.status, 200);
  assert.ok(paged.json.items.length <= 2, "page_size must be honored");
  console.log(`PASS pagination: page_size=2 -> ${paged.json.items.length} items returned`);

  // --- claim-boundary visibility ---
  const claimFiltered = await intel("/office/intelligence/knowledge?claim_boundary=do_not_state_verbatim");
  assert.equal(claimFiltered.status, 200);
  assert.deepEqual(claimFiltered.json.items.map((i) => i.canonical_key), ["office:commercial-signals-and-handoff"], "only the Office-inspectable do_not_state_verbatim item may be listed");
  for (const item of claimFiltered.json.items) assert.ok(item.claim_boundary_explanation, "claim boundary must carry a real presentation explanation");
  console.log(`PASS claim-boundary visibility: do_not_state_verbatim -> ${claimFiltered.json.pagination.total} inspectable item, explanation present`);

  // --- detail contract (normal inspectable knowledge still works) ---
  const overviewDetail = await intel(detailPath("office:ochiga-overview"));
  assert.equal(overviewDetail.status, 200);
  assert.equal(overviewDetail.json.item.content, "Ochiga overview (stub fixture content).");
  assert.equal(overviewDetail.json.item.content_withheld, false);
  const businessDetail = await intel(detailPath("office:business-model-and-current-maturity"));
  assert.equal(businessDetail.status, 200, "INTERNAL_COMMERCIAL office_internal-visible item must be inspectable");
  assert.equal(businessDetail.json.item.claim_boundary, "requires_human_confirmation");
  assert.ok(businessDetail.json.item.content.includes("Business model"), "requires_human_confirmation statements are shown to the Office human they route to");
  const backendDetail = await intel(detailPath("backend:corporate-development"));
  assert.equal(backendDetail.status, 200);
  assert.ok(backendDetail.json.item.content.length > 0);
  console.log("PASS normal inspectable knowledge: PUBLIC and INTERNAL_COMMERCIAL office_internal-visible items resolve with their statements");

  // --- safe source labels ---
  assert.equal(overviewDetail.json.item.safe_source_identifier, "ochiga-overview.md");
  assert.equal(backendDetail.json.item.safe_source_identifier, "backendInstitutionalKnowledge.ts", "annotated source paths must reduce to the leading file only");
  for (const d of [overviewDetail, businessDetail, backendDetail]) {
    assert.ok(!d.json.item.safe_source_identifier.startsWith("/") && !d.json.item.safe_source_identifier.includes("src/"));
  }
  console.log("PASS safe source labels: Office -> ochiga-overview.md, annotated Backend path -> backendInstitutionalKnowledge.ts");

  // --- claim boundary: do_not_state_verbatim is classified, never printed ---
  const signalsDetail = await intel(detailPath("office:commercial-signals-and-handoff"));
  assert.equal(signalsDetail.status, 200);
  assert.equal(signalsDetail.json.item.claim_boundary, "do_not_state_verbatim");
  assert.equal(signalsDetail.json.item.content, null, "do_not_state_verbatim statement must be withheld, not printed beside a warning");
  assert.equal(signalsDetail.json.item.content_withheld, true);
  assert.ok(signalsDetail.json.item.content_withheld_reason);
  assert.ok(!signalsDetail.raw.includes(SENTINEL.signals), "withheld statement text must not appear anywhere in the detail payload");
  console.log("PASS claim boundary: do_not_state_verbatim item shows classification + reason, statement text withheld (content=null)");

  // --- safe-not-found ---
  const missingKey = await intel(detailPath("not-a-real-canonical-key"));
  assert.equal(missingKey.status, 404, "an unknown canonical key must 404");
  console.log("PASS safe-not-found: unknown canonical_key -> 404");

  // --- privacy/redaction ---
  for (const r of [browse, overviewDetail, businessDetail, backendDetail, signalsDetail]) {
    for (const dangerous of ["/Users/", "SUPABASE", "SERVICE_ROLE", "system_prompt", "OFFICE_SYNC_API_KEY", "whatsapp_phone", "src/oyi-core"]) {
      assert.ok(!r.raw.includes(dangerous), `response must never leak "${dangerous}"`);
    }
  }
  console.log("PASS privacy/redaction: no credential/path/PII leakage across browse and detail");

  // --- performance ---
  assert.ok(browse.json.performance && typeof browse.json.performance.total_response_time_ms === "number");
  console.log(`PASS performance: browse total_response_time_ms=${browse.json.performance.total_response_time_ms}`);

  // -------------------------------------------------------------------
  // Part 3 -- governance correction: adversarial/regression tests.
  // -------------------------------------------------------------------

  // (1) Office export key alone cannot widen knowledge authority: the
  // route's inspectable set is EXACTLY what the canonical gate yields for
  // the Office staff actor over the same live index -- no more.
  const canonical = await knowledgeRetrieval.listKnowledgeItemsForActor(OFFICE_INTERNAL_KNOWLEDGE_ACTOR, {});
  assert.deepEqual(keys.slice().sort(), canonical.items.map((i) => i.canonicalKey).sort(), "route enumeration must equal the canonical Office actor's visible set");
  for (const k of EXPECTED_HIDDEN_OFFICE) assert.ok(!keys.includes(k), `${k} is not office_internal-visible and must not be enumerated with the export key`);
  assert.ok(browse.json.corpus.not_inspectable >= EXPECTED_HIDDEN_OFFICE.length, "hidden items must exist in the corpus -- the gate is actually excluding something");
  console.log(`PASS export key cannot widen authority: route set == canonical office_internal set (${keys.length}); ${browse.json.corpus.not_inspectable} corpus item(s) excluded`);

  // (2) Public/Osa-only/Oma-Osa-only knowledge cannot be disclosed via
  // any Intelligence path -- list, every filter, every worker, pages.
  const filterSweep = [
    "", "?worker=oma", "?worker=osa", "?worker=facility", "?worker=consumer", "?worker=oma&worker=osa",
    "?audience=PUBLIC", "?audience=INTERNAL_COMMERCIAL", "?audience=INTERNAL_ONLY", "?domain=commercial", "?domain=corporate",
    "?claim_boundary=do_not_state_verbatim", "?claim_boundary=safe_to_state", "?authority_class=APPROVED_COMMERCIAL",
    "?freshness=evergreen", "?page=2&page_size=1",
  ];
  for (const q of filterSweep) {
    const r = await intel(`/office/intelligence/knowledge${q}${q ? "&" : "?"}page_size=50`);
    assert.equal(r.status, 200);
    for (const item of r.json.items) {
      assert.ok(canonical.items.some((c) => c.canonicalKey === item.canonical_key), `${q}: ${item.canonical_key} is outside the Office actor's authority`);
    }
  }
  console.log(`PASS non-Office-inspectable knowledge not enumerable: ${filterSweep.length} filter/worker/audience/page combinations all stay within the canonical Office set`);

  // (3) Worker filter cannot impersonate another worker.
  const osaFiltered = await intel("/office/intelligence/knowledge?worker=osa&page_size=50");
  const osaKeys = osaFiltered.json.items.map((i) => i.canonical_key);
  const expectedOsa = canonical.items.filter((i) => i.agentVisibility.includes("osa")).map((i) => i.canonicalKey).sort();
  assert.deepEqual(osaKeys.slice().sort(), expectedOsa, "worker=osa must narrow the Office-visible set, never switch to Osa's own visible set");
  assert.ok(!osaKeys.includes("office:osa-sales-narrative"), "an Osa-only item must not surface because Osa was selected");
  const osaActual = (await knowledgeRetrieval.listKnowledgeItemsForActor({ agentRole: "osa", audienceScope: "INTERNAL_COMMERCIAL" }, {})).items.length;
  assert.ok(osaActual > osaKeys.length, "Osa's own authority genuinely sees more -- proving the filter did not assume it");
  const spoofed = await intel("/office/intelligence/knowledge?worker=osa&agent_role=osa&agentRole=osa&audience_scope=INTERNAL_ONLY&audienceScope=INTERNAL_ONLY&actor=osa&page_size=50", { ...AUTH, "x-agent-role": "osa", "x-audience-scope": "INTERNAL_ONLY" });
  assert.deepEqual(spoofed.json.items.map((i) => i.canonical_key).sort(), osaKeys.slice().sort(), "actor-like query params/headers must be ignored");
  assert.deepEqual(spoofed.json.viewer_authority, browse.json.viewer_authority);
  const facilityFiltered = await intel("/office/intelligence/knowledge?worker=facility&page_size=50");
  for (const item of facilityFiltered.json.items) assert.ok(item.worker_visibility.includes("Facility") && canonical.items.some((c) => c.canonicalKey === item.canonical_key));
  console.log(`PASS worker filter cannot impersonate: worker=osa -> ${osaKeys.length} (Office-visible ∩ Osa) vs Osa's own ${osaActual}; spoofed actor params/headers ignored; worker=facility -> ${facilityFiltered.json.pagination.total}`);

  // (4) Inaccessible detail fails closed, indistinguishable from nonexistent.
  const nonexistent = await intel(detailPath("office:definitely-not-a-real-item"));
  for (const k of EXPECTED_HIDDEN_OFFICE) {
    const r = await intel(detailPath(k));
    assert.equal(r.status, 404, `${k} must fail closed`);
    assert.deepEqual(r.json, nonexistent.json, `${k}: forbidden and nonexistent must be indistinguishable`);
  }
  const spoofedDetail = await intel(`${detailPath("office:commercial-guardrails")}?agent_role=oma&audience_scope=INTERNAL_ONLY`, { ...AUTH, "x-agent-role": "oma" });
  assert.equal(spoofedDetail.status, 404, "actor-like params must not unlock detail");
  console.log(`PASS inaccessible detail fails closed: ${EXPECTED_HIDDEN_OFFICE.length} hidden keys -> 404 with body identical to a nonexistent key; spoofed params still 404`);

  // (5) Safe aggregates remain available.
  const corpus = browse.json.corpus;
  assert.deepEqual(Object.keys(corpus).sort(), ["by_audience", "by_authority_class", "by_claim_boundary", "by_freshness_class", "by_source_family", "by_worker_visibility", "inspectable", "not_inspectable", "total"], "corpus aggregates must be exactly the approved governance dimensions (no domain, no items)");
  assert.equal(corpus.total, 12, "corpus = 6 classified Office files + 6 Backend items");
  assert.equal(corpus.inspectable, keys.length);
  assert.equal(corpus.not_inspectable, 3);
  for (const dim of ["by_audience", "by_authority_class", "by_claim_boundary", "by_freshness_class", "by_source_family"]) {
    assert.equal(Object.values(corpus[dim]).reduce((a, b) => a + b, 0), corpus.total, `${dim} must sum to corpus total`);
  }
  assert.deepEqual(corpus.by_source_family, { "Office Knowledge Pack": 6, "Backend Institutional Knowledge": 6 });
  assert.deepEqual(corpus.by_worker_visibility, { Oma: 10, Osa: 12, Facility: 1, Consumer: 1 });
  assert.equal(corpus.by_claim_boundary.do_not_state_verbatim, 2, "both dnsv items are counted, including the hidden one");
  const corpusRaw = JSON.stringify(corpus);
  for (const k of EXPECTED_HIDDEN_OFFICE) assert.ok(!corpusRaw.includes(k));
  console.log(`PASS safe aggregates: corpus total=${corpus.total}, inspectable=${corpus.inspectable}, not_inspectable=${corpus.not_inspectable}, workers=${JSON.stringify(corpus.by_worker_visibility)}, no domain/titles/keys`);

  // (6) Canonical predicate covers the audience ceiling (no INTERNAL_ONLY
  // item exists in today's real manifest, so exercised directly).
  const synthetic = (audience, agentVisibility) => ({ audience, agentVisibility });
  assert.equal(knowledgeRetrieval.knowledgeItemVisibleTo(synthetic("INTERNAL_ONLY", ["office_internal"]), OFFICE_INTERNAL_KNOWLEDGE_ACTOR), false, "INTERNAL_ONLY exceeds the Office staff ceiling");
  assert.equal(knowledgeRetrieval.knowledgeItemVisibleTo(synthetic("INTERNAL_COMMERCIAL", ["office_internal"]), OFFICE_INTERNAL_KNOWLEDGE_ACTOR), true);
  assert.equal(knowledgeRetrieval.knowledgeItemVisibleTo(synthetic("PUBLIC", ["oma", "osa"]), OFFICE_INTERNAL_KNOWLEDGE_ACTOR), false, "PUBLIC audience alone does not make an item Office-inspectable");
  console.log("PASS canonical predicate: INTERNAL_ONLY denied, PUBLIC-but-not-office_internal denied, INTERNAL_COMMERCIAL office_internal allowed");

  // (7) Live conversational retrieval behavior is unchanged: each agent
  // still retrieves under its OWN authority, including items Intelligence hides.
  const omaResult = await knowledgeRetrieval.retrieveKnowledge({ actor: { agentRole: "oma", audienceScope: "INTERNAL_COMMERCIAL" }, domains: ["commercial"], query: "commercial guardrails pricing discounts" });
  assert.ok(omaResult.items.some((i) => i.canonicalKey === "office:commercial-guardrails"), "Oma's live retrieval must still reach its own Oma/Osa-only item");
  const osaResult = await knowledgeRetrieval.retrieveKnowledge({ actor: { agentRole: "osa", audienceScope: "PUBLIC" }, domains: ["commercial"], query: "osa sales narrative" });
  assert.ok(osaResult.items.some((i) => i.canonicalKey === "office:osa-sales-narrative"), "Osa's live retrieval must still reach its Osa-only item");
  const officeResult = await knowledgeRetrieval.retrieveKnowledge({ actor: OFFICE_INTERNAL_KNOWLEDGE_ACTOR, domains: ["commercial"], query: "commercial guardrails pricing discounts" });
  assert.ok(!officeResult.items.some((i) => EXPECTED_HIDDEN_OFFICE.includes(i.canonicalKey)), "Office-internal conversation retrieval is unchanged -- still cannot see Oma/Osa-only items");
  assert.ok(await knowledgeRetrieval.getKnowledgeItemByCanonicalKey("office:commercial-guardrails", { agentRole: "oma", audienceScope: "INTERNAL_COMMERCIAL" }), "live exact-key lookup still serves Oma");
  assert.equal(await knowledgeRetrieval.getKnowledgeItemByCanonicalKey("office:commercial-guardrails", OFFICE_INTERNAL_KNOWLEDGE_ACTOR), null);
  assert.equal(await knowledgeRetrieval.getKnowledgeItemByCanonicalKey("office:company-explainer-patterns", { agentRole: "oma", audienceScope: "PUBLIC" }).then((i) => i && i.canonicalKey), "office:company-explainer-patterns");
  console.log("PASS live retrieval unchanged: Oma/Osa still retrieve their own items; Office-internal conversation retrieval still excludes them; exact-key lookup per actor unchanged");

  // (8) Whole-run sentinel scan: no protected statement ever reached any
  // Intelligence response body, across every request above.
  for (const r of allResponses) {
    for (const [name, sentinel] of Object.entries(SENTINEL)) assert.ok(!r.raw.includes(sentinel), `${r.path} leaked the ${name} statement`);
    for (const k of EXPECTED_HIDDEN_OFFICE) assert.ok(!r.raw.includes(`"${k}"`), `${r.path} leaked hidden key ${k}`);
  }
  console.log(`PASS sentinel scan: ${allResponses.length} Intelligence responses, zero protected statements or hidden keys`);

  // --- honest degradation: Office pack unavailable ---
  officeStubDown = true;
  knowledgeRetrieval.invalidateKnowledgeCache();
  const degraded = await intel("/office/intelligence/knowledge");
  assert.equal(degraded.status, 200, "Office pack outage must degrade, not 500");
  assert.equal(degraded.json.source.available, false);
  assert.equal(degraded.json.source.reason, "office_unavailable");
  assert.ok(degraded.json.items.length > 0 && degraded.json.items.every((i) => i.canonical_key.startsWith("backend:")), "Backend items must still be listed during an Office outage");
  assert.equal(degraded.json.corpus.total, 6);
  console.log(`PASS honest degradation: Office down -> source.available=false (office_unavailable), ${degraded.json.pagination.total} Backend items still listed`);
} finally {
  server.close();
  officeStub.close();
}
