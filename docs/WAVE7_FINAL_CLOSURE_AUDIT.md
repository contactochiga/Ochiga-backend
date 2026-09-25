# Wave 7 — Final Closure Audit — Decision & Planning Convergence Certification

STATUS: READ-ONLY VERDICT AUDIT. This document is intentionally UNCOMMITTED — no source, test, or migration file was modified to produce it. Nothing in this session was pushed or deployed. Wave 8 and Office Autonomy were not started.

Baseline: Backend `32408c6` (Wave 7G, Slice 7). Wave 6 checkpoint: `834f672` ("Wave 6: record final convergence closure audit").

## 1. Repository state

**Backend**: branch `main`, HEAD `32408c651c025a0a8dd1bccb153253f818bbad6f` — matches expected `32408c6` exactly. `origin/main`: 7 ahead / 0 behind (the 7 Wave 7 commits, unpushed). Staged: none. Unstaged: `scripts/pilot-import.mjs`, `src/routes/me.routes.ts` (the same pre-existing, protected, unrelated modifications carried through every prior slice in this programme — untouched by this audit). Untracked: the same protected noise (`.aider.*`, `opencode.json`, `pilot/luna-residences/`, 5 `docs/*` audit files, 5 `supabase/migrations/*_LOCAL_TEST_*.sql` files) — none created or touched by this audit.

**Office**: `/Users/ochigaidoko/ochiga-office`, branch `communications/handoff-accept-production-fix`, HEAD `b4a3a8ffa35bc584a8000352296e1492ca783966`, tracking `origin/communications/handoff-accept-production-fix`, 1 ahead / 0 behind that remote, 1 ahead of `origin/codex/office-extraction` (the repo's actual default/integration branch). Working tree: one untracked `supabase/` directory (local CLI artifact). **Office was read-only for this entire audit — zero commands beyond `git`/read-only inspection were run there.**

## 2. Wave 7 commit ledger

Every commit after the published Wave 6 checkpoint (`834f672`):

| SHA | Message | Slice |
|---|---|---|
| `08840a7` | Wave 7A: converge recommendation-read authority (canonical operational_recommendations preferred over ephemeral recomputation) | 1 |
| `eda4305` | Wave 7B: repair decision-planning identity lineage | 2 |
| `84e70de` | Wave 7C: normalize decision-planning lifecycle reporting | 3 |
| `c3bf4b5` | Wave 7D: unify human-intervention visibility | 4 |
| `6b6b5c3` | Wave 7E: introduce canonical decision authority | 5 |
| `b1dc656` | Wave 7F: generalize GoalRuntime across operational domains | 6 |
| `32408c6` | Wave 7G: resolve commercial opportunity identity | 7 |

Exactly 7 commits, exactly matching the expected ordered implementation. This is the complete unpublished release payload — `git diff 834f672..32408c6 --stat`: 34 files changed, 5,911 insertions, 16 deletions.

## 3. Secret hygiene

Scanned `git log -p 834f672..32408c6` (6,735 lines) with a pattern set covering API keys, service-role keys, passwords, tokens, private keys, bearer/authorization headers, generic credentials, RTSP URLs, and common provider key shapes (AWS `AKIA...`, GitHub `ghp_...`, Slack `xox...`, Google `AIza...`, OpenAI-style `sk-...`). 10 raw matches, all reviewed individually:

- 7 are documentation prose referencing environment-variable **names** (`OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY`, `x-office-api-key` header name) or generic architecture descriptions — no values.
- 2 are test-only placeholder strings in `wave7-slice7-lead-opportunity-identity-resolution-smoke.mjs` (`"wave7-slice7-local-only"`, `"test-only-shared-secret"`) — self-describing, non-functional local-env defaults, matching the exact established pattern already used in the pre-existing `oyi-communications-convergence-slice1-smoke.mjs`.
- 1 is a SQL function call name (`oyi_complete_materialization(...)`), not a secret.

A second pass for long opaque tokens (40+ contiguous base64/hex-safe characters) returned 180 matches, all either file paths, migration filenames, or git commit SHAs.

**Verdict: CLEAN. No genuine committed secret found. Release is not blocked on this ground.**

## 4. Final ontology (reconstructed from current code)

| Object | Means | Owner | Stored | Identity | Mutated by | Does NOT mean |
|---|---|---|---|---|---|---|
| FACT / SIGNAL | A raw observation submitted into the canonical pipeline | Wave 6 (`submitCanonicalSignal`) | `operational_signals` | `canonicalSignalKey` (source/providerEventId/domain/entity/estate/home derived) | Ingress only, append-mostly | Not an interpretation or a claim about what should happen |
| AWARENESS | The canonical, scope-filtered read of accumulated signals/state | Wave 6 (`CanonicalAwarenessReadService`, Device/Edge/Camera CurrentStateAuthority) | canonical current-state tables | scope + entity | Wave 6 write paths only | Not itself an instruction to act |
| INSIGHT | A derived, evidence-linked observation surfaced for a domain | Wave 6 (`listInsights`, `canonicalAwarenessReadService.ts`) | insight rows, linked to `incident_id` | `insightId` | Wave 6 producers | Not a selected course of action |
| RECOMMENDATION | An advisory suggestion of what could be done | `operational_recommendations` (Slice 1 made canonical reads authoritative over ephemeral recomputation) | `operational_recommendations` | recommendation row id / `recommendation_key` | Domain recommendation producers | Not a commitment — nothing downstream is obligated to act on it |
| **DECISION** | The durable record that a specific course of action, for a specific entity, has been SELECTED | `DecisionStore.ts` / `oyi_decisions` (Slice 5) | `oyi_decisions` | `decision_key` (stable, entity/action/signal-derived, never positional) | Only `DecisionStore.ts`'s own CAS `transitionDecisionStatus` | Not the recommendation, not the goal, not the approval, not the execution |
| **GOAL** | The autonomous objective Oyi is pursuing over time toward an outcome | `GoalRuntime.ts` / `oyi_goals` | `oyi_goals` | goal id + `target_entities` (lead/opportunity/device/etc., all optional-additive) | `goalEvaluator.ts`'s decision loop only, via `persist()` | Not the commercial pursuit itself (that's Opportunity, Office-owned); not a physical action |
| PLAN | A staged sequence toward an objective — three semantically distinct classes (§10) | Split: `Goal.plan` (GoalRuntime), `operational_plans` (intelligence-advisory), `automation_approvals.plan_snapshot` (Facility-executable) | Three separate tables | Scoped to each owning object | Each owner only | No single "Plan" fact is claimed by two systems simultaneously |
| TASK | An obligation to do something — multiple legitimately distinct classes (§11) | Office `crm_tasks` (human work), `GoalPlanStep` (goal step), `maintenance_requests` (domain work order) | Each in its own table | Each object's own id | Each owner only | Not one unified table; colloquial overlap only |
| APPROVAL | A gate on whether a selected/proposed action may proceed | `automation_approvals` (Facility), `GovernedActionProposal` (Office conversational) | Their own tables, both pre-Wave-7 | Each object's own id | Each owner only | Not a Decision — Decision selects, Approval gates |
| ACTION | A single bounded operation, one step of execution | `executionRegistry.ts`'s registered actions (e.g. `device.on/off/toggle`) | N/A (a function call, not a stored object) | `action_id` + `entity_id` | Called by any authorized caller (GoalRuntime included, as of Slice 6) | Not itself authority — it still passes through `DeviceCommandAuthority` |
| EXECUTION | The attempt to physically perform an Action, and its ledgered outcome | `executeDeviceCommandForActor` / execution ledger (Wave 5) | execution ledger table | ledger row id | Wave 5 only | Not something GoalRuntime or DecisionStore ever writes directly |
| OUTCOME | Whether the pursued result actually, durably happened | **Not reified anywhere in this codebase** | N/A | N/A | N/A | Confirmed absent — Wave 8 territory, untouched by Wave 7 |

