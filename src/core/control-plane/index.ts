import { Signal } from "./signal.types";
import { evaluateSignal } from "./decisionEngine";
import { enqueueIntent } from "../../workers/intentWorker";

export async function handleSignal(signal: Signal) {
  if (!signal?.type || !signal.schemaVersion) {
    console.warn("Invalid signal dropped", signal);
    return;
  }

  const intents = evaluateSignal(signal);

  if (!intents.length) return;

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
