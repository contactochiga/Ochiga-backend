// src/core/control-plane/contracts/signal.types.ts
import { SIGNAL_SCHEMA_VERSION } from "./versions";
import { DeviceSignal } from "./device.signal.types";

/**
 * Who emitted the signal
 */
export type SignalSource = "device" | "system" | "user" | "network";

/**
 * Base signal shared by all signals
 */
export interface BaseSignal {
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION;
  source: SignalSource;
  type: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * Room signals
 */
export interface RoomMotionSignal extends BaseSignal {
  type: "room.motion";
  roomId: string;
  deviceId: string;
}

export interface RoomEmptySignal extends BaseSignal {
  type: "room.empty";
  roomId: string;
}

/**
 * Visitor signals
 */
export interface VisitorArrivedSignal extends BaseSignal {
  type: "visitor.arrived";
  visitorId: string;
  homeId: string;
}

/**
 * 🧠 SYSTEM-WIDE SIGNAL UNION
 * This is what the control plane consumes
 */
export type Signal =
  | RoomMotionSignal
  | RoomEmptySignal
  | VisitorArrivedSignal
  | DeviceSignal;
