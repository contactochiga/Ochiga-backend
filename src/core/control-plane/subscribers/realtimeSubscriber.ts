import type { Signal } from "../contracts/signal.types";
import { oyiCoreRuntime, type RuntimeEnvelope } from "../../../oyi-core/service";

// Oyi Intelligence Convergence, Canonical Signal Path Hardening Slice --
// reuses the RuntimeEnvelope handleSignal() already produced from its
// own oyiCoreRuntime.receiveSignal() call, instead of calling
// oyiCoreRuntime.decorateRealtimePayload() -- which itself called
// receiveSignal() a SECOND time, running Core's full reasoning pipeline
// twice for one signal. `envelope` is a required parameter (not
// optional) so this can never silently fall back to re-running Core
// reasoning just to shape a broadcast payload. The broadcast payload
// shape emitRealtime() produces (`{...signal, event, ...envelope}`) is
// unchanged -- only how the envelope is OBTAINED changed, not its
// content or the fields it contributes to the payload.
export async function realtimeSubscriber(signal: Signal, envelope: RuntimeEnvelope) {
  const anySig = signal as any;
  const event = String(anySig.type || "signal");
  oyiCoreRuntime.emitRealtime(event, anySig, envelope);
}
