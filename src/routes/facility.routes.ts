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
import { resolveAutomationPolicy } from "../services/automationPolicyResolver";
import { listAutomationApprovals, decideAutomationApproval, scanStaleVisitorAuthorizations } from "../services/facilityAutomationService";
import { EXECUTION_REGISTRY } from "../intelligence-core/executionRegistry";

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

/**
 * ---------------------------
 * AUTOMATION (Phase 3, Milestone 1)
 * Base: /facility/automation
 * Read routes are broad (requireAuth + own-estate scope only) because
 * eligible approvers span three different permissions (visitors.manage,
 * support.assign, devices.control) -- no single requirePermission() call
 * covers all of them. The real, per-action authorization boundary is
 * enforced inside facilityAutomationService.decideAutomationApproval()
 * (actorMayActOnAction), the same way intelligence-core/executionRegistry.
 * ts's executeRegisteredAction already enforces its own scope/role checks
 * rather than relying on route middleware. A frontend toggle or route can
 * never itself authorize execution -- that check happens server-side,
 * inside the service, every time.
 * ---------------------------
 */
router.get("/automation/policy", requireAuth, async (req: any, res) => {
  const estateId = req.user?.estate_id;
  if (!estateId) return res.status(400).json({ error: "User has no estate" });
  const actions = EXECUTION_REGISTRY.filter((action) => action.available).map((action) => action.id);
  const policy = await Promise.all(actions.map((actionId) => resolveAutomationPolicy({ estateId, actorRole: req.user?.role || null, actionId })));
  return res.json({ estate_id: estateId, policy });
});

// Cross-Domain Operational Automation -- the capability/action registry
// Create Automation is generated from, instead of a hardcoded per-domain
// list on the client. This does not invent anything: it's a read-only
// projection of EXECUTION_REGISTRY (intelligence-core/executionRegistry.ts,
// the single canonical execution allowlist) merged with each action's
// real resolved execution level (automationPolicyResolver, the same
// resolver the approval queue and governance table already use) and a
// small, honest target_type/requires_assignee descriptor that mirrors
// exactly what validateRegisteredActions/executeRegisteredAction already
// require structurally -- not new capability, just making existing
// structure discoverable. Unavailable actions are still listed, with
// their real disclosed reason, so the client can show them as truthfully
// unsupported rather than omitting them silently.
const DOMAIN_LABELS: Record<string, string> = {
  visitors: "Access",
  maintenance: "Maintenance",
  devices: "Assets",
  notifications: "Notifications",
  community: "Community",
  services: "Services",
  wallet: "Finance",
};
const ACTION_TARGET_TYPES: Record<string, { target_type: string; requires_assignee?: boolean; label: string }> = {
  "visitor.approve": { target_type: "visitor_access", label: "Approve visitor" },
  "visitor.revoke": { target_type: "visitor_access", label: "Revoke visitor access" },
  "visitor.expire": { target_type: "visitor_access", label: "Expire visitor access" },
  "maintenance.assign": { target_type: "maintenance_request", requires_assignee: true, label: "Assign maintenance" },
  "maintenance.complete": { target_type: "maintenance_request", label: "Complete maintenance" },
  "maintenance.cancel": { target_type: "maintenance_request", label: "Cancel maintenance" },
  "maintenance.create": { target_type: "none", label: "Create work order" },
  "device.on": { target_type: "device", label: "Turn device on" },
  "device.off": { target_type: "device", label: "Turn device off" },
  "device.toggle": { target_type: "device", label: "Toggle device" },
  "notification.notify": { target_type: "notification_target", label: "Send notification" },
  "community.approve": { target_type: "none", label: "Approve community post" },
  "community.reject": { target_type: "none", label: "Reject community post" },
  "community.post_announcement": { target_type: "none", label: "Post announcement" },
  "service.assign": { target_type: "none", label: "Assign service" },
  "service.complete": { target_type: "none", label: "Complete service" },
  "wallet.approve": { target_type: "none", label: "Approve wallet transaction" },
  "wallet.cancel": { target_type: "none", label: "Cancel wallet transaction" },
};

