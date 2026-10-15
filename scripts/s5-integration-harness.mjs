// S5 integration-acceptance harness (evidence tooling, not production code).
// Serves the REAL compiled Office export router (so /office/intelligence/providers is the genuine production route behind the genuine requireOfficeExportKey) and, on
// /variant/office/intelligence/providers, the SAME handler factory behind the SAME guard fed by scenario ledgers and clocks, so stale / conflicting / empty / verified /
// hostile situations can be shown end to end without editing the production ledger. A loopback-only control endpoint switches scenarios and exposes the request log and
// every non-loopback outbound connection attempt (there must be none).
//   node scripts/s5-integration-harness.mjs <port>    env: OFFICE_SYNC_API_KEY (required)
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import express from "express";

const require = createRequire(import.meta.url);
const port = Number(process.argv[2] || 0);
if (!process.env.OFFICE_SYNC_API_KEY) { console.error("OFFICE_SYNC_API_KEY is required"); process.exit(2); }
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "dummy-not-used";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// record every outbound connection attempt that is not loopback (provider traffic would show up here)
const outbound = [];
for (const mod of [http, https]) { const orig = mod.request.bind(mod); mod.request = (...a) => { const o = a[0]; const host = String(typeof o === "string" ? new URL(o).hostname : (o && (o.hostname || o.host)) || ""); if (!/^(127\.0\.0\.1|localhost|::1)$/.test(host)) outbound.push(host); return orig(...a); }; }
const queueModule = require.resolve("bullmq"); require.cache[queueModule] = { id: queueModule, filename: queueModule, loaded: true, exports: { Queue: class {}, Worker: class {} } };
const redisModule = require.resolve("ioredis"); class NoNetworkRedis { on() { return this; } quit() { return Promise.resolve(); } disconnect() {} } NoNetworkRedis.default = NoNetworkRedis; NoNetworkRedis.Redis = NoNetworkRedis; require.cache[redisModule] = { id: redisModule, filename: redisModule, loaded: true, exports: NoNetworkRedis };

const officeExport = require("../dist/routes/officeExport.js");
const { PROVIDER_APPROVAL_LEDGER } = require("../dist/intelligence-core/providerStatus/approvalLedger.js");
const { createProviderStatusHandler } = require("../dist/intelligence-core/providerStatus/projection.js");

const base = (over) => ({ ledger_version: 1, recorded_at: "2026-10-15T08:00:00Z", recorded_by: "integration harness", source: { type: "approval_register", ref: "s5-integration-harness" }, ...over });
const SECRET_A = "sk-live-INTEGRATIONLEAK0001", SECRET_B = "AIzaSyINTEGRATIONLEAK000000002", SECRET_C = "Bearer INTEGRATIONLEAKTOKEN03";
const scenarios = {
  seed: { ledger: () => PROVIDER_APPROVAL_LEDGER, now: () => new Date() },
  stale: { ledger: () => PROVIDER_APPROVAL_LEDGER, now: () => new Date(Date.now() + 10 * 24 * 3600 * 1000) },
  empty: { ledger: () => [], now: () => new Date() },
  verified: { ledger: () => [...PROVIDER_APPROVAL_LEDGER, base({ id: "openai-verified-fresh", kind: "observation", provider: "openai", scope: "authenticated read of the funded project (integration harness)", valid_for_hours: 48, recorded_at: new Date(Date.now() - 3600_000).toISOString(), facts: { credentials: "verified", billing: "verified", model_access: "not_verified", data_controls: "not_verified", verified_credits_usd: 120, verified_spend_usd: 7.5, authenticated_requests: 4, paid_inference_calls: 0 }, limitations: [], supersedes: ["openai-access-observation-2026-10-14"] })], now: () => new Date() },
  conflict: { ledger: () => [...PROVIDER_APPROVAL_LEDGER,
      base({ id: "gemini-auth-a", kind: "budget_authorization", provider: "gemini", currency: "USD", maximum_cumulative: 20, synthetic_only: true, shadow_only: true, production_adoption: false, conditions: [], candidate_models: [] }),
      base({ id: "gemini-auth-b", kind: "budget_authorization", provider: "gemini", currency: "USD", maximum_cumulative: 35, synthetic_only: true, shadow_only: true, production_adoption: false, conditions: [], candidate_models: [] }),
      base({ id: "claude-state-a", kind: "provider_state", provider: "anthropic", qualification_status: "in_progress" }),
      base({ id: "claude-state-b", kind: "provider_state", provider: "anthropic", qualification_status: "qualified" })], now: () => new Date() },
  hostile: { ledger: () => [...PROVIDER_APPROVAL_LEDGER,
      base({ id: "unlisted-provider-auth", kind: "budget_authorization", provider: "grok", currency: "USD", maximum_cumulative: 999, synthetic_only: false, shadow_only: false, production_adoption: true, conditions: [], candidate_models: [] }),
      base({ id: "secret-in-limitations", kind: "provider_state", provider: "openai", limitations: [`leaked ${SECRET_A}`], recorded_at: "2026-10-15T09:00:00Z" }),
      base({ id: "secret-in-conditions", kind: "budget_authorization", provider: "gemini", currency: "USD", maximum_cumulative: 5, synthetic_only: true, shadow_only: true, production_adoption: false, conditions: [SECRET_B], candidate_models: [], recorded_at: "2026-10-15T09:00:00Z" }),
      { ...base({ id: "extra-fields", kind: "provider_state", provider: "anthropic", qualification_status: "preparation", recorded_at: "2026-10-15T09:00:00Z" }), api_key: SECRET_C, headers: { authorization: SECRET_C } }], now: () => new Date() },
};
let mode = "seed";

const app = express(); app.use(express.json());
const log = [];
app.use((req, _res, next) => { if (!req.path.startsWith("/__harness")) log.push({ method: req.method, path: req.path, auth: req.headers["x-office-api-key"] ? "x-office-api-key" : req.headers["x-api-key"] ? "x-api-key" : req.headers.authorization ? "bearer" : "none" }); next(); });
// the real Backend serves /health (Office's Integrations probe reads it); the harness answers it so the Oyi Intelligence card reflects a healthy Backend
app.get("/health", (_req, res) => res.json({ ok: true, harness: "s5-integration" }));
app.use("/office", officeExport.default); // the real production router, including the real /office/intelligence/providers route
app.get("/variant/office/intelligence/providers", officeExport.requireOfficeExportKey, (req, res) => createProviderStatusHandler(() => scenarios[mode].ledger(), () => scenarios[mode].now())(req, res));
app.post("/__harness/mode", (req, res) => { if (!scenarios[req.body?.mode]) return res.status(400).json({ error: "unknown mode", modes: Object.keys(scenarios) }); mode = req.body.mode; res.json({ ok: true, mode }); });
app.get("/__harness/log", (_req, res) => res.json({ mode, requests: log, outbound }));
app.get("/__harness/health", (_req, res) => res.json({ ok: true }));
const server = app.listen(port, "127.0.0.1", () => console.log(`HARNESS_READY ${server.address().port}`));
