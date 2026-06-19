#!/usr/bin/env node
import axios from "axios";

const API_BASE_RAW = process.env.OYI_API_BASE || process.env.API_BASE || "http://localhost:4000";
const API_BASE = String(API_BASE_RAW).replace(/\/$/, "");
const TOKEN = process.env.OYI_SMOKE_TOKEN || process.env.AUTH_TOKEN || "";
const ESTATE_ID = process.env.OYI_SMOKE_ESTATE_ID || "";
const HOME_ID = process.env.OYI_SMOKE_HOME_ID || "";

const PLACEHOLDERS = new Set([
  "PASTE_REAL_TOKEN_HERE",
  "PASTE_REAL_ESTATE_ID_HERE",
  "PASTE_REAL_HOME_ID_HERE",
  "<real-token>",
  "<estate-id>",
  "<home-id>",
  "https://your-backend-url",
  "your-backend-url",
]);

function isPlaceholder(value) {
  const clean = String(value || "").trim();
  return PLACEHOLDERS.has(clean) || PLACEHOLDERS.has(clean.replace(/\/$/, ""));
}

const invalidVars = [];
if (isPlaceholder(TOKEN)) invalidVars.push("OYI_SMOKE_TOKEN/AUTH_TOKEN");
if (isPlaceholder(ESTATE_ID)) invalidVars.push("OYI_SMOKE_ESTATE_ID");
if (isPlaceholder(HOME_ID)) invalidVars.push("OYI_SMOKE_HOME_ID");
if (isPlaceholder(API_BASE_RAW)) invalidVars.push("OYI_API_BASE/API_BASE");

if (invalidVars.length) {
  console.log(`SKIP: placeholder smoke values detected: ${invalidVars.join(", ")}. Replace them with real values before running npm run smoke:oyi.`);
  process.exit(0);
}

if (!TOKEN) {
  console.log("SKIP: set OYI_SMOKE_TOKEN or AUTH_TOKEN to run authenticated Oyi unified smoke tests.");
  process.exit(0);
}

const client = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
});

let failures = 0;
function fail(label, detail) {
  failures += 1;
  console.error(`FAIL ${label}:`, detail);
  process.exitCode = 1;
}

async function step(label, fn) {
  try {
    const result = await fn();
    console.log(`PASS ${label}`);
    return result;
  } catch (error) {
    fail(label, error?.response?.data || error?.message || error);
    return null;
  }
}

async function preflight() {
  try {
    await axios.get(`${API_BASE}/health`, { timeout: 8000 });
    console.log(`PASS preflight ${API_BASE}/health`);
    return true;
  } catch {
    try {
      await axios.get(`${API_BASE}/`, { timeout: 8000 });
      console.log(`PASS preflight ${API_BASE}/`);
      return true;
    } catch (error) {
      console.error("Backend is not reachable at OYI_API_BASE. Start the backend or use the deployed backend URL.");
      console.error("Preflight detail:", error?.response?.data || error?.message || error);
      process.exit(1);
    }
  }
}

function assertCondition(label, condition, detail) {
  if (!condition) fail(label, detail);
  return Boolean(condition);
}

function assertChat(label, response) {
  if (!response) return null;
  const data = response.data || {};
  let ok = true;
  ok = assertCondition(`${label} message`, Boolean(data.message), "missing message") && ok;
  ok = assertCondition(`${label} intent`, Boolean(data.intent), "missing intent") && ok;
  ok = assertCondition(`${label} understood`, Boolean(data.understood), "missing understood text") && ok;
  ok = assertCondition(`${label} thread_id`, Boolean(data.thread_id), "missing thread_id") && ok;
  ok = assertCondition(`${label} cards`, Array.isArray(data.cards), "missing cards array") && ok;
  ok = assertCondition(`${label} suggested_actions`, Array.isArray(data.suggested_actions), "missing suggested_actions array") && ok;
  if (!ok) return null;
  console.log(`  intent=${data.intent} severity=${data.awareness?.severity || "n/a"} execution=${data.execution?.status || "n/a"}`);
  return data;
}

await preflight();

const awareness = await step("GET /oyi/awareness", () => client.get("/oyi/awareness", { params: { surface: "consumer", estate_id: ESTATE_ID || undefined, home_id: HOME_ID || undefined } }));
assertCondition("GET /oyi/awareness headline", !awareness || Boolean(awareness.data?.headline), "awareness missing headline");

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
  const data = assertChat(`consumer ${prompt}`, response);
  if (data?.thread_id) consumerThreadId = data.thread_id;
}

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
  const data = assertChat(`facility ${prompt}`, response);
  if (data?.thread_id) facilityThreadId = data.thread_id;
}

await step("GET /oyi/threads", () => client.get("/oyi/threads", { params: { surface: "consumer", estate_id: ESTATE_ID || undefined, home_id: HOME_ID || undefined } }));

if (consumerThreadId) {
  const messages = await step("GET /oyi/threads/:threadId/messages", () => client.get(`/oyi/threads/${encodeURIComponent(consumerThreadId)}/messages`));
  if (messages) {
    const assistant = (messages.data?.messages || []).filter((row) => row.role === "assistant").at(-1);
    assertCondition("persisted assistant operating metadata", !assistant || Boolean(assistant.metadata?.intent), "assistant message missing operating intent metadata");
  }
} else {
  console.warn("SKIP GET /oyi/threads/:threadId/messages: no consumer thread_id returned from chat steps.");
}

if (failures) process.exit(process.exitCode || 1);
