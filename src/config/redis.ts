// src/config/redis.ts
import { createClient } from "redis";

// Redis Cloud requires TLS + password
export const redis = createClient({
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    tls: process.env.REDIS_TLS === "true" ? {} : undefined,
  },
});

redis.on("connect", () => {
  console.log("✅ Redis connected to cloud");
});

redis.on("error", (err) => {
  console.error("❌ Redis Error:", err);
});

(async () => {
  try {
    await redis.connect();
  } catch (err) {
    console.error("❌ Redis connection failed:", err);
  }
})();
