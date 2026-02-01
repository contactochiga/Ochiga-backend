import { Signal } from "../contracts/signal.types";
import { Intent } from "../contracts/intent.types";
import { INTENT_SCHEMA_VERSION } from "../contracts/versions";

export function deviceCommandPolicy(signal: Signal): Intent[] {
  if (signal.type !== "device.command.requested") return [];

  const anySig: any = signal;
  if (!anySig.deviceId || !anySig.command) return [];

  return [
    {
      schemaVersion: INTENT_SCHEMA_VERSION,
      target: "device",
      priority: "high",
      reason: "user_device_command",
      deviceId: anySig.deviceId,
      command: anySig.command,
      context: {
        source_signal: signal.type,
        created_at: new Date().toISOString(),
      },
    },
  ];
}
