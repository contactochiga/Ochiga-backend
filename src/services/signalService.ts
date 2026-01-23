import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import type { Signal } from "../core/control-plane/contracts/signal.types";

export type DeviceCommandSignalPayload = {
  source?: string; // "consumer-ui" etc
  deviceId: string;

  // your UI-style fields
  capability?: string;
  value?: any;

  // or allow direct command object too
  command?: Record<string, any>;

  meta?: Record<string, any>;

  // optional context
  estateId?: string;
  homeId?: string;
  roomId?: string;

  // allow override if needed
  type?: string;
};

export const signalService = {
  async sendDeviceCommand(payload: DeviceCommandSignalPayload) {
    const type = (payload.type ?? "device.command.requested") as Signal["type"];

    // Normalize: if UI sent capability/value, convert into command shape
    const normalizedCommand =
      payload.command ??
      (payload.capability
        ? { [payload.capability]: payload.value }
        : undefined);

    const signal: Signal = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: payload.source ?? "consumer-ui",
      type,
      timestamp: new Date().toISOString(),

      // keep common fields
      deviceId: payload.deviceId,
      command: normalizedCommand,
      meta: payload.meta,

      // context if you want it downstream
      estateId: payload.estateId,
      homeId: payload.homeId,
      roomId: payload.roomId,
    } as any;

    await handleSignal(signal);

    return { status: "accepted", signalType: signal.type };
  },
};
