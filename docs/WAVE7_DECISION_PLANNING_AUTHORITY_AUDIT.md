# Wave 7 — Decision & Planning Convergence — Slice 0 Audit

**Type:** Read-only inventory and proposal. No source modified, no migration created, no implementation committed, no deployment performed.
**Backend HEAD (audited):** `834f672a3f6c5ff66155674621527b895d1b3fd8` ("Wave 6: record final convergence closure audit") — verified unchanged throughout this audit.
**Edge HEAD (published, not separately re-audited in Phase B):** `d2715f1cef7d9291c0ec1cda546551d91e1d2562`.
**Method:** six parallel read-only research passes over the Backend repository, each independently evidence-citing file:line references from direct reads and greps, cross-checked against each other where scopes overlapped. No finding below is invented; anywhere a fork could not verify something it says so explicitly, and that is preserved here rather than smoothed over.

---

## 14–15. Canonical decision path (signal → awareness → recommendation → insight → plan)

**Pipeline** (`src/oyi-core/service.ts:124-389`, `receiveSignal()`):
`normalizeSignal` → `universalSignalRuntime.receive()` (dedup/accept) → `buildAwarenessFromSignal` → `operationalReasoningRuntime.evaluate()` (insights) → `buildOperationalRecommendations()` (`service.ts:267`) → `buildAutomationPlans()` (`service.ts:276`) → `scopeMaterializationIdentities()` + `registerMaterialization()` (`service.ts:305-306`) → subscription fan-out (activity/notifications/conversation/executive/digital-twin, `service.ts:317-321`).

**Identity/dedup.** `canonicalSignalKey(s)` (`materialization.ts:9`) = `provider:providerEventId:domain:entityId:estateId:homeId`. `scopeMaterializationIdentities()` deterministically rewrites every downstream object ID to `${kind}:${sha256-derived-uuid(canonicalSignalKey:kind:originalId)}`, so replaying the same signal is idempotent across awareness/insight/recommendation/plan. Recommendation-level dedup happens one layer earlier and separately: `buildOperationalRecommendations()` collapses multiple insights into one recommendation per evaluation call via `domain:actionType:sortedRelatedSignals` — in-memory, per-call, not the same mechanism as the cross-call canonical key.

**Persistence — two paths, one deprecated.** Live path: `registerMaterialization()` → RPC `oyi_register_materialization` → `reconcileMaterialization()` → `oyi_claim_materialization`/`oyi_complete_materialization`/`oyi_fail_materialization` (crash-safe claim/lease, swept by `canonicalMaterializationWorker.ts`). `canonicalIntelligenceStore.recordBundle()`/`recordSignal()` are explicitly marked `@deprecated` in-source but still callable. `recordFeedback()` in the same file is **not** deprecated — it is the live write path for `intelligence_feedback` and flips `operational_recommendations.status` to `dismissed`.

**Real status literals (not the declared TS types — the actual persisted values, which diverge because two write sites apply different mappings):**
- `operational_recommendations.status`: `pending` (remapped from `open` at write time by `materialization.ts:35`), `monitoring`, `expired`, `resolved`, `dismissed`.
- `operational_plans.status`: `planned`, `awaiting_approval`, `prepared`, `expired`, `cancelled` — written through verbatim.
- `operational_insights.status`: hardcoded literal `"open"` at both write sites — nothing ever transitions an insight's status; there is no insight lifecycle beyond creation.

**Executable or advisory?** `AutomationPlan.executionMode` ∈ `suggest_only | prepare_workflow | request_approval | executable_action` (`safeAutomation.ts:19`). Three of four modes never execute. `executable_action` is reachable only for a narrow residual case, further excluded for financial/security/visitor domains (`safeAutomation.ts:91-93`). **The canonical plan object is overwhelmingly advisory/workflow-preparing by construction.** One gap in this audit's own coverage: whether any operation ID in `operationRegistry.ts` genuinely resolves to `executable_action` for an irreversible action was not fully verified — flagged, not asserted either way.

---

## 16. GoalRuntime — complete audit

**Contract** (`src/contracts/goal.ts`): `GoalRecord` — `id`, `correlation_id`, `requesting_actor_id`, `surface`, `conversation_thread_id`, `organization_scope`, `objective`, `target_entities` (`lead_id | contact_id | user_id | organization_id | name | email | phone | whatsapp_phone` — all nullable, **no `home_id`/`device_id`/`estate_id`**), `status: GoalStatus` (16 values: `understood|proposed|confirmed|active|observing|action_due|executing|verifying|waiting|reevaluating|paused|completed|blocked|failed|cancelled|expired|needs_human`), `success_condition`/`stop_condition`/`reply_branches`, `plan: GoalPlanStep[]` + `current_step_index`, `schedule`, `max_attempts`/`attempts_completed`, `observations`/`evidence`, `linked_crm_records|linked_tasks|linked_meetings|linked_automations|linked_communication_threads`, `execution_history`, `last_evaluated_at`/`next_evaluation_at`, `completion_reason`.

**Identity/creation.** `GoalRuntime.create()` inserts a fresh `randomUUID()`. Idempotency is caller-enforced, not runtime-enforced: `officeMaterialEventAdapter.ts:140` calls `findActiveForLead(leadId)` before `create()` to stop a replayed material event from spawning a second active goal.

**Plan/dispatch.** `GoalPlanStep` (`send_communication|call|escalate|wait_for_reply|create_task`) is a staged sequence with `wait_hours` measured from the prior step. `evaluateGoal()` (`goalEvaluator.ts:180-313`) is the sole decision loop — checks deadline/max-attempts, checks inbound-reply evidence against `success_condition`/`reply_branches`, advances one step via `executeStep()`, which dispatches through the **existing** `CommunicationRuntime` or `officeTaskBridgeService.createFollowUpTask()` — no second execution mechanism. `voice_call` is honestly documented as non-functional in this environment (no telephony provider configured) rather than fabricated as sent.

