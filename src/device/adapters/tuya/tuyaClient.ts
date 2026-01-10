// src/device/adapters/tuya/tuyaClient.ts

import crypto from "crypto";
import axios, { AxiosInstance } from "axios";

/* ------------------------------------------------
 * ENV (LOCKED + TYPE-SAFE)
 * ------------------------------------------------ */
const TUYA_ACCESS_ID = process.env.TUYA_ACCESS_ID;
const TUYA_ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;
const TUYA_BASE_URL = process.env.TUYA_BASE_URL;

if (!TUYA_ACCESS_ID || !TUYA_ACCESS_SECRET || !TUYA_BASE_URL) {
  throw new Error("❌ Tuya env vars missing");
}

/**
 * 🔒 Lock envs as guaranteed strings
 * TypeScript now understands they are safe
 */
const ACCESS_ID: string = TUYA_ACCESS_ID;
const ACCESS_SECRET: string = TUYA_ACCESS_SECRET;
const BASE_URL: string = TUYA_BASE_URL;

export class TuyaClient {
  private client: AxiosInstance;
  private accessToken?: string;
  private tokenExpireAt = 0;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 15000,
    });
  }

  /* ------------------------------------------------
   * SIGNATURE
   * ------------------------------------------------ */
  private sign(
    method: string,
    path: string,
    body = "",
    t = Date.now().toString(),
    accessToken = ""
  ): string {
    const contentHash = crypto
      .createHash("sha256")
      .update(body)
      .digest("hex");

    const stringToSign = [
      method,
      contentHash,
      "",
      path,
    ].join("\n");

    const signStr =
      ACCESS_ID +
      accessToken +
      t +
      stringToSign;

    return crypto
      .createHmac("sha256", ACCESS_SECRET) // ✅ FIXED
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
        client_id: ACCESS_ID,
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
   * ------------------------------------------------ */
  async request<T = any>(
    method: "GET" | "POST",
    path: string,
    body?: any
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    const t = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : "";

    const sign = this.sign(
      method,
      path,
      bodyStr,
      t,
      accessToken
    );

    const res = await this.client.request({
      method,
      url: path,
      data: body,
      headers: {
        t,
        sign,
        client_id: ACCESS_ID,
        access_token: accessToken,
        sign_method: "HMAC-SHA256",
        "Content-Type": "application/json",
      },
    });

    if (!res.data?.success) {
      throw new Error(
        `❌ Tuya API error: ${JSON.stringify(res.data)}`
      );
    }

    return res.data.result;
  }
}
