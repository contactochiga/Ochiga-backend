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
 */

/** Estates
 * ✅ Any authenticated user can create an estate (bootstrap).
 * They become "owner" automatically inside createEstate().
 */
router.post("/estates", requireAuth, createEstate);
router.get("/estates", requireAuth, listMyEstates);

/** Homes (Units) */
router.post("/homes", requireAuth, requireRole("admin", "estate_admin", "manager", "owner"), createHome);
router.get("/estates/:estateId/homes", requireAuth, listEstateHomes);

/** Rooms */
router.post("/rooms", requireAuth, requireRole("admin", "estate_admin", "manager", "owner"), createRoom);
router.get("/homes/:homeId/rooms", requireAuth, listHomeRooms);

/** Invites (Estate/Home membership) */
router.post("/invites", requireAuth, requireRole("admin", "estate_admin", "manager", "owner"), inviteUser);

/** Accept invite */
router.post("/invites/accept", requireAuth, acceptInvite);

/** Room assignment */
router.post("/rooms/assign", requireAuth, requireRole("admin", "estate_admin", "manager", "owner"), assignUserToRoom);

export default router;
