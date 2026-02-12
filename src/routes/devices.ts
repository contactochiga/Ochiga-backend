// src/routes/devices.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { discoverDevices } from "../controllers/deviceDiscoveryController";
import { getDeviceState } from "../controllers/deviceStateController";
import { assignDevices } from "../controllers/deviceAssignController";
import { requestDeviceCommand } from "../controllers/deviceCommandController";
import { getEstateDevices } from "../controllers/deviceEstateController"; // ✅ NEW

const router = Router();

/**
 * Adapter-based device discovery
 * GET /devices/discover?adapter=tuya
 * ✅ adapter defaults to tuya
 */
router.get("/discover", requireAuth, discoverDevices);

/**
 * ✅ NEW: Devices bound/available for an estate
 * GET /devices/estate/:estateId
 * Your frontend is calling this — without it you’ll always get 404.
 */
router.get("/estate/:estateId", requireAuth, getEstateDevices);

/**
 * Claim discovered devices into user's home context
 * POST /devices/assign
 */
router.post("/assign", requireAuth, assignDevices);

/**
 * Send command to a device
 * POST /devices/:deviceId/command
 * body: { command: Record<string, any> }
 */
router.post("/:deviceId/command", requireAuth, requestDeviceCommand);

/**
 * Device state fetch
 * GET /devices/:deviceId/state
 */
router.get("/:deviceId/state", requireAuth, getDeviceState);

export default router;
