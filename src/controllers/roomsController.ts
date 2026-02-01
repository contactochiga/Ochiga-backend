// src/controllers/roomsController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { notifyUser, NotificationPayload } from "../services/NotificationService";

/**
 * GET /rooms?homeId=...
 * ✅ Fix: Supabase embed ambiguity by pinning FK constraint names.
 * - room_assignments has multiple possible relationships (pin it)
 * - devices had duplicates; you dropped fk_devices_room, but we still pin for safety
 */
export async function getRooms(req: Request, res: Response) {
  const homeId = String(req.query.homeId || "");
  if (!homeId) return res.status(400).json({ error: "homeId is required" });

  // ✅ Auth guard: consumer can only fetch rooms for their own home
  const authed: any = (req as any).user;
  if (authed?.home_id && authed.home_id !== homeId) {
    return res.status(403).json({ error: "Forbidden: home mismatch" });
  }

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select(
      `
        *,
        room_assignments!room_assignments_room_id_fkey(*),
        devices!devices_room_id_fkey(*)
      `
    )
    .eq("home_id", homeId)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ ok: true, rooms: data || [] });
}

/**
 * POST /rooms
 * Body: { estate_id, home_id, name, type?, ai_profile? }
 */
export async function createRoom(req: Request, res: Response) {
  const { estate_id, home_id, name, type, ai_profile } = req.body || {};

  if (!estate_id || !home_id || !name) {
    return res
      .status(400)
      .json({ error: "estate_id, home_id and name are required" });
  }

  // ✅ Auth guard: consumer can only create rooms in their own home
  const authed: any = (req as any).user;
  if (authed?.home_id && authed.home_id !== home_id) {
    return res.status(403).json({ error: "Forbidden: home mismatch" });
  }

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .insert([
      {
        estate_id,
        home_id,
        name,
        type: type || null,
        ai_profile: ai_profile || null,
      },
    ])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  return res.json({ ok: true, message: "Room created", room: data });
}

/**
 * PUT /rooms/ai/:roomId
 * Body: { ai_profile }
 */
export async function updateAiProfile(req: Request, res: Response) {
  const roomId = String(req.params.roomId || "");
  const { ai_profile } = req.body || {};

  if (!roomId) return res.status(400).json({ error: "roomId is required" });

  // Optional: ensure user can only update rooms in their home
  const authed: any = (req as any).user;
  if (authed?.home_id) {
    const { data: room, error: roomErr } = await supabaseAdmin
      .from("rooms")
      .select("id, home_id")
      .eq("id", roomId)
      .single();

    if (roomErr) return res.status(400).json({ error: roomErr.message });
    if (room?.home_id && room.home_id !== authed.home_id) {
      return res.status(403).json({ error: "Forbidden: home mismatch" });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .update({ ai_profile: ai_profile ?? null })
    .eq("id", roomId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  return res.json({ ok: true, message: "AI Profile Updated", room: data });
}

/**
 * POST /rooms/assign
 * IMPORTANT:
 * - your DB uses resident_id (from your FK screenshot)
 * - accept both payload shapes safely (resident_id OR user_id)
 */
export async function assignUserToRoom(req: Request, res: Response) {
  const { room_id, resident_id, user_id, role, permissions } = req.body || {};

  const targetResidentId = String(resident_id || user_id || "");
  if (!room_id || !targetResidentId) {
    return res.status(400).json({
      error: "room_id and (resident_id or user_id) are required",
    });
  }

  // ✅ Auth guard: user can only assign within their own home
  const authed: any = (req as any).user;
  if (authed?.home_id) {
    const { data: room, error: roomErr } = await supabaseAdmin
      .from("rooms")
      .select("id, home_id")
      .eq("id", room_id)
      .single();

    if (roomErr) return res.status(400).json({ error: roomErr.message });
    if (room?.home_id && room.home_id !== authed.home_id) {
      return res.status(403).json({ error: "Forbidden: home mismatch" });
    }
  }

  const insertPayload: any = {
    room_id,
    resident_id: targetResidentId, // ✅ correct column
    role: role || "member",
    permissions: permissions ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from("room_assignments")
    .insert([insertPayload])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  const payload: NotificationPayload = {
    title: "Assigned to Room",
    type: "room",
    entityId: room_id,
    message: `You were assigned to a room with role ${role || "member"}.`,
    payload: data,
  };

  await notifyUser(targetResidentId, payload);

  return res.json({ ok: true, message: "User assigned to room", assignment: data });
}

export default {
  getRooms,
  createRoom,
  updateAiProfile,
  assignUserToRoom,
};
