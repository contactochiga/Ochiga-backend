import { supabaseAdmin } from "../supabase/supabaseClient";
import { createPublicApiError } from "./publicApi";

function clean(value: unknown) {
  return String(value || "").trim();
}

function cleanLower(value: unknown) {
  return clean(value).toLowerCase();
}

export function buildIrExternalId(hub: any, profileKey: string, profileId?: string | null) {
  const hubExternalId = clean(hub?.external_id);
  const suffix = cleanLower(profileId || profileKey || "remote").replace(/[^a-z0-9:_-]+/g, "_");
  if (!hubExternalId) {
    throw createPublicApiError(503, "device_sync_failed", "Connected-device synchronization is temporarily unavailable.");
  }
  return `${hubExternalId}:ir:${suffix}`;
}

export function keepDeviceOverrides(existing: any, payload: Record<string, any>) {
  if (!existing) return payload;
  const existingMetadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
  const payloadMetadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const channelNames = existingMetadata?.channel_names || existingMetadata?.channelNames || null;
  return {
    ...payload,
    name: clean(existing?.name) || clean(payload.name),
    room_id: existing?.room_id || payload.room_id || null,
    home_id: existing?.home_id || payload.home_id || null,
    bind_state: existing?.bind_state || payload.bind_state,
    metadata: {
      ...payloadMetadata,
      visibility: existingMetadata?.visibility ?? payloadMetadata?.visibility ?? null,
      resident_alias: existingMetadata?.resident_alias ?? payloadMetadata?.resident_alias ?? null,
      custom_alias: existingMetadata?.custom_alias ?? payloadMetadata?.custom_alias ?? null,
      channel_names: channelNames ?? payloadMetadata?.channel_names ?? null,
    },
  };
}

export async function upsertCanonicalDeviceIdentity(payload: Record<string, any>) {
  const attempts = ["vendor,external_id", "estate_id,adapter,external_id"] as const;
  let lastError: any = null;
  for (const onConflict of attempts) {
    const result = await supabaseAdmin
      .from("devices")
      .upsert(payload as any, { onConflict })
      .select("*")
      .single();
    if (!result.error) return result;
    lastError = result.error;
    const message = String(result.error?.message || "").toLowerCase();
    if (!/no unique|constraint|conflict|duplicate key/i.test(message)) break;
  }
  throw lastError || new Error("device_identity_upsert_failed");
}
