import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";
import { resolveVisibleDevice } from "../services/deviceRuntimeService";
import { logger } from "../observability/logger";
import { sendPublicApiError } from "../services/publicApi";
import { buildIrExternalId, keepDeviceOverrides, upsertCanonicalDeviceIdentity } from "../services/deviceIdentityService";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";

const PROFILE_LIBRARY = {
  tv: { appliance_type: "television", label: "TV", control_profile: "television", device_family: "television", supported_controls: ["remote", "power"] },
  ac: { appliance_type: "air_conditioner", label: "Air Conditioner", control_profile: "air_conditioner", device_family: "climate", supported_controls: ["power", "temperature", "mode", "fan_speed"] },
  fan: { appliance_type: "fan", label: "Fan", control_profile: "fan", device_family: "fan", supported_controls: ["remote", "power", "fan_speed"] },
  decoder: { appliance_type: "set_top_box", label: "Decoder", control_profile: "set_top_box", device_family: "set_top_box", supported_controls: ["remote", "power"] },
  set_top_box: { appliance_type: "set_top_box", label: "Set-top Box", control_profile: "set_top_box", device_family: "set_top_box", supported_controls: ["remote", "power"] },
  projector: { appliance_type: "projector", label: "Projector", control_profile: "projector", device_family: "projector", supported_controls: ["remote", "power"] },
  speaker: { appliance_type: "speaker", label: "Speaker", control_profile: "speaker", device_family: "speaker", supported_controls: ["remote", "power"] },
  custom: { appliance_type: "custom", label: "Custom Remote", control_profile: "ir_remote", device_family: "ir_remote", supported_controls: ["remote"] },
  unknown_ir_appliance: { appliance_type: "unknown_ir_appliance", label: "IR Appliance", control_profile: "ir_remote", device_family: "ir_remote", supported_controls: ["remote"] },
} as const;

const TUYA_IR_CATEGORY_PROFILE: Record<string, keyof typeof PROFILE_LIBRARY> = {
  "1": "set_top_box",
  "2": "tv",
  "5": "ac",
  "8": "fan",
};

type ProviderIrProfile = {
  key: string;
  appliance_type: string;
  label: string;
  control_profile: string;
  device_family: string;
  supported_controls: string[];
  capability_codes: string[];
  remote_id: string | null;
  remote_index: string | null;
  category_id: string | null;
  brand_id: string | null;
  brand: string | null;
  model: string | null;
  source: "provider" | "metadata";
  raw?: Record<string, any>;
  keys?: any[];
};

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
  const explicitProfiles = [
    ...(Array.isArray(metadata?.provider_profiles) ? metadata.provider_profiles : []),
    ...(Array.isArray(metadata?.ir_profiles) ? metadata.ir_profiles : []),
    ...(Array.isArray(raw?.provider_profiles) ? raw.provider_profiles : []),
    ...(Array.isArray(raw?.ir_profiles) ? raw.ir_profiles : []),
    ...Object.entries(metadata?.provider_profiles && typeof metadata.provider_profiles === "object" && !Array.isArray(metadata.provider_profiles) ? metadata.provider_profiles : {}).map(([key, value]) => ({ key, ...(value as any) })),
    ...Object.entries(metadata?.ir_profiles && typeof metadata.ir_profiles === "object" && !Array.isArray(metadata.ir_profiles) ? metadata.ir_profiles : {}).map(([key, value]) => ({ key, ...(value as any) })),
    ...Object.entries(raw?.provider_profiles && typeof raw.provider_profiles === "object" && !Array.isArray(raw.provider_profiles) ? raw.provider_profiles : {}).map(([key, value]) => ({ key, ...(value as any) })),
    ...Object.entries(raw?.ir_profiles && typeof raw.ir_profiles === "object" && !Array.isArray(raw.ir_profiles) ? raw.ir_profiles : {}).map(([key, value]) => ({ key, ...(value as any) })),
  ];
  const available = new Set<string>();
  for (const profile of explicitProfiles) {
    const key = cleanLower((profile as any)?.key || (profile as any)?.profile || (profile as any)?.appliance_type || (profile as any)?.type || (profile as any)?.category || (profile as any)?.remote_type);
    if (key && key in PROFILE_LIBRARY) available.add(key);
  }
  if (available.size) return Array.from(available);
  const direct = cleanLower(metadata?.ir_profile || metadata?.profile || raw?.ir_profile || raw?.profile);
  if (direct && direct in PROFILE_LIBRARY) available.add(direct);
  return Array.from(available);
}

