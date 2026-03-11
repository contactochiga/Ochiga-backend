// src/controllers/deviceEstateController.ts
import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

export async function getEstateDevices(req: Request, res: Response) {
  try {
    const user: any = (req as any).user;
    const estateIdParam = String(req.params.estateId || "").trim();

    if (!user?.estate_id) return res.status(400).json({ error: "User has no estate" });

    // ✅ enforce: only your estate
    if (user.estate_id !== estateIdParam) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let query = supabaseAdmin
      .from("devices")
      .select(
        `
        id,
        estate_id,
        home_id,
        room_id,
        name,
        type,
        external_id,
        status,
        vendor,
        icon,
        metadata,
        rooms:rooms ( id, name )
      `
      )
      .eq("estate_id", user.estate_id);

    // Residents/members should only see devices in their own home.
    const role = String(user.role || "").toLowerCase();
    const isEstateWide = role === "admin" || role === "manager" || role === "estate_admin";
    if (!isEstateWide && user.home_id) {
      query = query.eq("home_id", user.home_id);
    }

    const { data, error } = await query.order("updated_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const devices = (data || []).map((d: any) => ({
      ...d,
      // ✅ make room compatible with frontend pickRoom()
      room: d.rooms ? { id: d.rooms.id, name: d.rooms.name } : null,
      room_name: d.rooms?.name ?? null,
    }));

    return res.json({ devices });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch estate devices" });
  }
}
