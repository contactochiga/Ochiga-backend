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

  const standardEvent = standardRealtimeEvent(anySig.type);
  if (standardEvent) {
    const payload = {
      ...anySig,
      event: standardEvent,
      timestamp: anySig.timestamp || new Date().toISOString(),
    };
    io.emit(standardEvent, payload);
    if (estateId) io.to(`estate:${estateId}`).emit(standardEvent, payload);
    if (roomId) io.to(`room:${roomId}`).emit(standardEvent, payload);
    if (userId) io.to(`user:${userId}`).emit(standardEvent, payload);
    if (deviceId) io.to(`device:${deviceId}`).emit(standardEvent, payload);
  }
}

export function standardRealtimeEvent(type?: string | null) {
  const value = String(type || "");
  if (value === "device.registry.updated") return "device.registry.updated";
  if (value === "device.discovered") return "device.discovered";
  if (value === "device.status.updated" || value.startsWith("device.state") || value.startsWith("device.status")) return "device.status.updated";
  if (value === "visitor.created") return "visitor.created";
  if (value === "wallet.funded") return "wallet.funded";
  if (value === "support.ticket.created") return "support.ticket.created";
  if (value === "support.ticket.assigned") return "support.ticket.assigned";
  if (value === "estate.updated") return "estate.updated";
  if (value === "home.updated") return "home.updated";
  if (value === "edge.heartbeat") return "edge.heartbeat";
  if (value === "camera.status.updated") return "camera.status.updated";
  if (value === "incident.created") return "incident.created";
  if (value === "maintenance.updated") return "maintenance.updated";
  if (value === "deployment.milestone.created") return "deployment.milestone.created";
  if (value === "office.notification") return "office.notification";
  if (value === "audit.recorded") return "audit.recorded";
  if (value === "twin.state.updated") return "twin.state.updated";
  return "";
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
