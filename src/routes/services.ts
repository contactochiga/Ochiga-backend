import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import {
  listEstateServicePayments,
  listServiceConfigs,
  listServicePayments,
  payServiceFromWallet,
  upsertServiceConfig,
} from "../controllers/servicesController";

const router = Router();

router.get("/config", requireAuth, requirePermission("settings.manage"), listServiceConfigs);
router.patch("/config/:serviceKey", requireAuth, requirePermission("settings.manage"), upsertServiceConfig);
router.post("/pay", requireAuth, requirePermission("wallets.manage"), payServiceFromWallet);
router.get("/payments", requireAuth, requirePermission("wallets.read"), listServicePayments);
router.get("/estate/payments", requireAuth, requirePermission("wallets.read"), listEstateServicePayments);

export default router;