function keyCode(input: any) {
  return clean(input?.key || input?.key_code || input?.code || input?.value || input?.name || input?.key_name);
}

function normalizedKeyCode(input: any) {
  return keyCode(input).toLowerCase().replace(/[\s.-]+/g, "_");
}

function compactUnique(values: unknown[]) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function irProfileKeyFromRemote(remote: any) {
  const categoryId = clean(remote?.category_id || remote?.category);
  if (categoryId && TUYA_IR_CATEGORY_PROFILE[categoryId]) return TUYA_IR_CATEGORY_PROFILE[categoryId];
  const haystack = [
    remote?.category,
    remote?.category_id,
    remote?.category_name,
    remote?.remote_name,
    remote?.name,
    remote?.appliance_type,
    remote?.type,
  ].map((item) => String(item || "").toLowerCase()).join(" ");
  if (/\b(tv|television)\b/.test(haystack)) return "tv";
  if (/\b(ac|air\s*conditioner|air_conditioner|conditioner|climate)\b/.test(haystack)) return "ac";
  if (/\bfan\b/.test(haystack)) return "fan";
  if (/\b(projector|projection)\b/.test(haystack)) return "projector";
  if (/\b(decoder|set\s*top|set_top|stb|box)\b/.test(haystack)) return "set_top_box";
  if (/\b(speaker|audio|sound|amplifier)\b/.test(haystack)) return "speaker";
  return "unknown_ir_appliance";
}

function canonicalIrCapability(profileKey: string, code: string) {
  const normalized = String(code || "").toLowerCase().replace(/[\s.-]+/g, "_");
  if (!normalized) return "";
  if (profileKey === "ac") {
    if (/^(power|power_on|poweron|power_off|poweroff|on|off)$/.test(normalized)) return "power";
    if (/^(t|temp|temperature|temp_set|set_temp)$/.test(normalized)) return "temperature";
    if (/^(m|mode|work_mode)$/.test(normalized)) return "mode";
    if (/^(f|fan|fan_speed|wind|wind_speed|windspeed)$/.test(normalized)) return "fan_speed";
    if (/swing|shake|oscillat/.test(normalized)) return "swing";
  }
  if (["tv", "decoder", "set_top_box", "projector", "speaker"].includes(profileKey)) {
    if (/^(power|power_on|poweron|power_off|poweroff|power_toggle)$/.test(normalized)) return "power";
    if (/^(volume_up|vol_up|vol\+|volume\+)$/.test(normalized)) return "volume_up";
    if (/^(volume_down|vol_down|vol-|volume-)$/.test(normalized)) return "volume_down";
    if (/^(channel_up|ch_up|ch\+|channel\+)$/.test(normalized)) return "channel_up";
    if (/^(channel_down|ch_down|ch-|channel-)$/.test(normalized)) return "channel_down";
    if (/mute/.test(normalized)) return "mute";
    if (/source|input/.test(normalized)) return "source";
    if (/^(ok|enter|select)$/.test(normalized)) return "ok";
    if (/^(up|down|left|right|home|back|return|menu)$/.test(normalized)) return normalized === "return" ? "back" : normalized;
    if (/play|pause/.test(normalized)) return "play_pause";
  }
  if (profileKey === "fan") {
    if (/power|on|off/.test(normalized)) return "power";
    if (/speed|fan|wind/.test(normalized)) return "fan_speed";
    if (/swing|oscillat/.test(normalized)) return "swing";
  }
  return normalized.length <= 2 ? "" : normalized;
}

function canonicalCapabilityCodesFromKeys(profileKey: string, keys: any[]) {
  return compactUnique(keys.map((item) => canonicalIrCapability(profileKey, normalizedKeyCode(item))));
}

