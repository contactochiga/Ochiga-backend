# Wave 7 — Decision & Planning Convergence — Slice 6 — GoalRuntime Domain Generalization

Status: COMPLETE. Local commit only, not pushed, not deployed.
Baseline: `6b6b5c3` (Wave 7E, Slice 5 — canonical decision authority). Slice 0 audit: `docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §37 roadmap row 6, §36.

## 0. What this slice is, and is not

GoalRuntime already answers, honestly and well, "what sustained outcome are we pursuing over time, and what's the next step toward it" — but only for Office/commercial objectives (`target_entities` is lead/contact/organization-shaped only). This slice extends that same real machinery — identity, scheduler, evaluator, dedup, `needs_human` escalation — to also represent an **operational** objective (Facility/Consumer, targeting an estate/home/device), without redesigning physical execution, without becoming a second execution authority, and without replacing Facility Automation or Consumer Automation. GoalRuntime still owns "what outcome are we pursuing." Wave 5 still owns "are we allowed to do this physical action, and did it happen." This slice adds exactly one new, narrow bridge between the two — nothing else changes on either side.

## 1. Baseline verification

- `git rev-parse HEAD` before work began: `6b6b5c389128c56187c1052c4f71345bb172d858` (`6b6b5c3`) — matches expected exactly.
- `origin/main` at that time: 5 ahead / 0 behind.
- Working tree: exactly the same protected, pre-existing noise as every prior verification in this programme.
- Read in full: the Slice 0 audit, and the Slice 2/3/4/5 convergence records.

## 2. Complete pre-change GoalRuntime architecture

**Contract** (`src/contracts/goal.ts`): `GoalRecord` — identity (`id`, `correlation_id`, `requesting_actor_id`, `surface`, `conversation_thread_id`, `organization_scope`, `canonical_signal_key` — Slice 2), `objective` (free text), `target_entities` (lead/contact/user/organization/name/email/phone/whatsapp_phone, all required-nullable), `status: GoalStatus` (16 values, `GOAL_TERMINAL_STATUSES`/`GOAL_DUE_STATUSES` exported), `success_condition`/`stop_condition`/`reply_branches` (branch-on-reply), `plan: GoalPlanStep[]` + `current_step_index`, `schedule` (deadline/recurrence/timezone), `max_attempts`/`attempts_completed`, `observations`/`evidence` (bounded to last 100 each), `linked_crm_records`/`linked_tasks`/`linked_meetings`/`linked_automations`/`linked_communication_threads`, `execution_history` (bounded to last 100), `last_evaluated_at`/`next_evaluation_at`, `completion_reason`.

**Persistence** (`GoalRuntime.ts`): `oyi_goals`, service-role-only (`supabaseAdmin`). `target_entities` and `plan` are genuinely `jsonb` columns (confirmed by direct schema query, §40) — straight passthrough on read/write (`row.target_entities || {}`), no bespoke serialization. Real methods: `create`, `get`, `listForActor`, `mostRecentForThread`, `persist`, `claimForEvaluation` (CAS, `next_evaluation_at` equality), `listDue`, `findActiveForLead` (jsonb `@>` containment dedup), `findGoalsWatchingThread` (event-driven wake).

**Decision loop** (`goalEvaluator.ts::evaluateGoal()`, pure, returns an updated-but-not-yet-persisted record): (1) hard stop on deadline passed → `expired`; (2) hard stop on `attempts_completed >= max_attempts` → `blocked`; (3) check real evidence (latest inbound reply across `linked_communication_threads`) against `success_condition`/`stop_condition`/`reply_branches`, with unconditional `unsubscribe` → `cancelled` governance; (4) advance the staged plan — `executeStep()` dispatches by `action_type` (`escalate` → no dispatch, sets `needs_human`; `create_task` → real Office task bridge; everything else falls through to a `channel`-keyed `CommunicationRuntime.plan/authorize/dispatch` call, `voice_call` honestly failing since no telephony provider is configured) — then derives the next `status` (`blocked` on failure, `waiting` if more steps, `completed` if plan finished) and `next_evaluation_at` (`wait_hours` from the *next* step).

**Scheduler** (`goalScheduler.ts`): a pure "WHEN" — 30s poll → `listDue(10)` → CAS-claim (`claimForEvaluation`, prevents double-evaluation on a concurrent tick/retry) → `evaluateGoal()` → `persist()`. Contains zero domain logic. Exported `claimAndEvaluateGoal()` is also the event-driven wake entry point (`officeExport.ts`'s inbound webhook → `findGoalsWatchingThread` → immediate reevaluation) — the only existing event-driven wake in the whole system, and it is reply-specific.

## 3. Proven domain limitation

Constructed the realistic objective the task named: *"Restore Device X to the desired operating state."* Traced why the pre-change contract cannot honestly represent it:

1. `GoalTargetEntities` has no `estate_id`/`home_id`/`device_id` field at all — a device-targeted goal could only be described by abusing `lead_id`/`user_id` as a device reference, which is dishonest (those fields mean something specific to Office/CRM).
2. `GoalPlanStep.action_type` is a closed union of exactly 5 values, none of which are device-shaped: `send_communication | call | escalate | wait_for_reply | create_task`. `executeStep()` has a hard, exhaustive if/else chain over exactly these — there is **no fallthrough branch that does not either skip dispatch or call `CommunicationRuntime`**. A device-targeted plan step, if forced through the existing code, would fall into the generic communication-send branch and attempt to email/WhatsApp/SMS the objective text — not perform a device action. This is not a hypothetical: confirmed by reading `executeStep()`'s full body (`goalEvaluator.ts`, pre-Slice-6).
3. Nothing in `GoalRuntime`'s own module graph imports `intelligence-core/executionRegistry`, `DeviceCommandAuthority`, or any device-adjacent module — confirmed by grep across `services/goalRuntime/*.ts` before this slice's changes.

This is a real, evidence-grounded limitation, not manufactured — the audit's own Scenario B (`docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §35) independently reached the identical conclusion.

## 4. Goal ontology (locked)

| Object | Answers |
|---|---|
| Decision (Slice 5) | "What course of action has been selected" |
| **Goal** | **"What outcome are we pursuing over time"** |
| Plan (`GoalPlanStep[]`, unconverged with `operational_plans`/`automation_approvals.plan_snapshot`) | "What staged steps get there" |
| Action (a single `GoalPlanStep`, or `executeRegisteredAction`'s own bounded operation) | "One bounded operation performed as part of the plan" |
| Execution (Wave 5, `executeDeviceCommandForActor`/execution ledger) | "Did the attempt succeed" |
| Outcome | Not reified anywhere in this codebase — Wave 8 territory, untouched |

A Goal is not a Decision (it doesn't select a course of action, it pursues one already selected — see §12), not a Task (`linked_tasks` references real Office tasks a goal step may *create*, it never becomes one), not an Automation (Facility/Consumer automation remain independent, event/rule-driven — see §25/§26), not a Device Command (a Goal's device step still has to clear the exact same authority gate every other device command clears), not an Approval (a Goal's own `needs_human` is not `automation_approvals`/`GovernedActionProposal` — see §22).

## 5. `target_entities` before/after

Before: `{lead_id, contact_id, user_id, organization_id, name, email, phone, whatsapp_phone}` — all required-nullable.

After (additive, `src/contracts/goal.ts`): three new fields, **optional** (`estate_id?: string | null`, not required-nullable like the pre-existing 8) — deliberately, so every existing Office/commercial call site's own object literal (`officeMaterialEventAdapter.ts`, `ConversationOrchestrator.ts`) keeps compiling with zero changes. Storage: no migration (§40) — `target_entities` is `jsonb`; the new keys are simply absent from every pre-existing row and every future Office-goal row, which reads back honestly as `undefined`, never a fabricated `null`.

## 6. Scope semantics

`estate_id`/`home_id`/`device_id` describe **what** an operational Goal concerns — never **who may act on it**. Proven directly: `oyi_goals` has no `role`/`permissions`/`authorized`/`can_control` column at all (confirmed via `information_schema.columns`, real-Postgres smoke). Every device step still resolves a fresh, real actor and calls the exact same `authorizeDeviceCommand`/`capabilityRegistry` gate every other device command clears, at evaluation time, never at goal-creation time — proven in §11.

## 7. GoalPlanStep inventory (pre-existing, unmodified)

| `action_type` | Class | Executor | Side effects | Authority | Retry | Completion |
|---|---|---|---|---|---|---|
| `send_communication` | COMMUNICATION | `CommunicationRuntime.plan/authorize/dispatch` | Real message dispatch (email/whatsapp/sms/internal_message) | `pre_authorized: true` (goal itself was already confirmed at creation) | None within one evaluation (no automatic re-attempt of a failed step) | `ok` → step `done`; `!ok` → step `failed`, goal `blocked` |
| `call` | COMMUNICATION | Same, `voice_call` channel | Honestly fails — no telephony provider configured anywhere in this environment | Same | Same | Same |
| `escalate` | HANDOFF-shaped (internal `needs_human`, NOT the Office `HANDOFF` policy value — a naming overlap between two genuinely different mechanisms, noted so it is not conflated) | None — no dispatch | None | N/A | N/A | Goal → `needs_human` unconditionally |
| `wait_for_reply` | WAIT | None (its purpose is fulfilled passively — a reply arriving during step 3 of `evaluateGoal()` short-circuits before plan advancement reaches it) | None | N/A | N/A | N/A |
| `create_task` | TASK | `officeTaskBridgeService.createFollowUpTask` (real Office `crm_tasks` write) | Real task row created | None additional | None | `ok` → step `done`; `!ok` → step `failed`, goal `blocked` |

No existing `action_type` is AUTOMATION-shaped (none invokes Facility/Consumer automation) or OTHER. This inventory is unmodified by this slice — confirmed via `git status --short` showing no line inside these five branches changed.

## 8. New device-step contract (`device_action`)

Additive 6th `action_type`. `GoalPlanStepChannel` gained one new literal, `"device"` — mirroring the existing `"escalation"` precedent (a non-communication step still has to fill the required `channel` field honestly; neither implies a message channel). New type, `GoalDeviceCommand = { device_id: string; action_id: "device.on" | "device.off" | "device.toggle"; command: Record<string, unknown> }` — deliberately narrow: exactly the three real, currently-registered, `available:true` device action ids (`intelligence-core/executionRegistry.ts`'s own real set), no provider-specific payload duplicated here (`command` passes through unchanged to the same executor every other `device.*` caller already uses). `GoalPlanStep.device_command?: GoalDeviceCommand | null` — optional, non-null only for `device_action` steps, so every existing plan-step object literal keeps compiling unchanged.

## 9. Physical execution routing (non-negotiable, proven)

`executeStep()`'s new `device_action` branch calls **exactly one** function: `executeRegisteredAction()` from `intelligence-core/executionRegistry.ts` — the same real, unmodified entry point every other `device.on/off/toggle` caller in this repository already uses, which itself (unmodified) calls `authorizeDeviceCommand()` → `DeviceCommandAuthority` → `executeDeviceCommandForActor()`. No `adapterRegistry`, MQTT, Tuya SDK, Edge provider call, or device-table mutation exists anywhere in `goalEvaluator.ts` or the new `goalDeviceActor.ts` — proven by an explicit repository-wide structural assertion (comment-stripped source-pattern grep) in the smoke, per the task's own explicit requirement. A second assertion confirms `executionRegistry.ts`'s own device branch (untouched) still gates `authorizeDeviceCommand` strictly before `executeDeviceCommandForActor` in source order.

## 10. Capability kill-switch proof

Not re-tested at the `capabilityRegistry`/`DeviceCommandAuthority` level — that exact proof already exists and passes in `wave5-slice1-facility-automation-device-authority-smoke.mjs` (`capabilityModule.rolloutStatus = "disabled"` → `authorizeDeviceCommand` denies, fresh on every call, not cached), re-run unmodified as this slice's own regression (§38). This slice's own smoke proves the *boundary* correctly: `executeRegisteredAction()` returning `{ok:false, status:"denied", reason:"capability_disabled"}` — the exact shape `executionRegistry.ts`'s real device branch returns when `authorizeDeviceCommand` denies — is translated by `goalEvaluator.ts` into `needs_human` (not the generic `blocked`), and `executeRegisteredAction` is proven to be called with the identical, correct `action_id`/`entity_id`/`command`/`confirmed` shape every real caller uses. GoalRuntime caches no earlier allow decision anywhere — `executeStep()` calls the executor fresh, every evaluation, with no stored authority result.

## 11. Actor model

Audited: `GoalRecord.requesting_actor_id` is a bare string id; **no existing function anywhere in this codebase reconstructs a full `AuthUser` from a bare id** (confirmed by search) — the closest precedent, `src/middleware/auth.ts::loadUserContext()`, is itself module-internal, not exported. No `systemActor()`/synthetic automation-actor construct exists either — a comment in `executionRegistry.ts` (line ~241) explicitly names this as a gap "deliberately left to Wave 5 Slice 2," which never materialized.

Given this, `src/services/goalRuntime/goalDeviceActor.ts::resolveGoalDeviceActor()` performs the **exact same real `users` table lookup** `loadUserContext()` already performs for every authenticated request (`select id,email,username,role,estate_id,home_id,permission_scopes from users where id=?`), reusing the same real `permissionsForRole()` derivation (`core/foundation/permissions.ts`) — not a new authority model, the same one. If `requesting_actor_id` is `null`, or the `users` lookup finds nothing, or the row has no `role` on file, this returns `null` and the device step fails closed to `needs_human` — proven directly: zero calls to `executeRegisteredAction` in either case. No `facility_manager`/`ochiga_admin`/`system` role is ever fabricated anywhere in this slice's code.

## 12. Decision → Goal relationship

Already established in Slice 5, not re-invented here: `Decision.goal_id` (real FK, `on delete set null`) is populated additively, after the fact, by `attachGoalToDecision()` — the Decision necessarily precedes the Goal it may result in. This slice adds no new Decision→Goal linkage; Slice 5's own JV producer already demonstrates the one real, low-risk relationship the task allowed ("a multi-step pursuit *may* get a Goal; a one-shot Decision may not"). No automatic Goal-per-Decision rule was added.

## 13. Goal → Decision lineage disposition

**No new `decision_id` column was added to `oyi_goals`.** Inspected first, per the task's own explicit instruction: `Decision.goal_id` already owns the forward relationship (Decision → Goal); `Goal.canonical_signal_key` (Slice 2) already provides the reverse traversal path — `DecisionStore.listDecisionsByCanonicalSignalKey(goal.canonical_signal_key)` finds any Decision(s) that share the same originating signal as a given Goal, without a second, duplicated foreign key. This is sufficient: a bidirectional schema duplication was judged unnecessary and was not added.

## 14. Goal identity

Unchanged (Office) mechanism: `findActiveForLead()` (jsonb `@>` containment on `target_entities.lead_id`, client-side terminal-status filter) — untouched, re-verified passing. New, additive: `findActiveForDevice(deviceId)` (`GoalRuntime.ts`), identical shape — jsonb `@>` containment on `target_entities.device_id`, same terminal-status filter. Proven under real Postgres: same device retried (identical `device_id`) → the dedup query still finds exactly the one active goal; different device → finds nothing; a terminal-status goal is correctly excluded from the active set. No timestamp/random identity is used as semantic dedup anywhere in either method.

## 15. Operational Goal example

A bounded, representative fixture only — **not wired into any live producer/route**, per the task's own explicit preference ("prefer a safe test fixture rather than production wiring"). Objective: *"Restore Device X to the desired operating state."* Target: `{estate_id, home_id, device_id}`. Plan: one `device_action` step (`device.on`). Proven end-to-end (mocked executor boundary + real-Postgres persistence) in both new smokes. No closed-loop controller (observe → replan → reverify) was built — the task explicitly warned against inventing one GoalRuntime does not yet support; a single-step plan is the honest minimum that exercises the new contract.

## 16. Verification semantics

GoalRuntime does not decide truth. `executeRegisteredAction()`'s own return (`ok`/`status`/`result`) — sourced from the real, Wave-5-frozen `executeDeviceCommandForActor` — is the only outcome `executeStep()` ever consults; `provider accepted` vs. `physical success` distinctions (IR/`provider_ack_only` limitations) remain exactly as Wave 5 already defines them, untouched and unre-interpreted by this slice. No second verification model was created.

## 17. Step-completion semantics

A device step is marked, using GoalRuntime's own existing `GoalPlanStepStatus` vocabulary (`pending|due|executing|done|skipped|failed` — no new value added): `done` on `ok:true`; `failed` on `ok:false` (device or otherwise). At the **goal** level (a separate vocabulary, `GoalStatus`), a device-step outcome adds one new distinction on top of the pre-existing `blocked`/`waiting`/`completed` derivation: `outcome.needsHuman` (set only when `executeRegisteredAction` returns `status: "denied"` or `"validation_required"`, or when no real actor could be resolved, or the step had no `device_command` payload) routes to `needs_human` — the *same* status `escalate` already uses — rather than the generic `blocked` every other failed step reaches. This is not Wave 8 learning; it is a direct translation of "authority/actor unavailable" (a human-judgment case) vs. "attempted and failed" (an ordinary failure), using only vocabulary that already existed.

## 18. Retry / idempotency semantics

No automatic step retry exists anywhere in `evaluateGoal()`, before or after this slice — a failed step reaches `blocked`/`needs_human` and stops (`next_evaluation_at: null`); nothing re-attempts it within the same evaluation or automatically on a later tick. The scheduler's own CAS claim (`claimForEvaluation`, matched on `next_evaluation_at`) already prevents a concurrent tick or retry from evaluating (and therefore dispatching) the same goal twice — this slice's device step inherits that protection for free, with zero new code, since it runs inside the identical `evaluateGoal()`/scheduler machinery. No BullMQ/job-level retry wraps goal evaluation. `executeRegisteredAction()` itself performs no additional idempotency correlation beyond what Wave 5 already provides for `device.on/off/toggle`. Net result: one Goal retry (a re-triggered evaluation of the same due goal) cannot produce more than one physical dispatch attempt per plan step, by construction — no double-retry amplification was introduced.

## 19. Scheduler behavior

Unchanged, unmodified, re-verified. The scheduler (`goalScheduler.ts`) still answers only "when" (30s poll, CAS-claim, `evaluateGoal()`, persist) — it has no knowledge of `device_action` at all; it dispatches the exact same generic due-goal loop regardless of what kind of step a goal's plan contains. No new scheduler was created.

## 20. Event-driven wake disposition

Audited: the only existing event-driven wake is reply-specific (`findGoalsWatchingThread` → an inbound Office/CommunicationRuntime webhook). **No device/current-state-change wake mechanism exists today**, and per the task's own explicit instruction, none was built in this slice. An operational Goal's device step is therefore only re-evaluated by the existing 30s time-based scheduler poll — sufficient to prove this slice's contract honestly, but a real latency implication for any future live producer (disclosed as a gap, §45, not solved here).

## 21. Human-intervention behavior

A device step that cannot proceed (missing actor, missing `device_command`, or a denied/validation-required executor result) sets the goal to `needs_human` — the exact same `GoalStatus` value the pre-existing `escalate` mechanism and Slice 4's `HumanInterventionView`'s `goal_escalation` source already handle. **Zero changes were needed in `humanInterventionView.ts`** — `loadGoalEscalationSource()` already lists any goal with `status='needs_human'` for a given `goalActorId`, regardless of *why* it reached that status, so an operational goal that fails closed is automatically, correctly surfaced through the existing Slice 4 view with no new code. No second escalation system was created.

## 22. Lifecycle normalization

**No new `GoalStatus` value was introduced.** Every status a device step can reach (`needs_human`, `blocked`, `waiting`, `completed`) already existed before this slice and is already covered by Slice 3's `GOAL_STATUS_MAP` (`lifecycleStage.ts`), which was **not modified** — confirmed via `git status --short`. Slice 3's full 103-check suite re-run unmodified, clean.

## 23. Office backward compatibility

Proven directly: the existing `escalate`-step Office/commercial goal fixture, run through the real, modified `evaluateGoal()`, reaches `needs_human` exactly as before, and `executeRegisteredAction` is confirmed to never be called for a non-device step (0 calls, asserted). A `GoalTargetEntities` object with no `estate_id`/`home_id`/`device_id` at all evaluates identically — the three new fields are read nowhere except inside the new `device_action` branch. Real-Postgres proof: an Office goal (`lead_id`-shaped `target_entities`, no operational fields) persists and reads back with the new keys genuinely absent (`<ABSENT>`, not `null`), and `findActiveForLead`'s own real query is unaffected by `findActiveForDevice` existing alongside it. `smoke:goal-runtime` and `smoke:oyi-office-intelligence-convergence` re-run as regression (§38).

## 24. Facility Automation coexistence

Not replaced, not touched (`git status --short` confirms zero changes to `facilityAutomationService.ts`). The distinction is explicit and unchanged by this slice: Facility Automation is event/rule/policy-driven (a detector fires, a human approves, one action executes) — it has no notion of a sustained, multi-step, evaluated-over-time pursuit. GoalRuntime is exactly that sustained pursuit. A Goal's device step *invokes* the same governed action boundary (`executeRegisteredAction`) Facility Automation's own `device.on/off/toggle` path already uses — it does not invoke Facility Automation itself, and Facility Automation was not routed through GoalRuntime in this slice.

## 25. Consumer Automation coexistence

Same principle, documented only, not touched: Consumer scenes/automations remain their own independent, trigger-driven system. This slice does not read, write, or reference `scenes.ts` or any consumer-automation table. No relationship beyond "both ultimately reach the same Wave-5-frozen device-command boundary, like every other device caller in this repository" exists or was created.

## 26. Decision regression

`smoke:wave7-slice5-canonical-decision` and `smoke:wave7-slice5-canonical-decision-sql` re-run unmodified — Decision's own status/CAS/idempotency machinery is untouched by this slice (no Decision→Goal linking was added beyond what Slice 5 already built, §12).

## 27. Human view regression

`smoke:wave7-slice4-human-intervention-view` re-run unmodified, all 25 checks still pass — this slice added no new source to `humanInterventionView.ts` (§21 explains why none was needed).

## 28. Identity regression

`smoke:wave7-slice2-identity-chain-repair(-sql)` re-run unmodified. `Goal.canonical_signal_key` semantics are untouched; this slice's own operational-goal fixture deliberately uses `canonical_signal_key: null` in its real-Postgres proof for the case where no real originating signal exists — honest, not fabricated, matching Slice 2's own "NULL is the honest answer" precedent.

## 29. Plan-system disposition

`Goal.plan` (`GoalPlanStep[]`) remains GoalRuntime's own execution/pursuit plan — narrow, staged, goal-owned. `operational_plans`/`AutomationPlan` (advisory) and `automation_approvals.plan_snapshot` (Facility-executable) remain fully separate, untouched, unconverged. This is an explicitly **remaining** Wave 7 concern per the Slice 0 roadmap's own §36 discussion (a future `decision_id` cross-reference on each Plan shape was proposed there, not built in any slice so far) — recorded here as still open, not resolved.

## 30. Task-system disposition

Not unified. Office `crm_tasks` and Facility `maintenance_requests` remain separate, domain-specific systems. A Goal's `create_task` step (pre-existing, unmodified) creates a real Office task via the existing bridge — it does not make "Goal step" and "Task" the same concept; a device-action step is never treated as a task.

## 31. Security

Audited every new device-goal entrance: **none is public**. `resolveGoalDeviceActor()` and the `device_action` branch are called only from `goalEvaluator.ts`'s own internal `evaluateGoal()`, itself only invoked by `goalScheduler.ts` (the poll tick) or the existing event-driven wake path — both server-internal, no HTTP route exists anywhere that lets an external client construct or trigger a `device_action` `GoalPlanStep`. No generic "create an operational Goal" route was added in this slice (matching §15's own "prefer a safe test fixture" instruction) — there is therefore no live path today through which a device action type could be "smuggled" into a goal by an arbitrary caller. If a future slice adds such a route, it must ensure device-shaped plan steps require the same governed-actor/authority proof this slice's `resolveGoalDeviceActor()` already enforces (a requirement for that future work, not built preemptively here).

## 32. Performance

Proven in the mocked smoke (14 checks, all single-goal evaluations, no loop) and the real-Postgres smoke (10 checks). `findActiveForDevice` is a single, index-eligible jsonb containment query (no N+1 — confirmed by inspection, it issues exactly one `select`). No provider polling was added merely to list/read Goals — physical execution only happens when a `device_action` step actually runs during a real `evaluateGoal()` call, exactly once per due evaluation.

## 33. Observability

No new metrics were added. Existing Goal-related logging (`goal_scheduler_tick`, `goal_evaluation_started/completed/skipped`, `goal_evaluation_failed`) already fires for every goal evaluation, device-targeted or not, with no new device-specific dimension — low-cardinality by construction (no device/home ids are logged by this slice's own new code beyond what `execution_history`'s bounded, goal-internal array already records, which was never a metric label).

## 34. Same-class search

Searched for other domain-specific goal/objective runtimes in this repository:

| System | Classification | Reasoning |
|---|---|---|
| `GoalRuntime` | `CANONICAL_GOAL` | Sole durable, evidence-driven, multi-attempt pursuit-over-time system; re-confirmed, not contradicted, by this slice |
| `facilityAutomationService.ts` | `AUTOMATION` | Event/rule/policy-driven, single-action, no sustained pursuit concept |
| Consumer scenes/automations | `AUTOMATION` | Same reasoning, independent trigger system |
| `intelligence-core/executionRegistry.ts` | `GAP` (not a goal system) | A bounded action executor, not an objective-pursuit runtime — correctly the thing GoalRuntime's device step *calls*, not a competing authority |
| `OyiWorkflow`/device-action conversational workflow (Slice 3-inventoried) | `WORKFLOW` | Single-turn confirmation state machine, not sustained multi-step pursuit |

No `PARALLEL_GOAL_AUTHORITY` was found — GoalRuntime remains the sole system answering "what outcome are we pursuing over time," now for two domains instead of one. Nothing was migrated.

## 35. End-to-end scenarios

All 11 (A–K) proven across the two new smokes:
- **A** — an existing Office `escalate` goal reaches `needs_human` exactly as before; `executeRegisteredAction` is never called.
- **B** — an operational goal with `estate_id`/`home_id`/`device_id` persists and deserializes correctly (real Postgres).
- **C** — the same device, retried, is found by the exact same real dedup query (real Postgres).
- **D** — a device step calls `executeRegisteredAction` with the exact real shape (`action_id`/`entity_id`/`command`/`confirmed`).
- **E** — `status:"denied"` (the shape a real capability-kill-switch denial produces) routes to `needs_human`, proven distinct from the generic `blocked`.
- **F** — proven by the structural assertion that the canonical chain (`authorizeDeviceCommand` before `executeDeviceCommandForActor`) is still intact and is the only path reachable from this slice's new code (Wave 5's own execution-ledger tests, re-run as regression, cover the ledger write itself).
- **G** — `executeStep()` uses `executeRegisteredAction`'s own real `ok`/`status`/`result` verbatim, no second interpretation layer.
- **H** — missing actor, missing `device_command`, and a denied/validation-required result all correctly fail closed to `needs_human`, proven as four separate cases.
- **I** — needs no new proof beyond §21/§27 (Slice 4's existing `goal_escalation` source already covers it; re-run unmodified).
- **J** — Decision→Goal lineage (`attachGoalToDecision`, Slice 5) re-run unmodified; truthful, not re-derived.
- **K** — this slice's code path touches only `oyi_goals`; no awareness/current-state table is read or written anywhere in `goalEvaluator.ts`/`goalDeviceActor.ts` (confirmed by the same structural source inspection used for §9).

## 36. PostgreSQL proof

`wave7-slice6-goalruntime-domain-generalization-sql-smoke.mjs`, 10 checks, real `oyi_goals` table (from the unmodified base + Slice 2 migrations): jsonb column types confirmed (no migration needed, §40); operational goal round-trip (target fields + `device_command` payload); no authority columns exist on `oyi_goals`; `findActiveForDevice` real containment dedup (found / not-found / terminal-exclusion cases); Office goal byte-level backward compatibility (absent fields read back as absent, not null); `findActiveForLead` unaffected by the new device query existing alongside it.

## 37. Wave 5 freeze

No frozen file was modified. `DeviceCommandAuthority.ts`, `executeDeviceCommandForActor` (`deviceCommandController.ts`), `executionLedger.ts`, `verificationService.ts`, `intelligence-core/executionRegistry.ts` — all confirmed unchanged via `git status --short`. This slice's new code only *calls* the existing public `executeRegisteredAction()` entry point — it does not modify its authority semantics, matching the task's own explicit "calling the existing API is allowed; changing its authority semantics is not." No STOP-and-report was triggered — no frozen file required semantic modification. Representative Wave 5 smokes (`wave5-slice1/2/3/4`, `wave5d`, `wave5e`) re-run as regression (§40 results).

## 38. Wave 6 freeze

No file under canonical awareness, device current-state, privacy/security, or Final A durability was touched. Representative smokes (`wave6-final-a`, `wave6-final-b`, `wave6-slice1`, `wave6-slice2`, `wave6-slice4`, `wave6-slice13`, `wave6-slice13b`, `wave6-slice6`, `wave6-slice14a`) re-run as regression.

## 39. Slice 1–5 regressions

All re-run: Slice 1 (`wave7-slice1-recommendation-authority`), Slice 2 (`wave7-slice2-identity-chain-repair(-sql)`), Slice 3 (`wave7-slice3-lifecycle-vocabulary`, 103/103, unmodified since Slice 5), Slice 4 (`wave7-slice4-human-intervention-view`, 25/25, unmodified), Slice 5 (`wave7-slice5-canonical-decision(-sql)`, 19/19 + 11/11, unmodified). Results in §43.

## 40. Files changed

- `src/contracts/goal.ts` (modified — additive `GoalTargetEntities`/`GoalPlanStepChannel`/`GoalPlanStep.action_type`/`GoalDeviceCommand`/`device_command`)
- `src/services/goalRuntime/goalDeviceActor.ts` (new)
- `src/services/goalRuntime/goalEvaluator.ts` (modified — additive `device_action` branch + `needsHuman`-aware status derivation)
- `src/services/goalRuntime/GoalRuntime.ts` (modified — additive `findActiveForDevice`)
- `scripts/wave7-slice6-goalruntime-domain-generalization-smoke.mjs` (new)
- `scripts/wave7-slice6-goalruntime-domain-generalization-sql-smoke.mjs` (new)
- `package.json` (two new script entries)

No other file touched — verified via `git status --short`.

## 41. Migrations

**None.** `target_entities` and `plan` are real `jsonb` columns (confirmed directly against `information_schema.columns`) — every new field is additive JSON, requiring no schema change, exactly as the task's own migration gate anticipated. No STOP-and-report was triggered.

## 42. Tests / results

- `npm run typecheck` — clean.
- `npm run build` — clean.
- `smoke:wave7-slice6-goalruntime-domain-generalization` — 14/14 passed.
- `smoke:wave7-slice6-goalruntime-domain-generalization-sql` — 10/10 passed (real PostgreSQL).
- Slice 1–5 regression, Wave 5/6 representative regression, `goal-runtime`, Office/conversation/privacy regression — results in §43.

## 43. Environment failures

Same pre-existing failures already documented identically across Slices 1–5's own reports: the `oyi-office-intelligence-convergence` two-assertion failure, and (where included in the battery) the `OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY`-dependent Wave 5 smokes' missing-env-var failure. Neither is caused by, or related to, any file this slice touched.

## 44. Newly discovered gaps

1. No event-driven wake exists for device/current-state changes — an operational Goal's device step is only re-evaluated on the 30s scheduler poll (§20).
2. `Goal.plan` vs. `operational_plans`/`automation_approvals.plan_snapshot` remain unconverged — an explicitly still-open Wave 7 concern per the Slice 0 roadmap's own §36 discussion (§29).
3. No live producer creates an operational device Goal today — this slice ships the generalized contract and a proven fixture only, per the task's own explicit preference (§15, §31).
4. `resolveGoalDeviceActor()`'s real `users`-table lookup means an operational Goal's device step can only ever act as a real, already-known platform user — there is still no honest way to represent a genuinely autonomous Core-initiated device action (no `systemActor()` exists anywhere in this codebase) — disclosed, not fabricated around (§11).

## 45. Commit SHA

Recorded in the final report delivered in this same turn.

## 46–47. Convergence status

GoalRuntime Domain Generalization is **CONVERGED** for the scope this slice actually built: the contract now honestly represents an operational objective, the one narrow bridge to Wave 5's frozen execution gate is proven safe (kill-switch-respecting, fail-closed, non-fabricating), and Office/commercial behavior is proven byte-identical. Slice 7 may begin only when explicitly requested. Its exact name/objective, per the Slice 0 audit's own §37 roadmap row 7: **"Lead/opportunity identity resolution (Office-scoped): either formally retire the dead `opportunity_id` fields or, if Office's CRM model genuinely needs a distinct opportunity identity, design that with Office rather than assuming Backend's lead-only shape is sufficient."**
