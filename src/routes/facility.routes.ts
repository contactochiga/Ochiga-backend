// src/routes/facility.routes.ts
import express from "express";
import { requireAuth } from "../middleware/auth";
import { getFacilityOverview } from "../controllers/facilityOverview.controller";

import {
  createEstate,
  listMyEstates,
  createHome,
  listEstateHomes,
  createRoom,
  listHomeRooms,
  inviteUser,
  acceptInvite,
  assignUserToRoom,
} from "../controllers/facility.controller";

// ✅ FACILITY DEVICE ROUTES (discover, command, geo)
import facilityDevicesRoutes from "./facilityDevices.routes";

// ✅ HOME USERS ROUTES
import homeUsersRoutes from "./homeUsers.routes";
import {
  updateHomeUser,
  removeHomeUser,
} from "../controllers/homeUsers.controller";

// ✅ ESTATE USERS ROUTES
import {
  listEstateUsers,
  updateEstateUser,
  removeEstateUser,
} from "../controllers/estateUsers.controller";

const router = express.Router();

/**
 * Overview
 */
router.get("/overview", requireAuth, getFacilityOverview);

/**
 * Estates
 */
router.post("/estates", requireAuth, createEstate);
router.get("/estates", requireAuth, listMyEstates);

/**
 * Homes
 */
router.post("/homes", requireAuth, createHome);
router.get("/estates/:estateId/homes", requireAuth, listEstateHomes);

/**
 * Rooms
 */
router.post("/rooms", requireAuth, createRoom);
router.get("/homes/:homeId/rooms", requireAuth, listHomeRooms);

/**
 * Invites (estate/home via facility.controller.ts)
 */
router.post("/invites", requireAuth, inviteUser);
router.post("/invites/accept", requireAuth, acceptInvite);

/**
 * Room assignment
 */
router.post("/rooms/assign", requireAuth, assignUserToRoom);

/**
 * ---------------------------
 * FACILITY DEVICES
 * Base: /facility/devices
 * ---------------------------
 */
router.use("/devices", facilityDevicesRoutes);

/**
 * ---------------------------
 * ESTATE USERS (NEW)
 * Base: /facility/estate-users
 * ---------------------------
 */
router.get("/estate-users", requireAuth, listEstateUsers);
router.patch("/estate-users/:membershipId", requireAuth, updateEstateUser);
router.delete("/estate-users/:membershipId", requireAuth, removeEstateUser);

/**
 * ---------------------------
 * HOME USERS (NEW)
 * Base:
 *   /facility/homes/:homeId/users
 *   /facility/homes/:homeId/invite
 *   /facility/home-users/:membershipId
 * ---------------------------
 */
router.use("/homes", homeUsersRoutes);
router.patch("/home-users/:membershipId", requireAuth, updateHomeUser);
router.delete("/home-users/:membershipId", requireAuth, removeHomeUser);

export default router;
