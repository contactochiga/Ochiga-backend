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
import { initMqttBridge, shutdownMqttBridge } from "./device/bridge";
import { startEventProcessor } from "./event-processor/eventProcessor";
import { setIO } from "./realtime/io";
import { authenticateSocket, canUseSocket, denySocket } from "./socketAuth";

// ✅ INTENT WORKER (BullMQ)
import { startIntentWorker } from "./workers/intentWorker";
import { CommunityLiveService } from "./services/communityLiveService";
import {
  emitCommunicationSocketDisconnect,
  registerGenericCommunicationSocketHandlers,
  registerCommunityCommunicationSocketHandlers,
} from "./services/communications/communicationsSocketHandlers";
import { hasPermission } from "./core/foundation";
import { supabaseAdmin } from "./supabase/supabaseClient";
import { logger } from "./observability/logger";
import { operationalMetrics } from "./observability/metrics";
import { runtimeHealthRegistry } from "./observability/runtimeHealth";
import { socketCorsOptions } from "./config/originPolicy";
import { deviceRuntimeStateService } from "./services/deviceRuntimeStateService";
import { startAutomationRuntimeV2Scheduler, stopAutomationRuntimeV2Scheduler } from "./routes/scenes";
import { startGoalRuntimeScheduler, stopGoalRuntimeScheduler } from "./services/goalRuntime/goalScheduler";
import { flushConversationTraceWrites } from "./oyi-core/observability/conversationTraceRecorder";

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

async function canHostCommunityPostSocketResource(user: any, postId: string) {
  if (!user?.id || !postId) return false;
  if (hasPermission(user, "community.moderate") || hasPermission(user, "office.read")) return true;
  const { data: post } = await supabaseAdmin
    .from("community_posts")
    .select("author_id")
    .eq("id", postId)
    .maybeSingle();
  return String((post as any)?.author_id || "") === String(user.id || "");
}

io.use(authenticateSocket);

// A Socket.IO/EventEmitter listener's return value is never awaited or
// caught by the emitter itself -- an async listener that rejects (e.g. an
// awaited Supabase call failing) becomes a process-fatal unhandled
// rejection with zero chance of being caught anywhere else. Reproduced and
// confirmed in production (2026-09-29 15:02/15:05 UTC) for every async
// listener below; wrap each one so a rejection is logged, not fatal.
function safeSocketHandler<Args extends unknown[]>(event: string, handler: (...args: Args) => Promise<unknown>) {
  return (...args: Args) => {
    handler(...args).catch((error) => {
      logger.error("socket_handler_rejected", { event, error, socket_data_present: args.length > 0 });
    });
  };
}

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

  socket.on("subscribe:room", safeSocketHandler("subscribe:room", async (roomId: string) => {
    if (!canUseSocket(socket, "homes.read")) return denySocket(socket, "homes.read", "room", String(roomId || ""));
    const { data: room } = await supabaseAdmin.from("rooms").select("home_id").eq("id", roomId).maybeSingle();
    if (!room?.home_id || !await canAccessHomeSocketResource(socket.data.user, String(room.home_id))) {
      return denySocket(socket, "homes.read", "room", String(roomId || ""));
    }
    socket.join(`room:${roomId}`);
  }));

  socket.on("subscribe:home", safeSocketHandler("subscribe:home", async (homeId: string) => {
    if (!canUseSocket(socket, "homes.read")) return denySocket(socket, "homes.read", "home", String(homeId || ""));
    if (!await canAccessHomeSocketResource(socket.data.user, String(homeId || ""))) {
      return denySocket(socket, "homes.read", "home", String(homeId || ""));
    }
    socket.join(`home:${homeId}`);
  }));

  socket.on("scope:replace", safeSocketHandler("scope:replace", async (scope: { estate_id?: string; estateId?: string; home_id?: string; homeId?: string }) => {
    const estateId = String(scope?.estate_id || scope?.estateId || "").trim();
    const homeId = String(scope?.home_id || scope?.homeId || "").trim();
    const user = socket.data.user;

    if (estateId) {
      if (!canUseSocket(socket, "estates.read")) return denySocket(socket, "estates.read", "estate", estateId);
      if (user?.estate_id && String(user.estate_id) !== estateId && !canUseSocket(socket, "office.read")) {
        return denySocket(socket, "estates.read", "estate", estateId);
      }
    }
    if (homeId) {
      if (!canUseSocket(socket, "homes.read")) return denySocket(socket, "homes.read", "home", homeId);
      if (!await canAccessHomeSocketResource(user, homeId)) {
        return denySocket(socket, "homes.read", "home", homeId);
      }
    }

    for (const room of Array.from(socket.rooms)) {
      if (room === socket.id) continue;
      if (/^(estate|home|room|device|thread):/.test(String(room))) socket.leave(room);
    }
    if (estateId) socket.join(`estate:${estateId}`);
    if (homeId) socket.join(`home:${homeId}`);
    socket.data.active_scope = { estate_id: estateId || null, home_id: homeId || null };
    socket.emit("scope:active", socket.data.active_scope);
  }));

  socket.on("subscribe:device", safeSocketHandler("subscribe:device", async (deviceId: string) => {
    if (!canUseSocket(socket, "devices.read")) return denySocket(socket, "devices.read", "device", String(deviceId || ""));
    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id,estate_id,home_id")
      .eq("id", String(deviceId || ""))
      .maybeSingle();
    if (!device?.id) return denySocket(socket, "devices.read", "device", String(deviceId || ""));
    const user = socket.data.user;
    const estateAllowed = String(user?.estate_id || "") === String(device.estate_id || "") || canUseSocket(socket, "office.read");
    const homeAllowed = device.home_id
      ? await canAccessHomeSocketResource(user, String(device.home_id))
      : canUseSocket(socket, "devices.control");
    if (!estateAllowed || !homeAllowed) return denySocket(socket, "devices.read", "device", String(deviceId || ""));
    socket.join(`device:${device.id}`);
  }));

  socket.on("subscribe:thread", safeSocketHandler("subscribe:thread", async (threadId: string) => {
    if (!canUseSocket(socket, "support.read")) return denySocket(socket, "support.read", "thread", String(threadId || ""));
    if (!await canAccessThreadSocketResource(socket.data.user, String(threadId || ""))) {
      return denySocket(socket, "support.read", "thread", String(threadId || ""));
    }
    socket.join(`thread:${threadId}`);
  }));

  registerCommunityCommunicationSocketHandlers(io, socket, {
    canAccessCommunityPost: canAccessCommunityPostSocketResource,
    canHostCommunityPost: canHostCommunityPostSocketResource,
  });
  registerGenericCommunicationSocketHandlers(io, socket);

  socket.on("disconnect", safeSocketHandler("disconnect", async () => {
    operationalMetrics.increment("oyi_socket_events_total", { event: "disconnect" });
    runtimeHealthRegistry.markSocketConnected(Math.max(0, io.of("/").sockets.size - 1));
    logger.info("socket_disconnected", {
      socket_id: socket.id,
      user_id: socket.data.user?.id || null,
    });
    await emitCommunicationSocketDisconnect(io, socket.id);
  }));
});

