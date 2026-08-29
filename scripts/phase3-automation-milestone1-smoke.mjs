import assert from "node:assert/strict";
import fs from "node:fs";

// PHASE 3 (Milestone 1) -- Oyi Facility Automation Operationalisation.
// Static/lexical assertions against the COMPILED output, matching this
// repo's own established smoke-test convention (see
// facility-administrative-backbone-phase2-smoke.mjs,
// commercial-provisioning-security-smoke.mjs). Does not require a live
// DB/network. Covers spec Section 34's list as it applies to what this
// milestone actually built (cross-tenant, forged IDs, expired/reused/
// modified approval, role escalation, MANUAL_ONLY/UNSUPPORTED rejection,
// duplicate execution) plus the E2E scenario shapes from Section 42.

function readDist(relativePath) {
  const full = new URL(`../dist/${relativePath}`, import.meta.url);
  return fs.readFileSync(full, "utf8");
}

function readRepo(relativePath) {
  const full = new URL(`../${relativePath}`, import.meta.url);
  return fs.readFileSync(full, "utf8");
}

// 1) Only the three domains this milestone actually scoped are wired to a
// required permission -- everything else in EXECUTION_REGISTRY remains
// untouched (still gated available:false with its own existing reason).
{
  const src = readDist("services/automationPolicyResolver.js");
  for (const action of ["visitor.approve", "visitor.revoke", "visitor.expire", "maintenance.assign", "maintenance.complete", "maintenance.cancel", "device.on", "device.off", "device.toggle"]) {
    assert.ok(src.includes(`"${action}"`), `resolver must define a required permission for ${action}`);
  }
  assert.ok(!/wallet\.approve|wallet\.cancel|community\.approve|community\.reject|service\.assign|service\.complete/.test(src), "resolver must never define a required permission for an out-of-scope action -- those stay manual_only via the untouched registry");
}

// 2) Conservative default: the resolver must default to approval_required,
// never auto_allowed, when no Facility override row exists.
{
  const src = readDist("services/automationPolicyResolver.js");
  assert.ok(/DEFAULT_EXECUTION_LEVEL\s*=\s*"approval_required"/.test(src), "the platform default execution level must be approval_required, never auto_allowed");
}

// 3) The registry's existing available:false actions are respected, not
// overridden -- an unsupported/unavailable action must resolve to
// manual_only/unsupported regardless of any Facility policy row.
{
  const src = readDist("services/automationPolicyResolver.js");
  const fnMatch = src.match(/async function resolveAutomationPolicy[\s\S]*?\n\}/) || src.match(/resolveAutomationPolicy\s*=[\s\S]*?\n\}/);
  assert.ok(fnMatch, "resolveAutomationPolicy must exist");
  const body = fnMatch[0];
  assert.ok(/registered\.available/.test(body), "resolver must check the registry's own available flag before ever consulting Facility policy");
  assert.ok(/"manual_only"/.test(body) && /"unsupported"/.test(body), "resolver must be able to return manual_only/unsupported, not force everything into an executable level");
}

// 4) Cross-tenant approval access is closed: decideAutomationApproval must
// compare the approval row's own estate_id against the caller's estate_id
// and return a 404-shaped denial (never confirm existence of a foreign
// tenant's approval), matching the same pattern as Phase 2's
// loadOwnEstateMembership/loadOwnEstateInvite.
{
  const src = readDist("services/facilityAutomationService.js");
  const fnMatch = src.match(/async function decideAutomationApproval[\s\S]*?\n\}/);
  assert.ok(fnMatch, "decideAutomationApproval must exist");
  const body = fnMatch[0];
  assert.ok(/estate_id\)\s*!==\s*String\(input\.estateId\)/.test(body), "must compare the approval's own estate_id against the caller's estate_id");
  assert.ok(/"not_found"/.test(body), "a foreign-tenant approval must resolve to a not_found code, not a data leak");
}

