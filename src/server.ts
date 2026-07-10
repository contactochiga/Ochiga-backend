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
import { setIO } from "./realtime/io";
import { authenticateSocket, canUseSocket, denySocket } from "./socketAuth";

// ✅ INTENT WORKER (BullMQ)
import { startIntentWorker } from "./workers/intentWorker";
import { CommunityLiveService } from "./services/communityLiveService";
import { hasPermission } from "./core/foundation";
import { supabaseAdmin } from "./supabase/supabaseClient";
import { logger } from "./observability/logger";
import { operationalMetrics } from "./observability/metrics";
import { runtimeHealthRegistry } from "./observability/runtimeHealth";
import { socketCorsOptions } from "./config/originPolicy";

// ---------------------------
// HTTP + WEBSOCKET SERVER
// ---------------------------
const httpServer = http.createServer(app);

export const io = new IOServer(httpServer, {
  cors: socketCorsOptions,
});
setIO(io);

async function canAccessHomeSocketResource(user: any, homeId: string) {
  if (!user?.id || !homeId) return false;
  if (hasPermission(user, "office.read")) return true;
  if (String(user.home_id || "") === String(homeId)) return true;
  const { data: home } = await supabaseAdmin.from("homes").select("estate_id").eq("id", homeId).maybeSingle();
  if (!home) return false;
  const [{ data: membership }, { data: estateMembership }] = await Promise.all([
    supabaseAdmin.from("home_memberships").select("id").eq("home_id", homeId).eq("user_id", user.id).eq("status", "active").maybeSingle(),
    supabaseAdmin.from("estate_memberships").select("id,role").eq("estate_id", home.estate_id).eq("user_id", user.id).eq("status", "active").maybeSingle(),
  ]);
  const estateRole = String(estateMembership?.role || "").toLowerCase();
  const isEstateOperator = ["facility_manager", "security_operator", "maintenance_operator", "finance_operator", "estate_admin", "ochiga_admin", "super_admin"].includes(estateRole);
  return Boolean(membership || isEstateOperator);
}

