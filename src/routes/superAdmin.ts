import { Router, Request, Response, NextFunction } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import * as SuperAdminCtrl from "../controllers/superAdminController";

const router = Router();

// Phase 2 commercial-hardening finding: every route in this router was
// gated only by generic PERMISSION_KEYS (estates.read, staff.manage,
// wallets.read, audit.read, ...) with no check that the caller is actual
// PLATFORM staff -- since estate_admin/facility_manager hold several of
// those same permission keys for managing their OWN tenant, any estate
// admin could already call e.g. GET /super-admin/estates and see EVERY
// estate on the platform, not just their own. This is a real, pre-existing
// cross-tenant data leak, independent of and broader than the audit.read
// grant added this same phase. Every /super-admin/* route is platform-only
// by definition; this guard enforces that at the router level, on top of
// (not instead of) each route's existing granular permission check.
function requirePlatformStaff(req: Request, res: Response, next: NextFunction) {
  const role = (req as any).user?.role;
  if (role !== "super_admin" && role !== "ochiga_admin") {
    return res.status(403).json({ error: "Platform staff only." });
  }
  next();
}

router.use(requireAuth, requirePlatformStaff);

router.get("/overview", requirePermission("office.read"), SuperAdminCtrl.getOverview);
router.get("/estates", requirePermission("estates.read"), SuperAdminCtrl.listEstates);
router.get("/estates/:estateId/summary", requirePermission("estates.read"), SuperAdminCtrl.getEstateSummary);
router.get("/homes", requirePermission("homes.read"), SuperAdminCtrl.listHomes);
router.get("/devices", requirePermission("devices.read"), SuperAdminCtrl.listDevices);
router.get("/transactions", requirePermission("wallets.read"), SuperAdminCtrl.listTransactions);
router.get("/activities", requirePermission("office.read"), SuperAdminCtrl.listActivities);
router.get("/audit-logs", requirePermission("audit.read"), SuperAdminCtrl.listAuditLogs);

router.post("/estates/:estateId/status", requirePermission("estates.write"), SuperAdminCtrl.setEstateStatus);
router.post("/users/:userId/status", requirePermission("staff.manage"), SuperAdminCtrl.setUserStatus);
router.post("/devices/:deviceId/disable", requirePermission("devices.control"), SuperAdminCtrl.setDeviceDisabled);
router.post("/wallets/:walletId/freeze", requirePermission("wallets.manage"), SuperAdminCtrl.setWalletFrozen);

export default router;
