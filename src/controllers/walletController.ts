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

/* =================================================
 * WALLET CREDIT (WEBHOOK)
 * ================================================= */

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
    const newBalance = Number(wallet.balance) + credited;

    await supabaseAdmin
      .from("wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.id);

    await supabaseAdmin.from("wallet_transactions").insert({
      wallet_id: wallet.id,
      type: "credit",
      amount: credited,
      reference: data.reference,
      status: "completed",
    });

    // 🔔 EMIT SIGNAL
    await handleSignal({
      type: "wallet.funded",
      schemaVersion: 1,
      source: "wallet",
      walletId: wallet.id,
      userId,
      amount: credited,
      balance: newBalance,
      method: "paystack",
      timestamp: new Date().toISOString(),
    });
  }

  res.sendStatus(200);
}

/* =================================================
 * MANUAL CREDIT / DEBIT
 * ================================================= */

export async function creditWallet(req: Request, res: Response) {
  const userId = req.user!.id;
  const { amount, reference } = req.body;

  const { data: wallet } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single();

  const newBalance = Number(wallet.balance) + Number(amount);

  await supabaseAdmin
    .from("wallets")
    .update({ balance: newBalance })
    .eq("id", wallet.id);

  await handleSignal({
    type: "wallet.credited",
    schemaVersion: 1,
    source: "wallet",
    walletId: wallet.id,
    userId,
    amount,
    balance: newBalance,
    reference,
    timestamp: new Date().toISOString(),
  });

  res.json({ balance: newBalance });
}

export async function debitWallet(req: Request, res: Response) {
  const userId = req.user!.id;
  const { amount, reference } = req.body;

  const { data: wallet } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (Number(wallet.balance) < Number(amount))
    return res.status(400).json({ error: "Insufficient funds" });

  const newBalance = Number(wallet.balance) - Number(amount);

  await supabaseAdmin
    .from("wallets")
    .update({ balance: newBalance })
    .eq("id", wallet.id);

  await handleSignal({
    type: "wallet.debited",
    schemaVersion: 1,
    source: "wallet",
    walletId: wallet.id,
    userId,
    amount,
    balance: newBalance,
    reference,
    timestamp: new Date().toISOString(),
  });

  res.json({ balance: newBalance });
}
