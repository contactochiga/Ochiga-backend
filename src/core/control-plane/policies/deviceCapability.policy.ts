// src/core/control-plane/policies/deviceCapability.policy.ts
import { Signal } from "../contracts/signal.types";
import { Intent } from "../contracts/intent.types";
import { DEVICE_CAPABILITIES } from "../capabilities/deviceCapabilities";

export function deviceCapabilityPolicy(signal: Signal): Intent[] {
  if (signal.type !== "device.command.requested") return [];

  const anySig: any = signal;
  const command = anySig.command;

  // ✅ If command is "code/value" style (Tuya/MQTT), don't block it here.
  // Example: { switch_1: true }
  if (command && typeof command === "object" && !command.type) {
    return [];
  }

  // If command has a "type", enforce capabilities
  const deviceType = anySig.deviceType;
  const allowed = DEVICE_CAPABILITIES[deviceType] || [];

  const cmdType = command?.type;
  if (!cmdType) return [];

  if (!allowed.includes(cmdType)) {
    throw new Error("Command not supported by device");
  }

  return [];
}