**Observations/evidence** are append-only and sourced exclusively from real inbound communication rows; reply classification reads a value the inbound pipeline already computed, with a lazy per-row fallback classifier, not a second parallel one.

**Linkages.** `linked_communication_threads`/`linked_tasks` grow only on real dispatch success. `linked_meetings`/`linked_automations` exist on the contract but no write site was found for either — reserved fields, not currently populated by this runtime.

**Completion/failure/human-handoff** are distinct, real, code-driven transitions (`completed`, `blocked`, `expired`, `cancelled`, `needs_human`) — not a single generic catch-all.

**Real callers, confirming this is live:** `officeMaterialEventAdapter.ts:165` (Office material events), `ConversationOrchestrator.ts` (conversational proposals + confirm/cancel/pause/resume/list/supersede), `inboundEventPipeline.ts:204` (event-driven wake on reply), `goalScheduler.ts` (30s CAS-claimed fallback poll — explicitly documented as fallback, not primary).

**Scope observation:** every real caller and every populated field in `target_entities` is shaped around lead/contact/organization-scoped commercial communication. No caller creates a goal for a Facility device-repair or Consumer scenario; the contract has no field to represent one cleanly today.

**Classification: STRONG_CANDIDATE, currently operating as DOMAIN_SPECIFIC.** Canonical in mechanism (single durable decision loop, real CAS concurrency, real dedup guard, four independent live triggers, zero duplicate execution path) but not yet canonical in scope (Office/commercial-only today). Does not reference or subsume `operational_plans`/`AutomationPlan` — the two systems share no identifiers.

---

## 17–18. Office commercial-goals path + lead/opportunity identity audit

