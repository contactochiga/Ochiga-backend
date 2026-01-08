// src/event-processor/eventProcessor.ts
import { mqttClient } from "../mqtt";
import { handleRoomEvent } from "./handlers/rooms";

export interface EventPayload {
  source: "device" | "system";
  deviceId: string;
  type: string;
  payload?: any;
  timestamp?: string;
}

export async function processEvent(event: EventPayload): Promise<void> {
  try {
    console.log("📥 Incoming event:", event);

    // Dispatch ONLY — no decisions
    switch (event.type) {
      case "motion_detected":
      case "user_left":
        await handleRoomEvent({
          deviceId: event.deviceId,
          type: event.type as any,
          payload: event.payload,
        });
        break;

      default:
        console.log("ℹ️ No handler for event type:", event.type);
    }
  } catch (err) {
    console.error("❌ Error in processEvent:", err);
  }
}

export function startEventProcessor() {
  console.log("🚀 Event Processor started — waiting for real device events...");

  mqttClient.subscribe("ochiga/events/#", (err) => {
    if (err) console.error("❌ MQTT subscription failed:", err);
    else console.log("📡 Subscribed to ochiga/events/#");
  });

  mqttClient.on("message", (topic, message) => {
    try {
      const event: EventPayload = JSON.parse(message.toString());
      console.log(`📩 MQTT Event Received | Topic: ${topic}`);
      processEvent(event);
    } catch (err) {
      console.error("❌ Failed to parse MQTT message:", err);
    }
  });
}