// 5) Forged/modified target cannot smuggle through: execution always uses
// the DB row's own entity_id/action_id (approval.entity_id / approval.
// action_id), never anything read directly from the HTTP request body at
// decide-time -- the plan_snapshot is what's approved, not a client-
// supplied payload.
{
  const src = readDist("services/facilityAutomationService.js");
  const fnMatch = src.match(/async function decideAutomationApproval[\s\S]*?\n\}/)[0];
  assert.ok(/executeRegisteredAction\)\(\{[\s\S]{0,200}action_id:\s*approval\.action_id/.test(fnMatch), "execution must use the approval row's own action_id, not a client-supplied value");
  assert.ok(/entity_id:\s*approval\.entity_id/.test(fnMatch), "execution must use the approval row's own entity_id, not a client-supplied value");
  const routesSrc = readDist("routes/facility.routes.js");
  const approveRoute = routesSrc.match(/router\.post\(["']\/automation\/approvals\/:approvalId\/approve["'][\s\S]*?\n\}\);/)[0];
  assert.ok(!/action_id:\s*req\.body/.test(approveRoute) && !/entity_id:\s*req\.body/.test(approveRoute), "the approve route must never accept action_id/entity_id from the request body");
}

// 6) Expired and already-decided approvals are both rejected -- replay/
// reuse protection.
{
  const src = readDist("services/facilityAutomationService.js");
  assert.ok(/expireOverdueApprovals/.test(src), "an expiry sweep must exist");
  const expireFn = src.match(/async function expireOverdueApprovals[\s\S]*?\n\}/)[0];
  assert.ok(/status.*"expired"/.test(expireFn) && /lt\(["']expires_at["']/.test(expireFn), "expiry sweep must transition overdue pending approvals to expired based on their own expires_at");
  const decideFn = src.match(/async function decideAutomationApproval[\s\S]*?\n\}/)[0];
  assert.ok(/approval\.status\s*!==\s*"pending_approval"/.test(decideFn), "only a pending_approval row may be decided -- blocks reuse/replay of an already-decided or expired approval");
  assert.ok(/"not_pending"/.test(decideFn), "a non-pending approval must be rejected with a distinct not_pending code");
}

// 7) Duplicate proposal prevention at the DB layer (belt-and-suspenders
// with the application-level checks above).
{
  const sql = readRepo("supabase/migrations/20260830090000_facility_automation_policy_and_approvals.sql");
  assert.ok(/create unique index if not exists automation_approvals_one_pending_per_target/.test(sql), "a unique index must prevent two concurrent pending proposals for the same (estate, action, entity)");
  assert.ok(/where status = 'pending_approval'/.test(sql), "the uniqueness constraint must be scoped to pending proposals only, not all history");
}

// 8) Role/permission escalation is closed: the approving actor's own role
// must hold the real permission the action requires -- the approval queue
// existing is not itself an authorization bypass.
{
  const src = readDist("services/facilityAutomationService.js");
  const decideFn = src.match(/async function decideAutomationApproval[\s\S]*?\n\}/)[0];
  assert.ok(/actorMayActOnAction/.test(decideFn), "decideAutomationApproval must check the approving actor's real permission for this specific action");
  assert.ok(/"forbidden"/.test(decideFn), "an actor without the required permission must be denied with a forbidden code");
  const resolverSrc = readDist("services/automationPolicyResolver.js");
  assert.ok(/hasPermission/.test(resolverSrc), "actorMayActOnAction must be backed by the real, canonical hasPermission check, not a bespoke role list");
}

// 9) Policy is re-resolved at decision time, not trusted from proposal
// time -- if the Facility's policy (or the underlying registry) changed
// between proposal and approval, a stale approval_required/auto_allowed
// state cannot ride through.
{
  const src = readDist("services/facilityAutomationService.js");
  const decideFn = src.match(/async function decideAutomationApproval[\s\S]*?\n\}/)[0];
  const occurrences = (decideFn.match(/resolveAutomationPolicy/g) || []).length;
  assert.ok(occurrences >= 1, "decideAutomationApproval must re-resolve policy, not only trust the row created at proposal time");
  assert.ok(/"policy_denied"/.test(decideFn), "a policy that no longer permits execution must produce a distinct policy_denied code");
}

// 10) Pre-execution precondition validation exists and runs before any
// execution attempt -- a stale/conflicting target state (e.g. the request
// was already completed or cancelled by a human) must fail cleanly rather
// than blindly re-applying a stale patch.
{
  const src = readDist("services/facilityAutomationService.js");
  assert.ok(/async function validatePrecondition/.test(src), "validatePrecondition must exist");
  const preconditionFn = src.match(/async function validatePrecondition[\s\S]*?\n\}\n\}/) || src.match(/async function validatePrecondition[\s\S]{0,3000}/);
  assert.ok(/conflicting_state/.test(preconditionFn[0]), "precondition validation must produce a conflicting_state reason, not a generic failure");
  const decideFn = src.match(/async function decideAutomationApproval[\s\S]*?\n\}/)[0];
  assert.ok(/validatePrecondition/.test(decideFn), "decideAutomationApproval must call precondition validation before executing");
}

