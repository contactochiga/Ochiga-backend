#!/usr/bin/env node
// Governed Portfolio delete (Office -> Facility provisioning lifecycle).
// Real HTTP-level behavioral coverage against the actual Express route and
// the actual eligibility service, with a controllable fake Supabase client
// standing in for the database -- same pattern as
// production-readiness-smoke.mjs (monkeypatch supabaseAdmin.from on the
// compiled dist module, then hit the real app via app.listen(0) + fetch).
// No live database required.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "local-smoke-service-role-key";
process.env.REDIS_URL ||= "redis://127.0.0.1:6379";
process.env.OFFICE_SYNC_API_KEY ||= "smoke-office-sync-key";

const appModule = await import("../dist/app.js");
const app = appModule.default?.default || appModule.default || appModule;
const { supabaseAdmin } = await import("../dist/supabase/supabaseClient.js");

const failures = [];
function need(condition, message) {
  if (!condition) failures.push(message);
}

// Every table checked by the eligibility service, plus "invites" and
// "estates" which the route itself reads/writes. Each scenario below
// swaps `state` to control what each table "contains" for the estate
// under test, without touching a real database.
const DEPENDENCY_TABLES = [
  "estate_memberships",
  "users",
  "homes",
  "estate_buildings",
  "devices",
  "maintenance_requests",
  "consumer_automations",
  "facility_automation_event_rules",
  "automation_approvals",
  "facility_incidents",
];

let state = {
  estateExists: true,
  estateName: "Smoke Test Facility",
  dependencyCounts: {}, // table -> count, default 0
  invites: [{ id: "invite-1", invited_email: "owner@example.com", status: "pending" }],
  deletedTables: [], // records which tables actually had .delete() invoked
  usersDeleteAttempted: false,
  auditedActions: [],
};

function fakeFrom(table) {
  if (table === "estates") {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () =>
                state.estateExists
                  ? { data: { id: "estate-under-test", name: state.estateName }, error: null }
                  : { data: null, error: null },
            };
          },
        };
      },
      delete() {
        return {
          eq: async () => {
            state.deletedTables.push("estates");
            state.estateExists = false;
            return { error: null };
          },
        };
      },
    };
  }
  if (table === "invites") {
    return {
      select() {
        return {
          eq: async () => ({ data: state.invites, error: null }),
        };
      },
      delete() {
        return {
          eq: async () => {
            state.deletedTables.push("invites");
            state.invites = [];
            return { error: null };
          },
        };
      },
    };
  }
  if (table === "users") {
    return {
      select() {
        return {
          eq: async () => ({ count: state.dependencyCounts.users || 0, error: null }),
        };
      },
      // Deliberately NO delete() implementation -- if any code path under
      // test ever tried to delete a user, this test would throw a
      // "not a function" error instead of silently succeeding, proving
      // structurally that shared identities are never at risk.
    };
  }
  if (table === "audit_events") {
    return {
      insert: async (row) => {
        state.auditedActions.push(row?.action);
        return { error: null };
      },
    };
  }
  if (DEPENDENCY_TABLES.includes(table)) {
    return {
      select() {
        return {
          eq: async () => ({ count: state.dependencyCounts[table] || 0, error: null }),
        };
      },
    };
  }
  throw new Error(`facility-delete-eligibility-smoke: unexpected table ${table}`);
}

supabaseAdmin.from = fakeFrom;

const server = app.listen(0);
const port = await new Promise((resolve) => server.once("listening", () => resolve(server.address().port)));
const base = `http://127.0.0.1:${port}`;

