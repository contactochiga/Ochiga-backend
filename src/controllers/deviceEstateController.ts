// src/controllers/deviceEstateController.ts
import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

export async function getEstateDevices(req: Request, res: Response) {
  try {
    const user: any = (req as any).user;
    const estateIdParam = String(req.params.estateId || "").trim();

    if (!user?.estate_id) return res.status(400).json({ error: "User has no estate" });

    // ✅ enforce scope: user can only fetch their own estate devices
    if (user.estate_id !== estateIdParam) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data, error } = await supabaseAdmin
      .from("devices")
      .select(`
        id,
        estate_id,
        home_id,
        room_id,
        name,
        type,
        external_id,
        status,
        vendor,
        adapter,
        icon,
        metadata,
        room:rooms ( id, name )
      `)
      .eq("estate_id", user.estate_id)
      .order("updated_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // ✅ return array (frontend expects array)
    return res.json((data || []).map((d: any) => ({
      ...d,
      // make room shape compatible with your frontend pickRoom()
      room: d.room ?? null,
      room_name: d.room?.name ?? null,
    })));
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch estate devices" });
  }
}
