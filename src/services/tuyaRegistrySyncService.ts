import type { Request } from "express";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import { adapterRegistry } from "../device/adapters/registry";
import type { AdapterContext } from "../device/adapters/types";
import { emitAuditEvent } from "../core/foundation";
import { emitSignal, makeBaseSignal } from "../realtime/emitSignal";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { syncIrChildAppliancesForHub } from "../controllers/deviceIrController";
import { logger } from "../observability/logger";
import { keepDeviceOverrides, upsertCanonicalDeviceIdentity } from "./deviceIdentityService";

type TuyaSyncActor = {
  id: string;
  email?: string;
  role?: string;
  estate_id?: string;
  home_id?: string;
};

export type TuyaSyncSummary = {
  ok: true;
  provider: "tuya";
  synced_at: string;
  discovered: number;
  added: number;
  updated: number;
  unchanged: number;
  unavailable: number;
  errors: string[];
};

function cleanStr(value: any) {
  return String(value ?? "").trim();
}

function externalIdFor(device: any) {
  return cleanStr(device?.externalId || device?.external_id || device?.dev_id || device?.device_id || device?.id || device?.uuid);
}

function hasResidentAlias(row: any) {
  const metadata = row?.metadata || {};
  return Boolean(metadata?.resident_alias || metadata?.custom_alias || metadata?.alias || metadata?.oyi?.resident_alias);
}

function linkedToActor(row: any, actor: TuyaSyncActor) {
  const metadata = row?.metadata || {};
  return (
    cleanStr(metadata?.oyi?.integration_owner_user_id) === cleanStr(actor.id) ||
    cleanStr(metadata?.context?.userId) === cleanStr(actor.id)
  );
}

function comparable(row: any) {
  return JSON.stringify({
    name: row?.name || null,
    type: row?.type || null,
    category: row?.category || null,
    status: row?.status || null,
    online: Boolean(row?.online),
    capabilities: row?.capabilities || [],
    protocols: row?.protocols || [],
    icon: row?.icon || null,
    provider_name: row?.metadata?.oyi?.provider_name || null,
    provider_available: row?.metadata?.oyi?.provider_available !== false,
  });
}

async function audit(actor: TuyaSyncActor, action: string, status: "success" | "failed", metadata: Record<string, any>, req?: Request, resourceId = "tuya") {
  await emitAuditEvent({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role || "resident",
    action,
    resourceType: action.includes(".device.") ? "device" : "integration",
    resourceId,
    estateId: actor.estate_id,
    homeId: actor.home_id,
    status,
    metadata,
    req,
  });
}

function emitRegistrySignals(actor: TuyaSyncActor, device: any, kind: "added" | "updated" | "unavailable") {
  const base = {
    source: "device",
    estateId: actor.estate_id,
    homeId: device?.home_id || undefined,
    roomId: device?.room_id || undefined,
    deviceId: device?.id,
    status: device?.status,
    metadata: {
      provider: "tuya",
      external_id: device?.external_id,
      registry_change: kind,
      assigned: Boolean(device?.home_id),
    },
  };
  emitSignal(makeBaseSignal({ ...base, type: "device.registry.updated" } as any));
  if (kind === "added") emitSignal(makeBaseSignal({ ...base, type: "device.discovered" } as any));
  emitSignal(makeBaseSignal({ ...base, type: "device.status.updated" } as any));
}

export async function getTuyaUidForUser(userId: string): Promise<string | null> {
  const direct = await supabaseAdmin.from("users").select("tuya_uid").eq("id", userId).maybeSingle();
  if (!direct.error) {
    const uid = cleanStr((direct.data as any)?.tuya_uid);
    if (uid) return uid;
  }

  const integration = await supabaseAdmin
    .from("user_integrations")
    .select("external_user_id")
    .eq("user_id", userId)
    .eq("provider", "tuya")
    .maybeSingle();
  if (!integration.error) {
    const uid = cleanStr((integration.data as any)?.external_user_id);
    if (uid) return uid;
  }
  return null;
}

