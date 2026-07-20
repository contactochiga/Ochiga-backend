import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitServiceRegistryEvent } from "./serviceRegistryEvents";
import { emitInfrastructureServiceSignal } from "./infrastructureServiceSignals";
import { getInfrastructureServiceProvider } from "./infrastructureServiceProviders";
import { getOrCreateScopedWallet, resolveWalletScopeForHome } from "./walletScopeService";

export type CanonicalServiceKey =
  | "utility_token"
  | "water_service"
  | "gas_service"
  | "internet_service"
  | "fiber_internet"
  | "generator_recovery"
  | "solar_battery_service"
  | "service_charge"
  | "other_facility_fees";

type ServiceBindingInput = {
  account_ref?: string | null;
  meter_id?: string | null;
  provider?: string | null;
  tariff_profile?: string | null;
  billing_profile?: string | null;
  plan?: string | null;
  kct?: string | null;
  kctn?: string | null;
  status?: string | null;
  linked?: boolean | null;
  metadata?: Record<string, any> | null;
};

type ProvisioningInput = {
  estateId: string;
  homeId: string;
  residentId?: string | null;
  actorId?: string | null;
  homeRecord?: {
    electricity_meter?: string | null;
    water_meter?: string | null;
    internet_id?: string | null;
  } | null;
  serviceBindings?: Record<string, ServiceBindingInput> | null;
};

const SERVICE_KEY_ALIASES: Record<string, CanonicalServiceKey> = {
  utility_token: "utility_token",
  electricity: "utility_token",
  electricity_service: "utility_token",
  water_service: "water_service",
  water: "water_service",
  gas_service: "gas_service",
  gas: "gas_service",
  internet_service: "internet_service",
  internet: "internet_service",
  fiber_internet: "fiber_internet",
  fiber: "fiber_internet",
  generator_recovery: "generator_recovery",
  generator: "generator_recovery",
  solar_battery_service: "solar_battery_service",
  solar_battery: "solar_battery_service",
  solar: "solar_battery_service",
  service_charge: "service_charge",
  other_facility_fees: "other_facility_fees",
  facility_services: "other_facility_fees",
};

const PROVISIONABLE_SERVICE_KEYS: CanonicalServiceKey[] = [
  "utility_token",
  "water_service",
  "gas_service",
  "internet_service",
  "generator_recovery",
  "solar_battery_service",
  "service_charge",
  "other_facility_fees",
];

function text(value: unknown) {
  const next = String(value ?? "").trim();
  return next || null;
}

