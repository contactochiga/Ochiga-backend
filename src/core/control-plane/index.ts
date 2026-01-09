// src/core/control-plane/index.ts
import { Signal } from "./signal.types";
import { evaluateSignal } from "./decisionEngine";
import { enqueueIntent } from "../../workers/intentWorker";

export async function handleSignal(signal: Signal) {
  if (!signal?.type || signal.schemaVersion !== "v1") {
    console.warn("⚠️ Invalid or unsupported signal", signal);
    return;
  }

  const intents = evaluateSignal(signal);

  for (const intent of intents) {
    await enqueueIntent({
      ...intent,
      schemaVersion: "v1",
      source_signal: signal.type,
      created_at: new Date().toISOString(),
    });
  }
}
