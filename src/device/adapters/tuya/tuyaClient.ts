// src/device/adapters/tuya/tuyaClient.ts

import crypto from "crypto";
import axios, { AxiosInstance } from "axios";
import { operationalMetrics } from "../../../observability/metrics";
import { providerHealthRegistry } from "../../../observability/providerHealth";
import { classifyProviderError, ProviderRequestError } from "../../runtime/providerErrors";

/* ------------------------------------------------
 * ENV (LAZY + TYPE-SAFE)
 * ------------------------------------------------ */
const TUYA_ACCESS_ID = process.env.TUYA_ACCESS_ID;
const TUYA_ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;
const TUYA_BASE_URL = process.env.TUYA_BASE_URL;

/**
 * 🔒 Internal helper to guarantee env safety
 * Called ONLY when TuyaClient is instantiated
 */
function assertTuyaEnv(): {
  ACCESS_ID: string;
  ACCESS_SECRET: string;
  BASE_URL: string;
} {
  if (!TUYA_ACCESS_ID || !TUYA_ACCESS_SECRET || !TUYA_BASE_URL) {
    throw new Error(
      "❌ TuyaClient misconfigured: missing TUYA_ACCESS_ID, TUYA_ACCESS_SECRET or TUYA_BASE_URL"
    );
  }

  return {
    ACCESS_ID: TUYA_ACCESS_ID,
    ACCESS_SECRET: TUYA_ACCESS_SECRET,
    BASE_URL: TUYA_BASE_URL,
  };
}

type TuyaResponse<T> = {
  success: boolean;
  t?: number;
  result?: T;
  code?: number;
  msg?: string;
};

function tuyaRequestError(input: {
  code?: string | number | null;
  message?: string | null;
  httpStatus?: number | null;
  operation: string;
  cause?: unknown;
}) {
  return new ProviderRequestError({
    provider: "tuya",
    providerCode: input.code,
    providerMessage: input.message || "Unknown Tuya error",
    httpStatus: input.httpStatus,
    operation: input.operation,
    cause: input.cause,
  });
}

function recordTuyaFailure(error: unknown, action: string) {
  const classified = classifyProviderError(error, { provider: "tuya", operation: action });
  operationalMetrics.increment("oyi_provider_failures_total", {
    provider: "tuya",
    action,
    classification: classified.classification,
  });
  if (["provider_unavailable", "authentication_failed", "integration_expired"].includes(classified.classification)) {
    providerHealthRegistry.failure("tuya", error);
  }
}

export class TuyaClient {
  private client: AxiosInstance;
  private accessToken?: string;
  private tokenExpireAt = 0;

  private readonly ACCESS_ID: string;
  private readonly ACCESS_SECRET: string;

  constructor() {
    const env = assertTuyaEnv();

    this.ACCESS_ID = env.ACCESS_ID;
    this.ACCESS_SECRET = env.ACCESS_SECRET;

    this.client = axios.create({
      baseURL: env.BASE_URL,
      timeout: 15000,
    });
  }

  /* ------------------------------------------------
   * SIGNATURE
   * ------------------------------------------------ */
  private sign(
    method: string,
    pathWithQuery: string,
    body = "",
    t = Date.now().toString(),
    accessToken = ""
  ): string {
    const contentHash = crypto.createHash("sha256").update(body).digest("hex");

    // IMPORTANT: Tuya signs the "path + query" (exactly as you send it)
    const stringToSign = [method, contentHash, "", pathWithQuery].join("\n");

    const signStr = this.ACCESS_ID + accessToken + t + stringToSign;

    return crypto
      .createHmac("sha256", this.ACCESS_SECRET)
      .update(signStr)
      .digest("hex")
      .toUpperCase();
  }

  /* ------------------------------------------------
   * AUTH
   * ------------------------------------------------ */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpireAt) {
      return this.accessToken;
    }

    const startedAt = Date.now();
    const t = Date.now().toString();
    const path = "/v1.0/token?grant_type=1";
    const sign = this.sign("GET", path, "", t);

    let res;
    try {
      res = await this.client.get<TuyaResponse<{ access_token: string; expire_time: number }>>(path, {
        headers: {
          t,
          sign,
          client_id: this.ACCESS_ID,
          sign_method: "HMAC-SHA256",
        },
      });
    } catch (error) {
      const response = (error as any)?.response;
      const typed = tuyaRequestError({
        code: response?.data?.code,
        message: response?.data?.msg || response?.data?.message || (error as Error)?.message,
        httpStatus: response?.status,
        operation: "token",
        cause: error,
      });
      recordTuyaFailure(typed, "token");
      throw typed;
    }

    const token = res.data?.result?.access_token;
    const expire = res.data?.result?.expire_time;

    if (!token || !expire) {
      const error = tuyaRequestError({
        code: res.data?.code,
        message: res.data?.msg || "Tuya did not return an access token",
        operation: "token_payload",
      });
      recordTuyaFailure(error, "token_payload");
      throw error;
    }

    this.accessToken = token;
    this.tokenExpireAt = Date.now() + expire * 1000;
    providerHealthRegistry.heartbeat("tuya", { latencyMs: Date.now() - startedAt, note: "token_acquired", wired: true });

    return token;
  }

  /* ------------------------------------------------
   * REQUEST
   * ------------------------------------------------ */
  async request<T = any>(method: "GET" | "POST", pathWithQuery: string, body?: any): Promise<T> {
    const startedAt = Date.now();
    const accessToken = await this.getAccessToken();
    const t = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : "";

    const sign = this.sign(method, pathWithQuery, bodyStr, t, accessToken);

    let res;
    try {
      res = await this.client.request<TuyaResponse<T>>({
        method,
        url: pathWithQuery,
        data: body,
        headers: {
          t,
          sign,
          client_id: this.ACCESS_ID,
          access_token: accessToken,
          sign_method: "HMAC-SHA256",
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      const response = (error as any)?.response;
      const typed = tuyaRequestError({
        code: response?.data?.code,
        message: response?.data?.msg || response?.data?.message || (error as Error)?.message,
        httpStatus: response?.status,
        operation: pathWithQuery,
        cause: error,
      });
      recordTuyaFailure(typed, method.toLowerCase());
      throw typed;
    }

    if (!res.data?.success) {
      const code = res.data?.code;
      const msg = res.data?.msg || "Unknown Tuya error";
      const error = tuyaRequestError({ code, message: msg, operation: pathWithQuery });
      recordTuyaFailure(error, "api_response");
      throw error;
    }

    operationalMetrics.increment("oyi_provider_requests_total", { provider: "tuya", method });
    providerHealthRegistry.heartbeat("tuya", {
      latencyMs: Date.now() - startedAt,
      note: pathWithQuery,
      wired: true,
    });

    return res.data.result as T;
  }
}
