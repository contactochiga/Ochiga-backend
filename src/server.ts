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

// ✅ INTENT WORKER (BullMQ)
import { startIntentWorker } from "./workers/intentWorker";
import { CommunityLiveService } from "./services/communityLiveService";

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

  socket.on("subscribe:thread", (threadId: string) => {
    socket.join(`thread:${threadId}`);
  });

  socket.on("community-live:host:join", ({ postId }: { postId: string }) => {
    if (!postId) return;
    socket.join(`community-live:${postId}:host`);
    socket.join(`community-live:${postId}:viewers`);
    const session = CommunityLiveService.bindHost(String(postId), socket.id);
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
  });

  socket.on("community-live:viewer:join", ({ postId, userId }: { postId: string; userId?: string }) => {
    if (!postId) return;
    socket.join(`community-live:${postId}:viewers`);
    const session = CommunityLiveService.addViewer(String(postId), socket.id);
    io.to(`community-live:${postId}:host`).emit("community-live:viewer-joined", {
      postId: String(postId),
      viewerSocketId: socket.id,
      userId: String(userId || ""),
      live_session: session,
    });
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
  });

  socket.on(
    "community-live:signal",
    ({
      postId,
      targetSocketId,
      kind,
      payload,
    }: {
      postId: string;
      targetSocketId: string;
      kind: "offer" | "answer" | "candidate";
      payload: any;
    }) => {
      if (!postId || !targetSocketId || !kind) return;
      io.to(String(targetSocketId)).emit("community-live:signal", {
        postId: String(postId),
        sourceSocketId: socket.id,
        kind,
        payload,
      });
    }
  );

  socket.on("community-live:leave", ({ postId }: { postId: string }) => {
    if (!postId) return;
    socket.leave(`community-live:${postId}:viewers`);
    const session = CommunityLiveService.removeViewer(String(postId), socket.id);
    io.to(`community-live:${postId}:host`).emit("community-live:viewer-left", {
      postId: String(postId),
      viewerSocketId: socket.id,
      live_session: session,
    });
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
  });

  socket.on("disconnect", () => {
    const impacted = CommunityLiveService.detachSocket(socket.id);
    for (const item of impacted) {
      io.to(`community-live:${item.postId}:viewers`).emit("community-live:stats", {
        postId: item.postId,
        live_session: item.session,
      });
      if (item.ended) {
        io.to(`community-live:${item.postId}:viewers`).emit("community-live:ended", {
          postId: item.postId,
          live_session: item.session,
        });
      }
    }
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
    // START INTENT WORKER (BullMQ)
    // ---------------------------
    startIntentWorker();
    console.log("🟢 Intent worker running");

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
