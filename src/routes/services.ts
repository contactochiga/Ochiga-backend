import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
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

router.get("/home-registry", requireAuth, resolveRequestContext, requirePermission("services.read"), getHomeServiceRegistry);
router.get("/accounts", requireAuth, resolveRequestContext, requirePermission("services.read"), listServiceAccounts);
router.get("/accounts/me", requireAuth, resolveRequestContext, requirePermission("services.read"), listMyServiceAccounts);
router.get("/config", requireAuth, resolveRequestContext, requirePermission("services.read"), listServiceConfigs);
router.patch("/config/:serviceKey", requireAuth, resolveRequestContext, requirePermission("services.manage"), upsertServiceConfig);
router.post("/pay", requireAuth, resolveRequestContext, requirePermission("services.pay"), payServiceFromWallet);
router.post("/transactions", requireAuth, resolveRequestContext, requirePermission("services.pay"), createServiceTransaction);
router.get("/estate/transactions", requireAuth, resolveRequestContext, requirePermission("services.read"), listEstateServiceTransactions);
router.get("/events", requireAuth, resolveRequestContext, requirePermission("services.read"), listServiceRegistryEvents);
router.get("/payments", requireAuth, resolveRequestContext, requirePermission("wallets.read"), listServicePayments);
router.get("/estate/payments", requireAuth, resolveRequestContext, requirePermission("wallets.read"), listEstateServicePayments);

export default router;