router.get("/automation/capabilities", requireAuth, async (req: any, res) => {
  const estateId = req.user?.estate_id;
  if (!estateId) return res.status(400).json({ error: "User has no estate" });

  const resolved = await Promise.all(
    EXECUTION_REGISTRY.map(async (action) => {
      const meta = ACTION_TARGET_TYPES[action.id] || { target_type: "none", label: action.id };
      const policy = action.available
        ? await resolveAutomationPolicy({ estateId, actorRole: req.user?.role || null, actionId: action.id })
        : null;
      return {
        id: action.id,
        domain: action.domain,
        label: meta.label,
        target_type: meta.target_type,
        requires_assignee: Boolean(meta.requires_assignee),
        available: action.available,
        execution_level: action.available ? policy?.executionLevel || "unsupported" : "unsupported",
        required_permission: policy?.requiredPermission || null,
        reason: action.available ? policy?.reason || null : action.reason || "Not implemented yet.",
      };
    })
  );

  const domains = Array.from(new Set(EXECUTION_REGISTRY.map((action) => action.domain))).map((domain) => ({
    domain,
    label: DOMAIN_LABELS[domain] || domain,
    actions: resolved.filter((action) => action.domain === domain),
  }));

  // The one real trigger type that exists anywhere in the platform today
  // (src/services/automationScheduleService.ts's validateAutomationTrigger)
  // -- no condition/event/threshold trigger engine exists yet. Disclosed
  // here, not hidden behind a client-side assumption.
  const triggers = [
    { type: "schedule", label: "Schedule", schedule_types: ["daily", "weekdays", "once"] },
  ];

  return res.json({ estate_id: estateId, triggers, domains });
});

router.get("/automation/approvals", requireAuth, async (req: any, res) => {
  const estateId = req.user?.estate_id;
  if (!estateId) return res.status(400).json({ error: "User has no estate" });
  if (typeof req.query?.status !== "string" || req.query.status === "pending_approval") {
    await scanStaleVisitorAuthorizations(estateId);
  }
  const status = typeof req.query?.status === "string" ? req.query.status : undefined;
  const approvals = await listAutomationApprovals(estateId, status);
  return res.json({ estate_id: estateId, approvals });
});

router.post("/automation/approvals/:approvalId/approve", requireAuth, async (req: any, res) => {
  const estateId = req.user?.estate_id;
  if (!estateId) return res.status(400).json({ error: "User has no estate" });
  const result = await decideAutomationApproval({ approvalId: req.params.approvalId, estateId, actor: req.user, decision: "approve", note: typeof req.body?.note === "string" ? req.body.note : null });
  if (!result.ok) {
    const code = (result as any).code;
    const httpStatus = code === "not_found" ? 404 : code === "forbidden" ? 403 : code === "not_pending" ? 409 : code === "policy_denied" ? 403 : 422;
    return res.status(httpStatus).json({ error: code, reason: (result as any).reason || null, status: (result as any).status || null });
  }
  return res.json({ approval: result.approval });
});

router.post("/automation/approvals/:approvalId/reject", requireAuth, async (req: any, res) => {
  const estateId = req.user?.estate_id;
  if (!estateId) return res.status(400).json({ error: "User has no estate" });
  const result = await decideAutomationApproval({ approvalId: req.params.approvalId, estateId, actor: req.user, decision: "reject", note: typeof req.body?.note === "string" ? req.body.note : null });
  if (!result.ok) {
    const code = (result as any).code;
    const httpStatus = code === "not_found" ? 404 : code === "forbidden" ? 403 : code === "not_pending" ? 409 : 422;
    return res.status(httpStatus).json({ error: code });
  }
  return res.json({ approval: result.approval });
});

export default router;
