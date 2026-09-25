# Wave 7 — Decision & Planning Convergence — Slice 3 — Lifecycle Vocabulary Normalization

Status: COMPLETE. Local commit only, not pushed, not deployed.
Baseline: `eda4305` (Wave 7B, Slice 2 — identity-chain repair). Slice 0 audit: `docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §37, roadmap row 3.

## 0. What this slice is, and is not

This slice builds `normalizeLifecycleStage()`, a pure translation function that maps each real, evidence-verified status literal of ten decision/planning-adjacent object types onto one small, shared reporting vocabulary — for cross-object UI/reporting language only.

It is explicitly **not**: a database status migration; a universal workflow state machine; a rename of any existing domain status; a canonical Decision object; a GoalRuntime generalization; a Plan convergence; a Task convergence; or any change to any domain's own transition logic. Every object in scope keeps its own real status field, its own real writers, and its own real transition rules exactly as they are today. This slice creates a common **language for reporting**. It does not create a common lifecycle **authority**.

## 1. Baseline verification

- `git rev-parse HEAD` before work began: `eda430513633d37e9a17d22b61f4c645e48f7ea6` — matches the expected `eda4305` exactly.
- `origin/main` at that time: 2 ahead / 0 behind (Slice 1's `08840a7` and Slice 2's `eda4305` remain local-only, unpushed, as required).
- Working tree showed exactly the same protected, pre-existing, unrelated noise present at every prior verification in this programme (`scripts/pilot-import.mjs`, `src/routes/me.routes.ts` modified; `.aider.*`, `docs/OYI_DIGITAL_TWIN_ASSET_CONTRACT.md`, `docs/WAVE6_CAMERA_EDGE_HEALTH_AUTHORITY_AUDIT.md`, `docs/WAVE6_SLICE14G_CAMERA_EDGE_FINAL_CHECKPOINT_AUDIT.md`, `docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md`, `opencode.json`, `pilot/luna-residences/`, five `LOCAL_TEST_*.sql` migrations, untracked) — nothing unexpected staged or modified.
- Re-read the Slice 0 audit's own §37 roadmap row 3 text directly from source rather than from any paraphrase, along with the row 4 text for Slice 4 (Human-in-the-loop unification view), confirmed below in §9.

## 2. Real lifecycle-vocabulary inventory

Every row below is grounded in a grep/read-verified writer or declared-but-currently-unreachable literal. "Real writer found" means a source line that actually assigns that literal to that field was located; "declared only" means the literal exists in a TypeScript type/constant but no write site was found.

### 2.1 Recommendation — `operational_recommendations.status`

| Literal | Status | Evidence |
|---|---|---|
| `open` | Real, in-memory only | `operationalRecommendations.ts:172` (ephemeral bundle value; always remapped to `pending` at `materialization.ts:35` before any DB write — never appears in the database itself) |
| `pending` | Real, DB writer | `materialization.ts:35` (materialization write path) |
| `resolved` | Real, DB writer | Final A RPC `oyi_complete_materialization`'s incident-resolution branch (`20260924112951_..._durability.sql:118`) |
| `dismissed` | Real, DB writer | `canonicalIntelligenceStore.ts::recordFeedback()` lines 356-361, only for `objectType === "recommendation"` and feedback type `dismissed`/`not_useful`/`false_positive` |
| `expired` | Declared only | No writer found anywhere |
| `accepted_by` | **Not a status literal** | This is a column name (`accepted_by text`, `20260728143000_..._canonical_storage.sql:128`), not an enum value — corrected here after being loosely grouped with the dead-status literals in earlier working notes |
| `monitoring` | **Not a real recommendation status** | Only ever written to the *different* `operational_incidents.status` field (`incidentCorrelation.ts:100`). Slice 1's own `LIVE_CANONICAL_RECOMMENDATION_STATUSES` constant (`intelligenceOrchestrator.ts:103`) and `executive.ts:212`'s `unresolvedIssues` filter both independently treat `"monitoring"` as if it were a live recommendation status. Neither is a functional bug — the extra branch never matches a real row — but both repeat the same imprecision, and this slice's mapper deliberately does not repeat it a third time (see §7 adversarial tests). |

Terminal (per real behavior, nothing further ever mutates it): `resolved`, `dismissed`, `expired`. Human-approval-waiting: `pending`/`open`.

### 2.2 Plan — `operational_plans.status` (`AutomationPlanStatus`)

| Literal | Status | Evidence |
|---|---|---|
| `planned` | Real writer | `safeAutomation.ts:174`, plan creation |
| `awaiting_approval` | Real writer | `safeAutomation.ts:174`, plan creation |
| `prepared` | Real writer | `safeAutomation.ts:174`, plan creation |
| `expired` | Declared only | No writer found |
| `cancelled` | Declared only | No writer found |

No code path anywhere ever mutates `operational_plans.status` after creation (confirmed by grepping every `from("operational_plans")` call site: two reads in `canonicalAwarenessReadService.ts`, one deprecated upsert in `canonicalIntelligenceStore.ts::persistPlans()`). Practical consequence: every plan that exists today is permanently non-terminal from a reporting standpoint — this is disclosed as a real gap in §8, not fixed here (fixing it would be domain transition logic, out of scope). `approval_state` (`required`/`not_required`) is a separate two-value field, distinct from `status`, and is not part of this taxonomy.

### 2.3 Goal — `oyi_goals.status` (`GoalStatus`, `src/contracts/goal.ts`)

16 declared values. `GOAL_TERMINAL_STATUSES = ["completed","cancelled","expired","failed"]`, `GOAL_DUE_STATUSES = ["active","observing","action_due","waiting","reevaluating"]` (both exported from source, used directly as ground truth below).

| Literal | Status | Evidence |
|---|---|---|
| `understood` | Declared only | Zero writers found anywhere |
| `proposed` | Real writer | `ConversationOrchestrator.ts:2233`, human-initiated conversational goal creation |
| `confirmed` | Declared only | No writer found *for a goal specifically* (the many other `"confirmed"` hits in this codebase are an unrelated device/communication/proposal confirmation vocabulary) |
| `active` | Real writer | `officeMaterialEventAdapter.ts:199`, material-event-driven goal creation |
| `observing`, `action_due`, `executing`, `verifying`, `waiting`, `reevaluating` | Declared, part of `GOAL_DUE_STATUSES` | Scheduler-cycle statuses; not individually re-verified per-writer beyond the exported constant, which is treated as authoritative |
| `paused` | Declared | Not individually re-verified beyond the type |
| `completed` | Declared, `GOAL_TERMINAL_STATUSES` | — |
| `blocked` | **Real, actively-written writer** | `goalEvaluator.ts` lines 141, 190, 240 — stop-condition match, max-attempts-reached, negative-reply. Each clears `next_evaluation_at`, so the scheduler never revisits the goal again. |
| `failed`, `cancelled`, `expired` | Declared, `GOAL_TERMINAL_STATUSES` | — |
| `needs_human` | Declared | — |

**Disclosed tension:** `blocked` behaves functionally terminal (scheduler never revisits it) but is **not** included in the domain's own exported `GOAL_TERMINAL_STATUSES`. This mapper maps `blocked` to the `failed_execution` reporting stage (the truthful semantic match for "automated pursuit did not reach its condition and stopped") but honors the domain's own source of truth for the `terminal` flag — i.e. `normalizeLifecycleStage({objectType:"goal", status:"blocked"}).terminal === false` today. Resolving this tension would mean changing `GoalRuntime`'s own domain semantics, which this slice must not do (see §33 stop condition). It is recorded here for whoever owns that domain next.

### 2.4 Task — Office `crm_tasks` status, via Backend's own `TASK_STATUS_TRANSITIONS` bridge (`src/oyi-core/context/officeActionProposal.ts:60-65`)

Backend has no direct database access to Office's `crm_tasks` table (separate Supabase project). This is the complete real vocabulary Backend's own bridge code declares and depends on:

| Literal | Transitions to (per `TASK_STATUS_TRANSITIONS`) |
|---|---|
| `open` | `in_progress`, `completed`, `cancelled` |
| `in_progress` | `open`, `completed`, `cancelled` |
| `completed` | *(none — terminal)* |
| `cancelled` | *(none — terminal)* |

Sibling constants in the same file (`MEETING_STATUS_TRANSITIONS`, `SUPPORT_STATUS_TRANSITIONS`, `PORTFOLIO_STATUS_TRANSITIONS`, `PARTNERSHIP_STATUS_TRANSITIONS`) follow the identical shape and are all Office-bridge, not Backend-authoritative, vocabularies for other Office object types outside this slice's ten-object scope — not individually mapped here.

### 2.5 Automation approval — Facility `automation_approvals.status`

9 declared values, all with real writers per the prior Wave 0/5 audit's own findings: `pending_approval`, `approved`, `rejected`, `expired`, `cancelled`, `executing`, `succeeded`, `failed`, `verification_failed`. `approval_state` (a separate 2-value field on Plan) is unrelated.

### 2.6 Automation run — `ExecutionLedgerRecord.status` (`ExecutionStatus`, `src/oyi-core/runtime/executionLedger.ts:66-72`)

This is the cross-cutting signal/execution ledger (not scoped to automation plans alone — it opens one record per accepted signal, `service.ts:138`).

| Literal | Status | Evidence |
|---|---|---|
| `recorded` | Real writer | `executionLedger.ts:330`, `startForSignal()`, when `receipt.accepted` |
| `executed` | Real writer | `service.ts:328`, `complete()`, on accepted completion |
| `failed` | **Real writer, but undeclared in the type** | `service.ts:226` and `service.ts:328` both write `status: "failed"`, yet `"failed"` does not appear anywhere in the `ExecutionStatus` union. This is the mirror image of the declared-but-dead literals found elsewhere: here the type is *incomplete* relative to real runtime behavior. |
| `pending_confirmation`, `confirmed`, `denied`, `expired` | Declared only | No writer found for any of the four |

### 2.7 Workflow — `WorkflowStatus` (`src/oyi-core/contracts/workflow.ts:5-20`)

Confirmed this is the genuinely live declaration by import-graph tracing: it is imported by `WorkflowService.ts`, `WorkflowStateMachine.ts`, `WorkflowRepository.ts`, `ActionService.ts`, `ConversationOrchestrator.ts`, and `DeviceActionCapabilityModules.ts`. Its own `WorkflowStateMachine.ts:3` exports `TERMINAL: WorkflowStatus[] = ["answered","empty","unavailable","unsupported","permission_restricted","completed","failed","cancelled","expired","superseded"]`, used directly as ground truth for the `terminal` flag below — not re-derived.

17 declared values: `collecting_inputs, awaiting_clarification, ready_for_review, awaiting_approval, approved, executing, verifying, answered, empty, unavailable, unsupported, permission_restricted, completed, failed, cancelled, expired, superseded`.

`permission_restricted` is the one clean, real, named instance in this entire inventory of an authority/permission check concluding an object's lifecycle — it maps to a distinct `policy_denied` reporting stage rather than being folded into `failed_execution` or `cancelled` (see §5, and the explicit "do not collapse execution failure vs. policy denial" instruction this slice was given).

**Same-class finding:** two *other*, separately-declared `WorkflowStatus` types exist in this codebase:
- `src/oyi-core/runtime/conversationWorkflowRuntime.ts:5-16` — 12 values, overlapping but not identical to the live one above (shares `collecting_inputs…verifying`, but substitutes `completed/failed/cancelled/expired/superseded` for `answered/empty/unavailable/unsupported/permission_restricted`). Imported only by `canonicalConversation.ts` and `canonicalTurnResolution.ts`.
- `src/intelligence-core/workflows.ts:9` — 11 values (`created, reviewed, assigned, accepted, in_progress, completed, verified, cancelled, failed, blocked, escalated`), a clearly legacy, structurally unrelated vocabulary from the pre-Oyi-Core `intelligence-core` system.

This is a genuine duplicate-vocabulary finding, recorded in §10, and deliberately **not** folded into this slice's `WORKFLOW_STATUS_MAP` — mapping the wrong `WorkflowStatus` type's literals onto the right type's meaning would be a silent correctness bug, not a normalization.

### 2.8 Conversation proposal — `OfficeActionProposalStatus` (`GovernedActionProposal`, `src/contracts/governedAction.ts:22-28`)

Read directly from source: `pending, confirmed, cancelled, expired, superseded, executed` — 6 values.

### 2.9 Communication (included as a secondary, evidenced lifecycle — goal plan steps dispatch through it)

`src/services/communicationRuntime/CommunicationRuntime.ts` — real inline writers found for every value: `clarification_required` (lines 165/168/171, missing recipient/content), `rejected` (lines 179/239/255 — `recipient_opted_out`, validation failure, `rate_limited`; every real reason is a system/policy check, never an explicit human decision), `ready` (261), `confirmed` (310), `sending` (335), `failed` (338, `not_configured`), `cancelled` (393). No `sent` write site was located as an explicit string in the files read, but the type's `send()` success path (line 102) returns `status: "sent"` directly — included as a real writer.

### 2.10 Handoff — Office `office_handoffs`, via `src/oyi-core/ingress/officeHandoffBridge.ts`

Deliberately **no real Backend-side vocabulary exists**. `requestOfficeHandoff()`'s own return type declares `status: string` and `routing_status: string` as untyped pass-through fields (lines 34-35) — Office is the sole authority for handoff status, and Backend's own code never compares either field against any literal anywhere. This is not a gap in this slice's research; it is the honest state of the integration. The mapper's `handoff` table is therefore intentionally empty (§6) — every handoff status resolves to `unknown`, which is the only truthful answer available today.

### 2.11 Excluded from this taxonomy (evidenced, but out of scope)

- **Audit-event status** (`emitAuditEvent`'s `status: "success" | "denied" | ...`, `service.ts:361`) — a generic logging/observability vocabulary, not a decision/planning lifecycle object.
- **Device command execution status** (`deviceCommandExecutionStore.ts`'s `pending_confirmation/executed/failed` collapsing function, `dbStatus()`) — Wave 5's frozen physical-execution authority, a different object entirely from the signal-level `ExecutionLedgerRecord` in §2.6, and out of this slice's scope by the Wave 5 freeze.
- **`maintenance_requests.status`** — confirmed deliberately free-text with no enum/CHECK constraint (`maintenanceTransition.ts:17-18`, an explicit in-source comment). Real literals seen: `open, assigned, accepted, completed, verified, closed, cancelled`. Not part of this taxonomy's ten object types (maintenance is a Facility operational-request object, not one of the recommendation/plan/goal/task/approval/automation-run/workflow/proposal/communication/handoff set this slice was scoped to), but its shape (free-text, no enum) is itself worth noting for anyone extending this mapper later.

## 3. Object semantics (kept distinct, not normalized away)

| Object | What it actually represents |
|---|---|
| Recommendation | Advisory intelligence output — a suggestion, not a commitment |
| Plan | A proposed, materialized route to a recommendation's action |
| Goal | An actor-facing desired outcome, pursued over time by `GoalRuntime`'s own decision loop |
| Task | An Office CRM obligation assigned to a person |
| Automation approval | A human authorization decision gating a Facility automation |
| Automation run | The execution outcome of one accepted signal moving through Oyi Core |
| Workflow | A conversational device-action's own multi-turn resolution state |
| Conversation proposal | A governed action awaiting explicit human confirmation before execution |
| Communication | A message's dispatch lifecycle, often itself the payload of a goal's plan step |
| Handoff | Office's own ownership-transfer record; Backend is a caller, not an authority |

Nothing above was merged, renamed, or given a shared identity. `normalizeLifecycleStage()` reads a `{objectType, status}` pair and returns a reporting stage; it never infers or assumes a relationship between object types.

## 4. The real cross-object reporting problem (not manufactured)

Two pieces of direct evidence, both found during this slice's own research, not invented for this document:

1. **`buildExecutiveBriefing()` (`src/oyi-core/runtime/executive.ts:212`)** computes `unresolvedIssues` via `recommendations.filter((item) => item.status === "open" || item.status === "monitoring")` — a bespoke, inline, single-purpose status filter that (a) duplicates knowledge of the recommendation vocabulary that now also lives in this slice's `RECOMMENDATION_STATUS_MAP`, and (b) repeats the same "monitoring is a live recommendation status" imprecision independently found in Slice 1's own code (see §2.1). This is exactly the kind of ad-hoc, scattered status-checking this slice's shared vocabulary exists to stop from proliferating — not a hypothetical, a real line of shipped code.
2. **No code anywhere today reports jointly across Recommendation + Plan + Goal + Task + Approval + Automation-run + Workflow using one consistent vocabulary.** `buildExecutiveBriefing()` only ever consumes the *ephemeral* recommendation/plan bundle (never goals, tasks, approvals, or workflows); nothing in the codebase currently answers "what, across every decision/planning object type, needs a human's attention right now" — because doing so today would require re-implementing seven separate bespoke filters, each with its own risk of the `executive.ts` kind of imprecision. The absence of that capability, not a syntactic-naming mismatch, is the real problem this slice's shared vocabulary is positioned to solve for later consumers.

## 5. Taxonomy design

15 stages, each justified by a real distinction found in §2 (not the placeholder `PENDING/ACTIVE/BLOCKED/SUCCEEDED/FAILED/CANCELLED/UNKNOWN` set — several of those *are* present because the evidence genuinely supports them, but `policy_denied`, `dismissed`, `superseded`, `no_outcome`, and `not_started` exist specifically because collapsing them into a smaller set would have erased a real distinction the source code itself makes):

| Stage | Meaning | Why it exists (not collapsed into something else) |
|---|---|---|
| `not_started` | Created, no work begun, no human gate | Distinct from `awaiting_human_decision`: task `open` and goal `understood` have no approval gate at all |
| `awaiting_human_decision` | A human approval/confirmation is the next required step | §9's explicit human-approval-waiting distinction |
| `awaiting_human_input` | A human must supply information/clarification, not approve/reject anything | Distinct from an approval gate — `needs_human`, `awaiting_clarification` |
| `in_progress` | Actively underway, non-terminal, no human gate pending | — |
| `paused` | Explicitly paused | Goal `paused` is a deliberate, distinct state from `waiting`/`reevaluating` |
| `succeeded` | Terminal, successful outcome | — |
| `no_outcome` | Terminal, but neither success nor failure (a query concluded with nothing to report) | Workflow `empty/unavailable/unsupported` — collapsing these into `succeeded` or `failed_execution` would misrepresent both |
| `failed_execution` | Terminal, something was attempted and broke | §10's explicit instruction |
| `policy_denied` | Terminal, an authority/permission check concluded the object, not a human decision | Workflow `permission_restricted`; Communication `rejected` (opt-out/validation/rate-limit) — §10's explicit "policy denial" category |
| `rejected_by_human` | Terminal, an explicit human said no | Automation-approval `rejected` — distinct from `policy_denied` and `failed_execution` per §10 |
| `dismissed` | Terminal, advisory feedback marked it not useful | Recommendation `dismissed` — distinct from rejection (no one approved/denied anything; it was fed back as noise) |
| `cancelled` | Terminal, voluntarily withdrawn | §10's explicit instruction |
| `expired` | Terminal, time lapsed | §10's explicit instruction |
| `superseded` | Terminal, replaced by a newer object | Workflow/proposal `superseded` — distinct from cancellation (something else took its place, it wasn't withdrawn) |
| `unknown` | Unrecognized or unmapped | §7 |

## 6. `normalizeLifecycleStage()`

`src/oyi-core/presentation/lifecycleStage.ts` — placed alongside the existing `timeFreshness.ts` and `objectFallbackPresentation.ts`, an already-established genuine Core presentation location, not inside any single domain (Office/Facility/Consumer/Camera/GoalRuntime) and not a generic `utils` dump.

```ts
normalizeLifecycleStage({ objectType, status }) ->
  { objectType, rawStatus, stage, terminal, awaitingHuman, mapped }
