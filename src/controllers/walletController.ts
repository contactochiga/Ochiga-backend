// src/controllers/walletController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import axios from "axios";
import crypto from "crypto";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts/versions";
import { emitAuditEvent } from "../core/foundation";
import { recordProviderWebhookEvent } from "../services/providerWebhookEvents";
import { publishSourceIntelligenceEvent } from "../intelligence-core";
import { NotificationService } from "../services/NotificationService";

/**
 * Wallet funding is enabled by default.
 * Set WALLET_FUNDING_ENABLED=false only when you explicitly want to disable it.
 */
const WALLET_FUNDING_ENABLED =
  (process.env.WALLET_FUNDING_ENABLED ?? "true").toLowerCase() !== "false";

function getPaystackSecret() {
  // trim removes hidden spaces/newlines that can break auth
  return (
    process.env.PAYSTACK_SECRET_KEY ||
    process.env.PAYSTACK_SECRECT_KEY ||
    ""
  ).trim();
}

function requirePaystack(res: Response) {
  const secret = getPaystackSecret();
  if (!secret) {
    return res.status(500).json({
      error: "Wallet funding is temporarily unavailable right now.",
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
    });
  }
  return null;
}

function paystackClient(secret: string) {
  return axios.create({
    baseURL: "https://api.paystack.co",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    timeout: 30_000,
  });
}

async function getOrCreateWallet(userId: string) {
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchErr) throw new Error(fetchErr.message);
  if (existing) return existing;

  const { data: created, error: createErr } = await supabaseAdmin
    .from("wallets")
    .insert([{ user_id: userId, balance: 0, currency: "NGN" }])
    .select("*")
    .single();

  if (createErr) throw new Error(createErr.message);
  return created;
}

function missingWalletColumn(error: any, column: string) {
  return String(error?.message || "").toLowerCase().includes(column.toLowerCase());
}

async function insertWalletTransactionWithFallback(row: Record<string, any>) {
  let payload = { ...row };

  for (let attempt = 0; attempt < 6; attempt++) {
    const { error } = await supabaseAdmin.from("wallet_transactions").insert([payload]);
    if (!error) return;
    if (missingWalletColumn(error, "direction") && Object.prototype.hasOwnProperty.call(payload, "direction")) {
      delete payload.direction;
      payload.metadata = {
        ...(payload.metadata || {}),
        direction: row.direction || null,
      };
      continue;
    }
    throw new Error(error.message);
  }

  throw new Error("Failed to record wallet transaction");
}

async function applyFundingCredit(params: {
  userId: string;
  amount: number;
  reference: string;
  metadata?: Record<string, any>;
  method?: "card" | "bank" | "transfer";
}) {
  const { userId, amount, reference, metadata = {}, method = "card" } = params;
  const wallet = await getOrCreateWallet(userId);

  const { data: existingTx, error: existingTxErr } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id")
    .eq("wallet_id", wallet.id)
    .eq("reference", reference)
    .maybeSingle();

  if (existingTxErr) throw new Error(existingTxErr.message);
  if (existingTx) {
    return { applied: false, walletId: wallet.id, balance: Number(wallet.balance) };
  }

  const nextBalance = Number(wallet.balance) + Number(amount);

  const { error: walletErr } = await supabaseAdmin
    .from("wallets")
    .update({ balance: nextBalance })
    .eq("id", wallet.id);
  if (walletErr) throw new Error(walletErr.message);

  await insertWalletTransactionWithFallback({
    wallet_id: wallet.id,
    direction: "credit",
    type: "funding",
    amount: Number(amount),
    reference,
    status: "completed",
    metadata: {
      ...(metadata || {}),
      direction: "credit",
    },
  });

  await handleSignal({
    type: "wallet.funded",
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "system",
    walletId: wallet.id,
    userId,
    amount: Number(amount),
    currency: "NGN",
    method,
    reference,
    timestamp: new Date().toISOString(),
  });

  void publishSourceIntelligenceEvent({
    source: "consumer", surface: "consumer", event_type: "wallet.transaction.completed", category: "wallet",
    actor_id: userId, entity_type: "wallet_transaction", entity_id: reference, entity_label: "Wallet funding", severity: "info",
    title: "Wallet funding completed", summary: `Wallet funding of NGN ${Number(amount).toLocaleString("en-NG")} was completed.`,
    payload: { wallet_id: wallet.id, amount: Number(amount), balance: nextBalance, method, reference },
  }, { source_table: "wallet_transactions", source_event_id: reference });

  try {
    await NotificationService.sendToUser(String(userId), {
      title: "Wallet funded",
      message: `NGN ${Number(amount).toLocaleString("en-NG")} has been added to your wallet.`,
      type: "wallet",
      entityId: String(wallet.id),
      payload: {
        wallet_id: wallet.id,
        amount: Number(amount),
        balance: nextBalance,
        method,
        reference,
        kind: "wallet.funded",
      },
    });
  } catch {}

  return { applied: true, walletId: wallet.id, balance: nextBalance };
}

