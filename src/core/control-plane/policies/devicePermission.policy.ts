import { Signal } from "../contracts/signal.types";
import { Intent } from "../contracts/intent.types";

export function devicePermissionPolicy(signal: Signal): Intent[] {
  if (signal.type !== "device.command.requested") return [];

  const { requestedBy, deviceScope } = signal as any;

  if (requestedBy.role === "resident" && deviceScope !== "home") {
    throw new Error("Resident not allowed to control this device");
  }

  if (requestedBy.role === "manager" && deviceScope === "region") {
    throw new Error("Manager cannot control regional devices");
  }

  return [];
}
