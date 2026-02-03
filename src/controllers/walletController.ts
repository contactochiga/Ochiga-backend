// src/controllers/walletController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import axios from "axios";
import crypto from "crypto";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts/versions";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "";

const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET}`,
    "Content-Type": "application/json",
  },
});

function requirePaystack(res: Response) {
  if (!PAYSTACK_SECRET) {
    return res.status(500).json({
      error: "PAYSTACK_SECRET_KEY is missing on the backend",
    });
  }
  return null;
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

  const { amount, email } = req.body;

  const response = await paystack.post("/transaction/initialize", {
    email,
    amount: Number(amount) * 100,
    metadata: { userId: user.id },
  });

  return res.json(response.data);
}

/** PAYSTACK WEBHOOK */
export async function handleWebhook(req: Request, res: Response) {
  if (!PAYSTACK_SECRET) return res.sendStatus(200); // don't break production webhook calls

  const signature = req.headers["x-paystack-signature"] as string;

  // IMPORTANT: use rawBody if present (we will wire this in app.ts)
  const raw = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(raw)
    .digest("hex");

  if (hash !== signature) return res.status(401).send("Invalid signature");

  const event = req.body;

  if (event.event === "charge.success") {
    const data = event.data;
    const userId = data.metadata.userId;

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

  res.sendStatus(200);
}

/** MANUAL DEBIT */
export async function debitWallet(req: Request, res: Response) {
  const user = req.user!;
  const { amount, reason } = req.body;

  const { data: wallet, error } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!wallet) return res.status(404).json({ error: "Wallet not found" });

  if (Number(wallet.balance) < Number(amount)) {
    return res.status(400).json({ error: "Insufficient funds" });
  }

  const balance = Number(wallet.balance) - Number(amount);

  await supabaseAdmin.from("wallets").update({ balance }).eq("id", wallet.id);

  await handleSignal({
    type: "wallet.debited",
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "user",
    walletId: wallet.id,
    userId: user.id,
    amount,
    currency: "NGN",
    reason: reason ?? "manual_debit",
    timestamp: new Date().toISOString(),
  });

  res.json({ balance });
}
