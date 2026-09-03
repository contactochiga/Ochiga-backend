// src/routes/cameras.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
import { cameraAccessActor } from "../modules/cameras/cameraAccess.policy";
import { auditOnSuccess } from "../middleware/audit";
import * as CamerasCtrl from "../controllers/camerasController";
import * as CameraStreamCtrl from "../controllers/cameraStreamController";
import * as CameraIntelCtrl from "../controllers/cameraIntelController";
import * as CameraMediaCtrl from "../controllers/cameraMediaController";
import * as CameraDetectionCtrl from "../controllers/cameraDetectionController";

const router = Router();

// HLS requests cannot carry the normal Authorization header. Their short-lived
// camera token is issued from the resolved context below and checked again by
// the proxy for every playlist/segment request.
router.get("/:cameraId/hls.m3u8", CameraStreamCtrl.hlsPlaylist);
router.get("/:cameraId/hls/:seg", CameraStreamCtrl.hlsSegment);

// All remaining camera access is membership-context aware. This is deliberately
// route-wide so media, detection and playback do not drift from camera listing.
router.use(requireAuth, resolveRequestContext, (req, _res, next) => {
  // Downstream camera controllers and media helpers historically read req.user.
  // Replace only its scope fields with the resolver-approved active context so
  // every existing camera access check receives one canonical actor.
  req.user = cameraAccessActor(req.user as any, req.oisContext) as any;
  next();
});

router.get(
  "/estate/:estateId",
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "estate", "estateId"),
  CamerasCtrl.listByEstate
);

router.get(
  "/home/:homeId",
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "home", "homeId"),
  CamerasCtrl.listByHome
);

router.get(
  "/inventory/estate/:estateId",
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "estate", "estateId"),
  CamerasCtrl.inventoryByEstate
);

router.get(
  "/edge-registry/estate/:estateId",
  requirePermission("cameras.view"),
  CamerasCtrl.edgeRegistry
);

router.get(
  "/dvrs/estate/:estateId",
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "estate", "estateId"),
  CamerasCtrl.listDvrsByEstate
);

router.post(
  "/dvrs/test",
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "dvr", "estateId"),
  CamerasCtrl.testDvrConnection
);

router.post(
  "/dvrs/import",
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "dvr", "estateId"),
  CamerasCtrl.importDvr
);

router.post(
  "/bind",
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CamerasCtrl.bind
);

// ✅ NEW: bind from edge discovery
router.post(
  "/bind-from-discovery",
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CamerasCtrl.bindFromDiscovery
);

router.get(
  "/reports/security",
  requirePermission("cameras.view"),
  CameraIntelCtrl.getSecurityReport
);

router.get(
  "/:cameraId/playback",
  requirePermission("cameras.view"),
  auditOnSuccess("camera.viewed", "camera", "cameraId"),
  CameraIntelCtrl.getPlaybackUrl
);

router.post(
  "/:cameraId/validate-stream",
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CamerasCtrl.validateStream
);

router.get(
  "/:cameraId/events",
  requirePermission("cameras.view"),
  CameraIntelCtrl.listEvents
);
router.get("/:cameraId/media",requirePermission("cameras.view"),CameraMediaCtrl.listCameraMedia);
router.get("/:cameraId/detections",requirePermission("cameras.view"),CameraDetectionCtrl.listCameraDetections);
router.get("/:cameraId/detection-zones",requirePermission("cameras.view"),CameraDetectionCtrl.listDetectionZones);
router.put("/:cameraId/detection-zones",requirePermission("cameras.manage"),CameraDetectionCtrl.upsertDetectionZone);
router.post("/:cameraId/snapshot",requirePermission("cameras.view"),CameraMediaCtrl.requestSnapshot);
router.get("/events/:eventId/media",requirePermission("cameras.view"),CameraMediaCtrl.listEventMedia);
router.get("/events/:eventId/detections",requirePermission("cameras.view"),CameraDetectionCtrl.listEventDetections);
router.post("/media/:mediaId/access",requirePermission("cameras.view"),CameraMediaCtrl.createMediaAccess);
router.post("/media/:mediaId/preserve",requirePermission("cameras.manage"),CameraMediaCtrl.preserveMedia);
router.get("/:cameraId/recording-policy",requirePermission("cameras.view"),CameraMediaCtrl.getRecordingPolicy);
router.put("/:cameraId/recording-policy",requirePermission("cameras.manage"),CameraMediaCtrl.putRecordingPolicy);

router.post(
  "/:cameraId/events",
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CameraIntelCtrl.createEvent
);

router.get(
  "/analytics/capabilities",
  requirePermission("cameras.view"),
  CameraIntelCtrl.getAnalyticsCapabilities
);

router.get(
  "/:cameraId/ai/profile",
  requirePermission("cameras.view"),
  CameraIntelCtrl.getAiProfile
);

router.put(
  "/:cameraId/ai/profile",
  requirePermission("cameras.manage"),
  auditOnSuccess("camera.action.requested", "camera", "cameraId"),
  CameraIntelCtrl.upsertAiProfile
);

export default router;
