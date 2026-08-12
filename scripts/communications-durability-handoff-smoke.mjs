import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function check(name, fn) {
  fn();
  console.log(`✓ ${name}`);
}

const contracts = read("src/services/communications/communicationContracts.ts");
const service = read("src/services/communications/communicationsLiveService.ts");
const routes = read("src/routes/communications.ts");
const migration = read("supabase/migrations/20260812000100_communications_sessions_handoffs.sql");
const sockets = read("src/services/communications/communicationsSocketHandlers.ts");

check("durable communications tables are additive and service-role scoped", () => {
  for (const table of ["communications_sessions", "communications_participants", "communications_events", "communications_handoffs"]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}`));
    assert.match(migration, new RegExp(`alter table ${table} enable row level security`));
  }
  assert.match(migration, /auth\.role\(\) = 'service_role'/);
  assert.doesNotMatch(migration, /\bsdp\b|\boffer\b|\banswer\b|\bice_candidate\b|turn_credential|raw_media/i);
});

check("contracts keep communications session, Oyi thread, and public session separate", () => {
  assert.match(contracts, /communications_session_id/);
  assert.match(contracts, /oyi_thread_id/);
  assert.match(contracts, /public_session_id/);
  assert.match(contracts, /OyiVoiceAdapterTurn/);
  assert.match(contracts, /OyiVisualObservation/);
  assert.match(contracts, /visual_analysis/);
});

check("participant model supports visitor, Oyi, staff, and specialist coexistence", () => {
  for (const role of ["visitor", "oyi", "staff", "specialist"]) {
    assert.match(contracts, new RegExp(role));
  }
  assert.match(service, /participant_type: "oyi"/);
  assert.match(service, /inviteParticipant/);
});

check("handoff lifecycle supports request, assignment, accept, decline, timeout, and fallback", () => {
  for (const marker of ["requestHandoff", "assignHandoff", "acceptHandoff", "declineHandoff", "fallback_action"]) {
    assert.match(service, new RegExp(marker));
  }
  for (const eventType of ["handoff.requested", "handoff.assigned", "handoff.accepted", "handoff.declined", "handoff.timed_out"]) {
    assert.match(service, new RegExp(eventType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

check("Office/Public and Support APIs expose session, handoff queue, callback, and RTC contracts", () => {
  for (const route of [
    "/office-public/session/:sessionId/handoff",
    "/office-public/session/:sessionId/callback",
    "/office-internal/handoffs",
    "/office-internal/handoffs/:handoffId/accept",
    "/support/handoffs",
    "/support/handoffs/:handoffId/accept",
  ]) {
    assert.match(routes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(routes, /microphone_consent/);
  assert.match(routes, /camera_consent/);
  assert.match(routes, /visual_analysis_consent/);
});

check("signaling token is scoped to session, participant, role, surface, and expiry", () => {
  for (const field of ["session_id", "surface", "participant_id", "role", "exp"]) {
    assert.match(routes, new RegExp(field));
  }
  assert.match(sockets, /verifyCommunicationToken/);
  assert.match(sockets, /payload\.session_id/);
  assert.match(sockets, /payload\.surface/);
  assert.match(sockets, /payload\.exp/);
});

check("Community compatibility remains isolated from generic communications signaling", () => {
  assert.match(sockets, /session\.surface === "community"/);
  assert.match(sockets, /community-live:host:join/);
  assert.match(sockets, /communications:host:join/);
});

check("service durability is implemented through canonical persistence and reload seams", () => {
  assert.match(service, /communications_sessions/);
  assert.match(service, /communications_participants/);
  assert.match(service, /communications_events/);
  assert.match(service, /communications_handoffs/);
  assert.match(service, /reloadForTest/);
});

console.log("communications-durability-handoff-smoke passed");
