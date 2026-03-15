import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { listServicePayments, payServiceFromWallet } from "../controllers/servicesController";

const router = Router();

router.post("/pay", requireAuth, payServiceFromWallet);
router.get("/payments", requireAuth, listServicePayments);

export default router;
