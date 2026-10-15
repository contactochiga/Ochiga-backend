#!/usr/bin/env node
// Inbound WhatsApp persistence against a REAL PostgreSQL (Supabase image, same major version as production) behind a real PostgREST -- an in-memory fake cannot
// reproduce the production defect (PostgreSQL error 42P10: ON CONFLICT cannot be inferred from a PARTIAL unique index). The Backend's own migrations are loaded so the
// partial index is byte-identical to production; the compiled pipeline (dist/) then runs through the real supabase-js client. Fixture ids only. Skips when Docker or the
// images are unavailable. Run `npm run build` first. Set PIPELINE_DIST to point at another build (used for the negative control against the pre-fix code).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIST = process.env.PIPELINE_DIST ? path.resolve(process.env.PIPELINE_DIST) : path.join(ROOT, "dist");
const IMG_PG = "public.ecr.aws/supabase/postgres:17.6.1.131", IMG_REST = "public.ecr.aws/supabase/postgrest:v14.12";
const SUF = process.pid, PG = `be-inbound-pg-${SUF}`, REST = `be-inbound-rest-${SUF}`;
const PG_PORT = 54380, REST_PORT = 54381, PROXY_PORT = 54382, JWT_SECRET = "test-jwt-secret-test-jwt-secret-1234567890";
const docker = (...a) => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const psql = (sql, user = "supabase_admin") => execFileSync("docker", ["exec", "-i", PG, "psql", "-U", user, "-h", "127.0.0.1", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ role, iss: "supabase-test", exp: Math.floor(Date.now() / 1000) + 7200 }); return `${h}.${p}.${crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`; };

try { docker("image", "inspect", IMG_PG); docker("image", "inspect", IMG_REST); } catch { console.log("SKIP: Docker or the Supabase Postgres / PostgREST images are unavailable"); process.exit(0); }

