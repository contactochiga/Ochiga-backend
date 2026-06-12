import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts/versions";
import { NotificationService } from "../services/NotificationService";
import { sendEmail } from "../services/emailService";
import { emitServiceRegistryEvent } from "../services/serviceRegistryEvents";

type ServiceKey =
  | "utility_token"
  | "water_service"
  | "internet_service"
  | "fiber_internet"
  | "service_charge"
  | "other_facility_fees";

const VALID_SERVICE_KEYS = new Set<ServiceKey>([
  "utility_token",
  "water_service",
  "internet_service",
  "fiber_internet",
  "service_charge",
  "other_facility_fees",
]);

const SERVICE_TX_TYPE: Record<ServiceKey, string> = {
  utility_token: "power",
  water_service: "water",
  internet_service: "internet",
  fiber_internet: "internet",
  service_charge: "service_charge",
  other_facility_fees: "service_charge",
};

const SERVICE_CONFIG_DEFAULTS: Record<
  ServiceKey,
  {
    title: string;
    description: string;
    suggested_amount: number;
    account_label: string;
    account_hint: string;
    active: boolean;
    unit_cost: number | null;
    unit_name: string | null;
    billing_mode: "wallet_only" | "metered" | "fixed";
  }
> = {
  utility_token: {
    title: "Utility Token",
    description: "Electricity token purchase",
    suggested_amount: 5000,
    account_label: "Electricity Meter",
    account_hint: "Linked from the assigned home meter",
    active: true,
    unit_cost: null,
    unit_name: "kWh",
    billing_mode: "metered",
  },
  water_service: {
    title: "Water Service",
    description: "Water recharge and usage billing",
    suggested_amount: 12000,
    account_label: "Water Meter",
    account_hint: "Linked from the assigned home water meter",
    active: true,
    unit_cost: null,
    unit_name: "m3",
    billing_mode: "metered",
  },
  internet_service: {
    title: "Fiber Internet Service",
    description: "Data bundles and monthly fiber internet renewals",
    suggested_amount: 11500,
    account_label: "Internet ID",
    account_hint: "Linked from the assigned home internet account",
    active: true,
    unit_cost: null,
    unit_name: "bundle",
    billing_mode: "fixed",
  },
  fiber_internet: {
    title: "Fiber Internet",
    description: "Fiber broadband subscriptions",
    suggested_amount: 15000,
    account_label: "Fiber Account",
    account_hint: "Uses the linked home internet ID",
    active: false,
    unit_cost: null,
    unit_name: "plan",
    billing_mode: "fixed",
  },
  service_charge: {
    title: "Service Charge",
    description: "Estate operational dues",
    suggested_amount: 500000,
    account_label: "Home Account",
    account_hint: "Charged against the linked home record",
    active: true,
    unit_cost: null,
    unit_name: "month",
    billing_mode: "fixed",
  },
  other_facility_fees: {
    title: "Other Facility Fees",
    description: "Special estate fees and one-off charges",
    suggested_amount: 5000,
    account_label: "Home Account",
    account_hint: "Charged against the linked home record",
    active: true,
    unit_cost: null,
    unit_name: "fee",
    billing_mode: "fixed",
  },
};

const MANAGE_ESTATE_ROLES = new Set(["owner", "admin", "manager", "security"]);
const FACILITY_ALERT_ROLES = ["owner", "admin", "manager", "security", "operator"];
const LOW_BALANCE_THRESHOLD = Number(process.env.LOW_WALLET_BALANCE_THRESHOLD || 5000);


