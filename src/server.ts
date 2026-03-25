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

  socket.on("community-live:host:join", async ({ postId }: { postId: string }) => {
    if (!postId) return;
    socket.join(`community-live:${postId}:host`);
    socket.join(`community-live:${postId}:viewers`);
    socket.join(`community-live:${postId}:publishers`);
    const session = await CommunityLiveService.bindHost(String(postId), socket.id);
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
  });

  socket.on("community-live:host:stop", async ({ postId }: { postId: string }) => {
    if (!postId) return;
    const session = await CommunityLiveService.stop(String(postId));
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
    io.to(`community-live:${postId}:viewers`).emit("community-live:ended", {
      postId: String(postId),
      live_session: session,
    });
    io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
      postId: String(postId),
      requests: [],
      live_session: session,
    });
  });

  socket.on("community-live:viewer:join", async ({ postId, userId, userName }: { postId: string; userId?: string; userName?: string }) => {
    if (!postId) return;
    socket.join(`community-live:${postId}:viewers`);
    const session = await CommunityLiveService.addViewer(String(postId), socket.id);
    io.to(`community-live:${postId}:publishers`).emit("community-live:viewer-joined", {
      postId: String(postId),
      viewerSocketId: socket.id,
      userId: String(userId || ""),
      userName: String(userName || "Resident"),
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
      role,
      payload,
    }: {
      postId: string;
      targetSocketId: string;
      kind: "offer" | "answer" | "candidate";
      role?: "host" | "guest" | "viewer";
      payload: any;
    }) => {
      if (!postId || !targetSocketId || !kind) return;
      io.to(String(targetSocketId)).emit("community-live:signal", {
        postId: String(postId),
        sourceSocketId: socket.id,
        kind,
        role: role || "viewer",
        payload,
      });
    }
  );

  socket.on(
    "community-live:guest:request",
    async ({ postId, userId, userName }: { postId: string; userId?: string; userName?: string }) => {
      if (!postId) return;
      const result = await CommunityLiveService.requestGuest({
        postId: String(postId),
        socketId: socket.id,
        userId,
        userName,
      });
      if ((result as any)?.blocked) {
        socket.emit("community-live:guest-rejected", {
          postId: String(postId),
          reason: "A guest is already active.",
        });
        return;
      }
      socket.emit("community-live:guest-requested", {
        postId: String(postId),
        request: Array.isArray(result.requests)
          ? result.requests.find((item: any) => String(item?.socketId || "") === socket.id) || null
          : null,
        live_session: result.session,
      });
      io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
        postId: String(postId),
        requests: result.requests,
        live_session: result.session,
      });
      io.to(`community-live:${postId}:publishers`).emit("community-live:guest-requests", {
        postId: String(postId),
        requests: result.requests,
        live_session: result.session,
      });
      const hostSocketId = CommunityLiveService.hostSocketId(String(postId));
      if (hostSocketId) {
        io.to(hostSocketId).emit("community-live:guest-requested-for-host", {
          postId: String(postId),
          requests: result.requests,
          live_session: result.session,
        });
      }
    }
  );

  socket.on("community-live:guest:approve", async ({ postId, viewerSocketId }: { postId: string; viewerSocketId: string }) => {
    if (!postId || !viewerSocketId) return;
    const result = await CommunityLiveService.approveGuest(String(postId), String(viewerSocketId));
    io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
      postId: String(postId),
      requests: result.requests,
      live_session: result.session,
    });
    if (result.approved) {
      io.to(String(viewerSocketId)).emit("community-live:guest-approved", {
        postId: String(postId),
        audienceSocketIds: result.audienceSocketIds || [],
        request: result.approved,
        live_session: result.session,
      });
    }
  });

  socket.on("community-live:guest:reject", async ({ postId, viewerSocketId }: { postId: string; viewerSocketId: string }) => {
    if (!postId || !viewerSocketId) return;
    const result = await CommunityLiveService.rejectGuest(String(postId), String(viewerSocketId));
    io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
      postId: String(postId),
      requests: result.requests,
      live_session: result.session,
    });
    io.to(String(viewerSocketId)).emit("community-live:guest-rejected", {
      postId: String(postId),
      reason: "Host declined your request to join.",
      live_session: result.session,
    });
  });

  socket.on(
    "community-live:guest:join",
    async ({ postId, userId, userName }: { postId: string; userId?: string; userName?: string }) => {
      if (!postId) return;
      socket.join(`community-live:${postId}:publishers`);
      const result = await CommunityLiveService.bindGuest({
        postId: String(postId),
        socketId: socket.id,
        userId,
        userName,
      });
      socket.emit("community-live:audience-sync", {
        postId: String(postId),
        audienceSocketIds: result.audienceSocketIds,
        role: "guest",
        live_session: result.session,
      });
      io.to(`community-live:${postId}:viewers`).emit("community-live:publisher-joined", {
        postId: String(postId),
        publisherSocketId: socket.id,
        role: "guest",
        live_session: result.session,
      });
      io.to(`community-live:${postId}:host`).emit("community-live:guest-active", {
        postId: String(postId),
        live_session: result.session,
      });
      io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
        postId: String(postId),
        live_session: result.session,
      });
    }
  );

  socket.on("community-live:guest:remove", async ({ postId }: { postId: string }) => {
    if (!postId) return;
    const guestSocketId = CommunityLiveService.publisherSocketIds(String(postId)).find((id) => id !== CommunityLiveService.hostSocketId(String(postId)));
    const session = await CommunityLiveService.removeGuest(String(postId));
    if (guestSocketId) {
      io.to(String(guestSocketId)).emit("community-live:guest-removed", {
        postId: String(postId),
        live_session: session,
      });
    }
    io.to(`community-live:${postId}:viewers`).emit("community-live:publisher-left", {
      postId: String(postId),
      publisherSocketId: guestSocketId || null,
      role: "guest",
      live_session: session,
    });
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
    io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
      postId: String(postId),
      requests: CommunityLiveService.getPendingRequests(String(postId)),
      live_session: session,
    });
  });

  socket.on("community-live:leave", async ({ postId }: { postId: string }) => {
    if (!postId) return;
    socket.leave(`community-live:${postId}:viewers`);
    const beforeGuestSocketId = CommunityLiveService.publisherSocketIds(String(postId)).find((id) => id !== CommunityLiveService.hostSocketId(String(postId)));
    const session = beforeGuestSocketId === socket.id
      ? await CommunityLiveService.removeGuest(String(postId), socket.id)
      : await CommunityLiveService.removeViewer(String(postId), socket.id);
    if (beforeGuestSocketId === socket.id) {
      socket.leave(`community-live:${postId}:publishers`);
      io.to(`community-live:${postId}:viewers`).emit("community-live:publisher-left", {
        postId: String(postId),
        publisherSocketId: socket.id,
        role: "guest",
        live_session: session,
      });
      io.to(`community-live:${postId}:host`).emit("community-live:guest-requests", {
        postId: String(postId),
        requests: CommunityLiveService.getPendingRequests(String(postId)),
        live_session: session,
      });
    } else {
      io.to(`community-live:${postId}:publishers`).emit("community-live:viewer-left", {
        postId: String(postId),
        viewerSocketId: socket.id,
        live_session: session,
      });
    }
    io.to(`community-live:${postId}:viewers`).emit("community-live:stats", {
      postId: String(postId),
      live_session: session,
    });
  });

  socket.on("disconnect", async () => {
    const impacted = await CommunityLiveService.detachSocket(socket.id);
    for (const item of impacted) {
      io.to(`community-live:${item.postId}:viewers`).emit("community-live:stats", {
        postId: item.postId,
        live_session: item.session,
      });
      io.to(`community-live:${item.postId}:host`).emit("community-live:guest-requests", {
        postId: item.postId,
        requests: item.requests,
        live_session: item.session,
      });
      if (item.guestLeft) {
        io.to(`community-live:${item.postId}:viewers`).emit("community-live:publisher-left", {
          postId: item.postId,
          publisherSocketId: socket.id,
          role: "guest",
          live_session: item.session,
        });
      }
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
    await CommunityLiveService.init();
    console.log("🟢 Community live session cache initialized");

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
