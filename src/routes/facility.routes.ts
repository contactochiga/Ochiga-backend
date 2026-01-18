// src/routes/facility.routes.ts
import express from "express";
import { requireAuth, requireRole } from "../middleware/auth";
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

const router = express.Router();

/**
 * Existing
 */
router.get("/overview", requireAuth, getFacilityOverview);

/**
 * ---------------------------
 * CREATION MODEL (Facility)
 * ---------------------------
 * Roles:
 * - platform_admin/admin: can do everything
 * - estate_admin/manager: can manage their estates
 */

/** Estates */
router.post("/estates", requireAuth, requireRole("admin", "estate_admin", "manager"), createEstate);
router.get("/estates", requireAuth, listMyEstates);

/** Homes (Units) */
router.post("/homes", requireAuth, requireRole("admin", "estate_admin", "manager"), createHome);
router.get("/estates/:estateId/homes", requireAuth, listEstateHomes);

/** Rooms */
router.post("/rooms", requireAuth, requireRole("admin", "estate_admin", "manager"), createRoom);
router.get("/homes/:homeId/rooms", requireAuth, listHomeRooms);

/** Invites (Estate/Home membership) */
router.post("/invites", requireAuth, requireRole("admin", "estate_admin", "manager"), inviteUser);

/** Accept invite (Resident/Member finishes join) */
router.post("/invites/accept", requireAuth, acceptInvite);

/** Room assignment */
router.post("/rooms/assign", requireAuth, requireRole("admin", "estate_admin", "manager"), assignUserToRoom);

export default router;
