// src/routes/devices.ts

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { discoverDevices } from "../controllers/deviceDiscoveryController";
import { getDeviceState } from "../controllers/deviceStateController";

const router = Router();

/**
 * Adapter-based device discovery
 *
 * Example:
 *   GET /devices/discover?adapter=tuya
 */
router.get("/discover", requireAuth, discoverDevices);

/**
 * ✅ Device state fetch (for SensorsPanel + initial remote state)
 *
 * Example:
 *   GET /devices/:deviceId/state
 */
router.get("/:deviceId/state", requireAuth, getDeviceState);

export default router;
