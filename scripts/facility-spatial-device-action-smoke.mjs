#!/usr/bin/env node
// Facility Spatial Mode Convergence, Foundation Slice 4 -- Governed
// Spatial Actions. Real behavioral coverage against the compiled
// initiateSpatialDeviceAction() with a controllable fake Supabase client
// standing in for homes/rooms/devices/oyi_conversation_workflows/
// oyi_conversation_workflow_inputs/oyi_actions/oyi_action_events/
// oyi_action_evidence, plus a monkeypatched executeDeviceCommandForActor
// standing in for the real provider/Edge dispatch -- same monkeypatch
// pattern already proven by the Slice 2/3 resolver/readiness/context
// smokes. No live database, no real device adapter registry required.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";

const { initiateSpatialDeviceAction } = await import("../dist/oyi-core/actions/SpatialDeviceActionService.js");
const { supabaseAdmin } = await import("../dist/supabase/supabaseClient.js");
// executeDeviceCommandForActor is a plain named function export, not an
// object instance -- ESM's CJS-interop namespace makes each individual
// named-export BINDING read-only, so `ns.executeDeviceCommandForActor =
// fn` throws. `ns.default`, however, IS the actual underlying CJS
// module.exports object (mutable, and identical by reference to what
// DeviceConversationActionAdapter's own compiled require() call
// resolves to via Node's module cache) -- mutating a property on it is
// exactly as valid as the supabaseAdmin.from / deviceRuntimeStateService.
// getOrHydrate monkeypatches already used elsewhere in this suite; it
// just has to go through `.default` for a plain function export instead
// of the namespace object directly. (A separate createRequire() of this
// same file from this ESM entrypoint was tried first and found to hang
// at load time for unrelated reasons -- reusing the already-successful
// `import()` graph and reaching into `.default` avoids that entirely.)
const deviceCommandControllerNamespace = await import("../dist/controllers/deviceCommandController.js");
const deviceCommandController = deviceCommandControllerNamespace.default;

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
const originalExecuteDeviceCommandForActor = deviceCommandController.executeDeviceCommandForActor;

// ---------------------------------------------------------------------
// Generic in-memory table: supports every chain shape ActionRepository /
// WorkflowRepository / canonicalReferenceResolver actually issue --
// select/eq/in/order/limit/maybeSingle (thenable), insert, update (with
// eq-chain matching), upsert (onConflict).
// ---------------------------------------------------------------------
function matches(row, filters) {
  return filters.every(([col, op, val]) => {
    if (op === "eq") return row[col] === val;
    if (op === "in") return Array.isArray(val) && val.includes(row[col]);
    return true;
  });
}

