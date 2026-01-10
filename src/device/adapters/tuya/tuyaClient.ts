// src/device/adapters/tuya/tuyaClient.ts

import crypto from "crypto";
import axios, { AxiosInstance } from "axios";

const {
  TUYA_ACCESS_ID,
  TUYA_ACCESS_SECRET,
  TUYA_BASE_URL,
} = process.env;

if (!TUYA_ACCESS_ID || !TUYA_ACCESS_SECRET || !TUYA_BASE_URL) {
  throw new Error("❌ Tuya env vars missing");
}

export class TuyaClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpireAt = 0;

  constructor() {
    this.client = axios.create({
      baseURL: TUYA_BASE_URL,
      timeout: 15000,
    });
  }

  /* ------------------------------------------------
   * AUTH
   * ------------------------------------------------ */
  private sign(
    method: string,
    path: string,
    body = "",
    t = Date.now().toString(),
    accessToken = ""
  ) {
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
      TUYA_ACCESS_ID +
      accessToken +
      t +
      stringToSign;

    return crypto
      .createHmac("sha256", TUYA_ACCESS_SECRET!)
      .update(signStr)
      .digest("hex")
      .toUpperCase();
  }

  private async getAccessToken() {
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
        client_id: TUYA_ACCESS_ID,
        sign_method: "HMAC-SHA256",
      },
    });

    if (!res.data?.result?.access_token) {
      throw new Error("❌ Failed to get Tuya access token");
    }

    this.accessToken = res.data.result.access_token;
    this.tokenExpireAt =
      Date.now() + res.data.result.expire_time * 1000;

    return this.accessToken;
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
    const sign = this.sign(method, path, bodyStr, t, accessToken);

    const res = await this.client.request({
      method,
      url: path,
      data: body,
      headers: {
        t,
        sign,
        client_id: TUYA_ACCESS_ID,
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