function supportedControlsFromKeys(profileKey: string, keys: any[]) {
  const codes = canonicalCapabilityCodesFromKeys(profileKey, keys).map((code) => code.toLowerCase());
  const controls = new Set<string>();
  controls.add("remote");
  if (codes.some((code) => /power|on|off/.test(code))) controls.add("power");
  if (profileKey === "ac") {
    if (codes.some((code) => /temp|temperature/.test(code))) controls.add("temperature");
    if (codes.some((code) => /mode|cool|heat|dry|auto/.test(code))) controls.add("mode");
    if (codes.some((code) => /fan|wind/.test(code))) controls.add("fan_speed");
    if (codes.some((code) => /swing|oscillat/.test(code))) controls.add("swing");
  }
  if (profileKey === "tv" || profileKey === "decoder" || profileKey === "set_top_box" || profileKey === "projector") {
    if (codes.some((code) => /volume|vol[\+\-]/.test(code))) controls.add("volume");
    if (codes.some((code) => /channel|ch[\+\-]/.test(code))) controls.add("channel");
    if (codes.some((code) => /source|input/.test(code))) controls.add("source");
    if (codes.some((code) => /mute/.test(code))) controls.add("mute");
  }
  return Array.from(controls);
}

function providerProfileFromMetadata(hub: any, profileKey: string): ProviderIrProfile | null {
  if (!(profileKey in PROFILE_LIBRARY)) return null;
  const template = PROFILE_LIBRARY[profileKey as keyof typeof PROFILE_LIBRARY];
  const metadata = hub?.metadata || {};
  const raw = metadata?.raw || {};
  const source =
    metadata?.ir_profiles?.[profileKey] ||
    metadata?.provider_profiles?.[profileKey] ||
    raw?.ir_profiles?.[profileKey] ||
    raw?.provider_profiles?.[profileKey] ||
    {};
  const remoteId = clean(source?.remote_id || source?.id || source?.profile_id || source?.provider_profile_id) || null;
  const keys = Array.isArray(source?.keys) ? source.keys : Array.isArray(source?.supported_keys) ? source.supported_keys : [];
  const capabilityCodes = canonicalCapabilityCodesFromKeys(profileKey, keys);
  return {
    key: profileKey,
    appliance_type: template.appliance_type,
    label: clean(source?.name || source?.remote_name || template.label) || template.label,
    control_profile: template.control_profile,
    device_family: template.device_family,
    supported_controls: Array.from(new Set([...(template.supported_controls || []), ...supportedControlsFromKeys(profileKey, keys)])),
    capability_codes: capabilityCodes,
    remote_id: remoteId,
    remote_index: clean(source?.remote_index) || null,
    category_id: clean(source?.category_id) || null,
    brand_id: clean(source?.brand_id) || null,
    brand: clean(source?.brand || source?.brand_name) || null,
    model: clean(source?.model) || null,
    source: "metadata",
    raw: source,
    keys,
  };
}

function providerProfileFromTuyaRemote(remote: any, keys: any[]): ProviderIrProfile | null {
  const remoteId = clean(remote?.remote_id || remote?.id);
  if (!remoteId) return null;
  const profileKey = irProfileKeyFromRemote(remote);
  const template = PROFILE_LIBRARY[profileKey as keyof typeof PROFILE_LIBRARY] || PROFILE_LIBRARY.unknown_ir_appliance;
  const capabilityCodes = canonicalCapabilityCodesFromKeys(profileKey, keys);
  return {
    key: profileKey,
    appliance_type: template.appliance_type,
    label: clean(remote?.remote_name || remote?.name || template.label) || template.label,
    control_profile: template.control_profile,
    device_family: template.device_family,
    supported_controls: Array.from(new Set([...(template.supported_controls || []), ...supportedControlsFromKeys(profileKey, keys)])),
    capability_codes: capabilityCodes,
    remote_id: remoteId,
    remote_index: clean(remote?.remote_index) || null,
    category_id: clean(remote?.category_id || remote?.category) || null,
    brand_id: clean(remote?.brand_id) || null,
    brand: clean(remote?.brand_name || remote?.brand) || null,
    model: clean(remote?.model) || null,
    source: "provider",
    raw: remote && typeof remote === "object" ? remote : {},
    keys,
  };
}

