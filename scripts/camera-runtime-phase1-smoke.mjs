import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const stream = read("src/controllers/cameraStreamController.ts");
const routes = read("src/routes/cameras.ts");
const edge = read("src/middleware/edgeToken.ts");
const edgePolicySource = read("src/modules/cameras/edgeIdentityPolicy.ts");
const mediaPolicySource = read("src/modules/cameras/cameraMediaPolicy.ts");
const command = read("src/ai/commandRouter.ts");
const migration = read("supabase/migrations/20260824120000_camera_runtime_phase1_hardening.sql");
const serializer = read("src/modules/cameras/cameraSerialization.ts");

assert.match(stream, /assertAuthorizedMediaUrl/);
assert.match(mediaPolicySource, /target\.hostname !== configured\.hostname/);
assert.match(mediaPolicySource, /target\.port !== configured\.port/);
assert.match(mediaPolicySource, /target\.pathname\.startsWith\(configuredBase\)/);
assert.match(stream, /redirect: "manual"/);
assert.match(stream, /assertAuthorizedMediaUrl\(redirected/);
assert.match(stream, /URI="\(\[\^"\]\+\)"/);
assert.doesNotMatch(stream, /fetch\(url, \{ redirect: "follow" \}\)/);

for (const path of ["/dvrs/test", "/dvrs/import", "/bind", "/bind-from-discovery", "/:cameraId/validate-stream", "/:cameraId/events"]) {
  const at = path === "/:cameraId/events" ? routes.lastIndexOf(`"${path}"`) : routes.indexOf(`"${path}"`);
  assert(at >= 0, `missing ${path}`);
  assert.match(routes.slice(at, at + 240), /requirePermission\("cameras\.manage"\)/, `${path} must require camera management`);
}
assert.match(edge, /resolveEdgeIdentity/);
assert.match(edgePolicySource, /OYI_EDGE_AGENT_IDENTITIES/);
assert.match(edgePolicySource, /requestedSiteId !== configured\.site_id/);
assert.match(edgePolicySource, /requestedAgentId !== configured\.agent_id/);
assert.match(edgePolicySource, /OYI_EDGE_ALLOW_LEGACY_TOKEN/);
assert.match(command, /camera_events"[\s\S]{0,140}order\("created_at"/);
assert.match(migration, /camera_infrastructure_canonical_camera_fk/);
assert.match(migration, /not valid/i);
assert.match(migration, /enable row level security/);
assert.match(migration, /to_regclass\('public\.' \|\| relation_name\)/);
assert.match(migration, /revoke all on table public\.%I from anon, authenticated/);
assert.match(serializer, /password/);
assert.match(serializer, /rtsp_url/);

const { assertAuthorizedMediaUrl } = await import(`${process.cwd()}/dist/modules/cameras/cameraMediaPolicy.js`);
assert.equal(assertAuthorizedMediaUrl("segment.ts?part=1", "https://edge.example/live/cam/index.m3u8"), "https://edge.example/live/cam/segment.ts?part=1");
assert.throws(() => assertAuthorizedMediaUrl("https://evil.example/segment.ts", "https://edge.example/live/cam/index.m3u8"), /media_origin_mismatch/);
assert.throws(() => assertAuthorizedMediaUrl("http://127.0.0.1/internal", "https://edge.example/live/cam/index.m3u8"), /media_origin_mismatch/);
assert.throws(() => assertAuthorizedMediaUrl("http://169.254.169.254/latest/meta-data", "https://edge.example/live/cam/index.m3u8"), /media_origin_mismatch/);
assert.throws(() => assertAuthorizedMediaUrl("https://edge.example/other/segment.ts", "https://edge.example/live/cam/index.m3u8"), /media_path_mismatch/);
assert.throws(() => assertAuthorizedMediaUrl("%zz", "not a url"), /invalid_media_url/);

process.env.OYI_EDGE_AGENT_IDENTITIES = JSON.stringify([{ token: "edge-a-secret", agent_id: "edge-a", site_id: "site-a" }, { token: "revoked", agent_id: "edge-r", site_id: "site-r", enabled: false }]);
delete process.env.OYI_EDGE_ALLOW_LEGACY_TOKEN;
const { resolveEdgeIdentity } = await import(`${process.cwd()}/dist/modules/cameras/edgeIdentityPolicy.js`);
assert.equal(resolveEdgeIdentity("edge-a-secret", "edge-a", "site-a")?.siteId, "site-a");
assert.equal(resolveEdgeIdentity("edge-a-secret", "edge-a", "site-b"), null);
assert.equal(resolveEdgeIdentity("edge-a-secret", "edge-b", "site-a"), null);
assert.equal(resolveEdgeIdentity("unknown", "edge-a", "site-a"), null);
assert.equal(resolveEdgeIdentity("revoked", "edge-r", "site-r"), null);

const { canAccessCamera } = await import(`${process.cwd()}/dist/modules/cameras/cameraAccess.policy.js`);
const facilityCamera = { estate_id: "estate-a", privacy_scope: "facility" };
const homeCamera = { estate_id: "estate-a", privacy_scope: "home", home_id: "home-a" };
assert.equal(canAccessCamera(facilityCamera, { id: "operator-a", role: "facility_manager", estate_id: "estate-a" }).ok, true);
assert.equal(canAccessCamera(facilityCamera, { id: "operator-b", role: "facility_manager", estate_id: "estate-b" }).ok, false);
assert.equal(canAccessCamera(facilityCamera, { id: "operator-none", role: "facility_manager" }).ok, false);
assert.equal(canAccessCamera(homeCamera, { id: "resident-a", role: "resident", estate_id: "estate-a", home_id: "home-a" }).ok, true);
assert.equal(canAccessCamera(homeCamera, { id: "resident-b", role: "resident", estate_id: "estate-a", home_id: "home-b" }).ok, false);

const jwt = (await import("jsonwebtoken")).default;
const { issueCameraPlaybackToken, verifyCameraPlaybackToken } = await import(`${process.cwd()}/dist/modules/cameras/cameraPlayback.service.js`);
const playbackSecret = "phase-1-test-secret";
const validToken = issueCameraPlaybackToken({ id: "operator-a", role: "facility_manager", estate_id: "estate-a" }, { id: "camera-a", estate_id: "estate-a" }, playbackSecret);
assert.equal(verifyCameraPlaybackToken(validToken, playbackSecret)?.camera_id, "camera-a");
assert.notEqual(verifyCameraPlaybackToken(validToken, playbackSecret)?.camera_id, "camera-b");
const expiredToken = jwt.sign({ id: "operator-a", role: "facility_manager", estate_id: "estate-a", camera_id: "camera-a" }, playbackSecret, { expiresIn: -1 });
assert.equal(verifyCameraPlaybackToken(expiredToken, playbackSecret), null);

const { sanitizeCameraRecord } = await import(`${process.cwd()}/dist/modules/cameras/cameraSerialization.js`);
const safeCamera = sanitizeCameraRecord({ id: "camera-a", password: "do-not-return", rtsp_url: "rtsp://user:pass@10.0.0.2/live", metadata: { username: "admin", nested: { token: "secret", location: "Gate" } } });
assert.deepEqual(safeCamera, { id: "camera-a", metadata: { nested: { location: "Gate" } } });

console.log("camera runtime Phase 1 security and compatibility smoke checks passed");
