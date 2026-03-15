import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  listEstateServicePayments,
  listServiceConfigs,
  listServicePayments,
  payServiceFromWallet,
  upsertServiceConfig,
} from "../controllers/servicesController";

const router = Router();

router.get("/config", requireAuth, listServiceConfigs);
router.patch("/config/:serviceKey", requireAuth, upsertServiceConfig);
router.post("/pay", requireAuth, payServiceFromWallet);
router.get("/payments", requireAuth, listServicePayments);
router.get("/estate/payments", requireAuth, listEstateServicePayments);

export default router;
