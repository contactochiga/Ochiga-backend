// src/controllers/walletController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import axios from "axios";
import crypto from "crypto";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts/versions";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY!;
if (!PAYSTACK_SECRET) console.warn("⚠️ PAYSTACK_SECRET_KEY missing");

const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET}`,
    "Content-Type": "application/json",
  },
});

type AuthReq = Request & { user?: { id: string; estate_id?: string } };

async function resolveEstateId(req: AuthReq): Promise<string | null> {
  const estateId = req.user?.estate_id;
  if (estateId) return estateId;

  // fallback: first active membership
  const userId = req.user?.id;
  if (!userId) return null;

  const { data, error } = await supabaseAdmin
    .from("estate_memberships")
    .select("estate_id, status, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.estate_id || null;
}

async function getOrCreateWallet(userId: string, estateId: string | null) {
  // Prefer estate-scoped wallet if estateId exists
  let q = supabaseAdmin.from("wallets").select("*").eq("user_id", userId);

  if (estateId) q = q.eq("estate_id", estateId);

  const { data: existing, error: exErr } = await q.maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (existing) return existing;

  const { data: created, error } = await supabaseAdmin
    .from("wallets")
    .insert({
      user_id: userId,
      estate_id: estateId,
      balance: 0,
      currency: "NGN",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return created;
}

/** GET wallet */
export async function getWallet(req: AuthReq, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const estateId = await resolveEstateId(req);
    const wallet = await getOrCreateWallet(user.id, estateId);

    return res.json(wallet);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Failed to load wallet" });
  }
}

/** INIT PAYSTACK PAYMENT */
export async function initPayment(req: AuthReq, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const { amount, email } = req.body || {};
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "amount is required" });
    if (!email) return res.status(400).json({ error: "email is required" });

    const estateId = await resolveEstateId(req);

    const response = await paystack.post("/transaction/initialize", {
      email,
      amount: Math.round(Number(amount) * 100),
      metadata: { userId: user.id, estateId },
    });

    return res.json(response.data);
  } catch (e: any) {
    return res.status(500).json({ error: e?.response?.data?.message || e.message || "init failed" });
  }
}

/** PAYSTACK WEBHOOK */
export async function handleWebhook(req: Request, res: Response) {
  try {
    const signature = req.headers["x-paystack-signature"] as string;

    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== signature) return res.status(401).send("Invalid signature");

    const event = req.body;

    if (event?.event !== "charge.success") return res.sendStatus(200);

    const data = event.data;
    const userId = data?.metadata?.userId as string | undefined;
    const estateId = (data?.metadata?.estateId as string | undefined) || null;

    if (!userId) return res.sendStatus(200);

    const wallet = await getOrCreateWallet(userId, estateId);

    const amount = Number(data.amount) / 100;
    const newBalance = Number(wallet.balance || 0) + amount;
    const reference = String(data.reference || "");

    // 1) Write ledger transaction
    await supabaseAdmin.from("wallet_transactions").insert({
      wallet_id: wallet.id,
      user_id: userId,
      estate_id: wallet.estate_id || estateId,
      type: "credit",
      category: "topup",
      amount,
      reference,
      status: "successful",
      metadata: data || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    // 2) Update wallet balance
    await supabaseAdmin
      .from("wallets")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("id", wallet.id);

    // 3) Emit signal
    await handleSignal({
      type: "wallet.funded",
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "system",
      walletId: wallet.id,
      userId,
      amount,
      currency: "NGN",
      method: "card",
      reference,
      timestamp: new Date().toISOString(),
    });

    return res.sendStatus(200);
  } catch (e) {
    console.error("wallet webhook error:", e);
    return res.sendStatus(200); // never fail webhook
  }
}

/** MANUAL DEBIT */
export async function debitWallet(req: AuthReq, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const { amount, reason, category } = req.body || {};
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "amount is required" });

    const estateId = await resolveEstateId(req);
    const wallet = await getOrCreateWallet(user.id, estateId);

    if (Number(wallet.balance || 0) < Number(amount)) {
      return res.status(400).json({ error: "Insufficient funds" });
    }

    const newBalance = Number(wallet.balance || 0) - Number(amount);

    // 1) ledger tx
    await supabaseAdmin.from("wallet_transactions").insert({
      wallet_id: wallet.id,
      user_id: user.id,
      estate_id: wallet.estate_id || estateId,
      type: "debit",
      category: category || "manual_debit",
      amount: Number(amount),
      reference: null,
      status: "successful",
      metadata: { reason: reason ?? "manual_debit" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    // 2) update balance
    await supabaseAdmin
      .from("wallets")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("id", wallet.id);

    // 3) signal
    await handleSignal({
      type: "wallet.debited",
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "user",
      walletId: wallet.id,
      userId: user.id,
      amount: Number(amount),
      currency: "NGN",
      reason: reason ?? "manual_debit",
      timestamp: new Date().toISOString(),
    });

    return res.json({ balance: newBalance });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Failed to debit wallet" });
  }
}
