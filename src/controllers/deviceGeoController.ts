// src/controllers/deviceGeoController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { io } from "../server";
import { calculateDistance } from "../utils/geoMath";

/**
 * Update device location (same as before) — plus maintain geog column if PostGIS available.
 */
export async function updateDeviceLocation(req: Request, res: Response) {
  try {
    const { deviceId } = req.params;
    const { lat, lng, installationPoint } = req.body;

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "lat and lng required" });
    }

    // update lat/lng fields
    const { data, error } = await supabaseAdmin
      .from("devices")
      .update({
        latitude: Number(lat),
        longitude: Number(lng),
        installation_point: installationPoint || null,
        last_location_update: new Date().toISOString(),
        // also update raw geog field if present (Supabase will ignore unknown columns)
        geog: `SRID=4326;POINT(${Number(lng)} ${Number(lat)})`,
      })
      .eq("id", deviceId)
      .select()
      .single();

    if (error) {
      console.error("Supabase update device location error:", error);
      return res.status(500).json({ error: error.message || "Update failed" });
    }

    // Try emitting via socket
    try {
      io.emit("device:location:update", {
        id: deviceId,
        lat: Number(lat),
        lng: Number(lng),
        installationPoint,
      });
    } catch (e) {
      console.warn("socket emit failed:", e);
    }

    // ensure returned object contains message to avoid typed-access errors elsewhere
    return res.json({ message: "Device location updated", device: (data as any) || null });
  } catch (err: any) {
    console.error("updateDeviceLocation error", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

/**
 * Get devices near a point. Uses PostGIS RPC 'devices_near' when available.
 * Fallback: fetch all devices and compute distances in JS.
 */
export async function getDevicesNearPoint(req: Request, res: Response) {
  try {
    const { lat, lng, radius = 100 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: "lat & lng required" });
    }

    // 1) Try calling PostGIS helper function via RPC
    try {
      const rpcName = "devices_near";
      const pLat = Number(lat);
      const pLng = Number(lng);
      const pRadius = Number(radius);

      // Supabase RPC: pass positional parameters as object keys
      const { data, error } = await supabaseAdmin.rpc(rpcName, {
        p_lat: pLat,
        p_lng: pLng,
        p_radius_meters: pRadius,
      });

      if (!error && data) {
        return res.json(data);
      }
      console.warn("devices_near rpc returned error or no data:", error);
    } catch (rpcErr) {
      console.warn("devices_near rpc failed, falling back to JS filter:", (rpcErr as any)?.message || rpcErr);
    }

    // 2) Fallback: fetch all devices and compute distances in JS
    const { data: allDevices, error: allErr } = await supabaseAdmin
      .from("devices")
      .select("*");

    if (allErr) {
      console.error("Supabase devices fetch error:", allErr);
      return res.status(500).json({ error: allErr.message || "Failed to fetch devices" });
    }

    const filtered = (allDevices || [])
      .filter((d: any) => d.latitude !== null && d.longitude !== null)
      .map((d: any) => ({
        ...d,
        distance: calculateDistance(
          Number(lat),
          Number(lng),
          Number(d.latitude),
          Number(d.longitude)
        ),
      }))
      .filter((d: any) => d.distance <= Number(radius))
      .sort((a: any, b: any) => a.distance - b.distance);

    return res.json(filtered);
  } catch (err: any) {
    console.error("getDevicesNearPoint error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
