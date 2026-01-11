// src/controllers/roomsController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { notifyUser, NotificationPayload } from "../services/NotificationService";

export async function getRooms(req: Request, res: Response) {
  const homeId = req.query.homeId;
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

  // Notify estate admins
  const { data: admins } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("estate_id", estate_id)
    .in("role", ["admin", "manager"]);

  if (admins?.length) {
    const payload: NotificationPayload = {
      title: "New Room Created",         // ✅ Added title
      type: "room",
      entityId: data.id,
      message: `A new room "${name}" has been created in the estate.`,
      payload: data
    };
    for (const admin of admins) await notifyUser(admin.id, payload);
  }

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

  // Notify estate admins about AI profile update
  const { data: room } = await supabaseAdmin
    .from("rooms")
    .select("estate_id, id, name")
    .eq("id", roomId)
    .single();

  const { data: admins } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("estate_id", room?.estate_id)
    .in("role", ["admin", "manager"]);

  if (admins?.length) {
    const payload: NotificationPayload = {
      title: "Room AI Profile Updated",  // ✅ Added title
      type: "room",
      entityId: roomId,
      message: `AI profile for room "${room?.name}" has been updated.`,
      payload: { roomId, ai_profile }
    };
    for (const admin of admins) await notifyUser(admin.id, payload);
  }

  res.json({ message: "AI Profile Updated", room: data });
}

export async function assignUserToRoom(req: Request, res: Response) {
  const { room_id, resident_id, role, permissions } = req.body;
  const { data, error } = await supabaseAdmin
    .from("room_assignments")
    .insert([{ room_id, resident_id, role, permissions }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Notify user assigned
  const payload: NotificationPayload = {
    title: "Assigned to Room",           // ✅ Added title
    type: "room",
    entityId: room_id,
    message: `You were assigned to room ${room_id} with role ${role}.`,
    payload: data
  };
  await notifyUser(resident_id, payload);

  res.json({ message: "Resident assigned to room", assignment: data });
}

export default {
  getRooms,
  createRoom,
  updateAiProfile,
  assignUserToRoom
};
