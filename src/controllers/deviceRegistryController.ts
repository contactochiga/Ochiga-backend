// src/controllers/deviceRegistryController.ts

import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

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

    return res.json({ estate_id: estateId, devices: data || [] });
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
    };

    const { data, error } = await supabaseAdmin
      .from("devices")
      .upsert(payload, { onConflict: "estate_id,adapter,external_id" })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

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
    const { home_id, room_id } = req.body || {};

    const { data, error } = await supabaseAdmin
      .from("devices")
      .update({
        home_id: home_id ?? undefined,
        room_id: room_id ?? undefined,
      })
      .eq("id", deviceId)
      .eq("estate_id", estateId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    return res.json({
      message: "Device assigned",
      device: data,
    });
  } catch (err: any) {
    console.error("assignDevice error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
