// src/routes/facilityDevices.routes.ts

import express from "express";
import { requireAuth, requirePermission } from "../middleware/auth";

import { discoverDevices } from "../controllers/deviceDiscoveryController";
import { requestDeviceCommand } from "../controllers/deviceCommandController";
import { updateDeviceLocation, getDevicesNearPoint } from "../controllers/deviceGeoController";

import {
  listRegisteredDevices,
  registerDevice,
  assignDevice,
} from "../controllers/deviceRegistryController";
import {
  getFacilityInfrastructure,
  syncFacilityTuyaProvider,
} from "../controllers/facilityInfrastructureController";

const router = express.Router();

/**
 * FACILITY DEVICE CONTROL PLANE
 * Base path: /facility/devices
 *
 * Discovery example:
 *   GET /facility/devices/discover?adapter=tuya
 *   GET /facility/devices/discover?adapter=ssdp
 * Camera/ONVIF discovery is intentionally excluded: Oyi Edge executes private-LAN discovery.
 */

/** Discover */
router.get("/discover", requireAuth, requirePermission("devices.read"), discoverDevices);

/** Registry */
router.get("/operations", requireAuth, requirePermission("devices.read"), getFacilityInfrastructure);
router.post("/providers/tuya/sync", requireAuth, requirePermission("devices.read"), syncFacilityTuyaProvider);
router.get("/", requireAuth, requirePermission("devices.read"), listRegisteredDevices);
router.post("/register", requireAuth, requirePermission("devices.control"), registerDevice);
router.patch("/:deviceId/assign", requireAuth, requirePermission("devices.control"), assignDevice);

/** Commands (queued into signal plane) */
router.post("/:deviceId/command", requireAuth, requirePermission("devices.control"), requestDeviceCommand);

/** Geo / Placement */
router.patch("/:deviceId/location", requireAuth, requirePermission("devices.control"), updateDeviceLocation);
router.get("/near", requireAuth, requirePermission("devices.read"), getDevicesNearPoint);

export default router;
