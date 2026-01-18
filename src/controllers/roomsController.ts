// src/controllers/roomsController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { notifyUser, NotificationPayload } from "../services/NotificationService";

export async function getRooms(req: Request, res: Response) {
  const homeId = req.query.homeId as string;
  if (!homeId) return res.status(400).json({ error: "homeId is required" });

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select("*, room_assignments(*), devices(*)")
    .eq("home_id", homeId);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

export async function createRoom(req: Request, res: Response) {
  const { estate_id, home_id, name, type, ai_profile } = req.body;

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .insert([{ estate_id, home_id, name, type, ai_profile }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "Room created", room: data });
}

export async function updateAiProfile(req: Request, res: Response) {
  const { roomId } = req.params;
  const { ai_profile } = req.body;

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .update({ ai_profile })
    .eq("id", roomId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "AI Profile Updated", room: data });
}

export async function assignUserToRoom(req: Request, res: Response) {
  const { room_id, user_id, role, permissions } = req.body;

  if (!room_id || !user_id) {
    return res.status(400).json({ error: "room_id and user_id are required" });
  }

  const { data, error } = await supabaseAdmin
    .from("room_assignments")
    .insert([{ room_id, user_id, role, permissions }])
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

  await notifyUser(user_id, payload);

  res.json({ message: "User assigned to room", assignment: data });
}

export default {
  getRooms,
  createRoom,
  updateAiProfile,
  assignUserToRoom,
};
