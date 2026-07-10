import type { Response } from "express";
import { logger } from "../observability/logger";

export type PublicApiErrorShape = {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, any> | null;
};

export class PublicApiError extends Error {
  statusCode: number;
  code: string;
  details: Record<string, any> | null;

  constructor(input: PublicApiErrorShape) {
    super(input.message);
    this.name = "PublicApiError";
    this.statusCode = input.statusCode;
    this.code = input.code;
    this.details = input.details || null;
  }
}

export function createPublicApiError(statusCode: number, code: string, message: string, details?: Record<string, any> | null) {
  return new PublicApiError({ statusCode, code, message, details });
}

function normalizeError(error: any, fallback: PublicApiErrorShape) {
  if (error instanceof PublicApiError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  const statusCode = Number(error?.statusCode || error?.status || fallback.statusCode);
  const code = String(error?.code || fallback.code || "internal_error").trim() || "internal_error";
  const message = String(error?.publicMessage || fallback.message || "Request failed").trim() || "Request failed";
  return {
    statusCode: Number.isFinite(statusCode) ? statusCode : fallback.statusCode,
    code,
    message,
    details: null,
  };
}

export function sendPublicApiError(
  res: Response,
  error: any,
  fallback: PublicApiErrorShape,
  logContext: Record<string, any> = {},
) {
  const next = normalizeError(error, fallback);
  logger.error("public_api_error", {
    ...logContext,
    status_code: next.statusCode,
    code: next.code,
    public_message: next.message,
    internal_error: error?.message || String(error),
    stack: error?.stack || null,
  });
  return res.status(next.statusCode).json({
    error: next.message,
    code: next.code,
  });
}
