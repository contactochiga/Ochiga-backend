#!/usr/bin/env node
import axios from "axios";

const API_BASE = (process.env.OYI_API_BASE || process.env.API_BASE || "http://localhost:4000").replace(/\/$/, "");
const TOKEN = process.env.OYI_SMOKE_TOKEN || process.env.AUTH_TOKEN || "";
const ESTATE_ID = process.env.OYI_SMOKE_ESTATE_ID || "";
const HOME_ID = process.env.OYI_SMOKE_HOME_ID || "";

if (!TOKEN) {
  console.log("SKIP: set OYI_SMOKE_TOKEN or AUTH_TOKEN to run authenticated Oyi unified smoke tests.");
  process.exit(0);
}

const client = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
});

async function step(label, fn) {
  try {
    const result = await fn();
    console.log(`PASS ${label}`);
    return result;
  } catch (error) {
    console.error(`FAIL ${label}:`, error?.response?.data || error?.message || error);
    process.exitCode = 1;
    return null;
  }
}

const awareness = await step("GET /oyi/awareness", () => client.get("/oyi/awareness", { params: { surface: "consumer", estate_id: ESTATE_ID || undefined, home_id: HOME_ID || undefined } }));
if (awareness && !awareness.data?.headline) throw new Error("awareness missing headline");

const consumerChat = await step("POST /oyi/chat consumer", () => client.post("/oyi/chat", { surface: "consumer", estate_id: ESTATE_ID || undefined, home_id: HOME_ID || undefined, message: "What’s happening?" }));
const threadId = consumerChat?.data?.thread_id;
if (!threadId) throw new Error("consumer chat missing thread_id");

await step("POST /oyi/chat facility", () => client.post("/oyi/chat", { surface: "facility", estate_id: ESTATE_ID || undefined, message: "What needs attention?" }));
await step("GET /oyi/threads", () => client.get("/oyi/threads", { params: { surface: "consumer", estate_id: ESTATE_ID || undefined, home_id: HOME_ID || undefined } }));
await step("GET /oyi/threads/:threadId/messages", () => client.get(`/oyi/threads/${encodeURIComponent(threadId)}/messages`));

if (process.exitCode) process.exit(process.exitCode);
