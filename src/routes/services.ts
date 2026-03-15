import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
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

export default router;
