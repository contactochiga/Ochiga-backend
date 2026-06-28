// src/config/redis.ts
import { createClient } from "redis";
import { logger } from "../observability/logger";
import { operationalMetrics } from "../observability/metrics";
import { runtimeHealthRegistry } from "../observability/runtimeHealth";

/**
 * Redis MUST be configured via REDIS_URL
 * Example:
 * redis://:password@host:port
 */
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  throw new Error("❌ Missing env var: REDIS_URL");
}

export const redis = createClient({
  url: REDIS_URL,
});

/* -----------------------
 * EVENTS
 * --------------------- */
redis.on("connect", () => {
  runtimeHealthRegistry.markQueue("healthy", "redis connected");
  logger.info("redis_connected");
});

redis.on("ready", () => {
  runtimeHealthRegistry.markQueue("healthy", "redis ready");
  logger.info("redis_ready");
});

redis.on("error", (err) => {
  operationalMetrics.increment("oyi_provider_failures_total", { provider: "redis" });
  runtimeHealthRegistry.markQueue("offline", err.message);
  logger.error("redis_error", { error: err });
  process.exit(1); // ⛔ fail fast, no infinite loops
});

export default redis;
