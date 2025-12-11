// src/config/redis.ts
import { createClient } from "redis";

export const redis = createClient({
  socket: {
    host: process.env.REDIS_HOST!,
    port: Number(process.env.REDIS_PORT!),
    tls: {}, // REQUIRED FOR Redis Cloud (Fixes SSL wrong version error)
  },
  password: process.env.REDIS_PASSWORD!,
});

redis.on("connect", () => {
  console.log("🟢 Redis connected");
});

redis.on("error", (err) => {
  console.error("🔴 Redis Error:", err);
});

export async function initRedis() {
  try {
    await redis.connect();
  } catch (error) {
    console.error("🔴 Redis connection failed:", error);
  }
}
