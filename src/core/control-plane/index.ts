// src/core/control-plane/index.ts
import { Signal } from "./signal.types";
import { evaluateSignal } from "./decisionEngine";
import { enqueueIntent } from "../../workers/intentQueue";

export async function handleSignal(signal: Signal) {
  const intents = evaluateSignal(signal);

  for (const intent of intents) {
    await enqueueIntent(intent);
  }
}
