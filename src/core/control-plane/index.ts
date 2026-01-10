// src/core/control-plane/index.ts

import { Signal } from "./contracts/signal.types";
import { evaluateSignal } from "./decisionEngine";
import { enqueueIntent } from "../../workers/intentWorker";

// 👇 NEW: subscribers
import { notificationSubscriber } from "./subscribers/notificationSubscriber";

/**
 * Control Plane entrypoint
 * Converts Signals into reactions (subscribers) and executable Intents
 */
export async function handleSignal(signal: Signal) {
  // ------------------------------------
  // 1. Hard validation (contract enforcement)
  // ------------------------------------
  if (!signal?.type || !signal.schemaVersion) {
    console.warn("⚠️ ControlPlane: Invalid signal dropped", signal);
    return;
  }

  // ------------------------------------
  // 2. Fire subscribers (side-effects)
  // Non-blocking, failure-isolated
  // ------------------------------------
  try {
    await notificationSubscriber(signal);
  } catch (err) {
    console.error("❌ Notification subscriber failed", {
      signalType: signal.type,
      err,
    });
    // DO NOT throw — signals must keep flowing
  }

  // ------------------------------------
  // 3. Evaluate policies → Intents
  // ------------------------------------
  const intents = evaluateSignal(signal);

  if (!intents.length) return;

  // ------------------------------------
  // 4. Parallel enqueue (execution plane)
  // ------------------------------------
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
