// src/routes/facility.routes.ts
import express from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import { getFacilityOverview } from "../controllers/facilityOverview.controller";

import {
  createEstate,
  updateEstate,
  listMyEstates,
  createBuilding,
  listEstateBuildings,
  createHome,
  updateHome,
  listEstateHomes,
  getEstateStructure,
  createRoom,
  updateRoom,
  listHomeRooms,
  inviteUser,
  acceptInvite,
  assignUserToRoom,
} from "../controllers/facility.controller";
import {
  listEstateInvites,
  createEstateInvite,
  revokeEstateInvite,
  resendEstateInvite,
} from "../controllers/estateInvites.controller";
import { getEstateAuditLog } from "../services/auditQueryService";

// ✅ FACILITY DEVICE ROUTES (discover, command, geo)
import facilityDevicesRoutes from "./facilityDevices.routes";
import platformGapRoutes from "./platformGap.routes";
import infrastructureOnboardingRoutes from "./infrastructureOnboarding.routes";

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
router.patch("/estates/:estateId", requireAuth, requirePermission("settings.manage"), updateEstate);

/**
 * Buildings remain part of the estate registry, not a deployment workspace.
 */
router.post("/buildings", requireAuth, requirePermission("homes.write"), auditOnSuccess("building.created", "building", "building_id"), createBuilding);
router.get("/estates/:estateId/buildings", requireAuth, requirePermission("homes.read"), listEstateBuildings);

/**
 * Homes
 */
router.post("/homes", requireAuth, requirePermission("homes.write"), auditOnSuccess("home.created", "home", "home_id"), createHome);
router.patch("/homes/:homeId", requireAuth, requirePermission("homes.write"), auditOnSuccess("home.updated", "home", "homeId"), updateHome);
router.get("/estates/:estateId/homes", requireAuth, requirePermission("homes.read"), listEstateHomes);
router.get("/estate-structure", requireAuth, requirePermission("homes.read"), getEstateStructure);

/**
 * Rooms
 */
router.post("/rooms", requireAuth, requirePermission("homes.write"), auditOnSuccess("room.created", "room", "room_id"), createRoom);
router.patch("/rooms/:roomId", requireAuth, requirePermission("homes.write"), auditOnSuccess("room.updated", "room", "roomId"), updateRoom);
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
router.use("/infrastructure/onboarding", infrastructureOnboardingRoutes);
router.use("/platform", platformGapRoutes);

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
 * ESTATE TEAM INVITES (Phase 2)
 * Base: /facility/estate-invites
 * Invite a NEW person into the caller's own estate with a chosen role --
 * distinct from the resident/home invite flow and from the Office-only
 * estate-OWNER invite flow.
 * ---------------------------
 */
router.get("/estate-invites", requireAuth, requirePermission("staff.manage"), listEstateInvites);
router.post("/estate-invites", requireAuth, requirePermission("staff.manage"), createEstateInvite);
router.post("/estate-invites/:inviteId/revoke", requireAuth, requirePermission("staff.manage"), revokeEstateInvite);
router.post("/estate-invites/:inviteId/resend", requireAuth, requirePermission("staff.manage"), resendEstateInvite);

/**
 * ---------------------------
 * AUDIT (Phase 2)
 * Base: /facility/audit-events
 * General-purpose, tenant-scoped (this estate only) audit listing -- NOT
 * the platform-wide /super-admin/audit-logs route, which Facility must
 * never call.
 * ---------------------------
 */
router.get("/audit-events", requireAuth, requirePermission("audit.read"), async (req: any, res) => {
  const estateId = req.user?.estate_id;
  if (!estateId) return res.status(400).json({ error: "User has no estate" });
  const result = await getEstateAuditLog({
    estateId,
    limit: req.query?.limit,
    before: typeof req.query?.before === "string" ? req.query.before : null,
    action: typeof req.query?.action === "string" ? req.query.action : null,
  });
  if (!result.ok) return res.status(500).json({ error: result.error });
  return res.json(result);
});

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
router.patch("/home-users/:membershipId", requireAuth, requirePermission("staff.manage"), auditOnSuccess("home.member.updated", "home_membership", "membershipId"), updateHomeUser);
router.delete("/home-users/:membershipId", requireAuth, requirePermission("staff.manage"), auditOnSuccess("home.member.removed", "home_membership", "membershipId"), removeHomeUser);

export default router;
