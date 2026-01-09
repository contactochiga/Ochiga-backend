import { handleSignal } from "../../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../../core/control-plane/contracts";
import { Signal } from "../../core/control-plane/signal.types";

export async function handleRoomEvent(event: {
  deviceId: string;
  roomId: string;
  type: "motion_detected" | "user_left";
}) {
  let signal: Signal | null = null;

  if (event.type === "motion_detected") {
    signal = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "device",
      type: "room.motion",
      timestamp: new Date().toISOString(),
      roomId: event.roomId,
      deviceId: event.deviceId,
    };
  }

  if (event.type === "user_left") {
    signal = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "device",
      type: "room.empty",
      timestamp: new Date().toISOString(),
      roomId: event.roomId,
    };
  }

  if (signal) await handleSignal(signal);
}
