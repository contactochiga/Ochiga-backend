import { mqttClient } from "../mqtt";
import { handleSignal } from "../core/control-plane";
import {
  SIGNAL_SCHEMA_VERSION,
} from "../core/control-plane/contracts";
import { Signal } from "../core/control-plane/signal.types";

export function startEventProcessor() {
  mqttClient.subscribe("ochiga/events/#");

  mqttClient.on("message", async (_, message) => {
    try {
      const raw = JSON.parse(message.toString());

      if (!raw.type) return;

      const signal: Signal = {
        schemaVersion: SIGNAL_SCHEMA_VERSION,
        source: "device",
        type: raw.type,
        timestamp: new Date().toISOString(),
        ...raw,
      };

      await handleSignal(signal);
    } catch (err) {
      console.error("Bad event dropped:", err);
    }
  });
}
