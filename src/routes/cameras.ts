// src/routes/cameras.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/auth";
import * as CamerasCtrl from "../controllers/camerasController";
import * as CameraStreamCtrl from "../controllers/cameraStreamController";

const router = Router();

/**
 * ✅ Facility camera permissions
 * We allow the operational roles that should see/control CCTV.
 *
 * NOTE:
 * - Keep "admin" (platform/system admin)
 * - Keep "manager" (facility manager)
 * - Add "owner" and "security" (common facility roles)
 * - Keep "estate_admin" only if your token ever uses it
 */
const CAMERA_ALLOWED_ROLES = [
  "admin",
  "owner",
  "manager",
  "security",
  "estate_admin",
] as const;

// Facility: scan cameras on LAN
router.post(
  "/scan",
  requireAuth,
  requireRole(...CAMERA_ALLOWED_ROLES),
  CamerasCtrl.scan
);

// List bound cameras
router.get(
  "/estate/:estateId",
  requireAuth,
  requireRole(...CAMERA_ALLOWED_ROLES),
  CamerasCtrl.listByEstate
);

// Bind/save a camera
router.post(
  "/bind",
  requireAuth,
  requireRole(...CAMERA_ALLOWED_ROLES),
  CamerasCtrl.bind
);

// HLS stream endpoints (browser plays these)
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
