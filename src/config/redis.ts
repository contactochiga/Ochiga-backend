// src/config/redis.ts
import { createClient } from "redis";

let redis: any = null;

export async function initRedis() {
  if (redis) return redis; // prevent duplicate clients

  const useTls = process.env.REDIS_TLS === "true";

  redis = createClient({
    socket: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      tls: useTls ? {} : undefined,
    },
    password: process.env.REDIS_PASSWORD,
  });

  redis.on("connect", () => {
    console.log("🟢 Redis connected");
  });

  redis.on("error", (err) => {
    console.error("🔴 Redis Error:", err);
  });

  await redis.connect();
  return redis;
}

export { redis };
