// src/core/control-plane/index.ts

import { Signal } from "./contracts/signal.types";
import { evaluateSignal } from "./decisionEngine";
import { enqueueIntent } from "../../workers/intentWorker";

/**
 * Control Plane entrypoint
 * Converts Signals into Intents and dispatches them
 */
export async function handleSignal(signal: Signal) {
  // --- 1. Hard validation (contract enforcement) ---
  if (!signal?.type || !signal.schemaVersion) {
    console.warn("⚠️ ControlPlane: Invalid signal dropped", signal);
    return;
  }

  // --- 2. Evaluate policies ---
  const intents = evaluateSignal(signal);

  if (!intents.length) return;

  // --- 3. Parallel enqueue (performance-safe) ---
  await Promise.all(
    intents.map((intent) =>
      enqueueIntent({
        ...intent,
        context: {
          ...intent.context,
          source_signal: signal.type,
        },
      })
    )
  );
}
