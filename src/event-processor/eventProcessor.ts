// src/event-processor/eventProcessor.ts
import { mqttClient } from "../mqtt";
import { handleSignal } from "../core/control-plane";
import { Signal } from "../core/control-plane/signal.types";

// Start background processor
export function startEventProcessor() {
  console.log("🚀 Event Processor started — listening for real device events");

  // Subscribe once
  mqttClient.subscribe("ochiga/events/#", (err) => {
    if (err) {
      console.error("❌ MQTT subscription failed:", err);
    } else {
      console.log("📡 Subscribed to ochiga/events/#");
    }
  });

  mqttClient.on("message", async (topic, message) => {
    try {
      const raw = JSON.parse(message.toString());

      // 🔹 Normalize into a Signal
      const signal: Signal = {
        source: "device",
        type: raw.type,
        timestamp: new Date().toISOString(),
        ...raw,
      };

      console.log("📥 Signal received:", signal);

      // 🔹 Hand off to Control Plane
      await handleSignal(signal);
    } catch (err) {
      console.error("❌ Failed to process MQTT message:", err);
    }
  });
}