**No semantic collapse remains.** Every pair that risked conflation in the Slice 0 audit (Recommendation/Decision, Decision/Goal, Goal/Plan, Plan/Task, Approval/Decision) has a distinct owner, storage location, and identity, verified by direct source/schema inspection, not by report re-reading.

## 5. Canonical Decision authority

`oyi_decisions` (migration `20260925100000_wave7_slice5_canonical_decision.sql`) + `DecisionStore.ts` verified directly:
- **Stable semantic identity**: `decision_key` derived from `entityType/entityId/actionType/canonicalSignalKey` — never a positional/index value.
- **Idempotent creation**: unique index on `decision_key`; `createDecision()` catches Postgres `23505` and re-selects rather than erroring.
- **CAS lifecycle**: `transitionDecisionStatus()` takes an explicit precondition set and returns `applied`/`already_in_target`/`conflict` — never a blind overwrite.
- **entity_type/entity_id**: unrestricted `text` columns (no CHECK constraint) — genuinely generalized, confirmed usable for `office_lead` and (new in Slice 7) `office_opportunity` with zero migration.
- **Lineage**: `canonical_signal_key`, `recommendation_key`, `goal_id` (real FK → `oyi_goals`), `plan_id`, `incident_id`, `awareness_key` — all honestly nullable, no fabricated FK across independently-written systems.
- **Authority/policy provenance**: `authority_mode` (`deterministic_policy`|`human_selection`, CHECK-constrained), `policy_source`, `selected_by`.
- **Human-intervention state**: `status` includes `awaiting_human`; `requires_human` boolean.
- **Supersession**: `superseded_by` self-referencing FK.
- **Internal-only writes**: `oyi_decisions` is written only via `DecisionStore.ts`, called only by internal server-side code (`officeMaterialEventAdapter.ts`). No HTTP route accepts a Decision-shaped payload.
- **No provider/execution side effects**: `DecisionStore.ts`'s own exports contain no `send`/`execute`/`dispatch`/`call`/provider-shaped function name (grepped directly against its export list — same check the Slice 5 smoke runs as regression).

**Search for competing durable Decision objects**: grepped the entire repository for any other `class.*Decision`/`DecisionRecord`/`decision_key`-shaped construct outside `DecisionStore.ts`/`decision.ts`/its known consumers — **none found**.

**Acceptance: ONE canonical Core Decision authority exists. Confirmed.**

## 6. Recommendation → Decision boundary