// 11) Verification happens after every successful execution, using the
// existing, real verificationService -- not a new/duplicate verifier.
{
  const src = readDist("services/facilityAutomationService.js");
  assert.ok(/verifyVisitorStatus|verifyMaintenanceStatus|verifyDeviceAction/.test(src), "must reuse the existing intelligence-core/verificationService functions");
  assert.ok(/"verification_failed"/.test(src), "an unverified execution must be recorded as verification_failed, not silently reported as success");
}

// 12) Audit coverage: every terminal transition (requested/rejected/
// denied/failed/succeeded/verification_failed) emits a real audit event,
// tenant-scoped via estateId.
{
  const src = readDist("services/facilityAutomationService.js");
  for (const action of ["automation.approval.requested", "automation.approval.rejected", "automation.approval.denied", "automation.execution.failed", "automation.execution.succeeded", "automation.execution.verification_failed"]) {
    assert.ok(src.includes(action), `must emit a real audit event for ${action}`);
  }
  const emitCallCount = (src.match(/emitAuditEvent\)\(\{/g) || []).length;
  assert.ok(emitCallCount >= 6, "expected at least one emitAuditEvent call per terminal transition");
  const estateIdCount = (src.match(/estateId:\s*input\.estateId/g) || []).length;
  assert.ok(estateIdCount >= 6, "every automation audit event must carry estateId -- audit must remain tenant-scoped");
}

// 13) Execution reuses the existing, real executeRegisteredAction --
// no second execution engine was created.
{
  const src = readDist("services/facilityAutomationService.js");
  assert.ok(/executionRegistry_1\.executeRegisteredAction|executeRegisteredAction/.test(src), "must call the existing executeRegisteredAction, not a new executor");
  const importsFromRegistry = readDist("services/facilityAutomationService.js").includes("intelligence-core/executionRegistry");
  assert.ok(importsFromRegistry, "must import from the existing intelligence-core/executionRegistry module");
}

// 14) Notification reuses the existing NotificationService -- no second
// notification engine was created.
{
  const src = readDist("services/facilityAutomationService.js");
  assert.ok(src.includes("./NotificationService") || src.includes("NotificationService_1"), "must reuse the existing NotificationService, not a new notification path");
}

// 15) The duplicate-maintenance-request detector is event-driven (fired
// from the real creation controller), not a new polling loop.
{
  const src = readDist("controllers/maintenance.controller.js");
  assert.ok(/detectDuplicateMaintenanceRequest/.test(src), "maintenance creation must trigger the duplicate detector inline");
}

// 16) Route-level: read routes require authentication and are scoped to
// the caller's own estate_id; no route accepts an estate_id from the
// client for these endpoints.
{
  const src = readDist("routes/facility.routes.js");
  for (const path of ["/automation/policy", "/automation/approvals", "/automation/approvals/:approvalId/approve", "/automation/approvals/:approvalId/reject"]) {
    assert.ok(src.includes(path), `route ${path} must be mounted`);
  }
  const policyRoute = src.match(/router\.get\(["']\/automation\/policy["'][\s\S]*?\n\}\);/)[0];
  assert.ok(/req\.user\?\.estate_id/.test(policyRoute) && !/req\.(query|body)\.estate_id/.test(policyRoute), "policy route must scope by the authenticated user's own estate_id, never a client-supplied one");
}

console.log("phase3-automation-milestone1-smoke: ALL PASSED");
