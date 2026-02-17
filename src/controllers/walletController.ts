// src/controllers/walletController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import axios from "axios";
import crypto from "crypto";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts/versions";

function getPaystackSecret() {
  return (process.env.PAYSTACK_SECRET_KEY || "").trim();
}

function requirePaystack(res: Response) {
  const secret = getPaystackSecret();
  if (!secret) {
    return res.status(500).json({
      error: "PAYSTACK_SECRET_KEY is missing on the backend",
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
    timeout: 30000,
  });
}

/** GET wallet */
export async function getWallet(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (existing) return res.json(existing);

  const { data: created, error: createErr } = await supabaseAdmin
    .from("wallets")
    .insert([{ user_id: user.id, balance: 0, currency: "NGN" }])
    .select("*")
    .single();

  if (createErr) return res.status(500).json({ error: createErr.message });
  return res.json(created);
}

/** INIT PAYSTACK PAYMENT */
export async function initPayment(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const guard = requirePaystack(res);
  if (guard) return guard;

  const secret = getPaystackSecret();
  const paystack = paystackClient(secret);

  const { amount, email } = req.body || {};

  // Basic validation so Paystack doesn't return confusing errors
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({
      error: "Invalid amount",
      detail: "amount must be a number greater than 0",
    });
  }

  const payerEmail = (email || user.email || "").toString().trim();
  if (!payerEmail || !payerEmail.includes("@")) {
    return res.status(400).json({
      error: "Missing email",
      detail: "Provide a valid email or ensure the user profile has email",
    });
  }

  try {
    const response = await paystack.post("/transaction/initialize", {
      email: payerEmail,
      amount: Math.round(amt * 100), // NGN -> kobo
      metadata: { userId: user.id },
    });

    return res.json(response.data);
  } catch (err: any) {
    // show the actual Paystack reason (this is what you need to stop guessing)
    const status = err?.response?.status || 500;
    const data = err?.response?.data || null;

    console.error("PAYSTACK_INIT_ERROR:", {
      status,
      data,
      message: err?.message,
      // do NOT log the secret itself
      hasSecret: !!secret,
      secretLooksValid: secret.startsWith("sk_"),
      envKeys: Object.keys(process.env).filter((k) =>
        k.includes("PAYSTACK")
      ),
    });

    return res.status(status).json({
      error: "Paystack init failed",
      status,
      paystack: data,
      message: err?.message,
    });
  }
}

/** PAYSTACK WEBHOOK */
export async function handleWebhook(req: Request, res: Response) {
  const secret = getPaystackSecret();
  if (!secret) return res.sendStatus(200); // don't break production webhook calls

  const signature = (req.headers["x-paystack-signature"] as string) || "";
  if (!signature) return res.status(401).send("Missing signature");

  // IMPORTANT: must use raw body for signature verification.
  // We rely on app.ts wiring rawBody (see note below).
  const raw = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
  const hash = crypto.createHmac("sha512", secret).update(raw).digest("hex");

  if (hash !== signature) return res.status(401).send("Invalid signature");

  const event = req.body;

  try {
    if (event?.event === "charge.success") {
      const data = event.data;
      const userId = data?.metadata?.userId;

      if (!userId) return res.sendStatus(200);

      const { data: wallet, error: wErr } = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (wErr) {
        console.error("WEBHOOK_WALLET_FETCH_ERROR:", wErr);
        return res.sendStatus(200);
      }

      if (!wallet) return res.sendStatus(200);

      const amount = Number(data.amount) / 100;
      const balance = Number(wallet.balance) + amount;

      const { error: upErr } = await supabaseAdmin
        .from("wallets")
        .update({ balance, updated_at: new Date().toISOString() })
        .eq("id", wallet.id);

      if (upErr) {
        console.error("WEBHOOK_WALLET_UPDATE_ERROR:", upErr);
        return res.sendStatus(200);
      }

      await handleSignal({
        type: "wallet.funded",
        schemaVersion: SIGNAL_SCHEMA_VERSION,
        source: "system",
        walletId: wallet.id,
        userId,
        amount,
        currency: "NGN",
        method: "card",
        reference: data.reference,
        timestamp: new Date().toISOString(),
      });
    }

    return res.sendStatus(200);
  } catch (e: any) {
    console.error("PAYSTACK_WEBHOOK_ERROR:", e?.message || e);
    return res.sendStatus(200);
  }
}

/** MANUAL DEBIT */
export async function debitWallet(req: Request, res: Response) {
  const user = (req as any).user!;
  const { amount, reason } = req.body || {};

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const { data: wallet, error } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!wallet) return res.status(404).json({ error: "Wallet not found" });

  if (Number(wallet.balance) < amt) {
    return res.status(400).json({ error: "Insufficient funds" });
  }

  const balance = Number(wallet.balance) - amt;

  await supabaseAdmin
    .from("wallets")
    .update({ balance, updated_at: new Date().toISOString() })
    .eq("id", wallet.id);

  await handleSignal({
    type: "wallet.debited",
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "user",
    walletId: wallet.id,
    userId: user.id,
    amount: amt,
    currency: "NGN",
    reason: reason ?? "manual_debit",
    timestamp: new Date().toISOString(),
  });

  return res.json({ balance });
}

/**
 * NOTE (VERY IMPORTANT):
 * For Paystack webhook signature verification to work, your app MUST capture rawBody.
 * In app.ts/server.ts you need something like:
 *
 *  app.post(
 *    "/wallets/webhook",
 *    express.raw({ type: "application/json" }),
 *    (req, _res, next) => {
 *      (req as any).rawBody = req.body;
 *      try { req.body = JSON.parse(req.body.toString("utf8")); } catch {}
 *      next();
 *    },
 *    WalletCtrl.handleWebhook
 *  );
 *
 * If you don’t do this, signature checks can fail randomly.
 */
