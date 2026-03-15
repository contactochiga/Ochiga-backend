import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts/versions";

type ServiceKey =
  | "utility_token"
  | "internet_service"
  | "fiber_internet"
  | "service_charge"
  | "other_facility_fees";

const VALID_SERVICE_KEYS = new Set<ServiceKey>([
  "utility_token",
  "internet_service",
  "fiber_internet",
  "service_charge",
  "other_facility_fees",
]);

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

async function resolveHomeForUser(user: any) {
  if (user?.home_id) {
    const { data, error } = await supabaseAdmin
      .from("homes")
      .select("id, electricity_meter, internet_id")
      .eq("id", user.home_id)
      .maybeSingle();
    if (!error && data?.id) return data;
  }

  const { data: membership, error: memErr } = await supabaseAdmin
    .from("estate_memberships")
    .select("home_id,status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (memErr || !membership?.home_id) return null;

  const { data: home, error: homeErr } = await supabaseAdmin
    .from("homes")
    .select("id, electricity_meter, internet_id")
    .eq("id", membership.home_id)
    .maybeSingle();
  if (homeErr) return null;
  return home || null;
}

function expectedAccountRef(serviceKey: ServiceKey, home: any): string {
  if (!home?.id) return "";
  if (serviceKey === "utility_token") return String(home.electricity_meter || "");
  if (serviceKey === "internet_service" || serviceKey === "fiber_internet")
    return String(home.internet_id || "");
  return String(home.id || "");
}

export async function payServiceFromWallet(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const serviceKey = String(req.body?.service_key || "").trim() as ServiceKey;
  const accountRef = String(req.body?.account_ref || "").trim();
  const amount = Number(req.body?.amount);

  if (!VALID_SERVICE_KEYS.has(serviceKey)) {
    return res.status(400).json({ error: "Invalid service_key" });
  }
  if (!Number.isFinite(amount) || amount < 100) {
    return res.status(400).json({ error: "Amount must be at least 100" });
  }

  const home = await resolveHomeForUser(user);
  if (!home?.id) return res.status(400).json({ error: "No home linked to this account" });

  const expectedRef = expectedAccountRef(serviceKey, home);
  if (!expectedRef) {
    return res.status(400).json({ error: "Service account is not linked for this home" });
  }
  if (accountRef !== expectedRef) {
    return res.status(400).json({ error: "Account reference mismatch for this service" });
  }

  let wallet: any;
  try {
    wallet = await getOrCreateWallet(user.id);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load wallet" });
  }

  const current = Number(wallet.balance || 0);
  if (current < amount) return res.status(400).json({ error: "Insufficient funds" });
  if (Boolean(wallet?.is_frozen)) return res.status(403).json({ error: "Wallet is frozen" });

  const nextBalance = current - amount;
  const reference = `svc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const { error: updateErr } = await supabaseAdmin
    .from("wallets")
    .update({ balance: nextBalance })
    .eq("id", wallet.id);
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  const metadata = {
    service_key: serviceKey,
    account_ref: accountRef,
    home_id: String(home.id),
    source: "services_api",
  };

  const { data: txRow, error: txErr } = await supabaseAdmin
    .from("wallet_transactions")
    .insert([
      {
        wallet_id: wallet.id,
        direction: "debit",
        type: "service_payment",
        amount,
        reference,
        status: "completed",
        metadata,
        created_at: now,
      },
    ])
    .select("*")
    .single();
  if (txErr) return res.status(500).json({ error: txErr.message });

  await handleSignal({
    type: "wallet.debited",
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "user",
    walletId: wallet.id,
    userId: user.id,
    amount,
    currency: "NGN",
    reason: `service_payment:${serviceKey}`,
    timestamp: now,
  });

  return res.json({
    ok: true,
    balance: nextBalance,
    receipt: {
      id: String(txRow?.id || reference),
      reference,
      service_key: serviceKey,
      account_ref: accountRef,
      amount,
      status: "completed",
      created_at: now,
    },
  });
}

export async function listServicePayments(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const serviceFilter = String(req.query.service_key || "").trim();
  const homeFilter = String(req.query.home_id || "").trim();

  let wallet: any;
  try {
    wallet = await getOrCreateWallet(user.id);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load wallet" });
  }

  const { data, error } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id,amount,reference,status,metadata,created_at,type,direction")
    .eq("wallet_id", wallet.id)
    .eq("direction", "debit")
    .eq("type", "service_payment")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []).filter((x: any) => {
    const meta = x?.metadata || {};
    if (serviceFilter && String(meta.service_key || "") !== serviceFilter) return false;
    if (homeFilter && String(meta.home_id || "") !== homeFilter) return false;
    return true;
  });

  return res.json({
    ok: true,
    payments: rows.map((x: any) => ({
      id: String(x.id),
      amount: Number(x.amount || 0),
      reference: String(x.reference || ""),
      status: String(x.status || "completed"),
      created_at: x.created_at || null,
      service_key: String(x?.metadata?.service_key || ""),
      account_ref: String(x?.metadata?.account_ref || ""),
      home_id: String(x?.metadata?.home_id || ""),
    })),
  });
}