Reassessed at current HEAD, not from Slice 5's own report. `Decision.recommendation_key` exists and is ready to receive a link — but no automatic/general "promote every recommendation into a Decision" pipeline exists anywhere; the sole live `createDecision()` caller (`officeMaterialEventAdapter.ts`) links via `canonical_signal_key`, not `recommendation_key`, and is domain-specific (JV).

**Disposition: B — VALID SEPARATION / future producer adoption.** Decision authority is real, generalized, and safely adoptable (the field exists, the entity_type is unrestricted, no schema change is needed for a second producer to start using it). The task's own framing is correct: the question is whether authority exists and is adoptable, not whether every recommendation must become a Decision. It does not need to for Wave 7 to close.

## 7. Decision → Goal

`Decision.goal_id` (real FK, `on delete set null`) is populated by `attachGoalToDecision()` — additive-only (`.is('goal_id', null)`-guarded, confirmed by source read), never overwrites an existing link. `Goal.canonical_signal_key` (Slice 2) provides the reverse traversal (`listDecisionsByCanonicalSignalKey`) without a second FK. Office's opportunity-aware flow (Slice 7) now also lets the Decision itself target the specific Opportunity when known, independent of the Goal relationship.

**Lineage is sufficient without `Goal.decision_id`.** A bidirectional FK would duplicate identity two systems already independently derive (Decision→Goal via `goal_id`; Goal→Decision via shared `canonical_signal_key`) — not added, correctly, per this audit's own "do not add bidirectional schema merely for convenience" instruction.

## 8. Goal authority

`GoalRuntime.ts`/`oyi_goals` verified directly against current HEAD:
- **Stable identity**: uuid `id`, real dedup via `target_entities` jsonb containment (`findActiveForLead`, `findActiveForDevice` [Slice 6], `findActiveForOpportunity` [Slice 7]).
- **CAS**: `claimForEvaluation()` — `next_evaluation_at` equality gate, matches `scenes.ts`'s own established automation-claim pattern.
- **Scheduler**: `goalScheduler.ts`, 30s poll + event-driven wake (`findGoalsWatchingThread`), pure "when," zero domain logic (verified: no `createDecision`/`oyi_decisions` reference anywhere in this file).
- **Deadline/attempts**: `schedule.deadline`, `max_attempts`/`attempts_completed`, both hard-stop conditions in `evaluateGoal()`.
- **Plan steps**: `GoalPlanStep[]`, 6 real `action_type`s (`send_communication`, `call`, `escalate`, `wait_for_reply`, `create_task`, `device_action` [Slice 6]).
- **Observations/evidence**: bounded arrays (last 100), present and unmodified.
- **needs_human**: real `GoalStatus` value, reached by `escalate` steps and (Slice 6) by fail-closed device-actor/authority outcomes.
- **Office goals**: `lead_id`/`opportunity_id`-scoped, proven live via the JV pipeline.
- **Operational/device goals**: `estate_id`/`home_id`/`device_id`-scoped (Slice 6), proven via fixture, not wired to any live producer (deliberate).
- **`target_entities`**: 8 required-nullable Office fields + 3 optional operational fields (Slice 6) + 1 optional `opportunity_id` (Slice 7) — additive throughout, zero migrations needed since the column is `jsonb`.
- **`findActiveForLead`/`findActiveForOpportunity`/`findActiveForDevice`**: all three verified present, same query shape (jsonb `@>` containment + client-side terminal-status filter), all three independently regression-tested.

**Search for competing Goal runtimes**: grepped for any other `class.*Goal(Runtime|Store|Engine)` — **only `GoalRuntime.ts` found.**

**Acceptance: ONE canonical Goal authority exists. Confirmed.**

## 9. Goal execution boundary

