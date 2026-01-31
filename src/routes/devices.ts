// src/routes/devices.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { discoverDevices } from "../controllers/deviceDiscoveryController";
import { getDeviceState } from "../controllers/deviceStateController";
import { assignDevices } from "../controllers/deviceAssignController"; // ✅ NEW

const router = Router();

/**
 * Adapter-based device discovery
 * Example:
 *   GET /devices/discover?adapter=tuya
 * ✅ adapter defaults to tuya now
 */
router.get("/discover", requireAuth, discoverDevices);

/**
 * ✅ Assign/claim discovered devices into user's home context
 * POST /devices/assign
 * body: { devices?: any[], deviceIds?: string[], room?: string|null }
 */
router.post("/assign", requireAuth, assignDevices); // ✅ NEW

/**
 * ✅ Device state fetch
 * GET /devices/:deviceId/state
 */
router.get("/:deviceId/state", requireAuth, getDeviceState);

export default router;
