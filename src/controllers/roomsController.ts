// src/controllers/roomsController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { notifyUser, NotificationPayload } from "../services/NotificationService";

/**
 * GET /rooms?homeId=...
 * Fix: Supabase embed ambiguity because room_assignments has >1 FK to rooms.
 * We MUST pin the relation using the FK constraint name.
 */
export async function getRooms(req: Request, res: Response) {
  const homeId = String(req.query.homeId || "");
  if (!homeId) return res.status(400).json({ error: "homeId is required" });

  // Optional (recommended) auth guard: only allow user to fetch their own home rooms
  // If your consumer token has home_id on it, enforce it.
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
        devices(*)
      `
    )
    .eq("home_id", homeId)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Keep response consistent
  return res.json({ ok: true, rooms: data || [] });
}

/**
 * POST /rooms
 */
export async function createRoom(req: Request, res: Response) {
  const { estate_id, home_id, name, type, ai_profile } = req.body;

  if (!estate_id || !home_id || !name) {
    return res.status(400).json({ error: "estate_id, home_id and name are required" });
  }

  // Optional auth guard: user must be creating in their home
  const authed: any = (req as any).user;
  if (authed?.home_id && authed.home_id !== home_id) {
    return res.status(403).json({ error: "Forbidden: home mismatch" });
  }

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .insert([{ estate_id, home_id, name, type, ai_profile }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  return res.json({ ok: true, message: "Room created", room: data });
}

/**
 * PUT /rooms/ai/:roomId
 */
export async function updateAiProfile(req: Request, res: Response) {
  const roomId = String(req.params.roomId || "");
  const { ai_profile } = req.body;

  if (!roomId) return res.status(400).json({ error: "roomId is required" });

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .update({ ai_profile })
    .eq("id", roomId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  return res.json({ ok: true, message: "AI Profile Updated", room: data });
}

/**
 * POST /rooms/assign
 * IMPORTANT FIX:
 * - your DB likely uses resident_id not user_id (based on your FK screenshot)
 * - accept both payload shapes safely
 */
export async function assignUserToRoom(req: Request, res: Response) {
  const { room_id, user_id, resident_id, role, permissions } = req.body;

  const targetResidentId = resident_id || user_id; // accept either
  if (!room_id || !targetResidentId) {
    return res.status(400).json({ error: "room_id and (resident_id or user_id) are required" });
  }

  const insertPayload: any = {
    room_id,
    resident_id: targetResidentId, // ✅ correct column
    role: role || "member",
    permissions: permissions || null,
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

  // notify the resident/user
  await notifyUser(targetResidentId, payload);

  return res.json({ ok: true, message: "User assigned to room", assignment: data });
}

export default {
  getRooms,
  createRoom,
  updateAiProfile,
  assignUserToRoom,
};