export async function syncTuyaRegistryForActor(actor: TuyaSyncActor, req?: Request): Promise<TuyaSyncSummary> {
  if (!actor?.id) throw new Error("Not authenticated");
  if (!actor.estate_id) throw new Error("User has no estate context");

  const syncedAt = new Date().toISOString();
  const tuyaUid = await getTuyaUidForUser(actor.id);
  if (!tuyaUid) throw new Error("Tuya / Smart Life is not linked for this account.");
  if (!process.env.TUYA_ACCESS_ID || !process.env.TUYA_ACCESS_SECRET) {
    throw new Error("Tuya backend credentials are missing.");
  }

  await audit(actor, "integration.tuya.sync.started", "success", { provider: "tuya" }, req);

  try {
    initAdaptersOnce();
    const adapter = adapterRegistry.get("tuya");
    if (!adapter) throw new Error("Tuya adapter not registered");

    const context: AdapterContext = {
      estateId: actor.estate_id,
      homeId: actor.home_id,
      userId: actor.id,
      credentials: {
        apiKey: process.env.TUYA_ACCESS_ID,
        apiSecret: process.env.TUYA_ACCESS_SECRET,
        tuyaUid,
      },
    };
    const discovered = await adapter.discover(context);
    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from("devices")
      .select("*")
      .eq("estate_id", actor.estate_id)
      .or("vendor.eq.tuya,adapter.eq.tuya,provider.eq.tuya");
    if (existingError) throw new Error(existingError.message);

    const existingByExternal = new Map((existingRows || []).map((row: any) => [cleanStr(row.external_id), row]));
    const providerIds = new Set<string>();
    const errors: string[] = [];
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let unavailable = 0;

    for (const discoveredDevice of discovered) {
      const externalId = externalIdFor(discoveredDevice);
      if (!externalId) {
        errors.push("Skipped a Tuya device without a stable provider ID.");
        continue;
      }
      providerIds.add(externalId);
      const existing = existingByExternal.get(externalId);
      const providerName = cleanStr(discoveredDevice?.name) || "Device";
      const online = Boolean(discoveredDevice?.online);
      const metadata = {
        ...(existing?.metadata || {}),
        ...(discoveredDevice?.metadata || {}),
        oyi: {
          ...(existing?.metadata?.oyi || {}),
          integration_owner_user_id: actor.id,
          provider_name: providerName,
          provider_available: true,
          provider_last_synced_at: syncedAt,
        },
      };
      const row = {
        estate_id: actor.estate_id,
        home_id: existing?.home_id || null,
        room_id: existing?.room_id || null,
        name: existing && (hasResidentAlias(existing) || existing.home_id) ? existing.name : providerName,
        type: cleanStr((discoveredDevice as any)?.type || discoveredDevice?.category) || existing?.type || "device",
        category: cleanStr(discoveredDevice?.category) || existing?.category || "unknown",
        adapter: "tuya",
        provider: "tuya",
        vendor: "tuya",
        external_id: externalId,
        bind_state: existing?.bind_state || "discovered",
        status: online ? "online" : "offline",
        online,
        capabilities: Array.isArray(discoveredDevice?.capabilities) ? discoveredDevice.capabilities : [],
        protocols: Array.isArray(discoveredDevice?.protocols) ? discoveredDevice.protocols : [],
        icon: cleanStr((discoveredDevice as any)?.icon || (discoveredDevice?.metadata as any)?.icon) || existing?.icon || null,
        sync_state: existing?.home_id ? "assigned" : "available_unassigned",
        last_seen_at: online ? syncedAt : existing?.last_seen_at || null,
        last_event_at: syncedAt,
        metadata,
        updated_at: syncedAt,
      };

      if (!existing) {
        let data: any = null;
        let error: any = null;
        try {
          const result = await upsertCanonicalDeviceIdentity(keepDeviceOverrides(null, row));
          data = result.data;
        } catch (nextError: any) {
          error = nextError;
        }
        if (error) {
          errors.push(`${providerName}: ${error.message}`);
          continue;
        }
        added += 1;
        await audit(actor, "integration.tuya.device.added", "success", { external_id: externalId, assigned: false }, req, data.id);
        emitRegistrySignals(actor, data, "added");
        continue;
      }

      if (comparable(existing) === comparable(row)) {
        unchanged += 1;
      } else {
        updated += 1;
      }
      let data: any = null;
      let error: any = null;
      try {
        const result = await upsertCanonicalDeviceIdentity(keepDeviceOverrides(existing, { ...existing, ...row }));
        data = result.data;
      } catch (nextError: any) {
        error = nextError;
      }
      if (error) {
        errors.push(`${providerName}: ${error.message}`);
        continue;
      }
      if (comparable(existing) !== comparable(row)) {
        await audit(actor, "integration.tuya.device.updated", "success", { external_id: externalId, assigned: Boolean(data.home_id) }, req, data.id);
        emitRegistrySignals(actor, data, "updated");
      }
    }

    for (const existing of existingRows || []) {
      const externalId = cleanStr((existing as any).external_id);
      if (!externalId || providerIds.has(externalId) || !linkedToActor(existing, actor)) continue;
      const metadata = {
        ...((existing as any).metadata || {}),
        oyi: {
          ...((existing as any).metadata?.oyi || {}),
          provider_available: false,
          provider_last_synced_at: syncedAt,
          provider_unavailable_at: syncedAt,
        },
      };
      const { data, error } = await supabaseAdmin
        .from("devices")
        .update({ status: "unavailable", online: false, sync_state: "unavailable", last_event_at: syncedAt, metadata, updated_at: syncedAt } as any)
        .eq("id", (existing as any).id)
        .select("*")
        .single();
      if (error) {
        errors.push(`${(existing as any).name || externalId}: ${error.message}`);
        continue;
      }
      unavailable += 1;
      await audit(actor, "integration.tuya.device.unavailable", "success", { external_id: externalId }, req, data.id);
      emitRegistrySignals(actor, data, "unavailable");
    }

    const currentRows = await supabaseAdmin
      .from("devices")
      .select("*")
      .eq("estate_id", actor.estate_id)
      .or("vendor.eq.tuya,adapter.eq.tuya,provider.eq.tuya");
    if (!currentRows.error) {
      const hubs = (currentRows.data || []).filter((device: any) => {
        const haystack = [device?.category, device?.type, device?.name, device?.metadata?.remote_type, device?.metadata?.ir_profile]
          .map((item) => String(item || "").toLowerCase())
          .join(" ");
        return /ir|infrared|remote|universal_remote|tv_remote|set_top|stb/.test(haystack);
      });
      for (const hub of hubs) {
        try {
          await syncIrChildAppliancesForHub(hub);
        } catch (error: any) {
          logger.warn("tuya_registry_ir_sync_failed", {
            estate_id: actor.estate_id,
            hub_id: hub?.id || null,
            external_id: hub?.external_id || null,
            error: error?.message || "ir_sync_failed",
          });
          errors.push(`${cleanStr(hub?.name) || "IR hub"}: IR sync unavailable`);
        }
      }
    }

    const result: TuyaSyncSummary = {
      ok: true,
      provider: "tuya",
      synced_at: syncedAt,
      discovered: discovered.length,
      added,
      updated,
      unchanged,
      unavailable,
      errors,
    };
    await audit(actor, "integration.tuya.sync.completed", errors.length ? "failed" : "success", result, req);
    return result;
  } catch (error: any) {
    await audit(actor, "integration.tuya.sync.completed", "failed", { provider: "tuya", error: error?.message || "Tuya sync failed" }, req);
    throw error;
  }
}

// Safe scheduler foundation: a worker may call this with hydrated linked actors.
export async function syncTuyaRegistryBatch(actors: TuyaSyncActor[]) {
  return Promise.allSettled(actors.map((actor) => syncTuyaRegistryForActor(actor)));
}
