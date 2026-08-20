# Shared Automation Runtime — PR 1 (surface foundation) + PR 2 (Facility)

Status: PR 1 and PR 2 of an approved 3-PR rollout (PR 1 infrastructure → PR 2 Facility → PR 3 Office, each separately approved and deployed). PR 3 (Office) is not built yet.

Companion to `docs/architecture/OYI_RUNTIME_DOMAIN_MODEL.md` (Automation is Domain 4 there) — that document's "Automation" section should be read alongside this one; this file is the implementation-level detail for the Automation domain's PR 1 evolution.

## What this PR is

Consumer's automation runtime (`consumer_automations` / `consumer_automation_runs`, the 30-second scheduler in `src/routes/scenes.ts`) is the only production automation system today. It has no concept of "surface" — every row it has ever scanned is implicitly a Consumer/resident automation. PR 1 adds that concept, additively, with Facility and Office left completely inert behind feature flags, so the table, the scheduler, and the executor can be reused instead of duplicated once PR 2/PR 3 are approved.

**PR 1 does not let a Facility or Office automation be created, scheduled, or executed.** It only makes the machinery capable of recognizing a surface, so that capability isn't a from-scratch change when PR 2/PR 3 land.

## Canonical surface contract

```ts
type AutomationSurface = "consumer" | "facility" | "office";
```

- `consumer_automations.surface` — new column, `not null default 'consumer'`, `check (surface in ('consumer','facility','office'))`. Every row that existed before this migration reads back as `'consumer'` via the column default — no backfill statement, no row touched.
- `AUTOMATION_SURFACE_FACILITY_ENABLED` / `AUTOMATION_SURFACE_OFFICE_ENABLED` — env flags, default `false`. `consumer` is never flag-gated; it is always in `enabledAutomationSurfaces()`.
- Three independent enforcement points, not one, so no single missed check can let a disabled surface run:
  1. **Create/update routes** (`POST /scenes/automations`, `PATCH /scenes/automations/:id`) reject a `surface` whose flag is off (`403 automation_surface_disabled`).
  2. **Scheduler due-scan** (`automationSchedulerTick`) only selects rows whose `surface` is in `enabledAutomationSurfaces()` — a disabled-surface row is never fetched, let alone claimed.
  3. **Shared executor** (`executeConsumerAutomation`) re-checks the surface itself and throws before doing any work — covers the manual-test route (`POST /automations/:id/test`) too, not only the scheduler's claim path.

## Actor resolution (generalized, mostly unchanged)

- **Consumer and Facility**: unchanged. Both have real rows in Backend's `users` table (residents and Facility staff alike), so `claimAndRunAutomation` still does `supabaseAdmin.from("users").select("*").eq("id", automation.created_by)`.
- **Office**: Office has no per-user Backend identity — its own staff/admin accounts live entirely in `ochiga-office`. `officeAutomationActor()` constructs the same synthetic actor shape (`role: "ochiga_admin"`) already proven in production by `officeExport.ts`'s `officeWorkflowActor` (Oyi Runtime Contract, Task-domain bridge). This is dead code in PR 1 — the surface filter above guarantees no `office`-surfaced row ever reaches this branch while the flag is off.

## What was deliberately NOT built in PR 1

- **No new action-dispatch lanes.** `executeResidentActionBatch` / `canonicalizeSceneActions` (device commands only) are completely untouched. Facility's `registered_action` dispatch (via `executionRegistry.ts`) and Office's `workflow_action` dispatch (via `createWorkflow`/`transitionWorkflow`) are PR 2 and PR 3 work respectively — building them now, with no way to create an automation that would use them, would be dead code with no test coverage from real data.
- **No Facility "report" action.** No canonical report-generation capability exists anywhere in the codebase today (confirmed by audit, not assumed) — this stays explicitly unsupported, not invented.
- **No `automation_reference` propagation into `ai_execution_ledger`.** The ledger's `startForSignal` hardcodes `automationReference: null` at write time; wiring it through would mean touching `NormalizedSignal`, the shared type/pipeline every signal in the Universal Signal Runtime flows through — the same class of file where a prior pass (Oyi Cross-Surface Observability Closure) found and fixed a real cross-surface pollution bug. Not low-risk, not scoped to this PR. **Named follow-up, not built.**
- **No event-triggered automation.** `validateAutomationTrigger` still only accepts `type: "schedule"`. Schema-compatible with adding `type: "event"` later (the `trigger` column is JSONB), but not built here.
- **No `consumer_automation_runs` schema change.** Its `source` check constraint stays `('scheduled','manual_test')`. Run-level `surface` context is emitted into logs/audit metadata (see below), not added as a new column, to keep this migration to exactly one additive column plus one index.

## Observability (additive, no duplication)

`surface` is threaded into every log/audit call the automation executor already makes — `automation_scheduler_tick` (which surfaces are live this tick), `automation_run_created`, `automation_run_failed`, `automation_run_completed`, and the `automation.run.<status>` audit event. No new event type was created; no existing `ai_execution_ledger` or `ochiga_intelligence_events` write path was duplicated — device-command actions still produce exactly one ledger row each, exactly as before.

## Rollback (PR 1)

