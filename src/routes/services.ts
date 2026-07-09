import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import {
  createServiceTransaction,
  getHomeServiceRegistry,
  listEstateServiceTransactions,
  listServiceRegistryEvents,
  listMyServiceAccounts,
  listServiceAccounts,
  listEstateServicePayments,
  listServiceConfigs,
  listServicePayments,
  payServiceFromWallet,
  upsertServiceConfig,
} from "../controllers/servicesController";

const router = Router();

router.get("/home-registry", requireAuth, requirePermission("services.read"), getHomeServiceRegistry);
router.get("/accounts", requireAuth, requirePermission("services.read"), listServiceAccounts);
router.get("/accounts/me", requireAuth, requirePermission("services.read"), listMyServiceAccounts);
router.get("/config", requireAuth, requirePermission("services.read"), listServiceConfigs);
router.patch("/config/:serviceKey", requireAuth, requirePermission("services.manage"), upsertServiceConfig);
router.post("/pay", requireAuth, requirePermission("services.pay"), payServiceFromWallet);
router.post("/transactions", requireAuth, requirePermission("services.pay"), createServiceTransaction);
router.get("/estate/transactions", requireAuth, requirePermission("services.read"), listEstateServiceTransactions);
router.get("/events", requireAuth, requirePermission("services.read"), listServiceRegistryEvents);
router.get("/payments", requireAuth, requirePermission("wallets.read"), listServicePayments);
router.get("/estate/payments", requireAuth, requirePermission("wallets.read"), listEstateServicePayments);

export default router;
