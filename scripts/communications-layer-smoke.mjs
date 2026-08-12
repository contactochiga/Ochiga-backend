import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

async function check(name, fn) {
  await fn();
  console.log(`✓ ${name}`);
}

const communityAdapter = read("src/services/communityLiveService.ts");
const liveService = read("src/services/communications/communicationsLiveService.ts");
const rtcConfig = read("src/services/communications/communicationsRtcConfig.ts");
const policy = read("src/services/communications/communicationsPolicy.ts");
const socketHandlers = read("src/services/communications/communicationsSocketHandlers.ts");
const server = read("src/server.ts");
const routes = read("src/routes/communications.ts");
const app = read("src/app.ts");
const packageJson = JSON.parse(read("package.json"));

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.APP_JWT_SECRET ||= "test-jwt-secret";
process.env.OYI_COMMUNICATIONS_DISABLE_PERSISTENCE = "true";

await check("Community Live compatibility wrapper delegates to shared communications service", () => {
  assert.match(communityAdapter, /CommunicationsLiveService/);
  assert.match(communityAdapter, /toCommunitySession/);
  assert.match(communityAdapter, /getCommunicationRtcConfig/);
  assert.match(liveService, /CommunicationSession/);
  assert.match(liveService, /surface: input\.surface/);
});

await check("Twilio remains network traversal only with no Programmable Voice or Video SDK", () => {
  assert.match(rtcConfig, /Tokens\.json/);
  assert.doesNotMatch(`${rtcConfig}\n${routes}\n${liveService}`, /twilio-video|VoiceGrant|VideoGrant|Twiml|TwiML|Programmable Voice|Programmable Video/i);
  assert.equal(Boolean(packageJson.dependencies?.["twilio-video"]), false);
  assert.equal(Boolean(packageJson.dependencies?.twilio), false);
});

await check("Community socket event names are preserved through reusable socket handler", () => {
  for (const eventName of [
    "community-live:host:join",
    "community-live:viewer:join",
    "community-live:signal",
    "community-live:guest:request",
    "community-live:guest:approve",
    "community-live:guest:join",
    "community-live:chat:send",
    "community-live:leave",
  ]) {
    assert.match(socketHandlers, new RegExp(eventName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(server, /registerCommunityCommunicationSocketHandlers/);
  assert.doesNotMatch(server, /socket\.on\("community-live:host:join"/);
});

await check("Generic communications signaling requires signed session tokens", () => {
  for (const eventName of [
    "communications:host:join",
    "communications:participant:join",
    "communications:signal",
    "communications:chat:send",
    "communications:leave",
    "communications:session:stop",
  ]) {
    assert.match(socketHandlers, new RegExp(eventName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(server, /registerGenericCommunicationSocketHandlers/);
  assert.match(routes, /signaling_token: signCommunicationToken/);
  assert.match(routes, /participant_id/);
  assert.match(routes, /role/);
  assert.match(socketHandlers, /verifyCommunicationToken/);
  assert.match(socketHandlers, /signalingToken/);
  assert.match(socketHandlers, /session\.surface === "community"/);
});

await check("Community host and guest role enforcement is stricter than broad write access", () => {
  assert.match(socketHandlers, /canHostCommunityLive/);
  assert.match(socketHandlers, /community\.host/);
  assert.match(server, /canHostCommunityPostSocketResource/);
  assert.match(server, /author_id/);
  assert.match(server, /community\.moderate/);
});

await check("Surface policies exist for community, office_public, office_internal, and support", () => {
  for (const surface of ["community", "office_public", "office_internal", "support"]) {
    assert.match(policy, new RegExp(surface));
  }
  assert.match(policy, /browser_webrtc_socketio_signaling/);
  assert.match(policy, /twilio_network_traversal_only/);
});

await check("Office/Public communications APIs are exposed without caller-supplied permission trust", () => {
  assert.match(routes, /router\.post\("\/office-public\/session"/);
  assert.match(routes, /requireOfficeCommunicationKey/);
  assert.match(routes, /router\.post\("\/office-internal\/session", requireAuth, requirePermission\("office\.manage"\)/);
  assert.match(routes, /router\.post\("\/support\/session", requireAuth, requirePermission\("support\.assign"\)/);
  assert.doesNotMatch(routes, /body\.permissions|actor\.permissions|permission_scopes:\s*permissions/);
  assert.match(app, /app\.use\("\/communications", communicationsRoutes\)/);
  assert.match(routes, /microphone_consent/);
  assert.match(routes, /camera_consent/);
  assert.match(routes, /visual_analysis_consent/);
});

await check("Shared communications session runtime supports non-community surfaces without DB migrations", async () => {
  const { CommunicationsLiveService } = await import("../dist/services/communications/communicationsLiveService.js");
  const publicSession = await CommunicationsLiveService.start({
    sessionId: "smoke-office-public",
    surface: "office_public",
    purpose: "public_voice",
    scopeType: "office_public_session",
    scopeId: "public-session-1",
    ownerId: "public-session-1",
    mediaMode: "audio_video",
  });
  const supportSession = await CommunicationsLiveService.start({
    sessionId: "smoke-support",
    surface: "support",
    purpose: "support_call",
    scopeType: "support_thread",
    scopeId: "support-thread-1",
    ownerId: "support-agent-1",
    mediaMode: "voice",
  });
  assert.equal(publicSession.surface, "office_public");
  assert.equal(supportSession.surface, "support");
  assert.equal(CommunicationsLiveService.get("smoke-office-public").surface, "office_public");
  assert.equal(CommunicationsLiveService.get("smoke-support").surface, "support");
});

await check("Surface policy denies privileged surfaces without verified permissions", async () => {
  const { canUseCommunicationSurface } = await import("../dist/services/communications/communicationsPolicy.js");
  assert.equal(canUseCommunicationSurface({ surface: "office_public", action: "session.create", actor: null }), true);
  assert.equal(canUseCommunicationSurface({ surface: "office_internal", action: "session.create", actor: { role: "guest", permissions: [] } }), false);
  assert.equal(canUseCommunicationSurface({ surface: "support", action: "session.create", actor: { role: "resident", permissions: ["support.read"] } }), false);
  assert.equal(canUseCommunicationSurface({ surface: "support", action: "session.create", actor: { role: "facility_manager", permissions: ["support.assign"] } }), true);
});

console.log("communications-layer-smoke passed");
