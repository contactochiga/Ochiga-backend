// src/controllers/deviceRegistryController.ts

import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitAuditEvent } from "../core/foundation";
import { emitSignal, makeBaseSignal } from "../realtime/emitSignal";
import { deviceReadScopeCache } from "../services/deviceReadScopeCache";
import { canFacilityViewDevice, projectDeviceForSurface } from "../services/deviceProjectionService";

/**
 * Expected "canonical" discovered device shape (from your adapters/types.ts)
 * We'll accept flexible payloads too, but normalize best-effort.
 */
function normalizeDiscoveredDevice(input: any) {
  const externalId = input?.externalId || input?.device_id || input?.devId || input?.id;
  if (!externalId) throw new Error("Missing externalId/device id in payload");

  return {
    external_id: String(externalId),
    adapter: String(input?.adapter || "unknown"),
    name: String(input?.name || input?.local_name || "Unnamed device"),
    category: String(input?.category || "unknown"),
    online: Boolean(input?.online ?? input?.isOnline ?? false),
    capabilities: Array.isArray(input?.capabilities) ? input.capabilities : [],
    protocols: Array.isArray(input?.protocols) ? input.protocols : [],
    metadata: input?.metadata ?? input?.raw ?? input ?? {},
  };
}

/**
 * GET /facility/devices
 * List registered devices for current estate
 */
