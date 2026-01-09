// src/core/control-plane/contracts/signal.types.ts

import { SIGNAL_SCHEMA_VERSION } from "./versions";

export type SignalSource = "device" | "system" | "user" | "network";

export interface BaseSignal {
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION;
  source: SignalSource;
  type: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface RoomMotionSignal extends BaseSignal {
  type: "room.motion";
  roomId: string;
  deviceId: string;
}

export interface RoomEmptySignal extends BaseSignal {
  type: "room.empty";
  roomId: string;
}

export interface VisitorArrivedSignal extends BaseSignal {
  type: "visitor.arrived";
  visitorId: string;
  homeId: string;
}

export type Signal =
  | RoomMotionSignal
  | RoomEmptySignal
  | VisitorArrivedSignal;
