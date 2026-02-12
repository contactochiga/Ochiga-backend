// src/routes/devices.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { discoverDevices } from "../controllers/deviceDiscoveryController";
import { getDeviceState } from "../controllers/deviceStateController";
import { assignDevices } from "../controllers/deviceAssignController";
import { requestDeviceCommand } from "../controllers/deviceCommandController";
import { getEstateDevices } from "../controllers/deviceEstateController"; // ✅ add

const router = Router();

router.get("/discover", requireAuth, discoverDevices);
router.post("/assign", requireAuth, assignDevices);

// ✅ THIS WAS MISSING (your frontend calls it)
router.get("/estate/:estateId", requireAuth, getEstateDevices);

router.post("/:deviceId/command", requireAuth, requestDeviceCommand);
router.get("/:deviceId/state", requireAuth, getDeviceState);

export default router;
