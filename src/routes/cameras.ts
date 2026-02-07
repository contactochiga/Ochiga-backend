// src/routes/cameras.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import * as CamerasCtrl from "../controllers/camerasController";
import * as CameraStreamCtrl from "../controllers/cameraStreamController";

const router = Router();

/**
 * Allow all roles that can view CCTV in facility ops
 */
const CAMERA_ALLOWED_ROLES = [
  "admin",
  "estate_admin",
  "owner",
  "manager",
  "operator",
  "security",
  "staff",
  "member",
  "viewer",
] as const;

router.post(
  "/scan",
  requireAuth,
  requireRole(...CAMERA_ALLOWED_ROLES),
  CamerasCtrl.scan
);

router.get(
  "/estate/:estateId",
  requireAuth,
  requireRole(...CAMERA_ALLOWED_ROLES),
  CamerasCtrl.listByEstate
);

router.post(
  "/bind",
  requireAuth,
  requireRole(...CAMERA_ALLOWED_ROLES),
  CamerasCtrl.bind
);

// ✅ NEW: bind from edge discovery (no browser discovery, no rtsp_url required from UI)
router.post(
  "/bind-from-discovery",
  requireAuth,
  requireRole(...CAMERA_ALLOWED_ROLES),
  CamerasCtrl.bindFromDiscovery
);

router.get(
  "/:cameraId/hls.m3u8",
  requireAuth,
  requireRole(...CAMERA_ALLOWED_ROLES),
  CameraStreamCtrl.hlsPlaylist
);

router.get(
  "/:cameraId/hls/:seg",
  requireAuth,
  requireRole(...CAMERA_ALLOWED_ROLES),
  CameraStreamCtrl.hlsSegment
);

export default router;
