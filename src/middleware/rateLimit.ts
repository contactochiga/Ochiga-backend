import type { NextFunction, Request, Response } from "express";

type RateLimitConfig = {
  key: string;
  windowMs: number;
  max: number;
  message: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function firstIp(value: string) {
  return value.split(",")[0]?.trim() || "unknown";
}

function requestIp(req: Request) {
  const forwarded = typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : "";
  return firstIp(forwarded || req.ip || req.socket.remoteAddress || "unknown");
}

function bucketKey(scope: string, id: string) {
  return `${scope}:${id}`;
}

function cleanup(current: number) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= current) buckets.delete(key);
  }
}

export function createRateLimit(config: RateLimitConfig) {
  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const current = Date.now();
    const principal = String((req as any)?.user?.id || requestIp(req) || "anonymous");
    const key = bucketKey(config.key, principal);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= current) {
      buckets.set(key, { count: 1, resetAt: current + config.windowMs });
      cleanup(current);
      return next();
    }

    bucket.count += 1;
    if (bucket.count <= config.max) return next();

    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - current) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      ok: false,
      error: config.message,
      retry_after_seconds: retryAfter,
    });
  };
}

export function createSocketRateLimit(config: RateLimitConfig) {
  return function socketRateLimit(id: string) {
    const current = Date.now();
    const key = bucketKey(config.key, id || "anonymous");
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= current) {
      buckets.set(key, { count: 1, resetAt: current + config.windowMs });
      cleanup(current);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    if (bucket.count <= config.max) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)),
    };
  };
}

export const authRateLimit = createRateLimit({
  key: "auth",
  windowMs: 60_000,
  max: 40,
  message: "Too many authentication attempts. Please wait and try again.",
});

export const aiRateLimit = createRateLimit({
  key: "ai",
  windowMs: 60_000,
  max: 60,
  message: "Too many AI requests. Please slow down and retry shortly.",
});

export const runtimeRateLimit = createRateLimit({
  key: "runtime",
  windowMs: 60_000,
  max: 120,
  message: "Too many runtime requests. Please retry shortly.",
});

export const signalIngressRateLimit = createRateLimit({
  key: "signals",
  windowMs: 60_000,
  max: 180,
  message: "Too many signal ingestion requests. Please retry shortly.",
});

export const socketAuthRateLimit = createSocketRateLimit({
  key: "socket-auth",
  windowMs: 60_000,
  max: 40,
  message: "Too many socket authentication attempts.",
});
