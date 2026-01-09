// src/event-processor/eventProcessor.ts

import { mqttClient } from "../mqtt";
import { handleSignal } from "../core/control-plane";

import {
  SIGNAL_SCHEMA_VERSION,
} from "../core/control-plane/contracts/versions";

import {
  Signal,
  RoomMotionSignal,
  RoomEmptySignal,
  VisitorArrivedSignal,
} from "../core/control-plane/contracts/signal.types";

/**
 * Normalize raw MQTT payload into a strict Signal
 */
function normalizeSignal(raw: any): Signal | null {
  if (!raw?.type) return null;

  const base = {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "device" as const,
    timestamp: new Date().toISOString(),
  };

  switch (raw.type) {
    case "room.motion":
      if (!raw.roomId || !raw.deviceId) return null;

      return {
        ...base,
        type: "room.motion",
        roomId: raw.roomId,
        deviceId: raw.deviceId,
      } satisfies RoomMotionSignal;

    case "room.empty":
      if (!raw.roomId) return null;

      return {
        ...base,
        type: "room.empty",
        roomId: raw.roomId,
      } satisfies RoomEmptySignal;

    case "visitor.arrived":
      if (!raw.visitorId || !raw.homeId) return null;

      return {
        ...base,
        type: "visitor.arrived",
        visitorId: raw.visitorId,
        homeId: raw.homeId,
      } satisfies VisitorArrivedSignal;

    default:
      // Unknown signal type → safely drop
      return null;
  }
}

/**
 * Start MQTT → Control Plane bridge
 */
export function startEventProcessor() {
  console.log("📡 Event Processor started");

  mqttClient.subscribe("ochiga/events/#");

  mqttClient.on("message", async (_, message) => {
    try {
      const raw = JSON.parse(message.toString());

      const signal = normalizeSignal(raw);
      if (!signal) return;

      await handleSignal(signal);
    } catch (err) {
      console.error("❌ Bad event dropped:", err);
    }
  });
}
