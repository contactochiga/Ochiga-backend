import { runtimeTraceFields } from "./runtimeContext";

export type LogLevel = "debug" | "info" | "warn" | "error";

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return error;
}

function normalizePayload(payload?: Record<string, unknown>) {
  if (!payload) return {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    next[key] = key === "error" ? serializeError(value) : value;
  }
  return next;
}

export function log(level: LogLevel, message: string, payload?: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...runtimeTraceFields(),
    ...normalizePayload(payload),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  debug(message: string, payload?: Record<string, unknown>) {
    log("debug", message, payload);
  },
  info(message: string, payload?: Record<string, unknown>) {
    log("info", message, payload);
  },
  warn(message: string, payload?: Record<string, unknown>) {
    log("warn", message, payload);
  },
  error(message: string, payload?: Record<string, unknown>) {
    log("error", message, payload);
  },
};
