// src/config/redis.ts
import { createClient } from "redis";

const useTls = process.env.REDIS_TLS === "true";

export const redis = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    tls: useTls ? true : false,   // IMPORTANT: boolean, not object
  },
  password: process.env.REDIS_PASSWORD,
});

// Logs
redis.on("connect", () => {
  console.log("🟢 Redis connected");
});

redis.on("error", (err) => {
  console.error("🔴 Redis Error:", err);
});

export default redis;
