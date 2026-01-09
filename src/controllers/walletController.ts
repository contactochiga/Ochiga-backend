// src/controllers/walletController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import axios from "axios";
import crypto from "crypto";
import { handleSignal } from "../core/control-plane";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY!;

const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET}`,
    "Content-Type": "application/json",
  },
});

/** GET wallet */
export async function getWallet(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { data, error } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

/** INIT PAYSTACK PAYMENT */
export async function initPayment(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

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
  const signature = req.headers["x-paystack-signature"] as string;

  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
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
      .single();

    if (!wallet) return res.sendStatus(200);

    const credited = Number(data.amount) / 100;
    const balance = Number(wallet.balance) + credited;

    await supabaseAdmin
      .from("wallets")
      .update({ balance })
      .eq("id", wallet.id);

    await handleSignal({
      type: "wallet.funded",
      schemaVersion: 1,
      source: "system",
      walletId: wallet.id,
      userId,
      amount: credited,
      balance,
      timestamp: new Date().toISOString(),
    });
  }

  res.sendStatus(200);
}

/** MANUAL CREDIT */
export async function creditWallet(req: Request, res: Response) {
  const user = req.user!;
  const { amount, reference } = req.body;

  const { data: wallet } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const balance = Number(wallet.balance) + Number(amount);

  await supabaseAdmin.from("wallets").update({ balance }).eq("id", wallet.id);

  await handleSignal({
    type: "wallet.credited",
    schemaVersion: 1,
    source: "user",
    walletId: wallet.id,
    userId: user.id,
    amount,
    balance,
    reference,
    timestamp: new Date().toISOString(),
  });

  res.json({ balance });
}

/** MANUAL DEBIT */
export async function debitWallet(req: Request, res: Response) {
  const user = req.user!;
  const { amount, reference } = req.body;

  const { data: wallet } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (Number(wallet.balance) < Number(amount))
    return res.status(400).json({ error: "Insufficient funds" });

  const balance = Number(wallet.balance) - Number(amount);

  await supabaseAdmin.from("wallets").update({ balance }).eq("id", wallet.id);

  await handleSignal({
    type: "wallet.debited",
    schemaVersion: 1,
    source: "user",
    walletId: wallet.id,
    userId: user.id,
    amount,
    balance,
    reference,
    timestamp: new Date().toISOString(),
  });

  res.json({ balance });
}
