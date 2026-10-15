// Settings S5 Backend contract: GET /office/intelligence/providers (read-only, governed approval-record projection).
// Part 1 static guards (no provider calls, no env reads, same auth boundary). Part 2 projection behaviour (missing, stale, conflicting, unknown providers, rejected
// records, separate budget quantities). Part 3 real HTTP through the compiled router (auth, strict allowlist, redaction). Part 4 Office S5 compatibility, run against
// the Office repository's own normaliser and bridge client when it is present (OFFICE_REPO, default /tmp/office-crm).
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import express from "express";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- Part 1
const dir = "src/intelligence-core/providerStatus";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
assert.deepEqual(files.sort(), ["approvalLedger.ts", "approvalRecords.ts", "projection.ts"]);
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\/.*$/gm, "");
  for (const [re, why] of [[/process\.env/, "reads the environment"], [/\bfetch\s*\(/, "calls fetch"], [/from\s+["']axios["']/, "imports axios"], [/from\s+["'](node:)?https?["']/, "imports http(s)"], [/api\.openai\.com|api\.anthropic\.com|generativelanguage|googleapis|from\s+["']openai["']|@anthropic-ai|@google\/generative-ai/i, "names a provider endpoint or SDK"], [/(import|require)\b[^;\n]*(iq11f|AdapterRegistry|scripts\/)/i, "imports the offline adapter registry"], [/from\s+["'](node:)?fs["']/, "reads files"], [/supabase/i, "touches the database"], [/\.(post|put|patch|delete)\s*\(/, "defines a write route"]]) {
    assert.doesNotMatch(src, re, `${f} must not ${why}: the projection is a pure function of the ledger`);
  }
}
const routeSrc = fs.readFileSync("src/routes/officeExport.ts", "utf8");
assert.match(routeSrc, /router\.get\("\/intelligence\/providers",\s*requireOfficeExportKey,\s*createProviderStatusHandler/, "providers route reuses the Office export auth boundary");
assert.doesNotMatch(routeSrc, /router\.(post|put|patch|delete)\("\/intelligence\/providers/, "no write route for providers");
console.log("PASS static guards: pure projection (no env, network, SDK, database or file access), same auth boundary, no write route");

// ---------------------------------------------------------------- Part 2
const { projectProviderStatus, scrubSecrets, createProviderStatusHandler } = require("../dist/intelligence-core/providerStatus/projection.js");
const { PROVIDER_APPROVAL_LEDGER } = require("../dist/intelligence-core/providerStatus/approvalLedger.js");
const { validateApprovalRecord } = require("../dist/intelligence-core/providerStatus/approvalRecords.js");
const keysOfTop = null;
const NOW = new Date("2026-10-15T12:00:00Z");
const prov = (r, id) => r.providers.find((p) => p.id === id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const base = (over) => ({ ledger_version: 1, recorded_at: "2026-10-15T08:00:00Z", recorded_by: "smoke", source: { type: "approval_register", ref: "smoke" }, ...over });

// seed ledger
const seed = projectProviderStatus(PROVIDER_APPROVAL_LEDGER, { now: NOW });
assert.equal(seed.ok, true); assert.equal(seed.source.rejected_count, 0, "every seed record validates"); assert.equal(seed.source.record_count, 6);
assert.deepEqual(seed.providers.map((p) => p.id), ["openai", "gemini", "anthropic"]);
const oa = prov(seed, "openai");
assert.deepEqual([oa.budget.currency, oa.budget.approved_maximum, oa.budget.verified_credits, oa.budget.verified_spend], ["USD", 50, null, null], "the $50 ceiling is separate from verified credits and expenditure (both unknown)");
assert.equal(oa.budget.approval_ref, "openai-shadow-budget-authorization-2026-10-14");
assert.equal(oa.credentials.status, "unknown", "no credential in a checked scope is NOT 'not provisioned' and never 'verified'");
assert.deepEqual([oa.credentials.reference_recorded, oa.credentials.verified_at], [false, null]);
assert.deepEqual([oa.model.status, oa.model.approved_model, oa.model.candidates.length], ["candidate", null, 2], "candidate snapshots are not an approved model");
assert.deepEqual([oa.qualification.status, oa.operating_mode, oa.data_processing.status, oa.budget.enforcement.status], ["preparation", "offline_mock_only", "not_reviewed", "designed"]);
assert.equal(oa.last_verified_at, "2026-10-14T06:25:52.398Z"); assert.deepEqual(oa.activation, { contract_available: false, activated: false });
assert.ok(seed.provenance.some((p) => p.group === "openai.budget" && p.conflicts.length), "the 0-vs-50 record conflict is preserved");
const bc = seed.provenance.find((p) => p.group === "openai.budget"); assert.ok(bc.conflicts.some((c) => /states authorized spend 0/.test(c) && /maximum of 50/.test(c) && /Both are preserved/.test(c)), "the conflict names both records and the values"); assert.match(bc.source_record, /openai-shadow-budget-authorization/); assert.match(bc.source_record, /gateway-approvals-iq11f/);
for (const id of ["gemini", "anthropic"]) { const p = prov(seed, id); assert.deepEqual([p.budget.approved_maximum, p.budget.currency, p.budget.verified_spend, p.model.status, p.qualification.status, p.credentials.status, p.last_verified_at], [null, null, null, "none_selected", "not_started", "unknown", null], `${id}: no paid-call authorization, nothing verified`); assert.ok(p.limitations.some((l) => /states authorized spend 0/.test(l)), `${id}: the gateway's authorized spend 0 is stated, not hidden`); }
assert.deepEqual([seed.gateway.status, seed.gateway.paid_inference_enabled, seed.gateway.live_transport_implemented, seed.gateway.cross_provider_fallback, seed.gateway.approved_cross_provider_transfers], ["offline_design_only", false, false, "disabled", []]);
assert.equal(seed.gateway.source_record.id, "gateway-approvals-iq11f-2026-10-14"); assert.equal(seed.redaction_applied, 0);

// missing records
const empty = projectProviderStatus([], { now: NOW });
assert.equal(empty.ok, true); assert.equal(empty.source.record_count, 0); assert.deepEqual([empty.gateway.status, empty.gateway.paid_inference_enabled, empty.gateway.source_record], ["unknown", null, null]);
for (const p of empty.providers) { assert.deepEqual([p.qualification.status, p.operating_mode, p.credentials.status, p.model.status, p.data_processing.status, p.budget.enforcement.status, p.adapter.registered, p.budget.approved_maximum, p.last_verified_at], ["unknown", "unknown", "unknown", "unknown", "unknown", "unknown", null, null, null], `${p.id}: everything unknown`); assert.ok(p.limitations.includes("No approval record exists for this provider")); }
const onlyOpenAI = projectProviderStatus(PROVIDER_APPROVAL_LEDGER.filter((r) => !String(r.id).startsWith("gemini")), { now: NOW });
assert.equal(prov(onlyOpenAI, "gemini").qualification.status, "unknown", "a provider with no record is unknown, not 'not started'");

// stale observation
const stale = projectProviderStatus(PROVIDER_APPROVAL_LEDGER, { now: new Date("2026-10-30T00:00:00Z") });
const so = prov(stale, "openai"); assert.equal(so.last_verified_at, "2026-10-14T06:25:52.398Z", "the observation time is still reported"); assert.ok(so.limitations[0].includes("older than its 168-hour validity"), "stale evidence is flagged first"); assert.equal(so.credentials.status, "unknown");
assert.ok(stale.provenance.some((p) => p.group === "openai.observation" && p.conflicts.includes("Stale observation")));
// fresh verified observation (billing verified): separate quantities
const verifiedObs = base({ id: "openai-verified", kind: "observation", provider: "openai", scope: "authenticated read of the project", valid_for_hours: 24, recorded_at: "2026-10-15T09:00:00Z", facts: { credentials: "verified", billing: "verified", model_access: "verified", data_controls: "not_verified", verified_credits_usd: 120, verified_spend_usd: 7.5, authenticated_requests: 3, paid_inference_calls: 0 }, limitations: [], supersedes: ["openai-access-observation-2026-10-14"] });
const ver = prov(projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, verifiedObs], { now: NOW }), "openai");
assert.deepEqual([ver.budget.approved_maximum, ver.budget.verified_credits, ver.budget.verified_spend, ver.credentials.status, ver.credentials.verified_at], [50, 120, 7.5, "verified", "2026-10-15T09:00:00.000Z"], "ceiling, credits and spend stay three separate numbers");
const verStale = prov(projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, verifiedObs], { now: new Date("2026-10-17T00:00:00Z") }), "openai"); assert.deepEqual([verStale.credentials.status, verStale.budget.verified_credits, verStale.budget.verified_spend], ["unknown", null, null], "once stale, verified facts revert to unknown");
const badAmount = projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, { ...verifiedObs, id: "bad-amount", facts: { ...verifiedObs.facts, billing: "not_verified" } }], { now: NOW }); assert.ok(badAmount.rejected_records.some((r) => r.id === "bad-amount" && r.reason === "amounts_require_verified_billing"), "an amount without verified billing is rejected, never projected");

// conflicting approvals
const a1 = base({ id: "auth-a", kind: "budget_authorization", provider: "gemini", currency: "USD", maximum_cumulative: 20, synthetic_only: true, shadow_only: true, production_adoption: false, conditions: [], candidate_models: [] });
const a2 = { ...a1, id: "auth-b", maximum_cumulative: 35 };
const tie = prov(projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, a1, a2], { now: NOW }), "gemini"); assert.equal(tie.budget.approved_maximum, null, "same-time disagreeing authorizations: approved maximum unknown"); assert.ok(tie.limitations.some((l) => /Unresolved/.test(l) && /auth-a \(20\)/.test(l) && /auth-b \(35\)/.test(l)));
const later = prov(projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, a1, { ...a2, recorded_at: "2026-10-15T09:00:00Z" }], { now: NOW }), "gemini"); assert.equal(later.budget.approved_maximum, 35, "a later authorization is the current one"); assert.ok(projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, a1, { ...a2, recorded_at: "2026-10-15T09:00:00Z" }], { now: NOW }).provenance.find((p) => p.group === "gemini.budget").conflicts.some((c) => /Earlier authorization/.test(c)), "the earlier record is acknowledged");
const sup = prov(projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, a1, { ...a2, supersedes: ["auth-a"] }], { now: NOW }), "gemini"); assert.equal(sup.budget.approved_maximum, 35, "a superseded record is ignored");
const s1 = base({ id: "state-x", kind: "provider_state", provider: "anthropic", qualification_status: "in_progress" }), s2 = { ...s1, id: "state-y", qualification_status: "qualified" };
const stTie = projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, s1, s2], { now: NOW }); assert.equal(prov(stTie, "anthropic").qualification.status, "unknown", "simultaneous disagreeing qualification claims are unknown, never 'qualified'"); assert.ok(prov(stTie, "anthropic").limitations.some((l) => /disagree on qualification_status/.test(l)));
assert.equal(prov(projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, { ...s2, recorded_at: "2026-10-15T09:00:00Z", id: "state-z" }], { now: NOW }), "anthropic").qualification.status, "qualified", "a later record does update state (and does not enable activation)");
assert.deepEqual(prov(projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, { ...s2, recorded_at: "2026-10-15T09:00:00Z", id: "state-z" }], { now: NOW }), "anthropic").activation, { contract_available: false, activated: false });
const gwTie = projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, { ...clone(PROVIDER_APPROVAL_LEDGER[0]), id: "gw-other", paid_inference_enabled: true }], { now: NOW }); assert.equal(gwTie.gateway.status, "unknown", "disagreeing simultaneous gateway records: gateway state unknown"); assert.equal(gwTie.gateway.paid_inference_enabled, null);

