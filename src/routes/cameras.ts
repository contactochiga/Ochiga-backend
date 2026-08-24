// src/routes/cameras.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import * as CamerasCtrl from "../controllers/camerasController";
import * as CameraStreamCtrl from "../controllers/cameraStreamController";
import * as CameraIntelCtrl from "../controllers/cameraIntelController";
import * as CameraMediaCtrl from "../controllers/cameraMediaController";
import * as CameraDetectionCtrl from "../controllers/cameraDetectionController";

const router = Router();

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
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "dvr", "estateId"),
  CamerasCtrl.testDvrConnection
);

router.post(
  "/dvrs/import",
  requireAuth,
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "dvr", "estateId"),
  CamerasCtrl.importDvr
);

router.post(
  "/bind",
  requireAuth,
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CamerasCtrl.bind
);

// ✅ NEW: bind from edge discovery
router.post(
  "/bind-from-discovery",
  requireAuth,
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CamerasCtrl.bindFromDiscovery
);

router.get(
  "/reports/security",
  requireAuth,
  requirePermission("cameras.view"),
  CameraIntelCtrl.getSecurityReport
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
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CamerasCtrl.validateStream
);

router.get(
  "/:cameraId/events",
  requireAuth,
  requirePermission("cameras.view"),
  CameraIntelCtrl.listEvents
);
router.get("/:cameraId/media",requireAuth,requirePermission("cameras.view"),CameraMediaCtrl.listCameraMedia);
router.get("/:cameraId/detections",requireAuth,requirePermission("cameras.view"),CameraDetectionCtrl.listCameraDetections);
router.get("/:cameraId/detection-zones",requireAuth,requirePermission("cameras.view"),CameraDetectionCtrl.listDetectionZones);
router.put("/:cameraId/detection-zones",requireAuth,requirePermission("cameras.manage"),CameraDetectionCtrl.upsertDetectionZone);
router.post("/:cameraId/snapshot",requireAuth,requirePermission("cameras.view"),CameraMediaCtrl.requestSnapshot);
router.get("/events/:eventId/media",requireAuth,requirePermission("cameras.view"),CameraMediaCtrl.listEventMedia);
router.get("/events/:eventId/detections",requireAuth,requirePermission("cameras.view"),CameraDetectionCtrl.listEventDetections);
router.post("/media/:mediaId/access",requireAuth,requirePermission("cameras.view"),CameraMediaCtrl.createMediaAccess);
router.post("/media/:mediaId/preserve",requireAuth,requirePermission("cameras.manage"),CameraMediaCtrl.preserveMedia);
router.get("/:cameraId/recording-policy",requireAuth,requirePermission("cameras.view"),CameraMediaCtrl.getRecordingPolicy);
router.put("/:cameraId/recording-policy",requireAuth,requirePermission("cameras.manage"),CameraMediaCtrl.putRecordingPolicy);

router.post(
  "/:cameraId/events",
  requireAuth,
  requirePermission("cameras.manage"),
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
  requirePermission("cameras.manage"),
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
