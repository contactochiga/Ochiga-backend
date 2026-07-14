import { Request, Response } from "express";
import axios from "axios";
import crypto from "crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts/versions";
import { emitAuditEvent } from "../core/foundation";
import { publishSourceIntelligenceEvent } from "../intelligence-core";
import { NotificationService } from "../services/NotificationService";
import { recordProviderWebhookEvent } from "../services/providerWebhookEvents";
import { logger } from "../observability/logger";
import { createPublicApiError, sendPublicApiError } from "../services/publicApi";

const WALLET_FUNDING_ENABLED = (process.env.WALLET_FUNDING_ENABLED ?? "true").toLowerCase() !== "false";

type FundingStatus =
  | "initialized"
  | "pending"
  | "confirming"
  | "crediting"
  | "completed"
  | "failed"
  | "cancelled"
  | "abandoned"
  | "reversed";

function getPaystackSecret() {
  return (process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRECT_KEY || "").trim();
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

function formatAmount(amount: number, currency = "NGN") {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency || "NGN",
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
  } catch {
    return `${currency || "NGN"} ${Number(amount || 0).toFixed(2)}`;
  }
}

function normalizeFundingStatus(value: unknown): FundingStatus {
  const text = String(value || "").trim().toLowerCase();
  if (["initialized", "pending", "confirming", "crediting", "completed", "failed", "cancelled", "abandoned", "reversed"].includes(text)) {
    return text as FundingStatus;
  }
  return "pending";
}

function paymentReturnUrl(req: Request) {
  const explicit =
    process.env.CONSUMER_PAYMENT_RETURN_URL ||
    process.env.CONSUMER_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "";
  const base = String(explicit || "").trim().replace(/\/$/, "");
  if (base) return `${base}/wallet/payment/return`;
  const origin = `${req.protocol}://${req.get("host") || "localhost:3000"}`.replace(/\/$/, "");
  return `${origin}/wallet/payment/return`;
}

function safeNumber(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeCurrency(value: any) {
  const next = String(value || "NGN").trim().toUpperCase();
  return next || "NGN";
}

function missingWalletColumn(error: any, column: string) {
  return String(error?.message || "").toLowerCase().includes(column.toLowerCase());
}

function mergeMetadata(base: Record<string, any> | null | undefined, patch: Record<string, any> | null | undefined) {
  return {
    ...(base || {}),
    ...(patch || {}),
  };
}

function publicFundingState(row: any) {
  const status = normalizeFundingStatus(row?.status);
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled" || status === "abandoned" || status === "reversed") return "failed";
  return "pending";
}

function buildFundingReceipt(input: {
  transaction: any;
  wallet: any;
  userId: string;
  estateId?: string | null;
  homeId?: string | null;
}) {
  const metadata = input.transaction?.metadata || {};
  return {
    transaction_id: input.transaction?.id || null,
    transaction_reference: String(input.transaction?.reference || ""),
    provider_reference: String(metadata.provider_reference || input.transaction?.reference || ""),
    amount: safeNumber(input.transaction?.amount),
    fee: safeNumber(metadata.fee || 0),
    credited_amount: safeNumber(metadata.credited_amount || input.transaction?.amount || 0),
    currency: safeCurrency(metadata.currency || input.wallet?.currency || "NGN"),
    wallet_id: input.wallet?.id || null,
    resident_id: input.userId,
    status: normalizeFundingStatus(input.transaction?.status),
    paid_at: String(metadata.paid_at || metadata.completed_at || input.transaction?.created_at || new Date().toISOString()),
    payment_method: String(metadata.payment_method || metadata.channel || "card"),
    estate_id: input.estateId || metadata.estate_id || null,
    home_id: input.homeId || metadata.home_id || null,
    confirmation_source: String(metadata.confirmation_source || "provider_webhook"),
  };
}

function fundingMessage(status: FundingStatus) {
  if (status === "completed") {
    return {
      title: "Payment successful",
      summary: "Your wallet has been updated.",
    };
  }
  if (status === "failed" || status === "cancelled" || status === "abandoned" || status === "reversed") {
    return {
      title: "Payment was not completed",
      summary: "Your wallet has not been charged.",
    };
  }
  return {
    title: "Confirming your payment",
    summary: "We received your payment and are waiting for final confirmation.",
  };
}

async function getOrCreateWallet(userId: string) {
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (existing) return existing;

  const { data: created, error: createErr } = await supabaseAdmin
    .from("wallets")
    .insert([{ user_id: userId, balance: 0, currency: "NGN" }])
    .select("*")
    .single();
  if (createErr) throw createErr;
  return created;
}

async function insertWalletTransactionWithFallback(row: Record<string, any>) {
  let payload = { ...row };
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabaseAdmin.from("wallet_transactions").insert([payload]).select("*").maybeSingle();
    if (!error) return data || payload;
    if (missingWalletColumn(error, "direction") && Object.prototype.hasOwnProperty.call(payload, "direction")) {
      delete payload.direction;
      payload.metadata = mergeMetadata(payload.metadata, { direction: row.direction || null });
      continue;
    }
    if (missingWalletColumn(error, "user_id") && Object.prototype.hasOwnProperty.call(payload, "user_id")) {
      delete payload.user_id;
      payload.metadata = mergeMetadata(payload.metadata, { resident_id: row.user_id || null });
      continue;
    }
    if (missingWalletColumn(error, "updated_at") && Object.prototype.hasOwnProperty.call(payload, "updated_at")) {
      delete payload.updated_at;
      continue;
    }
    throw error;
  }
  throw new Error("wallet_transaction_insert_failed");
}

