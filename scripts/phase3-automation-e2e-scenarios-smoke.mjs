import assert from "node:assert/strict";
import path from "node:path";

// PHASE 3 (Milestone 1) -- behavioral E2E scenarios (spec Section 42),
// scoped to what this milestone actually built. Uses a minimal fake
// Supabase, monkey-patched onto the same supabaseAdmin singleton every
// module under test imports -- the same technique already established in
// scripts/oyi-programme4-learning-proposal-smoke.mjs. Runs the compiled
// dist/ output directly against real exported functions, not mocks of
// this repo's own code.

const root = process.cwd();
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "phase3-automation-smoke-service-role-key";

class Query {
  constructor(table, db) {
    this.table = table;
    this.db = db;
    this.filters = [];
    this.notFilters = [];
    this.op = "select";
    this.patch = null;
    this.insertRow = null;
  }
  select() { return this; }
  eq(column, value) { this.filters.push((row) => String(row[column]) === String(value)); return this; }
  neq(column, value) { this.filters.push((row) => String(row[column]) !== String(value)); return this; }
  gte(column, value) { this.filters.push((row) => row[column] >= value); return this; }
  lt(column, value) { this.filters.push((row) => row[column] < value); return this; }
  is(column, value) { this.filters.push((row) => (value === null ? row[column] == null : row[column] === value)); return this; }
  not(column, _op, value) {
    // Only usage in this repo's touched code is `.not("status", "in", "(completed,cancelled)")`.
    const excluded = String(value).replace(/[()]/g, "").split(",");
    this.filters.push((row) => !excluded.includes(String(row[column])));
    return this;
  }
  order() { return this; }
  limit(n) { this._limit = n; return this; }
  insert(row) { this.op = "insert"; this.insertRow = Array.isArray(row) ? row[0] : row; return this; }
  update(patch) { this.op = "update"; this.patch = patch; return this; }
  async maybeSingle() { return this._run(true); }
  async single() { return this._run(true); }
  then(resolve, reject) { this._run(false).then(resolve, reject); }
  async _run(wantSingle) {
    const rows = this.db[this.table] || (this.db[this.table] = []);
    if (this.op === "insert") {
      const id = this.insertRow.id || `${this.table}-${rows.length + 1}`;
      const row = { id, created_at: new Date().toISOString(), ...this.insertRow };
      if (this.table === "automation_approvals") {
        const dup = rows.find((r) => r.estate_id === row.estate_id && r.action_id === row.action_id && r.entity_id === row.entity_id && r.status === "pending_approval");
        if (dup) return { data: null, error: { message: "duplicate key value violates unique constraint automation_approvals_one_pending_per_target" } };
      }
      rows.push(row);
      return wantSingle ? { data: row, error: null } : { data: [row], error: null };
    }
    let matched = rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.op === "update") {
      matched.forEach((row) => Object.assign(row, this.patch));
      return wantSingle ? { data: matched[0] || null, error: null } : { data: matched, error: null };
    }
    if (this._limit) matched = matched.slice(0, this._limit);
    if (wantSingle) return { data: matched[0] || null, error: null };
    return { data: matched, error: null };
  }
}

function createFakeSupabase(seed = {}) {
  const db = { automation_approvals: [], maintenance_requests: [], visitor_access: [], estate_memberships: [], facility_automation_policy: [], device_states: [], ...seed };
  return { db, from: (table) => new Query(table, db) };
}