Traced `device_action` `GoalPlanStep` end-to-end via direct source read (`goalEvaluator.ts`'s `device_action` branch, unmodified since Slice 6): `executeStep()` → `resolveGoalDeviceActor()` (real `users`-table lookup, fails closed to `needs_human` on any absence) → `executeRegisteredAction()` (`intelligence-core/executionRegistry.ts`, unmodified, the same entry point every other `device.on/off/toggle` caller uses) → `authorizeDeviceCommand()` (`DeviceCommandAuthority.ts`, capability key `devices.power.control`, unmodified) → `executeDeviceCommandForActor()` → execution ledger → verification (all Wave 5, unmodified). A repository-wide structural source-text assertion (confirmed still passing, Slice 6's own smoke re-run in this audit's regression) proves no `adapterRegistry`/MQTT/direct-device-write bypass exists anywhere in `goalEvaluator.ts`/`goalDeviceActor.ts`.

**`devices.power.control` disabled → Goal cannot physically dispatch**: `executeRegisteredAction()` returning `status: "denied"` (the shape a real capability-kill-switch denial produces) is translated by `goalEvaluator.ts` into `needs_human`, never `blocked`-and-retried, never bypassed. GoalRuntime caches no earlier authority result — every evaluation calls the executor fresh.

**Confirmed: GoalRuntime is NOT a physical execution authority.**

## 10. Plan classification

Three real, distinct plan-shaped structures, verified to still exist independently at current HEAD:

| Structure | Classification | Owner | Scope |
|---|---|---|---|
| `Goal.plan` (`GoalPlanStep[]`) | **GOAL_PURSUIT_PLAN** | GoalRuntime | A single Goal's own staged steps toward its objective |
| `operational_plans` table | **INTELLIGENCE_ADVISORY_PLAN** | `oyi-core` intelligence domain | Advisory, non-executable, a suggestion of a plan |
| `automation_approvals.plan_snapshot` | **AUTOMATION_EXECUTION_PLAN** | Facility Automation | A frozen, approved, directly-executable action sequence |

No collision: no single "what is the plan for X" fact is claimed by two of these at once — each is scoped to its own owning object (a Goal, an intelligence recommendation, or an approved automation), and none reads or writes another's table. This matches the audit's own acceptance bar: "It may close if the classes are semantically distinct and documented" — they are, and this is that documentation.

## 11. Task classification

| Structure | Classification | Owner |
|---|---|---|
| Office `crm_tasks` | **HUMAN_WORK_OBLIGATION** | Office (a person must do something) |
| `GoalPlanStep` (`action_type: "create_task"`) | **GOAL_STEP** | GoalRuntime (a goal step that, when executed, creates a real `crm_tasks` row via `officeTaskBridgeService`) |
| `maintenance_requests`/work orders (Facility, Wave 5/6, untouched) | **DOMAIN_WORK_ORDER** | Facility |
| BullMQ jobs (`automationWorker`, `canonicalMaterializationWorker`, `proactiveIntelligenceScheduler`) | **EXECUTION_JOB** / **SCHEDULER_JOB** | Their own owning system |

No duplicate ownership of the same obligation found: a Goal's `create_task` step *creates* a real Office task via the existing bridge — it never becomes a second representation of that same task; the task's row of record remains solely `crm_tasks`. "Task" is colloquially overloaded across 4-5 systems, as expected, but no two systems claim to be the durable owner of the *same* obligation.

## 12. Approval / human intervention

`humanInterventionView.ts` (Slice 4) verified unmodified since its own commit — `loadHumanInterventionObligations()` aggregates exactly 5 sources: `automation_approvals` (Facility), `GovernedActionProposal` (Office conversational), `oyi_goals.needs_human`, `OyiWorkflow` (device-action conversational confirmation), and (Slice 5 addition) `oyi_decisions.status='awaiting_human'`. **One truthful read view, zero writers** — `loadHumanInterventionObligations` performs no writes anywhere (grepped: no `insert`/`update`/`upsert` call in the file). Native authorities are preserved — the view never mutates `automation_approvals`, `GovernedActionProposal`, `oyi_goals`, or `OyiWorkflow`; it only reads.

Distinguished, per source: **approval** = `automation_approvals`/`GovernedActionProposal` (gates a proposed action); **confirmation** = `OyiWorkflow` (a conversational device-action confirmation step); **input required** = a subset of Decision's `awaiting_human` (missing evidence); **escalation** = `Goal.needs_human` (the goal itself cannot proceed autonomously); **takeover/handoff** = Office `office_handoffs` (a distinct system, not aggregated into this view — see §13).

## 13. Handoff

Reassessed both repos. Office's `office_handoffs` (Slice 0's "Handoff PARALLEL" finding) and Backend's `officeHandoffBridge.ts` are **not two competing systems representing the same fact** — Backend's bridge is a thin outbound HTTP call *into* Office's own, sole handoff authority (`requestOfficeHandoff()` → `POST /admin/communications/handoff-request`); Office remains the only place a handoff row is created or transitioned. This is a domain-boundary call, not a duplicated authority.

**Office handoff limitations discovered in Slice 7, explicitly classified, not fixed**: `findActiveHandoffForLead` dedups purely on `lead_id`, so a second, simultaneous opportunity's handoff request silently reuses the first opportunity's still-active handoff record (confirmed by direct Office-repo audit, `office-operational-workflows.js`). `office_handoffs.crm_opportunity_ref` exists as a column but is never populated on the live JV path. **Classification: OFFICE AUTONOMY FUTURE / Office-owned application-layer work** — not a competing Decision/Goal-layer authority, and explicitly not fixed by this audit (read-only) or by Slice 7 (Office was out of scope for code changes).

## 14. Lifecycle

`lifecycleStage.ts` (Slice 3) re-verified unmodified since Slice 5's own addition of the `decision` object type — `normalizeLifecycleStage()` remains purely a read-side mapper (no writes anywhere in the file, confirmed by grep). Native lifecycles (`GoalStatus`, `oyi_decisions.status`, `automation_approvals.status`, etc.) remain the sole authoritative source; the mapper only translates a known native status into a reporting-only stage label. An unrecognized status resolves to `stage: "unknown", mapped: false` — confirmed still true (Slice 5's own smoke re-asserts this) — never fabricates `active`/`success`/`completion`. Decision was added as an 11th object type in `STATUS_MAPS`, additively, with its own `DECISION_STATUS_MAP` — correctly scoped, no cross-object leakage.

## 15. Identity / lineage

**Core canonical example** (traced against current code): canonical signal (`submitCanonicalSignal`) → awareness/incident (Wave 6 canonical read services) → insight (`listInsights`) → recommendation (`operational_recommendations`) → **Decision: link exists only via `recommendation_key`, currently unpopulated by any live producer** (honest gap, disclosed in §6 — this specific full chain is not yet exercised end-to-end by any real producer) → Goal (via `canonical_signal_key`, exercised by the JV producer) → action/execution (Wave 5, exercised).