// ---------------------------
// START FULL BACKEND STACK
// ---------------------------
httpServer.listen(PORT, async () => {
  logger.info("server_listening", { port: PORT });

  try {
    deviceRuntimeStateService.start();
    startAutomationRuntimeV2Scheduler();
    startGoalRuntimeScheduler();
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

let shuttingDown = false;
async function gracefulShutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("backend_shutdown_started", { signal });
  const deadline = setTimeout(() => {
    logger.error("backend_shutdown_forced", { signal, timeout_ms: 10_000 });
    process.exit(1);
  }, 10_000);
  deadline.unref?.();
  try {
    deviceRuntimeStateService.stop();
    stopAutomationRuntimeV2Scheduler();
    stopGoalRuntimeScheduler();
    io.close();
    await shutdownMqttBridge().catch((error) => logger.warn("mqtt_bridge_shutdown_failed", { error }));
    if (redis.isOpen) await redis.quit().catch((error) => logger.warn("redis_shutdown_failed", { error }));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    // Slice 7 -- give in-flight durable trace writes (fire-and-forget,
    // off the response path) a bounded chance to land before exit. Never
    // blocks shutdown beyond 2s; a dropped trace is best-effort telemetry.
    await Promise.race([flushConversationTraceWrites(), new Promise((resolve) => setTimeout(resolve, 2_000).unref?.())]).catch(() => undefined);
    clearTimeout(deadline);
    logger.info("backend_shutdown_complete", { signal });
    process.exit(0);
  } catch (error) {
    clearTimeout(deadline);
    logger.error("backend_shutdown_failed", { signal, error });
    process.exit(1);
  }
}

process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => void gracefulShutdown("SIGINT"));

// Defense in depth: Node's default unhandledRejections=throw mode turns any
// rejection with no attached handler into a fatal uncaught exception that
// kills the process (confirmed in production 2026-09-29 15:02/15:05 UTC,
// twice in three minutes, via unguarded async Socket.IO listeners -- see
// safeSocketHandler above and emitSignalSafely in realtime/emitSignal.ts
// for the specific fixes). This is the last-resort net for anything not
// covered by those specific fixes -- it logs with the real object shape
// instead of Node's opaque "#<Object>" summary, and never re-throws.
process.on("unhandledRejection", (reason) => {
  operationalMetrics.increment("oyi_unhandled_rejection_total");
  logger.error("unhandled_rejection", {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
  });
});