async function assertCanReadEstate(userId: string, estateId: string) {
  const { data, error } = await supabaseAdmin
    .from("estate_memberships")
    .select("status")
    .eq("estate_id", estateId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return String(data?.status || "") === "active";
}

async function assertCanManageEstate(userId: string, estateId: string) {
  const { data, error } = await supabaseAdmin
    .from("estate_memberships")
    .select("role, status")
    .eq("estate_id", estateId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || String(data.status) !== "active") return false;
  return MANAGE_ESTATE_ROLES.has(String(data.role || "").toLowerCase());
}

function tableMissing(error: any) {
  const message = String(error?.message || "");
  return (
    message.includes("Could not find the table") ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

type ServiceConfigRow = {
  estate_id: string;
  service_key: ServiceKey;
  title: string;
  description: string;
  suggested_amount: number;
  currency: string;
  active: boolean;
  account_label: string;
  account_hint: string;
  payment_mode: "wallet_only";
  unit_cost?: number | null;
  unit_name?: string | null;
  billing_mode?: "wallet_only" | "metered" | "fixed";
  updated_at?: string;
  metadata?: Record<string, any> | null;
  created_at?: string;
};

function missingColumn(error: any, column: string) {
  const msg = String(error?.message || "");
  return msg.includes(column);
}

function normalizeServiceConfig(
  estateId: string,
  serviceKey: ServiceKey,
  row?: Partial<ServiceConfigRow> | null
): ServiceConfigRow {
  const fallback = SERVICE_CONFIG_DEFAULTS[serviceKey];
  return {
    estate_id: estateId,
    service_key: serviceKey,
    title: String(row?.title || fallback.title),
    description: String(row?.description || fallback.description),
    suggested_amount: Number(row?.suggested_amount ?? fallback.suggested_amount),
    currency: String(row?.currency || "NGN"),
    active: row?.active == null ? fallback.active : Boolean(row.active),
    account_label: String(row?.account_label || fallback.account_label),
    account_hint: String(row?.account_hint || fallback.account_hint),
    payment_mode: "wallet_only",
    unit_cost: row?.unit_cost == null ? fallback.unit_cost : Number(row.unit_cost),
    unit_name: row?.unit_name == null ? fallback.unit_name : String(row.unit_name || ""),
    billing_mode: (row?.billing_mode as any) || fallback.billing_mode,
    created_at: row?.created_at,
    updated_at: row?.updated_at,
  };
}

async function readServiceConfigsForEstate(estateId: string) {
  let { data, error } = await supabaseAdmin
    .from("estate_service_configs")
    .select(
      "estate_id, service_key, title, description, suggested_amount, currency, active, account_label, account_hint, payment_mode, unit_cost, unit_name, billing_mode, created_at, updated_at"
    )
    .eq("estate_id", estateId);

  if (error) {
    if (missingColumn(error, "unit_cost") || missingColumn(error, "unit_name") || missingColumn(error, "billing_mode")) {
      const legacy = await supabaseAdmin
        .from("estate_service_configs")
        .select(
          "estate_id, service_key, title, description, suggested_amount, currency, active, account_label, account_hint, payment_mode, created_at, updated_at"
        )
        .eq("estate_id", estateId);
      data = legacy.data as any;
      error = legacy.error as any;
    }
  }

  if (error) {
    if (tableMissing(error)) {
      return {
        configs: (Object.keys(SERVICE_CONFIG_DEFAULTS) as ServiceKey[]).map((serviceKey) =>
          normalizeServiceConfig(estateId, serviceKey)
        ),
        usingFallback: true,
      };
    }
    throw new Error(error.message);
  }

  const byKey = new Map<ServiceKey, Partial<ServiceConfigRow>>();
  for (const row of (data || []) as Partial<ServiceConfigRow>[]) {
    const key = String(row.service_key || "") as ServiceKey;
    if (VALID_SERVICE_KEYS.has(key)) byKey.set(key, row);
  }

  return {
    configs: (Object.keys(SERVICE_CONFIG_DEFAULTS) as ServiceKey[]).map((serviceKey) =>
      normalizeServiceConfig(estateId, serviceKey, byKey.get(serviceKey))
    ),
    usingFallback: false,
  };
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

async function insertWalletTransactionWithFallback(row: Record<string, any>) {
  let payload = { ...row };

  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabaseAdmin
      .from("wallet_transactions")
      .insert([payload])
      .select("*")
      .single();

    if (!error) return data;
    if (missingColumn(error, "direction") && Object.prototype.hasOwnProperty.call(payload, "direction")) {
      delete payload.direction;
      payload.metadata = {
        ...(payload.metadata || {}),
        direction: row.direction || null,
      };
      continue;
    }
    throw new Error(error.message);
  }

  throw new Error("Failed to insert wallet transaction");
}

async function listWalletTransactionsWithFallback(walletId: string, limit: number) {
  let { data, error } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id,amount,reference,status,metadata,created_at,type,direction")
    .eq("wallet_id", walletId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error && missingColumn(error, "direction")) {
    const legacy = await supabaseAdmin
      .from("wallet_transactions")
      .select("id,amount,reference,status,metadata,created_at,type")
      .eq("wallet_id", walletId)
      .order("created_at", { ascending: false })
      .limit(limit);
    data = legacy.data as any;
    error = legacy.error as any;
  }

  if (error) throw new Error(error.message);
  return data || [];
}

function buildReceiptDetails(config: ServiceConfigRow | null, serviceKey: ServiceKey, amount: number, extras?: Record<string, any>) {
  const unitCost = config?.unit_cost == null ? null : Number(config.unit_cost);
  const computedUnits =
    unitCost && unitCost > 0 ? Number((amount / unitCost).toFixed(2)) : null;

  return {
    title: config?.title || SERVICE_CONFIG_DEFAULTS[serviceKey].title,
    description: config?.description || SERVICE_CONFIG_DEFAULTS[serviceKey].description,
    unit_cost: unitCost,
    unit_name: config?.unit_name || null,
    billing_mode: config?.billing_mode || SERVICE_CONFIG_DEFAULTS[serviceKey].billing_mode,
    computed_units: computedUnits,
    bundle_name: extras?.bundle_name ? String(extras.bundle_name) : null,
    period_label: extras?.period_label ? String(extras.period_label) : null,
    token_code: null,
    fulfillment_status: providerFulfillmentStatus(serviceKey),
  };
}

async function sendServiceReceiptEmail(user: any, receipt: any) {
  const to = String(user?.email || "").trim();
  if (!to || !to.includes("@")) return;

  const unitsLine =
    receipt?.computed_units != null && receipt?.unit_name
      ? `<p><strong>Units:</strong> ${receipt.computed_units} ${receipt.unit_name}</p>`
      : "";
  const tokenLine = receipt?.token_code
    ? `<p><strong>Token:</strong> <span style="font-size:18px;font-weight:700;letter-spacing:2px;">${receipt.token_code}</span></p>`
    : "";
  const planLine = receipt?.bundle_name
    ? `<p><strong>Plan:</strong> ${receipt.bundle_name}</p>`
    : receipt?.period_label
    ? `<p><strong>Plan:</strong> ${receipt.period_label}</p>`
    : "";

  await sendEmail({
    to,
    subject: `${receipt.service_title} receipt`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#111">
        <h2 style="margin:0 0 8px;">Payment receipt</h2>
        <p style="margin:0 0 16px;">Your ${receipt.service_title} payment has been completed.</p>
        <p><strong>Reference:</strong> ${receipt.reference}</p>
        <p><strong>Amount:</strong> NGN ${Number(receipt.amount || 0).toLocaleString("en-NG")}</p>
        <p><strong>Account:</strong> ${receipt.account_ref}</p>
        ${planLine}
        ${unitsLine}
        ${tokenLine}
      </div>
    `,
    text: [
      `Payment receipt for ${receipt.service_title}`,
      `Reference: ${receipt.reference}`,
      `Amount: NGN ${Number(receipt.amount || 0).toLocaleString("en-NG")}`,
      `Account: ${receipt.account_ref}`,
      receipt?.bundle_name ? `Plan: ${receipt.bundle_name}` : receipt?.period_label ? `Plan: ${receipt.period_label}` : "",
      receipt?.computed_units != null && receipt?.unit_name ? `Units: ${receipt.computed_units} ${receipt.unit_name}` : "",
      receipt?.token_code ? `Token: ${receipt.token_code}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

async function notifyFacilityOpsOfPayment(estateId: string, receipt: any, user: any, home: any) {
  const messageBase = `${receipt.service_title} paid by ${String(user?.full_name || user?.username || user?.email || "resident")} for ${String(home?.name || home?.id || "home")}.`;
  const extra = receipt?.token_code ? ` Token ${receipt.token_code}.` : "";

  for (const role of FACILITY_ALERT_ROLES) {
    try {
      await NotificationService.sendToRole(estateId, role, {
        title: `${receipt.service_title} payment received`,
        message: `${messageBase}${extra}`,
        type: "wallet",
        payload: {
          estate_id: estateId,
          kind: "service.payment.received",
          receipt,
          user_id: String(user?.id || ""),
          home_id: String(home?.id || ""),
        },
        entityId: String(receipt.id || receipt.reference),
      });
    } catch (err) {
      console.warn(`service payment notify failed for role ${role}:`, err);
    }
  }
}

async function notifyLowWalletBalance(user: any, balance: number) {
  if (!user?.id) return;
  if (!Number.isFinite(balance)) return;
  if (balance > LOW_BALANCE_THRESHOLD) return;

  try {
    await NotificationService.sendToUser(String(user.id), {
      title: "Wallet running low",
      message: `Your wallet balance is NGN ${Number(balance).toLocaleString("en-NG")}. Fund your wallet to avoid failed service payments.`,
      type: "wallet",
      payload: {
        kind: "wallet.low_balance",
        balance: Number(balance),
        threshold: LOW_BALANCE_THRESHOLD,
        estate_id: String(user?.estate_id || "") || null,
      },
      entityId: String(user.id),
    });
  } catch (err) {
    console.warn("low wallet balance notify failed:", err);
  }
}

async function fetchEstateServicePayments(estateId: string, limit: number) {
  const { data: homes, error: homeErr } = await supabaseAdmin
    .from("homes")
    .select("id,name,unit,block")
    .eq("estate_id", estateId);
  if (homeErr) throw new Error(homeErr.message);

  const homeIds = (homes || []).map((x: any) => String(x.id)).filter(Boolean);
  const homeMap = new Map((homes || []).map((x: any) => [String(x.id), x]));
  if (!homeIds.length) return [];

  let { data: txRows, error: txErr } = await supabaseAdmin
    .from("wallet_transactions")
    .select("id,wallet_id,type,amount,reference,status,metadata,created_at,direction")
    .order("created_at", { ascending: false })
    .limit(Math.max(limit * 5, 200));
  if (txErr && missingColumn(txErr, "direction")) {
    const legacy = await supabaseAdmin
      .from("wallet_transactions")
      .select("id,wallet_id,type,amount,reference,status,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(Math.max(limit * 5, 200));
    txRows = legacy.data as any;
    txErr = legacy.error as any;
  }
  if (txErr) throw new Error(txErr.message);

  const walletIds = Array.from(new Set((txRows || []).map((x: any) => String(x.wallet_id || "")).filter(Boolean)));
  const { data: wallets, error: walletErr } = walletIds.length
    ? await supabaseAdmin.from("wallets").select("id,user_id,currency").in("id", walletIds)
    : ({ data: [], error: null } as any);
  if (walletErr) throw new Error(walletErr.message);

  const walletMap = new Map((wallets || []).map((x: any) => [String(x.id), x]));
  const userIds = Array.from(new Set((wallets || []).map((x: any) => String(x.user_id || "")).filter(Boolean)));
  const { data: users, error: userErr } = userIds.length
    ? await supabaseAdmin.from("users").select("id,email,full_name,username").in("id", userIds)
    : ({ data: [], error: null } as any);
  if (userErr) throw new Error(userErr.message);
  const userMap = new Map((users || []).map((x: any) => [String(x.id), x]));

  return (txRows || [])
    .filter((row: any) => {
      const meta = row?.metadata || {};
      const homeId = String(meta?.home_id || "");
      const direction = String(row?.direction || meta?.direction || "").toLowerCase();
      return homeIds.includes(homeId) && String(meta?.source || "") === "services_api" && (!direction || direction === "debit");
    })
    .slice(0, limit)
    .map((row: any) => {
      const meta = row?.metadata || {};
      const home = homeMap.get(String(meta?.home_id || "")) as any;
      const wallet = walletMap.get(String(row?.wallet_id || "")) as any;
      const user = userMap.get(String(wallet?.user_id || "")) as any;
      return {
        id: String(row.id),
        amount: Number(row.amount || 0),
        reference: String(row.reference || ""),
        status: String(row.status || "completed"),
        created_at: row.created_at || null,
        type: String(row.type || ""),
        service_key: String(meta?.service_key || ""),
        service_title: String(meta?.receipt?.title || ""),
        account_ref: String(meta?.account_ref || ""),
        token_code: meta?.receipt?.token_code || null,
        bundle_name: meta?.receipt?.bundle_name || null,
        period_label: meta?.receipt?.period_label || null,
        user_email: user?.email || null,
        user_name: user?.full_name || user?.username || null,
        home_id: home?.id || null,
        home_name: home?.name || null,
        home_label: [home?.block, home?.unit].filter(Boolean).join(" / ") || null,
      };
    });
}

async function canUseHomeContext(user: any, homeId: string, estateId?: string | null) {
  const { data: membership, error } = await supabaseAdmin
    .from("home_memberships")
    .select("home_id,status,homes(id,estate_id)")
    .eq("user_id", user.id)
    .eq("home_id", homeId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(error.message);
  const home = Array.isArray((membership as any)?.homes) ? (membership as any).homes[0] : (membership as any)?.homes;
  if (home?.id && (!estateId || String(home.estate_id || "") === String(estateId))) return true;

  if (["admin", "super_admin", "ochiga_admin"].includes(String(user.role || ""))) return true;
  if (!estateId) return false;
  return assertCanReadEstate(String(user.id), String(estateId));
}

async function resolveHomeForUser(user: any, requested?: { homeId?: string | null; estateId?: string | null }) {
  const requestedHomeId = String(requested?.homeId || "").trim();
  const requestedEstateId = String(requested?.estateId || "").trim();
  const select = "id, estate_id, name, unit, block, electricity_meter, water_meter, internet_id";

  if (requestedHomeId) {
    const allowed = await canUseHomeContext(user, requestedHomeId, requestedEstateId || null);
    if (!allowed) throw Object.assign(new Error("No access to selected home"), { statusCode: 403 });
    let query = supabaseAdmin.from("homes").select(select).eq("id", requestedHomeId);
    if (requestedEstateId) query = query.eq("estate_id", requestedEstateId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    return data || null;
  }

  if (user?.home_id) {
    const { data, error } = await supabaseAdmin
      .from("homes")
      .select(select)
      .eq("id", user.home_id)
      .maybeSingle();
    if (!error && data?.id) return data;
  }

  const { data: membership, error: memErr } = await supabaseAdmin
    .from("home_memberships")
    .select("home_id,status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (memErr || !membership?.home_id) return null;

  const { data: home, error: homeErr } = await supabaseAdmin
    .from("homes")
    .select(select)
    .eq("id", membership.home_id)
    .maybeSingle();
  if (homeErr) return null;
  return home || null;
}

function expectedAccountRef(serviceKey: ServiceKey, home: any): string {
  if (!home?.id) return "";
  if (serviceKey === "utility_token") return String(home.electricity_meter || "");
  if (serviceKey === "water_service") return String(home.water_meter || "");
  if (serviceKey === "service_charge") return String(home.id || "");
  if (serviceKey === "other_facility_fees") return String(home.id || "");
  if (serviceKey === "internet_service" || serviceKey === "fiber_internet")
    return String(home.internet_id || "");
  return String(home.id || "");
}


function providerFulfillmentStatus(serviceKey: ServiceKey) {
  if (serviceKey === "service_charge" || serviceKey === "other_facility_fees") return "completed";
  return "manual_review";
}

function serviceStatusFrom(enabled: boolean, linked: boolean, serviceKey: ServiceKey) {
  if (!enabled) return "unavailable";
  if (!linked && ["utility_token", "water_service", "internet_service", "fiber_internet"].includes(serviceKey)) return "setup_needed";
  return providerFulfillmentStatus(serviceKey) === "manual_review" && serviceKey !== "service_charge" ? "available" : "active";
}

async function findLastServicePayments(walletId: string) {
  const rows = await listWalletTransactionsWithFallback(walletId, 200).catch(() => []);
  const byKey = new Map<string, any>();
  for (const row of rows || []) {
    const meta = row?.metadata || {};
    const key = String(meta?.service_key || "");
    if (!key || byKey.has(key)) continue;
    if (String(meta?.source || "") !== "services_api") continue;
    byKey.set(key, row);
  }
  return byKey;
}

async function readHomeServiceAccounts(homeId: string) {
  const { data, error } = await supabaseAdmin
    .from("home_service_accounts")
    .select("service_key, provider, account_ref, meter_id, plan, balance, outstanding, status, due_date, expires_at, linked, metadata")
    .eq("home_id", homeId);
  if (error) {
    if (tableMissing(error)) return new Map<string, any>();
    throw new Error(error.message);
  }
  return new Map((data || []).map((row: any) => [String(row.service_key || ""), row]));
}

async function readEstateServiceCount(estateId: string) {
  const { count, error } = await supabaseAdmin
    .from("estate_services")
    .select("id", { count: "exact", head: true })
    .eq("estate_id", estateId);
  if (error) return 0;
  return Number(count || 0);
}

function accountValue(accounts: Map<string, any>, serviceKey: ServiceKey, key: string, fallback: any = null) {
  const account = accounts.get(serviceKey) || accounts.get(serviceKey === "internet_service" ? "fiber_internet" : serviceKey);
  return account?.[key] ?? fallback;
}

async function buildHomeServiceRegistry(user: any, requested?: { homeId?: string | null; estateId?: string | null; includeDebug?: boolean }) {
  const home = await resolveHomeForUser(user, requested);
  if (!home?.id) throw Object.assign(new Error("No home linked to this account"), { statusCode: 400 });

  const estateId = String(home.estate_id || user.estate_id || "").trim();
  if (!estateId) throw Object.assign(new Error("No estate linked to this home"), { statusCode: 400 });

  const [{ configs, usingFallback }, wallet, accounts, facilityCount] = await Promise.all([
    readServiceConfigsForEstate(estateId),
    getOrCreateWallet(user.id),
    readHomeServiceAccounts(String(home.id)),
    readEstateServiceCount(estateId),
  ]);
  const configByKey = new Map(configs.map((cfg) => [cfg.service_key, cfg]));
  const paymentsByKey = await findLastServicePayments(String(wallet.id));

  const configEnabled = (key: ServiceKey) => Boolean(configByKey.get(key)?.active ?? true);
  const lastPaid = (key: ServiceKey) => paymentsByKey.get(key)?.created_at || null;
  const linked = (key: ServiceKey, fallback: any) => Boolean(fallback || accountValue(accounts, key, "linked", fallback));
  const status = (key: ServiceKey, isLinked: boolean) => String(accountValue(accounts, key, "status", serviceStatusFrom(configEnabled(key), isLinked, key)) || "available");

  const electricityLinked = linked("utility_token", Boolean(home.electricity_meter));
  const waterLinked = linked("water_service", Boolean(home.water_meter));
  const internetLinked = linked("internet_service", Boolean(home.internet_id));
  const serviceChargeEnabled = configEnabled("service_charge");
  const facilityEnabled = configEnabled("other_facility_fees");

  const response: any = {
    ok: true,
    estate_id: estateId,
    home_id: String(home.id),
    using_fallback: usingFallback,
    wallet: {
      balance: Number(wallet?.balance || 0),
      currency: String(wallet?.currency || "NGN"),
    },
    electricity: {
      enabled: configEnabled("utility_token"),
      meter_id: String(accountValue(accounts, "utility_token", "meter_id", home.electricity_meter || "") || ""),
      provider: accountValue(accounts, "utility_token", "provider", configByKey.get("utility_token")?.metadata?.provider || null),
      linked: electricityLinked,
      status: status("utility_token", electricityLinked),
      balance: accountValue(accounts, "utility_token", "balance", null),
      last_payment_at: lastPaid("utility_token"),
    },
    water: {
      enabled: configEnabled("water_service"),
      meter_id: String(accountValue(accounts, "water_service", "meter_id", home.water_meter || "") || ""),
      linked: waterLinked,
      status: status("water_service", waterLinked),
      balance: accountValue(accounts, "water_service", "balance", null),
      last_payment_at: lastPaid("water_service"),
    },
    internet: {
      enabled: configEnabled("internet_service") || configEnabled("fiber_internet"),
      provider: accountValue(accounts, "internet_service", "provider", null),
      plan: accountValue(accounts, "internet_service", "plan", null),
      account_id: String(accountValue(accounts, "internet_service", "account_ref", home.internet_id || "") || ""),
      linked: internetLinked,
      status: status("internet_service", internetLinked),
      expires_at: accountValue(accounts, "internet_service", "expires_at", null),
    },
    estate_fees: {
      enabled: serviceChargeEnabled,
      outstanding: accountValue(accounts, "service_charge", "outstanding", null),
      status: String(accountValue(accounts, "service_charge", "status", serviceChargeEnabled ? "active" : "unavailable") || "active"),
      due_date: accountValue(accounts, "service_charge", "due_date", null),
      last_payment_at: lastPaid("service_charge"),
    },
    facility_services: {
      enabled: facilityEnabled,
      available_count: facilityCount,
      status: facilityEnabled ? "available" : "unavailable",
      last_payment_at: lastPaid("other_facility_fees"),
    },
  };

  if (requested?.includeDebug || process.env.NODE_ENV !== "production") {
    response.debug = {
      estate_id: estateId,
      home_id: String(home.id),
      home_name: String(home.name || [home.block, home.unit].filter(Boolean).join(" / ") || ""),
      utility_source: "homes",
      electricity_meter_present: Boolean(String(home.electricity_meter || "").trim()),
      water_meter_present: Boolean(String(home.water_meter || "").trim()),
      internet_id_present: Boolean(String(home.internet_id || "").trim()),
    };
  }

  return response;
}

export async function getHomeServiceRegistry(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  try {
    const registry = await buildHomeServiceRegistry(user, {
      homeId: String(req.query.home_id || "").trim() || null,
      estateId: String(req.query.estate_id || "").trim() || null,
      includeDebug: String(req.query.debug || "") === "1",
    });
    return res.json(registry);
  } catch (e: any) {
    return res.status(Number(e?.statusCode || 500)).json({ error: e?.message || "Failed to load home service registry" });
  }
}

export async function listServiceConfigs(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const estateId = String(req.query.estate_id || user.estate_id || "").trim();
  if (!estateId) return res.status(400).json({ error: "No estate linked to this account" });

  try {
    const canRead = ["admin", "super_admin", "ochiga_admin"].includes(String(user.role || "")) || await assertCanReadEstate(user.id, estateId);
    if (!canRead) return res.status(403).json({ error: "Insufficient permissions" });
    const { configs, usingFallback } = await readServiceConfigsForEstate(estateId);
    return res.json({ ok: true, estate_id: estateId, configs, using_fallback: usingFallback });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load service configs" });
  }
}

export async function upsertServiceConfig(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const estateId = String(req.body?.estate_id || user.estate_id || "").trim();
  const serviceKey = String(req.params.serviceKey || "").trim() as ServiceKey;

  if (!estateId) return res.status(400).json({ error: "estate_id is required" });
  if (!VALID_SERVICE_KEYS.has(serviceKey)) return res.status(400).json({ error: "Invalid service_key" });

  try {
    const canManage = user.role === "admin" ? true : await assertCanManageEstate(user.id, estateId);
    if (!canManage) return res.status(403).json({ error: "Insufficient permissions" });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to validate estate access" });
  }

  const fallback = SERVICE_CONFIG_DEFAULTS[serviceKey];
  const payload: ServiceConfigRow = {
    estate_id: estateId,
    service_key: serviceKey,
    title: String(req.body?.title || fallback.title).trim(),
    description: String(req.body?.description || fallback.description).trim(),
    suggested_amount: Number(req.body?.suggested_amount ?? fallback.suggested_amount),
    currency: String(req.body?.currency || "NGN").trim() || "NGN",
    active: req.body?.active == null ? fallback.active : Boolean(req.body.active),
    account_label: String(req.body?.account_label || fallback.account_label).trim(),
    account_hint: String(req.body?.account_hint || fallback.account_hint).trim(),
    payment_mode: "wallet_only",
    unit_cost: req.body?.unit_cost == null || req.body?.unit_cost === "" ? null : Number(req.body.unit_cost),
    unit_name: String(req.body?.unit_name || fallback.unit_name || "").trim() || null,
    billing_mode: String(req.body?.billing_mode || fallback.billing_mode).trim() as any,
    updated_at: new Date().toISOString(),
  };

  if (!Number.isFinite(payload.suggested_amount) || payload.suggested_amount < 0) {
    return res.status(400).json({ error: "suggested_amount must be zero or greater" });
  }
  if (payload.unit_cost != null && (!Number.isFinite(payload.unit_cost) || payload.unit_cost < 0)) {
    return res.status(400).json({ error: "unit_cost must be zero or greater" });
  }

  const { data, error } = await supabaseAdmin
    .from("estate_service_configs")
    .upsert(payload, { onConflict: "estate_id,service_key" })
    .select(
      "estate_id, service_key, title, description, suggested_amount, currency, active, account_label, account_hint, payment_mode, unit_cost, unit_name, billing_mode, created_at, updated_at"
    )
    .single();

  if (error) {
    if (missingColumn(error, "unit_cost") || missingColumn(error, "unit_name") || missingColumn(error, "billing_mode")) {
      return res.status(400).json({
        error: "estate_service_configs columns for unit pricing are not configured yet",
        code: "SERVICE_CONFIG_COLUMNS_MISSING",
      });
    }
    if (tableMissing(error)) {
      return res.status(400).json({
        error: "estate_service_configs table is not configured yet",
        code: "SERVICE_CONFIG_TABLE_MISSING",
      });
    }
    return res.status(500).json({ error: error.message });
  }

  const config = normalizeServiceConfig(estateId, serviceKey, data as any);
  await emitServiceRegistryEvent({
    event: "service.config.updated",
    estate_id: estateId,
    service_key: serviceKey,
    user_id: String(user.id),
    actor_id: String(user.id),
    payload: { config },
  });
  return res.json({ ok: true, config });
}

export async function payServiceFromWallet(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const serviceKey = String(req.body?.service_key || "").trim() as ServiceKey;
  const accountRef = String(req.body?.account_ref || "").trim();
  const amount = Number(req.body?.amount);
  const bundleName = req.body?.bundle_name ? String(req.body.bundle_name).trim() : null;
  const periodLabel = req.body?.period_label ? String(req.body.period_label).trim() : null;

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

  const estateId = String(user.estate_id || "").trim();
  let activeConfig: ServiceConfigRow | null = null;
  if (estateId) {
    try {
      const { configs } = await readServiceConfigsForEstate(estateId);
      const cfg = configs.find((x) => x.service_key === serviceKey);
      activeConfig = (cfg || null) as ServiceConfigRow | null;
      if (cfg && !cfg.active) {
        return res.status(400).json({ error: `${cfg.title} is currently disabled for this estate` });
      }
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "Failed to validate service configuration" });
    }
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
    direction: "debit",
    receipt: buildReceiptDetails(activeConfig, serviceKey, amount, {
      bundle_name: bundleName,
      period_label: periodLabel,
    }),
  };

  const fulfillmentStatus = providerFulfillmentStatus(serviceKey);

  let txRow: any;
  try {
    txRow = await insertWalletTransactionWithFallback({
      wallet_id: wallet.id,
      direction: "debit",
      type: SERVICE_TX_TYPE[serviceKey],
      amount,
      reference,
      status: fulfillmentStatus,
      metadata,
      created_at: now,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to record wallet transaction" });
  }

  try {
    await supabaseAdmin.from("service_provider_transactions").insert([
      {
        service_key: serviceKey,
        estate_id: estateId || null,
        home_id: String(home.id),
        user_id: String(user.id),
        wallet_transaction_id: txRow?.id || null,
        provider: activeConfig?.metadata?.provider || null,
        account_ref: accountRef,
        amount,
        currency: String(wallet.currency || "NGN"),
        status: fulfillmentStatus,
        metadata: { reference, bundle_name: bundleName, period_label: periodLabel },
        created_at: now,
        updated_at: now,
      },
    ]);
  } catch (providerErr: any) {
    const msg = String(providerErr?.message || "");
    if (!msg.includes("service_provider_transactions") && !msg.includes("schema cache") && !msg.includes("does not exist")) {
      console.warn("service provider transaction insert failed:", providerErr);
    }
  }

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

  const receipt = {
    id: String(txRow?.id || reference),
    reference,
    service_key: serviceKey,
    service_title: metadata.receipt.title,
    account_ref: accountRef,
    amount,
    status: fulfillmentStatus,
    created_at: now,
    home_id: String(home.id),
    unit_cost: metadata.receipt.unit_cost,
    unit_name: metadata.receipt.unit_name,
    computed_units: metadata.receipt.computed_units,
    billing_mode: metadata.receipt.billing_mode,
    bundle_name: metadata.receipt.bundle_name,
    period_label: metadata.receipt.period_label,
  };

  try {
    await NotificationService.sendToUser(String(user.id), {
      title: `${metadata.receipt.title} payment recorded`,
      message: fulfillmentStatus === "completed"
        ? `Receipt ${reference} for NGN ${amount.toLocaleString("en-NG")} is ready.`
        : `Payment ${reference} is recorded and awaiting provider confirmation.`,
      type: "wallet",
      payload: {
        estate_id: estateId || null,
        kind: "service.receipt",
        receipt,
      },
      entityId: String(txRow?.id || reference),
    });
  } catch (notifyErr) {
    console.warn("service payment notification failed:", notifyErr);
  }

  if (estateId) {
    await notifyFacilityOpsOfPayment(estateId, receipt, user, home);
  }

  await notifyLowWalletBalance(user, nextBalance);

  try {
    await sendServiceReceiptEmail(user, receipt);
  } catch (mailErr) {
    console.warn("service receipt email failed:", mailErr);
  }

  await emitServiceRegistryEvent({
    event: "wallet.service_payment.updated",
    estate_id: estateId || null,
    home_id: String(home.id),
    service_key: serviceKey,
    user_id: String(user.id),
    actor_id: String(user.id),
    payload: { receipt, balance: nextBalance },
  });
  await emitServiceRegistryEvent({
    event: "home.service_registry.updated",
    estate_id: estateId || null,
    home_id: String(home.id),
    service_key: serviceKey,
    user_id: String(user.id),
    actor_id: String(user.id),
    payload: { reason: "service_payment" },
  });

  return res.json({
    ok: true,
    balance: nextBalance,
    receipt,
  });
}

export async function listEstateServicePayments(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const estateId = String(req.query.estate_id || user.estate_id || "").trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  if (!estateId) return res.status(400).json({ error: "estate_id is required" });

  try {
    const canManage = user.role === "admin" ? true : await assertCanManageEstate(user.id, estateId);
    if (!canManage) return res.status(403).json({ error: "Insufficient permissions" });

    const payments = await fetchEstateServicePayments(estateId, limit);
    return res.json({ ok: true, payments });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load estate service payments" });
  }
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

  let data: any[] = [];
  try {
    data = await listWalletTransactionsWithFallback(wallet.id, limit);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load wallet transactions" });
  }

  const rows = (data || []).filter((x: any) => {
    const direction = String(x?.direction || x?.metadata?.direction || "").toLowerCase();
    const meta = x?.metadata || {};
    if (direction && direction !== "debit") return false;
    const expectedTypes = new Set(Object.values(SERVICE_TX_TYPE));
    if (!expectedTypes.has(String(x?.type || ""))) return false;
    if (serviceFilter && String(meta.service_key || "") !== serviceFilter) return false;
    if (homeFilter && String(meta.home_id || "") !== homeFilter) return false;
    if (String(meta.source || "") !== "services_api") return false;
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
      service_title: String(x?.metadata?.receipt?.title || ""),
      account_ref: String(x?.metadata?.account_ref || ""),
      home_id: String(x?.metadata?.home_id || ""),
      unit_cost: x?.metadata?.receipt?.unit_cost ?? null,
      unit_name: x?.metadata?.receipt?.unit_name ?? null,
      computed_units: x?.metadata?.receipt?.computed_units ?? null,
      billing_mode: x?.metadata?.receipt?.billing_mode ?? null,
      bundle_name: x?.metadata?.receipt?.bundle_name ?? null,
      period_label: x?.metadata?.receipt?.period_label ?? null,
    })),
  });
}