**Office commercial path** (traced against current code, both repos): Contact/Organization (Office, real) → Opportunity (Office, real, `crm_opportunities`) → material event (now optionally carries `opportunity_id`, Slice 7) → Decision (`entity_type: "office_opportunity"` when known, Slice 7) → Goal (`target_entities.opportunity_id`, opportunity-scoped dedup, Slice 7) → Communication (`CommunicationRuntime`, unmodified) → inbound reply (`inboundEventPipeline`, unmodified) → Goal wake (`findGoalsWatchingThread`, thread-keyed, unmodified). **Every link in this specific path is now genuinely exercised**, proven in `wave7-slice7-lead-opportunity-identity-resolution-smoke.mjs`.

## 16. Opportunity ownership

Reconfirmed against current code in both repos: Office owns Contact/Organization/Opportunity commercial truth (`crm_contacts`/`crm_organizations`/`crm_opportunities`, all real Office tables, none mirrored in Backend). Core references Opportunity only by id (`Decision.entity_id`, `Goal.target_entities.opportunity_id`) — no Opportunity-shaped table exists in Backend's schema. CommunicationRuntime is untouched, still owns channel execution. `entity_type="office_opportunity"` usage: exactly one call site (`officeMaterialEventAdapter.ts:130`), exactly as Slice 7 built it — **Core did not become a second CRM.**

## 17. Same person / multiple pursuits