async function loadProviderRemoteProfiles(hub: any): Promise<ProviderIrProfile[]> {
  const provider = cleanLower(hub?.provider || hub?.vendor || hub?.adapter);
  if (provider === "tuya" && clean(hub?.external_id)) {
    initAdaptersOnce();
    const adapter = adapterRegistry.get("tuya");
    if (adapter?.listIrRemotes) {
      const remotes = await adapter.listIrRemotes(clean(hub.external_id), {
        estateId: hub.estate_id,
        homeId: hub.home_id,
        device: hub,
      } as any);
      const profiles: ProviderIrProfile[] = [];
      for (const remote of remotes || []) {
        const remoteId = clean(remote?.remote_id || remote?.id);
        if (!remoteId) continue;
        let keys: any[] = [];
        if (adapter.listIrRemoteKeys) {
          try {
            keys = await adapter.listIrRemoteKeys(clean(hub.external_id), remoteId, {
              estateId: hub.estate_id,
              homeId: hub.home_id,
              device: hub,
            } as any);
          } catch (error: any) {
            logger.warn("tuya_ir_remote_keys_unavailable", {
              hub_id: hub.id,
              infrared_id: hub.external_id,
              remote_id: remoteId,
              message: error?.message || String(error),
            });
          }
        }
        const profile = providerProfileFromTuyaRemote(remote, keys);
        if (profile) profiles.push(profile);
      }
      if (profiles.length) return profiles;
    }
  }

  return providerProfiles(hub)
    .map((profileKey) => providerProfileFromMetadata(hub, profileKey))
    .filter(Boolean) as ProviderIrProfile[];
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
    return { profiles: [] as string[], available_profiles: [] as ProviderIrProfile[], appliances: [] as any[], changed: false };
  }

  const profiles = await loadProviderRemoteProfiles(hub);
  if (!profiles.length) {
    return {
      profiles: [],
      available_profiles: [],
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
  const existingByRemoteId = new Map<string, any>();
  const existingByExternalId = new Map<string, any>();
  for (const row of rows || []) {
    const key = String((row as any)?.metadata?.ir_appliance?.profile || "").toLowerCase();
    if (key) existingByProfile.set(key, row);
    const remoteId = clean((row as any)?.metadata?.ir_appliance?.remote_id);
    if (remoteId) existingByRemoteId.set(remoteId, row);
    const ext = clean((row as any)?.external_id);
    if (ext) existingByExternalId.set(ext, row);
  }

  let changed = false;
  const upsertedIds: string[] = [];
  for (const profile of profiles) {
    const profileKey = cleanLower(profile.key || profile.appliance_type || "unknown_ir_appliance") || "unknown_ir_appliance";
    const providerProfileId = profile.remote_id || profile.remote_index || null;
    const externalId = buildIrExternalId(hub, profileKey, providerProfileId);
    const metadata = {
      ...(hub.metadata || {}),
      virtual_device: true,
      control_profile: profile.control_profile,
      device_family: profile.device_family,
      supported_controls: profile.supported_controls,
      capability_codes: profile.capability_codes,
      ir_appliance: {
        profile: profileKey,
        profile_id: providerProfileId,
        remote_id: profile.remote_id,
        remote_index: profile.remote_index,
        category_id: profile.category_id,
        brand_id: profile.brand_id,
        appliance_type: profile.appliance_type,
        brand: profile.brand || clean(hub?.metadata?.brand) || clean(hub?.metadata?.raw?.brand) || null,
        model: profile.model || clean(hub?.metadata?.model) || clean(hub?.metadata?.raw?.model) || null,
        provider_profiles: profiles.map((item) => item.key),
        supported_keys: profile.keys || [],
        parent_hub_external_id: clean(hub?.external_id) || null,
        provider_remote: profile.raw || {},
      },
    };
    const payload = {
      estate_id: hub.estate_id,
      home_id: hub.home_id,
      room_id: hub.room_id,
      parent_device_id: hub.id,
      is_virtual: true,
      name: profile.label,
      type: profile.appliance_type,
      category: profile.appliance_type,
      adapter: hub.adapter,
      vendor: hub.vendor,
      provider: hub.provider,
      external_id: externalId,
      bind_state: hub.bind_state || (hub.room_id ? "room_bound" : hub.home_id ? "home_bound" : "estate_bound"),
      status: hub.online === false ? "offline" : "online",
      online: hub.online !== false,
      sync_state: hub.home_id ? "assigned" : "available_unassigned",
      is_managed_disabled: false,
      metadata,
    };

    const existing = (profile.remote_id ? existingByRemoteId.get(profile.remote_id) : null) || existingByExternalId.get(externalId) || existingByProfile.get(profileKey) || null;
    const finalPayload = existing?.id ? keepDeviceOverrides(existing, payload) : payload;
    const result = await upsertCanonicalDeviceIdentity(finalPayload);
    changed = changed || !existing?.id || clean(existing?.external_id) !== externalId;
    if (result.data?.id) upsertedIds.push(String(result.data.id));
  }

  return {
    profiles: profiles.map((profile) => profile.key),
    available_profiles: profiles,
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

    const synced = await syncIrChildAppliancesForHub(hub);
    const available_profiles = (synced.available_profiles || []).map((profile) => ({
      key: profile.key,
      appliance_type: profile.appliance_type,
      label: profile.label,
      control_profile: profile.control_profile,
      device_family: profile.device_family,
      supported_controls: profile.supported_controls,
      capability_codes: profile.capability_codes,
      remote_id: profile.remote_id,
      remote_index: profile.remote_index,
      category_id: profile.category_id,
      brand_id: profile.brand_id,
      brand: profile.brand,
      source: profile.source,
    }));
    const appliances = await loadChildAppliances(String(hub.id));
    return res.json({
      hub_id: hub.id,
      available_profiles,
      appliances,
      sync_required: available_profiles.length === 0,
      message: available_profiles.length
        ? "Remote profiles synced from the connected provider."
        : "The connected provider did not expose any configured remote profiles for this hub yet.",
    });
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
    if (!profileKey) return res.status(400).json({ error: "Add or sync an appliance profile before using this remote." });

    const hub = await resolveVisibleDevice(user, deviceId);
    if (!hub) return res.status(404).json({ error: "This device is not assigned to your current home." });
    if (!isIrHub(hub)) return res.status(400).json({ error: "Add or sync an appliance profile before using this remote." });
    const providerAvailable = await loadProviderRemoteProfiles(hub);
    const providerProfile = providerAvailable.find((profile) =>
      cleanLower(profile.key) === profileKey ||
      cleanLower(profile.appliance_type) === profileKey ||
      cleanLower(profile.remote_id) === profileKey
    );
    if (!providerProfile) {
      return res.status(400).json({ error: "Add or sync an appliance profile before using this remote." });
    }

    const label = clean(req.body?.label) || providerProfile.label;
    const brand = clean(req.body?.brand) || providerProfile.brand || "";
    const model = clean(req.body?.model) || providerProfile.model || "";
    const providerProfileId = providerProfile.remote_id || clean(req.body?.profile_id || req.body?.provider_profile_id || req.body?.remote_profile_id) || null;
    const externalId = buildIrExternalId(hub, providerProfile.key, providerProfileId);
    const metadata = {
      ...(hub.metadata || {}),
      virtual_device: true,
      control_profile: providerProfile.control_profile,
      device_family: providerProfile.device_family,
      supported_controls: providerProfile.supported_controls,
      capability_codes: providerProfile.capability_codes,
      ir_appliance: {
        profile: providerProfile.key,
        profile_id: providerProfileId,
        remote_id: providerProfile.remote_id,
        remote_index: providerProfile.remote_index,
        category_id: providerProfile.category_id,
        brand_id: providerProfile.brand_id,
        appliance_type: providerProfile.appliance_type,
        brand: brand || null,
        model: model || null,
        provider_profiles: providerAvailable.map((profile) => profile.key),
        supported_keys: providerProfile.keys || [],
        parent_hub_external_id: clean(hub?.external_id) || null,
        provider_remote: providerProfile.raw || {},
      },
    };

    const { data: rows, error: existingError } = await supabaseAdmin
      .from("devices")
      .select("id,name,home_id,room_id,bind_state,metadata,external_id")
      .eq("parent_device_id", hub.id)
      .eq("is_virtual", true);
    if (existingError) throw new Error(existingError.message);
    const existing = (rows || []).find((row: any) =>
      String(row?.metadata?.ir_appliance?.profile || "") === providerProfile.key ||
      clean(row?.metadata?.ir_appliance?.remote_id) === providerProfile.remote_id ||
      clean(row?.external_id) === externalId,
    );

    const payload = {
      estate_id: hub.estate_id,
      home_id: hub.home_id,
      room_id: hub.room_id,
      parent_device_id: hub.id,
      is_virtual: true,
      name: label,
      type: providerProfile.appliance_type,
      category: providerProfile.appliance_type,
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
