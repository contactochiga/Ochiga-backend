import { Signal } from "../contracts/signal.types";
import { Intent } from "../contracts/intent.types";
import { DEVICE_CAPABILITIES } from "../capabilities/deviceCapabilities";

export function deviceCapabilityPolicy(signal: Signal): Intent[] {
  if (signal.type !== "device.command.requested") return [];

  const { deviceType, command } = signal as any;
  const allowed = DEVICE_CAPABILITIES[deviceType] || [];

  if (!allowed.includes(command.type)) {
    throw new Error("Command not supported by device");
  }

  return [];
}
