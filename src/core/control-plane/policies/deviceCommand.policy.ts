// src/core/control-plane/policies/deviceCommand.policy.ts
import { Signal } from "../contracts/signal.types";
import { Intent } from "../contracts/intent.types";
import { INTENT_SCHEMA_VERSION } from "../contracts/versions";

/**
 * Converts a user device command signal into an executable DeviceCommandIntent
 */
export function deviceCommandPolicy(signal: Signal): Intent[] {
  if (signal.type !== "device.command.requested") return [];

  const anySig: any = signal;
  const deviceId = anySig.deviceId;
  const command = anySig.command;

  if (!deviceId || !command) return [];

  return [
    {
      schemaVersion: INTENT_SCHEMA_VERSION,
      target: "device",
      priority: "high",
      reason: "user_device_command",
      deviceId,
      command,
      context: {
        source_signal: signal.type,
        created_at: new Date().toISOString(),
      },
    },
  ];
}
