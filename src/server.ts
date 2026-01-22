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
// REDIS (shared infra)
// ---------------------------
import { redis } from "./config/redis";

// ---------------------------
// MQTT + EVENT PROCESSOR
// ---------------------------
import { initMqttBridge } from "./device/bridge";
import { startEventProcessor } from "./event-processor/eventProcessor";

// ✅ Realtime IO registry (NEW)
import { setIO } from "./realtime/io";

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

// ✅ Register io globally for control-plane subscribers
setIO(io);

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

  // ✅ Optional: device channel (handy for targeted streams)
  socket.on("subscribe:device", (deviceId: string) => {
    socket.join(`device:${deviceId}`);
  });

  socket.on("disconnect", (reason) => {
    console.log("🔌 Socket disconnected →", socket.id, reason);
  });
});

// ---------------------------
// START FULL BACKEND STACK
// ---------------------------
httpServer.listen(PORT, async () => {
  console.log(`🚀 HTTP + WebSocket server running on port ${PORT}`);

  try {
    // ---------------------------
    // CONNECT REDIS
    // ---------------------------
    await redis.connect();
    console.log("🟢 Redis connected successfully");

    // ---------------------------
    // START MQTT BRIDGE
    // ---------------------------
    await initMqttBridge();
    console.log("🟢 MQTT bridge initialized");

    // ---------------------------
    // START EVENT PROCESSOR
    // ---------------------------
    startEventProcessor();
    console.log("📡 Event processor running");

    console.log("✅ Ochiga backend fully online");
  } catch (error) {
    console.error("🔴 Backend startup failed →", error);
    process.exit(1);
  }
});
