/// src/config/redis.ts
import { createClient } from "redis";

const useTls = process.env.REDIS_TLS === "true";

export const redis = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    tls: useTls ? {} : undefined,   // <- FIXED TypeScript error
  },
  password: process.env.REDIS_PASSWORD,
});

// Events
redis.on("connect", () => {
  console.log("🟢 Redis connected");
});

redis.on("error", (err) => {
  console.error("🔴 Redis Error:", err);
});

// IMPORTANT: Do NOT auto-connect here.
// server.ts will call redis.connect()
export default redis;