async function canAccessThreadSocketResource(user: any, threadId: string) {
  if (!user?.id || !threadId) return false;
  if (hasPermission(user, "office.read")) return true;
  const { data: member } = await supabaseAdmin
    .from("dm_thread_members")
    .select("id")
    .eq("thread_id", threadId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(member);
}

async function canAccessCommunityPostSocketResource(user: any, postId: string) {
  if (!user?.id || !postId) return false;
  if (hasPermission(user, "office.read")) return true;
  const { data: post } = await supabaseAdmin.from("community_posts").select("estate_id").eq("id", postId).maybeSingle();
  if (!post?.estate_id) return false;
  const { data: membership } = await supabaseAdmin
    .from("estate_memberships")
    .select("id")
    .eq("estate_id", post.estate_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(membership);
}

io.use(authenticateSocket);

// ---------------------------
// SOCKET.IO CONNECTIONS
// ---------------------------
io.on("connection", (socket) => {
  operationalMetrics.increment("oyi_socket_events_total", { event: "connection" });
  runtimeHealthRegistry.markSocketConnected(io.of("/").sockets.size);
  logger.info("socket_connected", {
    socket_id: socket.id,
    user_id: socket.data.user?.id || null,
  });

  socket.on("subscribe:estate", (estateId: string) => {
    if (!canUseSocket(socket, "estates.read")) return denySocket(socket, "estates.read", "estate", String(estateId || ""));
    const user = socket.data.user;
    if (user?.estate_id && String(user.estate_id) !== String(estateId) && !canUseSocket(socket, "office.read")) {
      return denySocket(socket, "estates.read", "estate", String(estateId || ""));
    }
    socket.join(`estate:${estateId}`);
  });

  socket.on("subscribe:user", (userId: string) => {
    if (String(socket.data.user?.id || "") !== String(userId || "") && !canUseSocket(socket, "staff.manage")) {
      return denySocket(socket, "staff.manage", "user", String(userId || ""));
    }
    socket.join(`user:${userId}`);
  });

  socket.on("subscribe:room", async (roomId: string) => {
    if (!canUseSocket(socket, "homes.read")) return denySocket(socket, "homes.read", "room", String(roomId || ""));
    const { data: room } = await supabaseAdmin.from("rooms").select("home_id").eq("id", roomId).maybeSingle();
    if (!room?.home_id || !await canAccessHomeSocketResource(socket.data.user, String(room.home_id))) {
      return denySocket(socket, "homes.read", "room", String(roomId || ""));
    }
    socket.join(`room:${roomId}`);
  });

  socket.on("subscribe:home", async (homeId: string) => {
    if (!canUseSocket(socket, "homes.read")) return denySocket(socket, "homes.read", "home", String(homeId || ""));
    if (!await canAccessHomeSocketResource(socket.data.user, String(homeId || ""))) {
      return denySocket(socket, "homes.read", "home", String(homeId || ""));
    }
    socket.join(`home:${homeId}`);
  });

  socket.on("subscribe:thread", async (threadId: string) => {
    if (!canUseSocket(socket, "support.read")) return denySocket(socket, "support.read", "thread", String(threadId || ""));
    if (!await canAccessThreadSocketResource(socket.data.user, String(threadId || ""))) {
      return denySocket(socket, "support.read", "thread", String(threadId || ""));
    }
    socket.join(`thread:${threadId}`);
  });

  socket.on("community-live:host:join", async ({ postId }: { postId: string }) => {
    if (!postId) return;
    if (!canUseSocket(socket, "community.write")) return denySocket(socket, "community.write", "community_post", String(postId));
    if (!await canAccessCommunityPostSocketResource(socket.data.user, String(postId))) return denySocket(socket, "community.read", "community_post", String(postId));
    console.log("[community-live] host join", { postId: String(postId), socketId: socket.id });
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
    if (!canUseSocket(socket, "community.write")) return denySocket(socket, "community.write", "community_post", String(postId));
    if (!await canAccessCommunityPostSocketResource(socket.data.user, String(postId))) return denySocket(socket, "community.read", "community_post", String(postId));
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
    if (!canUseSocket(socket, "community.read")) return denySocket(socket, "community.read", "community_post", String(postId));
    if (!await canAccessCommunityPostSocketResource(socket.data.user, String(postId))) return denySocket(socket, "community.read", "community_post", String(postId));
    console.log("[community-live] viewer join", {
      postId: String(postId),
      socketId: socket.id,
      userId: String(userId || ""),
      userName: String(userName || ""),
    });
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
    async ({
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
      if (!canUseSocket(socket, "community.read")) return denySocket(socket, "community.read", "community_post", String(postId));
      if (!await canAccessCommunityPostSocketResource(socket.data.user, String(postId))) return denySocket(socket, "community.read", "community_post", String(postId));
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
      if (!canUseSocket(socket, "community.write")) return denySocket(socket, "community.write", "community_post", String(postId));
      if (!await canAccessCommunityPostSocketResource(socket.data.user, String(postId))) return denySocket(socket, "community.read", "community_post", String(postId));
      console.log("[community-live] guest request", {
        postId: String(postId),
        socketId: socket.id,
        userId: String(userId || ""),
        userName: String(userName || ""),
        hostSocketId: CommunityLiveService.hostSocketId(String(postId)),
      });
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
      io.to(`community-live:${postId}:viewers`).emit("community-live:guest-requests", {
        postId: String(postId),
        requests: result.requests,
        live_session: result.session,
      });
    }
  );

  socket.on("community-live:guest:approve", async ({ postId, viewerSocketId }: { postId: string; viewerSocketId: string }) => {
    if (!postId || !viewerSocketId) return;
    if (!canUseSocket(socket, "community.write")) return denySocket(socket, "community.write", "community_post", String(postId));
    if (!await canAccessCommunityPostSocketResource(socket.data.user, String(postId))) return denySocket(socket, "community.read", "community_post", String(postId));
    console.log("[community-live] guest approve", {
      postId: String(postId),
      hostSocketId: socket.id,
      viewerSocketId: String(viewerSocketId),
    });
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
    if (!canUseSocket(socket, "community.write")) return denySocket(socket, "community.write", "community_post", String(postId));
    if (!await canAccessCommunityPostSocketResource(socket.data.user, String(postId))) return denySocket(socket, "community.read", "community_post", String(postId));
    console.log("[community-live] guest reject", {
      postId: String(postId),
      hostSocketId: socket.id,
      viewerSocketId: String(viewerSocketId),
    });
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
      if (!canUseSocket(socket, "community.write")) return denySocket(socket, "community.write", "community_post", String(postId));
      if (!await canAccessCommunityPostSocketResource(socket.data.user, String(postId))) return denySocket(socket, "community.read", "community_post", String(postId));
      console.log("[community-live] guest join", {
        postId: String(postId),
        socketId: socket.id,
        userId: String(userId || ""),
        userName: String(userName || ""),
      });
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
    if (!canUseSocket(socket, "community.write")) return denySocket(socket, "community.write", "community_post", String(postId));
    if (!await canAccessCommunityPostSocketResource(socket.data.user, String(postId))) return denySocket(socket, "community.read", "community_post", String(postId));
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

  socket.on(
    "community-live:chat:send",
    async ({ postId, userId, userName, text }: { postId: string; userId?: string; userName?: string; text?: string }) => {
      if (!postId) return;
      if (!canUseSocket(socket, "community.write")) return denySocket(socket, "community.write", "community_post", String(postId));
      if (!await canAccessCommunityPostSocketResource(socket.data.user, String(postId))) return denySocket(socket, "community.read", "community_post", String(postId));
      const message = CommunityLiveService.addChatMessage({
        postId: String(postId),
        userId,
        userName,
        text,
      });
      if (!message) return;
      io.to(`community-live:${postId}:viewers`).emit("community-live:chat", {
        postId: String(postId),
        message,
      });
      io.to(`community-live:${postId}:host`).emit("community-live:chat", {
        postId: String(postId),
        message,
      });
    }
  );

  socket.on("community-live:leave", async ({ postId }: { postId: string }) => {
    if (!postId) return;
    if (!canUseSocket(socket, "community.read")) return denySocket(socket, "community.read", "community_post", String(postId));
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
    operationalMetrics.increment("oyi_socket_events_total", { event: "disconnect" });
    runtimeHealthRegistry.markSocketConnected(Math.max(0, io.of("/").sockets.size - 1));
    logger.info("socket_disconnected", {
      socket_id: socket.id,
      user_id: socket.data.user?.id || null,
    });
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
  logger.info("server_listening", { port: PORT });

  try {
    await CommunityLiveService.init();
    logger.info("community_live_initialized");

    // ---------------------------
    // CONNECT REDIS
    // ---------------------------
    await redis.connect();
    logger.info("redis_connect_complete");

    // ---------------------------
    // START INTENT WORKER (BullMQ)
    // ---------------------------
    startIntentWorker();
    logger.info("intent_worker_running");

    // ---------------------------
    // START MQTT BRIDGE
    // ---------------------------
    await initMqttBridge();
    logger.info("mqtt_bridge_initialized");

    // ---------------------------
    // START EVENT PROCESSOR
    // ---------------------------
    startEventProcessor();
    runtimeHealthRegistry.markQueue("healthy", "intent worker and event processor running");
    logger.info("event_processor_running");

    logger.info("backend_fully_online");
  } catch (error) {
    operationalMetrics.increment("oyi_provider_failures_total", { provider: "bootstrap" });
    logger.error("backend_startup_failed", { error });
    process.exit(1);
  }
});