function lower(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function tableMissing(error: any) {
  const message = String(error?.message || "");
  return (
    message.includes("Could not find the table") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    message.includes("schema cache")
  );
}

function normalizeServiceBindings(
  serviceBindings: Record<string, ServiceBindingInput> | null | undefined,
  homeRecord?: ProvisioningInput["homeRecord"],
): Partial<Record<CanonicalServiceKey, ServiceBindingInput>> {
  const normalized: Partial<Record<CanonicalServiceKey, ServiceBindingInput>> = {};

  if (serviceBindings) {
    for (const [rawKey, rawValue] of Object.entries(serviceBindings)) {
      const key = SERVICE_KEY_ALIASES[lower(rawKey)];
      if (!key || !rawValue || typeof rawValue !== "object") continue;
      normalized[key] = {
        account_ref: text(rawValue.account_ref),
        meter_id: text(rawValue.meter_id),
        provider: text(rawValue.provider),
        tariff_profile: text(rawValue.tariff_profile),
        billing_profile: text(rawValue.billing_profile),
        plan: text(rawValue.plan),
        kct: text(rawValue.kct),
        kctn: text(rawValue.kctn),
        status: text(rawValue.status),
        linked: rawValue.linked == null ? null : Boolean(rawValue.linked),
        metadata: rawValue.metadata && typeof rawValue.metadata === "object" ? rawValue.metadata : {},
      };
    }
  }

  if (!normalized.utility_token && text(homeRecord?.electricity_meter)) {
    normalized.utility_token = {
      meter_id: text(homeRecord?.electricity_meter),
      account_ref: text(homeRecord?.electricity_meter),
      linked: true,
      metadata: {},
    };
  }
  if (!normalized.water_service && text(homeRecord?.water_meter)) {
    normalized.water_service = {
      meter_id: text(homeRecord?.water_meter),
      account_ref: text(homeRecord?.water_meter),
      linked: true,
      metadata: {},
    };
  }
  if (!normalized.internet_service && text(homeRecord?.internet_id)) {
    normalized.internet_service = {
      account_ref: text(homeRecord?.internet_id),
      linked: true,
      metadata: {},
    };
  }

  return normalized;
}

async function upsertWalletForResident(userId: string, estateId: string, homeId: string) {
  const scope = await resolveWalletScopeForHome({ userId, estateId, homeId });
  return getOrCreateScopedWallet(scope);
}

async function syncResidentAssignment(estateId: string, homeId: string, residentId: string | null | undefined) {
  const userId = text(residentId);
  if (!userId) return;

  const { error: estateMembershipError } = await supabaseAdmin
    .from("estate_memberships")
    .upsert(
      {
        estate_id: estateId,
        user_id: userId,
        role: "resident",
        status: "active",
      },
      { onConflict: "estate_id,user_id" },
    );
  if (estateMembershipError) throw new Error(estateMembershipError.message);

  const { error: homeMembershipError } = await supabaseAdmin
    .from("home_memberships")
    .upsert(
      {
        home_id: homeId,
        user_id: userId,
        role: "owner",
        status: "active",
      },
      { onConflict: "home_id,user_id" },
    );
  if (homeMembershipError) throw new Error(homeMembershipError.message);

  const { error: userPatchError } = await supabaseAdmin
    .from("users")
    .update({
      estate_id: estateId,
      home_id: homeId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (userPatchError && !tableMissing(userPatchError)) throw new Error(userPatchError.message);

  await upsertWalletForResident(userId, estateId, homeId);
}

async function upsertServiceAssignment(
  estateId: string,
  homeId: string,
  residentId: string | null,
  actorId: string | null,
  serviceKey: CanonicalServiceKey,
  enabled: boolean,
  metadata: Record<string, any>,
) {
  const { data: existing, error: readError } = await supabaseAdmin
    .from("home_service_assignments")
    .select("id")
    .eq("estate_id", estateId)
    .eq("home_id", homeId)
    .eq("service_key", serviceKey)
    .eq("scope", "home")
    .limit(1)
    .maybeSingle();

  if (readError) {
    if (tableMissing(readError)) return;
    throw new Error(readError.message);
  }

  const payload = {
    estate_id: estateId,
    home_id: homeId,
    user_id: residentId,
    service_key: serviceKey,
    enabled,
    assigned_by: actorId,
    scope: "home",
    metadata,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await supabaseAdmin.from("home_service_assignments").update(payload).eq("id", existing.id);
    if (error && !tableMissing(error)) throw new Error(error.message);
    return;
  }

  const { error } = await supabaseAdmin.from("home_service_assignments").insert([payload]);
  if (error && !tableMissing(error)) throw new Error(error.message);
}

async function readExistingHomeServiceAccounts(homeId: string) {
  const { data, error } = await supabaseAdmin
    .from("home_service_accounts")
    .select("service_key, provider, account_ref, meter_id, plan, status, linked, metadata")
    .eq("home_id", homeId);
  if (error) {
    if (tableMissing(error)) return new Map<CanonicalServiceKey, ServiceBindingInput>();
    throw new Error(error.message);
  }
  const existing = new Map<CanonicalServiceKey, ServiceBindingInput>();
  for (const row of data || []) {
    const serviceKey = SERVICE_KEY_ALIASES[lower((row as any).service_key)];
    if (!serviceKey) continue;
    const metadata = (row as any).metadata && typeof (row as any).metadata === "object" ? (row as any).metadata : {};
    existing.set(serviceKey, {
      account_ref: text((row as any).account_ref),
      meter_id: text((row as any).meter_id),
      provider: text((row as any).provider),
      plan: text((row as any).plan),
      status: text((row as any).status),
      linked: (row as any).linked == null ? null : Boolean((row as any).linked),
      tariff_profile: text(metadata.tariff_profile),
      billing_profile: text(metadata.billing_profile),
      kct: text(metadata.kct),
      kctn: text(metadata.kctn),
      metadata,
    });
  }
  return existing;
}

async function readHomeProvisioningRecord(estateId: string, homeId: string): Promise<ProvisioningInput["homeRecord"]> {
  const { data, error } = await supabaseAdmin
    .from("homes")
    .select("id, estate_id, electricity_meter, water_meter, internet_id")
    .eq("id", homeId)
    .eq("estate_id", estateId)
    .maybeSingle();
  if (error) {
    if (tableMissing(error)) return null;
    throw new Error(error.message);
  }
  if (!data?.id) return null;
  return {
    electricity_meter: text((data as any).electricity_meter),
    water_meter: text((data as any).water_meter),
    internet_id: text((data as any).internet_id),
  };
}

export async function provisionHomeServices(input: ProvisioningInput) {
  const estateId = text(input.estateId);
  const homeId = text(input.homeId);
  if (!estateId || !homeId) return { provisionedKeys: [] as CanonicalServiceKey[] };

  const residentId = text(input.residentId);
  const actorId = text(input.actorId);
  const homeRecord = input.homeRecord || await readHomeProvisioningRecord(estateId, homeId);
  const bindings = normalizeServiceBindings(input.serviceBindings, homeRecord);
  const existingAccounts = await readExistingHomeServiceAccounts(homeId);
  for (const [serviceKey, existing] of existingAccounts.entries()) {
    if (!bindings[serviceKey]) bindings[serviceKey] = existing;
  }
  const provisionedKeys: CanonicalServiceKey[] = [];

  if (residentId) {
    await syncResidentAssignment(estateId, homeId, residentId);
  }

  for (const serviceKey of PROVISIONABLE_SERVICE_KEYS) {
    const binding = bindings[serviceKey];
    const accountRef =
      text(binding?.account_ref) ||
      text(binding?.meter_id) ||
      (serviceKey === "service_charge" || serviceKey === "other_facility_fees" ? homeId : null);
    const meterId = text(binding?.meter_id);
    const provider = text(binding?.provider);
    const plan = text(binding?.plan);
    const tariffProfile = text(binding?.tariff_profile);
    const billingProfile = text(binding?.billing_profile);
    const kct = text(binding?.kct);
    const kctn = text(binding?.kctn);
    const linked =
      binding?.linked != null
        ? Boolean(binding.linked)
        : Boolean(accountRef || meterId || serviceKey === "service_charge" || serviceKey === "other_facility_fees");
    const status = text(binding?.status) || (linked ? "active" : "setup_needed");
    const metadata = {
      ...(binding?.metadata || {}),
      tariff_profile: tariffProfile,
      billing_profile: billingProfile,
      kct,
      kctn,
      provisioned_from: "home_workflow",
      provisioned_at: new Date().toISOString(),
      provider_integration_mode: serviceKey === "utility_token" ? "authorized_vending_provider" : null,
    };

    if (
      !linked &&
      !provider &&
      !plan &&
      !tariffProfile &&
      !billingProfile &&
      !kct &&
      !kctn &&
      serviceKey !== "service_charge" &&
      serviceKey !== "other_facility_fees"
    ) {
      continue;
    }

    const { error } = await supabaseAdmin.from("home_service_accounts").upsert(
      {
        estate_id: estateId,
        home_id: homeId,
        service_key: serviceKey,
        provider,
        account_ref: accountRef,
        meter_id: meterId,
        plan,
        status,
        linked,
        metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "home_id,service_key" },
    );
    if (error) {
      if (tableMissing(error)) continue;
      throw new Error(error.message);
    }

    await upsertServiceAssignment(
      estateId,
      homeId,
      residentId,
      actorId,
      serviceKey,
      linked,
      {
        tariff_profile: tariffProfile,
        billing_profile: billingProfile,
        provider,
      },
    );

    await emitServiceRegistryEvent({
      event: "service.account.provisioned",
      estate_id: estateId,
      home_id: homeId,
      service_key: serviceKey,
      user_id: residentId,
      actor_id: actorId,
      payload: { provider, account_ref: accountRef, meter_id: meterId, linked, status },
    });
    await emitInfrastructureServiceSignal({
      type: "service.account.provisioned",
      estateId,
      homeId,
      userId: residentId,
      actorId,
      serviceKey,
      source: "system",
      metadata: { provider, account_ref: accountRef, meter_id: meterId, linked, status },
    });

    await emitServiceRegistryEvent({
      event: "service.assignment.created",
      estate_id: estateId,
      home_id: homeId,
      service_key: serviceKey,
      user_id: residentId,
      actor_id: actorId,
      payload: { enabled: linked, provider, tariff_profile: tariffProfile, billing_profile: billingProfile },
    });
    await emitInfrastructureServiceSignal({
      type: "service.assignment.created",
      estateId,
      homeId,
      userId: residentId,
      actorId,
      serviceKey,
      source: "system",
      metadata: { enabled: linked, provider, tariff_profile: tariffProfile, billing_profile: billingProfile },
    });

    await emitServiceRegistryEvent({
      event: "service.status.changed",
      estate_id: estateId,
      home_id: homeId,
      service_key: serviceKey,
      user_id: residentId,
      actor_id: actorId,
      payload: { status, linked },
    });
    await emitInfrastructureServiceSignal({
      type: "service.status.changed",
      estateId,
      homeId,
      userId: residentId,
      actorId,
      serviceKey,
      source: "system",
      metadata: { status, linked },
    });

    const providerHealth = getInfrastructureServiceProvider(serviceKey).health({ provider, linked, status, metadata });
    if (providerHealth.readiness === "ready") {
      await emitServiceRegistryEvent({
        event: "service.vending.ready",
        estate_id: estateId,
        home_id: homeId,
        service_key: serviceKey,
        user_id: residentId,
        actor_id: actorId,
        payload: { provider, readiness: providerHealth.readiness, reason: providerHealth.reason },
      });
      await emitInfrastructureServiceSignal({
        type: "service.vending.ready",
        estateId,
        homeId,
        userId: residentId,
        actorId,
        serviceKey,
        source: "system",
        metadata: { provider, readiness: providerHealth.readiness, reason: providerHealth.reason },
      });
    }

    provisionedKeys.push(serviceKey);
  }

  return { provisionedKeys };
}
