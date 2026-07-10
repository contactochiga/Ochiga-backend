// src/routes/wallets.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import * as WalletCtrl from "../controllers/walletController";

const router = Router();

/**
 * ============================
 * WALLET
 * ============================
 */

// Get wallet (balance, metadata)
router.get("/", requireAuth, requirePermission("wallets.read"), WalletCtrl.getWallet);

// Initialize Paystack payment
router.post("/init", requireAuth, requirePermission("wallets.read"), auditOnSuccess("wallet.funding.initialized", "wallet", "wallet_id"), WalletCtrl.initPayment);

// Funding status / receipt / transaction detail
router.get("/payment-status/:reference", requireAuth, requirePermission("wallets.read"), WalletCtrl.getFundingStatus);
router.get("/transactions/:reference", requireAuth, requirePermission("wallets.read"), WalletCtrl.getFundingTransaction);
router.get("/receipts/:reference", requireAuth, requirePermission("wallets.read"), WalletCtrl.getFundingReceipt);

// Verify a Paystack transaction reference (fallback when webhook is delayed)
router.get("/verify/:reference", requireAuth, requirePermission("wallets.read"), auditOnSuccess("wallet.funded", "wallet_transaction", "reference"), WalletCtrl.verifyPayment);
router.post("/verify", requireAuth, requirePermission("wallets.read"), auditOnSuccess("wallet.funded", "wallet_transaction", "reference"), WalletCtrl.verifyPayment);

// Paystack webhook (NO auth – Paystack server)
router.post("/webhook", WalletCtrl.handleWebhook);

// Manual debit (internal / admin / user-triggered)
router.post("/debit", requireAuth, requirePermission("wallets.manage"), auditOnSuccess("wallet.debited", "wallet", "wallet_id"), WalletCtrl.debitWallet);

export default router;
