import { Signal } from "../contracts/signal.types";
import { Intent } from "../contracts/intent.types";
import { DEVICE_CAPABILITIES } from "../capabilities/deviceCapabilities";

export function deviceCapabilityPolicy(signal: Signal): Intent[] {
  if (signal.type !== "device.command.requested") return [];

  const { deviceType, command } = signal as any;

  // ✅ If command is DP-style (Tuya): { switch_1: true }, allow it through
  // because it won't have command.type
  if (!command || typeof command !== "object") return [];
  if (!("type" in command)) return [];

  const allowed = DEVICE_CAPABILITIES[deviceType] || [];
  const commandType = command.type;

  if (!allowed.includes(commandType)) {
    // ❌ previously: throw new Error(...)
    // ✅ don't crash the pipeline; just block safely
    console.warn("deviceCapabilityPolicy blocked command", {
      deviceType,
      commandType,
      allowed,
    });
    return [];
  }

  return [];
}
