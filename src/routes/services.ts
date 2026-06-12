import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import {
  getHomeServiceRegistry,
  listEstateServicePayments,
  listServiceConfigs,
  listServicePayments,
  payServiceFromWallet,
  upsertServiceConfig,
} from "../controllers/servicesController";

const router = Router();

router.get("/home-registry", requireAuth, requirePermission("services.read"), getHomeServiceRegistry);
router.get("/config", requireAuth, requirePermission("services.read"), listServiceConfigs);
router.patch("/config/:serviceKey", requireAuth, requirePermission("services.manage"), upsertServiceConfig);
router.post("/pay", requireAuth, requirePermission("services.pay"), payServiceFromWallet);
router.get("/payments", requireAuth, requirePermission("wallets.read"), listServicePayments);
router.get("/estate/payments", requireAuth, requirePermission("wallets.read"), listEstateServicePayments);

export default router;
