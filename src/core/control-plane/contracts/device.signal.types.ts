import { SIGNAL_SCHEMA_VERSION } from "./versions";
import { BaseSignal } from "./signal.types";

export interface DeviceDiscoveredSignal extends BaseSignal {
  type: "device.discovered";
  deviceId: string;
  protocols: string[];
  ip?: string;
}

export interface DeviceStateReportedSignal extends BaseSignal {
  type: "device.state.reported";
  deviceId: string;
  state: Record<string, any>;
}

export interface DeviceCommandRequestedSignal extends BaseSignal {
  type: "device.command.requested";
  deviceId: string;
  command: Record<string, any>;
  requestedBy: {
    userId: string;
    role: "resident" | "manager" | "operator";
  };
}

export type DeviceSignal =
  | DeviceDiscoveredSignal
  | DeviceStateReportedSignal
  | DeviceCommandRequestedSignal;
