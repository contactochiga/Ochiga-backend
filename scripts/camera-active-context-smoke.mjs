import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const access = await import("../dist/modules/cameras/cameraAccess.policy.js");
const playback = await import("../dist/modules/cameras/cameraPlayback.service.js");

const estateId = "estate-1";
const resident = { id: "resident-1", role: "resident", estate_id: estateId, home_id: "home-a" };
const homeCamera = (id, homeId, metadata = {}) => ({ id, estate_id: estateId, privacy_scope: "home", home_id: homeId, metadata });
const cameraA = homeCamera("camera-a", "home-a");
const cameraB = homeCamera("camera-b", "home-b");
const cameraC = homeCamera("camera-c", "home-c");

// One-home actor: only its resolved Home can see a private camera.
const oneHomeA = access.cameraAccessActor(resident, { estate_id: estateId, home_id: "home-a" });
assert.equal(access.canAccessCamera(cameraA, oneHomeA).ok, true);
assert.equal(access.canAccessCamera(cameraB, oneHomeA).ok, false);

// A legitimate multi-Home member gets the context resolver's selected Home,
// never a client-trusted arbitrary value. The policy receives that resolved actor.
const activeA = access.cameraAccessActor(resident, { estate_id: estateId, home_id: "home-a" });
const activeB = access.cameraAccessActor(resident, { estate_id: estateId, home_id: "home-b" });
assert.equal(access.canAccessCamera(cameraA, activeA).ok, true);
assert.equal(access.canAccessCamera(cameraB, activeA).ok, false);
assert.equal(access.canAccessCamera(cameraB, activeB).ok, true);
assert.equal(access.canAccessCamera(cameraC, activeB).ok, false);

// A selected Home must not turn an ordinary resident into a facility operator.
assert.equal(access.canAccessCamera({ id: "common", estate_id: estateId, privacy_scope: "facility" }, activeB).ok, false);

// Database camera.home_id wins over conflicting legacy metadata. Metadata remains
// a deterministic backward-compatible fallback only when the column is absent.
const conflict = homeCamera("camera-conflict", "home-a", { home_id: "home-b", bound_home_id: "home-c" });
assert.deepEqual(access.cameraHomeAssociation(conflict), {
  id: "home-a",
  source: "column",
  conflicts: [
    { source: "metadata.home_id", id: "home-b" },
    { source: "metadata.bound_home_id", id: "home-c" },
  ],
});
assert.equal(access.cameraHomeAssociation(homeCamera("legacy", null, { bound_home_id: "home-b" })).id, "home-b");

// The HLS token carries the already-resolved active scope and is camera-bound.
const token = playback.issueCameraPlaybackToken(activeB, cameraB, "camera-test-secret");
const tokenActor = playback.verifyCameraPlaybackToken(token, "camera-test-secret");
assert.equal(tokenActor.home_id, "home-b");
assert.equal(tokenActor.camera_id, "camera-b");
assert.equal(access.canAccessCamera(cameraB, tokenActor).ok, true);
assert.equal(access.canAccessCamera(cameraA, tokenActor).ok, false);
assert.notEqual(tokenActor.camera_id, cameraA.id);

// Guard source-level route/proxy contracts too: browser HLS requests use the
// token, and the proxy checks both camera binding and camera authorization.
const [routes, stream, resolver] = await Promise.all([
  readFile(new URL("../src/routes/cameras.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/controllers/cameraStreamController.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/services/context/contextResolutionService.ts", import.meta.url), "utf8"),
]);
assert.match(routes, /router\.use\(requireAuth, resolveRequestContext/);
assert.match(routes, /cameraAccessActor\(req\.user as any, req\.oisContext\)/);
assert.match(resolver, /from\("home_memberships"\)/);
assert.match(stream, /user\.camera_id && String\(user\.camera_id\) !== String\(cameraId\)/);
assert.ok((stream.match(/canAccessCamera\(cam, user\)/g) || []).length >= 2, "playlist and segment authorization must both be checked");

console.log("camera-active-context-smoke: ok");
