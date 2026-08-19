# Oyi Runtime Domain Model — Conversation / Task / Action / Automation

Status: canonical reference, written from direct repository audit (not aspirational). Consolidates what already exists; introduces no new subsystem. Companion to `OYI_WORKFLOW_ACTION_MODEL.md` (which owns the Conversation-Action distinction in more depth) and `CURRENT_SYSTEM_MAP.md` (which owns the cross-repo map). This document is the one that separates the four domains cleanly and states what's shared versus surface-specific.

## The four domains are not the same object

| Domain | Answers | Authoritative store |
|---|---|---|
| **Conversation** | "What did the user ask, and what did Oyi say back?" | `oyi_conversation_threads` / `oyi_conversation_messages` |
| **Action** | "What did Oyi actually attempt to do, on which device/capability, and did it succeed?" | `ai_execution_ledger` |
| **Task** | "What operational work is outstanding, owned by whom, due when?" | `ochiga_workflows` / `ochiga_workflow_events` |
| **Automation** | "What rule/schedule creates actions repeatedly without a live conversation?" | `consumer_automations` / `consumer_automation_runs` |

They interoperate through reference fields (`conversationReference`, `automationReference`, `source_event_id`, `command_execution_id`), never by collapsing into one table. A conversation can create a task. A task can require an action. An automation creates actions on a schedule. None of the four is a special case of another.

Note: `OYI_WORKFLOW_ACTION_MODEL.md` uses "workflow" for the *conversational* device-confirmation state machine (`oyi_conversation_workflows`/`oyi_actions`, WorkflowService/ActionService) — this is **not** the same thing as `ochiga_workflows` (the operational Task domain below), despite the name collision. That document's own "Distinction" section already makes this split; this document's Task domain is exclusively about `ochiga_workflows`.

---

## Domain 1 — Conversation

- **Runtime**: `ConversationOrchestrator.run()` (`src/oyi-core/orchestration/ConversationOrchestrator.ts`)
- **Shape**: `CanonicalConversationResponse` (`src/oyi-core/contracts/canonicalConversation.ts`)
- **Entry points**: `/oyi/runtime/conversation`, `/oyi/chat` (legacy) — both `src/routes/oyiRoutes.ts`; `/office/conversation/corporate`, `/office/conversation/internal` — both `src/routes/officeExport.ts`
- **Actor/surface/scope**: `oisContext: {surface: OisSurface, estate_id, home_id, module, role}` (`src/types/oisContext.ts`)
- **Persistence**: `persistCanonicalConversationTurn` (`src/oyi-core/persistence/canonicalConversationPersistence.ts`) — conditional on a registered capability handling the turn
- **Confirmation**: conversational continuation via `oyi_conversation_workflows`/`oyi_actions` (see `OYI_WORKFLOW_ACTION_MODEL.md`), not a REST action
- **Used by**: Office, Website, Consumer, Facility — all four, confirmed live

## Domain 2 — Action

