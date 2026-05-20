import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { updateDeviceLocation, getDevicesNearPoint } from "../controllers/deviceGeoController";

const router = Router();

// device installs or updates location
router.post("/:deviceId/update", requireAuth, requirePermission("devices.control"), updateDeviceLocation);

// query all devices around a coordinate
router.get("/near", requireAuth, requirePermission("devices.read"), getDevicesNearPoint);

export default router;
