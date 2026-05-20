// src/routes/devices.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { discoverDevices } from "../controllers/deviceDiscoveryController";
import { getDeviceState } from "../controllers/deviceStateController";
import { assignDevices } from "../controllers/deviceAssignController";
import { requestDeviceCommand } from "../controllers/deviceCommandController";
import { getEstateDevices } from "../controllers/deviceEstateController"; // ✅ add

const router = Router();

router.get("/discover", requireAuth, requirePermission("devices.read"), discoverDevices);
router.post("/assign", requireAuth, requirePermission("devices.control"), assignDevices);

// ✅ THIS WAS MISSING (your frontend calls it)
router.get("/estate/:estateId", requireAuth, requirePermission("devices.read"), getEstateDevices);

router.post("/:deviceId/command", requireAuth, requirePermission("devices.control"), requestDeviceCommand);
router.get("/:deviceId/state", requireAuth, requirePermission("devices.read"), getDeviceState);

export default router;
