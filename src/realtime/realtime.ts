// src/realtime/realtime.ts
import type { Server as IOServer } from "socket.io";

let io: IOServer | null = null;

export function setIO(server: IOServer) {
  io = server;
}

export function emitToUser(userId: string, event: string, payload: any) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}
