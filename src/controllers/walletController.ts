// src/controllers/walletController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import axios from "axios";
import crypto from "crypto";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts/versions";

function getPaystackSecret() {
  // trim removes hidden spaces/newlines that can break auth
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
    timeout: 30_000,
  });
}

/** GET wallet */
export async function getWallet(req: Request, res: Response) {
  const user = req.user;
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
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

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
      metadata: { userId: user.id },
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
  if (!secret) return res.sendStatus(200); // do not break Paystack retries

  const signature = req.headers["x-paystack-signature"] as string;

  // IMPORTANT: use rawBody if present (wired in app.ts)
  const raw = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

  const hash = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  if (hash !== signature) return res.status(401).send("Invalid signature");

  const event = req.body;

  try {
    if (event?.event === "charge.success") {
      const data = event.data;
      const userId = data?.metadata?.userId;

      if (!userId) return res.sendStatus(200);

      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (!wallet) return res.sendStatus(200);

      const amount = Number(data.amount) / 100;
      const balance = Number(wallet.balance) + amount;

      await supabaseAdmin.from("wallets").update({ balance }).eq("id", wallet.id);

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
  } catch (e: any) {
    console.error("PAYSTACK_WEBHOOK_HANDLER_ERROR:", e?.message || e);
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

  const { data: wallet, error } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!wallet) return res.status(404).json({ error: "Wallet not found" });

  if (Number(wallet.balance) < amountNumber) {
    return res.status(400).json({ error: "Insufficient funds" });
  }

  const balance = Number(wallet.balance) - amountNumber;

  await supabaseAdmin.from("wallets").update({ balance }).eq("id", wallet.id);

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

  return res.json({ balance });
}
