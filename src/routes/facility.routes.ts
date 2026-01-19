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

const router = express.Router();

/**
 * Overview (requires user to have estate_id, otherwise controller returns 400)
 */
router.get("/overview", requireAuth, getFacilityOverview);

/**
 * Estates
 * ✅ Any authenticated user can create an estate (bootstrap).
 */
router.post("/estates", requireAuth, createEstate);
router.get("/estates", requireAuth, listMyEstates);

/**
 * Homes (Units)
 * ✅ Controller enforces estate membership via assertCanManageEstate()
 */
router.post("/homes", requireAuth, createHome);
router.get("/estates/:estateId/homes", requireAuth, listEstateHomes);

/**
 * Rooms
 */
router.post("/rooms", requireAuth, createRoom);
router.get("/homes/:homeId/rooms", requireAuth, listHomeRooms);

/**
 * Invites
 */
router.post("/invites", requireAuth, inviteUser);
router.post("/invites/accept", requireAuth, acceptInvite);

/**
 * Room assignment
 */
router.post("/rooms/assign", requireAuth, assignUserToRoom);

export default router;