async function del(estateId, headers = {}) {
  const res = await fetch(`${base}/office/facility/estates/${encodeURIComponent(estateId)}`, {
    method: "DELETE",
    headers,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const authHeaders = { "x-office-api-key": process.env.OFFICE_SYNC_API_KEY };

// A. Cross-tenant/unauthorized Office caller cannot delete -- wrong/absent
// credential is rejected before any eligibility check or deletion runs.
{
  const res = await del("estate-under-test", {});
  need(res.status === 401, "missing office credential must be rejected with 401");
  need(state.deletedTables.length === 0, "no deletion may occur for an unauthorized caller");
}
{
  const res = await del("estate-under-test", { "x-office-api-key": "wrong-key" });
  need(res.status === 401, "wrong office credential must be rejected with 401");
}

// B. Activated Facility (has an owner/admin membership) is blocked, with a
// clear reason -- never silently deleted.
{
  state.dependencyCounts = { estate_memberships: 1 };
  const res = await del("estate-under-test", authHeaders);
  need(res.status === 409, "an activated Facility must be blocked, not deleted");
  need(res.body.error === "facility_has_operational_dependencies", "block reason must be the documented error code");
  need(Array.isArray(res.body.blocking) && res.body.blocking.some((line) => /activated/i.test(line)), "block reason must mention activation specifically");
  need(state.deletedTables.length === 0, "no deletion may occur when blocked");
}

// C. A Facility with real operational dependencies (Homes, in this case)
// is blocked, independent of the activation signal.
{
  state.dependencyCounts = { homes: 3 };
  const res = await del("estate-under-test", authHeaders);
  need(res.status === 409, "a Facility with Homes must be blocked");
  need(res.body.blocking.some((line) => /Home/i.test(line)), "block reason must mention Homes");
}

// D. A Facility that already has real users tied to it (the FK-safety
// signal, and the only path by which a shared identity could ever be at
// risk) is also blocked -- proving the identity-survival guarantee holds
// even before reaching the "never delete users" code guarantee.
{
  state.dependencyCounts = { users: 1 };
  const res = await del("estate-under-test", authHeaders);
  need(res.status === 409, "a Facility with associated user identities must be blocked");
  need(res.body.blocking.some((line) => /user identities/i.test(line)), "block reason must mention associated user identities");
}

// E. Pending/unactivated record with zero dependencies deletes
// successfully: the outstanding invite is removed and the estate row is
// removed, both audited.
{
  state.dependencyCounts = {};
  state.estateExists = true;
  state.invites = [{ id: "invite-1", invited_email: "owner@example.com", status: "pending" }];
  state.deletedTables = [];
  state.auditedActions = [];
  const res = await del("estate-under-test", authHeaders);
  need(res.status === 200, "a pending/unactivated Facility with no dependencies must delete successfully");
  need(res.body.deleted === true, "response must confirm deletion");
  need(res.body.invites_removed === 1, "response must report how many invites were removed");
  need(state.deletedTables.includes("invites"), "the outstanding owner invitation must actually be removed");
  need(state.deletedTables.includes("estates"), "the estate row itself must actually be removed");
  need(!state.usersDeleteAttempted, "shared user identities must never be touched by a successful delete");
  // Audit emission is fire-and-forget (void emitAuditEvent(...), not
  // awaited by the route) so the response can legitimately arrive before
  // the insert resolves -- give the microtask queue a moment to settle.
  await new Promise((resolve) => setTimeout(resolve, 20));
  need(state.auditedActions.includes("facility.invitation.revoked"), "the invitation removal must be audited");
  need(state.auditedActions.includes("facility.deleted"), "the Facility deletion itself must be audited");
}

// F. Repeated delete on the same (now-gone) estate is safe and idempotent
// -- not an error, not a dangerous no-op that looks like a failure.
{
  const res = await del("estate-under-test", authHeaders);
  need(res.status === 200, "a repeat delete on an already-gone Facility must not error");
  need(res.body.already_deleted === true, "repeat delete must report already_deleted, not re-attempt work");
}

server.close();

if (failures.length) {
  console.error("facility-delete-eligibility-smoke: FAILED");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("facility-delete-eligibility-smoke: ALL PASSED");
// Force exit -- lingering handles (e.g. a Redis reconnect timer from the
// unavailable REDIS_URL above) would otherwise keep the process alive
// past a clean pass, matching production-readiness-smoke.mjs's own
// convention for this same real-app-under-test pattern.
process.exit(0);
