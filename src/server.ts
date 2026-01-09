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
// REDIS
// ---------------------------
import { redis } from "./config/redis";

// ---------------------------
// BACKGROUND SERVICES
// ---------------------------
import { startEventProcessor } from "./event-processor/eventProcessor";

// ---------------------------
// MQTT BRIDGE
// ---------------------------
import { initMqttBridge } from "./device/bridge";

// ---------------------------
// WORKERS (✅ FIXED IMPORTS)
// ---------------------------
import { startAutomationWorker } from "./workers/automationWorker";
import { startIntentWorker } from "./workers/intentWorker";
import { startIntentDlqWorker } from "./workers/intentDlqWorker";

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
// START SERVER + SERVICES
// ---------------------------
httpServer.listen(PORT, async () => {
  console.log(`🚀 HTTP + WebSocket server running on port ${PORT}`);

  // ---------------------------
  // CONNECT REDIS
  // ---------------------------
  try {
    await redis.connect();
    console.log("🟢 Redis connected successfully");
  } catch (error) {
    console.error("🔴 Redis connection failed →", error);
  }

  // ---------------------------
  // START EVENT PROCESSOR
  // ---------------------------
  try {
    startEventProcessor();
    console.log("🟢 Event processor started");
  } catch (error) {
    console.error("🔴 Event processor failed →", error);
  }

  // ---------------------------
  // START MQTT BRIDGE
  // ---------------------------
  try {
    await initMqttBridge();
    console.log("🟢 MQTT bridge initialized");
  } catch (error) {
    console.error("🔴 MQTT bridge failed →", error);
  }

  // ---------------------------
  // START AUTOMATION WORKER
  // ---------------------------
  try {
    startAutomationWorker();
    console.log("🟢 Automation worker started");
  } catch (error) {
    console.error("🔴 Automation worker startup failed →", error);
  }

  // ---------------------------
  // START INTENT WORKER (Execution Plane)
  // ---------------------------
  try {
    startIntentWorker();
    console.log("🧠 Intent worker started");
  } catch (error) {
    console.error("🔴 Intent worker startup failed →", error);
  }

  // ---------------------------
  // START DLQ WORKER (Safety Plane)
  // ---------------------------
  try {
    startIntentDlqWorker();
    console.log("🧯 Intent DLQ worker started");
  } catch (error) {
    console.error("🔴 DLQ worker startup failed →", error);
  }
});
