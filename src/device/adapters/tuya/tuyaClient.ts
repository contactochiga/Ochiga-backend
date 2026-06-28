// src/device/adapters/tuya/tuyaClient.ts

import crypto from "crypto";
import axios, { AxiosInstance } from "axios";
import { operationalMetrics } from "../../../observability/metrics";
import { providerHealthRegistry } from "../../../observability/providerHealth";

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
      operationalMetrics.increment("oyi_provider_failures_total", { provider: "tuya", action: "token" });
      providerHealthRegistry.failure("tuya", error);
      throw error;
    }

    const token = res.data?.result?.access_token;
    const expire = res.data?.result?.expire_time;

    if (!token || !expire) {
      operationalMetrics.increment("oyi_provider_failures_total", { provider: "tuya", action: "token_payload" });
      providerHealthRegistry.failure("tuya", "missing_access_token");
      throw new Error(`❌ Failed to obtain Tuya access token: ${JSON.stringify(res.data)}`);
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
      operationalMetrics.increment("oyi_provider_failures_total", { provider: "tuya", action: method.toLowerCase() });
      providerHealthRegistry.failure("tuya", error);
      throw error;
    }

    if (!res.data?.success) {
      const code = res.data?.code;
      const msg = res.data?.msg || "Unknown Tuya error";
      operationalMetrics.increment("oyi_provider_failures_total", { provider: "tuya", action: "api_response" });
      providerHealthRegistry.failure("tuya", `Tuya API error (${code ?? "?"}): ${msg}`);
      throw new Error(`❌ Tuya API error (${code ?? "?"}): ${msg}`);
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
