import { supabaseAdmin } from "../supabase/supabaseClient";

function clean(value: unknown) {
  return String(value || "").trim();
}

function lower(value: unknown) {
  return clean(value).toLowerCase();
}

function providerKey(device: any) {
  return lower(device?.provider || device?.vendor || device?.adapter);
}

function rawCategory(device: any) {
  return lower(device?.metadata?.raw?.category || device?.metadata?.category || device?.category || device?.type);
}

export function isTuyaDevice(device: any) {
  return providerKey(device) === "tuya";
}

export function isTuyaProviderVirtualRemote(device: any) {
  if (!isTuyaDevice(device) || Boolean(device?.is_virtual)) return false;
  return ["infrared_tv", "infrared_ac", "infrared_fan", "infrared_stb", "infrared_projector"].includes(rawCategory(device));
}

export function isTuyaIrHub(device: any) {
  if (!isTuyaDevice(device) || Boolean(device?.is_virtual)) return false;
  const text = [
    device?.metadata?.control_profile,
    device?.metadata?.device_family,
    device?.metadata?.raw?.category,
    device?.category,
    device?.type,
    device?.name,
  ].map(lower).join(" ");
  return /\b(ir_remote|wnykq|infrared|universal_remote|remote_control)\b/.test(text);
}

export function isObsoleteIrChild(device: any) {
  if (!isTuyaDevice(device) || !device?.is_virtual) return false;
  const externalId = clean(device?.external_id);
  const appliance = device?.metadata?.ir_appliance || {};
  const remoteId = clean(appliance?.remote_id || appliance?.profile_id);
  return externalId.includes(":ir:") && !remoteId;
}

export function isTechnicalDeviceHiddenFromResidents(device: any, options: { parentHasIrChildren?: boolean } = {}) {
  if (device?.is_managed_disabled === true) return true;
  if (isTuyaProviderVirtualRemote(device)) return true;
  if (isObsoleteIrChild(device)) return true;
  if (options.parentHasIrChildren && isTuyaIrHub(device)) return true;
  return false;
}

export function markTechnicalProviderRemoteMetadata(metadata: any, reason: string) {
  return {
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    visibility: "technical",
    resident_visible: false,
    provider_virtual_remote: true,
    hidden_reason: reason,
  };
}

export async function resolveCanonicalIrChildForProviderRemote(device: any) {
  if (!isTuyaProviderVirtualRemote(device)) return null;
  const remoteId = clean(device?.external_id);
  const estateId = clean(device?.estate_id);
  const homeId = clean(device?.home_id);
  if (!remoteId || !estateId) return null;

  let query = supabaseAdmin
    .from("devices")
    .select("*")
    .eq("estate_id", estateId)
    .eq("is_virtual", true)
    .eq("metadata->ir_appliance->>remote_id", remoteId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (homeId) query = query.eq("home_id", homeId);

  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : null;
}
