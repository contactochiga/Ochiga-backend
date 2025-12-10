// src/config/redis.ts
import { createClient } from "redis";

export const redis = createClient({
  url: `rediss://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
  password: process.env.REDIS_PASSWORD,
});

redis.on("connect", () => {
  console.log("✅ Redis connected (TLS)");
});

redis.on("error", (err) => {
  console.error("❌ Redis Error:", err);
});

// Proper function for connecting Redis without top-level await
export async function initRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
}