**Path, real names, real literals:**
1. Office POSTs `CorporateMaterialEvent` (`development_enquiry_received`) → `POST /office/events/material` → `officeMaterialEventAdapter.ts:submitOfficeMaterialEventCanonicalSignal()`.
2. `assessJvOpportunity()` (`developmentJv.ts:112`) → `JvAssessment.recommended_next_step` ∈ `request_more_information | route_for_human_review | progress_opportunity | mark_outside_current_strategy`.
3. `relationshipCommunicationPolicyForJv()` maps that to ∈ `ACKNOWLEDGE_ONLY | CONTINUE_RELATIONSHIP | REQUEST_MORE_INFORMATION | HANDOFF`.
4. `HANDOFF` → `requestOfficeHandoff()` (idempotent via Office's own `findActiveHandoffForLead`) — **no goal created**, human takes over directly.
5. The other three → `goalRuntime.create()`, gated by opt-out check + `findActiveForLead` dedup; one bounded plan step (`send_communication`, WhatsApp), 14-day deadline, `max_attempts: 3`.
6. Inbound reply → goal wake → `goalEvaluator` (see §16).

**Lead/opportunity identity conflation — precisely located:**
- `GoalTargetEntities` has only `lead_id` — no `opportunity_id` field anywhere in the Goal contract.
- `opportunity_id`/`opportunityId` appears in exactly two other places in `src/**/*.ts`: (a) `officeTaskBridgeService.ts` — optional field, **never populated** at either live call site (both construct with `leadId` only); (b) `inboundCommunicationEvent.ts`/`officeExport.ts` — `related_opportunity_id`, hardcoded `null` at its only write site.
- `crmOpportunitiesReadModule()` (`OfficeCorporateCapabilityModules.ts:337-395`) is a **read-only** conversational capability reflecting real Office `opportunity.id` from an attached CRM snapshot — entirely disconnected from the GoalRuntime/lead path.
- Self-diagnosed in-repo: `corporatePublicConversationPolicy.ts` renamed `crm.create_opportunity` → `crm.qualify_opportunity` with an explicit comment that it "only ever advances the lead's own status/stage… it never creates an office_opportunities row" — the codebase already resolved one instance of this conflation by treating "opportunity" as a lead-stage label, not a separate identity.

**Net finding:** Backend's live commercial-goal path is lead_id-only. Real Office opportunity identity exists solely as a read-only reflection in a separate conversational capability, with zero cross-reference. No code path writes a real `opportunity_id` anywhere — the field is dead on every live write path checked. (Audit-only; not fixed, per directive.)

---

## 19. Automation decision systems (Facility / Consumer / Office) — TRIGGER / DECISION / PLAN / APPROVAL / EXECUTION

| Surface | TRIGGER | DECISION | PLAN | APPROVAL | EXECUTION |
|---|---|---|---|---|---|
| **Facility** | Event-driven (`detectDuplicateMaintenanceRequest`) + lazy on-read (`scanStaleVisitorAuthorizations`) | `resolveAutomationPolicy()` inside `proposeAutomationApproval()` | `plan_snapshot` JSONB frozen at proposal time | Human via `decideAutomationApproval()`, or auto for `auto_allowed` policy (re-resolved at decision time) | `executeApprovalRow()` → CAS claim → `executeRegisteredAction()` → `verificationService` → audit/notify |
| **Consumer** | Scheduler tick or manual run | Membership/permission checks + `isAutomationSurfaceEnabled()`; no separate approval-policy resolver | Actions attached to the automation record (`canonicalizeSceneActions()`) | Implicit — resident's own creation of the automation is the authorization; CAS claim is concurrency control, not a human gate | `executeRegisteredActionBatch()` → same `executionRegistry.ts` |
| **Office** | NL scheduling phrase in conversation (`parseAutomationScheduleIntent`) | **None** — this path makes no execution decision at all | Prefills the New Automation wizard's trigger/name only; action step always requires manual entry | N/A — `review_required` always true; explicitly documented as never self-creating an automation | **None** — presentation/prefill only |

**Execution-authority confirmation:** both Facility and Consumer paths terminate in the same `EXECUTION_REGISTRY`/`executeRegisteredAction()`. For `device.*` actions specifically, `executionRegistry.ts` imports and calls `authorizeDeviceCommand` (`DeviceCommandAuthority.ts`) before dispatching via `executeDeviceCommandForActor` — the single frozen Wave-5 physical-execution gate. No independent execution path was found for Facility or Consumer automation. Office's automation-suggestion code never imports `executeRegisteredAction`/`executionRegistry` at all — confirmed zero execution capability.

---

## 20–22. Recommendation, plan, and task system inventories

### Recommendation producers

| Producer | Persistence | Authority | Actionable? |
|---|---|---|---|
| `operationalRecommendations.ts` → `operational_recommendations` | durable table | **canonical** | via `operational_plans` |
| `recommendationPlanner.ts` (via `intelligenceOrchestrator.ts`, feeding both conversational capabilities and `proactiveIntelligenceScheduler.ts`) | **none — ephemeral**, recomputed fresh every run, source comment explicitly disclaims persistence | parallel/domain-specific | never (`capability_key` permanently null by design) |
| 6× domain `*Recommendation()` (scene automation, community, maintenance, security, service, visitor conversation-answer files) | none | presentation-copy-only | no |

**⚠️ Duplicate authority A:** two structurally independent "OperationalRecommendation" producers with different type shapes, different lifecycles, no shared identity. The same underlying situation can produce a durable, feedback-tracked row via the signal-ingestion path *and* a separate, ephemeral, never-persisted recommendation via the conversational/proactive path, with no cross-reference.

### Plan systems

| Plan type | Persistence | Class |
|---|---|---|
| `operational_plans` / `AutomationPlan` | table | mixed ADVISORY/EXECUTABLE (mode-dependent, see §14–15) |
| `automation_approvals` (Facility) | table | EXECUTABLE (genuinely — concrete `entity_id`, real execution registry behind it) |
| `GovernedActionProposal` (Office) | thread metadata JSONB, 10-min TTL | WORKFLOW (Backend proposes; execution happens client-side via Office's own PATCH route, since Backend has no DB access to Office's Supabase project) |
| `officeAutomationSuggestion` | none | PRESENTATION (prefill only, `review_required` always true) |
| GoalRuntime `plan: GoalPlanStep[]` | goal record | WORKFLOW (dispatches into existing systems, does not duplicate execution) |

**⚠️ Duplicate authority B (self-documented in source):** `facilityAutomationService.ts`'s header comment explicitly states why it does **not** reuse `AutomationPlan` — that type's action vocabulary "does not carry a concrete entity_id... the way EXECUTION_REGISTRY requires." This is a deliberate scope decision, not an accident, but it still leaves two independently-designed "plan" systems covering adjacent Facility ground with different schemas, approval flows, and execution paths, with no shared status vocabulary or cross-reference.

### Task systems

| Task concept | Owner | Nature |
|---|---|---|
| `crm_tasks` (Office) | Office (remote; Backend has no DB access, bridge-only via `officeTaskBridgeService.ts`) | human obligation |
| `maintenance_requests` | Facility/Consumer (Backend-owned) | human obligation / work order |
| `automation_approvals` | Facility (Backend-owned) | human obligation (approve/reject) + machine trigger |
| GoalRuntime `linked_tasks` | Backend | projection/mirror of a goal, not a task owner itself |
| BullMQ proactive-intelligence jobs | Backend | machine obligation, no task row produced |

**⚠️ Duplicate authority C:** at least three genuinely independent task-like tables coexist with no unifying abstraction and no cross-reference between them — confirmed by the absence of any FK between `maintenance_requests` and `automation_approvals` (same Supabase project, no FK found in either migration) or, necessarily, between either and Office's `crm_tasks` (separate Supabase project).

---

## 23–26. Scheduler inventory, policy/authority audit, conversation decision-logic, proactive intelligence

### Scheduler inventory

| Scheduler | Mechanism | Cadence | Classification |
|---|---|---|---|
| `automationWorker.ts` | BullMQ, event-driven | on-demand | EXECUTION |
| `intentWorker.ts` | BullMQ, `attempts:3` backoff | on-demand | EXECUTION + RETRY |
| `intentDlqWorker.ts` | BullMQ, fed by intentWorker's `failed` handler | on-demand | HOUSEKEEPING |
| `proactiveIntelligenceScheduler.ts` | BullMQ repeatable, 2 flags | 15 min tick / 24h learning pass, **both off by default** | TIME + DECISION (bounded) |
| `goalScheduler.ts` | `setInterval`, not BullMQ | 30s poll (explicit fallback; primary wake is event-driven) | TIME + DECISION |
| `canonicalMaterializationWorker.ts` | `setInterval`, gated off by default | 30s poll, batch 25 | RETRY/HOUSEKEEPING (crash recovery for Wave 6 Final A durability chain) |
| `cameraHealthTransitionWorker.ts` | `setInterval`, on by default | 30s poll, batch 100 | DECISION (narrow) + EXECUTION (delivery) — domain-scoped |
| `cameraMediaRetentionWorker.ts` | `setInterval`, on by default | hourly | HOUSEKEEPING |

No scheduler duplicates another's cadence or decision space. `automationWorker`/`intentWorker` are pure transport+execution by their own in-source comment. The only two schedulers making genuine "what happens next" decisions on their own clock — `proactiveIntelligenceScheduler` and `goalScheduler` — are cleanly separated by object type (ephemeral Recommendation vs. durable claimed Goal) and cadence, with zero mutual reference confirmed by direct read.

### Policy/authority audit

- **PERMISSION authority:** `capabilityService.canUse()` + `capabilityRegistry`, role-derived, never trusts a client-supplied role (every worker re-hydrates the actor from `users` by id).
- **RISK/PLANNING authority for physical device execution — the frozen Wave-5 gate:** `DeviceCommandAuthority.ts`'s `authorizeDeviceCommand()` is the sole entrance, confirmed via all 9 real callers (`devicePermission.policy.ts`, `executionRegistry.ts`, `commandRouter.ts`, `intentWorker.ts`, `automationWorker.ts`, `deviceCommandController.ts`, `scenes.ts`, `watchAdapterService.ts`, `residentActionBatchExecutionService.ts`), every one calling the same function rather than reimplementing a check, all terminating in `executeDeviceCommandForActor()`. `SpatialDeviceActionService.ts` (Digital Twin spatial-click path) calls `capabilityService.canUse()` directly with the identical capability key (`devices.power.control`) — a second call-site for the same gate, not an independent one; checked twice (proposal + confirm).
- **OPERATIONAL authority (non-device):** `executionRegistry.ts`'s `operationalRole()` + `inActorScope()` gate the 15 non-device registered actions.
- **COMMERCIAL authority:** not found as a distinct system in this audit's scope; no crossover into device/physical execution was found from Office's JV/commercial logic.
- **No duplicate physical-execution gate found** across signal-ingestion → `intentWorker`, scheduled automation → `automationWorker`, Facility approval → `executionRegistry`, or direct HTTP → `deviceCommandController` — all converge on the same pair. `executeDeviceCommandForActor` itself performs **no internal capability check** — enforcement is by caller convention across ~9 call sites, not a structurally unbypassable chokepoint. This is a latent risk for any future caller, not evidence of a current breach.

### Conversation decision-logic audit

Four "what happens next" surfaces in `ConversationOrchestrator.ts`, **all delegating into existing canonical objects — none maintain independent decision state**:
1. Answer generation — read-only fact retrieval, no decision production.
2. `GovernedActionProposal` handoff — proposes a mutation to an existing CRM entity; conversation stages/confirms it, does not own it.
3. Goal creation (`office_internal` surface only) — drafted directly via `goalRuntime.create()` (status `proposed`, full audit trail even for unconfirmed drafts), a TTL-bound `pending_goal` pointer in thread metadata; confirm/cancel/supersede only ever touches that one `GoalRecord`. Grep for `"recommendation"` inside `ConversationOrchestrator.ts` returns **zero hits** — conversation does not spawn a parallel recommendation object. Activation does not dispatch inline; the 30s `goalScheduler` tick picks it up through the identical CAS-claim path a scheduled automation run uses.
4. Human handoff — not owned by conversation; dispatched via goal plan steps (`escalate` action type).

**Conclusion: conversation has no parallel "what should happen next" engine.** Every durable conversational decision terminates in `GovernedActionProposal` or `GoalRuntime`.

### Proactive-intelligence-scheduler audit

Off by default (`OYI_PROACTIVE_SCHEDULER_ENABLED`). Paginates homes in a bounded batch, calls the same `intelligenceOrchestrator` that produces the ephemeral recommendation type (duplicate-authority A), plus `evaluateOpenPredictions()`. Can create anomalies/predictions/forecasts/recommendations (none persisted) and notification deliveries (capped 50/run globally, 5/home). File header explicitly enforces by omission: never imports `ActionService`/`WorkflowService`/`execute`, never calls `promoteLearningParameter`. **Does not duplicate GoalRuntime's wake/evaluation logic** — never reads or writes `oyi_goals`, never calls `goalRuntime.*`; cleanly separated by object type and persistence model.

---

## 27–28. Domain-specific decision producers (Executive / Facility / Consumer) + Digital Twin Backend-integration role

### Domain producers

- **Executive** (`executive.ts`, `buildExecutiveBriefing()`): pure aggregation/templating over the canonical bundle — no new object minted, no persistence. **Call: correctly domain-specific**, pure presentation, produces nothing actionable.
- **Facility** (`facilityAutomationService.ts`): already covered under duplicate-authority B — deliberately domain-specific by design, a genuine EXECUTABLE authority for two narrow detectors.
- **`domains/*` evidence loaders:** confirmed to be fact/evidence assembly only, feeding `IntelligenceFact[]` into the Universal Signal Runtime — no decision logic to deduplicate.
- **`domains/intelligence/*`:** feeds the parallel ephemeral recommendation pipeline (the domain-specific side of duplicate-authority A, not a third planner).
- No distinct "Consumer" decision producer exists beyond the shared `intelligenceOrchestrator.ts` path; no dedicated `domains/executive/*` folder exists.

### Digital Twin / spatial Backend-integration role

No `TwinProjectDefinition`/`BuildingSource`/spatial-ingestion contracts exist in this repository — those live in a separate Twin Engine repo, confirmed absent from `src/`. Backend's only Twin surface is `src/routes/spacesTwin.ts` → `src/services/twinProviderService.ts`: three read-only, auth-gated GET endpoints, all returning **static placeholders** (`configured: false`, `model_url: null`). **Classification: PRESENTATION** (a stub, not yet load-bearing). None of Backend's canonical decision paths (`service.ts`, `intelligenceOrchestrator.ts`, `GoalRuntime.ts`) reference twin/spatial data as an input. This is an honest, disclosed gap — Digital Twin is currently disconnected from Backend's decision layer entirely, not a hidden duplication.

---

## 29–30. Decision-identity/dedup mapping + decision-lifecycle vocabulary mapping

### Decision-identity/dedup mapping

Four structurally independent identity spaces confirmed, with **no shared key propagated end-to-end**:
1. `canonical_signal_key` (`materialization.ts`) — used only for `operational_signals` row dedup at ingestion.
2. `operational_recommendations.recommendation_key` = `recommendation:${domain}:${insight.id}`, where `insight.id` = `insight:${domain}:${entityKey}:${index}` — entity+domain+**array-index** based, not derived from `canonical_signal_key`. Positional-index dependency is a real, unverified risk: if insight ordering shifts between runs, this could silently mint a duplicate row instead of updating the existing one.
3. `dedup_key` in the parallel `recommendationPlanner.ts` — a **third**, independently-formatted key (`anomaly:${domain}:${type}:${canonicalId}`), used only for in-memory dedup within a single ephemeral run, never persisted, never cross-referenced against `recommendation_key`.
4. `oyi_goals.id` = `randomUUID()`. `GoalRecord` carries **no** back-reference field to the material/signal that caused the goal — goal creation is identity-blind to everything upstream.

**Conclusion:** the same underlying real-world issue can produce a signal row, an independent recommendation row, a separate never-persisted ephemeral recommendation, and an unrelated goal row, with zero shared identity connecting any two of the four. This is a stronger finding than duplicate-authority A alone suggested — there is no working dedup chain across signal → recommendation → goal at all today.

### Decision-lifecycle vocabulary mapping (real literals only)

| Object | Real status literals |
|---|---|
| `operational_recommendations` | `open`(pre-write)/`pending`(persisted), `monitoring`, `resolved`, `dismissed`, `expired` |
| `AutomationPlan`/`operational_plans` | `planned`, `awaiting_approval`, `prepared`, `expired`, `cancelled` |
| `GoalStatus`/`oyi_goals` | 16 values incl. `understood`, `proposed`, `confirmed`, `active`, `completed`, `blocked`, `failed`, `needs_human` |
| `automation_approvals` (Facility) | `pending_approval`, `approved`, `rejected`, `expired`, `cancelled`, `executing`, `succeeded`, `failed`, `verification_failed` |

**Confirmed cross-object inconsistencies:**
- "Awaiting a human decision" has three spellings: `pending` / `awaiting_approval` / `pending_approval` — same semantic stage, no shared literal.
- "Successfully finished" has three spellings: `resolved` / `completed` / `succeeded` — `AutomationPlan` has **no terminal-success literal at all** (execution success is tracked separately, in a fifth vocabulary, `ExecutionLedgerRecord.status`, not covered by the plan's own enum).
- "Currently live/unresolved" diverges: `open` vs `active` — different words, same starting-state concept.
- `cancelled`, `expired`, `executing`, `failed` are genuinely consistent across 2+ systems — not flagged as problems.
- `AutomationPlanStatus` has no direct "rejected"/"denied" terminal state, unlike `automation_approvals`' `rejected` — a plan a human declines has no lifecycle word of its own; the rejection is only representable one layer down.

No single canonical lifecycle vocabulary exists across Recommendation/Plan/Goal/Approval today — each object type independently invented its own enum, confirmed by direct grep, not inferred.

---

## 31–34. Plan→action execution-boundary trace, human-in-the-loop consistency, persistence/table-ownership inventory, duplicate-authority matrix

### Plan→action execution-boundary trace

Every physical device action converges on `authorizeDeviceCommand()` (`DeviceCommandAuthority.ts`) before `executeDeviceCommandForActor`. Nine confirmed independent call sites: `executionRegistry.ts` (the sole entry for recommendation/plan/goal-step/automation-decision-driven device actions), `commandRouter.ts` (×3, including scene preflight gating every action before any execution — "if any denied, execute none"), `intentWorker.ts`, `automationWorker.ts`, `watchAdapterService.ts`, `residentActionBatchExecutionService.ts`, `deviceCommandController.ts` (the HTTP route itself), and `SpatialDeviceActionService.ts` (Twin spatial-click path — calls the identical capability key directly rather than through the wrapper, so a second call-site for the same gate, not an independent one, checked at both proposal and confirm time).

`executeDeviceCommandForActor` itself performs **no internal capability check** — enforcement is by caller discipline across ~9 sites, not a single structural chokepoint inside the executor. No call site was found that skips the check. **Verdict: one frozen gate, consistently reached, zero bypasses found — but caller-discipline enforcement, which is a latent risk for any future caller, not evidence of a current breach.**

Non-device actions (visitor/maintenance/community/security/notification) route through the same `executeRegisteredAction()` (`executionRegistry.ts`), which enforces role/scope plus the Wave 6 Slice 11 CAS transition primitives inline.

**Communication-sending is not single-gated** the way device commands are. Four independent senders: `CommunicationRuntime` (canonical multi-channel, used by conversation/goal/task paths — no capability-gate call comparable to `devices.power.control`, relies on caller-level authorization), `NotificationService` (push/in-app, also reachable via `executionRegistry.ts`'s `notification.notify` action), `emailService.ts` (account-provisioning email, outside any Oyi decision path — legitimate separate concern), `residentInviteEmailService.ts` (wraps the above, resident-invite email, also outside any decision path). The first two are genuinely independent, non-overlapping authorization surfaces — **no single "may this system send X to a human" gate exists**, unlike the device path.

### Human-in-the-loop consistency

Three structurally different representations of "waiting on a human," no shared schema or vocabulary:
- Facility: `automation_approvals` row, `status='pending_approval'`, real table, TTL.
- Office: `GovernedActionProposal`, JSONB in `oyi_conversation_threads.metadata`, `status='pending'`, 10-min TTL — not a table row at all.
- GoalRuntime: `oyi_goals.status='needs_human'` — a single enum value on the goal itself; the goal *becomes* the human-wait state rather than spawning a separate one.

**Genuinely inconsistent representations, not just naming differences.**

### Persistence / table-ownership inventory

| Table | Sole writer |
|---|---|
| `operational_recommendations` | RPC `oyi_register_materialization` (live) + `canonicalIntelligenceStore.ts` (deprecated fallback) — read-only elsewhere |
| `operational_plans` | same as above |
| `automation_approvals` | `facilityAutomationService.ts` — sole writer, confirmed |
| `oyi_goals` | `GoalRuntime.ts` — sole writer, confirmed |
| `facility_automation_policy` | `facilityAutomationService.ts` |

No multi-writer table found among these five. `operational_recommendations`/`operational_plans` have two *paths* (one live RPC, one deprecated) but not two live writers.

### Formal duplicate-authority matrix (11 concepts)

| Concept | Classification | Evidence |
|---|---|---|
| Recommendation | **PARALLEL** | `operational_recommendations` (canonical, persisted) vs. `recommendationPlanner.ts`'s ephemeral, never-persisted type — two independently-typed producers, no shared identity. |
| Decision | **MISSING** | No table or object literally named "Decision" exists; decision authority is distributed across capability checks, CAS transitions, and goal-step logic — never reified as its own persisted entity. |
| Goal | **CANONICAL** | `oyi_goals` + `GoalRuntime.ts`, sole writer, explicit lifecycle enum, no competing goal concept found. |
| Plan | **PARALLEL** | `operational_plans`/`AutomationPlan` (advisory-leaning) vs. `automation_approvals.plan_snapshot` (genuinely executable, explicitly designed as a separate concept per its own migration comment). |
| Task | **DOMAIN_SPECIFIC** | `maintenance_requests` (Facility) and `crm_tasks` (Office, bridge-only) are legitimately separate systems tied to different domains/Supabase projects — no unifying table, but each is canonical within its own boundary. |
| Approval | **STRONG_CANDIDATE** | `automation_approvals` is real and well-formed but Facility-only; Office's `GovernedActionProposal` and GoalRuntime's `needs_human` cover the same concept with zero shared shape. |
| Workflow | **CANONICAL** (device domain only) | `OyiWorkflow`/`ActionStateMachine.ts`/`ActionService.ts` own the device-action `awaiting_confirmation→approved→queued→sent→verifying→confirmed` lifecycle — single implementation, used by both conversational and spatial paths. |
| Scheduler | **PARALLEL** | `proactiveIntelligenceScheduler.ts` and `automationWorker.ts` are independent BullMQ job definitions with no shared scheduling abstraction. |
| Next-Action | **MISSING** | No object answers "what should happen next" generically — `GoalRuntime.plan[current_step_index]` answers it for goals only. |
| Handoff | **PARALLEL** | See human-in-the-loop finding above — three non-unified shapes. |
| Human-Override | **DOMAIN_SPECIFIC** | `automation_approvals.approver_id/decision_note` (Facility) and `GovernedActionProposal`'s confirm/reject flow (Office) each implement an override; neither is reused by the other domain. |

---

## 35. Seven end-to-end scenario traces

**A — Facility camera degraded → awareness → recommendation.**
`cameraCurrentStateAuthority`/`cameraHealthTransitionWorker` classify a camera-health signal (distinct from edge-unavailable, per Wave 6 Final C) → normalized as a canonical signal → `operationalReasoningRuntime` produces an insight → `buildOperationalRecommendations()` produces a camera-domain recommendation → `buildAutomationPlans()` almost certainly resolves to `suggest_only` (camera domain is not one of the three narrow operation IDs reachable from `operationPlanType()`) → surfaces to Facility as advisory only. No goal is created — camera degradation has no path into GoalRuntime (lead-scoped only). This is the canonical path working exactly as designed: a real problem produces a durable, advisory recommendation with zero risk of runaway automation.

**B — Device repeatedly unavailable → awareness → recommendation/plan/action.**
Repeated device-unavailable signals → device evidence facts → an insight crosses a repetition/severity threshold → a recommendation is built → `AutomationPlan.executionMode` is decided by `safeAutomation.ts`'s rules; if the action type is one of the two hardcoded `prepare_workflow` cases, it stops at workflow-preparation (human must act via a separate surface); if it reaches the narrow `executable_action` residual case, it is still gated by `safeToExecute()` and — because it's a device action — must additionally clear `authorizeDeviceCommand()`/`DeviceCommandAuthority` before `executeDeviceCommandForActor` runs. **No goal is created for this scenario** — GoalRuntime's `target_entities` has no `device_id` field, so a genuinely durable, multi-attempt "keep trying to recover this device" objective (the kind GoalRuntime is built for) cannot currently be represented for a device. This is the clearest illustration of GoalRuntime's DOMAIN_SPECIFIC scope limit from §16.

**C — Maintenance issue → awareness → task/workflow.**
A maintenance request is created (`maintenance_requests`, Wave 6 Final B schema) → `maintenanceEvidence.ts` feeds the canonical signal runtime → a maintenance-domain recommendation/plan is built (forced to `prepare_workflow` per `safeAutomation.ts`'s hardcoded rule for this action type) — this is the **advisory** layer, purely informational. Separately and independently, `facilityAutomationService.ts`'s `detectDuplicateMaintenanceRequest()` can propose an `automation_approvals` row for a **duplicate** request — a human approves/rejects, and on approval `executeApprovalRow()` runs the real state transition via `transitionMaintenanceStatus` (Wave 6 Slice 11 CAS). **Two separate systems touch the same maintenance request with no cross-reference between them** — a live, concrete instance of duplicate-authority finding B.

**D — Visitor/security issue → awareness → decision.**
Real-time visitor entry/exit (`markEntry`/`markExit`) bypasses the recommendation/plan/goal layer entirely — it goes straight through `transitionVisitorAccessStatus` (Wave 6 Final B CAS primitive), by design, because it must be instantaneous and cannot wait on an advisory pipeline. Upstream, `scanStaleVisitorAuthorizations()` (Facility) can separately flag a stale authorization → `automation_approvals` row → human decides → `executeRegisteredAction()` (one of the 15 non-device registered actions) → the same `transitionVisitorAccessStatus` primitive underneath. So the visitor domain has two genuinely distinct decision surfaces — real-time CAS (direct, no recommendation/goal involvement) and detector-driven stale-authorization automation (full TRIGGER→DECISION→PLAN→APPROVAL→EXECUTION) — which is correct given their different latency requirements, not a flaw, but worth stating plainly since it's easy to conflate the two.

**E — Office JV enquiry → commercial assessment → goal → communication → reply → next decision.**
Fully traced in §17–18 and §16 together — this is the most complete canonical-object lifecycle found anywhere in this audit: material event → `assessJvOpportunity` → communication policy → (three of four outcomes) → `goalRuntime.create()` with dedup → `GoalPlanStep` dispatch via `CommunicationRuntime` → inbound reply → `inboundEventPipeline` wakes the goal → `goalEvaluator` classifies the reply against `success_condition`/`reply_branches` → advances, completes, or escalates to `needs_human`. This is the reference example for what a canonical Wave 7 "what should happen next" object should look like end-to-end — durable, evidence-driven, single execution path, real dedup.

**F — User asks "what should I do about X?" → recommendation.**
If X is within canonical awareness coverage, `getConvergedAwarenessDigest` (Wave 6) answers from real `operational_recommendations` data, disclosing `canonical_status`/`legacy_fallback_used` honestly. If the conversational capability instead routes through `intelligenceOrchestrator.ts` (e.g., a proactive/prediction-shaped question), the answer comes from the **ephemeral, never-persisted** `recommendationPlanner.ts` path — duplicate-authority A, live in a single user-facing turn. The same question asked twice, at different times or by different phrasing, can surface two structurally different "recommendations" for the same underlying situation with no reconciliation between them. This is not a fabrication risk (both paths use real evidence) but it is a genuine consistency gap a user could notice.

**G — User asks Oyi to perform an action → decision/proposal/approval/execution.**
Two structurally different confirm→execute mechanics depending on domain. Office/CRM: conversational request → `GovernedActionProposal` (`officeActionProposal.ts`) staged in thread metadata → user confirms → execution happens **client-side** via Office's own existing PATCH route (Backend never executes Office CRM mutations itself, since it has no DB access to Office's Supabase project). Device domain: conversational request → `commandRouter.ts` → `authorizeDeviceCommand` → `ActionStateMachine`/`workflowService` (`awaiting_confirmation→approved→queued→sent→verifying→confirmed`) → `executeDeviceCommandForActor`. Both are legitimate, correctly-gated designs for their respective domains, but they are genuinely different shapes for "the user asked for an action, get their confirmation, then do it" — a future canonical Automation/Action-proposal object (§36–37) would need to accommodate both a "Backend executes" and a "Backend proposes, someone else executes" mode without forcing one onto the other.

---

## 36. Proposed minimum canonical target architecture (proposal only — not implemented)

This section describes what a coherent Wave 7 decision/planning layer could look like, built strictly from objects that already exist and already work, rather than proposing a rewrite. Nothing here is committed or scheduled without further authorization.

**Signal / Awareness / Insight** — keep exactly as-is. These are the one part of this whole surface with a single, canonical, idempotent implementation (§14–15) and zero duplicate-authority findings anywhere in this audit. Not touched by any proposal below.

**Recommendation** — should become genuinely single-authority. Today it is PARALLEL (duplicate-authority A). Proposal: the conversational/proactive orchestrator (`intelligenceOrchestrator.ts`) should read from the canonical `operational_recommendations` table wherever coverage exists, falling back to its own ephemeral computation only when it doesn't — the exact same disclosed-fallback pattern Wave 6 Final C already validated for `getConvergedAwarenessDigest`. This does not require deleting `recommendationPlanner.ts` (its prediction/anomaly-surfacing role is legitimate), only changing what it's allowed to call itself when a canonical answer already exists.

**Decision** — currently MISSING as a reified object; this is the actual gap Wave 7 exists to close. Proposal: introduce a narrow, additive `Decision` shape modeled directly on `automation_approvals`' existing schema (it is already domain-agnostic: `entity_type`/`entity_id`/`plan_snapshot`/`approver_id`/`status`), but not by ripping out the working Facility table — by generalizing its *shape* as the template any future Office/Consumer approval-needed moment uses, coexisting additively. A `Decision` is "a specific proposed change to a specific entity, awaiting a human's approve/reject, with a snapshot of exactly what will happen if approved." It does not replace `GoalRuntime`'s `needs_human` status (that remains the goal's own state) or `GovernedActionProposal` (Office's execution model is structurally different — client-side execution — and should keep its own shape) — but a shared `Decision` *view* could unify how all three are queried and displayed, without forcing their underlying storage to converge on day one.

**Goal** — GoalRuntime is the strongest existing candidate for "the object that owns a sustained multi-step objective," but its `target_entities` is commercial/lead-shaped only. Proposal: extend it (additively) to optionally carry `home_id`/`device_id`/`estate_id`, so Facility/Consumer domains that need a durable, evidence-driven, multi-attempt objective (Scenario B above is the concrete motivating case) can use the same evaluator/scheduler/dedup machinery Office already has, rather than inventing a second one. This does **not** touch the Wave-5-frozen physical-execution gate — a new `GoalPlanStep` action type for device actions would still have to route through `executionRegistry`/`DeviceCommandAuthority` exactly like every other device action does today.

**Plan** — no single "Plan" object should be forced. `operational_plans` (advisory), `automation_approvals.plan_snapshot` (Facility-executable), and `GoalPlanStep[]` (Goal-owned, multi-step) serve genuinely different needs (advisory vs. narrow-executable vs. staged-multi-step) and should stay distinct, but each should carry a `decision_id` reference once the `Decision` object above exists, so a UI or an auditor can trace "this plan, this decision, this outcome" without three separate lookups.

**Task** — do not unify. `maintenance_requests` and Office's `crm_tasks` are correctly domain-specific given the cross-Supabase-project boundary; forcing a shared table would be a larger, riskier change than the actual problem (fragmentation, not confusion) warrants. The one real gap is that a `maintenance_requests` row and a `crm_tasks` row about the *same* underlying incident currently can't be linked at all, even loosely — a nullable `canonical_signal_key`-style reference column on both would close that without a structural merge.

**Automation** — the Facility TRIGGER/DECISION/PLAN/APPROVAL/EXECUTION shape (§19) is the right template; it should not be reinvented per-domain. If Consumer or Office ever need a genuinely executable automation decision (not just a prefill suggestion), it should reuse this shape, including routing through the same frozen execution gate for any device action.

**Who owns "what should happen next"?** No single object should own this outright — that would recreate the current MISSING/PARALLEL problem in a new shape. The honest answer, given the evidence: **Recommendation answers "what is worth noticing"; Decision answers "should this specific proposed change happen"; Goal answers "what sustained objective are we pursuing and what's the next step toward it."** These three, each single-authority within its own question, together cover the space that today is fragmented across five-plus parallel systems. None of them should ever bypass the Wave-5-frozen execution gate for a physical action, and Office's client-side-execution model (§35 Scenario G) should remain a recognized fourth pattern ("Backend proposes, a downstream system executes") rather than being forced into "Backend executes."

---

## 37. Proposed ordered Wave 7 implementation slices (proposal only — not implemented, not scheduled)

| # | Slice | Weight | Dependencies | Risk | Migration likelihood | Frozen systems affected |
|---|---|---|---|---|---|---|
| 1 | Recommendation-read unification: conversational/proactive orchestrator prefers canonical `operational_recommendations` over ephemeral recomputation where coverage exists, disclosed exactly like Wave 6's `getConvergedAwarenessDigest` fallback pattern | SMALL | none | Low — additive read-path change, existing disclosed-fallback precedent | None (read-path only) | None |
| 2 | Identity-chain repair: add a nullable `canonical_signal_key`-style back-reference column to `oyi_goals`, and replace `operational_recommendations.recommendation_key`'s positional-index component with a stable derivation | SMALL–MEDIUM | none | Low — additive, backward-compatible | Small additive migration on `oyi_goals` | None |
| 3 | Lifecycle-vocabulary normalization layer: a shared mapping function (not a rename) that translates each object's real status literals into a common reporting-stage taxonomy, for any future cross-object UI/reporting only | MEDIUM | none | Low — pure read-side utility, no write-path change | None | None |
| 4 | Human-in-the-loop unification view: a queryable projection normalizing `automation_approvals`, `GovernedActionProposal`, and `oyi_goals.status='needs_human'` into one shape for UI/notification purposes, without changing underlying storage | MEDIUM | Slice 3 (shares vocabulary work) | Low-Medium — read/projection only if implemented as a view; small migration if implemented as a materialized table | None (view) or Small (materialized) | None |
| 5 | `Decision` object introduction: additive table modeled on `automation_approvals`' existing shape, generalized to `entity_type`/`entity_id` for any domain, coexisting with (not replacing) the Facility table initially | MEDIUM–LARGE | Slice 4 | Medium — new canonical surface, needs careful scoping to avoid becoming a sixth parallel system instead of a consolidation | Medium — new table + additive FK-style references from `automation_approvals`/plans | None directly; must not create a new execution path — approval outcome still dispatches through existing `executionRegistry` |
| 6 | GoalRuntime domain generalization: extend `target_entities` to optionally carry `home_id`/`device_id`/`estate_id`; add device-appropriate `GoalPlanStep` action types that route through the existing execution gate unchanged | LARGE | Slice 2 (identity chain), ideally Slice 5 | Medium-High — touches the highest-value live system (GoalRuntime) and its four real callers; must not weaken `findActiveForLead`-style dedup discipline when generalized to other entity types | Additive migration on `oyi_goals`/contract | Must not alter `DeviceCommandAuthority`/`executionRegistry` — new step types call the existing gate, they do not bypass or duplicate it |
| 7 | Lead/opportunity identity resolution (Office-scoped): either formally retire the dead `opportunity_id` fields or, if Office's CRM model genuinely needs a distinct opportunity identity, design that with Office rather than assuming Backend's lead-only shape is sufficient | SMALL | none | Low — narrow, Office-scoped, no Backend execution-path involvement | None or Office-side only | None |

Slices 1–4 are genuinely independent and could proceed in any order or in parallel. Slice 5 is the pivot point — it is the first slice that adds a new canonical surface rather than repairing an existing one, so it deserves the most scrutiny before being scheduled. Slices 6 and 7 are each large enough to warrant their own dedicated audit-and-plan pass before implementation, mirroring how this Slice 0 audit preceded any Wave 7 code.

---

## 38. Office-implication discussion (discussion only — Office convergence work not begun)

This section states what Office should eventually be able to consume from a converged Backend decision/planning layer. No Office code or design work begins here.

**OMA/OSA and Office CRM:** Office's read-only `crmOpportunitiesReadModule` reflection pattern (§17–18) is unaffected by any proposed slice — it's a pure projection of Office's own data and stays that way regardless of what Backend does internally. If the lead/opportunity identity question (Slice 7) is ever resolved, Office would be the side that defines what "opportunity" means; Backend should not invent that identity unilaterally.

**Commercial opportunities and follow-ups:** GoalRuntime is already the canonical mechanism for Office's commercial follow-up communications (§16, §35 Scenario E) and needs no architectural change from Office's side — it already works end-to-end with real dedup, real reply-handling, and a real handoff path. If GoalRuntime is generalized (Slice 6) to serve Facility/Consumer domains too, Office's existing usage pattern — `findActiveForLead` dedup before `create()`, bounded plan steps, TTL'd conversational drafts — becomes the reference implementation other domains copy, not something Office needs to adapt to.

**Communications and Twilio voice:** `CommunicationRuntime` already carries a real, if currently non-functional-in-this-environment, `voice_call` channel via `TwilioVoiceAdapter`. Any future Office voice-follow-up work should dispatch through `CommunicationRuntime` exactly as SMS/WhatsApp/email do today, rather than building a parallel voice sender — this avoids adding a sixth independent communication-authorization surface to the four already found in §31–34.

**Human handoff:** Office's `HANDOFF` policy outcome (§17–18) and GoalRuntime's `needs_human` status are, today, two of the three inconsistent human-in-the-loop shapes found in §31–34. If Slice 4 (human-in-the-loop unification view) proceeds, Office's handoff moment should be one of the first real consumers of that unified projection — it is already the cleanest of the three shapes (a dedicated bridge function with its own idempotency check), so it is a good reference case rather than a hard case.

**What Office should NOT expect from Wave 7 Slice 0 itself:** no new routes, no new Office-facing contracts, no change to `officeMaterialEventAdapter.ts`, `developmentJv.ts`, or `officeTaskBridgeService.ts` behavior. This audit found Office's existing integration to be well-isolated (correctly bridge-only, correctly read-only where it reads, correctly idempotent where it writes) — the duplicate-authority findings in this document are almost entirely on Backend's own internal side (Recommendation/Plan/Task/Approval/Handoff parallelism), not in the Office boundary itself.

---

## 39. Stop-condition confirmation

Per this task's explicit directive: no source was modified, no migration was created, no implementation was committed, no deployment was performed, and Wave 7 implementation has not begun. This document is the complete Slice 0 deliverable. It remains uncommitted, per instruction.
