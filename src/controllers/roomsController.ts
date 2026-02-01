// src/controllers/roomsController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { notifyUser, NotificationPayload } from "../services/NotificationService";

/**
 * GET /rooms?homeId=...
 * Fix: Supabase embed ambiguity because room_assignments/devices had >1 FK paths.
 * We pin the relation using FK constraint names.
 *
 * IMPORTANT: Response must remain an ARRAY (backward compatible with frontend).
 */
export async function getRooms(req: Request, res: Response) {
  const homeId = String(req.query.homeId || "");
  if (!homeId) return res.status(400).json({ error: "homeId is required" });

  // Optional auth guard: consumer can only fetch their own home rooms
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

  // ✅ Backward compatible: return array (what frontend expects)
  return res.json(data || []);
}

/**
 * POST /rooms
 * Keep response shape the same as before (frontend safe).
 */
export async function createRoom(req: Request, res: Response) {
  const { estate_id, home_id, name, type, ai_profile } = req.body || {};

  if (!estate_id || !home_id || !name) {
    return res
      .status(400)
      .json({ error: "estate_id, home_id and name are required" });
  }

  // Optional auth guard: consumer can only create rooms in their own home
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

  // ✅ Keep old shape
  return res.json({ message: "Room created", room: data });
}

/**
 * PUT /rooms/ai/:roomId
 */
export async function updateAiProfile(req: Request, res: Response) {
  const roomId = String(req.params.roomId || "");
  const { ai_profile } = req.body || {};

  if (!roomId) return res.status(400).json({ error: "roomId is required" });

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .update({ ai_profile: ai_profile ?? null })
    .eq("id", roomId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  return res.json({ message: "AI Profile Updated", room: data });
}

/**
 * POST /rooms/assign
 * DB uses resident_id (not user_id). Accept both safely.
 */
export async function assignUserToRoom(req: Request, res: Response) {
  const { room_id, resident_id, user_id, role, permissions } = req.body || {};

  const targetResidentId = String(resident_id || user_id || "");
  if (!room_id || !targetResidentId) {
    return res.status(400).json({
      error: "room_id and (resident_id or user_id) are required",
    });
  }

  const insertPayload: any = {
    room_id,
    resident_id: targetResidentId,
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

  return res.json({ message: "User assigned to room", assignment: data });
}

export default {
  getRooms,
  createRoom,
  updateAiProfile,
  assignUserToRoom,
};
