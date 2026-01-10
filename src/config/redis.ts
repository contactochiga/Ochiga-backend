// src/config/redis.ts
import { createClient } from "redis";

function requireNumber(name: string, fallback?: number): number {
  const raw = process.env[name];

  if (!raw) {
    if (fallback !== undefined) return fallback;
    throw new Error(`❌ Missing required env var: ${name}`);
  }

  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`❌ Env var ${name} must be a number. Got: ${raw}`);
  }

  return value;
}

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = requireNumber("REDIS_PORT", 6379);
const REDIS_TLS = process.env.REDIS_TLS === "true";
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

export const redis = createClient({
  socket: {
    host: REDIS_HOST,
    port: REDIS_PORT,
    tls: REDIS_TLS || undefined, // IMPORTANT: undefined if false
  },
  password: REDIS_PASSWORD,
});

redis.on("connect", () => {
  console.log(`🟢 Redis connected (${REDIS_HOST}:${REDIS_PORT})`);
});

redis.on("error", (err) => {
  console.error("🔴 Redis Error:", err.message);
});

export default redis;