Set both flags to `false` (or leave them at their default). No code revert needed for a flag-only rollback — every new branch this PR added is already provably inert at `false`. Full code rollback (revert the deploy) remains available as a second line of defense if the additive branches themselves are ever suspected of a regression, but is not expected to be necessary since `surface='consumer'` runs through the exact same code as before this PR.

---

## PR 2 — Facility

### Capability audit result

Re-audited `/Users/ochigaidoko/Documents/facility-oyi` (Facility's own frontend, which calls Ochiga-backend directly — no separate Facility identity/data store) and Ochiga-backend together before writing any code.

**Proven automation-ready** (real, live, already-executable, already reachable from Facility's own dedicated routes):
- `visitor.approve` / `visitor.revoke` / `visitor.expire` — `executionRegistry.ts`, backing table `visitor_access`, same table Facility's own `PATCH /facility/visitors/:id` already mutates.
- `maintenance.assign` / `maintenance.complete` / `maintenance.cancel` — same registry, backing table `maintenance_requests`, same table Facility's own `PATCH /facility/maintenance/:id` (`requirePermission("support.assign")`) already mutates.
- Device commands (`device_command` action type) — no new code; PR 1's dispatch lane was already surface-agnostic, and Facility staff are real Backend `users` rows with real `estate_id`, so `resolveVisibleDevice`'s existing scope checks already apply unchanged.

**Explicitly still unsupported, and why:**
- `community.approve/reject`, `service.assign/complete`, `wallet.approve/cancel` — marked `available: false` inside `EXECUTION_REGISTRY` itself; nothing implements them anywhere.
- **Report/export** — a real, working endpoint exists (`GET /facility/visitors/reports/export?format=json|csv`), but it is synchronous/interactive: it returns a blob to a live browser session. A 3am scheduled automation has nowhere to deliver that blob (no email/storage/notification-delivery capability exists to hand it to — see next point). Not automation-shaped without a receiving capability. Not wired.
- **Notification/broadcast send** — audited every notification-adjacent route in both repos; all are read/acknowledge/preference-management only. `community.broadcast` permission gates a live-video-stream start, not a message-send. No genuine "notify residents" action exists anywhere. Not invented.
- **Service-config toggling** (`PATCH /services/config/:key`, real and actionable) — not yet a capability-registry entry; wiring it in would mean writing new dispatch/authorization code inside `executionRegistry.ts` rather than reusing what exists. Left as a named follow-up, not built this pass, to keep PR 2 to "reuse the existing... layers," not extend them.

### One real bug found and fixed en route

`executionRegistry.ts`'s `operationalRole()` checked the actor's role string against a list that included the *legacy* alias `"operator"` but not the actual, current `PlatformRole` value `"maintenance_operator"` — meaning a genuine `maintenance_operator` actor (exactly the role Facility's own maintenance route requires) could never pass this check and would always fall through to the resident-self-service branch, which denies staff-initiated `maintenance.assign`/`maintenance.complete`/`maintenance.cancel`. Fixed by adding `"maintenance_operator"` to the recognized list — one line, no behavior change for any other role.

### Action contract, surface-gated

```ts
// PR 1, unchanged, all surfaces
{ action_type?: "device_command"; device_id; command; label? }

// PR 2, new, facility surface only
{ action_type: "registered_action"; action_id: "visitor.approve"|"visitor.revoke"|"visitor.expire"|"maintenance.assign"|"maintenance.complete"|"maintenance.cancel"; entity_id: string; assignee?: string; label?: string }
```

An automation's `actions[]` is homogeneous — every item is `registered_action` or none are. Mixed arrays are rejected at creation/update time, not silently split. `registered_action` items are rejected at creation time unless `surface === "facility"`, independent of the surface-level enforcement PR 1 already built.

### Execution chain (unchanged shape, one new lane)

```
automation definition (consumer_automations, surface="facility")
  → scheduler tick / manual test  (unchanged — PR 1)
  → executeConsumerAutomation      (unchanged entry point — PR 1)
  → dispatch by action homogeneity:
      device_command   → executeResidentActionBatch → executeDeviceCommandForActor → ai_execution_ledger   (unchanged — PR 1)
      registered_action → executeRegisteredActionBatch (new, thin) → executeRegisteredAction (unchanged, existing)
                            → visitor_access / maintenance_requests mutation
                            → publishSourceIntelligenceEvent (unchanged, existing)
  → consumer_automation_runs (unchanged shape — counts/status/actions[], both lanes converge here)
```

`executeRegisteredAction` already owns scope enforcement (`inActorScope`: actor `estate_id` must match the target row's `estate_id`) and role enforcement (`operationalRole`) — PR 2 adds no new authorization logic, only the batch/timeout scaffolding calling into it, exactly the reuse required.

### Known, accepted asymmetry (inherited, not introduced)

`registered_action` results do not produce an `ai_execution_ledger` row — `executeRegisteredAction` writes directly to `visitor_access`/`maintenance_requests` plus `publishSourceIntelligenceEvent`, the same shape it already had before any automation could call it (via the existing conversational confirm-flow in `oyiUnifiedIntelligenceService.ts`). Automation inherits this, doesn't create a new gap.

### Rollback (PR 2)

Same mechanism as PR 1: `AUTOMATION_SURFACE_FACILITY_ENABLED=false`. No new flag was introduced for the `registered_action` lane specifically — it is reachable only through a facility-surfaced automation, which is already fully gated by the one existing flag.
