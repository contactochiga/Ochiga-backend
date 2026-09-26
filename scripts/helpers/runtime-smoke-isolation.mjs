import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import net from "node:net";
import dgram from "node:dgram";

// Test-only external ports. Import BEFORE app/Core, including when CI supplies
// real credentials. Never replace Core reasoning, policy, materialization
// preparation, subscriptions, metrics, or HTTP handlers.
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY = "runtime-smoke-fixture-only";
process.env.REDIS_URL = "redis://127.0.0.1:1";
process.env.REDIS_ENABLED = "false";
process.env.OYI_OPS_TOKEN = "runtime-smoke-ops-fixture-only";

const require = createRequire(import.meta.url);
export const isolation = { violations: [], rpcCalls: [], signals: new Map(), audits: [], executions: [], queueClients: 0, redisPings: 0 };
function forbidden(port) {
  isolation.violations.push(port);
  throw new Error(`Runtime smoke forbidden external port: ${port}`);
}
let httpPort;
export function allowSmokeHttp(server) {
  assert.equal(server.address().address, "127.0.0.1");
  httpPort = server.address().port;
}
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === "object" ? first : { port: first, host: args[1] };
  if (!httpPort || options?.path || options?.host !== "127.0.0.1" || Number(options.port) !== httpPort) {
    return forbidden("tcp");
  }
  return originalConnect.apply(this, args);
};
dgram.Socket.prototype.send = () => forbidden("udp");
syncBuiltinESMExports();

function stub(path, exports) {
  const id = require.resolve(path);
  assert.equal(require.cache[id], undefined, `Isolation installed too late: ${path}`);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
class QueuePort extends EventEmitter {
  constructor() { super(); isolation.queueClients++; }
  add() { return forbidden("queue.add"); }
  upsertJobScheduler() { return forbidden("queue.schedule"); }
}
class RedisPort extends EventEmitter {
  connect() { return forbidden("redis.connect"); }
  duplicate() { return new RedisPort(); }
  async ping() { isolation.redisPings++; return "PONG"; }
}
stub("bullmq", { Queue: QueuePort, Worker: class { constructor() { forbidden("queue.worker"); } } });
stub("ioredis", RedisPort);
const redis = new RedisPort();
stub("../../dist/config/redis.js", { redis, default: redis });

const clone = value => structuredClone(value);
const client = {
  from(table) {
    if (table === "users") return { select(fields) {
      assert.equal(fields, "id");
      return { async limit(n) { assert.equal(n, 1); return { data: [{ id: "smoke-user" }], error: null }; } };
    } };
    if (table === "audit_events") return { async insert(row) {
      isolation.audits.push(clone(row)); return { error: null };
    } };
    if (table === "ai_execution_ledger") return { async upsert(row, options) {
      assert.deepEqual(options, { onConflict: "id" });
      assert.ok(row.id);
      isolation.executions.push(clone(row)); return { error: null };
    } };
    if (table === "operational_signals") return { select(fields) {
      assert.equal(fields, "id,materialization");
      return { eq(field, key) {
        assert.equal(field, "canonical_signal_key");
        return { async maybeSingle() { return { data: clone(isolation.signals.get(key) || null), error: null }; } };
      } };
    } };
    return forbidden(`supabase.from:${table}`);
  },
  async rpc(name, args) {
    isolation.rpcCalls.push(name);
    if (name === "oyi_register_materialization") {
      const { p_signal: signal, p_prepared: prepared } = args;
      assert.equal(prepared.version, 1);
      assert.ok(prepared.rows.awareness.length > 0, "Real Core must prepare awareness");
      assert.ok(signal.payload.signal.id, "Real normalized signal must be registered");
      const prior = isolation.signals.get(signal.canonical_signal_key);
      if (prior) return { data: { signal_id: prior.id, state: prior.materialization.state, duplicate: true }, error: null };
      const row = { id: `00000000-0000-4000-a000-${String(isolation.signals.size + 1).padStart(12, "0")}`,
        signal: clone(signal), materialization: { state: "pending", prepared: clone(prepared) } };
      isolation.signals.set(signal.canonical_signal_key, row);
      return { data: { signal_id: row.id, state: "pending", duplicate: false }, error: null };
    }
    const row = [...isolation.signals.values()].find(r => r.id === args.p_signal_id);
    if (name === "oyi_claim_materialization") {
      assert.equal(args.p_limit, 1);
      if (!row || row.materialization.state !== "pending") return { data: [], error: null };
      row.materialization.state = "materializing";
      row.materialization.claim_token = "smoke-claim";
      return { data: [clone(row)], error: null };
    }
    if (name === "oyi_complete_materialization") {
      assert.equal(row?.materialization.state, "materializing");
      assert.equal(args.p_token, row.materialization.claim_token);
      row.materialization.state = "materialized";
      return { data: { complete: true }, error: null };
    }
    return forbidden(`supabase.rpc:${name}`);
  },
};
stub("../../dist/supabase/supabaseClient.js", { supabaseAdmin: client });

export function assertRuntimeIsolation({ signal = false } = {}) {
  assert.deepEqual(isolation.violations, [], "Unexpected access is a failure even if application catches it");
  if (signal) {
    assert.deepEqual(isolation.rpcCalls, ["oyi_register_materialization", "oyi_claim_materialization", "oyi_complete_materialization"]);
    assert.equal(isolation.signals.size, 1);
    assert.equal([...isolation.signals.values()][0].materialization.state, "materialized");
    assert.equal(isolation.executions.length, 2, "Real execution ledger records start and completion");
    assert.equal(isolation.executions[1].execution_status, "executed");
  }
}
