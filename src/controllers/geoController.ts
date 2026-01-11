// src/controllers/geoController.ts

import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { io } from "../server";
import { calculateDistance } from "../utils/geoMath";
import { notifyUser, NotificationPayload } from "../services/NotificationService";

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

    io.emit("device:location:update", {
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

    io.emit("visitor:location:update", {
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
