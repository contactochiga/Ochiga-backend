// src/event-processor/handlers/rooms.ts
import { supabaseAdmin } from "../../supabase/client";
import { io } from "../../server";

export interface RoomEvent {
  deviceId: string;
  type: "motion_detected" | "user_left" | string;
  payload?: any;
}

export async function handleRoomEvent(event: RoomEvent) {
  const { deviceId, type } = event;

  // Resolve device → room
  const { data: device, error: deviceError } = await supabaseAdmin
    .from("devices")
    .select("id, external_id, room_id")
    .eq("external_id", deviceId)
    .single();

  if (deviceError || !device?.room_id) return;

  // Fetch room (used only for context, not decisions)
  const { data: room, error: roomError } = await supabaseAdmin
    .from("rooms")
    .select("id, ai_profile")
    .eq("id", device.room_id)
    .single();

  if (roomError || !room) return;

  // ─────────────────────────────
  // SIGNALS (NO COMMANDS)
  // ─────────────────────────────

  if (type === "motion_detected") {
    io.to(`room:${room.id}`).emit("signal:room:motion", {
      roomId: room.id,
      deviceId,
      payload: event.payload,
      timestamp: new Date().toISOString(),
    });
  }

  if (type === "user_left") {
    io.to(`room:${room.id}`).emit("signal:room:empty", {
      roomId: room.id,
      deviceId,
      timestamp: new Date().toISOString(),
    });
  }
}
