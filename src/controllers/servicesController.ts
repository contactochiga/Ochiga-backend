import { Request, Response } from "express";
import { randomBytes, randomUUID } from "crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts/versions";
import { NotificationService } from "../services/NotificationService";
import { sendEmail } from "../services/emailService";
import { emitServiceRegistryEvent } from "../services/serviceRegistryEvents";
import { publishSourceIntelligenceEvent } from "../intelligence-core";
import { emitInfrastructureServiceSignal } from "../services/infrastructureServiceSignals";
import { getInfrastructureServiceProvider, providerTypeForService, type ProviderHealth, type ServiceKey as ProviderServiceKey } from "../services/infrastructureServiceProviders";
import { logger } from "../observability/logger";
import { getOrCreateScopedWallet, resolveWalletScopeForHome } from "../services/walletScopeService";

type ServiceKey =
  | "utility_token"
  | "water_service"
  | "gas_service"
  | "internet_service"
  | "fiber_internet"
  | "generator_recovery"
  | "solar_battery_service"
  | "service_charge"
  | "other_facility_fees";

const VALID_SERVICE_KEYS = new Set<ServiceKey>([
  "utility_token",
  "water_service",
  "gas_service",
  "internet_service",
  "fiber_internet",
  "generator_recovery",
  "solar_battery_service",
  "service_charge",
  "other_facility_fees",
]);

