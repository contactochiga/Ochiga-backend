// src/routes/cameras.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import * as CamerasCtrl from "../controllers/camerasController";
import * as CameraStreamCtrl from "../controllers/cameraStreamController";

const router = Router();

// Facility: scan cameras on LAN
router.post(
  "/scan",
  requireAuth,
  requireRole("manager", "estate_admin", "admin"),
  CamerasCtrl.scan
);

// List bound cameras
router.get(
  "/estate/:estateId",
  requireAuth,
  requireRole("manager", "estate_admin", "admin"),
  CamerasCtrl.listByEstate
);

// Bind/save a camera
router.post(
  "/bind",
  requireAuth,
  requireRole("manager", "estate_admin", "admin"),
  CamerasCtrl.bind
);

// HLS stream endpoints (browser plays these)
router.get(
  "/:cameraId/hls.m3u8",
  requireAuth,
  requireRole("manager", "estate_admin", "admin"),
  CameraStreamCtrl.hlsPlaylist
);

router.get(
  "/:cameraId/hls/:seg",
  requireAuth,
  requireRole("manager", "estate_admin", "admin"),
  CameraStreamCtrl.hlsSegment
);

export default router;
