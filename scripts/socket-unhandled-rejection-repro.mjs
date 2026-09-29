// Reproduction harness for the production ERR_UNHANDLED_REJECTION crash.
//
// Boots the REAL compiled server (dist/server.js) against the isolated
// wave11-behavioural-fixture Supabase stack (unrelated to Wave 11 source;
// reused here purely as disposable Postgres infra), stubs only the
// external transports that have no isolated equivalent (BullMQ/ioredis/
// redis), and connects a real socket.io-client to exercise ONE named
// socket lifecycle boundary per run with a Supabase-style rejected plain
// object `{ code, details, hint, message }` injected at that boundary.
//
// Run via the matrix driver (socket-unhandled-rejection-matrix.mjs), not
// directly -- each case must run in its own process because the server
// binds module-level singletons (io, redis client) once per process.
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { io as ioClient } from "socket.io-client";

const require = createRequire(import.meta.url);

function stub(moduleName, exportsObj) {
  const resolved = require.resolve(moduleName);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
class NoNetEmitter {
  on() { return this; }
  once() { return this; }
  off() { return this; }
  emit() { return false; }
  end(cb) { if (cb) cb(); }
  quit() { return Promise.resolve(); }
  disconnect() {}
}
stub("bullmq", {
  Queue: class extends NoNetEmitter { add() { return Promise.resolve({ id: "stub" }); } },
  Worker: class extends NoNetEmitter {},
});
const IORedisStub = class extends NoNetEmitter {};
IORedisStub.default = IORedisStub;
IORedisStub.Redis = IORedisStub;
stub("ioredis", IORedisStub);
stub("redis", {
  createClient: () => {
    const client = new NoNetEmitter();
    client.connect = () => Promise.resolve();
    Object.defineProperty(client, "isOpen", { get: () => true });
    return client;
  },
});

const PRODUCTION_REF = "zcpgtdakqxyvjkmiibei";
const FIXTURE_URL = "http://127.0.0.1:55421";
if (!/^http:\/\/(127\.0\.0\.1|localhost):55421$/.test(FIXTURE_URL) || FIXTURE_URL.includes(PRODUCTION_REF)) {
  throw new Error("refuses a non-isolated or production Supabase URL");
}
if (!process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("socket-unhandled-rejection-repro requires OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY for the isolated local fixture");
}
process.env.SUPABASE_URL = FIXTURE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_ANON_KEY ||= process.env.OYI_LOCAL_SUPABASE_ANON_KEY || "";
process.env.APP_JWT_SECRET ||= process.env.OYI_LOCAL_REPRO_JWT_SECRET || "hotfix-repro-local-only";
process.env.MQTT_HOST ||= "127.0.0.1";
process.env.MQTT_USERNAME ||= "repro";
process.env.MQTT_PASSWORD ||= "repro";
process.env.PORT = process.env.REPRO_PORT || "58391";
process.env.REDIS_URL ||= "redis://127.0.0.1:0";

const reproCase = process.env.REPRO_CASE;
if (!reproCase) throw new Error("REPRO_CASE env var is required");

const POISON = { code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" };

function poisonedBuilder() {
  const builder = {};
  for (const method of ["select", "eq", "in", "order", "limit", "gte", "lte", "maybeSingle", "single", "insert", "update", "delete", "upsert"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve, reject) => Promise.reject({ ...POISON }).then(resolve, reject);
  builder.catch = (reject) => Promise.reject({ ...POISON }).catch(reject);
  return builder;
}

const { supabaseAdmin } = require("../dist/supabase/supabaseClient.js");
const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
const TABLE_POISON = {
  subscribe_room: "rooms",
  subscribe_home: "homes",
  subscribe_device: "devices",
  subscribe_thread: "dm_thread_members",
  scope_replace_home: "homes",
};
if (TABLE_POISON[reproCase]) {
  const poisonTable = TABLE_POISON[reproCase];
  supabaseAdmin.from = (table) => (table === poisonTable ? poisonedBuilder() : originalFrom(table));
}

const socketAuthModule = require("../dist/socketAuth.js");
if (reproCase === "subscribe_estate_deny" || reproCase === "subscribe_user_deny") {
  socketAuthModule.canUseSocket = () => false;
}

if (reproCase === "subscribe_estate_deny" || reproCase === "subscribe_user_deny" || reproCase === "auth_fail_audit") {
  const coreService = require("../dist/oyi-core/service.js");
  coreService.oyiCoreRuntime.decorateRealtimePayload = () => Promise.reject({ ...POISON });
}

if (reproCase === "disconnect") {
  const commsLive = require("../dist/services/communications/communicationsLiveService.js");
  commsLive.CommunicationsLiveService.detachSocket = () => Promise.reject({ ...POISON });
}

if (reproCase === "auth_db") {
  supabaseAdmin.from = (table) => (table === "users" ? poisonedBuilder() : originalFrom(table));
}

// REPRO_MODE=baseline (default): install NO listener at all -- this must
// exactly match production's zero-safety-net state, so that if the
// injected rejection is truly unhandled, Node's own default behavior
// (print crash dump, exit process) is what the driver observes.
// REPRO_MODE=guarded: install a diagnostic listener, used only to prove
// the concept before/independent of the real src/server.ts fix.
let rejectionSeen = null;
if (process.env.REPRO_MODE === "guarded") {
  process.on("unhandledRejection", (reason) => {
    rejectionSeen = reason;
    console.log("HARNESS_OBSERVED_UNHANDLED_REJECTION " + JSON.stringify(reason));
  });
}

await import("../dist/server.js");

const TEST_USER_ID = "40000000-0000-4000-8000-000000000099";

setTimeout(() => {
  const validToken = jwt.sign({ id: TEST_USER_ID, role: "facility_manager" }, process.env.APP_JWT_SECRET);
  const token = reproCase === "auth_fail_audit" ? "not-a-real-jwt" : validToken;
  const socket = ioClient(`http://127.0.0.1:${process.env.PORT}`, {
    auth: { token },
    reconnection: false,
    transports: ["websocket"],
  });
  socket.on("connect", () => {
    console.log("HARNESS_SOCKET_CONNECTED");
    switch (reproCase) {
      case "subscribe_estate_deny": socket.emit("subscribe:estate", "40000000-0000-4000-8000-000000000001"); break;
      case "subscribe_user_deny": socket.emit("subscribe:user", "40000000-0000-4000-8000-000000000098"); break;
      case "subscribe_room": socket.emit("subscribe:room", "40000000-0000-4000-8000-000000000010"); break;
      case "subscribe_home": socket.emit("subscribe:home", "40000000-0000-4000-8000-000000000011"); break;
      case "subscribe_device": socket.emit("subscribe:device", "40000000-0000-4000-8000-000000000012"); break;
      case "subscribe_thread": socket.emit("subscribe:thread", "40000000-0000-4000-8000-000000000013"); break;
      case "scope_replace_home": socket.emit("scope:replace", { home_id: "40000000-0000-4000-8000-000000000011" }); break;
      case "disconnect": setTimeout(() => socket.disconnect(), 200); break;
      default: break;
    }
  });
  socket.on("connect_error", (err) => console.log("HARNESS_CONNECT_ERROR " + err.message));
  socket.on("error:permission", (payload) => console.log("HARNESS_PERMISSION_DENIED " + JSON.stringify(payload)));
}, 1800);

setTimeout(() => {
  console.log("HARNESS_RESULT " + JSON.stringify({ case: reproCase, survived: true, rejectionObserved: Boolean(rejectionSeen), rejectionShape: rejectionSeen }));
  process.exit(0);
}, 5000);
