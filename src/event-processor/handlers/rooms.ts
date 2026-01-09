// src/event-processor/handlers/rooms.ts
import { handleSignal } from "../../core/control-plane";
import { Signal } from "../../core/control-plane/signal.types";

export interface RoomEvent {
  deviceId: string;
  roomId: string;
  type: "motion_detected" | "user_left";
}

export async function handleRoomEvent(event: RoomEvent) {
  let signal: Signal | null = null;

  if (event.type === "motion_detected") {
    signal = {
      source: "device",
      type: "room.motion",
      timestamp: new Date().toISOString(),
      roomId: event.roomId,
      deviceId: event.deviceId,
    };
  }

  if (event.type === "user_left") {
    signal = {
      source: "device",
      type: "room.empty",
      timestamp: new Date().toISOString(),
      roomId: event.roomId,
    };
  }

  if (signal) {
    await handleSignal(signal);
  }
}