// unknown providers, bad records, strict allowlisting, secrets
const bads = [
  [{ ...a1, id: "unlisted-provider-auth", provider: "grok" }, "unknown_provider"], [{ ...a1, id: "v2", ledger_version: 2 }, "unsupported_ledger_version"], [{ ...a1, id: "kind", kind: "activation" }, "unknown_record_kind"],
  [{ ...a1, id: "date", recorded_at: "yesterday" }, "invalid_recorded_at"], [{ ...a1, id: "src", source: undefined }, "missing_or_invalid_source"], [{ ...a1, id: "neg", maximum_cumulative: -1 }, "invalid_budget_amount"],
  [{ ...a1, id: "cur", currency: "EUR" }, "invalid_budget_amount"], [{ ...s1, id: "enum", qualification_status: "approved-ish" }, "invalid_qualification_status"], [{ ...s1, id: "model", model_status: "approved" }, "approved_model_requires_a_model"],
  [{ ...a1, id: "sk", conditions: ["use sk-live-ABCDEFGHIJKL for tests"] }, "invalid_budget_lists"], [{ ...s1, id: "key", limitations: ["Bearer abcdefghijklmnop"] }, "invalid_limitations"], [PROVIDER_APPROVAL_LEDGER[1], "duplicate_record_id"],
];
const bad = projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, ...bads.map(([r]) => r)], { now: NOW });
for (const [r, reason] of bads) assert.ok(bad.rejected_records.some((x) => x.id === r.id && x.reason === reason), `${r.id} rejected for ${reason}`);
assert.equal(bad.providers.length, 3, "an unknown provider never appears in the output"); assert.ok(!JSON.stringify(bad).includes("grok"), "its name does not leak into the response either");
assert.ok(bad.provenance.some((p) => p.group === "ledger" && /not projected/.test(p.conflicts.join(" "))), "rejected records are reported in provenance"); assert.equal(prov(bad, "openai").budget.approved_maximum, 50, "rejected records change nothing");
const extra = projectProviderStatus([...PROVIDER_APPROVAL_LEDGER, { ...s1, id: "extra", api_key: "sk-live-SHOULDNOTAPPEAR1", credential: "vault://x", headers: { authorization: "SENTINEL" } }], { now: NOW }); const keysOf = (o) => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => [k, ...keysOf(v)]) : []);
assert.ok(!JSON.stringify(extra).match(/SHOULDNOTAPPEAR|vault:\/\/|SENTINEL/) && !keysOf(extra).some((k) => /^(api_key|credential|headers|authorization)$/i.test(k)), "unknown fields on a record are dropped by the strict allowlist");
assert.deepEqual(scrubSecrets({ a: "sk-live-ABCDEFGHIJKL", b: ["ok", "AIzaSyABCDEFGHIJKLMNOP"], c: { d: "Bearer abcdefghijkl", e: "fine" } }), { value: { a: null, b: ["ok"], c: { d: null, e: "fine" } }, redactions: 3 });
assert.equal(validateApprovalRecord(null).ok, false); assert.equal(validateApprovalRecord("string").ok, false);
console.log("PASS projection: seed ledger, missing records, stale evidence, verified amounts kept separate, conflicting approvals, superseded records, unknown providers, rejected/secret-bearing records");

