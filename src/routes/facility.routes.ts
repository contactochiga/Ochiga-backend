// src/routes/facility.routes.ts
import express from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import { getFacilityOverview } from "../controllers/facilityOverview.controller";

import {
  createEstate,
  listMyEstates,
  createHome,
  updateHome,
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
router.get("/overview", requireAuth, requirePermission("estates.read"), getFacilityOverview);

/**
 * Estates
 */
router.post("/estates", requireAuth, requirePermission("estates.write"), auditOnSuccess("estate.created", "estate", "estate_id"), createEstate);
router.get("/estates", requireAuth, requirePermission("estates.read"), listMyEstates);

/**
 * Homes
 */
router.post("/homes", requireAuth, requirePermission("homes.write"), auditOnSuccess("home.created", "home", "home_id"), createHome);
router.patch("/homes/:homeId", requireAuth, requirePermission("homes.write"), auditOnSuccess("home.updated", "home", "homeId"), updateHome);
router.get("/estates/:estateId/homes", requireAuth, requirePermission("homes.read"), listEstateHomes);

/**
 * Rooms
 */
router.post("/rooms", requireAuth, requirePermission("homes.write"), auditOnSuccess("room.created", "room", "room_id"), createRoom);
router.get("/homes/:homeId/rooms", requireAuth, requirePermission("homes.read"), listHomeRooms);

/**
 * Legacy invite compatibility routes.
 * New resident onboarding must use POST /facility/homes/:homeId/invite.
 */
router.post("/invites", requireAuth, requirePermission("visitors.manage"), inviteUser);
router.post("/invites/accept", requireAuth, auditOnSuccess("user.invite.accepted", "invite", "invite"), acceptInvite);

/**
 * Room assignment
 */
router.post("/rooms/assign", requireAuth, requirePermission("homes.write"), auditOnSuccess("room.updated", "room", "room_id"), assignUserToRoom);

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
router.get("/estate-users", requireAuth, requirePermission("staff.manage"), listEstateUsers);
router.patch("/estate-users/:membershipId", requireAuth, requirePermission("staff.manage"), auditOnSuccess("estate.updated", "estate_membership", "membershipId"), updateEstateUser);
router.delete("/estate-users/:membershipId", requireAuth, requirePermission("staff.manage"), auditOnSuccess("estate.updated", "estate_membership", "membershipId"), removeEstateUser);

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
router.patch("/home-users/:membershipId", requireAuth, requirePermission("staff.manage"), auditOnSuccess("home.updated", "home_membership", "membershipId"), updateHomeUser);
router.delete("/home-users/:membershipId", requireAuth, requirePermission("staff.manage"), auditOnSuccess("home.updated", "home_membership", "membershipId"), removeHomeUser);

export default router;
