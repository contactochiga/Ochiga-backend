// src/config/redis.ts
import { createClient } from "redis";

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
  console.log("🟢 Redis connected");
});

redis.on("ready", () => {
  console.log("⚡ Redis ready");
});

redis.on("error", (err) => {
  console.error("🔴 Redis error:", err.message);
  process.exit(1); // ⛔ fail fast, no infinite loops
});

export default redis;