/** GET wallet */
export async function getWallet(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  try {
    const wallet = await getOrCreateWallet(user.id);
    return res.json(wallet);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load wallet" });
  }
}

/** INIT PAYSTACK PAYMENT */
export async function initPayment(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  if (!WALLET_FUNDING_ENABLED) {
    return res.status(503).json({
      error: "Wallet funding is temporarily disabled.",
      message: "This feature will be enabled after approval.",
      code: "WALLET_FUNDING_DISABLED",
    });
  }

  const guard = requirePaystack(res);
  if (guard) return guard;

  const secret = getPaystackSecret();
  const paystack = paystackClient(secret);

  // Incoming can be string or number
  const rawAmount = req.body?.amount;
  const rawEmail = req.body?.email;

  const email = (rawEmail || user.email || "").toString().trim();
  const amountNumber = Number(rawAmount);

  if (!email || !email.includes("@")) {
    return res.status(400).json({
      error: "Valid email is required for Paystack initialize",
      received: { email: rawEmail, fallbackUserEmail: user.email },
    });
  }

  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return res.status(400).json({
      error: "Amount must be a valid number greater than 0",
      received: { amount: rawAmount },
    });
  }

  // Paystack expects kobo
  const amountKobo = Math.round(amountNumber * 100);

  try {
    const response = await paystack.post("/transaction/initialize", {
      email,
      amount: amountKobo,
      callback_url: req.body?.callback_url || undefined,
      metadata: { userId: user.id },
    });
    void emitAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "wallet.funding.initialized",
      resourceType: "wallet",
      resourceId: user.id,
      estateId: user.estate_id,
      status: "success",
      metadata: { amount: amountNumber, email },
      req,
    });

    return res.json(response.data);
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data || null;

    console.error("PAYSTACK_INIT_ERROR:", {
      status,
      data,
      message: err?.message,
      userId: user.id,
      emailUsed: email,
      amount: amountNumber,
      amountKobo,
      hasSecret: !!secret,
      secretLen: secret.length,
    });

    return res.status(status).json({
      error: status >= 500 ? "The payment provider is temporarily unavailable." : "Unable to start wallet funding.",
      code: status >= 500 ? "PAYMENT_PROVIDER_UNAVAILABLE" : "PAYMENT_INITIALIZATION_FAILED",
      status,
      paystack: data,
      message: err?.message,
    });
  }
}

/** PAYSTACK WEBHOOK */
export async function handleWebhook(req: Request, res: Response) {
  const secret = getPaystackSecret();
  const event = req.body;
  const eventType = String(event?.event || "paystack.webhook");
  const data = event?.data || {};
  const relatedUserId = data?.metadata?.userId ? String(data.metadata.userId) : null;

  if (!secret) {
    void recordProviderWebhookEvent({
      provider: "paystack",
      eventType,
      verified: false,
      signatureStatus: "secret_missing",
      deliveryStatus: "received_unverified",
      payloadSummary: { event: eventType, reference: data?.reference || null },
      relatedUserId,
      req,
    });
    return res.sendStatus(200); // do not break Paystack retries
  }

  const signature = req.headers["x-paystack-signature"] as string;

  // IMPORTANT: use rawBody if present (wired in app.ts)
  const raw = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

  const hash = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  if (hash !== signature) {
    void recordProviderWebhookEvent({
      provider: "paystack",
      eventType,
      verified: false,
      signatureStatus: signature ? "invalid" : "missing",
      deliveryStatus: "failed",
      errorMessage: "Invalid signature",
      payloadSummary: { event: eventType, reference: data?.reference || null },
      relatedUserId,
      req,
    });
    return res.status(401).send("Invalid signature");
  }

  try {
    if (event?.event === "charge.success") {
      const userId = data?.metadata?.userId;

      if (!userId) {
        void recordProviderWebhookEvent({
          provider: "paystack",
          eventType,
          verified: true,
          signatureStatus: "verified",
          deliveryStatus: "ignored",
          errorMessage: "Missing metadata.userId",
          payloadSummary: { event: eventType, reference: data?.reference || null },
          req,
        });
        return res.sendStatus(200);
      }
      const amount = Number(data.amount) / 100;
      const reference = String(data.reference || "");
      if (!reference) {
        void recordProviderWebhookEvent({
          provider: "paystack",
          eventType,
          verified: true,
          signatureStatus: "verified",
          deliveryStatus: "ignored",
          errorMessage: "Missing reference",
          payloadSummary: { event: eventType, userId },
          relatedUserId: String(userId),
          req,
        });
        return res.sendStatus(200);
      }

      await applyFundingCredit({
        userId,
        amount,
        reference,
        method: "card",
        metadata: {
          source: "paystack_webhook",
          channel: data?.channel || null,
          paidAt: data?.paid_at || null,
        },
      });
    }

    void recordProviderWebhookEvent({
      provider: "paystack",
      eventType,
      verified: true,
      signatureStatus: "verified",
      deliveryStatus: "delivered",
      payloadSummary: {
        event: eventType,
        reference: data?.reference || null,
        channel: data?.channel || null,
        amount: data?.amount || null,
      },
      relatedUserId,
      req,
    });
  } catch (e: any) {
    console.error("PAYSTACK_WEBHOOK_HANDLER_ERROR:", e?.message || e);
    void recordProviderWebhookEvent({
      provider: "paystack",
      eventType,
      verified: true,
      signatureStatus: "verified",
      deliveryStatus: "failed",
      errorMessage: e?.message || "handler_error",
      payloadSummary: { event: eventType, reference: data?.reference || null },
      relatedUserId,
      req,
    });
    // still 200 so Paystack doesn't keep retrying forever
  }

  return res.sendStatus(200);
}

