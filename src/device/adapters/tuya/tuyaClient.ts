// src/device/adapters/tuya/tuyaClient.ts

import crypto from "crypto";
import axios, { AxiosInstance } from "axios";

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

/* ------------------------------------------------
 * QUERY HELPERS (Tuya expects sorted query in signature)
 * ------------------------------------------------ */
function normalizeParams(input?: Record<string, any>): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;

  const out: Record<string, string> = {};

  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;

    // remove empty strings
    if (typeof v === "string" && v.trim() === "") continue;

    // arrays -> comma string (Tuya expects device_ids=id1,id2,...)
    if (Array.isArray(v)) {
      const cleaned = v
        .map((x) => (x === null || x === undefined ? "" : String(x).trim()))
        .filter(Boolean);

      if (!cleaned.length) continue;
      out[k] = cleaned.join(",");
      continue;
    }

    // numbers/bools -> string
    out[k] = String(v);
  }

  // extra safety: never send illegal device_ids
  if ("device_ids" in out && !out.device_ids.trim()) {
    delete out.device_ids;
  }

  return Object.keys(out).length ? out : undefined;
}

function buildSortedQuery(params?: Record<string, string>) {
  if (!params) return "";

  const keys = Object.keys(params).sort(); // IMPORTANT for signature consistency
  const parts = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/* ------------------------------------------------
 * CLIENT
 * ------------------------------------------------ */
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

    const t = Date.now().toString();
    const path = "/v1.0/token?grant_type=1";
    const sign = this.sign("GET", path, "", t);

    const res = await this.client.get(path, {
      headers: {
        t,
        sign,
        client_id: this.ACCESS_ID,
        sign_method: "HMAC-SHA256",
      },
    });

    const token = res.data?.result?.access_token;
    const expire = res.data?.result?.expire_time;

    if (!token || !expire) {
      throw new Error("❌ Failed to obtain Tuya access token");
    }

    this.accessToken = token;
    this.tokenExpireAt = Date.now() + expire * 1000;

    return token;
  }

  /* ------------------------------------------------
   * REQUEST
   * - GET: third arg is query params
   * - POST: third arg is JSON body
   * ------------------------------------------------ */
  async request<T = any>(
    method: "GET" | "POST",
    path: string,
    payload?: any
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    const t = Date.now().toString();

    const isGet = method === "GET";

    const params = isGet ? normalizeParams(payload) : undefined;
    const query = isGet ? buildSortedQuery(params) : "";
    const pathWithQuery = `${path}${query}`;

    const bodyStr = isGet ? "" : payload ? JSON.stringify(payload) : "";
    const sign = this.sign(method, pathWithQuery, bodyStr, t, accessToken);

    const res = await this.client.request({
      method,
      url: path, // axios will append params itself
      params, // ✅ query params for GET
      data: isGet ? undefined : payload, // ✅ body only for POST
      headers: {
        t,
        sign,
        client_id: this.ACCESS_ID,
        access_token: accessToken,
        sign_method: "HMAC-SHA256",
        "Content-Type": "application/json",
      },
    });

    if (!res.data?.success) {
      const code = res.data?.code;
      const msg = res.data?.msg || res.data?.message || "Unknown Tuya error";
      throw new Error(`❌ Tuya API error${code ? ` (${code})` : ""}: ${msg}`);
    }

    return res.data.result as T;
  }
}
