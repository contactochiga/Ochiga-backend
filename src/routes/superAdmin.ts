import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import * as SuperAdminCtrl from "../controllers/superAdminController";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/overview", SuperAdminCtrl.getOverview);
router.get("/estates", SuperAdminCtrl.listEstates);
router.get("/homes", SuperAdminCtrl.listHomes);
router.get("/devices", SuperAdminCtrl.listDevices);
router.get("/transactions", SuperAdminCtrl.listTransactions);
router.get("/activities", SuperAdminCtrl.listActivities);

export default router;
