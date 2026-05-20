import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import * as SuperAdminCtrl from "../controllers/superAdminController";

const router = Router();

router.use(requireAuth);

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
