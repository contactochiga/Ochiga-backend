# Shared Automation Runtime — PR 1 (surface foundation)

Status: PR 1 of an approved 3-PR rollout (PR 1 infrastructure → PR 2 Facility → PR 3 Office, each separately approved and deployed). This document covers PR 1 only: what changed, what stayed identical, and exactly what remains disabled.

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

## Rollback

Set both flags to `false` (or leave them at their default). No code revert needed for a flag-only rollback — every new branch this PR added is already provably inert at `false`. Full code rollback (revert the deploy) remains available as a second line of defense if the additive branches themselves are ever suspected of a regression, but is not expected to be necessary since `surface='consumer'` runs through the exact same code as before this PR.
