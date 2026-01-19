import express from "express";
import { requireAuth } from "../middleware/auth";
import { discoverDevices } from "../controllers/deviceDiscoveryController";
import { requestDeviceCommand } from "../controllers/deviceCommandController";
import { updateDeviceLocation, getDevicesNearPoint } from "../controllers/deviceGeoController";

const router = express.Router();

/**
 * FACILITY DEVICE CONTROL PLANE
 * Base path: /facility/devices
 *
 * Discovery example:
 *   GET /facility/devices/discover?adapter=tuya
 */
router.get("/discover", requireAuth, discoverDevices);

/**
 * Commands (queued into signal plane)
 *   POST /facility/devices/:deviceId/command
 */
router.post("/:deviceId/command", requireAuth, requestDeviceCommand);

/**
 * Geo / Placement
 *   PATCH /facility/devices/:deviceId/location
 *   GET   /facility/devices/near?lat=...&lng=...&radius=100
 */
router.patch("/:deviceId/location", requireAuth, updateDeviceLocation);
router.get("/near", requireAuth, getDevicesNearPoint);

export default router;
