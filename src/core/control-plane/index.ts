// src/core/control-plane/index.ts
import { Signal } from "./signal.types";
import { evaluateSignal } from "./decisionEngine";
import { enqueueIntent } from "../../workers/intentQueue";

/**
 * Control Plane entrypoint
 * Converts incoming Signals into executable Intents
 */
export async function handleSignal(signal: Signal) {
  try {
    // --- 1. Basic signal validation ---
    if (!signal || !signal.type) {
      console.warn("⚠️ ControlPlane: Invalid signal received", signal);
      return;
    }

    // --- 2. Evaluate signal into intents ---
    const intents = evaluateSignal(signal);

    if (!intents || intents.length === 0) {
      // No action needed — valid outcome
      return;
    }

    // --- 3. Enqueue intents safely ---
    for (const intent of intents) {
      try {
        await enqueueIntent({
          ...intent,
          // context propagation (future-proof)
          region_id: signal.region_id ?? null,
          estate_id: signal.estate_id ?? null,
          zone_id: signal.zone_id ?? null,
          source_signal: signal.type,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error(
          "❌ ControlPlane: Failed to enqueue intent",
          intent,
          err
        );
        // continue — do not block other intents
      }
    }
  } catch (err) {
    console.error("❌ ControlPlane: Fatal signal handling error", err);
  }
}
