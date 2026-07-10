import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";
import { resolveVisibleDevice } from "../services/deviceRuntimeService";
import { logger } from "../observability/logger";
import { sendPublicApiError } from "../services/publicApi";
import { buildIrExternalId, keepDeviceOverrides, upsertCanonicalDeviceIdentity } from "../services/deviceIdentityService";

const PROFILE_LIBRARY = {
  tv: { appliance_type: "tv", label: "TV", control_profile: "tv", device_family: "ir_remote", supported_controls: ["remote", "power"] },
  ac: { appliance_type: "ac", label: "Air Conditioner", control_profile: "climate", device_family: "climate", supported_controls: ["power", "temperature", "fan"] },
  fan: { appliance_type: "fan", label: "Fan", control_profile: "ir_remote", device_family: "ir_remote", supported_controls: ["remote", "power"] },
  decoder: { appliance_type: "decoder", label: "Decoder", control_profile: "tv", device_family: "ir_remote", supported_controls: ["remote", "power"] },
  projector: { appliance_type: "projector", label: "Projector", control_profile: "tv", device_family: "ir_remote", supported_controls: ["remote", "power"] },
  custom: { appliance_type: "custom", label: "Custom Remote", control_profile: "ir_remote", device_family: "ir_remote", supported_controls: ["remote"] },
} as const;

function clean(value: unknown) {
  return String(value || "").trim();
}

function cleanLower(value: unknown) {
  return clean(value).toLowerCase();
}

function isIrHub(device: any) {
  const summary = summarizeDeviceFrontendContract(device || {});
  if (summary.control_profile === "ir_remote") return true;
  const haystack = [
    device?.category,
    device?.type,
    device?.name,
    device?.metadata?.remote_type,
    device?.metadata?.ir_profile,
    device?.metadata?.raw?.category,
  ].map((item) => String(item || "").toLowerCase()).join(" ");
  return /ir|infrared|remote|universal_remote|tv_remote|set_top|stb/.test(haystack);
}

function providerProfiles(device: any) {
  const metadata = device?.metadata && typeof device.metadata === "object" ? device.metadata : {};
  const raw = metadata?.raw && typeof metadata.raw === "object" ? metadata.raw : {};
  const hints = [
    metadata?.remote_type,
    metadata?.ir_profile,
    metadata?.profile,
    raw?.remote_type,
    raw?.ir_profile,
    raw?.category,
    raw?.product_name,
    raw?.model,
  ].map((item) => String(item || "").toLowerCase());
  const available = new Set<string>();
  if (hints.some((item) => /tv|television|decoder|set_top|stb/.test(item))) available.add("tv");
  if (hints.some((item) => /ac|air|climate|hvac|thermostat/.test(item))) available.add("ac");
  if (hints.some((item) => /fan/.test(item))) available.add("fan");
  if (hints.some((item) => /projector/.test(item))) available.add("projector");
  return Array.from(available);
}

