// src/controllers/deviceEstateController.ts
import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

function cleanText(value: any, fallback: string | null = null) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function sanitizeMetadata(value: any, depth = 0): any {
  if (value == null || depth > 4) return {};
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeMetadata(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(pass(word)?|secret|token|credential|access[_-]?id|access[_-]?secret|api[_-]?key|private[_-]?key)/i.test(key))
      .map(([key, nested]) => [key, nested && typeof nested === "object" ? sanitizeMetadata(nested, depth + 1) : nested])
  );
}

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
        category,
        external_id,
        status,
        online,
        vendor,
        provider,
        adapter,
        sync_state,
        bind_state,
        is_managed_disabled,
        last_seen_at,
        icon,
        capabilities,
        protocols,
        metadata,
        rooms:rooms ( id, name )
      `
      )
      .eq("estate_id", user.estate_id);

    // Residents/members should only see devices assigned to their active home.
    // Registry enrollment may additionally expose eligible, estate-scoped unassigned devices.
    const role = String(user.role || "").toLowerCase();
    const isEstateWide = role === "admin" || role === "manager" || role === "estate_admin";
    const includeUnassigned = String(req.query.include_unassigned || "").toLowerCase() === "true";
    if (!isEstateWide && !user.home_id) return res.json({ devices: [] });

    const { data, error } = await query.order("updated_at", { ascending: false });

    if (error) {
      console.error("[devices.estate.list] query_failed", {
        estate_id: user.estate_id,
        home_id: user.home_id || null,
        include_unassigned: includeUnassigned,
        role,
        error: error.message,
      });
      return res.status(500).json({ error: "Failed to load device registry" });
    }

    const devices = (data || [])
      .filter((device: any) => {
        if (isEstateWide) return includeUnassigned || Boolean(device?.home_id);
        const assignedToActiveHome = String(device?.home_id || "") === String(user.home_id || "");
        if (assignedToActiveHome) return true;
        if (!includeUnassigned || device?.home_id) return false;
        const syncState = String(device?.sync_state || "").toLowerCase();
        const status = String(device?.status || "").toLowerCase();
        return syncState !== "unavailable" && status !== "unavailable" && device?.is_managed_disabled !== true;
      })
      .map((device: any) => {
        const room = Array.isArray(device?.rooms) ? device.rooms[0] || null : device?.rooms || null;
        return {
          ...device,
          name: cleanText(device?.name, "Unnamed device"),
          type: cleanText(device?.type, cleanText(device?.category, "device")),
          category: cleanText(device?.category, cleanText(device?.type, "device")),
          status: cleanText(device?.status, device?.online === false ? "offline" : "unknown"),
          capabilities: safeArray(device?.capabilities),
          protocols: safeArray(device?.protocols),
          metadata: sanitizeMetadata(device?.metadata),
          room: room?.id ? { id: room.id, name: cleanText(room.name, "Room") } : null,
          room_name: cleanText(room?.name),
          rooms: undefined,
        };
      });

    return res.json({ devices });
  } catch (e: any) {
    console.error("[devices.estate.list] normalization_failed", {
      estate_id: (req as any)?.user?.estate_id || null,
      home_id: (req as any)?.user?.home_id || null,
      include_unassigned: String(req.query.include_unassigned || "").toLowerCase() === "true",
      error: e?.message || "Unknown registry normalization error",
    });
    return res.status(500).json({ error: e?.message || "Failed to fetch estate devices" });
  }
}
