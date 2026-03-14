import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import * as SuperAdminCtrl from "../controllers/superAdminController";

const router = Router();

router.use(requireAuth, requireRole("admin", "system_admin", "auditor"));

router.get("/overview", SuperAdminCtrl.getOverview);
router.get("/estates", SuperAdminCtrl.listEstates);
router.get("/estates/:estateId/summary", SuperAdminCtrl.getEstateSummary);
router.get("/homes", SuperAdminCtrl.listHomes);
router.get("/devices", SuperAdminCtrl.listDevices);
router.get("/transactions", SuperAdminCtrl.listTransactions);
router.get("/activities", SuperAdminCtrl.listActivities);
router.get("/audit-logs", SuperAdminCtrl.listAuditLogs);

router.post("/estates/:estateId/status", SuperAdminCtrl.setEstateStatus);
router.post("/users/:userId/status", SuperAdminCtrl.setUserStatus);
router.post("/devices/:deviceId/disable", SuperAdminCtrl.setDeviceDisabled);
router.post("/wallets/:walletId/freeze", SuperAdminCtrl.setWalletFrozen);

export default router;
