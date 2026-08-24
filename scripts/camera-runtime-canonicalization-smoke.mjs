import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
for (const path of [
  "src/services/hlsStreamManager.ts",
  "src/services/lprBridge.ts",
  "src/device/cameras/cameraOrchestrator.ts",
  "src/device/adapters/onvif/OnvifAdapter.ts",
]) assert.equal(fs.existsSync(path), false, `superseded runtime remains: ${path}`);

const cameraRoutes = read("src/routes/cameras.ts");
const controller = read("src/controllers/camerasController.ts");
const adapters = read("src/device/adapters/initAdapters.ts");
const playback = read("packages/oyi-camera-core/src/core.ts") + read("packages/oyi-camera-core/src/react.ts") + read("src/modules/cameras/cameraPlayback.service.ts");
const intel = read("src/controllers/cameraIntelController.ts");
assert.doesNotMatch(cameraRoutes, /["']\/scan["']/);
assert.doesNotMatch(controller, /ALLOW_CLOUD_CAMERA_SCAN|scanCameras/);
assert.doesNotMatch(adapters, /new OnvifAdapter/);
assert.match(adapters, /edge_runtime_only/);
assert.doesNotMatch(playback, /rewindSeconds|start_offset|params:\s*\{\s*rewind/);
assert.match(intel, /face_recognition:\s*"unavailable"/);
assert.match(read("docs/OYI_CAMERA_RUNTIME_ARCHITECTURE.md"), /DO NOT CREATE PARALLEL CAMERA RUNTIMES/);
console.log("Camera runtime canonicalization smoke passed");
