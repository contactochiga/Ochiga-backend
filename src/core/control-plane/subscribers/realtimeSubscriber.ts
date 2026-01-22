import { getIO } from "../../../realtime/io";
import type { Signal } from "../contracts/signal.types";

export function realtimeSubscriber(signal: Signal) {
  const io = getIO();
  if (!io) return;

  // Always emit a raw signal event (clients decide what to do)
  // Rooms (best-effort, only if IDs exist on the signal)
  const anySig: any = signal;

  const estateId = anySig.estateId || anySig.estate_id;
  const roomId = anySig.roomId || anySig.room_id;
  const deviceId = anySig.deviceId || anySig.device_id;
  const userId = anySig?.requestedBy?.userId;

  // Emit to estate channel
  if (estateId) io.to(`estate:${estateId}`).emit("signal", signal);

  // Emit to room channel
  if (roomId) io.to(`room:${roomId}`).emit("signal", signal);

  // Emit to user channel (especially for command confirmations)
  if (userId) io.to(`user:${userId}`).emit("signal", signal);

  // Optional: device channel (handy for dashboards)
  if (deviceId) io.to(`device:${deviceId}`).emit("signal", signal);
}