export async function listRegisteredDevices(req: any, res: Response) {
  try {
    const estateId = req.user?.estate_id;
    if (!estateId) return res.status(400).json({ error: "User has no estate" });

    const { data, error } = await supabaseAdmin
      .from("devices")
      .select("*")
      .eq("estate_id", estateId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const devices = (data || [])
      .filter((device: any) => canFacilityViewDevice(device, req.user))
      .map((device: any) => projectDeviceForSurface(device, { actor: req.user, surface: "facility" }));

    return res.json({ estate_id: estateId, devices });
  } catch (err: any) {
    console.error("listRegisteredDevices error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}

/**
 * POST /facility/devices/register
 * Save a discovered device into our DB registry
 *
 * Body:
 * {
 *   device: DiscoveredDevice,
 *   home_id?: string,
 *   room_id?: string
 * }
 */
export async function registerDevice(req: any, res: Response) {
  try {
    const estateId = req.user?.estate_id;
    if (!estateId) return res.status(400).json({ error: "User has no estate" });

    const device = req.body?.device;
    if (!device) return res.status(400).json({ error: "Missing device in body" });

    const normalized = normalizeDiscoveredDevice(device);

    const home_id = req.body?.home_id || null;
    const room_id = req.body?.room_id || null;

    /**
     * We UPSERT by (estate_id + adapter + external_id)
     * Ensure you have a unique index in Supabase like:
     * unique(estate_id, adapter, external_id)
     */
    const payload = {
      estate_id: estateId,
      home_id,
      room_id,

      adapter: normalized.adapter,
      external_id: normalized.external_id,

      name: normalized.name,
      category: normalized.category,
      online: normalized.online,

      capabilities: normalized.capabilities,
      protocols: normalized.protocols,
      metadata: normalized.metadata,
      ownership_class: home_id ? "shared_home" : "building_managed",
      assignment_scope: home_id ? "home" : "estate",
      commissioning_status: home_id ? "assigned" : "discovered",
      visibility_policy: {},
      control_policy: {},
      critical_event_policy: {},
    };

    const { data, error } = await supabaseAdmin
      .from("devices")
      .upsert(payload, { onConflict: "estate_id,adapter,external_id" })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    deviceReadScopeCache.invalidate(String(data?.id || ""));
    void emitAuditEvent({
      actorId: req.user?.id,
      actorRole: req.user?.role,
      action: "device.registered",
      resourceType: "device",
      resourceId: data?.id,
      estateId,
      status: "success",
      metadata: { adapter: normalized.adapter, external_id: normalized.external_id, home_id, room_id },
      req,
    });

    return res.status(201).json({
      message: "Device registered",
      device: data,
    });
  } catch (err: any) {
    console.error("registerDevice error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}

/**
 * PATCH /facility/devices/:deviceId/assign
 * Assign registered device to a home/room
 *
 * Body:
 * {
 *   home_id?: string | null,
 *   room_id?: string | null
 * }
 */
export async function assignDevice(req: any, res: Response) {
  try {
    const estateId = req.user?.estate_id;
    if (!estateId) return res.status(400).json({ error: "User has no estate" });

    const { deviceId } = req.params;
    const body = req.body || {};
    const hasHome = Object.prototype.hasOwnProperty.call(body, "home_id");
    const hasRoom = Object.prototype.hasOwnProperty.call(body, "room_id");
    const home_id = hasHome ? body.home_id || null : undefined;
    const room_id = hasRoom ? body.room_id || null : undefined;

    const { data: current, error: currentError } = await supabaseAdmin
      .from("devices")
      .select("id,estate_id,home_id,room_id,ownership_class")
      .eq("id", deviceId)
      .eq("estate_id", estateId)
      .maybeSingle();
    if (currentError) return res.status(400).json({ error: currentError.message });
    if (!current?.id) return res.status(404).json({ error: "Device not found in this estate" });

    const targetHomeId = hasHome ? home_id : current.home_id;
    if (targetHomeId) {
      const { data: home, error: homeError } = await supabaseAdmin
        .from("homes")
        .select("id")
        .eq("id", targetHomeId)
        .eq("estate_id", estateId)
        .maybeSingle();
      if (homeError) return res.status(400).json({ error: homeError.message });
      if (!home?.id) return res.status(400).json({ error: "Home is not available in this estate" });
    }

    if (room_id) {
      if (!targetHomeId) return res.status(400).json({ error: "Assign a home before assigning a room" });
      const { data: room, error: roomError } = await supabaseAdmin
        .from("rooms")
        .select("id")
        .eq("id", room_id)
        .eq("estate_id", estateId)
        .eq("home_id", targetHomeId)
        .maybeSingle();
      if (roomError) return res.status(400).json({ error: roomError.message });
      if (!room?.id) return res.status(400).json({ error: "Room is not available in the selected home" });
    }

    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    if (hasHome) update.home_id = home_id;
    if (hasRoom) update.room_id = room_id;
    if (hasHome && !home_id) update.room_id = null;
    const nextHomeId = hasHome ? home_id : current.home_id;
    const nextRoomId = hasHome && !home_id ? null : hasRoom ? room_id : current.room_id;
    update.bind_state = nextRoomId ? "room_bound" : nextHomeId ? "home_bound" : "discovered";
    update.sync_state = nextHomeId ? "assigned" : "available_unassigned";
    update.assignment_scope = nextHomeId ? "home" : "estate";
    update.commissioning_status = nextHomeId ? "assigned" : "discovered";
    update.ownership_class = body.ownership_class || (nextHomeId ? current?.ownership_class || "shared_home" : "building_managed");

    const { data, error } = await supabaseAdmin
      .from("devices")
      .update(update)
      .eq("id", deviceId)
      .eq("estate_id", estateId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    deviceReadScopeCache.invalidate(String(data?.id || deviceId));
    void emitAuditEvent({
      actorId: req.user?.id,
      actorRole: req.user?.role,
      action: "device.assigned",
      resourceType: "device",
      resourceId: data?.id || deviceId,
      estateId,
      status: "success",
      metadata: { home_id, room_id },
      req,
    });
    emitSignal(makeBaseSignal({
      type: "device.registry.updated",
      source: "facility",
      estateId,
      homeId: data?.home_id || undefined,
      roomId: data?.room_id || undefined,
      deviceId: data?.id || deviceId,
      status: data?.status,
      metadata: { assignment_changed: true, home_id: data?.home_id || null, room_id: data?.room_id || null },
    } as any));

    return res.json({
      message: "Device assigned",
      device: data,
    });
  } catch (err: any) {
    console.error("assignDevice error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
