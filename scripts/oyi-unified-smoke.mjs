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

function assertChat(label, response) {
  const data = response?.data || {};
  if (!data.message) throw new Error(`${label} missing message`);
  if (!data.intent) throw new Error(`${label} missing intent`);
  if (!data.understood) throw new Error(`${label} missing understood text`);
  if (!data.thread_id) throw new Error(`${label} missing thread_id`);
  if (!Array.isArray(data.cards)) throw new Error(`${label} missing cards array`);
  if (!Array.isArray(data.suggested_actions)) throw new Error(`${label} missing suggested_actions array`);
  console.log(`  intent=${data.intent} severity=${data.awareness?.severity || "n/a"} execution=${data.execution?.status || "n/a"}`);
  return data;
}

const consumerPrompts = [
  "What can you do?",
  "What’s happening?",
  "What needs attention?",
  "Show device status.",
  "Show offline devices.",
  "Show pending visitors.",
  "Show wallet balance.",
  "Generate today’s home summary.",
  "Turn off a supported device.",
];

let consumerThreadId = "";
for (const prompt of consumerPrompts) {
  const response = await step(`POST /oyi/chat consumer: ${prompt}`, () => client.post("/oyi/chat", {
    surface: "consumer",
    estate_id: ESTATE_ID || undefined,
    home_id: HOME_ID || undefined,
    thread_id: consumerThreadId || undefined,
    message: prompt,
  }));
  if (response) {
    const data = assertChat(`consumer ${prompt}`, response);
    consumerThreadId = data.thread_id;
  }
}

const consumerChat = consumerThreadId ? { data: { thread_id: consumerThreadId } } : await step("POST /oyi/chat consumer", () => client.post("/oyi/chat", { surface: "consumer", estate_id: ESTATE_ID || undefined, home_id: HOME_ID || undefined, message: "What’s happening?" }));
const threadId = consumerChat?.data?.thread_id;
if (!threadId) throw new Error("consumer chat missing thread_id");

const facilityPrompts = [
  "What can facility control?",
  "What needs attention today?",
  "Show offline estate devices.",
  "Show pending visitors.",
  "Show open maintenance.",
  "Generate today’s estate report.",
  "Who did what today?",
  "Execute one supported operational action.",
];

let facilityThreadId = "";
for (const prompt of facilityPrompts) {
  const response = await step(`POST /oyi/chat facility: ${prompt}`, () => client.post("/oyi/chat", {
    surface: "facility",
    estate_id: ESTATE_ID || undefined,
    thread_id: facilityThreadId || undefined,
    message: prompt,
  }));
  if (response) {
    const data = assertChat(`facility ${prompt}`, response);
    facilityThreadId = data.thread_id;
  }
}
await step("GET /oyi/threads", () => client.get("/oyi/threads", { params: { surface: "consumer", estate_id: ESTATE_ID || undefined, home_id: HOME_ID || undefined } }));
const messages = await step("GET /oyi/threads/:threadId/messages", () => client.get(`/oyi/threads/${encodeURIComponent(threadId)}/messages`));
const assistant = (messages?.data?.messages || []).filter((row) => row.role === "assistant").at(-1);
if (assistant && !assistant.metadata?.intent) {
  console.error("FAIL persisted assistant message missing operating intent metadata");
  process.exitCode = 1;
}

if (process.exitCode) process.exit(process.exitCode);