async function updateWalletTransactionWithFallback(reference: string, patch: Record<string, any>, allowedStatuses?: FundingStatus[]) {
  let payload = { ...patch };
  for (let attempt = 0; attempt < 8; attempt++) {
    let query = supabaseAdmin
      .from("wallet_transactions")
      .update(payload as any)
      .eq("reference", reference)
      .select("*");
    if (allowedStatuses?.length) query = query.in("status", allowedStatuses);
    const { data, error } = await query;
    if (!error) return data || [];
    if (missingWalletColumn(error, "direction") && Object.prototype.hasOwnProperty.call(payload, "direction")) {
      delete payload.direction;
      payload.metadata = mergeMetadata(payload.metadata, { direction: patch.direction || null });
      continue;
    }
    if (missingWalletColumn(error, "updated_at") && Object.prototype.hasOwnProperty.call(payload, "updated_at")) {
      delete payload.updated_at;
      continue;
    }
    throw error;
  }
  throw new Error("wallet_transaction_update_failed");
}

async function findWalletTransaction(reference: string) {
  const { data, error } = await supabaseAdmin
    .from("wallet_transactions")
    .select("*")
    .eq("reference", reference)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function ensureFundingTransaction(params: {
  walletId: string;
  userId: string;
  amount: number;
  currency: string;
  reference: string;
  estateId?: string | null;
  homeId?: string | null;
  callbackUrl?: string | null;
}) {
  const existing = await findWalletTransaction(params.reference);
  if (existing) return existing;

  return insertWalletTransactionWithFallback({
    wallet_id: params.walletId,
    user_id: params.userId,
    direction: "credit",
    type: "funding",
    amount: params.amount,
    reference: params.reference,
    status: "initialized",
    metadata: {
      provider: "paystack",
      currency: params.currency,
      estate_id: params.estateId || null,
      home_id: params.homeId || null,
      callback_url: params.callbackUrl || null,
      confirmation_source: "initialization",
    },
    updated_at: new Date().toISOString(),
  });
}

async function recordFundingActivityOnce(input: {
  userId: string;
  estateId?: string | null;
  homeId?: string | null;
  reference: string;
  amount: number;
  currency: string;
}) {
  const { data } = await supabaseAdmin
    .from("home_timeline")
    .select("id")
    .eq("event_type", "wallet.funded")
    .contains("metadata", { reference: input.reference })
    .limit(1);
  if ((data || []).length) return;

  await supabaseAdmin.from("home_timeline").insert({
    user_id: input.userId,
    estate_id: input.estateId || null,
    home_id: input.homeId || null,
    source: "wallet",
    event_type: "wallet.funded",
    category: "Wallet",
    importance: "normal",
    title: `Wallet funded with ${formatAmount(input.amount, input.currency)}.`,
    summary: `${formatAmount(input.amount, input.currency)} has been added to your wallet.`,
    severity: "info",
    metadata: {
      reference: input.reference,
      amount: input.amount,
      currency: input.currency,
    },
    occurred_at: new Date().toISOString(),
  } as any);
}

async function notifyFundingSuccess(input: {
  userId: string;
  walletId: string;
  reference: string;
  amount: number;
  currency: string;
  receipt: Record<string, any>;
}) {
  await NotificationService.sendToUser(String(input.userId), {
    title: "Wallet funded successfully",
    message: `${formatAmount(input.amount, input.currency)} has been added to your wallet.`,
    type: "wallet",
    entityId: String(input.walletId),
    payload: {
      wallet_id: input.walletId,
      transaction_id: input.receipt.transaction_id,
      transaction_reference: input.reference,
      receipt_reference: input.reference,
      kind: "wallet.funded",
      amount: input.amount,
      currency: input.currency,
      receipt: input.receipt,
      notification_key: `wallet_funding:${input.userId}:${input.reference}`,
    },
  });
}

async function reconcileWalletFunding(input: {
  reference: string;
  userId: string;
  providerPayload: Record<string, any>;
  confirmationSource: "paystack_webhook" | "payment_verify" | "payment_status";
  req?: Request;
}) {
  const wallet = await getOrCreateWallet(input.userId);
  const amount = safeNumber(input.providerPayload.amount);
  const currency = safeCurrency(input.providerPayload.currency || wallet.currency || "NGN");
  const paidAmount = amount > 1000 ? amount / 100 : amount;
  const metadata = input.providerPayload.metadata && typeof input.providerPayload.metadata === "object" ? input.providerPayload.metadata : {};
  const ownerUserId = String(metadata.userId || input.userId || "").trim();
  if (!ownerUserId || ownerUserId !== input.userId) {
    throw createPublicApiError(403, "wallet_ownership_mismatch", "This payment does not belong to the current wallet.");
  }

  const existing = await ensureFundingTransaction({
    walletId: String(wallet.id),
    userId: input.userId,
    amount: paidAmount,
    currency,
    reference: input.reference,
    estateId: metadata.estate_id || null,
    homeId: metadata.home_id || null,
    callbackUrl: metadata.callback_url || null,
  });

  if (String(existing.wallet_id || wallet.id) !== String(wallet.id)) {
    throw createPublicApiError(403, "wallet_ownership_mismatch", "This payment does not belong to the current wallet.");
  }

  const existingAmount = safeNumber(existing.amount);
  if (existingAmount && Math.abs(existingAmount - paidAmount) > 0.001) {
    throw createPublicApiError(409, "payment_amount_mismatch", "Payment confirmation could not be matched to the expected wallet amount.");
  }

  const existingStatus = normalizeFundingStatus(existing.status);
  if (existingStatus === "completed") {
    const receipt = buildFundingReceipt({
      transaction: existing,
      wallet,
      userId: input.userId,
      estateId: metadata.estate_id || null,
      homeId: metadata.home_id || null,
    });
    return { applied: false, status: "completed" as const, wallet, transaction: existing, receipt };
  }

  const creditingRows = await updateWalletTransactionWithFallback(
    input.reference,
    {
      status: "crediting",
      metadata: mergeMetadata(existing.metadata, {
        provider: "paystack",
        provider_reference: input.reference,
        paid_at: input.providerPayload.paid_at || input.providerPayload.paidAt || new Date().toISOString(),
        payment_method: input.providerPayload.channel || "card",
        channel: input.providerPayload.channel || "card",
        currency,
        confirmation_source: input.confirmationSource,
      }),
      updated_at: new Date().toISOString(),
    },
    ["initialized", "pending", "confirming", "failed"],
  );

  if (!creditingRows.length) {
    const latest = await findWalletTransaction(input.reference);
    if (normalizeFundingStatus(latest?.status) === "completed") {
      const receipt = buildFundingReceipt({
        transaction: latest,
        wallet,
        userId: input.userId,
        estateId: metadata.estate_id || null,
        homeId: metadata.home_id || null,
      });
      return { applied: false, status: "completed" as const, wallet, transaction: latest, receipt };
    }
    return { applied: false, status: "pending" as const, wallet, transaction: latest || existing, receipt: null };
  }

  // Security: atomic credit via Postgres RPC so concurrent funding
  // reconciliations never overwrite each other (race-free double-credit
  // prevention). Falls back to the legacy in-place increment only when the
  // RPC migration is not yet deployed, preserving backward compatibility.
  const creditReference = `funding_${input.reference}`;
  let nextBalance = safeNumber(wallet.balance) + paidAmount;
  let walletUpdateError: any = null;
  try {
    const { data: creditResult, error: creditErr } = await supabaseAdmin.rpc("oyi_credit_wallet", {
      p_user_id: input.userId,
      p_amount: paidAmount,
      p_reason: "funding",
      p_currency: currency,
      p_reference: creditReference,
      p_type: "funding",
    });
    if (creditErr && /could not find the function/i.test(String(creditErr.message || ""))) {
      // RPC not deployed — fall through to legacy in-place increment.
      const fallback = await supabaseAdmin
        .from("wallets")
        .update({ balance: nextBalance })
        .eq("id", wallet.id)
        .select("balance")
        .maybeSingle();
      if (fallback.error || !fallback.data) {
        walletUpdateError = fallback.error || new Error("wallet_credit_failed");
      } else {
        nextBalance = safeNumber(fallback.data.balance);
      }
    } else if (creditErr) {
      walletUpdateError = creditErr;
    } else {
      const result = (creditResult || {}) as any;
      if (!result.ok) {
        walletUpdateError = new Error(String(result.code || "wallet_credit_failed"));
      } else {
        nextBalance = safeNumber(result.balance);
      }
    }
  } catch (e: any) {
    walletUpdateError = e;
  }

  if (walletUpdateError) {
    await updateWalletTransactionWithFallback(
      input.reference,
      {
        status: "pending",
        metadata: mergeMetadata(existing.metadata, {
          last_error: walletUpdateError.message,
          confirmation_source: input.confirmationSource,
        }),
        updated_at: new Date().toISOString(),
      },
      ["crediting"],
    ).catch(() => null);
    throw walletUpdateError;
  }

  const receipt = buildFundingReceipt({
    transaction: {
      ...existing,
      amount: paidAmount,
      reference: input.reference,
      status: "completed",
      metadata: mergeMetadata(existing.metadata, {
        provider_reference: input.reference,
        currency,
        credited_amount: paidAmount,
        paid_at: input.providerPayload.paid_at || input.providerPayload.paidAt || new Date().toISOString(),
        payment_method: input.providerPayload.channel || "card",
        confirmation_source: input.confirmationSource,
      }),
    },
    wallet: { ...wallet, balance: nextBalance, currency },
    userId: input.userId,
    estateId: metadata.estate_id || null,
    homeId: metadata.home_id || null,
  });

  const completedRows = await updateWalletTransactionWithFallback(
    input.reference,
    {
      status: "completed",
      amount: paidAmount,
      metadata: mergeMetadata(existing.metadata, {
        provider: "paystack",
        provider_reference: input.reference,
        credited_amount: paidAmount,
        currency,
        paid_at: receipt.paid_at,
        payment_method: receipt.payment_method,
        confirmation_source: input.confirmationSource,
        receipt,
      }),
      updated_at: new Date().toISOString(),
    },
    ["crediting"],
  );
  const completedTx = completedRows[0] || (await findWalletTransaction(input.reference));

  await recordFundingActivityOnce({
    userId: input.userId,
    estateId: metadata.estate_id || null,
    homeId: metadata.home_id || null,
    reference: input.reference,
    amount: paidAmount,
    currency,
  });

  await handleSignal({
    type: "wallet.funded",
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "system",
    walletId: wallet.id,
    userId: input.userId,
    amount: paidAmount,
    currency,
    method: receipt.payment_method,
    reference: input.reference,
    timestamp: new Date().toISOString(),
    metadata: {
      provider: "paystack",
      confirmation_source: input.confirmationSource,
      receipt,
    },
  } as any);

  void publishSourceIntelligenceEvent({
    source: "consumer",
    surface: "consumer",
    event_type: "wallet.transaction.completed",
    category: "wallet",
    estate_id: metadata.estate_id || null,
    home_id: metadata.home_id || null,
    actor_id: input.userId,
    entity_type: "wallet_transaction",
    entity_id: input.reference,
    entity_label: "Wallet funding",
    severity: "info",
    title: "Wallet funding completed",
    summary: `${formatAmount(paidAmount, currency)} was added to the resident wallet.`,
    payload: {
      wallet_id: wallet.id,
      reference: input.reference,
      amount: paidAmount,
      balance: nextBalance,
      receipt,
    },
    occurred_at: new Date().toISOString(),
  }, { source_table: "wallet_transactions", source_event_id: input.reference });

  await notifyFundingSuccess({
    userId: input.userId,
    walletId: String(wallet.id),
    reference: input.reference,
    amount: paidAmount,
    currency,
    receipt,
  });

  return {
    applied: true,
    status: "completed" as const,
    wallet: { ...wallet, balance: nextBalance, currency },
    transaction: completedTx,
    receipt,
  };
}

async function providerVerification(reference: string) {
  const secret = getPaystackSecret();
  if (!secret) {
    throw createPublicApiError(503, "payment_provider_unavailable", "Wallet funding is temporarily unavailable right now.");
  }
  const paystack = paystackClient(secret);
  const response = await paystack.get(`/transaction/verify/${encodeURIComponent(reference)}`);
  return response?.data?.data || null;
}

async function walletFundingView(reference: string, userId?: string) {
  const transaction = await findWalletTransaction(reference);
  if (!transaction) return null;
  const wallet = transaction.wallet_id
    ? await supabaseAdmin.from("wallets").select("*").eq("id", transaction.wallet_id).maybeSingle().then(({ data }) => data || null)
    : null;
  const ownerId = String(transaction.user_id || wallet?.user_id || transaction?.metadata?.resident_id || "").trim();
  if (userId && ownerId && ownerId !== userId) {
    throw createPublicApiError(403, "wallet_ownership_mismatch", "This payment does not belong to the current wallet.");
  }
  const receipt = transaction?.metadata?.receipt || (wallet ? buildFundingReceipt({
    transaction,
    wallet,
    userId: ownerId || userId || "",
    estateId: transaction?.metadata?.estate_id || null,
    homeId: transaction?.metadata?.home_id || null,
  }) : null);
  return {
    transaction,
    wallet,
    ownerId,
    receipt,
  };
}

export async function getWallet(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  try {
    const wallet = await getOrCreateWallet(user.id);
    return res.json(wallet);
  } catch (error: any) {
    return sendPublicApiError(
      res,
      error,
      { statusCode: 500, code: "wallet_unavailable", message: "Wallet details are temporarily unavailable." },
      { operation: "wallet.get", actor_id: user.id, estate_id: user.estate_id || null, home_id: user.home_id || null },
    );
  }
}

export async function initPayment(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  if (!WALLET_FUNDING_ENABLED) {
    return res.status(503).json({
      error: "Wallet funding is temporarily disabled.",
      code: "WALLET_FUNDING_DISABLED",
    });
  }

  try {
    const secret = getPaystackSecret();
    if (!secret) {
      throw createPublicApiError(503, "payment_provider_unavailable", "Wallet funding is temporarily unavailable right now.");
    }

    const email = String(req.body?.email || user.email || "").trim();
    const amountNumber = safeNumber(req.body?.amount);
    if (!email || !email.includes("@")) {
      throw createPublicApiError(400, "wallet_email_required", "A valid email is required to fund your wallet.");
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      throw createPublicApiError(400, "wallet_amount_invalid", "Enter a valid amount to continue.");
    }

    const wallet = await getOrCreateWallet(user.id);
    const amountKobo = Math.round(amountNumber * 100);
    const callbackUrl = String(req.body?.callback_url || paymentReturnUrl(req)).trim();
    const paystack = paystackClient(secret);
    const response = await paystack.post("/transaction/initialize", {
      email,
      amount: amountKobo,
      callback_url: callbackUrl,
      metadata: {
        userId: user.id,
        estate_id: user.estate_id || null,
        home_id: user.home_id || null,
        callback_url: callbackUrl,
      },
    });

    const providerReference = String(response?.data?.data?.reference || response?.data?.reference || "").trim();
    if (!providerReference) {
      throw createPublicApiError(502, "payment_initialization_failed", "Unable to start wallet funding.");
    }

    await ensureFundingTransaction({
      walletId: String(wallet.id),
      userId: user.id,
      amount: amountNumber,
      currency: safeCurrency(wallet.currency || "NGN"),
      reference: providerReference,
      estateId: user.estate_id || null,
      homeId: user.home_id || null,
      callbackUrl,
    });

    void emitAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "wallet.funding.initialized",
      resourceType: "wallet",
      resourceId: String(wallet.id),
      estateId: user.estate_id,
      homeId: user.home_id,
      status: "success",
      metadata: { amount: amountNumber, email, reference: providerReference, callback_url: callbackUrl },
      req,
    });

    return res.json({
      ...response.data,
      callback_url: callbackUrl,
      reference: providerReference,
    });
  } catch (error: any) {
    return sendPublicApiError(
      res,
      error,
      { statusCode: 502, code: "payment_initialization_failed", message: "Unable to start wallet funding." },
      {
        operation: "wallet.init_payment",
        actor_id: user.id,
        estate_id: user.estate_id || null,
        home_id: user.home_id || null,
      },
    );
  }
}

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
      deliveryStatus: "failed",
      errorMessage: "paystack_secret_missing",
      payloadSummary: { event: eventType, reference: data?.reference || null },
      relatedUserId,
      req,
    });
    return res.sendStatus(200);
  }

  const signature = String(req.headers["x-paystack-signature"] || "");
  const raw = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
  const hash = crypto.createHmac("sha512", secret).update(raw).digest("hex");

  if (!signature || hash !== signature) {
    void recordProviderWebhookEvent({
      provider: "paystack",
      eventType,
      verified: false,
      signatureStatus: signature ? "invalid" : "missing",
      deliveryStatus: "failed",
      errorMessage: "invalid_signature",
      payloadSummary: { event: eventType, reference: data?.reference || null },
      relatedUserId,
      req,
    });
    return res.status(401).send("Invalid signature");
  }

  try {
    if (event?.event === "charge.success") {
      const userId = String(data?.metadata?.userId || "").trim();
      const reference = String(data?.reference || "").trim();
      if (!userId || !reference) {
        void recordProviderWebhookEvent({
          provider: "paystack",
          eventType,
          verified: true,
          signatureStatus: "verified",
          deliveryStatus: "ignored",
          errorMessage: !userId ? "missing_user_id" : "missing_reference",
          payloadSummary: { event: eventType, reference: reference || null },
          relatedUserId: userId || null,
          req,
        });
        return res.sendStatus(200);
      }

      await reconcileWalletFunding({
        reference,
        userId,
        providerPayload: data,
        confirmationSource: "paystack_webhook",
        req,
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
  } catch (error: any) {
    logger.error("wallet_webhook_processing_failed", {
      event_type: eventType,
      reference: data?.reference || null,
      actor_id: relatedUserId,
      error: error?.message || String(error),
      stack: error?.stack || null,
    });
    void recordProviderWebhookEvent({
      provider: "paystack",
      eventType,
      verified: true,
      signatureStatus: "verified",
      deliveryStatus: "failed",
      errorMessage: error?.message || "handler_error",
      payloadSummary: { event: eventType, reference: data?.reference || null },
      relatedUserId,
      req,
    });
  }

  return res.sendStatus(200);
}

export async function getFundingStatus(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  try {
    const reference = String(req.params?.reference || req.query?.reference || "").trim();
    if (!reference) {
      throw createPublicApiError(400, "payment_reference_required", "Payment reference is required.");
    }

    let current = await walletFundingView(reference, user.id);
    const localStatus = normalizeFundingStatus(current?.transaction?.status);
    const shouldReconcile = String(req.query.reconcile || "false").toLowerCase() === "true";

    if ((!current || ["initialized", "pending", "confirming", "crediting"].includes(localStatus)) && shouldReconcile) {
      const providerPayload = await providerVerification(reference);
      if (providerPayload?.status === "success") {
        await reconcileWalletFunding({
          reference,
          userId: String(providerPayload?.metadata?.userId || user.id),
          providerPayload,
          confirmationSource: "payment_status",
          req,
        });
        current = await walletFundingView(reference, user.id);
      }
    }

    if (!current) {
      return res.status(404).json({
        error: "Payment record could not be found.",
        code: "payment_not_found",
      });
    }

    const status = normalizeFundingStatus(current.transaction?.status);
    const messaging = fundingMessage(status);
    return res.json({
      ok: true,
      state: publicFundingState(current.transaction),
      status,
      title: messaging.title,
      summary: messaging.summary,
      transaction: {
        id: current.transaction?.id || null,
        reference,
        amount: safeNumber(current.transaction?.amount),
        currency: safeCurrency(current.transaction?.metadata?.currency || current.wallet?.currency || "NGN"),
        wallet_id: current.wallet?.id || current.transaction?.wallet_id || null,
        receipt_available: Boolean(current.receipt),
      },
      receipt: current.receipt,
    });
  } catch (error: any) {
    return sendPublicApiError(
      res,
      error,
      { statusCode: 500, code: "payment_status_unavailable", message: "Payment confirmation is temporarily unavailable." },
      { operation: "wallet.get_funding_status", actor_id: user.id, reference: req.params?.reference || req.query?.reference || null },
    );
  }
}

export async function getFundingReceipt(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  try {
    const reference = String(req.params?.reference || "").trim();
    if (!reference) {
      throw createPublicApiError(400, "payment_reference_required", "Payment reference is required.");
    }
    const current = await walletFundingView(reference, user.id);
    if (!current?.transaction) {
      throw createPublicApiError(404, "receipt_not_found", "Payment receipt could not be found.");
    }
    if (normalizeFundingStatus(current.transaction?.status) !== "completed" || !current.receipt) {
      throw createPublicApiError(409, "payment_confirmation_pending", "Your payment was received and is still being confirmed.");
    }
    return res.json({
      ok: true,
      receipt: current.receipt,
    });
  } catch (error: any) {
    return sendPublicApiError(
      res,
      error,
      { statusCode: 500, code: "receipt_unavailable", message: "Payment receipt is temporarily unavailable." },
      { operation: "wallet.get_funding_receipt", actor_id: user.id, reference: req.params?.reference || null },
    );
  }
}

export async function getFundingTransaction(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  try {
    const reference = String(req.params?.reference || "").trim();
    if (!reference) {
      throw createPublicApiError(400, "payment_reference_required", "Payment reference is required.");
    }
    const current = await walletFundingView(reference, user.id);
    if (!current?.transaction) {
      throw createPublicApiError(404, "payment_not_found", "Payment record could not be found.");
    }
    return res.json({
      ok: true,
      transaction: {
        id: current.transaction?.id || null,
        reference,
        status: normalizeFundingStatus(current.transaction?.status),
        amount: safeNumber(current.transaction?.amount),
        currency: safeCurrency(current.transaction?.metadata?.currency || current.wallet?.currency || "NGN"),
        created_at: current.transaction?.created_at || null,
      },
      receipt: current.receipt,
    });
  } catch (error: any) {
    return sendPublicApiError(
      res,
      error,
      { statusCode: 500, code: "payment_record_unavailable", message: "Payment details are temporarily unavailable." },
      { operation: "wallet.get_funding_transaction", actor_id: user.id, reference: req.params?.reference || null },
    );
  }
}

export async function verifyPayment(req: Request, res: Response) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  if (!WALLET_FUNDING_ENABLED) {
    return res.status(503).json({
      error: "Wallet funding is temporarily disabled.",
      code: "WALLET_FUNDING_DISABLED",
    });
  }

  try {
    const reference = String(req.params?.reference || req.query?.reference || req.body?.reference || "").trim();
    if (!reference) {
      throw createPublicApiError(400, "payment_reference_required", "Payment reference is required.");
    }

    const payload = await providerVerification(reference);
    if (!payload || payload?.status !== "success") {
      throw createPublicApiError(409, "payment_confirmation_pending", "Your payment was received and is still being confirmed.");
    }

    const ownerUserId = String(payload?.metadata?.userId || user.id);
    if (ownerUserId !== user.id) {
      throw createPublicApiError(403, "wallet_ownership_mismatch", "This payment does not belong to the current wallet.");
    }

    const reconciled = await reconcileWalletFunding({
      reference,
      userId: ownerUserId,
      providerPayload: payload,
      confirmationSource: "payment_verify",
      req,
    });

    return res.json({
      ok: true,
      applied: reconciled.applied,
      state: reconciled.status === "completed" ? "success" : "pending",
      status: reconciled.status,
      balance: safeNumber(reconciled.wallet?.balance),
      reference,
      receipt: reconciled.receipt,
    });
  } catch (error: any) {
    return sendPublicApiError(
      res,
      error,
      { statusCode: 500, code: "payment_confirmation_unavailable", message: "Payment confirmation is temporarily unavailable." },
      { operation: "wallet.verify_payment", actor_id: user.id, reference: req.params?.reference || req.query?.reference || req.body?.reference || null },
    );
  }
}

/**
 * Security: atomic wallet debit via Postgres RPC.
 *
 * Uses the `oyi_debit_wallet` SECURITY DEFINER function which performs the
 * balance mutation in a single conditional UPDATE ... RETURNING statement,
 * eliminating the read-modify-write race condition that previously allowed
 * double-spending via concurrent requests.
 *
 * Returns { ok, balance, reference } on success, or throws a PublicApiError.
 * Falls back to the legacy non-atomic path ONLY if the RPC is not deployed
 * (function not found), preserving backward compatibility during rollout.
 */
async function atomicDebitWallet(input: {
  userId: string;
  amount: number;
  reason: string;
  currency: string;
}): Promise<{ balance: number; reference: string }> {
  const reference = `debit_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  const { data, error } = await supabaseAdmin.rpc("oyi_debit_wallet", {
    p_user_id: input.userId,
    p_amount: input.amount,
    p_reason: input.reason,
    p_currency: input.currency,
    p_reference: reference,
    p_type: "service_charge",
  });

  if (error) {
    // If the RPC is not deployed yet, signal the caller to use the fallback.
    if (String(error.message || "").toLowerCase().includes("could not find the function")) {
      const fallbackError: any = new Error("RPC_NOT_DEPLOYED");
      fallbackError.rpcMissing = true;
      throw fallbackError;
    }
    throw createPublicApiError(500, "wallet_debit_failed", "Wallet debit could not be completed.");
  }

  const result = (data || {}) as any;
  if (!result.ok) {
    const code = String(result.code || "debit_failed");
    if (code === "insufficient_funds") {
      throw createPublicApiError(400, "wallet_insufficient_funds", "Insufficient funds.");
    }
    if (code === "frozen") {
      throw createPublicApiError(403, "wallet_frozen", "This wallet is currently unavailable.");
    }
    if (code === "wallet_not_found") {
      throw createPublicApiError(404, "wallet_not_found", "Wallet could not be found.");
    }
    if (code === "invalid_amount") {
      throw createPublicApiError(400, "wallet_amount_invalid", "Enter a valid amount to continue.");
    }
    throw createPublicApiError(500, "wallet_debit_failed", "Wallet debit could not be completed.");
  }

  return {
    balance: safeNumber(result.balance),
    reference: String(result.reference || reference),
  };
}

export async function debitWallet(req: Request, res: Response) {
  const user = req.user!;
  try {
    const amountNumber = safeNumber(req.body?.amount);
    const reason = String(req.body?.reason || "manual_debit");
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      throw createPublicApiError(400, "wallet_amount_invalid", "Enter a valid amount to continue.");
    }

    const currency = safeCurrency((await getOrCreateWallet(user.id)).currency || "NGN");

    // Security: atomic debit. Throws PublicApiError on insufficient funds / frozen.
    let balance: number;
    let txReference: string;
    try {
      const result = await atomicDebitWallet({ userId: user.id, amount: amountNumber, reason, currency });
      balance = result.balance;
      txReference = result.reference;
    } catch (err: any) {
      // Backward-compat fallback: only when the RPC migration is not yet applied.
      if (!err?.rpcMissing) throw err;
      const wallet = await getOrCreateWallet(user.id);
      if (safeNumber(wallet.balance) < amountNumber) {
        throw createPublicApiError(400, "wallet_insufficient_funds", "Insufficient funds.");
      }
      if (Boolean(wallet?.is_frozen)) {
        throw createPublicApiError(403, "wallet_frozen", "This wallet is currently unavailable.");
      }
      balance = safeNumber(wallet.balance) - amountNumber;
      const { error: updateErr } = await supabaseAdmin
        .from("wallets")
        .update({ balance })
        .eq("id", wallet.id);
      if (updateErr) throw updateErr;
      txReference = `debit_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      await insertWalletTransactionWithFallback({
        wallet_id: wallet.id,
        user_id: user.id,
        direction: "debit",
        type: "service_charge",
        amount: amountNumber,
        reference: txReference,
        status: "completed",
        metadata: { reason, direction: "debit", currency },
        updated_at: new Date().toISOString(),
      });
    }

    await handleSignal({
      type: "wallet.debited",
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "user",
      walletId: user.id,
      userId: user.id,
      amount: amountNumber,
      currency,
      reason,
      timestamp: new Date().toISOString(),
    } as any);

    void publishSourceIntelligenceEvent({
      source: "consumer",
      surface: "consumer",
      event_type: "wallet.transaction.debited",
      category: "wallet",
      estate_id: user.estate_id || null,
      home_id: user.home_id || null,
      actor_id: user.id,
      entity_type: "wallet_transaction",
      entity_id: txReference,
      entity_label: "Wallet debit",
      severity: "info",
      title: "Wallet debit recorded",
      summary: `${formatAmount(amountNumber, currency)} was debited from the wallet.`,
      payload: { amount: amountNumber, balance, reason },
    }, { source_table: "wallet_transactions", source_event_id: txReference });

    void emitAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: "wallet.debited",
      resourceType: "wallet",
      resourceId: user.id,
      estateId: user.estate_id,
      homeId: user.home_id,
      status: "success",
      metadata: { amount: amountNumber, reason, reference: txReference, atomic: true },
      req,
    });

    return res.json({ balance });
  } catch (error: any) {
    return sendPublicApiError(
      res,
      error,
      { statusCode: 500, code: "wallet_debit_failed", message: "Wallet debit could not be completed." },
      { operation: "wallet.debit", actor_id: user.id, estate_id: user.estate_id || null, home_id: user.home_id || null },
    );
  }
}
