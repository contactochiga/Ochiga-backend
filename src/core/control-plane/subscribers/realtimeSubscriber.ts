import type { Signal } from "../contracts/signal.types";
import { oyiCoreRuntime } from "../../../oyi-core/service";

export async function realtimeSubscriber(signal: Signal) {
  const anySig = signal as any;
  const event = String(anySig.type || "signal");
  const envelope = await oyiCoreRuntime.decorateRealtimePayload(event, anySig, []);
  oyiCoreRuntime.emitRealtime(event, anySig, envelope);
}
