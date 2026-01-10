// src/routes/devices.ts

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { discoverDevices } from "../controllers/deviceDiscoveryController";

const router = Router();

/**
 * Adapter-based device discovery
 *
 * Example:
 *   GET /devices/discover?adapter=tuya
 */
router.get("/discover", requireAuth, discoverDevices);

export default router;