```

Type safety is via ten typed per-object-category `Record<string, StageEntry>` lookup tables (§19 — "typed object-category mappings, not one giant untyped string switch"), each independently documented and sourced from §2's evidence, dispatched through one `Record<LifecycleObjectType, ...>`. It is a pure function: no import of Supabase, no network call, no mutation of its input, deterministic for identical input (all proven by the smoke script, §7 below).

Never replaces or persists over an object's own authoritative status — callers keep reading/writing the real status field exactly as they do today; this function is called *in addition to*, never *instead of*, that read.

## 7. Unknown-status handling

Any `{objectType, status}` pair not present in the relevant table resolves to `{stage: "unknown", terminal: false, awaitingHuman: false, mapped: false}` — never a default guess. Verified by the smoke script for: an unrecognized literal; `"monitoring"` on a recommendation (the exact real imprecision found in §2.1); a real literal from the *wrong* object type (`awaiting_approval` passed as a recommendation status); `null`; `undefined`; empty string; whitespace-only string; a non-string value; an unrecognized `objectType`; and a missing `objectType`. Casing/whitespace are normalized (trim + lowercase) before lookup, so `"ACTIVE"`/`" Active "`/`"active"` all resolve identically — this is a presentation normalization, not new domain leniency (the underlying database/TypeScript literals are not case-variant in practice; this only protects the reporting layer itself from failing needlessly on cosmetic variance).

## 8. Terminality — truthfully derived, not invented

Terminality is copied from each domain's own authoritative source where one is exported (`GOAL_TERMINAL_STATUSES`, `WorkflowStateMachine.TERMINAL`, `TASK_STATUS_TRANSITIONS`'s empty-target-array convention) rather than re-derived from the stage name. The one disclosed exception is `goal:blocked` (§2.3) — mapped to `failed_execution` for reporting language, but `terminal: false` because the domain's own `GOAL_TERMINAL_STATUSES` says so. This tension is surfaced, not silently resolved.

## 9. Human-approval-waiting vs. generic waiting (preserved)

`awaitingHuman: true` is set only for stages that represent an actual decision or input gate blocking on a person: `awaiting_human_decision` and `awaiting_human_input`. Goal's own `GOAL_DUE_STATUSES` (`active, observing, action_due, waiting, reevaluating`) are scheduler-cycle states with no human gate and are correctly `awaitingHuman: false` — a goal in `"waiting"` status is waiting on a scheduled recheck, not on a person, and this mapper does not conflate the two despite the superficially similar English word.

## 10. Failure vs. rejection vs. policy denial vs. cancellation vs. expiry (not collapsed)

All five are distinct stages (§5): `failed_execution` (automation-approval `failed`/`verification_failed`, workflow `failed`, automation-run `failed`), `rejected_by_human` (automation-approval `rejected`, automation-run `denied`), `policy_denied` (workflow `permission_restricted`, communication `rejected`), `cancelled`, `expired`. No object type's `cancelled` or `expired` literal is ever remapped to any other stage.

## 11-17. Per-object-type mapping audits

Each object type's full mapping table is embedded directly in `src/oyi-core/presentation/lifecycleStage.ts` next to its evidence comment (§2 above mirrors it 1:1). No object's own transition logic, writer, or authority was touched. `GoalRuntime.ts`, `safeAutomation.ts`, `operationalRecommendations.ts`, `officeActionProposal.ts`, `WorkflowStateMachine.ts`, `CommunicationRuntime.ts`, and `executionLedger.ts` are all byte-for-byte unmodified by this slice — confirmed by `git status --short` showing only the two new files plus the `package.json` script entry (see §32).

## 18-19. Placement and type safety

Covered in §6.

## 20. No database migration

None was created. None was needed — every object's status field, table, and writer are completely unchanged. If, during implementation, a migration had appeared necessary, the instruction was to stop and explain rather than create one; that situation never arose.

## 21. First consumer

**Deliberately not wired.** The clearest candidate (`executive.ts:212`'s `unresolvedIssues` filter, §4) sits inside Wave-6-frozen executive-briefing logic; touching it to wire in the new mapper would mean modifying Wave 6 territory for a "small first consumer," which is a larger risk than this slice's own conservative-scope discipline (established across Slices 1 and 2) accepts for an optional nicety. `normalizeLifecycleStage()` is delivered as a tested, documented, shared utility only, ready for a future slice (or Slice 4's human-in-the-loop unification view) to adopt deliberately.

## 22. Same-class search — ad-hoc lifecycle-normalization logic elsewhere

| Location | Function | Classification | Reasoning |
|---|---|---|---|
| `executive.ts:212` | `unresolvedIssues` inline filter | DUPLICATE_REPORTING_MAPPING | Re-implements, imprecisely, exactly the recommendation-awaiting-decision check this slice's mapper now expresses correctly — the strongest same-class finding, deliberately left untouched (§21) |
| `src/oyi-core/runtime/conversationWorkflowRuntime.ts:5` | `WorkflowStatus` (12 values) | GAP / duplicate vocabulary | A second, independently-declared `WorkflowStatus` type, overlapping but not identical to the live one this slice mapped (§2.7) — a same-class finding at the type-declaration level, not a function; not folded in, since doing so risks mismapping |
| `src/intelligence-core/workflows.ts:9` | `WorkflowStatus` (11 values) | GAP / legacy duplicate vocabulary | Clearly the pre-Oyi-Core legacy system's own vocabulary; structurally unrelated, correctly left out |
| `src/modules/cameras/cameraDvr.service.ts:82` | `normalizeDvrStatus()` | DOMAIN_TRANSITION_LOGIC | Computes a DVR's own authoritative reachability status from raw signals — not a reporting translation of an existing status, a different object type entirely (camera/DVR, outside this slice's ten object types) |
| `src/controllers/deviceCommandController.ts:271` | `lifecycleStep()` | PRESENTATION_MAPPING (different domain) | Builds a UI timeline entry for one physical device-command execution step — Wave 5's frozen physical-execution domain, not a decision/planning object |
| `src/controllers/facility.controller.ts:959` | `inviteLifecycleStatus()` | PRESENTATION_MAPPING (different domain) | Staff-invite lifecycle status — an unrelated object type |
| `src/controllers/walletController.ts:55` | `normalizeFundingStatus()` | DOMAIN_TRANSITION_LOGIC | Normalizes raw payment-provider strings into the wallet's own canonical `FundingStatus` enum — real domain authority, not reporting, and a completely unrelated object domain (payments) |
| `src/services/deviceCommandExecutionStore.ts:97,112` | `lifecycleRank()`, `safeLifecycle()` | EXECUTION_SEMANTICS (different domain) | Collapses raw device-command sub-statuses into a 3-state execution rank — Wave 5's frozen physical-execution authority, not touched |

No function anywhere was found performing exactly the same recommendation/plan/goal/task/approval/automation-run/workflow/proposal reporting-stage translation this slice now centralizes, other than the `executive.ts` inline filter above — confirming this genuinely fills a gap rather than duplicating existing, working code.

## 23-24. Wave 5 / Wave 6 freeze regression

No file inside Wave 5's execution-ledger writers, device-command execution store, or Wave 6's canonical materialization/durability RPCs was modified. Regression battery in §31 re-runs representative Wave 5/6 smokes to confirm.

## 25. Slice 1 / Slice 2 regression

`smoke:wave7-slice1-recommendation-authority` and `smoke:wave7-slice2-identity-chain-repair`(`-sql`) re-run clean in §31 — neither Slice touches this slice's new files, and this slice touches none of theirs.

## 26. End-to-end reporting proof

`scripts/wave7-slice3-lifecycle-vocabulary-smoke.mjs`'s "end-to-end" check builds a heterogeneous batch of real-shaped native objects (one per object type, native `status` field intact), snapshots them, runs every one through `normalizeLifecycleStage()`, and asserts both the correct stage per object and that the original array is byte-identical to its pre-normalization snapshot (`assert.deepEqual(nativeObjects, before)`) — proving the mapper never mutates source objects.

## 27. Adversarial tests

Covered in §7 — 9 distinct adversarial cases, all passing, all resolving to `unknown` rather than a false-positive stage.

## 28. Performance

1 / 100 / 1,000 normalizations timed with `process.hrtime.bigint()`, purely local (no DB/network/provider calls — the function has no such dependency to begin with): 1 call < 20ms, 100 calls < 50ms, 1,000 calls < 200ms — all comfortably passed (a plain object-key lookup is O(1); the budget is generous headroom, not a tight measurement).

## 29. Observability

None added. The function is a pure, cheap, synchronous lookup with no failure mode worth counting, and the task's own instruction was "no new metrics for the mapping itself" unless truly needed — it is not.

## 30. This document

Satisfies the required outline: native lifecycle inventory (§2), common taxonomy (§5), mapping table (§11-17, embedded in source), semantic exclusions (§2.11), unknown behavior (§7), first-consumer decision (§21), parallel systems intentionally retained (§0, §3), later Wave 7 implications (§31 below).

## 31. Wave 7 Slice 4 preview (not started, per this slice's stop condition)

The Slice 0 audit's own §37 roadmap row 4 names Slice 4 as: "Human-in-the-loop unification view — a queryable projection normalizing `automation_approvals`, `GovernedActionProposal`, and `oyi_goals.status='needs_human'` into one shape for UI/notification purposes, without changing underlying storage." This slice's `awaitingHuman: true` output on those three object types' relevant statuses (`automation_approval:pending_approval`, `conversation_proposal:pending`, `goal:needs_human`/`proposed`) is directly positioned to be the primitive Slice 4 would build that projection on top of — noted for whoever starts that slice, not acted on here.

## 32. Test suite results

- `npm run typecheck` — clean, zero errors, including the new file.
- `npm run build` — clean.
- `npm run smoke:wave7-slice3-lifecycle-vocabulary` — 97/97 checks passed.
- `npm run smoke:wave7-slice1-recommendation-authority` — re-run clean (see §31 regression log).
- `npm run smoke:wave7-slice2-identity-chain-repair` — re-run clean.
- `npm run smoke:wave7-slice2-identity-chain-repair-sql` — re-run clean (real PostgreSQL; Final A durability unaffected).
- Representative Wave 5/6 regression smokes — 24 of 28 in the full battery passed clean. Four pre-existing, environment-caused failures, none touching any file this slice created or modified:
  - `smoke:wave5-slice3-facility-automation-device-verification`, `smoke:wave5-slice4-facility-automation-verification-reconciliation`, `smoke:wave5c-consumer-device-authority` — all three fail identically with `Error: OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required for this local Supabase smoke test`. Confirmed by direct grep that this env var is genuinely absent from `.env` in this local environment — a pre-existing local-environment provisioning gap, not a code regression, and not something this slice's changes could affect (`lifecycleStage.ts` has zero Supabase/env dependency).
  - `smoke:oyi-office-intelligence-convergence` — fails with the exact same two assertions already documented as pre-existing, environment-caused noise in both `docs/WAVE7_SLICE1_RECOMMENDATION_READ_UNIFICATION_CONVERGENCE.md` and `docs/WAVE7_SLICE2_IDENTITY_CHAIN_REPAIR.md`'s own "known/environment failures" sections: `"a retry of the identical event must be recognized as a duplicate, got receipt=undefined"` and `"the durable store must contain exactly one row for this event after a retry, got 0"`. Same failure, third slice in a row — confirmed still out of this slice's scope.
- Real PostgreSQL was **not** needed for this slice's own new work, exactly as anticipated — `normalizeLifecycleStage()` has no persistence dependency. The Slice 2 SQL smoke was re-run only as part of the standing regression battery, not because Slice 3 itself required a database.

`git status --short` after implementation shows exactly: two new files (`src/oyi-core/presentation/lifecycleStage.ts`, `scripts/wave7-slice3-lifecycle-vocabulary-smoke.mjs`), one new doc (this file), one `package.json` line addition, plus the same pre-existing unrelated noise present at baseline (§1) — nothing else.

## 33. Stop condition

STOPPING HERE, as instructed. Slice 4 (human-in-the-loop unification view) is not started. No database status was renamed. No universal workflow state machine was created. No Decision object was created. GoalRuntime was not generalized. Plans and Tasks were not converged — every object's own status field, writers, and transition logic are untouched. This slice created a common language for reporting. It did not create a common lifecycle authority.
