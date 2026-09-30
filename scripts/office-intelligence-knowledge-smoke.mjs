// Intelligence System Visibility, Slice 5 -- Governed Knowledge
// Visibility. Same two-part convention as Slices 1-4's own smokes:
// static guards over the route source, then a real live HTTP
// integration test against the isolated Wave 11 fixture.
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

for (const path of ['"/intelligence/knowledge"', '"/intelligence/knowledge/:key"']) {
  const re = new RegExp(`router\\.get\\(${path},\\s*requireOfficeExportKey`);
  assert.match(routeSrc, re, `route ${path} must reuse the existing Office export auth boundary`);
}

assert.match(routeSrc, /await listKnowledgeItems\(/, "knowledge browse must reuse the canonical listKnowledgeItems, not a second store");
assert.match(routeSrc, /await getKnowledgeItemForInspection\(/, "knowledge detail must reuse the canonical getKnowledgeItemForInspection, not a second store");
assert.doesNotMatch(routeSrc, /new\s+Map\(\[.*canonicalKey.*content/s, "must not construct a parallel in-memory knowledge store");

// retrieveKnowledge()/getKnowledgeItemByCanonicalKey() -- the real
// per-actor-gated live retrieval path -- must remain byte-for-byte
// untouched: audienceAllowed/agentAllowed still gate them, and Slice 5's
// additions must be new, separate exports, never edits to their bodies.
assert.match(retrievalSrc, /function audienceAllowed/);
assert.match(retrievalSrc, /function agentAllowed/);
assert.match(retrievalSrc, /export async function retrieveKnowledge\(/);
assert.match(retrievalSrc, /export async function getKnowledgeItemByCanonicalKey\(/);
assert.match(retrievalSrc, /export async function listKnowledgeItems\(/);
assert.match(retrievalSrc, /export async function getKnowledgeItemForInspection\(/);
const liveLookupBody = retrievalSrc.slice(retrievalSrc.indexOf("export async function getKnowledgeItemByCanonicalKey("));
assert.match(liveLookupBody, /if \(!audienceAllowed\(item\.audience, actor\.audienceScope\) \|\| !agentAllowed\(item, actor\.agentRole\)\) return null;/, "live exact-key lookup must keep its per-actor gate");

// The browse/detail functions must NOT call the actor-gating helpers --
// that is the deliberate, documented "metadata visibility != execution
// authority" design (Section 3), not an accidental omission.
const listFnBody = stripLineComments(retrievalSrc.slice(retrievalSrc.indexOf("export async function listKnowledgeItems("), retrievalSrc.indexOf("export async function getKnowledgeItemForInspection(")));
assert.doesNotMatch(listFnBody, /audienceAllowed|agentAllowed/, "listKnowledgeItems must not apply the live-retrieval actor gate");
const inspectFnBody = stripLineComments(retrievalSrc.slice(retrievalSrc.indexOf("export async function getKnowledgeItemForInspection("), retrievalSrc.indexOf("export async function getKnowledgeItemByCanonicalKey(")));
assert.doesNotMatch(inspectFnBody, /audienceAllowed|agentAllowed/, "getKnowledgeItemForInspection must not apply the live-retrieval actor gate");

// Redaction guards over the safe-projection function bodies (comments
// stripped so only real code is checked, not this file's own safety
// prose which deliberately names the excluded fields).
function stripLineComments(src) {
  return src.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}
const listProjectionBody = stripLineComments(routeSrc.slice(routeSrc.indexOf("function safeKnowledgeListProjection"), routeSrc.indexOf("function safeKnowledgeDetailProjection")));
for (const dangerous of ["sourceFile", "sourceRepo:", "/Users/", "process.env"]) {
  assert.doesNotMatch(listProjectionBody, new RegExp(dangerous.replace(/[/.]/g, "\\$&")), `knowledge LIST projection must never forward raw "${dangerous}"`);
}
assert.doesNotMatch(listProjectionBody, /\bcontent\b/, "knowledge LIST projection must never include full content (Section 4's explicit instruction)");

const detailProjectionBody = stripLineComments(routeSrc.slice(routeSrc.indexOf("function safeKnowledgeDetailProjection"), routeSrc.indexOf("function knowledgeSummaryFrom")));
for (const dangerous of ["sourceFile", "sourceRepo:"]) {
  assert.doesNotMatch(detailProjectionBody, new RegExp(dangerous), `knowledge DETAIL projection must never forward raw "${dangerous}" -- only the safe source identifier/family`);
}

assert.match(routeSrc, /safeKnowledgeSourceIdentifier/, "detail must convert provenance into a safe source label, never a raw path (Section 12)");
console.log("PASS static guards: auth reuse, no second store, live-retrieval actor gate untouched, list/detail redaction");

// ---------------------------------------------------------------------
// Part 1b -- vocabulary recomputation: assert the CURRENT real
// vocabulary counts/order, never hardcoded from an earlier phase.
// ---------------------------------------------------------------------
assert.match(contractsSrc, /"APPROVED_INSTITUTIONAL",\s*\n\s*"TECHNICAL_SOURCE",\s*\n\s*"APPROVED_COMMERCIAL",\s*\n\s*"PRODUCT_SOURCE",\s*\n\s*"PROJECT_SOURCE",\s*\n\s*"MARKETING_REFERENCE",\s*\n\s*"UNVERIFIED_REFERENCE",/, "authority class order must be the current real 7-class order");
assert.match(contractsSrc, /export type KnowledgeFreshnessClass = "evergreen" \| "volatile";/, "freshness vocabulary must be the current real 2-class set, not current/stale/expired/unknown");
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
// smoke never reaches the real (production-default) Office host. It
// serves three manifest-classified files, one manifest-excluded file and
// one unclassified file; `officeStubDown` flips it to a 503 to exercise
// the honest-degradation path.
let officeStubDown = false;
const STUB_FILES = [
  { filename: "ochiga-overview.md", content: "Ochiga overview (stub fixture content).", updated_at: "2026-09-01T00:00:00Z" },
  { filename: "commercial-guardrails.md", content: "Commercial guardrails (stub fixture content).", updated_at: "2026-09-02T00:00:00Z" },
  { filename: "business-model-and-current-maturity.md", content: "Business model (stub fixture content).", updated_at: "2026-09-03T00:00:00Z" },
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
const officeExportRouter = officeExportModule.default;
const app = express();
app.use(express.json());
app.use("/office", officeExportRouter);
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
          resolve({ status: res.statusCode, json: body ? JSON.parse(body) : null });
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", reject);
  });
}

const AUTH = { "x-api-key": "wave11-intelligence-slice5-smoke-test-key" };
const AUTHORITY_ORDER = ["APPROVED_INSTITUTIONAL", "TECHNICAL_SOURCE", "APPROVED_COMMERCIAL", "PRODUCT_SOURCE", "PROJECT_SOURCE", "MARKETING_REFERENCE", "UNVERIFIED_REFERENCE"];
const DOMAINS = ["corporate", "commercial", "product", "technology", "website", "development", "private", "partnerships"];
const AUDIENCES = ["PUBLIC", "INTERNAL_COMMERCIAL", "INTERNAL_ONLY"];
const CLAIM_BOUNDARIES = ["safe_to_state", "requires_qualification", "requires_human_confirmation", "do_not_state_verbatim"];
const FRESHNESS = ["evergreen", "volatile"];

try {
  // --- auth gate ---
  for (const path of ["/office/intelligence/knowledge", "/office/intelligence/knowledge/office%3Aochiga-overview"]) {
    const noAuth = await request(path);
    assert.equal(noAuth.status, 401, `${path} must reject a request with no credential`);
  }

  // --- browse contract ---
  const browse = await request("/office/intelligence/knowledge", AUTH);
  assert.equal(browse.status, 200);
  assert.equal(browse.json.ok, true);
  assert.ok(Array.isArray(browse.json.items), "items must be a real array");
  assert.ok(browse.json.summary && typeof browse.json.summary.total === "number", "summary must be present and computed");
  assert.ok(browse.json.pagination && typeof browse.json.pagination.page === "number");
  assert.ok(typeof browse.json.source.available === "boolean", "source health must be surfaced honestly (Office-pack fetch may or may not be reachable)");
  assert.deepEqual(browse.json.authority_class_order, AUTHORITY_ORDER, "authority order in the response must match the live canonical rank order");
  console.log(`PASS browse contract: ${browse.json.items.length} items on page 1 of ${browse.json.pagination.total} total, source.available=${browse.json.source.available}, summary.total=${browse.json.summary.total}`);

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

  // --- both real sources merged; manifest gate honored ---
  assert.equal(browse.json.source.available, true, "with the local Office stub reachable, the Office pack source must report available");
  const keys = browse.json.items.map((i) => i.canonical_key);
  for (const k of ["office:ochiga-overview", "office:commercial-guardrails", "office:business-model-and-current-maturity"]) assert.ok(keys.includes(k), `classified Office file ${k} must appear`);
  assert.ok(!keys.includes("office:README") && !keys.includes("office:not-in-manifest"), "excluded/unclassified Office files must never become items");
  assert.ok(keys.some((k) => k.startsWith("backend:")), "Backend institutional items must be merged alongside Office items");
  const officeItem = browse.json.items.find((i) => i.canonical_key === "office:commercial-guardrails");
  assert.equal(officeItem.source_family, "Office Knowledge Pack");
  assert.equal(officeItem.claim_boundary, "do_not_state_verbatim");
  console.log(`PASS source merge: ${keys.filter((k) => k.startsWith("office:")).length} Office + ${keys.filter((k) => k.startsWith("backend:")).length} Backend items, excluded/unclassified files absent`);

  // --- summary/KPI sanity (Section 9: every metric computed from real enumerable items) ---
  const summary = browse.json.summary;
  const domainSum = Object.values(summary.by_domain).reduce((a, b) => a + b, 0);
  const authoritySum = Object.values(summary.by_authority_class).reduce((a, b) => a + b, 0);
  assert.equal(domainSum, summary.total, "by_domain counts must sum to total");
  assert.equal(authoritySum, summary.total, "by_authority_class counts must sum to total");
  assert.equal(summary.potentially_stale, summary.by_freshness_class.volatile || 0, "potentially_stale must map directly to the real volatile freshness count, never date-math on updatedAt");
  assert.ok(summary.workers_covered <= 4, "workers_covered must only count the 4 real worker roles (oma/osa/facility/consumer), never office_internal/executive");
  console.log(`PASS summary/KPI: total=${summary.total}, domains summed, authority summed, potentially_stale=volatile-count(${summary.potentially_stale}), workers_covered=${summary.workers_covered}`);

  // --- worker-visibility filter: Facility/Consumer are real but narrow ---
  const facilityFiltered = await request("/office/intelligence/knowledge?worker=facility", AUTH);
  assert.equal(facilityFiltered.status, 200);
  for (const item of facilityFiltered.json.items) {
    assert.ok(item.worker_visibility.includes("Facility"), "worker=facility filter must only return items visible to Facility");
  }
  console.log(`PASS worker-visibility filter: worker=facility -> ${facilityFiltered.json.pagination.total} item(s) (expected to be narrow/honest, not padded)`);

  // --- domain + authority filters ---
  const domainFiltered = await request("/office/intelligence/knowledge?domain=corporate", AUTH);
  assert.equal(domainFiltered.status, 200);
  for (const item of domainFiltered.json.items) assert.equal(item.domain, "corporate");

  const authorityFiltered = await request("/office/intelligence/knowledge?authority_class=APPROVED_INSTITUTIONAL", AUTH);
  assert.equal(authorityFiltered.status, 200);
  for (const item of authorityFiltered.json.items) assert.equal(item.authority_class, "APPROVED_INSTITUTIONAL");
  console.log(`PASS domain/authority filters: domain=corporate -> ${domainFiltered.json.pagination.total}, authority_class=APPROVED_INSTITUTIONAL -> ${authorityFiltered.json.pagination.total}`);

  // --- unknown-worker-filter: must not error, just return an honest empty/real result ---
  const unknownWorker = await request("/office/intelligence/knowledge?worker=not_a_real_role", AUTH);
  assert.equal(unknownWorker.status, 200, "an unrecognized worker filter must not 500 -- it should just fail to match any item's real agentVisibility");
  assert.equal(unknownWorker.json.pagination.total, 0);
  console.log("PASS unknown-worker-filter: returns 200 with zero honest matches, not an error");

  // --- pagination ---
  const paged = await request("/office/intelligence/knowledge?page=1&page_size=2", AUTH);
  assert.equal(paged.status, 200);
  assert.ok(paged.json.items.length <= 2, "page_size must be honored");
  console.log(`PASS pagination: page_size=2 -> ${paged.json.items.length} items returned`);

  // --- claim-boundary visibility (Section 6) ---
  const claimFiltered = await request("/office/intelligence/knowledge?claim_boundary=do_not_state_verbatim", AUTH);
  assert.equal(claimFiltered.status, 200);
  for (const item of claimFiltered.json.items) {
    assert.equal(item.claim_boundary, "do_not_state_verbatim");
    assert.ok(typeof item.claim_boundary_explanation === "string" && item.claim_boundary_explanation.length > 0, "claim boundary must carry a real presentation explanation");
  }
  console.log(`PASS claim-boundary visibility: do_not_state_verbatim -> ${claimFiltered.json.pagination.total} item(s), explanations present`);

  // --- detail contract + safe-not-found ---
  if (browse.json.items.length) {
    const firstKey = browse.json.items[0].canonical_key;
    const detail = await request(`/office/intelligence/knowledge/${encodeURIComponent(firstKey)}`, AUTH);
    assert.equal(detail.status, 200, `detail lookup for a live canonical_key (${firstKey}) must succeed`);
    assert.equal(detail.json.item.canonical_key, firstKey);
    assert.ok(typeof detail.json.item.content === "string" && detail.json.item.content.length > 0, "detail must include the governed content/statement");
    assert.ok(typeof detail.json.item.safe_source_identifier === "string", "detail must carry a safe source identifier");
    assert.ok(!detail.json.item.safe_source_identifier.startsWith("/"), "safe source identifier must never be an absolute filesystem path");
    assert.ok(!detail.json.item.safe_source_identifier.includes("src/"), "safe source identifier must never leak an internal src/ path");
    console.log(`PASS detail contract: ${firstKey}, content present, safe_source_identifier="${detail.json.item.safe_source_identifier}"`);
  }
  const officeDetail = await request(`/office/intelligence/knowledge/${encodeURIComponent("office:commercial-guardrails")}`, AUTH);
  assert.equal(officeDetail.status, 200);
  assert.equal(officeDetail.json.item.safe_source_identifier, "commercial-guardrails.md", "Office detail source label must be the bare filename only");
  const devDetail = await request(`/office/intelligence/knowledge/${encodeURIComponent("backend:corporate-development")}`, AUTH);
  if (devDetail.status === 200) assert.equal(devDetail.json.item.safe_source_identifier, "backendInstitutionalKnowledge.ts", "annotated source paths must reduce to the leading file only");
  console.log("PASS safe source labels: Office -> commercial-guardrails.md, annotated Backend path -> backendInstitutionalKnowledge.ts");
  const missingKey = await request("/office/intelligence/knowledge/not-a-real-canonical-key", AUTH);
  assert.equal(missingKey.status, 404, "an unknown canonical key must 404 with safe not-found semantics");
  console.log("PASS safe-not-found: unknown canonical_key -> 404");

  // --- privacy/redaction (whole-payload scan across browse + detail) ---
  const rawBrowseBody = JSON.stringify(browse.json);
  for (const dangerous of ["/Users/", "SUPABASE", "SERVICE_ROLE", "system_prompt", "OFFICE_SYNC_API_KEY", "whatsapp_phone", "src/oyi-core"]) {
    assert.ok(!rawBrowseBody.includes(dangerous), `browse response must never leak "${dangerous}"`);
  }
  if (browse.json.items.length) {
    const firstKey = browse.json.items[0].canonical_key;
    const detailAgain = await request(`/office/intelligence/knowledge/${encodeURIComponent(firstKey)}`, AUTH);
    const rawDetailBody = JSON.stringify(detailAgain.json);
    for (const dangerous of ["/Users/", "SUPABASE", "SERVICE_ROLE", "system_prompt", "OFFICE_SYNC_API_KEY"]) {
      assert.ok(!rawDetailBody.includes(dangerous), `detail response must never leak "${dangerous}"`);
    }
  }
  console.log("PASS privacy/redaction: no credential/path/PII leakage across browse and detail");

  // --- performance ---
  assert.ok(browse.json.performance && typeof browse.json.performance.total_response_time_ms === "number");
  console.log(`PASS performance: browse total_response_time_ms=${browse.json.performance.total_response_time_ms}`);

  // --- honest degradation: Office pack unavailable ---
  officeStubDown = true;
  require("../dist/oyi-core/domains/knowledge/knowledgeRetrieval.js").invalidateKnowledgeCache();
  const degraded = await request("/office/intelligence/knowledge", AUTH);
  assert.equal(degraded.status, 200, "Office pack outage must degrade, not 500");
  assert.equal(degraded.json.source.available, false);
  assert.equal(degraded.json.source.reason, "office_unavailable");
  assert.ok(degraded.json.items.length > 0 && degraded.json.items.every((i) => i.canonical_key.startsWith("backend:")), "Backend items must still be listed during an Office outage");
  console.log(`PASS honest degradation: Office down -> source.available=false (office_unavailable), ${degraded.json.pagination.total} Backend items still listed`);
} finally {
  server.close();
  officeStub.close();
}