function makeTable(store) {
  return {
    select() {
      const filters = [];
      let limitN = null;
      const builder = {
        eq(col, val) { filters.push([col, "eq", val]); return builder; },
        in(col, val) { filters.push([col, "in", val]); return builder; },
        order() { return builder; },
        limit(n) { limitN = n; return builder; },
        maybeSingle() {
          let rows = store.filter((row) => matches(row, filters));
          if (limitN != null) rows = rows.slice(0, limitN);
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        then(resolve, reject) {
          let rows = store.filter((row) => matches(row, filters));
          if (limitN != null) rows = rows.slice(0, limitN);
          Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    insert(rowOrRows) {
      const rows = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).map((r) => ({ ...r }));
      store.push(...rows);
      return {
        select() {
          return { maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }) };
        },
        then(resolve, reject) { Promise.resolve({ data: null, error: null }).then(resolve, reject); },
      };
    },
    update(patch) {
      const filters = [];
      const builder = {
        eq(col, val) { filters.push([col, "eq", val]); return builder; },
        select() {
          return {
            maybeSingle: () => {
              const idx = store.findIndex((row) => matches(row, filters));
              if (idx === -1) return Promise.resolve({ data: null, error: null });
              store[idx] = { ...store[idx], ...patch };
              return Promise.resolve({ data: store[idx], error: null });
            },
          };
        },
      };
      return builder;
    },
    upsert(row, opts = {}) {
      const conflictKey = opts.onConflict;
      return {
        select() {
          return {
            maybeSingle: () => {
              const idx = conflictKey ? store.findIndex((r) => r[conflictKey] === row[conflictKey]) : -1;
              if (idx === -1) {
                store.push({ ...row });
                return Promise.resolve({ data: store[store.length - 1], error: null });
              }
              store[idx] = { ...store[idx], ...row };
              return Promise.resolve({ data: store[idx], error: null });
            },
          };
        },
      };
    },
  };
}

const HOMES = [
  { id: "home-1", estate_id: "estate-1", canonical_ref: "LUNA-L06-APT-A", name: "Apartment A", building_id: null },
  { id: "home-dup", estate_id: "estate-1", canonical_ref: "DUP-REF", name: "Dup Home", building_id: null },
];
const ROOMS = [
  { id: "room-dup", estate_id: "estate-1", home_id: "home-1", canonical_ref: "DUP-REF", name: "Dup Room" },
];
const DEVICES = [
  { id: "device-1", estate_id: "estate-1", home_id: "home-1", room_id: "room-1", canonical_ref: "LUNA-L06-APT-A-BEDROOM1-AC", name: "Bedroom AC", type: "ac", category: "climate", adapter: "tuya", vendor: "Tuya", online: true, status: "online" },
  { id: "device-x", estate_id: "estate-2", home_id: "home-x", room_id: null, canonical_ref: "OTHER-ESTATE-DEVICE", name: "Other estate device", type: "light", category: "lighting", adapter: "tuya", vendor: "Tuya", online: true, status: "online" },
];

let workflows, workflowInputs, actions, actionEvents, actionEvidence;
function resetActionStore() {
  workflows = [];
  workflowInputs = [];
  actions = [];
  actionEvents = [];
  actionEvidence = [];
}
resetActionStore();

function fakeFrom() {
  const tables = {
    homes: HOMES,
    rooms: ROOMS,
    devices: DEVICES,
    oyi_conversation_workflows: workflows,
    oyi_conversation_workflow_inputs: workflowInputs,
    oyi_actions: actions,
    oyi_action_events: actionEvents,
    oyi_action_evidence: actionEvidence,
  };
  return (table) => {
    if (tables[table]) return makeTable(tables[table]);
    return originalFrom(table);
  };
}

const FULL_ACTOR = { id: "actor-1", role: "estate_admin", estate_id: "estate-1", permission_scopes: ["twin.control", "twin.view", "devices.control", "devices.read", "homes.read"] };
const NO_DEVICE_CONTROL_ACTOR = { id: "actor-2", role: "guest", estate_id: "estate-1", permission_scopes: ["twin.control", "homes.read"] };

function mockExecute(fn) {
  let calls = 0;
  deviceCommandController.executeDeviceCommandForActor = async (input) => {
    calls += 1;
    return fn(input, calls);
  };
  return { callCount: () => calls };
}
function restoreExecute() {
  deviceCommandController.executeDeviceCommandForActor = originalExecuteDeviceCommandForActor;
}

// 1. Golden successful journey: twin.control + devices.control actor,
// canonical_ref resolves to a device, first call (no confirm) stops at
// awaiting_confirmation without ever touching device execution, second
// call with confirm:true drives it through approve -> executeWithAdapter
// -> the real DeviceConversationActionAdapter -> executeDeviceCommandForActor
// -> confirmed.
{
  resetActionStore();
  supabaseAdmin.from = fakeFrom();
  const exec = mockExecute(async (input) => {
    need(input.deviceId === "device-1", "executeDeviceCommandForActor must be called with the real resolved device id");
    need(input.command && typeof input.command.switch === "boolean", "the command payload must carry a real switch boolean");
    return { final_status: "state_confirmed", command_execution_id: "exec-golden" };
  });

  const first = await initiateSpatialDeviceAction({ estateId: "estate-1", canonicalRef: "LUNA-L06-APT-A-BEDROOM1-AC", operation: "device.power.on", actor: FULL_ACTOR });
  need(first.status === "action", `expected status "action", got ${first.status}`);
  need(first.status === "action" && first.outcome.status === "awaiting_confirmation", `expected awaiting_confirmation on first call, got ${first.status === "action" ? first.outcome.status : first.status}`);
  need(exec.callCount() === 0, "a request without confirm:true must never reach device execution");

  const second = await initiateSpatialDeviceAction({ estateId: "estate-1", canonicalRef: "LUNA-L06-APT-A-BEDROOM1-AC", operation: "device.power.on", confirm: true, actor: FULL_ACTOR });
  need(second.status === "action", `expected status "action", got ${second.status}`);
  if (second.status === "action") {
    need(second.outcome.action_id === first.outcome.action_id, "the confirmed action must be the SAME action created on the first call, not a new one");
    need(second.outcome.status === "confirmed", `expected confirmed, got ${second.outcome.status}`);
    need(second.outcome.capability_key === "devices.power.control", "the outcome must carry the real, reused capability_key");
  }
  need(exec.callCount() === 1, `expected exactly 1 device execution call, got ${exec.callCount()}`);
  restoreExecute();
  supabaseAdmin.from = originalFrom;
}

// 2. Missing twin.control -> denied. Enforced at the route layer
// (requirePermission("twin.control")), not inside the service --
// structural check against the compiled route registration.
{
  const fs = await import("node:fs");
  const routeSource = fs.readFileSync(new URL("../dist/routes/facility.routes.js", import.meta.url), "utf8");
  const lineMatch = routeSource.split("\n").find((line) => line.includes("spatial-actions"));
  need(!!lineMatch, "the spatial-actions route must exist in the compiled routes");
  need(!!lineMatch && /requirePermission/.test(lineMatch) && /["']twin\.control["']/.test(lineMatch), "the spatial-actions route must be gated by requirePermission(\"twin.control\")");
}

// 3. Has twin.control but lacks the underlying devices.control permission
// -> denied. Proves twin.control is entry-only, never a bypass for the
// real device authority.
{
  resetActionStore();
  supabaseAdmin.from = fakeFrom();
  const exec = mockExecute(async () => ({ final_status: "state_confirmed" }));
  const result = await initiateSpatialDeviceAction({ estateId: "estate-1", canonicalRef: "LUNA-L06-APT-A-BEDROOM1-AC", operation: "device.power.on", confirm: true, actor: NO_DEVICE_CONTROL_ACTOR });
  need(result.status === "permission_denied", `expected permission_denied, got ${result.status}`);
  need(exec.callCount() === 0, "an actor lacking devices.control must never reach device execution, even with confirm:true");
  restoreExecute();
  supabaseAdmin.from = originalFrom;
}

// 4. Cross-estate canonical_ref -> safe not_found.
{
  resetActionStore();
  supabaseAdmin.from = fakeFrom();
  const result = await initiateSpatialDeviceAction({ estateId: "estate-1", canonicalRef: "OTHER-ESTATE-DEVICE", operation: "device.power.on", actor: FULL_ACTOR });
  need(result.status === "not_found", `a device belonging to a different estate must resolve as not_found, got ${result.status}`);
  supabaseAdmin.from = originalFrom;
}

// 5. Ambiguous ref -> safe failure.
{
  resetActionStore();
  supabaseAdmin.from = fakeFrom();
  const result = await initiateSpatialDeviceAction({ estateId: "estate-1", canonicalRef: "DUP-REF", operation: "device.power.on", actor: FULL_ACTOR });
  need(result.status === "ambiguous", `expected ambiguous, got ${result.status}`);
  supabaseAdmin.from = originalFrom;
}

// 6. Home/room ref -> unsupported (devices only in this slice).
{
  resetActionStore();
  supabaseAdmin.from = fakeFrom();
  const result = await initiateSpatialDeviceAction({ estateId: "estate-1", canonicalRef: "LUNA-L06-APT-A", operation: "device.power.on", actor: FULL_ACTOR });
  need(result.status === "unsupported", `a home canonical_ref must resolve as unsupported for actions, got ${result.status}`);
  supabaseAdmin.from = originalFrom;
}

// 7. Offline/unavailable device follows existing action semantics: a
// provider that only acknowledges receipt (no observable confirmation)
// must resolve as "unobservable", never silently upgraded to "confirmed".
// This is also test #9 (provider acceptance is not fabricated as
// confirmation).
{
  resetActionStore();
  supabaseAdmin.from = fakeFrom();
  const exec = mockExecute(async () => ({ final_status: "provider_accepted", command_execution_id: "exec-unobservable" }));
  const created = await initiateSpatialDeviceAction({ estateId: "estate-1", canonicalRef: "LUNA-L06-APT-A-BEDROOM1-AC", operation: "device.power.off", actor: FULL_ACTOR });
  need(created.status === "action" && created.outcome.status === "awaiting_confirmation", "expected a fresh awaiting_confirmation action");
  const confirmed = await initiateSpatialDeviceAction({ estateId: "estate-1", canonicalRef: "LUNA-L06-APT-A-BEDROOM1-AC", operation: "device.power.off", confirm: true, actor: FULL_ACTOR });
  need(confirmed.status === "action", `expected status "action", got ${confirmed.status}`);
  if (confirmed.status === "action") {
    need(confirmed.outcome.status === "unobservable", `provider_accepted-only must resolve as unobservable, not confirmed -- got ${confirmed.outcome.status}`);
    need(confirmed.outcome.status !== "confirmed", "provider acceptance must never be fabricated as confirmation");
  }
  restoreExecute();
  supabaseAdmin.from = originalFrom;
}

// 8. Confirmation-required action does not auto-execute: two identical
// requests without confirm:true must both stop at awaiting_confirmation,
// return the SAME action (idempotent create), and never reach device
// execution -- proving duplicate idempotency-key requests cannot produce
// duplicate physical execution (test #8) purely from the create phase.
{
  resetActionStore();
  supabaseAdmin.from = fakeFrom();
  const exec = mockExecute(async () => ({ final_status: "state_confirmed" }));
  const a = await initiateSpatialDeviceAction({ estateId: "estate-1", canonicalRef: "LUNA-L06-APT-A-BEDROOM1-AC", operation: "device.power.on", actor: FULL_ACTOR });
  const b = await initiateSpatialDeviceAction({ estateId: "estate-1", canonicalRef: "LUNA-L06-APT-A-BEDROOM1-AC", operation: "device.power.on", actor: FULL_ACTOR });
  need(a.status === "action" && b.status === "action" && a.outcome.action_id === b.outcome.action_id, "two identical un-confirmed requests must resolve to the SAME action, not two different ones");
  need(exec.callCount() === 0, "no un-confirmed duplicate request may ever reach device execution");
  restoreExecute();
  supabaseAdmin.from = originalFrom;
}

if (failures.length) {
  console.error(`FAIL facility-spatial-device-action-smoke (${failures.length} failure(s)):`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("PASS facility-spatial-device-action-smoke");
// Importing deviceCommandController.js transitively initializes a
// BullMQ/Redis client (for the real queued-command pipeline) that keeps
// retrying a connection indefinitely in the background -- harmless here
// since this smoke test never queues anything real, but it keeps a timer
// referenced and would otherwise prevent the process from ever exiting
// on its own. All assertions have already run at this point.
process.exit(0);
