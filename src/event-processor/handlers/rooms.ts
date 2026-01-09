// src/event-processor/handlers/rooms.ts

import { handleSignal } from "../../core/control-plane";

import {
  SIGNAL_SCHEMA_VERSION,
} from "../../core/control-plane/contracts/versions";

import {
  Signal,
  RoomMotionSignal,
  RoomEmptySignal,
} from "../../core/control-plane/contracts/signal.types";

type RoomEvent =
  | {
      type: "motion_detected";
      roomId: string;
      deviceId: string;
    }
  | {
      type: "user_left";
      roomId: string;
    };

/**
 * Translate low-level room events into Control Plane Signals
 */
export async function handleRoomEvent(event: RoomEvent) {
  const base = {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "device" as const,
    timestamp: new Date().toISOString(),
  };

  let signal: Signal | null = null;

  switch (event.type) {
    case "motion_detected":
      signal = {
        ...base,
        type: "room.motion",
        roomId: event.roomId,
        deviceId: event.deviceId,
      } satisfies RoomMotionSignal;
      break;

    case "user_left":
      signal = {
        ...base,
        type: "room.empty",
        roomId: event.roomId,
      } satisfies RoomEmptySignal;
      break;
  }

  if (signal) {
    await handleSignal(signal);
  }
}
