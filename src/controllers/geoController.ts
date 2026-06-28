// src/controllers/geoController.ts

import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { getIO } from "../realtime/io";
import { calculateDistance } from "../utils/geoMath";
import { notifyUser, NotificationPayload } from "../services/NotificationService";

function isDeviceActive(status: any) {
  if (!status || typeof status !== "object") return false;
  const directKeys = ["switch", "power", "on", "running", "enabled"];
  for (const key of directKeys) {
    if (status[key] === true) return true;
  }

  return Object.entries(status).some(([key, value]) => {
    if (!/^switch(_\d+)?$/i.test(String(key))) return false;
    return value === true;
  });
}

async function recentGeoAlertExists(userId: string, deviceId: string) {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id, created_at")
    .eq("user_id", userId)
    .eq("type", "device")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return false;
  return (data || []).some((row: any) => String(row?.payload?.device_id || "") === String(deviceId));
}

/* ---------------------------------------------------------
   UPDATE DEVICE LOCATION
--------------------------------------------------------- */
export async function updateDeviceLocation(req: Request, res: Response) {
  try {
    const { deviceId } = req.params;
    const { lat, lng, installationPoint } = req.body;
    if (lat === undefined || lng === undefined)
      return res.status(400).json({ error: "lat and lng required" });

    const { data, error } = await supabaseAdmin
      .from("devices")
      .update({
        latitude: Number(lat),
        longitude: Number(lng),
        installation_point: installationPoint || null,
        last_location_update: new Date().toISOString(),
        geog: `SRID=4326;POINT(${Number(lng)} ${Number(lat)})`,
      })
      .eq("id", deviceId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    getIO()?.emit("device:location:update", {
      id: deviceId,
      lat: Number(lat),
      lng: Number(lng),
      installationPoint,
    });

    // Notify owner
    if (data?.owner_id) {
      const payload: NotificationPayload = {
        title: "Device Location Updated",  // ✅ Added title
        type: "device",
        entityId: deviceId,
        message: `Device "${data.name}" location updated.`,
        payload: { lat, lng, installationPoint }, // ✅ Use `payload` instead of `data`
      };
      await notifyUser(data.owner_id, payload);
    }

    return res.json({ message: "Device location updated", device: data });
  } catch (err: any) {
    console.error("updateDeviceLocation error", err);
    return res.status(500).json({ error: err.message });
  }
}

/* ---------------------------------------------------------
   UPDATE VISITOR LOCATION
--------------------------------------------------------- */
export async function updateVisitorLocation(req: Request, res: Response) {
  try {
    const { visitorId } = req.params;
    const { lat, lng } = req.body;

    if (lat === undefined || lng === undefined)
      return res.status(400).json({ error: "lat and lng required" });

    const { data, error } = await supabaseAdmin
      .from("visitors")
      .update({
        latitude: Number(lat),
        longitude: Number(lng),
        last_location_update: new Date().toISOString(),
        geog: `SRID=4326;POINT(${Number(lng)} ${Number(lat)})`,
      })
      .eq("id", visitorId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    getIO()?.emit("visitor:location:update", {
      id: visitorId,
      lat: Number(lat),
      lng: Number(lng),
    });

    return res.json({ message: "Visitor location updated", visitor: data });
  } catch (err: any) {
    console.error("updateVisitorLocation error", err);
    return res.status(500).json({ error: err.message });
  }
}

/* ---------------------------------------------------------
   SET ESTATE BOUNDARY
--------------------------------------------------------- */
export async function setEstateBoundary(req: Request, res: Response) {
  try {
    const { estateId } = req.params;
    const { boundary } = req.body; // array of [lat, lng]

    if (!Array.isArray(boundary))
      return res.status(400).json({ error: "boundary must be an array" });

    const { data, error } = await supabaseAdmin
      .from("estates")
      .update({
        boundary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", estateId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      message: "Estate boundary updated successfully",
      estate: data,
    });
  } catch (err: any) {
    console.error("setEstateBoundary error", err);
    return res.status(500).json({ error: err.message });
  }
}

/* ---------------------------------------------------------
   GET ESTATE BOUNDARY
--------------------------------------------------------- */
export async function getEstateBoundary(req: Request, res: Response) {
  try {
    const { estateId } = req.params;

    const { data, error } = await supabaseAdmin
      .from("estates")
      .select("id, name, boundary")
      .eq("id", estateId)
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json(data);
  } catch (err: any) {
    console.error("getEstateBoundary error", err);
    return res.status(500).json({ error: err.message });
  }
}

/* ---------------------------------------------------------
   EVALUATE USER GEO / DEVICE ENERGY ALERTS
--------------------------------------------------------- */
export async function evaluateGeoAlerts(req: Request, res: Response) {
  try {
    const user = req.user as any;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
    if (!user?.home_id) return res.status(400).json({ error: "No home linked to this account" });

    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const radiusMeters = Math.max(25, Math.min(1000, Number(req.body?.radius_meters || 120)));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const { data: devices, error: devicesErr } = await supabaseAdmin
      .from("devices")
      .select("id,name,category,home_id,estate_id,latitude,longitude")
      .eq("home_id", user.home_id)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(100);

    if (devicesErr) return res.status(500).json({ error: devicesErr.message });

    const deviceIds = (devices || []).map((d: any) => String(d.id));
    if (!deviceIds.length) {
      return res.json({ ok: true, evaluated: 0, alerts: [] });
    }

    const { data: states, error: statesErr } = await supabaseAdmin
      .from("device_states")
      .select("device_id,status,last_seen")
      .in("device_id", deviceIds);

    if (statesErr) return res.status(500).json({ error: statesErr.message });

    const stateMap = new Map<string, any>(
      (states || []).map((row: any) => [String(row.device_id), row.status || {}])
    );

    const alerts: Array<{ device_id: string; name: string; distance_m: number }> = [];

    for (const device of devices || []) {
      const dLat = Number((device as any).latitude);
      const dLng = Number((device as any).longitude);
      if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) continue;

      const distance = calculateDistance(lat, lng, dLat, dLng);
      if (distance <= radiusMeters) continue;

      const state = stateMap.get(String((device as any).id));
      if (!isDeviceActive(state)) continue;

      const alreadySent = await recentGeoAlertExists(user.id, String((device as any).id));
      if (alreadySent) continue;

      const payload: NotificationPayload = {
        title: "Device still on",
        type: "device",
        entityId: String((device as any).id),
        message: `${String((device as any).name || "A device")} appears to be active while you are away from home.`,
        payload: {
          kind: "geo.device_left_on",
          device_id: String((device as any).id),
          distance_meters: Math.round(distance),
          home_id: user.home_id,
        },
      };
      await notifyUser(String(user.id), payload);
      alerts.push({
        device_id: String((device as any).id),
        name: String((device as any).name || "Device"),
        distance_m: Math.round(distance),
      });
    }

    return res.json({
      ok: true,
      evaluated: deviceIds.length,
      alerts,
    });
  } catch (err: any) {
    console.error("evaluateGeoAlerts error", err);
    return res.status(500).json({ error: err.message || "Failed to evaluate geo alerts" });
  }
}
