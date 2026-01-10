// src/config/redis.ts
import { createClient } from "redis";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`❌ Missing env var: ${name}`);
  }
  return value;
}

const REDIS_HOST = requireEnv("REDIS_HOST");
const REDIS_PORT = Number(requireEnv("REDIS_PORT"));
const REDIS_PASSWORD = requireEnv("REDIS_PASSWORD");
const REDIS_TLS = process.env.REDIS_TLS === "true";

export const redis = createClient({
  socket: {
    host: REDIS_HOST,
    port: REDIS_PORT,
    tls: REDIS_TLS,
  },
  password: REDIS_PASSWORD,
});

redis.on("connect", () => {
  console.log("🟢 Redis connected");
});

redis.on("error", (err) => {
  console.error("🔴 Redis error:", err.message);
  process.exit(1); // ⛔ STOP infinite loops
});

export default redis;
