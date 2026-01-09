// src/event-processor/eventProcessor.ts
import { mqttClient } from "../mqtt";
import { handleSignal } from "../core/control-plane";
import { Signal } from "../core/control-plane/signal.types";

function normalizeSignal(raw: any): Signal | null {
  if (!raw?.type) return null;

  switch (raw.type) {
    case "visitor.arrived":
      return {
        schemaVersion: "v1",
        source: "device",
        type: "visitor.arrived",
        timestamp: new Date().toISOString(),
        visitorId: raw.visitorId,
        homeId: raw.homeId,
      };

    case "room.motion":
      return {
        schemaVersion: "v1",
        source: "device",
        type: "room.motion",
        timestamp: new Date().toISOString(),
        roomId: raw.roomId,
        deviceId: raw.deviceId,
      };

    default:
      return null;
  }
}

export function startEventProcessor() {
  mqttClient.subscribe("ochiga/events/#");

  mqttClient.on("message", async (_, message) => {
    try {
      const raw = JSON.parse(message.toString());
      const signal = normalizeSignal(raw);
      if (signal) await handleSignal(signal);
    } catch (err) {
      console.error("❌ Event processing failed", err);
    }
  });
}