// ---------------------------------------------------------------- Part 3: real HTTP
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "dummy-not-used";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
process.env.OFFICE_SYNC_API_KEY = "providers-smoke-office-key";
const queueModule = require.resolve("bullmq"); require.cache[queueModule] = { id: queueModule, filename: queueModule, loaded: true, exports: { Queue: class {}, Worker: class {} } };
const redisModule = require.resolve("ioredis"); class NoNetworkRedis { on() { return this; } quit() { return Promise.resolve(); } disconnect() {} } NoNetworkRedis.default = NoNetworkRedis; NoNetworkRedis.Redis = NoNetworkRedis; require.cache[redisModule] = { id: redisModule, filename: redisModule, loaded: true, exports: NoNetworkRedis };
const officeExportModule = require("../dist/routes/officeExport.js");
const app = express(); app.use(express.json()); app.use("/office", officeExportModule.default);
// a second app: the same handler behind the same auth guard, fed hostile ledgers
let hostile = []; app.get("/hostile/providers", officeExportModule.requireOfficeExportKey, createProviderStatusHandler(() => hostile, () => NOW));
let throwing = false; app.get("/broken/providers", officeExportModule.requireOfficeExportKey, createProviderStatusHandler(() => { throw new Error("db password hunter2 leaked"); }));
const server = app.listen(0); await new Promise((r) => server.once("listening", r)); const port = server.address().port;
const call = (method, p, headers = {}) => new Promise((resolve, reject) => { const req = http.request({ hostname: "127.0.0.1", port, path: p, method, headers }, (res) => { let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => { let json = null; try { json = body ? JSON.parse(body) : null; } catch { /* not json */ } resolve({ status: res.statusCode, json, text: body, headers: res.headers }); }); }); req.on("error", reject); req.end(); });
const KEY = { "x-api-key": "providers-smoke-office-key" };
try {
  const P = "/office/intelligence/providers";
  assert.equal((await call("GET", P)).status, 401, "no credential"); assert.equal((await call("GET", P, { "x-api-key": "wrong" })).status, 401, "wrong credential"); assert.equal((await call("GET", P, { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await call("GET", P, { "x-api-key": "providers-smoke-office-key-" })).status, 401, "near-miss credential"); assert.equal((await call("GET", P, { cookie: "session=abc" })).status, 401, "an end-user session cookie is not the Office boundary");
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) { const r = await call(m, P, KEY); assert.ok([404, 405].includes(r.status), `${m} is not served (${r.status})`); }
  const ok = await call("GET", P, KEY); assert.equal(ok.status, 200); assert.equal(ok.headers["cache-control"], "no-store"); assert.equal((await call("GET", P, { "x-office-api-key": "providers-smoke-office-key" })).status, 200, "the existing x-office-api-key header works (what Office sends)"); assert.equal((await call("GET", P, { authorization: "Bearer providers-smoke-office-key" })).status, 200);
  assert.deepEqual(Object.keys(ok.json).sort(), ["gateway", "generated_at", "ok", "provenance", "providers", "redaction_applied", "rejected_records", "schema_version", "source"], "top-level allowlist is exact");
  assert.deepEqual(Object.keys(ok.json.providers[0]).sort(), ["activation", "adapter", "budget", "credentials", "data_processing", "id", "last_verified_at", "limitations", "model", "operating_mode", "qualification"], "provider allowlist is exact");
  assert.deepEqual(Object.keys(ok.json.providers[0].budget).sort(), ["approval_ref", "approved_at", "approved_maximum", "credits_verified_at", "currency", "enforcement", "spend_verified_at", "verified_credits", "verified_spend"]);
  assert.deepEqual(prov(ok.json, "openai").budget.approved_maximum, 50);
  assert.ok(!keysOf(ok.json.providers).some((k) => /api[_-]?key|secret|token|password|authorization|credential_ref/i.test(k)), "no credential-like field name anywhere in the provider objects");
  const h = await call("GET", "/hostile/providers", KEY); hostile = [...PROVIDER_APPROVAL_LEDGER, { ...a1, id: "unlisted-provider-auth", provider: "grok", api_key: "sk-live-HTTPLEAK0001" }, { ...s1, id: "leak", limitations: ["sk-live-HTTPLEAK0002"] }]; const h2 = await call("GET", "/hostile/providers", KEY);
  assert.equal(h.status, 200); assert.equal(h2.status, 200); assert.ok(!h2.text.includes("HTTPLEAK"), "hostile records never leak secrets over HTTP"); assert.equal(h2.json.rejected_records.length, 2);
  assert.equal((await call("GET", "/hostile/providers")).status, 401, "the same guard protects any mount");
  const broken = await call("GET", "/broken/providers", KEY); assert.equal(broken.status, 500); assert.deepEqual(broken.json, { ok: false, error: "Unable to project provider status" }); assert.ok(!broken.text.includes("hunter2"), "an internal failure never echoes its message");
  const saved = process.env.OFFICE_SYNC_API_KEY; delete process.env.OFFICE_SYNC_API_KEY; assert.equal((await call("GET", P, KEY)).status, 503, "unconfigured key fails closed"); process.env.OFFICE_SYNC_API_KEY = saved;
  console.log("PASS http: 401 for missing/wrong/near-miss credentials, write verbs not served, exact response allowlists, hostile ledger cannot leak, failures do not echo, unconfigured key fails closed");

  // ------------------------------------------------------------ Part 4: Office S5 compatibility (real Office normaliser + bridge client)
  const officeRepo = process.env.OFFICE_REPO || "/tmp/office-crm";
  if (!fs.existsSync(path.join(officeRepo, "src/lead-agents/intelligence-providers.js"))) { console.log(`SKIP office compatibility: ${officeRepo} not present (set OFFICE_REPO)`); }
  else {
    const { buildProviderStatusResponse } = require(path.join(officeRepo, "src/lead-agents/intelligence-providers.js"));
    const { callOyiCoreIntelligenceProviders } = require(path.join(officeRepo, "src/lead-agents/oyi-core-gateway.js"));
    const config = { officeBackendBaseUrl: `http://127.0.0.1:${port}`, officeBackendApiKey: "providers-smoke-office-key", officeIntelligenceProvidersPath: "/office/intelligence/providers", openaiApiKey: "", officeBackendEventTimeoutMs: 5000 };
    const bridged = await callOyiCoreIntelligenceProviders(config); assert.equal(bridged.ok, true, "Office's real bridge client is accepted by the Backend boundary");
    const office = buildProviderStatusResponse(bridged, config);
    assert.equal(office.available, true); assert.equal(office.activation.available, false); assert.equal(office.redaction_applied, 0, "nothing the Backend sends is mistaken for a secret");
    assert.deepEqual(office.providers.map((p) => p.id), ["openai", "gemini", "anthropic"]);
    const o = office.providers.find((p) => p.id === "openai"), g = office.providers.find((p) => p.id === "gemini");
    assert.deepEqual([o.reported, o.adapter.registered, o.adapter.protocol, o.adapter.mode, o.operating_mode, o.credentials.status, o.model.status, o.model.approved_model, o.qualification.status, o.data_processing.status, o.budget.enforcement], [true, true, "responses", "offline_mock_only", "offline_mock_only", "unknown", "candidate", null, "preparation", "not_reviewed", "designed"], "Office reads every field the Backend sends");
    assert.deepEqual([o.budget.currency, o.budget.approved_maximum, o.budget.verified_credits, o.budget.verified_spend, o.budget.remaining_authorized], ["USD", 50, null, null, null], "Office shows the $50 ceiling with unknown credits, spend and remaining");
    assert.deepEqual(o.model.candidates, ["gpt-5.4-mini-2026-03-17", "gpt-5.4-2026-03-05"]); assert.equal(o.last_verified_at, "2026-10-14T06:25:52.398Z"); assert.equal(o.credentials.reference_recorded, false);
    assert.deepEqual([g.budget.approved_maximum, g.qualification.status, g.model.status], [null, "not_started", "none_selected"]);
    assert.ok(office.provenance.some((p) => p.group === "openai.budget" && p.conflicts.some((c) => /authorized spend 0/.test(c))), "Office receives and displays the preserved record conflict");
    assert.deepEqual(office.gateway, { status: "offline_design_only", live_transport_implemented: false, paid_inference_enabled: false, cross_provider_fallback: "disabled", approved_cross_provider_transfers: [] });
    assert.ok(o.readiness.every((r) => r.status !== "met"), "no readiness item is met for any provider today");
    console.log("PASS office compatibility: real Office bridge + normaliser consume the Backend response unchanged (ceiling 50, credits/spend/remaining unknown, conflicts preserved, activation unavailable)");
  }
} finally {
  server.close();
}
console.log("PASS office-intelligence-providers smoke");
