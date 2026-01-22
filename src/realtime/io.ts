import type { Server as IOServer } from "socket.io";

let _io: IOServer | null = null;

export function setIO(io: IOServer) {
  _io = io;
}

export function getIO() {
  return _io;
}