- **Runtime**: `ExecutionLedgerService` (`src/oyi-core/runtime/executionLedger.ts`), fed by `executeDeviceCommandForActor` (`src/controllers/deviceCommandController.ts`) via the Universal Signal Runtime's one ingestion point (`src/oyi-core/service.ts`, `startForSignal`)
- **Shape**: `ExecutionLedgerRecord` (`executionLedger.ts`)
- **Lifecycle**: `pending_confirmation → confirmed/denied → recorded → executed/failed/expired`
- **Classification (this pass)**: `isGenuineDeviceCommand()` (`executionLedger.ts`) — only `action` values matching `/^device\.command\./` are real Action-domain events. The ledger table also carries generic Universal Signal Runtime traffic (e.g. `emitAuditEvent()`'s `audit.recorded` signal, `src/core/foundation/audit.ts`) that is not a capability execution and must never be read as one.
- **Used by**: every real device command, scene action, and automation action, regardless of origin (`origin: consumer_app|facility_app|office_app|automation|provider|physical`) — already the one shared execution truth; no change needed to make it shared, only to read it correctly.

## Domain 3 — Task

- **Runtime**: `src/intelligence-core/workflows.ts` — `createWorkflow`, `transitionWorkflow`, `listWorkflows`, `getWorkflow`, `escalateDueWorkflows`
- **Shape**: `ochiga_workflows` row (migration `supabase/migrations/20260612000100_ochiga_workflow_orchestration.sql`) — `workflow_id, workflow_type, workflow_status, workflow_priority, workflow_owner, workflow_assignee, workflow_due_at, workflow_escalation_at, origin_agent, responsible_agent, title, summary, estate_id, home_id, department_id, team_id, source_event_id, metadata`; audit trail in `ochiga_workflow_events`
- **Lifecycle**: `created → reviewed → assigned → accepted → in_progress → completed/verified/cancelled/failed/blocked/escalated`
- **Permission**: `canViewWorkflows()` role allowlist (`super_admin|ochiga_admin|estate_admin|facility_manager|security_operator|maintenance_operator`); scope via `getIntelligencePermissionPolicy()`
- **Observability**: already publishes to `ochiga_intelligence_events` (the same table the Oyi Cross-Surface Observability Closure uses) on every create/transition, `source: "ochiga_workflows"`
- **Used by (before this pass)**: Facility's operator queue (`operatorQueueService.ts`) renders these rows as its live task list; Consumer reads aggregate counts (`intelligenceService.ts`). **Office has never connected to this table.**
- **Office's own, separate system**: `crm_tasks` (Office's own store, CRM-relationship-anchored via `validateOperationalRelationships`) remains canonical for CRM/commercial tasks per the platform boundary contract below — not replaced, not migrated.

## Domain 4 — Automation

- **Runtime**: `src/routes/scenes.ts` — REST at `/scenes/automations*`; scheduler `startAutomationRuntimeV2Scheduler()` (30s tick, scans `consumer_automations` where `enabled AND next_run_at <= now`)
- **Shape (definition)**: `consumer_automations` — `trigger`/`condition`/`actions` as JSONB; domain-specificity lives entirely in the JSON content, not the table shape
- **Shape (run)**: `consumer_automation_runs` — `trigger_occurrence_key` (idempotent retry key, unique with `automation_id`), `status: queued|evaluating|running|succeeded|partially_succeeded|failed|skipped|cancelled`, `counts`, `actions[]`
- **Relationship to Action domain**: every run action dispatches through `executeDeviceCommandForActor` — same ledger, `origin: "automation"`
- **Scope (this pass)**: Consumer-only. **Not touched in this pass** — scheduler generalization is explicitly deferred to a later, separately-approved pass.

---

## Platform boundary this pass fulfills

`src/contracts/platformBoundaries.ts` already declares:

```
id: "office-backend-intelligence-events"
producer: "ochiga-office", consumers: ["ochiga-backend"]
ownerCapability: "corporate_crm", sourceOfTruth: "ochiga-office"
compatibility: "additive_contract"
notes: "Office emits material CRM/commercial events; Backend/Oyi Core may
consume projections without owning CRM truth."
```

This contract existed with no concrete HTTP implementation before this pass (the referenced `/office/events/material` path is not implemented anywhere in `src/routes`). The new `POST /office/workflows` / `PATCH /office/workflows/:id` routes (`officeExport.ts`) are the concrete fulfillment of this exact, already-approved contract — Office stays the source of truth for `crm_tasks`/leads/proposals/deployments; `ochiga_workflows` receives an additive projection for cross-agent operational visibility (e.g. `origin_agent: "osa", responsible_agent: "facility"` signaling a real handoff). Backend never becomes CRM source of truth. `scripts/platform-boundary-contract-smoke.mjs` already asserts this invariant and is unmodified by this pass.

## What is explicitly NOT bridged this pass, and why

`WORKFLOW_CONTRACTS` (`workflows.ts`) lists five `oma`/`osa`-originated types. Four have a genuinely distinct, real Office trigger. `customer_onboarding` does not — Office has no event separate from deployment-project creation (`deployment_required`'s own trigger) that would justify firing both without one being fabricated noise. Left unbridged; documented here rather than silently dropped.