let proxy;
try {
  docker("run", "-d", "--rm", "--name", PG, "-e", "POSTGRES_PASSWORD=testpw", "-p", `${PG_PORT}:5432`, IMG_PG);
  for (let i = 0; i < 90; i++) { try { execFileSync("docker", ["exec", PG, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"], { stdio: "ignore" }); break; } catch { await sleep(1000); } }
  await sleep(8000);
  // the Backend's own communication / goal migrations, twice (forward references), exactly as written
  const migDir = path.join(ROOT, "supabase", "migrations");
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort().filter((f) => /oyi_communications|oyi_goals|oyi_communication_opt_outs|oyi_communication_events/.test(fs.readFileSync(path.join(migDir, f), "utf8")));
  for (let pass = 0; pass < 2; pass++) for (const f of files) { try { execFileSync("docker", ["exec", "-i", PG, "psql", "-U", "supabase_admin", "-h", "127.0.0.1", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=0"], { input: fs.readFileSync(path.join(migDir, f), "utf8"), stdio: ["pipe", "ignore", "ignore"] }); } catch { /* unrelated dependencies */ } }
  const indexDef = psql("select indexdef from pg_indexes where indexname='uq_oyi_communications_inbound_provider_message'");
  assert.match(indexDef, /WHERE \(\(provider_message_id IS NOT NULL\) AND \(direction = 'inbound'::text\)\)/, "the PARTIAL unique index exists exactly as in production");
  psql("alter role authenticator with password 'testpw'");
  docker("run", "-d", "--rm", "--name", REST, "-p", `${REST_PORT}:3000`, "-e", `PGRST_DB_URI=postgres://authenticator:testpw@host.docker.internal:${PG_PORT}/postgres`, "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_ANON_ROLE=anon", "-e", `PGRST_JWT_SECRET=${JWT_SECRET}`, IMG_REST);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${REST_PORT}/`, { headers: { apikey: jwt("service_role") } })).status < 500) break; } catch { /* starting */ } await sleep(1000); }
  proxy = http.createServer((req, res) => { const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => { const p = req.url.replace(/^\/rest\/v1/, "") || "/"; const preq = http.request({ hostname: "127.0.0.1", port: REST_PORT, path: p, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${REST_PORT}` } }, (pres) => { res.writeHead(pres.statusCode, pres.headers); pres.pipe(res); }); preq.on("error", (e) => { res.writeHead(502); res.end(String(e)); }); preq.end(Buffer.concat(chunks)); }); });
  await new Promise((r) => proxy.listen(PROXY_PORT, "127.0.0.1", r));
  psql("notify pgrst, 'reload schema'"); await sleep(1500);

  process.env.SUPABASE_URL = `http://127.0.0.1:${PROXY_PORT}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = jwt("service_role");
  delete process.env.OPENAI_API_KEY; // classifier = deterministic keyword pre-check only
  const { supabaseAdmin } = await import(pathToFileURL(path.join(DIST, "supabase", "supabaseClient.js")));
  const pipeline = await import(pathToFileURL(path.join(DIST, "services", "communicationRuntime", "inboundEventPipeline.js")));
  const { computeThreadReference } = await import(pathToFileURL(path.join(DIST, "services", "communicationRuntime", "CommunicationRuntime.js")));
  const { processInboundEvent } = pipeline;

  const PHONE = "2348011112222";
  let seq = 0;
  const event = (over = {}) => ({ provider: "whatsapp_cloud_api", provider_event_id: over.id || `wamid.fixture.${++seq}`, channel: "whatsapp", sender_identifier: over.from || PHONE, recipient_business_identifier: "585884641275180", resolved_contact_id: null, resolved_lead_id: over.lead || "11111111-1111-4111-8111-111111111111", resolved_customer_id: null, organization_id: null, thread_reference: null, related_opportunity_id: null, related_task_id: null, related_goal_id: null, previous_communication_id: null, body: over.body ?? "Hello, I own land in Lekki", message_type: "text", attachments: null, occurred_at: over.at || new Date().toISOString(), provider_delivery_state: null, source_surface: "whatsapp_inbound", resolution_confidence: "high", resolution_evidence: "fixture" });
  const rows = (where) => JSON.parse(psql(`select coalesce(json_agg(t), '[]') from (select * from oyi_communications where ${where}) t`));
  const events = (where) => JSON.parse(psql(`select coalesce(json_agg(t), '[]') from (select event_type, provider_event_id from oyi_communication_events where ${where} order by event_type) t`));

  // ---- 0. the production defect, reproduced by the exact legacy statement ----
  const legacy = await supabaseAdmin.from("oyi_communications").upsert({ correlation_id: "legacy-probe", surface: "x", source: "inbound_webhook", channel: "whatsapp", direction: "inbound", provider: "whatsapp_cloud_api", provider_message_id: "wamid.legacy.probe" }, { onConflict: "provider,provider_message_id,direction", ignoreDuplicates: true }).select("id").maybeSingle();
  assert.equal(legacy.error?.code, "42P10", "the legacy upsert (conflict target on a partial unique index) fails with 42P10 against this schema");
  assert.equal(rows("provider_message_id='wamid.legacy.probe'").length, 0, "and persisted nothing");
  console.log("0. Root cause reproduced: legacy ON CONFLICT (provider, provider_message_id, direction) => 42P10, nothing persisted — PASS");

  // ---- A. a live inbound message is persisted with its thread, classification and decision trail ----
  const thread = computeThreadReference("whatsapp", { contact_id: null, lead_id: null, user_id: null, organization_id: null, name: null, email: null, phone: null, whatsapp_phone: PHONE });
  const outboundId = crypto.randomUUID();
  psql(`insert into oyi_communications (id, correlation_id, surface, source, channel, direction, body, plain_text, thread_reference, status, provider, provider_message_id, created_at) values ('${outboundId}', 'seed-out-1', 'office', 'conversation', 'whatsapp', 'outbound', 'earlier outbound', 'earlier outbound', '${thread}', 'sent', 'whatsapp_cloud_api', 'wamid.seed.out.1', now() - interval '1 hour')`);
  const e1 = event({ id: "wamid.live.1" });
  const r1 = await processInboundEvent(e1);
  assert.equal(r1.ok, true, `live inbound persisted (reason: ${r1.reason})`); assert.equal(r1.duplicate, false); assert.ok(r1.communication_id);
  const row1 = rows("provider_message_id='wamid.live.1'"); assert.equal(row1.length, 1);
  assert.equal(row1[0].direction, "inbound"); assert.equal(row1[0].status, "delivered"); assert.equal(row1[0].outcome, "received"); assert.equal(row1[0].correlation_id, "inbound-wamid.live.1");
  assert.equal(row1[0].thread_reference, thread, "thread association"); assert.equal(row1[0].reply_to_message_id, outboundId, "linked to the most recent outbound on the same thread");
  assert.equal(row1[0].recipient_lead_id, e1.resolved_lead_id); assert.ok(row1[0].outcome_classification, "classification stored on the row");
  assert.deepEqual(events("provider_event_id like 'wamid.live.1:%'").map((e) => e.event_type), ["inbound.classified"]);
  console.log("A. Live inbound persisted: row, status/outcome, thread association, reply-to link, classification, decision event — PASS");

  // ---- B. duplicate delivery of the same provider message ----
  const dup = await processInboundEvent(e1);
  assert.equal(dup.ok, true); assert.equal(dup.duplicate, true); assert.equal(dup.communication_id, null); assert.deepEqual(dup.woke_goal_ids, []);
  assert.equal(rows("provider_message_id='wamid.live.1'").length, 1, "still one row");
  assert.equal(events("provider_event_id like 'wamid.live.1:%'").length, 1, "no second decision event");
  // ---- C. 12 concurrent deliveries of one new message ----
  const concurrent = await Promise.all(Array.from({ length: 12 }, () => processInboundEvent(event({ id: "wamid.race.1" }))));
  assert.equal(concurrent.filter((r) => r.ok && !r.duplicate).length, 1, "exactly one concurrent delivery wins"); assert.equal(concurrent.filter((r) => r.ok && r.duplicate).length, 11); assert.ok(concurrent.every((r) => r.ok), "no delivery errored");
  assert.equal(rows("provider_message_id='wamid.race.1'").length, 1);
  // same text, different provider ids = two legitimate messages
  await processInboundEvent(event({ id: "wamid.same.a", body: "ok" })); await processInboundEvent(event({ id: "wamid.same.b", body: "ok" }));
  assert.equal(rows("provider_message_id in ('wamid.same.a','wamid.same.b')").length, 2, "identical text with different provider ids stays two rows");
  console.log("B/C. Duplicate delivery and 12-way concurrent delivery resolve to exactly one row; same text with different ids stays distinct — PASS");

  // ---- D. STOP governance + the complete decision trail ----
  const stop = await processInboundEvent(event({ id: "wamid.stop.1", body: "STOP" }));
  assert.equal(stop.ok, true); assert.equal(stop.outcome_classification, "unsubscribe");
  const optOuts = JSON.parse(psql("select coalesce(json_agg(t), '[]') from (select identity_key, channel from oyi_communication_opt_outs) t")); assert.equal(optOuts.length, 1, "the opt-out was recorded"); assert.equal(optOuts[0].channel, "whatsapp");
  assert.deepEqual(events("provider_event_id like 'wamid.stop.1:%'").map((e) => e.event_type), ["governance.opt_out_recorded", "inbound.classified"], "BOTH decision events are stored (they used to collide on one provider_event_id)");
  console.log("D. STOP: classified, opt-out recorded, complete decision trail — PASS");

  // ---- E. goal wake for a live message; a replay never wakes goals ----
  const goalId = crypto.randomUUID();
  psql(`insert into oyi_goals (id, correlation_id, surface, objective, status, linked_communication_threads) values ('${goalId}', 'goal-fixture', 'office', 'fixture goal', 'waiting', '["${thread}"]'::jsonb)`);
  const replayAt = "2026-09-01T10:00:00.000Z";
  const replayed = await processInboundEvent(event({ id: "wamid.hist.1", body: "Historical message", at: replayAt }), { replay: true });
  assert.equal(replayed.ok, true); assert.equal(replayed.duplicate, false); assert.deepEqual(replayed.woke_goal_ids, [], "a replay never wakes a goal even when one is watching the thread");
  const hist = rows("provider_message_id='wamid.hist.1'")[0]; assert.equal(new Date(hist.created_at).toISOString(), replayAt, "persisted with its ORIGINAL timestamp");
  assert.deepEqual(events("provider_event_id like 'wamid.hist.1:%'").map((e) => e.event_type), ["inbound.classified", "inbound.replayed"], "the skipped wake is recorded");
  assert.equal(JSON.parse(psql(`select coalesce(json_agg(t), '[]') from (select event_type from oyi_communication_events where event_type='goal.wake_triggered') t`)).length, 0);
  assert.equal(rows("direction='outbound' and created_at > now() - interval '5 minutes'").length, 0, "nothing outbound was created by any replay");
  const replayAgain = await processInboundEvent(event({ id: "wamid.hist.1", body: "Historical message", at: replayAt }), { replay: true }); assert.equal(replayAgain.duplicate, true, "replay is idempotent");
  const replayOfLive = await processInboundEvent(event({ id: "wamid.live.1" }), { replay: true }); assert.equal(replayOfLive.duplicate, true, "replaying a message that was already persisted live is a no-op");
  const replayStop = await processInboundEvent(event({ id: "wamid.hist.stop", body: "unsubscribe", from: "2348099990000", at: replayAt }), { replay: true });
  assert.equal(replayStop.outcome_classification, "unsubscribe", "a historical STOP is still honoured");
  assert.equal(Number(psql("select count(*) from oyi_communication_opt_outs")), 2);
  // the live path wakes the same goal (evaluation is fire-and-forget; with no provider configured nothing can be sent)
  const live = await processInboundEvent(event({ id: "wamid.live.goal", body: "Yes please call me" }));
  assert.deepEqual(live.woke_goal_ids, [goalId], "a LIVE message still wakes the goal watching its thread");
  assert.equal(events("provider_event_id like 'wamid.live.goal:%'").some((e) => e.event_type === "goal.wake_triggered"), true, "wake recorded in the decision trail");
  console.log("E. Replay: original timestamp, opt-out honoured, idempotent, no goal wake, nothing outbound; live message still wakes goals — PASS");

  // ---- F. error handling: only the idempotency index counts as a duplicate ----
  assert.equal(pipeline.isInboundDuplicateError({ code: "23505", message: 'duplicate key value violates unique constraint "uq_oyi_communications_inbound_provider_message"' }), true);
  assert.equal(pipeline.isInboundDuplicateError({ code: "23505", message: 'duplicate key value violates unique constraint "oyi_communications_pkey"' }), false);
  assert.equal(pipeline.isInboundDuplicateError({ code: "42P10", message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" }), false);
  assert.equal(pipeline.isInboundDuplicateError(null), false);
  const bad = await processInboundEvent({ ...event({ id: "wamid.bad.1" }), channel: "carrier_pigeon" });
  assert.equal(bad.ok, false); assert.equal(bad.duplicate, false); assert.ok(bad.reason, "a genuine failure (CHECK violation) is reported, not mistaken for a duplicate");
  assert.equal(rows("provider_message_id='wamid.bad.1'").length, 0);
  console.log("F. Only the idempotency index means 'duplicate'; real failures are reported — PASS");

  // ---- G. route wiring (source-text convention: importing dist/routes/officeExport.js hangs on ioredis in sandboxes) ----
  const route = fs.readFileSync(path.join(ROOT, "src", "routes", "officeExport.ts"), "utf8");
  assert.match(route, /processInboundEvent\(canonicalEvent, \{ replay: body\.replay === true \}\)/, "only an explicit boolean replay:true on the authenticated Office route enables replay semantics");
  assert.match(route, /source_surface: body\.replay === true \? "whatsapp_inbound_replay" : "whatsapp_inbound"/);
  const pipelineSource = fs.readFileSync(path.join(ROOT, "src", "services", "communicationRuntime", "inboundEventPipeline.ts"), "utf8");
  assert.ok(!/from\("oyi_communications"\)\s*\.upsert\(/.test(pipelineSource), "the inbound pipeline no longer upserts oyi_communications (no conflict target on the partial index)");
  console.log("G. Route wiring: replay needs an explicit true flag; the broken conflict target is gone — PASS");

  console.log(JSON.stringify({ status: "PASS", suite: "whatsapp-inbound-persistence-postgres", dist: path.relative(ROOT, DIST) || "dist" }));
} finally {
  if (proxy) proxy.close();
  for (const n of [REST, PG]) { try { docker("rm", "-f", n); } catch { /* gone */ } }
  setTimeout(() => process.exit(process.exitCode || 0), 500);
}