async function loadChildAppliances(parentDeviceId: string) {
  const { data, error } = await supabaseAdmin
    .from("devices")
    .select("id,parent_device_id,is_virtual,name,type,category,estate_id,home_id,room_id,external_id,status,provider,adapter,vendor,metadata")
    .eq("parent_device_id", parentDeviceId)
    .eq("is_virtual", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((device: any) => {
    const summary = summarizeDeviceFrontendContract(device);
    return {
      ...device,
      supported_controls: summary.supported_controls,
      control_profile: summary.control_profile,
      device_family: summary.device_family,
      primary_state: summary.primary_state,
      health_status: summary.health_status,
      activity_summary: summary.activity_summary,
    };
  });
}

export async function syncIrChildAppliancesForHub(hub: any) {
  if (!hub || !isIrHub(hub)) {
    return { profiles: [] as string[], appliances: [] as any[], changed: false };
  }

  const profiles = providerProfiles(hub).filter((key) => key in PROFILE_LIBRARY);
  if (!profiles.length) {
    return {
      profiles: [],
      appliances: await loadChildAppliances(String(hub.id)),
      changed: false,
    };
  }

  const { data: rows, error: existingError } = await supabaseAdmin
    .from("devices")
    .select("id,name,home_id,room_id,bind_state,metadata,external_id")
    .eq("parent_device_id", hub.id)
    .eq("is_virtual", true);
  if (existingError) throw new Error(existingError.message);

  const existingByProfile = new Map<string, any>();
  const existingByExternalId = new Map<string, any>();
  for (const row of rows || []) {
    const key = String((row as any)?.metadata?.ir_appliance?.profile || "").toLowerCase();
    if (key) existingByProfile.set(key, row);
    const ext = clean((row as any)?.external_id);
    if (ext) existingByExternalId.set(ext, row);
  }

  let changed = false;
  const upsertedIds: string[] = [];
  for (const profileKey of profiles) {
    const template = PROFILE_LIBRARY[profileKey as keyof typeof PROFILE_LIBRARY];
    const providerProfileId =
      clean(hub?.metadata?.ir_profiles?.[profileKey]?.id) ||
      clean(hub?.metadata?.provider_profiles?.[profileKey]?.id) ||
      clean(hub?.metadata?.raw?.ir_profiles?.[profileKey]?.id) ||
      clean(hub?.metadata?.raw?.provider_profiles?.[profileKey]?.id) ||
      null;
    const externalId = buildIrExternalId(hub, profileKey, providerProfileId);
    const metadata = {
      ...(hub.metadata || {}),
      virtual_device: true,
      control_profile: template.control_profile,
      device_family: template.device_family,
      supported_controls: template.supported_controls,
      ir_appliance: {
        profile: profileKey,
        profile_id: providerProfileId,
        appliance_type: template.appliance_type,
        brand: clean(hub?.metadata?.brand) || clean(hub?.metadata?.raw?.brand) || null,
        model: clean(hub?.metadata?.model) || clean(hub?.metadata?.raw?.model) || null,
        provider_profiles: profiles,
        parent_hub_external_id: clean(hub?.external_id) || null,
      },
    };
    const payload = {
      estate_id: hub.estate_id,
      home_id: hub.home_id,
      room_id: hub.room_id,
      parent_device_id: hub.id,
      is_virtual: true,
      name: `${clean(hub.name) || "Remote"} ${template.label}`,
      type: template.appliance_type,
      category: template.appliance_type,
      adapter: hub.adapter,
      vendor: hub.vendor,
      provider: hub.provider,
      external_id: externalId,
      bind_state: hub.bind_state || (hub.room_id ? "room_bound" : hub.home_id ? "home_bound" : "estate_bound"),
      status: hub.status || "ready",
      metadata,
    };

    const existing = existingByProfile.get(profileKey) || existingByExternalId.get(externalId) || null;
    const finalPayload = existing?.id ? keepDeviceOverrides(existing, payload) : payload;
    const result = await upsertCanonicalDeviceIdentity(finalPayload);
    changed = changed || !existing?.id || clean(existing?.external_id) !== externalId;
    if (result.data?.id) upsertedIds.push(String(result.data.id));
  }

  return {
    profiles,
    appliances: await loadChildAppliances(String(hub.id)),
    changed,
    upsertedIds,
  };
}

export async function listIrProfiles(req: Request, res: Response) {
  try {
    const user = req.user;
    const deviceId = clean(req.params.deviceId);
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const hub = await resolveVisibleDevice(user, deviceId);
    if (!hub) return res.status(404).json({ error: "This device is not assigned to your current home." });
    if (!isIrHub(hub)) return res.status(400).json({ error: "Add or sync an appliance profile before using this remote." });

    const providerAvailable = providerProfiles(hub);
    await syncIrChildAppliancesForHub(hub);
    const available_profiles = Array.from(new Set([...providerAvailable, "tv", "ac", "fan", "decoder", "projector", "custom"])).map((key) => ({
      key,
      ...PROFILE_LIBRARY[key as keyof typeof PROFILE_LIBRARY],
      source: providerAvailable.includes(key) ? "provider" : "manual_profile",
    }));
    const appliances = await loadChildAppliances(String(hub.id));
    return res.json({ hub_id: hub.id, available_profiles, appliances });
  } catch (error: any) {
    return sendPublicApiError(
      res,
      error,
      { statusCode: 503, code: "device_sync_failed", message: "Connected-device synchronization is temporarily unavailable." },
      { operation: "device_ir.list_profiles", device_id: req.params.deviceId || null, actor_id: req.user?.id || null },
    );
  }
}

export async function createIrAppliance(req: Request, res: Response) {
  try {
    const user = req.user;
    const deviceId = clean(req.params.deviceId);
    const profileKey = clean(req.body?.profile || req.body?.appliance_type).toLowerCase();
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });
    if (!profileKey || !(profileKey in PROFILE_LIBRARY)) return res.status(400).json({ error: "Add or sync an appliance profile before using this remote." });

    const hub = await resolveVisibleDevice(user, deviceId);
    if (!hub) return res.status(404).json({ error: "This device is not assigned to your current home." });
    if (!isIrHub(hub)) return res.status(400).json({ error: "Add or sync an appliance profile before using this remote." });

    const template = PROFILE_LIBRARY[profileKey as keyof typeof PROFILE_LIBRARY];
    const label = clean(req.body?.label) || `${clean(hub.name) || "Remote"} ${template.label}`;
    const brand = clean(req.body?.brand);
    const model = clean(req.body?.model);
    const providerProfileId = clean(req.body?.profile_id || req.body?.provider_profile_id || req.body?.remote_profile_id) || null;
    const externalId = buildIrExternalId(hub, profileKey, providerProfileId);
    const metadata = {
      ...(hub.metadata || {}),
      virtual_device: true,
      control_profile: template.control_profile,
      device_family: template.device_family,
      supported_controls: template.supported_controls,
      ir_appliance: {
        profile: profileKey,
        profile_id: providerProfileId,
        appliance_type: template.appliance_type,
        brand: brand || null,
        model: model || null,
        provider_profiles: providerProfiles(hub),
        parent_hub_external_id: clean(hub?.external_id) || null,
      },
    };

    const { data: rows, error: existingError } = await supabaseAdmin
      .from("devices")
      .select("id,name,home_id,room_id,bind_state,metadata,external_id")
      .eq("parent_device_id", hub.id)
      .eq("is_virtual", true);
    if (existingError) throw new Error(existingError.message);
    const existing = (rows || []).find((row: any) =>
      String(row?.metadata?.ir_appliance?.profile || "") === profileKey ||
      clean(row?.external_id) === externalId,
    );

    const payload = {
      estate_id: hub.estate_id,
      home_id: hub.home_id,
      room_id: hub.room_id,
      parent_device_id: hub.id,
      is_virtual: true,
      name: label,
      type: template.appliance_type,
      category: template.appliance_type,
      adapter: hub.adapter,
      vendor: hub.vendor,
      provider: hub.provider,
      external_id: externalId,
      bind_state: hub.bind_state || (hub.room_id ? "room_bound" : hub.home_id ? "home_bound" : "estate_bound"),
      status: hub.status || "ready",
      metadata,
    };

    const result = await upsertCanonicalDeviceIdentity(existing?.id ? keepDeviceOverrides(existing, payload) : payload);
    const appliance = result.data;
    const summary = summarizeDeviceFrontendContract(appliance || {});
    return res.json({
      ok: true,
      appliance: {
        ...appliance,
        supported_controls: summary.supported_controls,
        control_profile: summary.control_profile,
        device_family: summary.device_family,
        primary_state: summary.primary_state,
        health_status: summary.health_status,
        activity_summary: summary.activity_summary,
      },
    });
  } catch (error: any) {
    return sendPublicApiError(
      res,
      error,
      { statusCode: 503, code: "device_sync_failed", message: "Connected-device synchronization is temporarily unavailable." },
      { operation: "device_ir.create_appliance", device_id: req.params.deviceId || null, actor_id: req.user?.id || null },
    );
  }
}
