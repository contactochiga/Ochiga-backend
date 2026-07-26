import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { operationalMetrics, observeDuration } from "./metrics";
import { logger } from "./logger";
import { createRuntimeContext, runtimeTraceFields, withRuntimeContext } from "./runtimeContext";
import { runtimeHealthRegistry } from "./runtimeHealth";
import { providerHealthRegistry } from "./providerHealth";
import { redis } from "../config/redis";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { startRequestStageTiming } from "./requestStageTiming";
import pkg from "../../package.json";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      correlationId?: string;
      runtimeId?: string;
    }
  }
}

function value(input: unknown) {
  const text = String(input || "").trim();
  return text || "";
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  startRequestStageTiming(req);
  const requestId = value(req.headers["x-request-id"]) || randomUUID();
  const correlationId = value(req.headers["x-correlation-id"]) || requestId;
  const runtimeId = value(req.headers["x-runtime-id"]) || randomUUID();
  req.requestId = requestId;
  req.correlationId = correlationId;
  req.runtimeId = runtimeId;
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-correlation-id", correlationId);
  res.setHeader("x-runtime-id", runtimeId);
  const estateId = value(req.headers["x-estate-id"] || req.query.estate_id || req.query.estateId || req.body?.estate_id || req.body?.estateId) || null;
  const deviceId = value(req.body?.device_id || req.body?.deviceId || req.params?.deviceId) || null;
  const context = createRuntimeContext({
    requestId,
    correlationId,
    runtimeId,
    estateId,
    deviceId,
    producer: "http",
    consumer: "backend",
  });
  withRuntimeContext(context, () => next());
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    operationalMetrics.increment("http_requests_total", {
      method: req.method,
      route: req.route?.path || req.path,
      status_code: res.statusCode,
    });
    operationalMetrics.observe("http_request_duration_ms", durationMs, {
      method: req.method,
      route: req.route?.path || req.path,
      status_code: res.statusCode,
    });
    runtimeHealthRegistry.markStage("http.request", durationMs);
    logger.info("http_request_completed", {
      method: req.method,
      path: req.originalUrl,
      status_code: res.statusCode,
      duration_ms: durationMs,
      user_agent: req.headers["user-agent"] || "",
      ...runtimeTraceFields(),
    });
  });
  next();
}

async function databaseHealth() {
  try {
    const startedAt = Date.now();
    const { error } = await supabaseAdmin.from("users").select("id").limit(1);
    if (error) {
      runtimeHealthRegistry.markDatabase("degraded", error.message);
      return { status: "degraded", detail: error.message, latency_ms: Date.now() - startedAt };
    }
    runtimeHealthRegistry.markDatabase("healthy", "supabase reachable");
    return { status: "healthy", detail: "supabase reachable", latency_ms: Date.now() - startedAt };
  } catch (error: any) {
    runtimeHealthRegistry.markDatabase("offline", error?.message || "database unreachable");
    return { status: "offline", detail: error?.message || "database unreachable", latency_ms: null };
  }
}

async function queueHealth() {
  try {
    const startedAt = Date.now();
    await redis.ping();
    runtimeHealthRegistry.markQueue("healthy", "redis reachable");
    return { status: "healthy", detail: "redis reachable", latency_ms: Date.now() - startedAt };
  } catch (error: any) {
    runtimeHealthRegistry.markQueue("offline", error?.message || "redis unreachable");
    return { status: "offline", detail: error?.message || "redis unreachable", latency_ms: null };
  }
}

export async function healthSummary() {
  const [database, queue] = await Promise.all([databaseHealth(), queueHealth()]);
  return {
    status: database.status === "healthy" && queue.status === "healthy" ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    runtime: runtimeHealthRegistry.stageSnapshot(),
    socket: runtimeHealthRegistry.summary().socket,
    database,
    queue,
    providers: providerHealthRegistry.snapshot(),
  };
}

export async function healthHandler(_req: Request, res: Response) {
  const summary = await healthSummary();
  res.status(summary.status === "ok" ? 200 : 503).json(summary);
}

export function versionHandler(_req: Request, res: Response) {
  res.json({
    service: "oyi-backend",
    package_version: pkg.version || null,
    commit_sha: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || null,
    deployed_at: process.env.RENDER_DEPLOY_CREATED_AT || process.env.DEPLOYED_AT || null,
    environment: process.env.NODE_ENV || null,
  });
}

export async function runtimeHealthHandler(_req: Request, res: Response) {
  const summary = await healthSummary();
  res.json({
    ...summary,
    runtime_trace: runtimeTraceFields(),
    observability: runtimeHealthRegistry.summary(),
  });
}

export function metricsHandler(_req: Request, res: Response) {
  observeDuration("metrics_render_duration_ms", Date.now());
  res.setHeader("content-type", "text/plain; version=0.0.4");
  res.send(operationalMetrics.toPrometheus());
}
