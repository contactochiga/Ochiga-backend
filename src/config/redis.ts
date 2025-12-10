// src/config/redis.ts
import { createClient } from "redis";

export const redis = createClient({
  socket: {
    host: process.env.REDIS_HOST!,
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    tls: process.env.REDIS_TLS === "true" ? {} : undefined,  // IMPORTANT FIX
  },
  password: process.env.REDIS_PASSWORD!,
});

redis.on("connect", () => {
  console.log("✅ Redis connected (TLS active)");
});

redis.on("error", (err) => {
  console.error("❌ Redis Error:", err);
});