const fakeSupabase = createFakeSupabase({
  estate_memberships: [
    { id: "mem-1", estate_id: "estate-A", user_id: "operator-1", role: "facility_manager", status: "active" },
  ],
  maintenance_requests: [
    { id: "mr-open-1", estate_id: "estate-A", home_id: "home-1", status: "open", category: "plumbing", title: "Leaking tap", created_at: new Date(Date.now() - 3600_000).toISOString(), updated_at: new Date().toISOString() },
    { id: "mr-completed-1", estate_id: "estate-A", home_id: "home-2", status: "completed", category: "electrical", title: "Fix socket", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  visitor_access: [
    { id: "va-stale-1", estate_id: "estate-A", home_id: "home-1", visitor_name: "Jane Doe", status: "active", expires_at: new Date(Date.now() - 5 * 3600_000).toISOString(), created_by: "resident-1", resident_id: "resident-1" },
  ],
});

const supabaseModule = await import(path.join(root, "dist/supabase/supabaseClient.js"));
supabaseModule.supabaseAdmin.from = (table) => fakeSupabase.from(table);

const { detectDuplicateMaintenanceRequest, scanStaleVisitorAuthorizations, decideAutomationApproval, listAutomationApprovals } = await import(path.join(root, "dist/services/facilityAutomationService.js"));

const OPERATOR = { id: "operator-1", role: "facility_manager", estate_id: "estate-A" };
const RESIDENT = { id: "resident-1", role: "resident", estate_id: "estate-A" };

// --- Scenario E first (duplicate event): fire the same detector twice for
// the identical new request -- only one approval must ever exist.
{
  const dup1 = { id: "mr-dup-1", estate_id: "estate-A", home_id: "home-1", category: "plumbing", title: "Leaking tap", created_at: new Date().toISOString() };
  fakeSupabase.db.maintenance_requests.push({ ...dup1, status: "open" });
  const first = await detectDuplicateMaintenanceRequest(dup1);
  const second = await detectDuplicateMaintenanceRequest(dup1);
  assert.ok(first, "Scenario E: the first detector run must propose an approval");
  assert.equal(second, null, "Scenario E: a second, duplicate detector run must not create a second approval");
  const pending = fakeSupabase.db.automation_approvals.filter((a) => a.entity_id === "mr-dup-1" && a.status === "pending_approval");
  assert.equal(pending.length, 1, "Scenario E: exactly one pending approval must exist for the duplicate finding");
  console.log("Scenario E (duplicate event -> single action): PASSED");
}

// --- Scenario B (approval required -> execute -> verify -> notify -> audit):
// the stale visitor gets a real approval, an eligible operator approves it,
// executeRegisteredAction really flips visitor_access.status, and
// verification confirms it.
{
  await scanStaleVisitorAuthorizations("estate-A");
  const approvals = await listAutomationApprovals("estate-A", "pending_approval");
  const visitorApproval = approvals.find((a) => a.entity_id === "va-stale-1");
  assert.ok(visitorApproval, "Scenario B: the stale visitor detector must have proposed an approval");
  assert.equal(visitorApproval.action_id, "visitor.expire");

  const decision = await decideAutomationApproval({ approvalId: visitorApproval.id, estateId: "estate-A", actor: OPERATOR, decision: "approve" });
  assert.equal(decision.ok, true, `Scenario B: approval+execution must succeed, got: ${JSON.stringify(decision)}`);
  assert.equal(decision.approval.status, "succeeded", "Scenario B: a verified execution must be recorded as succeeded");
  const visitorRow = fakeSupabase.db.visitor_access.find((v) => v.id === "va-stale-1");
  assert.equal(visitorRow.status, "expired", "Scenario B: the real visitor_access row must actually be updated by executeRegisteredAction");
  console.log("Scenario B (approval required -> execute -> verify): PASSED");
}

// --- Scenario C (policy denial): an out-of-registry action must never
// produce an approval at all, and directly attempting to decide a
// nonexistent approval for it must fail cleanly.
{
  // Directly exercise the resolver-denial path via a forged approval row
  // for an action this milestone never registers a permission for.
  fakeSupabase.db.automation_approvals.push({
    id: "forged-approval-1", estate_id: "estate-A", detector_id: "manual_test", action_id: "wallet.approve",
    entity_type: "wallet", entity_id: "wallet-1", target_label: "Wallet", reason: "test", evidence: [],
    plan_snapshot: {}, status: "pending_approval", requested_by: "system", expires_at: new Date(Date.now() + 3600_000).toISOString(), created_at: new Date().toISOString(),
  });
  const decision = await decideAutomationApproval({ approvalId: "forged-approval-1", estateId: "estate-A", actor: OPERATOR, decision: "approve" });
  assert.equal(decision.ok, false, "Scenario C: an action with no defined automation permission must be denied");
  assert.equal(decision.code, "forbidden", "Scenario C: wallet.approve has no REQUIRED_PERMISSION entry, so actorMayActOnAction denies it before policy is even consulted");
  console.log("Scenario C (policy denial -> no execution): PASSED");
}

// --- Scenario D (execution failure via stale target state): the request
// this approval targets was already completed by a human before approval
// -- precondition validation must catch it, not blindly re-apply the patch.
{
  fakeSupabase.db.automation_approvals.push({
    id: "stale-target-approval-1", estate_id: "estate-A", detector_id: "duplicate_maintenance_request", action_id: "maintenance.cancel",
    entity_type: "maintenance_request", entity_id: "mr-completed-1", target_label: "Fix socket", reason: "test", evidence: [],
    plan_snapshot: { expected_status: "cancelled" }, status: "pending_approval", requested_by: "system", expires_at: new Date(Date.now() + 3600_000).toISOString(), created_at: new Date().toISOString(),
  });
  const decision = await decideAutomationApproval({ approvalId: "stale-target-approval-1", estateId: "estate-A", actor: OPERATOR, decision: "approve" });
  assert.equal(decision.ok, false, "Scenario D: execution must fail when the target's state has already moved on");
  assert.match(decision.reason, /conflicting_state/, "Scenario D: the failure reason must be conflicting_state, not a generic error");
  const requestRow = fakeSupabase.db.maintenance_requests.find((r) => r.id === "mr-completed-1");
  assert.equal(requestRow.status, "completed", "Scenario D: the already-completed request must NOT be overwritten back to cancelled");
  console.log("Scenario D (execution failure, no false success): PASSED");
}

// --- Cross-cutting: a resident (no facility permission) cannot approve a
// Facility automation action, even one they are the resident_id/created_by
// of the underlying entity for -- this queue is not a resident action path.
{
  fakeSupabase.db.automation_approvals.push({
    id: "resident-attempt-1", estate_id: "estate-A", detector_id: "stale_visitor_authorization", action_id: "visitor.expire",
    entity_type: "visitor_access", entity_id: "va-stale-1", target_label: "Jane Doe", reason: "test", evidence: [],
    plan_snapshot: { expected_status: "expired" }, status: "pending_approval", requested_by: "system", expires_at: new Date(Date.now() + 3600_000).toISOString(), created_at: new Date().toISOString(),
  });
  const decision = await decideAutomationApproval({ approvalId: "resident-attempt-1", estateId: "estate-A", actor: RESIDENT, decision: "approve" });
  assert.equal(decision.ok, false, "A resident must not be able to approve a Facility automation action");
  assert.equal(decision.code, "forbidden");
  console.log("Cross-cutting (resident cannot approve Facility automation): PASSED");
}

console.log("phase3-automation-e2e-scenarios-smoke: ALL PASSED");
