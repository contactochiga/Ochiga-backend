import { getIO } from "./io";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import type { Signal } from "../core/control-plane/contracts/signal.types";

export function emitSignal(signal: Signal) {
  const io = getIO();
  if (!io) return;

  const anySig: any = signal;
  const estateId = anySig.estateId || anySig.estate_id;
  const roomId = anySig.roomId || anySig.room_id;
  const deviceId = anySig.deviceId || anySig.device_id;
  const userId = anySig?.requestedBy?.userId || anySig?.requestedBy?.user_id;

  // Broadcast to the most relevant scopes
  if (estateId) io.to(`estate:${estateId}`).emit("signal", signal);
  if (roomId) io.to(`room:${roomId}`).emit("signal", signal);
  if (userId) io.to(`user:${userId}`).emit("signal", signal);
  if (deviceId) io.to(`device:${deviceId}`).emit("signal", signal);
}

export function makeBaseSignal(overrides: Partial<Signal>): Signal {
  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "system",
    type: "system.signal",
    timestamp: new Date().toISOString(),
    ...(overrides as any),
  } as Signal;
}
