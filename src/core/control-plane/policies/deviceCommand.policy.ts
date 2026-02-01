import { Signal } from "../contracts/signal.types";
import { Intent, DeviceCommandIntent } from "../contracts/intent.types";
import { INTENT_SCHEMA_VERSION } from "../contracts/versions";

export function deviceCommandPolicy(signal: Signal): Intent[] {
  if (signal.type !== "device.command.requested") return [];

  const s: any = signal;

  const intent: DeviceCommandIntent = {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: "device",
    reason: "user_device_command",
    priority: "high",
    deviceId: s.deviceId,     // this is whatever you passed in API route
    command: s.command,       // { type: "power.on" } etc
    context: {
      source_signal: signal.type,
      created_at: new Date().toISOString(),
    },
  };

  return [intent];
}