/** MANUAL DEBIT */
export async function debitWallet(req: Request, res: Response) {
  const user = req.user!;
  const { amount, reason } = req.body;

  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return res.status(400).json({ error: "Amount must be > 0" });
  }

  let wallet: any;
  try {
    wallet = await getOrCreateWallet(user.id);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Wallet not found" });
  }

  if (Number(wallet.balance) < amountNumber) {
    return res.status(400).json({ error: "Insufficient funds" });
  }
  if (Boolean((wallet as any).is_frozen)) {
    return res.status(403).json({ error: "Wallet is frozen by super admin" });
  }

  const balance = Number(wallet.balance) - amountNumber;

  const { error: updateErr } = await supabaseAdmin
    .from("wallets")
    .update({ balance })
    .eq("id", wallet.id);
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  const txReference = `debit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await insertWalletTransactionWithFallback({
      wallet_id: wallet.id,
      direction: "debit",
      type: "service_charge",
      amount: amountNumber,
      reference: txReference,
      status: "completed",
      metadata: { reason: reason ?? "manual_debit", direction: "debit" },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to record wallet debit" });
  }

  await handleSignal({
    type: "wallet.debited",
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "user",
    walletId: wallet.id,
    userId: user.id,
    amount: amountNumber,
    currency: "NGN",
    reason: reason ?? "manual_debit",
    timestamp: new Date().toISOString(),
  });
  void publishSourceIntelligenceEvent({
    source: "consumer", surface: "consumer", event_type: "wallet.transaction.debited", category: "wallet",
    estate_id: user.estate_id || null, home_id: user.home_id || null, actor_id: user.id, entity_type: "wallet_transaction",
    entity_id: txReference, entity_label: "Wallet debit", severity: "info", title: "Wallet debit recorded",
    summary: `NGN ${amountNumber.toLocaleString("en-NG")} was debited from the wallet.`,
    payload: { wallet_id: wallet.id, amount: amountNumber, balance, reason: reason ?? "manual_debit" },
  }, { source_table: "wallet_transactions", source_event_id: txReference });
  void emitAuditEvent({
    actorId: user.id,
    actorRole: user.role,
    action: "wallet.debited",
    resourceType: "wallet",
    resourceId: wallet.id,
    estateId: user.estate_id,
    status: "success",
    metadata: { amount: amountNumber, reason: reason ?? "manual_debit", reference: txReference },
    req,
  });

  return res.json({ balance });
}

/** VERIFY PAYSTACK PAYMENT (client-driven fallback when webhook is delayed/misconfigured) */
export async function verifyPayment(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  if (!WALLET_FUNDING_ENABLED) {
    return res.status(503).json({
      error: "Wallet funding is temporarily disabled.",
      code: "WALLET_FUNDING_DISABLED",
    });
  }

  const reference =
    String(req.params?.reference || req.query?.reference || req.body?.reference || "").trim();
  if (!reference) return res.status(400).json({ error: "Payment reference is required" });

  const guard = requirePaystack(res);
  if (guard) return guard;

  const paystack = paystackClient(getPaystackSecret());

  try {
    const response = await paystack.get(`/transaction/verify/${encodeURIComponent(reference)}`);
    const payload = response?.data?.data;

    if (!response?.data?.status || payload?.status !== "success") {
      return res.status(400).json({
        error: "Transaction not successful",
        paystack: response?.data || null,
      });
    }

    const ownerUserId = String(payload?.metadata?.userId || user.id);
    if (ownerUserId !== user.id) {
      return res.status(403).json({ error: "Transaction does not belong to current user" });
    }

    const amount = Number(payload?.amount || 0) / 100;
    const applied = await applyFundingCredit({
      userId: ownerUserId,
      amount,
      reference,
      method: "card",
      metadata: {
        source: "verify_endpoint",
        channel: payload?.channel || null,
        paidAt: payload?.paid_at || null,
      },
    });

    return res.json({
      ok: true,
      applied: applied.applied,
      balance: applied.balance,
      reference,
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    return res.status(status).json({
      error: "Paystack verify failed",
      status,
      paystack: err?.response?.data || null,
      message: err?.message,
    });
  }
}
