// src/routes/facilityDevices.routes.ts

import express from "express";
import { requireAuth } from "../middleware/auth";

import { discoverDevices } from "../controllers/deviceDiscoveryController";
import { requestDeviceCommand } from "../controllers/deviceCommandController";
import { updateDeviceLocation, getDevicesNearPoint } from "../controllers/deviceGeoController";

import {
  listRegisteredDevices,
  registerDevice,
  assignDevice,
} from "../controllers/deviceRegistryController";

const router = express.Router();

/**
 * FACILITY DEVICE CONTROL PLANE
 * Base path: /facility/devices
 *
 * Discovery example:
 *   GET /facility/devices/discover?adapter=tuya
 *   GET /facility/devices/discover?adapter=ssdp
 *   GET /facility/devices/discover?adapter=onvif&cidr=192.168.1.0/24
 */

/** Discover */
router.get("/discover", requireAuth, discoverDevices);

/** Registry */
router.get("/", requireAuth, listRegisteredDevices);
router.post("/register", requireAuth, registerDevice);
router.patch("/:deviceId/assign", requireAuth, assignDevice);

/** Commands (queued into signal plane) */
router.post("/:deviceId/command", requireAuth, requestDeviceCommand);

/** Geo / Placement */
router.patch("/:deviceId/location", requireAuth, updateDeviceLocation);
router.get("/near", requireAuth, getDevicesNearPoint);

export default router;
