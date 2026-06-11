// src/routes/cameras.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import * as CamerasCtrl from "../controllers/camerasController";
import * as CameraStreamCtrl from "../controllers/cameraStreamController";
import * as CameraIntelCtrl from "../controllers/cameraIntelController";

const router = Router();

router.post(
  "/scan",
  requireAuth,
  requirePermission("cameras.view"),
  auditOnSuccess("camera.action.requested", "camera_scan", "scan"),
  CamerasCtrl.scan
);

router.get(
  "/estate/:estateId",
  requireAuth,
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "estate", "estateId"),
  CamerasCtrl.listByEstate
);

router.get(
  "/home/:homeId",
  requireAuth,
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "home", "homeId"),
  CamerasCtrl.listByHome
);

router.get(
  "/inventory/estate/:estateId",
  requireAuth,
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "estate", "estateId"),
  CamerasCtrl.inventoryByEstate
);

router.get(
  "/edge-registry/estate/:estateId",
  requireAuth,
  requirePermission("cameras.view"),
  CamerasCtrl.edgeRegistry
);

router.get(
  "/dvrs/estate/:estateId",
  requireAuth,
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "estate", "estateId"),
  CamerasCtrl.listDvrsByEstate
);

router.post(
  "/dvrs/test",
  requireAuth,
  requirePermission("devices.control"),
  auditOnSuccess("camera.action.requested", "dvr", "estateId"),
  CamerasCtrl.testDvrConnection
);

router.post(
  "/dvrs/import",
  requireAuth,
  requirePermission("devices.control"),
  auditOnSuccess("camera.action.requested", "dvr", "estateId"),
  CamerasCtrl.importDvr
);

router.post(
  "/bind",
  requireAuth,
  requirePermission("devices.control"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CamerasCtrl.bind
);

// ✅ NEW: bind from edge discovery
router.post(
  "/bind-from-discovery",
  requireAuth,
  requirePermission("devices.control"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CamerasCtrl.bindFromDiscovery
);

router.get(
  "/reports/security",
  requireAuth,
  requirePermission("cameras.view"),
  CameraIntelCtrl.getSecurityReport
);

/**
 * ✅ NEW: issue short-lived HLS token for this camera
 * UI calls this with Bearer token, then appends ?token=... to playlist/segments.
 */
router.get(
  "/:cameraId/hls-token",
  requireAuth,
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "camera", "cameraId"),
  CameraStreamCtrl.issueHlsToken
);

router.get(
  "/:cameraId/playback",
  requireAuth,
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "camera", "cameraId"),
  CameraIntelCtrl.getPlaybackUrl
);

router.post(
  "/:cameraId/validate-stream",
  requireAuth,
  requirePermission("cameras.view"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CamerasCtrl.validateStream
);

router.get(
  "/:cameraId/events",
  requireAuth,
  requirePermission("cameras.view"),
  CameraIntelCtrl.listEvents
);

router.post(
  "/:cameraId/events",
  requireAuth,
  requirePermission("cameras.view"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CameraIntelCtrl.createEvent
);

router.get(
  "/analytics/capabilities",
  requireAuth,
  requirePermission("cameras.view"),
  CameraIntelCtrl.getAnalyticsCapabilities
);

router.get(
  "/:cameraId/ai/profile",
  requireAuth,
  requirePermission("cameras.view"),
  CameraIntelCtrl.getAiProfile
);

router.put(
  "/:cameraId/ai/profile",
  requireAuth,
  requirePermission("devices.control"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CameraIntelCtrl.upsertAiProfile
);

/**
 * ✅ HLS routes must NOT require Bearer auth
 * HLS requests won't send Authorization headers.
 * We secure them with query token inside controller.
 */
router.get("/:cameraId/hls.m3u8", CameraStreamCtrl.hlsPlaylist);
router.get("/:cameraId/hls/:seg", CameraStreamCtrl.hlsSegment);

export default router;
