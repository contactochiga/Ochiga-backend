// src/core/control-plane/signal.types.ts

export type SignalSource =
  | "device"
  | "system"
  | "user"
  | "network";

export interface BaseSignal {
  source: SignalSource;
  type: string;
  timestamp: string;
  metadata?: any;
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