const SERVICE_TX_TYPE: Record<ServiceKey, string> = {
  utility_token: "power",
  water_service: "water",
  gas_service: "gas",
  internet_service: "internet",
  fiber_internet: "internet",
  generator_recovery: "power",
  solar_battery_service: "power",
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
  gas_service: {
    title: "Gas Service",
    description: "Gas refill, piped gas recovery, and household gas settlements",
    suggested_amount: 10000,
    account_label: "Gas Account",
    account_hint: "Linked from the assigned home gas service record",
    active: true,
    unit_cost: null,
    unit_name: "kg",
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
  generator_recovery: {
    title: "Generator Recovery",
    description: "Backup generator recovery, diesel recovery, and outage continuity costs",
    suggested_amount: 7500,
    account_label: "Recovery Account",
    account_hint: "Linked from the home recovery profile",
    active: true,
    unit_cost: null,
    unit_name: "cycle",
    billing_mode: "fixed",
  },
  solar_battery_service: {
    title: "Solar / Battery Service",
    description: "Solar, inverter, and battery continuity service profile",
    suggested_amount: 12000,
    account_label: "Energy Backup Profile",
    account_hint: "Linked from the home solar or battery profile",
    active: true,
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

const SERVICE_DOMAIN_DEFAULTS: Record<
  ServiceKey,
  {
    domain: string;
    childLabel: string;
    policyLabel: string;
    providerLane: string;
  }
> = {
  utility_token: {
    domain: "Power & Energy",
    childLabel: "Electricity",
    policyLabel: "Electricity tariff",
    providerLane: "electricity_vending",
  },
  water_service: {
    domain: "Water",
    childLabel: "Water Supply",
    policyLabel: "Water tariff",
    providerLane: "water_billing",
  },
  gas_service: {
    domain: "Gas",
    childLabel: "Gas",
    policyLabel: "Gas tariff",
    providerLane: "gas_provider",
  },
  internet_service: {
    domain: "Internet",
    childLabel: "Internet",
    policyLabel: "Internet billing profile",
    providerLane: "internet_provider",
  },
  fiber_internet: {
    domain: "Internet",
    childLabel: "Fiber / ISP",
    policyLabel: "Internet billing profile",
    providerLane: "internet_provider",
  },
  generator_recovery: {
    domain: "Power & Energy",
    childLabel: "Generator Recovery",
    policyLabel: "Generator recovery tariff",
    providerLane: "generator_recovery",
  },
  solar_battery_service: {
    domain: "Power & Energy",
    childLabel: "Solar / Battery",
    policyLabel: "Solar and battery service profile",
    providerLane: "solar_battery",
  },
  service_charge: {
    domain: "Estate Fees",
    childLabel: "Estate Fees",
    policyLabel: "Estate service charge",
    providerLane: "estate_fees",
  },
  other_facility_fees: {
    domain: "Facility Services",
    childLabel: "Facility Services",
    policyLabel: "Facility service billing rules",
    providerLane: "facility_services",
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

function servicePublicError(error: any, fallback: string) {
  const status = Number(error?.statusCode || error?.status || 500);
  const message = String(error?.message || "");
  if (status === 401) return { status: 401, code: "service_auth_required", message: "Please sign in again to view your services." };
  if (status === 403) return { status: 403, code: "service_scope_denied", message: "This account does not have access to these home services." };
  if (status === 400 && /home/i.test(message)) return { status: 400, code: "home_context_unavailable", message: "Your home context could not be loaded." };
  if (tableMissing(error)) return { status: 503, code: "service_schema_unavailable", message: "Infrastructure services are temporarily unavailable." };
  if (/column|constraint|schema cache|function .*does not exist|Could not find the function/i.test(message)) return { status: 503, code: "service_schema_mismatch", message: "Infrastructure services are temporarily unavailable." };
  return { status: status >= 400 && status < 500 ? status : 500, code: "service_accounts_unavailable", message: fallback };
}

function serviceErrorResponse(res: Response, error: any, fallback: string, context: Record<string, unknown> = {}) {
  const publicError = servicePublicError(error, fallback);
  logger.error("infrastructure_services_request_failed", {
    ...context,
    status: publicError.status,
    code: publicError.code,
    error,
  });
  return res.status(publicError.status).json({
    ok: false,
    error: publicError.message,
    code: publicError.code,
  });
}

function serviceTransactionErrorResponse(
  req: Request,
  res: Response,
  error: any,
  fallback: string,
  context: Record<string, unknown> = {},
) {
  const publicError = servicePublicError(error, fallback);
  logger.error("service_transaction_failed", {
    request_id: req.requestId || null,
    correlation_id: req.correlationId || null,
    ...context,
    status: publicError.status,
    error_code: publicError.code,
    error,
  });
  return res.status(publicError.status).json({
    ok: false,
    code: publicError.code,
    error: publicError.message,
  });
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
  // Typed pricing (Facility <-> Consumer Utilities acceptance): the
  // canonical rate/plan data for this service, read from
  // service_pricing_plans. unit_cost/unit_name above remain untouched for
  // legacy readers; this is the authoritative source going forward.
  // Empty array is the honest "not yet configured" state -- never
  // fabricated.
  pricing_plans?: PricingPlanRow[];
};

type PricingPlanRow = {
  id: string;
  estate_id: string;
  service_key: ServiceKey;
  pricing_type: "usage_based" | "fixed" | "recurring" | "subscription";
  plan_name: string | null;
  unit_name: string | null;
  currency: string;
  rate_amount: number;
  billing_frequency: string | null;
  payment_timing: string | null;
  provider: string | null;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
};

const PRICING_PLAN_COLUMNS =
  "id, estate_id, service_key, pricing_type, plan_name, unit_name, currency, rate_amount, billing_frequency, payment_timing, provider, effective_from, effective_to, active";

async function readActivePricingPlansForEstate(estateId: string): Promise<Map<ServiceKey, PricingPlanRow[]>> {
  const byKey = new Map<ServiceKey, PricingPlanRow[]>();
  const { data, error } = await supabaseAdmin
    .from("service_pricing_plans")
    .select(PRICING_PLAN_COLUMNS)
    .eq("estate_id", estateId)
    .eq("active", true);
  if (error) {
    // Table not migrated yet in this environment, or a transient read
    // error -- degrade to "no typed pricing configured" rather than
    // failing the whole config read. Never fabricate a plan.
    return byKey;
  }
  for (const row of (data || []) as PricingPlanRow[]) {
    const key = String(row.service_key || "") as ServiceKey;
    if (!VALID_SERVICE_KEYS.has(key)) continue;
    const list = byKey.get(key) || [];
    list.push(row);
    byKey.set(key, list);
  }
  return byKey;
}

// The single, unambiguous current rate for a non-subscription service
// (usage_based/fixed/recurring only ever have one active row at a time,
// enforced by the DB's partial unique index). Subscription intentionally
// returns null here -- callers needing plan options read pricing_plans
// directly.
function primaryPricingPlan(plans?: PricingPlanRow[] | null): PricingPlanRow | null {
  if (!plans || !plans.length) return null;
  return plans.find((plan) => plan.pricing_type !== "subscription") || null;
}

type ServiceTransactionStatus =
  | "pending"
  | "pending_provider"
  | "manual_review"
  | "unsupported"
  | "completed"
  | "failed"
  | "cancelled";

type ServiceSettlementStatus =
  | "none"
  | "pending"
  | "queued"
  | "in_progress"
  | "settled"
  | "failed"
  | "unsupported";

type ServiceTransactionType =
  | "electricity_purchase"
  | "water_payment"
  | "internet_renewal"
  | "gas_order"
  | "generator_recovery"
  | "solar_battery_support"
  | "estate_fee"
  | "facility_service"
  | "issue_report"
  | "support_request";

function missingColumn(error: any, column: string) {
  const msg = String(error?.message || "");
  return msg.includes(column);
}

function extractMissingColumnName(msg: string): string | null {
  if (!msg) return null;
  let match = msg.match(/Could not find the ['"]([^'"]+)['"] column/i);
  if (match?.[1]) return match[1];
  match = msg.match(/column\s+"([^"]+)"\s+of\s+relation/i);
  if (match?.[1]) return match[1];
  return null;
}

function normalizeServiceConfig(
  estateId: string,
  serviceKey: ServiceKey,
  row?: Partial<ServiceConfigRow> | null,
  pricingPlans?: PricingPlanRow[]
): ServiceConfigRow {
  const fallback = SERVICE_CONFIG_DEFAULTS[serviceKey];
  const domainFallback = SERVICE_DOMAIN_DEFAULTS[serviceKey];
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const policyMeta = metadata?.policy && typeof metadata.policy === "object" ? metadata.policy : {};
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
    metadata: {
      ...metadata,
      policy: {
        service_key: serviceKey,
        domain: String(policyMeta?.domain || domainFallback.domain),
        child_label: String(policyMeta?.child_label || domainFallback.childLabel),
        policy_label: String(policyMeta?.policy_label || domainFallback.policyLabel),
        provider_lane: String(policyMeta?.provider_lane || domainFallback.providerLane),
        version: String(policyMeta?.version || "v1"),
        effective_from: policyMeta?.effective_from || row?.updated_at || row?.created_at || null,
        versioning_ready: policyMeta?.versioning_ready === false ? false : true,
      },
    },
    created_at: row?.created_at,
    updated_at: row?.updated_at,
    pricing_plans: pricingPlans || [],
  };
}

async function readServiceConfigsForEstate(estateId: string) {
  let { data, error } = await supabaseAdmin
    .from("estate_service_configs")
    .select(
      "estate_id, service_key, title, description, suggested_amount, currency, active, account_label, account_hint, payment_mode, unit_cost, unit_name, billing_mode, created_at, updated_at"
      + ", metadata"
    )
    .eq("estate_id", estateId);

  if (error) {
    if (missingColumn(error, "unit_cost") || missingColumn(error, "unit_name") || missingColumn(error, "billing_mode")) {
      const legacy = await supabaseAdmin
        .from("estate_service_configs")
        .select(
          "estate_id, service_key, title, description, suggested_amount, currency, active, account_label, account_hint, payment_mode, created_at, updated_at"
          + ", metadata"
        )
        .eq("estate_id", estateId);
      data = legacy.data as any;
      error = legacy.error as any;
    }
  }

  const pricingByKey = await readActivePricingPlansForEstate(estateId);

  if (error) {
    if (tableMissing(error)) {
      return {
        configs: (Object.keys(SERVICE_CONFIG_DEFAULTS) as ServiceKey[]).map((serviceKey) =>
          normalizeServiceConfig(estateId, serviceKey, null, pricingByKey.get(serviceKey))
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
      normalizeServiceConfig(estateId, serviceKey, byKey.get(serviceKey), pricingByKey.get(serviceKey))
    ),
    usingFallback: false,
  };
}

async function getOrCreateWallet(userId: string, scope?: { estateId?: string | null; homeId?: string | null; membershipId?: string | null }) {
  if (scope?.homeId) {
    return getOrCreateScopedWallet({
      userId,
      estateId: scope.estateId || null,
      homeId: scope.homeId || null,
      membershipId: scope.membershipId || null,
    });
  }

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

  for (let attempt = 0; attempt < 10; attempt++) {
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
    const missing = extractMissingColumnName(String(error?.message || ""));
    if (missing && Object.prototype.hasOwnProperty.call(payload, missing)) {
      payload.metadata = {
        ...(payload.metadata || {}),
        [missing]: payload[missing],
      };
      delete payload[missing];
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
  const metadata = config?.metadata && typeof config.metadata === "object" ? config.metadata : {};
  const policyMeta = metadata?.policy && typeof metadata.policy === "object" ? metadata.policy : {};

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
    policy_version: String(policyMeta?.version || "v1"),
    policy_effective_from: policyMeta?.effective_from || config?.updated_at || null,
    policy_domain: String(policyMeta?.domain || SERVICE_DOMAIN_DEFAULTS[serviceKey].domain),
    policy_label: String(policyMeta?.policy_label || SERVICE_DOMAIN_DEFAULTS[serviceKey].policyLabel),
  };
}

function asNumber(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function money(value: unknown) {
  return Number((Math.round(asNumber(value) * 100) / 100).toFixed(2));
}

// Exported for direct unit testing (no HTTP/DB mocking required -- these
// are pure functions of their inputs). See
// scripts/typed-utility-pricing-smoke.mjs.
export function electricityPolicyFromConfig(config: ServiceConfigRow | null) {
  const metadata = config?.metadata && typeof config.metadata === "object" ? config.metadata : {};
  const electricity = metadata?.electricity && typeof metadata.electricity === "object" ? metadata.electricity : {};
  // Typed pricing (service_pricing_plans) is now the authoritative rate
  // source; metadata.electricity.tariff_per_kwh and the legacy unit_cost
  // column remain only as a fallback for an estate that hasn't been
  // migrated/configured through the typed model yet.
  const plan = primaryPricingPlan(config?.pricing_plans);
  const tariff = asNumber(plan?.rate_amount ?? electricity.tariff_per_kwh ?? config?.unit_cost, 0);
  const unitName = String(plan?.unit_name || config?.unit_name || "kWh");
  const provider = plan?.provider || null;
  const effectiveFrom = String(
    plan?.effective_from || electricity.effective_from || metadata?.policy?.effective_from || config?.updated_at || config?.created_at || ""
  );
  return {
    residentPurchasesEnabled: electricity.resident_purchases_enabled == null ? Boolean(config?.active && tariff > 0) : Boolean(electricity.resident_purchases_enabled),
    minimumAmount: money(electricity.minimum_purchase_amount ?? 1000),
    maximumAmount: money(electricity.maximum_purchase_amount ?? 100000),
    fixedFee: money(electricity.fixed_fee ?? 0),
    percentageFee: asNumber(electricity.percentage_fee, 0),
    taxPercentage: asNumber(electricity.tax_percentage, 0),
    tariffPerKwh: money(tariff),
    unitName,
    provider,
    fulfilmentMethod: String(electricity.fulfilment_method || "token"),
    vendingMode: String(electricity.vending_mode || "facility"),
    issuerName: String(electricity.issuer_name || "Oyi"),
    supportContact: String(electricity.support_contact || ""),
    effectiveFrom,
  };
}

export function buildElectricityQuote(input: {
  amount: number;
  config: ServiceConfigRow | null;
  meterId: string;
  accountRef: string;
  wallet: any;
}) {
  const policy = electricityPolicyFromConfig(input.config);
  const amount = money(input.amount);
  const fee = money(policy.fixedFee + (amount * Math.max(0, policy.percentageFee)) / 100);
  const taxableBase = Math.max(0, amount - fee);
  const tax = money((taxableBase * Math.max(0, policy.taxPercentage)) / 100);
  const netServiceAmount = money(Math.max(0, amount - fee - tax));
  const units = policy.tariffPerKwh > 0 ? Number((netServiceAmount / policy.tariffPerKwh).toFixed(2)) : null;
  const purchaseAvailable =
    Boolean(input.config?.active) &&
    policy.residentPurchasesEnabled &&
    Boolean(input.meterId || input.accountRef) &&
    policy.tariffPerKwh > 0 &&
    amount >= policy.minimumAmount &&
    amount <= policy.maximumAmount &&
    policy.vendingMode === "test";
  const unavailableReason = !input.config?.active
    ? "electricity_not_active"
    : !policy.residentPurchasesEnabled
    ? "resident_purchases_disabled"
    : !input.meterId && !input.accountRef
    ? "meter_not_linked"
    : policy.tariffPerKwh <= 0
    ? "tariff_not_configured"
    : amount < policy.minimumAmount
    ? "amount_below_minimum"
    : amount > policy.maximumAmount
    ? "amount_above_maximum"
    : policy.vendingMode !== "test"
    ? "provider_not_configured"
    : null;
  return {
    quote_id: `elec_${Date.now()}_${randomBytes(3).toString("hex")}`,
    service_key: "utility_token" as ServiceKey,
    service_title: "Electricity",
    amount,
    fee,
    tax,
    total_deduction: amount,
    net_service_amount: netServiceAmount,
    currency: String(input.wallet?.currency || input.config?.currency || "NGN"),
    units,
    unit_name: policy.unitName,
    tariff: {
      rate: policy.tariffPerKwh,
      unit_name: policy.unitName,
      effective_from: policy.effectiveFrom || null,
      issuer_name: policy.issuerName,
      support_contact: policy.supportContact || null,
      provider: policy.provider,
    },
    meter: {
      meter_id: input.meterId || input.accountRef,
      account_ref: input.accountRef || input.meterId,
    },
    wallet: {
      wallet_account_id: String(input.wallet?.id || ""),
      balance_before: money(input.wallet?.balance || 0),
      balance_after: money(asNumber(input.wallet?.balance, 0) - amount),
      sufficient: asNumber(input.wallet?.balance, 0) >= amount,
    },
    fulfilment: {
      method: policy.fulfilmentMethod,
      mode: policy.vendingMode,
      test_mode: policy.vendingMode === "test",
    },
    purchase_available: purchaseAvailable,
    unavailable_reason: unavailableReason,
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

async function findServiceTransactionByIdempotency(input: {
  estateId: string;
  homeId: string;
  userId: string;
  idempotencyKey: string | null;
}) {
  if (!input.idempotencyKey) return null;
  const { data, error } = await supabaseAdmin
    .from("service_transactions")
    .select("*")
    .eq("estate_id", input.estateId)
    .eq("home_id", input.homeId)
    .eq("user_id", input.userId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (error) {
    if (tableMissing(error) || /schema cache|column/i.test(String(error.message || ""))) throw Object.assign(new Error(error.message), { statusCode: 503, cause: error });
    throw Object.assign(new Error(error.message), { statusCode: 500, cause: error });
  }
  return data || null;
}

async function resolveElectricityPurchaseContext(req: Request, user: any) {
  const requestedHomeId = String((req as any).oisContext?.home_id || req.body?.home_id || req.query?.home_id || "").trim() || null;
  const requestedEstateId = String((req as any).oisContext?.estate_id || req.body?.estate_id || req.query?.estate_id || "").trim() || null;
  const home = await resolveHomeForUser(user, { homeId: requestedHomeId, estateId: requestedEstateId });
  if (!home?.id) throw Object.assign(new Error("Your home context could not be loaded."), { statusCode: 400 });
  const estateId = String(home.estate_id || user.estate_id || "").trim();
  const homeId = String(home.id);
  if (!estateId) throw Object.assign(new Error("Your estate context could not be loaded."), { statusCode: 400 });

  const { configs } = await readServiceConfigsForEstate(estateId);
  const config = configs.find((item) => item.service_key === "utility_token") || normalizeServiceConfig(estateId, "utility_token");
  const accounts = await listServiceAccountsForScope({ estateId, homeId });
  const account = accounts.find((item: any) => item.service_key === "utility_token");
  const identifier = String(account?.identifier || account?.meter_number || account?.account_number || home.electricity_meter || "").trim();
  if (!account?.id && !identifier) {
    throw Object.assign(new Error("Electricity is not connected for this home."), { statusCode: 404, code: "electricity_not_connected" });
  }
  const requestedMeter = String(req.body?.meter_id || req.body?.account_ref || req.query?.meter_id || req.query?.account_ref || "").trim();
  if (requestedMeter && identifier && requestedMeter !== identifier) {
    throw Object.assign(new Error("That meter does not belong to the selected home."), { statusCode: 403, code: "meter_scope_denied" });
  }

  const walletScope = await resolveWalletScopeForHome({ userId: String(user.id), estateId, homeId });
  const wallet = await getOrCreateWallet(String(user.id), walletScope);
  return {
    estateId,
    homeId,
    home,
    config,
    account,
    serviceAccountId: String(account?.id || ""),
    meterId: String(account?.meter_number || account?.identifier || identifier || ""),
    accountRef: String(account?.account_number || account?.identifier || identifier || ""),
    walletScope,
    wallet,
  };
}

async function debitHomeWallet(input: {
  walletId: string;
  userId: string;
  amount: number;
  reference: string;
  type: string;
  reason: string;
}) {
  const { data, error } = await supabaseAdmin.rpc("oyi_debit_home_wallet", {
    p_wallet_id: input.walletId,
    p_user_id: input.userId,
    p_amount: input.amount,
    p_reason: input.reason,
    p_currency: "NGN",
    p_reference: input.reference,
    p_type: input.type,
  });
  if (error) throw Object.assign(new Error(error.message), { statusCode: /function|schema cache/i.test(String(error.message || "")) ? 503 : 500, cause: error });
  const result = data as any;
  if (!result?.ok) {
    const code = String(result?.code || "wallet_debit_failed");
    const statusCode = code === "insufficient_funds" ? 400 : code === "frozen" ? 403 : 500;
    throw Object.assign(new Error(code), { statusCode, code });
  }
  return result;
}

function serviceReceiptFromPurchase(input: {
  transactionId: string;
  reference: string;
  quote: ReturnType<typeof buildElectricityQuote>;
  walletAccountId: string;
  walletTransactionId?: string | null;
  homeId: string;
  estateId: string;
  membershipId?: string | null;
  token?: string | null;
  testMode?: boolean;
}) {
  return {
    id: input.transactionId,
    reference: input.reference,
    service_key: "utility_token",
    service_title: "Electricity",
    account_ref: input.quote.meter.account_ref,
    meter_id: input.quote.meter.meter_id,
    amount: input.quote.amount,
    fee: input.quote.fee,
    tax: input.quote.tax,
    total_deduction: input.quote.total_deduction,
    net_service_amount: input.quote.net_service_amount,
    status: "completed",
    created_at: new Date().toISOString(),
    home_id: input.homeId,
    estate_id: input.estateId,
    membership_id: input.membershipId || null,
    wallet_account_id: input.walletAccountId,
    wallet_transaction_id: input.walletTransactionId || null,
    unit_cost: input.quote.tariff.rate,
    unit_name: input.quote.unit_name,
    computed_units: input.quote.units,
    token_code: input.token || null,
    test_mode: Boolean(input.testMode),
    tariff: input.quote.tariff,
  };
}

function serviceStatusFrom(enabled: boolean, linked: boolean, serviceKey: ServiceKey) {
  if (!enabled) return "unavailable";
  if (!linked && ["utility_token", "water_service", "gas_service", "internet_service", "fiber_internet", "generator_recovery", "solar_battery_service"].includes(serviceKey)) return "setup_needed";
  return providerFulfillmentStatus(serviceKey) === "manual_review" && serviceKey !== "service_charge" ? "available" : "active";
}

function statusSemantics(enabled: boolean, linked: boolean, health: ProviderHealth) {
  const providerStatus = !enabled ? "unavailable" : linked ? (health.supported ? "available" : "pending") : "not_required";
  const transactionAvailability = !enabled
    ? "not_supported"
    : !linked
    ? "not_supported"
    : health.supported
    ? "available"
    : "temporarily_unavailable";
  // Honest, explicit reason so Consumer can render a real explanation
  // (Setup required / Provider unavailable / Coming soon) instead of a
  // dead button with no explanation -- never fabricated, always derived
  // from the same signals transaction_availability itself uses.
  const unavailableReason = !enabled
    ? "service_disabled"
    : !linked
    ? "setup_required"
    : !health.supported
    ? "provider_not_integrated"
    : null;
  return {
    provisioning_status: linked ? "provisioned" : "not_provisioned",
    provider_status: providerStatus,
    transaction_availability: transactionAvailability,
    unavailable_reason: unavailableReason,
  };
}

// Typed pricing summary attached to a registry entry -- Part E's "Consumer
// must render the commercial service according to its actual type"
// without exposing a purchase action for services that don't have one yet.
export function pricingSummaryFor(config: ServiceConfigRow | null | undefined) {
  if (!config) return null;
  const plans = config.pricing_plans || [];
  if (!plans.length) return null;
  const primary = primaryPricingPlan(plans);
  if (primary) {
    return {
      pricing_type: primary.pricing_type,
      rate_amount: Number(primary.rate_amount),
      unit_name: primary.unit_name,
      currency: primary.currency,
      billing_frequency: primary.billing_frequency,
      payment_timing: primary.payment_timing,
      provider: primary.provider,
      effective_from: primary.effective_from,
    };
  }
  // subscription: no single "the" rate -- surface the plan list instead.
  return {
    pricing_type: "subscription",
    plans: plans.map((plan) => ({
      plan_name: plan.plan_name,
      rate_amount: Number(plan.rate_amount),
      currency: plan.currency,
      billing_frequency: plan.billing_frequency,
      provider: plan.provider,
    })),
  };
}

function profileFrom(accounts: Map<string, any>, serviceKey: ServiceKey) {
  const metadata = accountValue(accounts, serviceKey, "metadata", {}) || {};
  return {
    tariff_profile: metadata?.tariff_profile || null,
    billing_profile: metadata?.billing_profile || null,
    kct: metadata?.kct || null,
    kctn: metadata?.kctn || null,
    provider_integration_mode: metadata?.provider_integration_mode || null,
  };
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

async function readHomeServiceAccountsSafe(homeId: string, context: Record<string, unknown>) {
  try {
    return { accounts: await readHomeServiceAccounts(homeId), error: null as any };
  } catch (error: any) {
    logger.error("home_service_accounts_read_failed", {
      ...context,
      code: servicePublicError(error, "Infrastructure services are temporarily unavailable.").code,
      error,
    });
    return { accounts: new Map<string, any>(), error };
  }
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

function serviceTitleFor(key: ServiceKey) {
  return SERVICE_CONFIG_DEFAULTS[key]?.title || key.replace(/_/g, " ");
}

function serviceDomainFor(key: ServiceKey) {
  if (key === "utility_token") return "electricity";
  if (key === "water_service") return "water";
  if (key === "gas_service") return "gas";
  if (key === "internet_service" || key === "fiber_internet") return "internet";
  if (key === "generator_recovery") return "generator";
  if (key === "solar_battery_service") return "solar_battery";
  if (key === "service_charge") return "estate_fees";
  return "facility_services";
}

function identifierForAccount(row: any) {
  return String(row?.meter_id || row?.account_ref || "").trim();
}

function transactionTypeForService(serviceKey: ServiceKey): ServiceTransactionType {
  if (serviceKey === "utility_token") return "electricity_purchase";
  if (serviceKey === "water_service") return "water_payment";
  if (serviceKey === "gas_service") return "gas_order";
  if (serviceKey === "internet_service" || serviceKey === "fiber_internet") return "internet_renewal";
  if (serviceKey === "generator_recovery") return "generator_recovery";
  if (serviceKey === "solar_battery_service") return "solar_battery_support";
  if (serviceKey === "service_charge") return "estate_fee";
  return "facility_service";
}

async function insertServiceTransactionRecord(input: {
  estateId?: string | null;
  homeId?: string | null;
  residentId?: string | null;
  membershipId?: string | null;
  walletAccountId?: string | null;
  walletTransactionId?: string | null;
  serviceAccountId?: string | null;
  serviceKey: ServiceKey;
  provider?: string | null;
  meterId?: string | null;
  accountRef?: string | null;
  amount?: number | null;
  fee?: number | null;
  tax?: number | null;
  totalDeduction?: number | null;
  netServiceAmount?: number | null;
  computedUnits?: number | null;
  currency?: string | null;
  status: ServiceTransactionStatus;
  transactionType: ServiceTransactionType;
  settlementStatus?: ServiceSettlementStatus;
  fulfilmentType?: string | null;
  fulfilmentMethod?: string | null;
  vendingMode?: string | null;
  providerReference?: string | null;
  tokenReference?: string | null;
  meterCreditReference?: string | null;
  receiptReference?: string | null;
  completedAt?: string | null;
  failureCode?: string | null;
  safeFailureMessage?: string | null;
  tariffSnapshot?: Record<string, any> | null;
  receipt?: Record<string, any> | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, any> | null;
}) {
  const row = {
    estate_id: input.estateId || null,
    home_id: input.homeId || null,
    membership_id: input.membershipId || null,
    resident_id: input.residentId || null,
    user_id: input.residentId || null,
    wallet_account_id: input.walletAccountId || null,
    wallet_transaction_id: input.walletTransactionId || null,
    service_account_id: input.serviceAccountId || null,
    service_type: serviceDomainFor(input.serviceKey),
    service_key: input.serviceKey,
    provider: input.provider || null,
    meter_id: input.meterId || null,
    account_ref: input.accountRef || null,
    amount: Number(input.amount || 0),
    fee: Number(input.fee || 0),
    tax: Number(input.tax || 0),
    total_deduction: Number(input.totalDeduction || input.amount || 0),
    net_service_amount: Number(input.netServiceAmount || input.amount || 0),
    computed_units: input.computedUnits == null ? null : Number(input.computedUnits),
    currency: String(input.currency || "NGN"),
    status: input.status,
    transaction_type: input.transactionType,
    fulfilment_type: input.fulfilmentType || "pending_provider",
    settlement_status: input.settlementStatus || "none",
    fulfilment_method: input.fulfilmentMethod || null,
    vending_mode: input.vendingMode || null,
    provider_reference: input.providerReference || null,
    token_reference: input.tokenReference || null,
    meter_credit_reference: input.meterCreditReference || null,
    receipt_reference: input.receiptReference || null,
    completed_at: input.completedAt || null,
    failure_code: input.failureCode || null,
    safe_failure_message: input.safeFailureMessage || null,
    tariff_snapshot: input.tariffSnapshot || {},
    receipt: input.receipt || {},
    idempotency_key: input.idempotencyKey || null,
    metadata: input.metadata || {},
  };

  if (input.idempotencyKey && input.estateId && input.homeId && input.residentId) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("service_transactions")
      .select("*")
      .eq("estate_id", input.estateId)
      .eq("home_id", input.homeId)
      .eq("user_id", input.residentId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existingError && !tableMissing(existingError) && !/column|schema cache/i.test(String(existingError.message || ""))) {
      throw Object.assign(new Error(existingError.message), { code: "service_transaction_lookup_failed", statusCode: 500, cause: existingError });
    }
    if (existing?.id) return existing;
  }

  const { data, error } = await supabaseAdmin
    .from("service_transactions")
    .insert([row])
    .select("*")
    .single();

  if (error) {
    const wrapped = Object.assign(new Error(error.message), {
      code: tableMissing(error) ? "service_schema_unavailable" : "service_transaction_insert_failed",
      statusCode: tableMissing(error) || /column|constraint|schema cache/i.test(String(error.message || "")) ? 503 : 500,
      cause: error,
    });
    throw wrapped;
  }
  return data;
}

async function readLatestServiceTransactionsByHomeIds(homeIds: string[]) {
  if (!homeIds.length) return new Map<string, any>();
  const { data, error } = await supabaseAdmin
    .from("service_transactions")
    .select("id, home_id, service_key, status, transaction_type, amount, currency, created_at, provider_reference, metadata")
    .in("home_id", homeIds)
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) {
    if (tableMissing(error)) return new Map<string, any>();
    throw new Error(error.message);
  }
  const latest = new Map<string, any>();
  for (const row of data || []) {
    const key = `${row.home_id}:${row.service_key}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return latest;
}

async function listServiceAccountsForScope(input: {
  estateId: string;
  homeId?: string | null;
  residentId?: string | null;
}) {
  const fullSelect = "id, estate_id, home_id, service_key, provider, account_ref, meter_id, plan, balance, outstanding, status, due_date, expires_at, linked, metadata, created_at, updated_at";
  const legacySelect = "id, estate_id, home_id, service_key, provider, account_ref, meter_id, plan, status, linked, metadata, created_at, updated_at";
  const buildQuery = (select: string) => {
    const query = supabaseAdmin
    .from("home_service_accounts")
      .select(select)
    .eq("estate_id", input.estateId)
    .order("updated_at", { ascending: false });

    if (input.homeId) query.eq("home_id", input.homeId);
    return query;
  };
  let query = buildQuery(fullSelect);
  if (input.residentId) {
    const { data: assignments, error: assignmentError } = await supabaseAdmin
      .from("home_service_assignments")
      .select("home_id")
      .eq("estate_id", input.estateId)
      .eq("user_id", input.residentId);
    if (assignmentError) {
      if (tableMissing(assignmentError)) return [];
      throw new Error(assignmentError.message);
    }
    const homeIds = [...new Set((assignments || []).map((row: any) => String(row.home_id || "")).filter(Boolean))];
    if (!homeIds.length) return [];
    query.in("home_id", homeIds);
  }

  let { data: accounts, error } = await query;
  if (error && ["balance", "outstanding", "due_date", "expires_at"].some((column) => missingColumn(error, column))) {
    logger.warn("home_service_accounts_optional_columns_missing", {
      estate_id: input.estateId,
      home_id: input.homeId || null,
      error,
    });
    query = buildQuery(legacySelect);
    if (input.residentId) {
      const { data: assignments, error: assignmentError } = await supabaseAdmin
        .from("home_service_assignments")
        .select("home_id")
        .eq("estate_id", input.estateId)
        .eq("user_id", input.residentId);
      if (assignmentError) {
        if (tableMissing(assignmentError)) return [];
        throw new Error(assignmentError.message);
      }
      const homeIds = [...new Set((assignments || []).map((row: any) => String(row.home_id || "")).filter(Boolean))];
      if (!homeIds.length) return [];
      query.in("home_id", homeIds);
    }
    const legacy = await query;
    accounts = legacy.data as any;
    error = legacy.error as any;
  }
  if (error) {
    if (tableMissing(error)) return [];
    throw new Error(error.message);
  }
  if (!accounts?.length) return [];

  const homeIds = [...new Set(accounts.map((row: any) => String(row.home_id || "")).filter(Boolean))];
  const [{ data: homes }, { data: assignments }, latestTx] = await Promise.all([
    supabaseAdmin.from("homes").select("id, name, block, unit, resident_id").in("id", homeIds),
    supabaseAdmin.from("home_service_assignments").select("home_id, user_id, service_key, enabled, metadata, updated_at").in("home_id", homeIds),
    readLatestServiceTransactionsByHomeIds(homeIds),
  ]);

  const homeMap = new Map((homes || []).map((row: any) => [String(row.id), row]));
  const assignmentMap = new Map<string, any>();
  const residentIds = new Set<string>();
  for (const assignment of assignments || []) {
    const key = `${assignment.home_id}:${assignment.service_key}`;
    assignmentMap.set(key, assignment);
    const id = String(assignment.user_id || "");
    if (id) residentIds.add(id);
  }
  const homeResidentIds = [...new Set((homes || []).map((row: any) => String(row.resident_id || "")).filter(Boolean))];
  homeResidentIds.forEach((id: string) => residentIds.add(id));
  let residentRows: any[] = [];
  if (residentIds.size) {
    const { data } = await supabaseAdmin.from("users").select("id, full_name, email").in("id", [...residentIds]);
    residentRows = data || [];
  }
  let walletRows: any[] = [];
  if (residentIds.size) {
    const { data } = await supabaseAdmin.from("wallets").select("id, user_id, home_id").in("user_id", [...residentIds]);
    walletRows = data || [];
  }
  const userMap = new Map(residentRows.map((row: any) => [String(row.id), row]));
  const walletMap = new Map(walletRows.map((row: any) => [`${row.user_id}:${row.home_id || ""}`, row]));

  return (accounts || []).map((row: any) => {
    const home = homeMap.get(String(row.home_id || ""));
    const assignment = assignmentMap.get(`${row.home_id}:${row.service_key}`);
    const residentId = String(assignment?.user_id || home?.resident_id || "").trim() || null;
    const resident = residentId ? userMap.get(residentId) : null;
    const wallet = residentId ? walletMap.get(`${residentId}:${row.home_id || ""}`) : null;
    const metadata = row.metadata || {};
    const providerHealth = getInfrastructureServiceProvider(row.service_key as ProviderServiceKey).health({
      provider: row.provider,
      linked: row.linked,
      status: row.status,
      metadata,
    });
    const latest = latestTx.get(`${row.home_id}:${row.service_key}`) || null;
    return {
      id: String(row.id),
      estate_id: String(row.estate_id),
      home_id: String(row.home_id),
      service_key: String(row.service_key),
      service_title: serviceTitleFor(row.service_key as ServiceKey),
      service_group: serviceDomainFor(row.service_key as ServiceKey),
      provider_type: providerTypeForService(row.service_key as ServiceKey),
      provider: row.provider || metadata.provider || null,
      identifier: identifierForAccount(row),
      meter_number: row.meter_id || null,
      account_number: row.account_ref || null,
      tariff_profile: metadata.tariff_profile || null,
      billing_profile: metadata.billing_profile || null,
      kct: metadata.kct || null,
      kctn: metadata.kctn || null,
      status: row.status || "pending",
      linked: Boolean(row.linked),
      plan: row.plan || null,
      balance: row.balance ?? null,
      outstanding: row.outstanding ?? null,
      wallet_id: wallet?.id || null,
      wallet_linked: Boolean(wallet?.id),
      resident_id: residentId,
      resident_name: resident?.full_name || null,
      resident_email: resident?.email || null,
      home_label: home ? [home.name, [home.block, home.unit].filter(Boolean).join(" / ")].filter(Boolean).join(" • ") : "Home pending",
      vending_readiness: providerHealth.readiness,
      provider_health: providerHealth.status,
      provider_supported: providerHealth.supported,
      provider_health_reason: providerHealth.reason,
      last_activity_at: latest?.created_at || row.updated_at || row.created_at || null,
      last_transaction_status: latest?.status || null,
      last_transaction_type: latest?.transaction_type || null,
      latest_transaction: latest,
      metadata,
    };
  });
}

async function buildHomeServiceRegistry(user: any, requested?: { homeId?: string | null; estateId?: string | null; includeDebug?: boolean }) {
  const home = await resolveHomeForUser(user, requested);
  if (!home?.id) throw Object.assign(new Error("No home linked to this account"), { statusCode: 400 });

  const estateId = String(home.estate_id || user.estate_id || "").trim();
  if (!estateId) throw Object.assign(new Error("No estate linked to this home"), { statusCode: 400 });

  const diagnostics: Record<string, any> = {};
  let configsResult: Awaited<ReturnType<typeof readServiceConfigsForEstate>>;
  try {
    configsResult = await readServiceConfigsForEstate(estateId);
  } catch (error: any) {
    diagnostics.configs = servicePublicError(error, "Service configuration is temporarily unavailable.").code;
    logger.error("home_service_registry_config_failed", { estate_id: estateId, home_id: String(home.id), actor_id: String(user.id), error });
    configsResult = {
      configs: (Object.keys(SERVICE_CONFIG_DEFAULTS) as ServiceKey[]).map((serviceKey) => normalizeServiceConfig(estateId, serviceKey)),
      usingFallback: true,
    };
  }

  let wallet: any = null;
  try {
    const walletScope = await resolveWalletScopeForHome({
      userId: String(user.id),
      estateId,
      homeId: String(home.id),
    });
    wallet = await getOrCreateWallet(user.id, walletScope);
  } catch (error: any) {
    diagnostics.wallet = servicePublicError(error, "Wallet details are temporarily unavailable.").code;
    logger.error("home_service_registry_wallet_failed", { estate_id: estateId, home_id: String(home.id), actor_id: String(user.id), error });
  }

  const accountRead = await readHomeServiceAccountsSafe(String(home.id), {
    estate_id: estateId,
    home_id: String(home.id),
    actor_id: String(user.id),
  });
  if (accountRead.error) diagnostics.accounts = servicePublicError(accountRead.error, "Service accounts are temporarily unavailable.").code;

  let facilityCount = 0;
  try {
    facilityCount = await readEstateServiceCount(estateId);
  } catch (error: any) {
    diagnostics.facility_count = servicePublicError(error, "Facility service details are temporarily unavailable.").code;
  }

  const { configs, usingFallback } = configsResult;
  const accounts = accountRead.accounts;
  const configByKey = new Map(configs.map((cfg) => [cfg.service_key, cfg]));
  let paymentsByKey = new Map<string, any>();
  if (wallet?.id) {
    try {
      paymentsByKey = await findLastServicePayments(String(wallet.id));
    } catch (error: any) {
      diagnostics.payments = servicePublicError(error, "Service payment history is temporarily unavailable.").code;
      logger.error("home_service_registry_payments_failed", { estate_id: estateId, home_id: String(home.id), actor_id: String(user.id), error });
    }
  }

  const configEnabled = (key: ServiceKey) => Boolean(configByKey.get(key)?.active ?? true);
  const lastPaid = (key: ServiceKey) => paymentsByKey.get(key)?.created_at || null;
  const linked = (key: ServiceKey, fallback: any) => Boolean(fallback || accountValue(accounts, key, "linked", fallback));
  const status = (key: ServiceKey, isLinked: boolean) => String(accountValue(accounts, key, "status", serviceStatusFrom(configEnabled(key), isLinked, key)) || "available");
  const providerHealthFor = (key: ServiceKey, isLinked: boolean): ProviderHealth =>
    getInfrastructureServiceProvider(key).health({
      provider: accountValue(accounts, key, "provider", configByKey.get(key)?.metadata?.provider || null),
      linked: isLinked,
      status: status(key, isLinked),
      metadata: accountValue(accounts, key, "metadata", {}) || {},
    });

  const electricityLinked = linked("utility_token", Boolean(home.electricity_meter));
  const waterLinked = linked("water_service", Boolean(home.water_meter));
  const gasLinked = linked("gas_service", Boolean(accountValue(accounts, "gas_service", "account_ref", null) || accountValue(accounts, "gas_service", "meter_id", null)));
  const internetLinked = linked("internet_service", Boolean(home.internet_id));
  const generatorLinked = linked("generator_recovery", Boolean(accountValue(accounts, "generator_recovery", "account_ref", null)));
  const solarLinked = linked("solar_battery_service", Boolean(accountValue(accounts, "solar_battery_service", "account_ref", null)));
  const serviceChargeEnabled = configEnabled("service_charge");
  const facilityEnabled = configEnabled("other_facility_fees");
  const electricityHealth = providerHealthFor("utility_token", electricityLinked);
  const waterHealth = providerHealthFor("water_service", waterLinked);
  const gasHealth = providerHealthFor("gas_service", gasLinked);
  const internetHealth = providerHealthFor("internet_service", internetLinked);
  const generatorHealth = providerHealthFor("generator_recovery", generatorLinked);
  const solarHealth = providerHealthFor("solar_battery_service", solarLinked);
  const electricityPolicy = electricityPolicyFromConfig(configByKey.get("utility_token") || null);
  const electricityTransactionAvailable =
    configEnabled("utility_token") &&
    electricityLinked &&
    electricityPolicy.vendingMode === "test" &&
    electricityPolicy.residentPurchasesEnabled &&
    electricityPolicy.tariffPerKwh > 0;
  const electricitySemantics = {
    ...statusSemantics(configEnabled("utility_token"), electricityLinked, electricityHealth),
    provider_status: electricityLinked ? (electricityPolicy.vendingMode === "test" ? "available" : "pending") : "not_required",
    transaction_availability: electricityTransactionAvailable ? "available" : "temporarily_unavailable",
    unavailable_reason: electricityTransactionAvailable
      ? null
      : !configEnabled("utility_token")
      ? "service_disabled"
      : !electricityLinked
      ? "setup_required"
      : electricityPolicy.tariffPerKwh <= 0
      ? "tariff_not_configured"
      : !electricityPolicy.residentPurchasesEnabled
      ? "resident_purchases_disabled"
      : "provider_not_configured",
  };
  const serviceChargeConfig = configByKey.get("service_charge") || null;
  const serviceChargePricing = pricingSummaryFor(serviceChargeConfig);
  const serviceChargeRateConfigured = Boolean(serviceChargePricing && "rate_amount" in serviceChargePricing && Number((serviceChargePricing as any).rate_amount) > 0);
  const estateFeesTransactionAvailable = serviceChargeEnabled && serviceChargeRateConfigured;

  const response: any = {
    ok: true,
    estate_id: estateId,
    home_id: String(home.id),
    using_fallback: usingFallback,
    wallet: {
      balance: Number(wallet?.balance || 0),
      currency: String(wallet?.currency || "NGN"),
      available: Boolean(wallet?.id),
    },
	    electricity: {
      enabled: configEnabled("utility_token"),
      meter_id: String(accountValue(accounts, "utility_token", "meter_id", home.electricity_meter || "") || ""),
      provider: accountValue(accounts, "utility_token", "provider", configByKey.get("utility_token")?.metadata?.provider || null),
      linked: electricityLinked,
      status: status("utility_token", electricityLinked),
      balance: accountValue(accounts, "utility_token", "balance", null),
      last_payment_at: lastPaid("utility_token"),
      vending_readiness: electricityHealth.readiness,
	      provider_health: electricityHealth.status,
	      ...electricitySemantics,
	      ...profileFrom(accounts, "utility_token"),
	      pricing: pricingSummaryFor(configByKey.get("utility_token")),
	    },
    water: {
      enabled: configEnabled("water_service"),
      meter_id: String(accountValue(accounts, "water_service", "meter_id", home.water_meter || "") || ""),
      provider: accountValue(accounts, "water_service", "provider", configByKey.get("water_service")?.metadata?.provider || null),
      linked: waterLinked,
      status: status("water_service", waterLinked),
      balance: accountValue(accounts, "water_service", "balance", null),
      last_payment_at: lastPaid("water_service"),
      vending_readiness: waterHealth.readiness,
	      provider_health: waterHealth.status,
	      ...statusSemantics(configEnabled("water_service"), waterLinked, waterHealth),
	      ...profileFrom(accounts, "water_service"),
	      pricing: pricingSummaryFor(configByKey.get("water_service")),
	    },
    gas: {
      enabled: configEnabled("gas_service"),
      meter_id: String(accountValue(accounts, "gas_service", "meter_id", "") || ""),
      account_id: String(accountValue(accounts, "gas_service", "account_ref", "") || ""),
      provider: accountValue(accounts, "gas_service", "provider", configByKey.get("gas_service")?.metadata?.provider || null),
      linked: gasLinked,
      status: status("gas_service", gasLinked),
      balance: accountValue(accounts, "gas_service", "balance", null),
      last_payment_at: lastPaid("gas_service"),
      vending_readiness: gasHealth.readiness,
	      provider_health: gasHealth.status,
	      ...statusSemantics(configEnabled("gas_service"), gasLinked, gasHealth),
	      ...profileFrom(accounts, "gas_service"),
	      pricing: pricingSummaryFor(configByKey.get("gas_service")),
	    },
    internet: {
      enabled: configEnabled("internet_service") || configEnabled("fiber_internet"),
      provider: accountValue(accounts, "internet_service", "provider", null),
      plan: accountValue(accounts, "internet_service", "plan", null),
      account_id: String(accountValue(accounts, "internet_service", "account_ref", home.internet_id || "") || ""),
      linked: internetLinked,
      status: status("internet_service", internetLinked),
      expires_at: accountValue(accounts, "internet_service", "expires_at", null),
      vending_readiness: internetHealth.readiness,
	      provider_health: internetHealth.status,
	      ...statusSemantics(configEnabled("internet_service") || configEnabled("fiber_internet"), internetLinked, internetHealth),
	      ...profileFrom(accounts, "internet_service"),
	      pricing: pricingSummaryFor(configByKey.get("internet_service")) || pricingSummaryFor(configByKey.get("fiber_internet")),
	    },
    generator_recovery: {
      enabled: configEnabled("generator_recovery"),
      provider: accountValue(accounts, "generator_recovery", "provider", configByKey.get("generator_recovery")?.metadata?.provider || null),
      account_id: String(accountValue(accounts, "generator_recovery", "account_ref", "") || ""),
      linked: generatorLinked,
      status: status("generator_recovery", generatorLinked),
      last_payment_at: lastPaid("generator_recovery"),
      vending_readiness: generatorHealth.readiness,
	      provider_health: generatorHealth.status,
	      ...statusSemantics(configEnabled("generator_recovery"), generatorLinked, generatorHealth),
	      ...profileFrom(accounts, "generator_recovery"),
	    },
    solar_battery: {
      enabled: configEnabled("solar_battery_service"),
      provider: accountValue(accounts, "solar_battery_service", "provider", configByKey.get("solar_battery_service")?.metadata?.provider || null),
      plan: accountValue(accounts, "solar_battery_service", "plan", null),
      account_id: String(accountValue(accounts, "solar_battery_service", "account_ref", "") || ""),
      linked: solarLinked,
      status: status("solar_battery_service", solarLinked),
      last_payment_at: lastPaid("solar_battery_service"),
      vending_readiness: solarHealth.readiness,
	      provider_health: solarHealth.status,
	      ...statusSemantics(configEnabled("solar_battery_service"), solarLinked, solarHealth),
	      ...profileFrom(accounts, "solar_battery_service"),
	    },
    estate_fees: {
      enabled: serviceChargeEnabled,
      outstanding: accountValue(accounts, "service_charge", "outstanding", null),
      status: String(accountValue(accounts, "service_charge", "status", serviceChargeEnabled ? "active" : "unavailable") || "active"),
      due_date: accountValue(accounts, "service_charge", "due_date", null),
      last_payment_at: lastPaid("service_charge"),
      account_id: String(accountValue(accounts, "service_charge", "account_ref", null) || String(home.id)),
      provisioning_status: serviceChargeEnabled ? "provisioned" : "not_provisioned",
      transaction_availability: estateFeesTransactionAvailable ? "available" : "not_supported",
      unavailable_reason: estateFeesTransactionAvailable
        ? null
        : !serviceChargeEnabled
        ? "service_disabled"
        : "setup_required",
      pricing: serviceChargePricing,
    },
    facility_services: {
      enabled: facilityEnabled,
      available_count: facilityCount,
      status: facilityEnabled ? "available" : "unavailable",
      last_payment_at: lastPaid("other_facility_fees"),
      pricing: pricingSummaryFor(configByKey.get("other_facility_fees")),
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
      service_account_count: accounts.size,
      diagnostics,
    };
  }

  logger.info("consumer_services_scope_resolution", {
    user_id: String(user.id),
    requested_estate_id: requested?.estateId || null,
    requested_home_id: requested?.homeId || null,
    resolved_estate_id: estateId,
    resolved_home_id: String(home.id),
    membership_found: true,
    service_account_count: accounts.size,
    meter_count: ["utility_token", "water_service", "internet_service", "gas_service"].filter((key) =>
      Boolean(accountValue(accounts, key as ServiceKey, "meter_id", null) || accountValue(accounts, key as ServiceKey, "account_ref", null))
    ).length,
    degraded_sources: Object.keys(diagnostics),
  });

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
    return serviceErrorResponse(res, e, "Infrastructure services are temporarily unavailable.", {
      endpoint: "GET /services/home-registry",
      actor_id: user.id,
      requested_estate_id: String(req.query.estate_id || "").trim() || null,
      requested_home_id: String(req.query.home_id || "").trim() || null,
    });
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

const PRICING_TYPES = new Set(["usage_based", "fixed", "recurring", "subscription"]);
const BILLING_FREQUENCIES = new Set(["once", "monthly", "quarterly", "yearly"]);
const PAYMENT_TIMINGS = new Set(["prepaid", "postpaid"]);

type PricingPlanInput = {
  plan_name?: string | null;
  unit_name?: string | null;
  currency?: string | null;
  rate_amount: number | string;
  billing_frequency?: string | null;
  payment_timing?: string | null;
  provider?: string | null;
  effective_from?: string | null;
};

function normalizePricingPlanInput(raw: any): { ok: true; value: PricingPlanInput } | { ok: false; error: string } {
  const rate = Number(raw?.rate_amount);
  if (!Number.isFinite(rate) || rate < 0) return { ok: false, error: "pricing.rate_amount must be zero or greater" };
  const billingFrequency = raw?.billing_frequency ? String(raw.billing_frequency).trim() : null;
  if (billingFrequency && !BILLING_FREQUENCIES.has(billingFrequency)) {
    return { ok: false, error: `pricing.billing_frequency must be one of ${[...BILLING_FREQUENCIES].join(", ")}` };
  }
  const paymentTiming = raw?.payment_timing ? String(raw.payment_timing).trim() : null;
  if (paymentTiming && !PAYMENT_TIMINGS.has(paymentTiming)) {
    return { ok: false, error: `pricing.payment_timing must be one of ${[...PAYMENT_TIMINGS].join(", ")}` };
  }
  return {
    ok: true,
    value: {
      plan_name: raw?.plan_name ? String(raw.plan_name).trim() : null,
      unit_name: raw?.unit_name ? String(raw.unit_name).trim() : null,
      currency: raw?.currency ? String(raw.currency).trim() : "NGN",
      rate_amount: money(rate),
      billing_frequency: billingFrequency,
      payment_timing: paymentTiming,
      provider: raw?.provider ? String(raw.provider).trim() : null,
      effective_from: raw?.effective_from || null,
    },
  };
}

// Facility <-> Consumer Utilities acceptance: applies a typed pricing save
// as part of the SAME "Save policy" action the Facility UI already has --
// one API call, not a second form/endpoint. Non-subscription pricing
// (usage_based/fixed/recurring) supersedes the previous active rate,
// preserving it as history (active=false, effective_to stamped) rather
// than mutating it in place, so "Effective Period" is a real, queryable
// concept. Subscription is a full-replace of the plan list, since Internet
// can carry multiple simultaneous active plans and a diff-based partial
// update would be needless complexity for a Facility admin clicking Save.
async function applyServicePricingUpdate(
  estateId: string,
  serviceKey: ServiceKey,
  pricingInput: any
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pricingType = String(pricingInput?.pricing_type || "").trim();
  if (!PRICING_TYPES.has(pricingType)) {
    return { ok: false, error: `pricing.pricing_type must be one of ${[...PRICING_TYPES].join(", ")}` };
  }

  if (pricingType === "subscription") {
    const rawPlans = Array.isArray(pricingInput?.plans) ? pricingInput.plans : [];
    if (!rawPlans.length) return { ok: false, error: "pricing.plans must include at least one plan for a subscription service" };
    const normalizedPlans: PricingPlanInput[] = [];
    for (const raw of rawPlans) {
      const normalized = normalizePricingPlanInput(raw);
      if (!normalized.ok) return normalized;
      normalizedPlans.push(normalized.value);
    }

    const { error: deactivateError } = await supabaseAdmin
      .from("service_pricing_plans")
      .update({ active: false, effective_to: new Date().toISOString() })
      .eq("estate_id", estateId)
      .eq("service_key", serviceKey)
      .eq("pricing_type", "subscription")
      .eq("active", true);
    if (deactivateError) return { ok: false, error: deactivateError.message };

    const { error: insertError } = await supabaseAdmin.from("service_pricing_plans").insert(
      normalizedPlans.map((plan) => ({
        estate_id: estateId,
        service_key: serviceKey,
        pricing_type: "subscription",
        plan_name: plan.plan_name,
        unit_name: plan.unit_name,
        currency: plan.currency,
        rate_amount: plan.rate_amount,
        billing_frequency: plan.billing_frequency,
        payment_timing: plan.payment_timing,
        provider: plan.provider,
        effective_from: plan.effective_from || new Date().toISOString(),
        active: true,
      }))
    );
    if (insertError) return { ok: false, error: insertError.message };
    return { ok: true };
  }

  const normalized = normalizePricingPlanInput(pricingInput);
  if (!normalized.ok) return normalized;
  const plan = normalized.value;

  const { error: supersedeError } = await supabaseAdmin
    .from("service_pricing_plans")
    .update({ active: false, effective_to: new Date().toISOString() })
    .eq("estate_id", estateId)
    .eq("service_key", serviceKey)
    .neq("pricing_type", "subscription")
    .eq("active", true);
  if (supersedeError) return { ok: false, error: supersedeError.message };

  const { error: insertError } = await supabaseAdmin.from("service_pricing_plans").insert({
    estate_id: estateId,
    service_key: serviceKey,
    pricing_type: pricingType,
    plan_name: plan.plan_name,
    unit_name: plan.unit_name,
    currency: plan.currency,
    rate_amount: plan.rate_amount,
    billing_frequency: plan.billing_frequency,
    payment_timing: plan.payment_timing,
    provider: plan.provider,
    effective_from: plan.effective_from || new Date().toISOString(),
    active: true,
  });
  if (insertError) return { ok: false, error: insertError.message };
  return { ok: true };
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
  const domainFallback = SERVICE_DOMAIN_DEFAULTS[serviceKey];
  const incomingMetadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
  const incomingPolicy = incomingMetadata?.policy && typeof incomingMetadata.policy === "object" ? incomingMetadata.policy : {};
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
    metadata: {
      ...incomingMetadata,
      policy: {
        service_key: serviceKey,
        domain: String(incomingPolicy?.domain || domainFallback.domain),
        child_label: String(incomingPolicy?.child_label || domainFallback.childLabel),
        policy_label: String(incomingPolicy?.policy_label || domainFallback.policyLabel),
        provider_lane: String(incomingPolicy?.provider_lane || domainFallback.providerLane),
        version: String(incomingPolicy?.version || "v1"),
        effective_from: incomingPolicy?.effective_from || new Date().toISOString(),
        versioning_ready: incomingPolicy?.versioning_ready === false ? false : true,
      },
    },
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
      "estate_id, service_key, title, description, suggested_amount, currency, active, account_label, account_hint, payment_mode, unit_cost, unit_name, billing_mode, metadata, created_at, updated_at"
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

  if (req.body?.pricing) {
    const pricingResult = await applyServicePricingUpdate(estateId, serviceKey, req.body.pricing);
    if (!pricingResult.ok) return res.status(400).json({ error: pricingResult.error });
  }

  const pricingByKey = await readActivePricingPlansForEstate(estateId);
  const config = normalizeServiceConfig(estateId, serviceKey, data as any, pricingByKey.get(serviceKey));
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
  const idempotencyKey = String(req.body?.idempotency_key || req.headers["x-idempotency-key"] || "").trim() || null;

  if (!VALID_SERVICE_KEYS.has(serviceKey)) {
    return res.status(400).json({ error: "Invalid service_key" });
  }
  if (!Number.isFinite(amount) || amount < 100) {
    return res.status(400).json({ error: "Amount must be at least 100" });
  }

  const home = await resolveHomeForUser(user, {
    estateId: String((req as any).oisContext?.estate_id || req.body?.estate_id || "").trim() || null,
    homeId: String((req as any).oisContext?.home_id || req.body?.home_id || "").trim() || null,
  });
  if (!home?.id) return res.status(400).json({ error: "No home linked to this account" });

  const accounts = await readHomeServiceAccounts(String(home.id)).catch(() => new Map<string, any>());
  const expectedRef =
    String(accountValue(accounts, serviceKey, "account_ref", "") || "") ||
    String(accountValue(accounts, serviceKey, "meter_id", "") || "") ||
    expectedAccountRef(serviceKey, home);
  if (!expectedRef) {
    return res.status(400).json({ error: "Service account is not linked for this home" });
  }
  if (accountRef !== expectedRef) {
    return res.status(400).json({ error: "Account reference mismatch for this service" });
  }

  const estateId = String(home.estate_id || user.estate_id || "").trim();
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
  let walletScope: { estateId?: string | null; homeId?: string | null; membershipId?: string | null };
  try {
    walletScope = await resolveWalletScopeForHome({
      userId: String(user.id),
      estateId,
      homeId: String(home.id),
    });
    wallet = await getOrCreateWallet(user.id, walletScope);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load wallet" });
  }

  // Idempotency: a retried/duplicate submission with the same key must
  // never debit the wallet twice -- mirrors confirmElectricityPurchase's
  // exact pattern (same service_transactions unique index, same
  // pre-charge lookup).
  const existing = await findServiceTransactionByIdempotency({
    estateId,
    homeId: String(home.id),
    userId: String(user.id),
    idempotencyKey,
  });
  if (existing?.id) {
    return res.json({
      ok: true,
      balance: existing.metadata?.wallet_debit?.balance ?? null,
      receipt: existing.receipt || existing.metadata?.receipt || null,
      idempotent: true,
    });
  }

  if (Boolean(wallet?.is_frozen)) return res.status(403).json({ error: "Wallet is frozen" });
  if (Number(wallet.balance || 0) < amount) return res.status(400).json({ error: "Insufficient funds" });

  const reference = `svc_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();
  const fulfillmentStatus = providerFulfillmentStatus(serviceKey);
  const receiptDetails = buildReceiptDetails(activeConfig, serviceKey, amount, {
    bundle_name: bundleName,
    period_label: periodLabel,
  });

  // Record the attempt before touching money, exactly like electricity --
  // if the debit below fails partway, there is still a durable "pending"
  // row to reconcile against instead of a charge with no record.
  let transaction = await insertServiceTransactionRecord({
    estateId,
    homeId: String(home.id),
    residentId: String(user.id),
    membershipId: walletScope.membershipId || null,
    walletAccountId: wallet.id,
    serviceKey,
    provider: activeConfig?.metadata?.provider || null,
    accountRef,
    amount,
    totalDeduction: amount,
    netServiceAmount: amount,
    currency: String(wallet.currency || "NGN"),
    status: "pending",
    transactionType: transactionTypeForService(serviceKey),
    settlementStatus: fulfillmentStatus === "completed" ? "pending" : "unsupported",
    fulfilmentType: fulfillmentStatus,
    idempotencyKey,
    metadata: {
      source: "services_api",
      service_key: serviceKey,
      bundle_name: bundleName,
      period_label: periodLabel,
      receipt: receiptDetails,
      wallet_charged: false,
    },
  });

  // Atomic, race-safe debit -- a single UPDATE ... WHERE balance >= amount,
  // never the read-then-write the old non-atomic path used here.
  let debit: any;
  try {
    debit = await debitHomeWallet({
      walletId: String(wallet.id),
      userId: String(user.id),
      amount,
      reference,
      type: SERVICE_TX_TYPE[serviceKey],
      reason: `service_payment:${serviceKey}`,
    });
  } catch (debitError: any) {
    await supabaseAdmin
      .from("service_transactions")
      .update({
        status: "failed",
        settlement_status: "failed",
        failure_code: debitError?.code || "wallet_debit_failed",
        safe_failure_message: "This payment could not be completed. Your wallet has not been charged.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", transaction.id);
    const statusCode = debitError?.statusCode || 500;
    return res.status(statusCode).json({ error: debitError?.message || "Failed to debit wallet" });
  }

  const receipt = {
    id: String(transaction.id),
    reference,
    service_key: serviceKey,
    service_title: receiptDetails.title,
    account_ref: accountRef,
    amount,
    status: fulfillmentStatus,
    created_at: now,
    home_id: String(home.id),
    estate_id: estateId || null,
    membership_id: walletScope.membershipId || null,
    wallet_account_id: wallet.id,
    unit_cost: receiptDetails.unit_cost,
    unit_name: receiptDetails.unit_name,
    computed_units: receiptDetails.computed_units,
    billing_mode: receiptDetails.billing_mode,
    bundle_name: receiptDetails.bundle_name,
    period_label: receiptDetails.period_label,
  };

  const { data: completed, error: updateError } = await supabaseAdmin
    .from("service_transactions")
    .update({
      status: fulfillmentStatus,
      settlement_status: fulfillmentStatus === "completed" ? "settled" : "unsupported",
      wallet_transaction_id: debit.transaction_id || null,
      provider_reference: reference,
      receipt_reference: reference,
      completed_at: fulfillmentStatus === "completed" ? now : null,
      receipt,
      metadata: {
        ...(transaction.metadata || {}),
        receipt,
        wallet_charged: true,
        wallet_debit: debit,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", transaction.id)
    .select("*")
    .single();
  if (!updateError && completed) transaction = completed;

  // Legacy transaction table, still read by some older Facility views --
  // best-effort, matches the prior behavior of this endpoint.
  try {
    await supabaseAdmin.from("service_provider_transactions").insert([
      {
        service_key: serviceKey,
        estate_id: estateId || null,
        home_id: String(home.id),
        membership_id: walletScope.membershipId || null,
        wallet_account_id: wallet.id,
        user_id: String(user.id),
        wallet_transaction_id: debit.transaction_id || null,
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
    metadata: {
      estate_id: estateId || null,
      home_id: String(home.id),
      membership_id: walletScope.membershipId || null,
      transaction_id: transaction.id,
    },
    timestamp: now,
  });

  try {
    await NotificationService.sendToUser(String(user.id), {
      title: `${receiptDetails.title} payment recorded`,
      message: fulfillmentStatus === "completed"
        ? `Receipt ${reference} for NGN ${amount.toLocaleString("en-NG")} is ready.`
        : `Payment ${reference} is recorded and awaiting provider confirmation.`,
      type: "wallet",
      payload: {
        estate_id: estateId || null,
        kind: "service.receipt",
        receipt,
      },
      entityId: String(transaction.id),
    });
  } catch (notifyErr) {
    console.warn("service payment notification failed:", notifyErr);
  }

  if (estateId) {
    await notifyFacilityOpsOfPayment(estateId, receipt, user, home);
  }

  await notifyLowWalletBalance(user, Number(debit.balance || 0));

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
    payload: { receipt, balance: debit.balance, transaction_id: transaction.id },
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

  void publishSourceIntelligenceEvent({
    source: "consumer",
    surface: "consumer",
    event_type: "wallet.service_payment.updated",
    category: "wallet",
    estate_id: estateId || null,
    home_id: String(home.id),
    actor_id: String(user.id),
    entity_type: "wallet_transaction",
    entity_id: String(transaction.id),
    entity_label: receiptDetails.title,
    severity: fulfillmentStatus === "completed" ? "info" : "attention",
    title: `${receiptDetails.title} payment recorded`,
    summary: fulfillmentStatus === "completed" ? "Service payment was completed." : "Service payment is awaiting provider confirmation.",
    payload: { service_key: serviceKey, receipt, balance: debit.balance, fulfillment_status: fulfillmentStatus },
    occurred_at: now,
  }, { source_table: "wallet_transactions", source_event_id: String(transaction.id) });

  return res.json({
    ok: true,
    balance: debit.balance,
    receipt,
    transaction,
  });
}

export async function listServiceAccounts(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const estateId = String(req.query.estate_id || user.estate_id || "").trim();
  const homeId = String(req.query.home_id || "").trim() || null;
  const residentId = String(req.query.resident_id || "").trim() || null;
  if (!estateId) return res.status(400).json({ error: "estate_id is required" });

  try {
    const canRead = ["admin", "super_admin", "ochiga_admin"].includes(String(user.role || "")) || await assertCanReadEstate(user.id, estateId);
    if (!canRead) return res.status(403).json({ error: "Insufficient permissions" });
    const accounts = await listServiceAccountsForScope({ estateId, homeId, residentId });
    logger.info("facility_service_accounts_scope_resolution", {
      user_id: String(user.id),
      requested_estate_id: estateId,
      requested_home_id: homeId,
      requested_resident_id: residentId,
      service_account_count: accounts.length,
    });
    return res.json({
      ok: true,
      estate_id: estateId,
      accounts,
      summary: {
        total: accounts.length,
        ready: accounts.filter((item: any) => item.vending_readiness === "ready").length,
        pending: accounts.filter((item: any) => item.vending_readiness === "pending").length,
        issues: accounts.filter((item: any) => item.vending_readiness === "issues" || /failed|warning|blocked|issue/.test(String(item.status || ""))).length,
      },
    });
  } catch (e: any) {
    return serviceErrorResponse(res, e, "Service accounts are temporarily unavailable.", {
      endpoint: "GET /services/accounts",
      actor_id: user.id,
      requested_estate_id: estateId,
      requested_home_id: homeId,
      requested_resident_id: residentId,
    });
  }
}

export async function listMyServiceAccounts(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  try {
    const home = await resolveHomeForUser(user, {
      homeId: String(req.query.home_id || "").trim() || null,
      estateId: String(req.query.estate_id || "").trim() || null,
    });
    if (!home?.id) return res.status(400).json({ error: "No home linked to this account" });
    const estateId = String(home.estate_id || user.estate_id || "").trim();
    if (!estateId) return res.status(400).json({ error: "No estate linked to this account" });
    const accounts = await listServiceAccountsForScope({ estateId, homeId: String(home.id) });
    logger.info("consumer_services_scope_resolution", {
      user_id: String(user.id),
      requested_estate_id: String(req.query.estate_id || "").trim() || null,
      requested_home_id: String(req.query.home_id || "").trim() || null,
      resolved_estate_id: estateId,
      resolved_home_id: String(home.id),
      membership_found: true,
      service_account_count: accounts.length,
      meter_count: accounts.filter((item: any) => Boolean(item.meter_number || item.account_number || item.identifier)).length,
    });
    return res.json({ ok: true, estate_id: estateId, home_id: String(home.id), accounts });
  } catch (e: any) {
    return serviceErrorResponse(res, e, "Resident service accounts are temporarily unavailable.", {
      endpoint: "GET /services/accounts/me",
      actor_id: user.id,
      requested_estate_id: String(req.query.estate_id || "").trim() || null,
      requested_home_id: String(req.query.home_id || "").trim() || null,
    });
  }
}

export async function quoteElectricityPurchase(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ ok: false, code: "service_auth_required", error: "Not authenticated" });

  let context: Awaited<ReturnType<typeof resolveElectricityPurchaseContext>> | null = null;
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, code: "invalid_amount", error: "Enter an electricity purchase amount." });
    }
    context = await resolveElectricityPurchaseContext(req, user);
    const quote = buildElectricityQuote({
      amount,
      config: context.config,
      meterId: context.meterId,
      accountRef: context.accountRef,
      wallet: context.wallet,
    });
    logger.info("electricity_purchase_quote_created", {
      request_id: req.requestId || null,
      user_id: String(user.id),
      membership_id: context.walletScope.membershipId || null,
      estate_id: context.estateId,
      home_id: context.homeId,
      service_account_id: context.serviceAccountId || null,
      wallet_account_id: context.wallet?.id || null,
      service_type: "electricity",
      amount: quote.amount,
      purchase_available: quote.purchase_available,
      unavailable_reason: quote.unavailable_reason,
    });
    return res.json({ ok: true, quote });
  } catch (error: any) {
    return serviceTransactionErrorResponse(req, res, error, "Electricity purchase is temporarily unavailable.", {
      user_id: String(user.id),
      membership_id: context?.walletScope?.membershipId || (req as any).oisContext?.membership_id || null,
      estate_id: context?.estateId || (req as any).oisContext?.estate_id || null,
      home_id: context?.homeId || (req as any).oisContext?.home_id || null,
      service_account_id: context?.serviceAccountId || null,
      wallet_account_id: context?.wallet?.id || null,
      service_type: "electricity",
      failure_stage: "electricity_quote",
    });
  }
}

export async function confirmElectricityPurchase(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ ok: false, code: "service_auth_required", error: "Not authenticated" });

  let context: Awaited<ReturnType<typeof resolveElectricityPurchaseContext>> | null = null;
  let transaction: any = null;
  const idempotencyKey = String(req.body?.idempotency_key || req.headers["x-idempotency-key"] || "").trim() || null;

  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, code: "invalid_amount", error: "Enter an electricity purchase amount." });
    }
    context = await resolveElectricityPurchaseContext(req, user);

    const existing = await findServiceTransactionByIdempotency({
      estateId: context.estateId,
      homeId: context.homeId,
      userId: String(user.id),
      idempotencyKey,
    });
    if (existing?.id) {
      return res.json({
        ok: true,
        transaction: existing,
        receipt: existing.receipt || existing.metadata?.receipt || null,
        idempotent: true,
        message: "This electricity purchase was already recorded.",
      });
    }

    const quote = buildElectricityQuote({
      amount,
      config: context.config,
      meterId: context.meterId,
      accountRef: context.accountRef,
      wallet: context.wallet,
    });
    if (!quote.wallet.sufficient) {
      return res.status(400).json({
        ok: false,
        code: "insufficient_funds",
        error: "Your selected home wallet does not have enough funds for this purchase.",
        wallet_charged: false,
      });
    }
    if (!quote.purchase_available) {
      transaction = await insertServiceTransactionRecord({
        estateId: context.estateId,
        homeId: context.homeId,
        residentId: String(user.id),
        membershipId: context.walletScope.membershipId || null,
        walletAccountId: context.wallet?.id || null,
        serviceAccountId: context.serviceAccountId || null,
        serviceKey: "utility_token",
        provider: context.account?.provider || null,
        meterId: quote.meter.meter_id,
        accountRef: quote.meter.account_ref,
        amount: quote.amount,
        fee: quote.fee,
        tax: quote.tax,
        totalDeduction: quote.total_deduction,
        netServiceAmount: quote.net_service_amount,
        computedUnits: quote.units,
        currency: quote.currency,
        status: "pending_provider",
        transactionType: "electricity_purchase",
        settlementStatus: "unsupported",
        fulfilmentType: "pending_provider",
        fulfilmentMethod: quote.fulfilment.method,
        vendingMode: quote.fulfilment.mode,
        idempotencyKey,
        tariffSnapshot: quote.tariff,
        failureCode: quote.unavailable_reason,
        safeFailureMessage: "Electricity purchase is not available for this home yet.",
        metadata: {
          source: "services_api",
          service_key: "utility_token",
          quote,
          wallet_charged: false,
        },
      });
      return res.status(409).json({
        ok: false,
        code: quote.unavailable_reason || "electricity_purchase_unavailable",
        error: "Electricity purchase is temporarily unavailable. Your wallet has not been charged.",
        wallet_charged: false,
        transaction,
        quote,
      });
    }

    const reference = `elec_${Date.now()}_${randomBytes(4).toString("hex")}`;
    transaction = await insertServiceTransactionRecord({
      estateId: context.estateId,
      homeId: context.homeId,
      residentId: String(user.id),
      membershipId: context.walletScope.membershipId || null,
      walletAccountId: context.wallet.id,
      serviceAccountId: context.serviceAccountId || null,
      serviceKey: "utility_token",
      provider: context.account?.provider || null,
      meterId: quote.meter.meter_id,
      accountRef: quote.meter.account_ref,
      amount: quote.amount,
      fee: quote.fee,
      tax: quote.tax,
      totalDeduction: quote.total_deduction,
      netServiceAmount: quote.net_service_amount,
      computedUnits: quote.units,
      currency: "NGN",
      status: "pending",
      transactionType: "electricity_purchase",
      settlementStatus: "pending",
      fulfilmentType: quote.fulfilment.method,
      fulfilmentMethod: quote.fulfilment.method,
      vendingMode: quote.fulfilment.mode,
      receiptReference: reference,
      idempotencyKey,
      tariffSnapshot: quote.tariff,
      metadata: {
        source: "services_api",
        service_key: "utility_token",
        quote,
        wallet_charged: false,
      },
    });

    const debit = await debitHomeWallet({
      walletId: String(context.wallet.id),
      userId: String(user.id),
      amount: quote.total_deduction,
      reference,
      type: "power",
      reason: "electricity_purchase",
    });

    const testToken = quote.fulfilment.test_mode
      ? `TEST-${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`
      : null;
    const receipt = serviceReceiptFromPurchase({
      transactionId: String(transaction.id),
      reference,
      quote,
      walletAccountId: String(context.wallet.id),
      walletTransactionId: debit.transaction_id || null,
      homeId: context.homeId,
      estateId: context.estateId,
      membershipId: context.walletScope.membershipId || null,
      token: testToken,
      testMode: quote.fulfilment.test_mode,
    });

    const { data: completed, error: updateError } = await supabaseAdmin
      .from("service_transactions")
      .update({
        status: "completed",
        settlement_status: "settled",
        wallet_transaction_id: debit.transaction_id || null,
        provider_reference: reference,
        token_reference: testToken,
        receipt_reference: reference,
        completed_at: new Date().toISOString(),
        receipt,
        metadata: {
          ...(transaction.metadata || {}),
          receipt,
          wallet_charged: true,
          wallet_debit: debit,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", transaction.id)
      .select("*")
      .single();
    if (updateError) throw Object.assign(new Error(updateError.message), { statusCode: tableMissing(updateError) ? 503 : 500, cause: updateError });
    transaction = completed || transaction;

    if (debit.transaction_id) {
      await supabaseAdmin
        .from("wallet_transactions")
        .update({
          metadata: {
            source: "services_api",
            direction: "debit",
            service_key: "utility_token",
            account_ref: quote.meter.account_ref,
            meter_id: quote.meter.meter_id,
            home_id: context.homeId,
            estate_id: context.estateId,
            membership_id: context.walletScope.membershipId || null,
            wallet_account_id: context.wallet.id,
            service_account_id: context.serviceAccountId || null,
            receipt,
          },
        })
        .eq("id", debit.transaction_id);
    }

    await handleSignal({
      type: "wallet.debited",
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "user",
      walletId: context.wallet.id,
      userId: user.id,
      amount: quote.total_deduction,
      currency: "NGN",
      reason: "electricity_purchase",
      metadata: {
        estate_id: context.estateId,
        home_id: context.homeId,
        membership_id: context.walletScope.membershipId || null,
        service_account_id: context.serviceAccountId || null,
        transaction_id: transaction.id,
      },
      timestamp: new Date().toISOString(),
    });

    try {
      await NotificationService.sendToUser(String(user.id), {
        title: "Electricity purchase successful",
        message: quote.fulfilment.test_mode
          ? "A test electricity token has been generated for this home."
          : "Your electricity purchase has been completed.",
        type: "wallet",
        payload: { estate_id: context.estateId, home_id: context.homeId, kind: "service.receipt", receipt },
        entityId: String(transaction.id),
      });
    } catch (notifyErr) {
      logger.warn("electricity_purchase_notification_failed", { transaction_id: transaction.id, error: notifyErr });
    }

    try {
      await sendServiceReceiptEmail(user, receipt);
    } catch (mailErr) {
      logger.warn("electricity_purchase_email_failed", { transaction_id: transaction.id, error: mailErr });
    }

    await emitServiceRegistryEvent({
      event: "wallet.service_payment.updated",
      estate_id: context.estateId,
      home_id: context.homeId,
      service_key: "utility_token",
      user_id: String(user.id),
      actor_id: String(user.id),
      payload: { receipt, balance: debit.balance, transaction_id: transaction.id },
    });
    await emitServiceRegistryEvent({
      event: "home.service_registry.updated",
      estate_id: context.estateId,
      home_id: context.homeId,
      service_key: "utility_token",
      user_id: String(user.id),
      actor_id: String(user.id),
      payload: { reason: "electricity_purchase" },
    });

    return res.json({
      ok: true,
      wallet_charged: true,
      balance: debit.balance,
      transaction,
      receipt,
      message: quote.fulfilment.test_mode
        ? "Test electricity token generated. This token is not valid for a live meter."
        : "Electricity purchase completed.",
    });
  } catch (error: any) {
    return serviceTransactionErrorResponse(req, res, error, "Electricity purchase is temporarily unavailable. Your wallet has not been charged.", {
      user_id: String(user.id),
      membership_id: context?.walletScope?.membershipId || (req as any).oisContext?.membership_id || null,
      estate_id: context?.estateId || (req as any).oisContext?.estate_id || null,
      home_id: context?.homeId || (req as any).oisContext?.home_id || null,
      service_account_id: context?.serviceAccountId || null,
      wallet_account_id: context?.wallet?.id || null,
      service_type: "electricity",
      transaction_id: transaction?.id || null,
      failure_stage: transaction ? "electricity_purchase_confirm" : "electricity_purchase_prepare",
    });
  }
}

export async function createServiceTransaction(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ ok: false, code: "service_auth_required", error: "Not authenticated" });

  let estateId: string | null = null;
  let homeId: string | null = null;
  let serviceAccountId: string | null = null;
  let serviceKey: ServiceKey | null = null;
  let transactionType: ServiceTransactionType | null = null;
  let amount = 0;
  let transaction: any = null;
  let status: ServiceTransactionStatus = "pending";
  let execution: any = null;
  let provider: ReturnType<typeof getInfrastructureServiceProvider> | null = null;

  try {
    serviceKey = String(req.body?.service_key || "").trim() as ServiceKey;
    if (!VALID_SERVICE_KEYS.has(serviceKey)) {
      return res.status(400).json({ ok: false, code: "invalid_service_key", error: "This service is not available." });
    }

    amount = req.body?.amount == null || req.body?.amount === "" ? 0 : Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ ok: false, code: "invalid_amount", error: "Amount must be zero or greater." });
    }

    transactionType = String(req.body?.transaction_type || transactionTypeForService(serviceKey)).trim() as ServiceTransactionType;
    const accountRef = String(req.body?.account_ref || "").trim();
    const notes = String(req.body?.notes || "").trim() || null;
    const idempotencyKey = String(req.body?.idempotency_key || req.headers["x-idempotency-key"] || "").trim() || null;
    const requestedHomeId = String((req as any).oisContext?.home_id || req.body?.home_id || "").trim() || null;
    const requestedEstateId = String((req as any).oisContext?.estate_id || req.body?.estate_id || "").trim() || null;

    const home = await resolveHomeForUser(user, { homeId: requestedHomeId, estateId: requestedEstateId });
    if (!home?.id) return res.status(400).json({ ok: false, code: "home_context_unavailable", error: "Your home context could not be loaded." });

    estateId = String(home.estate_id || user.estate_id || "").trim();
    homeId = String(home.id);
    if (!estateId) return res.status(400).json({ ok: false, code: "estate_context_unavailable", error: "Your estate context could not be loaded." });

    const accounts = await listServiceAccountsForScope({ estateId, homeId });
    const account = accounts.find((item: any) => item.service_key === serviceKey);
    if (!account) return res.status(404).json({ ok: false, code: "service_account_not_found", error: "This home does not have that service connected." });
    serviceAccountId = String(account.id || "");
    if (accountRef && account.identifier && accountRef !== account.identifier) {
      return res.status(400).json({ ok: false, code: "service_account_mismatch", error: "That account does not match this home." });
    }

    logger.info("service_transaction_stage", {
      request_id: req.requestId || null,
      user_id: String(user.id),
      membership_id: (req as any).oisContext?.membership_id || null,
      estate_id: estateId,
      home_id: homeId,
      service_account_id: serviceAccountId,
      service_type: serviceDomainFor(serviceKey),
      failure_stage: "provider_execute_start",
    });

    provider = getInfrastructureServiceProvider(serviceKey as ProviderServiceKey);
    execution = await provider.execute({
      provider: account.provider,
      accountRef: account.identifier,
      amount,
      serviceKey,
      transactionType,
      metadata: { notes },
    });

    status =
      execution.status === "pending_provider"
        ? "pending_provider"
        : execution.status === "manual_review"
        ? "manual_review"
        : "unsupported";

    transaction = await insertServiceTransactionRecord({
      estateId,
      homeId,
      residentId: String(user.id),
      serviceAccountId,
      serviceKey,
      provider: account.provider,
      amount,
      currency: "NGN",
      status,
      transactionType,
      settlementStatus: execution.settlementStatus,
      providerReference: execution.providerReference,
      idempotencyKey,
      metadata: {
        account_ref: account.identifier,
        notes,
        requested_from: "consumer_services",
        provider_reason: execution.reason,
        service_title: account.service_title,
        idempotency_key: idempotencyKey,
      },
    });

    await emitServiceRegistryEvent({
      event: "service.transaction.initiated",
      estate_id: estateId,
      home_id: homeId,
      service_key: serviceKey,
      user_id: String(user.id),
      actor_id: String(user.id),
      payload: { transaction_id: transaction.id, transaction_type: transactionType, status, amount, provider_reference: execution.providerReference },
    });
    await emitInfrastructureServiceSignal({
      type: "service.transaction.initiated",
      estateId,
      homeId,
      userId: String(user.id),
      actorId: String(user.id),
      serviceKey,
      source: "user",
      metadata: { transaction_id: transaction.id, transaction_type: transactionType, status, amount },
    });

    if (transactionType === "issue_report") {
      await emitServiceRegistryEvent({
        event: "service.issue.reported",
        estate_id: estateId,
        home_id: homeId,
        service_key: serviceKey,
        user_id: String(user.id),
        actor_id: String(user.id),
        payload: { transaction_id: transaction.id, notes, status },
      });
      await emitInfrastructureServiceSignal({
        type: "service.issue.reported",
        estateId,
        homeId,
        userId: String(user.id),
        actorId: String(user.id),
        serviceKey,
        source: "user",
        metadata: { transaction_id: transaction.id, notes, status },
      });
    }

    if (status === "unsupported") {
      await emitServiceRegistryEvent({
        event: "service.transaction.failed",
        estate_id: estateId,
        home_id: homeId,
        service_key: serviceKey,
        user_id: String(user.id),
        actor_id: String(user.id),
        payload: { transaction_id: transaction.id, reason: execution.reason, status },
      });
      await emitInfrastructureServiceSignal({
        type: "service.transaction.failed",
        estateId,
        homeId,
        userId: String(user.id),
        actorId: String(user.id),
        serviceKey,
        source: "user",
        metadata: { transaction_id: transaction.id, reason: execution.reason, status },
      });
    }

    return res.status(202).json({
      ok: true,
      transaction,
      provider: {
        type: provider.key,
        label: provider.label,
        execution,
      },
      message: execution.reason,
    });
  } catch (error: any) {
    return serviceTransactionErrorResponse(req, res, error, "This service request is temporarily unavailable.", {
      user_id: String(user.id),
      membership_id: (req as any).oisContext?.membership_id || null,
      estate_id: estateId,
      home_id: homeId,
      service_account_id: serviceAccountId,
      wallet_account_id: null,
      service_type: serviceKey ? serviceDomainFor(serviceKey) : null,
      transaction_id: transaction?.id || null,
      failure_stage: transaction ? "post_transaction_processing" : execution ? "transaction_insert" : "provider_execution",
    });
  }
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

export async function listEstateServiceTransactions(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const estateId = String(req.query.estate_id || user.estate_id || "").trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  if (!estateId) return res.status(400).json({ error: "estate_id is required" });

  try {
    const canManage = user.role === "admin" ? true : await assertCanManageEstate(user.id, estateId);
    if (!canManage) return res.status(403).json({ error: "Insufficient permissions" });

    const { data, error } = await supabaseAdmin
      .from("service_transactions")
      .select("id, estate_id, home_id, resident_id, user_id, service_account_id, service_type, service_key, provider, amount, currency, status, transaction_type, settlement_status, provider_reference, metadata, created_at, updated_at")
      .eq("estate_id", estateId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (tableMissing(error)) return res.json({ ok: true, transactions: [], summary: { pending: 0, completed: 0, failed: 0, manual_review: 0, unsupported: 0 } });
      return res.status(500).json({ error: error.message });
    }

    const rows = data || [];
    return res.json({
      ok: true,
      transactions: rows,
      summary: {
        pending: rows.filter((row: any) => ["pending", "pending_provider"].includes(String(row.status))).length,
        completed: rows.filter((row: any) => String(row.status) === "completed").length,
        failed: rows.filter((row: any) => String(row.status) === "failed").length,
        manual_review: rows.filter((row: any) => String(row.status) === "manual_review").length,
        unsupported: rows.filter((row: any) => String(row.status) === "unsupported").length,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load service transactions" });
  }
}

export async function listServiceRegistryEvents(req: Request, res: Response) {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const estateId = String(req.query.estate_id || user.estate_id || "").trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  if (!estateId) return res.status(400).json({ error: "estate_id is required" });

  try {
    const canRead = ["admin", "super_admin", "ochiga_admin"].includes(String(user.role || "")) || await assertCanReadEstate(user.id, estateId);
    if (!canRead) return res.status(403).json({ error: "Insufficient permissions" });

    const { data, error } = await supabaseAdmin
      .from("service_registry_events")
      .select("id, event_type, estate_id, home_id, service_key, user_id, actor_id, payload, created_at")
      .eq("estate_id", estateId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (tableMissing(error)) return res.json({ ok: true, events: [] });
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, events: data || [] });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load service events" });
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
    const activeHomeId = homeFilter || String((req as any).oisContext?.home_id || user.home_id || "").trim();
    const activeEstateId = String(req.query.estate_id || (req as any).oisContext?.estate_id || user.estate_id || "").trim();
    const walletScope = activeHomeId
      ? await resolveWalletScopeForHome({ userId: String(user.id), estateId: activeEstateId || null, homeId: activeHomeId })
      : undefined;
    wallet = await getOrCreateWallet(user.id, walletScope);
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
    if (homeFilter && String(x?.home_id || meta.home_id || "") !== homeFilter) return false;
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