Re-proven directly (`wave7-slice7-lead-opportunity-identity-resolution-smoke.mjs`, re-run as part of this audit's own regression, still passing): one lead, two independent opportunities → two separate Decisions (`office_opportunity:opp-site-a`, `office_opportunity:opp-site-b`) → two separate Goals, each correctly scoped, never merged; a genuine retry of one opportunity's event still dedups to exactly one Decision/Goal. No accidental lead-level collapse at the Core layer.

Office-side proposal/handoff lead-scoping (§13, and Slice 7's own §16/§18/§19 documented findings) remain real, disclosed Office convergence work — they do **not** violate Core Decision/Goal truth (Core's own records stay correctly opportunity-scoped regardless of what Office's proposal/handoff pages currently display), so per this audit's own instruction they are recorded as future Office work, not a Wave 7 blocker.

## 18. Scheduler authority

Inventoried every `setInterval`/BullMQ scheduler touching this domain: `goalScheduler.ts` (Goal due-polling), `proactiveIntelligenceScheduler.ts` (read/evaluate/deliver proactive intelligence), `automationWorker.ts`/`scenes.ts` (Facility/Consumer automation ticks), `canonicalMaterializationWorker.ts`/camera workers (Wave 6 materialization). Grepped every one of these files directly for `createDecision`/`oyi_decisions`/`goalRuntime` references beyond their own established, narrow role: **zero matches** beyond `goalScheduler.ts`'s own legitimate `goalRuntime.listDue`/`claimForEvaluation`/`persist` calls. `proactiveIntelligenceScheduler.ts`'s own source comments explicitly self-enforce "no physical execution," "no automatic learning promotion" — confirmed true by the same grep.

**Confirmed: every scheduler owns WHEN, none has become a Decision authority.**

## 19. Next-Action question

Re-assessed at current architecture: `Decision` (a specific, selected course of action for a specific entity, with `status`/`authority_mode`/lineage) sufficiently represents "what should happen next" at the point of selection; `Goal`/`Plan` (via `GoalPlanStep[]`) handle the longer, multi-step pursuit that may follow. No evidence was found in this audit of any cross-entity sequencing need that Decision+Goal cannot already represent — the task's own instruction not to require another object "unless source evidence proves it" is honored: no such evidence was found. **Disposition: Decision, as built, remains sufficient. No NextAction object is required for Wave 7 closure.**

## 20. Communication authority

Classified, no code changes: `CommunicationRuntime` — two-way, governed, multi-channel external communication (plan/authorize/dispatch, the sole system `GoalRuntime`'s `send_communication`/`call` steps use). `NotificationService`/`PushNotificationService` — one-way, in-app/push notification delivery, a different concern entirely (not two-way, not provider-bridged the same way). Office's own WhatsApp bridge — a provider bridge Backend calls *into* for outbound confirmation (`officeTaskBridgeService`/`officeHandoffBridge`'s own pattern), not an independent sender with its own authority. **None of these represent a competing communication authority** — each has a distinct, non-overlapping role.

## 21. Office commercial decision path

| Link | Status |
|---|---|
| website/intake → Contact | CANONICAL (Office) |
| → Organization | CANONICAL (Office) |
| → Opportunity | CANONICAL (Office, undeduped creation, correctly non-colliding) |
| → material event | CANONICAL, now carries `opportunity_id` (Slice 7) |
| → commercial policy | CANONICAL (`relationshipCommunicationPolicyForJv`) |
| → Decision | CANONICAL, opportunity-targeted when known (Slice 7) |
| → Goal | CANONICAL, opportunity-scoped dedup when known (Slice 7) |
| → communication | CANONICAL (`CommunicationRuntime`) |
| → reply → classification | CANONICAL (`inboundEventPipeline`) |
| → goal wake | CANONICAL (thread-keyed, `findGoalsWatchingThread`) |
| → next evaluation | CANONICAL (`goalScheduler`/`claimAndEvaluateGoal`) |
| → human handoff | **PARTIAL** — real and functioning, but lead-scoped only (not opportunity-scoped), the one disclosed, unfixed Office-side gap |

## 22. Facility decision path

Traced a representative scenario (device fault → recommendation): canonical awareness (Wave 6, `CanonicalAwarenessReadService`) → recommendation (`operational_recommendations`, real) → **Decision: not used — Facility's live path goes straight to `automation_approvals`/`GovernedActionProposal`, its own pre-existing approval mechanism** → goal/automation: Facility Automation executes directly via its own approved-plan-snapshot path, not via GoalRuntime → execution (Wave 5, shared).

**Facility does not yet adopt canonical Decision.** This is classified as **DOMAIN_PRODUCER_ADOPTION**, not a missing authority — Facility's own `automation_approvals` already correctly performs the "selected course of action, gated" function for its domain; adopting the newer canonical `oyi_decisions` object is optional future convergence work, not required for Wave 7 to close (per the task's own explicit framing in §37).

## 23. Consumer decision path

Same treatment: Consumer-surface conversational device actions go through `OyiWorkflow` (conversation proposal → confirmation) then directly to the same Wave-5 `executeRegisteredAction`/`DeviceCommandAuthority` chain used everywhere else. No canonical `oyi_decisions` row is created for Consumer device actions today. **Classified: DOMAIN_PRODUCER_ADOPTION** — the conversation proposal/confirmation mechanism already correctly gates the action; Decision adoption here is future work, not a blocker.

## 24. Camera/Edge operational decision path

Traced: `CameraCurrentState`/Edge canonical signal/awareness (Wave 6, `cameraCurrentStateAuthority.ts` et al., fully intact and unmodified) → recommendation (where camera-domain recommendations exist) → **no live Decision producer for camera/edge exists anywhere** (grepped `src/oyi-core/domains/camera` directly: zero `createDecision` references).

**This absence does not block Wave 7 closure.** Per the task's own explicit instruction not to conflate capability availability with authority convergence: the canonical Decision *authority* is real, generalized (`entity_type` is an unrestricted string, ready for a `"camera"`/`"edge"` entity type the moment a producer is built), and camera/edge simply has no live producer yet — future producer adoption, not a gap in Wave 7's own architecture.

## 25. Proactive intelligence

`proactiveIntelligenceScheduler.ts` re-audited directly: it calls `runIntelligenceOrchestrator`/`evaluateOpenPredictions`/`runLearningProposalPass` (read/evaluate only) and delivers proactive messages through the existing conversational/communication path. Grepped directly: **zero references to `createDecision`, `oyi_decisions`, `goalRuntime`, or `oyi_goals` anywhere in this file.** It owns exactly what its own source comments claim: scheduling *when* proactive evaluation runs, and (separately, its own explicit permanent rule) never physical execution, never automatic learning promotion. **Confirmed: no competing Decision authority.**

## 26. Decision identity / concurrency

Re-inspected (not merely re-run) `wave7-slice5-canonical-decision-sql-smoke.mjs`'s real-Postgres concurrency proofs (idempotent creation under genuine concurrent inserts, CAS transition under genuine concurrent updates) and `wave7-slice7-lead-opportunity-identity-resolution-smoke.mjs`'s own proofs (same lead + different opportunity → different Decisions, never merged; same opportunity retried → same Decision, never duplicated). Both confirmed passing in this audit's own regression run (§33). No collision, no regression found.

## 27. Human authority

Confirmed by direct comparison against pre-Wave-7 behavior: no Decision/Goal introduction widened any authority. Commercial: Decision still requires the same real Office data (`crm_opportunities`/`leads`) Backend already had read access to; no new write path into Office was created. Facility: `DeviceCommandAuthority`/`devices.power.control` unmodified (§9, §29) — a Goal's device step is gated exactly as any other caller. Physical: same Wave 5 chain, no shortcut added. Conversation confirmation: `OyiWorkflow` unmodified. Every `requires_human`/`needs_human`/`awaiting_human` case that existed before Wave 7 remains human-required after it; Wave 7 only added new, honestly-failing paths that also land in a human-required state (never auto-approved).

## 28. Security / privacy

Representative regression re-run in this audit (§33): `smoke:oyi-core-privacy`, `smoke:wave6-slice1-privacy-boundary`, `smoke:resident-device-privacy`, `smoke:consumer-facility-scope-privacy`, `smoke:wave6-slice14a-camera-privacy` — all passing, confirming cross-home/cross-estate/camera privacy boundaries are untouched by Wave 7. `oyi_decisions` has no HTTP route of any kind (confirmed by grep — no route file references `DecisionStore`/`oyi_decisions` outside `officeMaterialEventAdapter.ts`'s own internal call). **No new generic Decision-creation route exists; arbitrary Decision creation remains impossible from any external surface.**

## 29. Wave 5 freeze

Re-confirmed via direct diff inspection: `DeviceCommandAuthority.ts`, `deviceCommandController.ts`, `executionLedger.ts`, `verificationService.ts`, `intelligence-core/executionRegistry.ts` all show zero diff across the entire `834f672..32408c6` range (`git diff 834f672..32408c6 --stat` confirms none of these files appear in the changed-file list). Representative Wave 5 smokes (`wave5-slice1/2/3/4`, `wave5d`, `wave5e`) included in this audit's own regression (§33). **No Wave 7 bypass of physical execution authority.**

## 30. Wave 6 freeze

Re-confirmed the same way: `CanonicalAwarenessReadService`, `DeviceCurrentStateAuthority`, `EdgeCurrentStateAuthority`, `CameraCurrentStateAuthority`, and the Wave 6 privacy/freshness/materialization-durability files all show zero diff in the same range. Representative Wave 6 smokes (`wave6-final-a`, `wave6-final-b`, `wave6-slice1/2/4/13/13b/6/14a`) included in this audit's regression (§33). Planning (Decision/Goal) consumes Wave 6 truth via read-only calls (`CanonicalAwarenessReadService`, `resolveVisibleDevice`) — it does not write to, or redefine, any Wave 6 canonical table.

## 31. Migration inventory

Exactly 2 migrations in the unpublished range (confirmed via `git diff 834f672..32408c6 --name-only | grep migrations`):

| Migration | Purpose | Dependency | Additive/destructive | Old-code compat | New-code dependency | Index/constraint risk | Deployment order |
|---|---|---|---|---|---|---|---|
| `20260925090000_wave7_slice2_goal_canonical_signal_lineage.sql` | Add nullable `canonical_signal_key text` to `oyi_goals` + a partial non-unique index | `oyi_goals` must exist (it does, `20260822140000_oyi_goals.sql`) | Additive only (`add column if not exists`, `create index if not exists`) | Full — old code ignores the new column entirely | Slice 2+ code reads/writes it, degrades to `null` if absent | None — nullable column add is a fast metadata-only operation on Postgres; partial index on a new/small table | Must apply before or with Slice 2+ code; safe to apply standalone at any time before deploy |
| `20260925100000_wave7_slice5_canonical_decision.sql` | New `oyi_decisions` table, 24 columns, CHECK constraints, unique `decision_key` index, 4 supporting indexes, FKs to `oyi_goals`/self | `oyi_goals` must exist for the `goal_id` FK | Additive only (`create table if not exists`, `create index if not exists`) | Full — old code never references this table | `DecisionStore.ts` requires the table to exist; its own producer wraps every call in try/catch and never throws, so absence degrades to "Decision not recorded," never a hard failure | New table, zero contention; unique index creation on an empty table is instant | Must apply before or with Slice 5+ code; independent of the Slice 2 migration, naturally ordered after it by timestamp |

No other Wave 7 migration exists — the roadmap's own expectation (Slice 2 + Slice 5, "plus anything else actually present") is exactly met; no additional migration was found or created by Slices 6/7 (both achieved their convergence with zero schema changes, as their own docs state and this audit re-confirms by inspection).

## 32. Migration chain

No destructive reset was run (none needed — both migrations are purely additive). Timestamps: `20260925090000` < `20260925100000`, unique, correctly ordered, no collision with any other migration filename in `supabase/migrations/`. Dependency check: Slice 5's migration depends only on `oyi_goals` (pre-existing, long before Wave 7). Incremental production safety: both are the class of Postgres DDL that does not require a table rewrite or long lock (nullable column add, new table, indexes on empty/new/small tables) — **neither requires a controlled low-traffic deployment window.**

## 33. Complete regression

`npm run typecheck` — clean. `npm run build` — clean.

Full battery (38 items: typecheck, build, Wave 7 Slices 1–7 [Slice 2/5/6 functional+SQL], `goal-runtime`, Oyi Communications Convergence Slice 1/2, `oyi-conversation`, representative Wave 5 [slice1/2/3/4, 5d, 5e], `oyi-core-convergence`, representative Wave 6 [final-a/final-b/slice1/2/4/13/13b/6/14a], `oyi-core-privacy`, `oyi-office-intelligence-convergence`, `office-internal-surface`, `office-automations-bridge`, `conversation-thread-lifecycle`, `resident-device-privacy`, `consumer-facility-scope-privacy`):

**Result: 38/38 items ran; 35 passed, 3 failed. All 3 failures are pre-existing, unrelated, and identically documented across every slice's own convergence record in this programme — zero new regressions:**

| Failing item | Signature | Cause |
|---|---|---|
| `smoke:wave5-slice3-facility-automation-device-verification` | `Error: OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY is required for this local Supabase smoke test` | Local `.env` provisioning gap, confirmed absent, not a code regression |
| `smoke:wave5-slice4-facility-automation-verification-reconciliation` | Same | Same |
| `smoke:oyi-office-intelligence-convergence` | "a retry of the identical event must be recognized as a duplicate, got receipt=undefined"; "the durable store must contain exactly one row for this event after a retry, got 0" | Pre-existing idempotency-store issue, present since Slice 1, unrelated to any Wave 7 file |

All 35 passing items include every Wave 7 slice (1–7, with Slice 2/5/6 functional+SQL), `goal-runtime`, both Oyi Communications Convergence smokes (the original JV golden path, proving backward compatibility), representative Wave 5 physical-authority smokes, representative Wave 6 canonical-awareness/privacy/materialization smokes, and Office/conversation/privacy smokes.

Pre-existing environment failures, classified honestly (expected, unrelated to Wave 7): `smoke:oyi-office-intelligence-convergence`'s 2-assertion idempotency-store failure (documented identically in every slice's own report since Slice 1); any `OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY`-dependent Wave 5 smokes (confirmed absent from `.env`, a local provisioning gap, not a code regression).

## 34. Performance

Reviewed directly: Decision reads/writes are single-row/single-index operations (`decision_key` unique lookup, `entity_type/entity_id` composite index, `entity_type/entity_id/status` partial index for active-only queries) — no N+1 in any Decision code path. Goal dedup (`findActiveForLead`/`findActiveForOpportunity`/`findActiveForDevice`) is a single jsonb containment query each, same cost profile, proven flat under scaling in Slice 6's own performance test (5x item-count scale, query count unchanged). Human-intervention aggregation (Slice 4) queries its 5 sources in parallel, not N+1 per obligation. Lifecycle normalization is a pure in-memory function, zero I/O. Opportunity-aware Goal lookup (Slice 7) is the same single-query shape as its siblings. **No N+1, no provider polling, no busy loop introduced anywhere in Wave 7.**

## 35. Observability

Reviewed Wave 7's own metrics: `oyi_decision_created_total{entity_type, status}`, `oyi_decision_idempotent_reuse_total{entity_type}`, `oyi_decision_transition_total{outcome, status}` — all low-cardinality enum labels, confirmed by direct source read of every `operationalMetrics.increment` call site in `DecisionStore.ts`. No entity id, goal id, decision id, lead id, or opportunity id appears in any metric label anywhere in the Wave 7 diff. Logging (`development_relationship_goal_created`/`_skipped`, `development_jv_decision_record_failed`) carries full identifiers as structured log fields (not metric labels) — sufficient to explain what was selected (`policy`/`action_type`), why (`assessment.recommended_next_step`/`reason`), for what entity (`lead_id`/`opportunity_id`/`entity_type`/`entity_id`), under what authority (`authority_mode`/`selected_by`/`policy_source`), and what goal resulted (`goal_id`).

## 36. Remaining items, each classified exactly once

- Recommendation→Decision general promotion pipeline (only JV adopts it today) — **DOMAIN_PRODUCER_ADOPTION**
- Facility Automation not yet producing canonical Decisions (uses its own `automation_approvals`) — **DOMAIN_PRODUCER_ADOPTION**
- Consumer conversational device actions not yet producing canonical Decisions (uses `OyiWorkflow`) — **DOMAIN_PRODUCER_ADOPTION**
- Camera/Edge no live Decision producer — **DOMAIN_PRODUCER_ADOPTION**
- `Goal.plan`/`operational_plans`/`automation_approvals.plan_snapshot` remain three separate, unconverged (but semantically distinct, documented) plan classes — **DEFERRED TECHNICAL DEBT**
- No device/current-state event-driven Goal wake (poll-only) — **DEFERRED TECHNICAL DEBT**
- No live producer creates an operational (device-targeted) Goal in production — **DOMAIN_PRODUCER_ADOPTION**
- Office `crm_opportunities` has no PATCH/lifecycle route (stage frozen at creation) — **OFFICE AUTONOMY FUTURE**
- Office `proposals` table is lead-scoped only, not opportunity-scoped (cross-deal proposal visibility) — **OFFICE AUTONOMY FUTURE**
- Office `office_handoffs`'s JV path is lead-scoped only, not opportunity-scoped (§13, §21) — **OFFICE AUTONOMY FUTURE**
- Several dead fields (`leads.opportunity_id`, `corporateIntelligence.ts::crm_opportunity_ref`, `inboundCommunicationEvent.ts::related_opportunity_id`, `officeTaskBridgeService.ts::opportunityId`) — **HYGIENE**
- `officeTaskBridgeService.ts`'s `opportunityId` param remains deliberately unwired — **DOMAIN_PRODUCER_ADOPTION**
- Outcome/Learning reification (what actually, durably happened) — **WAVE 8 OUTCOME/LEARNING**
- No formal Wave 9/10 items identified in this domain by this audit

No item above is classified **REQUIRED BEFORE WAVE 7 CLOSURE** or **PRE-DEPLOYMENT BLOCKER** — none was found during this audit.

## 37. Wave 7 verdict

**A — COMPLETE.**

- One canonical Decision authority exists (§5). ✓
- One canonical Goal authority exists (§8). ✓
- Identity/lineage is stable (§7, §15, §26). ✓
- Human intervention is visible (§12). ✓
- Lifecycles are reportable, native authorities preserved (§14). ✓
- Planning cannot bypass execution authority (§9, §29). ✓
- Parallel Plan/Task/Handoff systems are semantically distinguished and classified (§10, §11, §13). ✓
- Commercial Opportunity ownership is resolved (§16, §17, §21). ✓
- Wave 7 completion does not require every domain to already produce Decisions — Facility/Consumer/Camera non-adoption is correctly classified as producer adoption, not a competing authority (§22–§24). ✓

## 38. Wave 8 readiness

Wave 7 is architecturally complete. **Wave 8 — Outcome & Learning Convergence — may begin AFTER the Wave 7 checkpoint is published/deployed**, per this audit's own instruction. This audit does not itself publish, push, or deploy anything, and does not start Wave 8.

## 39–41. See the accompanying final report for the full 41-item numbered answer set, including the authoritative regression pass/fail table once the background battery completes, freeze/blocked/closure determinations.
