// src/server.ts
import http from "http";
import { Server as IOServer } from "socket.io";
import dotenv from "dotenv";
dotenv.config();

// ---------------------------
// EXPRESS APP
// ---------------------------
import app from "./app";

// ---------------------------
// ENV + PORT CONFIG
// ---------------------------
import { PORT } from "./config/env";

// ---------------------------
// REDIS (shared infra – OK)
// ---------------------------
import { redis } from "./config/redis";

// ---------------------------
// HTTP + WEBSOCKET SERVER
// ---------------------------
const httpServer = http.createServer(app);

export const io = new IOServer(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
});

// ---------------------------
// SOCKET.IO CONNECTIONS
// ---------------------------
io.on("connection", (socket) => {
  console.log("🔌 Socket connected →", socket.id);

  socket.on("subscribe:estate", (estateId: string) => {
    socket.join(`estate:${estateId}`);
  });

  socket.on("subscribe:user", (userId: string) => {
    socket.join(`user:${userId}`);
  });

  socket.on("subscribe:room", (roomId: string) => {
    socket.join(`room:${roomId}`);
  });
});

// ---------------------------
// START HTTP SERVER ONLY
// ---------------------------
httpServer.listen(PORT, async () => {
  console.log(`🚀 HTTP + WebSocket server running on port ${PORT}`);

  // ---------------------------
  // CONNECT REDIS (shared)
  // ---------------------------
  try {
    await redis.connect();
    console.log("🟢 Redis connected successfully");
  } catch (error) {
    console.error("🔴 Redis connection failed →", error);
    process.exit(1); // fail fast
  }
});
