// src/routes/wallets.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as WalletCtrl from "../controllers/walletController";

const router = Router();

/**
 * ============================
 * WALLET
 * ============================
 */

// Get wallet (balance, metadata)
router.get("/", requireAuth, WalletCtrl.getWallet);

// Initialize Paystack payment
router.post("/init", requireAuth, WalletCtrl.initPayment);

// Verify a Paystack transaction reference (fallback when webhook is delayed)
router.get("/verify/:reference", requireAuth, WalletCtrl.verifyPayment);
router.post("/verify", requireAuth, WalletCtrl.verifyPayment);

// Paystack webhook (NO auth – Paystack server)
router.post("/webhook", WalletCtrl.handleWebhook);

// Manual debit (internal / admin / user-triggered)
router.post("/debit", requireAuth, WalletCtrl.debitWallet);

export default router;
