import { Signal } from "./contracts/signal.types";
import { evaluateSignal } from "./decisionEngine";
import { enqueueIntent } from "../../workers/intentWorker";

import { notificationSubscriber } from "./subscribers/notificationSubscriber";
import { realtimeSubscriber } from "./subscribers/realtimeSubscriber"; // ✅ add

export async function handleSignal(signal: Signal) {
  if (!signal?.type || !signal.schemaVersion) {
    console.warn("⚠️ ControlPlane: Invalid signal dropped", signal);
    return;
  }

  // 1) Subscribers (side-effects)
  try {
    notificationSubscriber(signal);
  } catch (err) {
    console.error("❌ Notification subscriber failed", { signalType: signal.type, err });
  }

  // ✅ realtime emit
  try {
    realtimeSubscriber(signal);
  } catch (err) {
    console.error("❌ Realtime subscriber failed", { signalType: signal.type, err });
  }

  // 2) Policies → intents
  const intents = evaluateSignal(signal);
  if (!intents.length) return;

  // 3) Enqueue intents
  await Promise.all(
    intents.map((intent) =>
      enqueueIntent({
        ...intent,
        context: { ...intent.context, source_signal: signal.type },
      })
    )
  );
}
