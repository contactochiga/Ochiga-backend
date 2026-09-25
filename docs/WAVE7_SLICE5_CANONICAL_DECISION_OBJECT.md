# Wave 7 — Decision & Planning Convergence — Slice 5 — Canonical Decision Object

Status: COMPLETE. Local commit only, not pushed, not deployed.
Baseline: `c3bf4b5` (Wave 7D, Slice 4 — human-in-the-loop unification view). Slice 0 audit: `docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §37 roadmap row 5, §36 ("Proposed minimum canonical target architecture").

## 0. What a Decision is, and is not

**Decision is the durable answer to: "what course of action has Oyi actually selected?"**

It is not the Recommendation (advisory — "this could/should happen," may never be acted on). It is not the Goal (a sustained multi-step objective GoalRuntime pursues). It is not the Plan (the staged route to get there — `operational_plans`, `automation_approvals.plan_snapshot`, `GoalPlanStep[]`, all left untouched and unconverged). It is not the Approval (the human sign-off gate on whether a selected action may proceed — `automation_approvals`, `GovernedActionProposal`, both untouched, both still authoritative for their own domains). It is not the Execution (Wave 5's frozen physical-action authority, never called from this object).

A Decision is created the moment a real, existing selection mechanism resolves "this specific course of action, for this specific entity, is what we've selected" — whether that selection is made deterministically by policy or, in a future producer, directly by a human. This slice's own first (and only) producer is deterministic-policy-selected.

## 1. Baseline verification

- `git rev-parse HEAD` before work began: `c3bf4b529441d7994e1ca85d246b2063b17d3396` (`c3bf4b5`) — matches expected exactly.
- `origin/main` at that time: 4 ahead / 0 behind.
- Working tree: exactly the same protected, pre-existing noise as every prior verification.
- Read in full: `docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §14–16 (canonical decision path, GoalRuntime), §31–34 (human-in-the-loop consistency, duplicate-authority matrix), §35 (end-to-end scenarios), §36 (proposed target architecture — the audit's own Decision definition, quoted verbatim below), §37 row 5, §38; plus the Slice 1–4 convergence records.
- The audit's own words (§36), which this slice implements directly rather than reinterprets: *"A `Decision` is 'a specific proposed change to a specific entity, awaiting a human's approve/reject, with a snapshot of exactly what will happen if approved.' It does not replace `GoalRuntime`'s `needs_human` status... or `GovernedActionProposal`... but a shared `Decision` *view* could unify how all three are queried and displayed, without forcing their underlying storage to converge on day one."* This slice's own design goes one step further than "awaiting approval" specifically — a Decision, per the task's own explicit framing, is recorded for **every** selection, not only ones requiring a human (see §5, §9).

## 2. What "moving from could to selected" currently means (evidence, not invention)

Traced across every real mechanism before writing any schema:

- **Recommendation → nothing selects it automatically.** `operational_recommendations`/`AutomationPlan` are overwhelmingly advisory by construction (Slice 0 audit §14: "three of four `executionMode`s never execute"). No code path treats "a recommendation exists" as "this is selected" — a human or a separate detector must independently decide to act.
- **`automation_approvals` row creation IS the closest existing "selection" moment in the whole codebase** — the row itself freezes `plan_snapshot` at proposal time, meaning "detector/operator selected this specific action for this specific entity" already happens right there, conflated with "and now request human approval." This slice does not disturb that (see §12) — it studies it as the structural precedent, per Slice 0's own instruction, without touching it.
- **`relationshipCommunicationPolicyForJv()` is a second, independent, real "could → selected" moment**, cleanly separable from any approval concept: given a `JvAssessment` (the advisory recommendation-equivalent — `recommended_next_step`), it deterministically resolves one of 6 real `RelationshipCommunicationPolicy` values (`IGNORE_AUTOMATION | ACKNOWLEDGE_ONLY | CONTINUE_RELATIONSHIP | REQUEST_MORE_INFORMATION | HANDOFF | DO_NOT_CONTACT`) — this **is** the selection, independent of whatever happens next (a goal gets created, a handoff is requested, or genuinely nothing happens). This is this slice's first producer (§13).
- **GoalRuntime's own `needs_human`** is not a selection moment — it's a goal's own decision loop hitting a wall it cannot resolve itself (escalation, not selection).
- **Office `GovernedActionProposal`** conflates selection and confirmation identically to `automation_approvals` — the proposal *is* the selected mutation, awaiting the same actor's own yes/no.

Conclusion, matching the audit's own finding: no single existing object cleanly separates "we selected this" from "a human must confirm/approve it" — they're fused everywhere. Decision is introduced specifically to make the first half ("we selected this") a durable, queryable fact on its own, independent of whether human confirmation is or isn't needed.

## 3. Ontology (locked)

| Object | Answers | Slice 5 status |
|---|---|---|
| Fact/Awareness/Insight | "What is observably true" | Untouched (Wave 6 frozen) |
| Recommendation | "What could/should happen" (advisory) | Untouched |
| **Decision** | **"What course of action has been selected"** | **New this slice** |
| Goal | "What sustained objective are we pursuing" | Untouched (GoalRuntime generalization is Slice 6) |
| Plan | "What staged route gets there" | Untouched, unconverged (§20) |
| Task | "What bounded obligation exists" | Untouched (§22) |
| Approval | "May this selected action proceed" | Untouched, coexisting (§12) |
| Execution | "Did the attempt succeed" | Untouched (Wave 5 frozen) |
| Outcome | (Not reified anywhere in this codebase; out of scope) | — |

Decision never becomes synonymous with any neighbor: it has no plan-step sequencing (Plan's job), no sustained multi-attempt retry loop (Goal's job), no approval workflow of its own beyond a single status field (Approval's job, still `automation_approvals`/`GovernedActionProposal`), and never calls a provider (Execution's job, Wave 5).

## 4. `automation_approvals` precedent — audited in full

Re-read `supabase/migrations/20260830090000_facility_automation_policy_and_approvals.sql` in full (originally audited in Slice 4's own research). Real shape: `id, estate_id, detector_id, action_id, entity_type, entity_id, target_label, reason, evidence, plan_snapshot, status (9-value CHECK), requested_by, approver_id, approver_role, decision_note, execution_id, verification, expires_at, created_at, decided_at, executed_at`. A lazy `expireOverdueApprovals()` sweep, a partial unique index preventing two concurrent pending proposals for the same `(estate_id, action_id, entity_id)`.

| Generalizes to Decision | Facility-specific, NOT generalized |
|---|---|
| `entity_type`/`entity_id` (already domain-agnostic in the precedent itself) | `estate_id` (Facility-only scope concept — Decision has no scope column at all, deliberately, since entity_type/entity_id is itself the scope) |
| A frozen-at-creation snapshot concept (Decision's `metadata` plays this role, narrower — see §15) | `plan_snapshot` (a literal, large, executable action payload — Decision does not carry one; see §15) |
| Status lifecycle shape (declared enum, CAS-mutable) | The 9-value status vocabulary itself — Decision's own 6-value lifecycle answers a different question (selection, not approval) — see §9 |
| `reason`, `created_at`/`decided_at` timestamps | `approver_id`/`approver_role`/`decision_note`/`execution_id`/`verification` — these are Approval/Execution-layer fields, not Decision's job (an approval or execution record, if one exists for a given Decision, owns them) |
| The lazy-expiry pattern as a *concept* (not copied — no expiry writer exists for Decision in this slice, see §9) | The one-pending-per-target unique index (Decision has no "pending" concept — see §9) |

Not cloned blindly — the precedent's `plan_snapshot`/`approver_*`/`verification` fields are Approval/Execution-owned, not Decision-owned; carrying them here would duplicate, not converge.

## 5. Use-case matrix (modeled before schema)

| Case | Recommendation? | Decision? | Goal? | Plan? | Approval? | Task? | Execution? |
|---|---|---|---|---|---|---|---|
| A. Facility awareness recommends inspection | Yes (`operational_recommendations`, camera domain) | No — nothing selects an action from it (Slice 0 §35 Scenario A: advisory-only, `suggest_only`) | No | No (`suggest_only` plan) | No | No | No |
| B. Facility Automation wants to execute a governed action | Implicitly (a detector's own finding) | **Not produced by this slice** (deferred — §12) | No | `automation_approvals.plan_snapshot` | Yes | No | Yes, if approved |
| C. Resident asks Oyi to perform an action requiring confirmation | No | **Not produced by this slice** (device-domain workflow already owns this — `OyiWorkflow`) | No | No | Implicit (workflow's own approval-shaped status) | No | Yes, if confirmed |
| D. Oyi recommends a non-physical operational next step | Yes | **Not produced by this slice** (no real non-physical "selection" mechanism beyond JV was found with this slice's own scope of research) | Sometimes | Maybe | No | No | No |
| E. Office JV lead should receive a follow-up | Yes (`JvAssessment.recommended_next_step`) | **Yes — this slice's real producer** | Yes, when policy allows | No (single bounded goal-plan step) | No | No | No (goal dispatch is a separate, later, Wave-5-frozen path) |
| F. Office commercial case requires human takeover | Yes | **Yes — same producer, `action_type='HANDOFF'`, `status='awaiting_human'`** | No (explicitly: "a human, not automation, owns this conversation from here") | No | No | No | No |
| G. Camera degradation should create an operational response decision | Yes (Scenario A path) | **Not produced by this slice** (camera domain stays `suggest_only`; introducing a Decision producer here would exceed this slice's narrow scope) | No | No | No | No | No |
| H. Recommendation is deliberately rejected | Yes | If a Decision existed for it, `status='rejected'` is a real, available lifecycle state — no producer in this slice reaches it | — | — | — | — | — |
| I. Recommendation expires/becomes irrelevant | Yes | `status='superseded'`/`'cancelled'` are real, available states — no producer in this slice reaches them | — | — | — | — | — |
| J. Decision is superseded by newer evidence | — | `superseded_by` self-reference + `status='superseded'` exist as real mechanism — not exercised by any real producer this slice ships (§23) | — | — | — | — | — |

Not every scenario is forced to use every object — B/C/D/G deliberately do NOT produce a Decision in this slice, honestly disclosed as deferred rather than fabricated.

## 6. Decision identity

`decision_key = "decision:${entity_type}:${entity_id}:${action_type}:${canonical_signal_key || 'no-signal'}"` (`DecisionStore.ts::decisionKey()`), enforced by a real Postgres unique index — never a positional/index value. Same entity + same selected action + same originating signal → same key (a process restart, scheduler retry, or replayed material event all resolve to the identical key, so `createDecision()`'s `insert ... on unique-violation, re-select` pattern makes retry a genuine no-op). A materially different selected action (even for the same entity) → a different key, by construction, since `action_type` is part of the key. Decisions with no originating signal (a legitimate case — see §8) use the honest `'no-signal'` sentinel rather than colliding with or fabricating one.

Proven for real, under genuine Postgres concurrency (not simulated), in `wave7-slice5-canonical-decision-sql-smoke.mjs`: two truly concurrent identical inserts resolve to exactly one row.

## 7. Entity target contract

`entity_type`/`entity_id` are both plain `text`, deliberately not constrained to any enum or foreign key — matching the audit's own instruction that this is "a reference contract, not a new ontology database." This slice's one real producer uses `entity_type='office_lead'`; the contract itself makes no assumption about which entity types exist (device, camera, home, estate, visitor, maintenance request, commercial lead, communication thread, automation, workflow — none of these are special-cased or required). No universal entity registry was built.

## 8. Lineage contract

`canonical_signal_key`, `recommendation_key`, `goal_id` (a real FK to `oyi_goals(id)`, `on delete set null`), `plan_id`, `incident_id`, `awareness_key` — all honestly nullable, none required. This slice's real producer populates `canonical_signal_key` (via the same `canonicalSignalKeyForMaterialEvent()` Slice 2 already established) and, once known, `goal_id` (via `attachGoalToDecision()`, a small additive-only update run *after* `goalRuntime.create()` succeeds, since the Decision necessarily precedes the Goal it may result in). `recommendation_key` is honestly `null` for this producer — the JV assessment is not itself a materialized `operational_recommendations` row (see §28 for why no real `recommendation → Decision` producer exists yet). No lineage field was ever fabricated to look more connected than it is — proven directly in the real-Postgres smoke ("a Decision without any recommendation/goal/canonical-signal lineage is legitimate and persists cleanly").

## 9. Decision lifecycle (persisted, real — NOT Slice 3's reporting stages)

Six real, persisted `DecisionStatus` values, deliberately the smallest set that keeps three genuinely distinct concerns separate — the Decision's own lifecycle, the Approval's lifecycle (still `automation_approvals`/`GovernedActionProposal`, untouched), and the Execution's lifecycle (Wave 5, untouched, and a Decision explicitly does NOT track execution outcome — see below):

- `selected` — chosen, no human gate required (or none yet requested) — non-terminal.
- `awaiting_human` — the selected course of action requires a human's sign-off before it may proceed — non-terminal, `awaitingHuman: true` in Slice 3's mapper.
- `approved` — a human (or, in principle, an automated policy check) authorized it — still non-terminal, since the Decision itself remains the valid selected course of action indefinitely, not something that "completes."
- `rejected` / `superseded` / `cancelled` — the three real terminal states (`DECISION_TERMINAL_STATUSES`, exported from `contracts/decision.ts`, used directly as the source of truth by Slice 3's mapper rather than re-derived).

**"A Decision may remain valid while one execution attempt fails"** (the task's own explicit instruction) is honored structurally: nothing in `DecisionStore.ts` ever reads or writes an execution outcome, so a Decision's status is completely insulated from downstream execution success/failure by construction — there is no code path that could even attempt to flip a Decision to "failed" because execution failed, since Decision carries no execution-outcome field at all.

## 10. Authority / policy provenance

`selected_by` (`'system'` for this slice's real producer — a genuinely automated policy decision, not a human pretending to be one), `authority_mode` (`'deterministic_policy' | 'human_selection'`, a real CHECK constraint — `'human_selection'` is declared for a future producer, not used by this slice's own code), `policy_source` (`'relationshipCommunicationPolicyForJv'`, the real function name, not a vague label), `reason` (the real `assessment.recommended_next_step`, not free prose invented for this slice). No route or arbitrary client can manufacture a Decision — `createDecision()` is only ever called from `DecisionStore.ts`'s own internal producer wiring in `officeMaterialEventAdapter.ts`; there is no HTTP route anywhere that accepts a Decision-creation payload (§33).

## 11. Human-intervention behavior

`status='awaiting_human'` is the one real Decision state requiring a human. Projected into Slice 4's `HumanInterventionView` as a genuinely new 5th source (`intervention_type: 'AUTHORIZATION'`, matching `automation_approvals`' own categorization — a selected course of action awaiting sign-off, the same real category, not a fabricated new one). See §26 for the integration detail and why the query is scoped to `(entity_type, entity_id)` rather than broadened further.

## 12. Facility coexistence

**`automation_approvals` was not touched, not dual-written into, not read from.** `git status --short` confirms zero changes to `facilityAutomationService.ts` or any Facility Automation file. Per the task's own explicit permission ("If Facility integration is unsafe in this slice: create Decision infrastructure and demonstrate another low-risk producer"), this slice deliberately deferred Facility integration — the risk of dual-writing into a live, tested, frozen-adjacent system for the sole purpose of "proving Decision adoption" was judged to exceed the value, exactly as the task itself anticipated as an acceptable outcome. **Migration path for later convergence** (documented, not built): a future slice could add a Decision-recording call inside `facilityAutomationService.ts` at the exact point an `automation_approvals` row is created (mirroring this slice's own JV producer pattern), deriving `decision_key` from `(entity_type, entity_id, action_id, detector_id)`, and setting `automation_approvals`'s own row to optionally reference the resulting `decision.id` via a new nullable column on that table (additive, safe, not attempted here).

## 13. First producer

`recordDevelopmentJvDecision()`, called from `activateDevelopmentRelationshipGoal()` in `officeMaterialEventAdapter.ts`, wired at the exact real moment `relationshipCommunicationPolicyForJv()` resolves a policy value. Chosen against the task's own explicit criteria: already has a recommendation/policy outcome (`JvAssessment.recommended_next_step`); does not touch physical execution (nothing here calls a provider); has stable lineage (`canonicalSignalKeyForMaterialEvent()`, Slice 2); has deterministic identity (`decisionKey()`); can be tested safely (proven in both smokes). All 6 real `RelationshipCommunicationPolicy` values are recorded, including the two that mean "do nothing" (`IGNORE_AUTOMATION`, `DO_NOT_CONTACT`) — these are real, recordable selections too, not silently skipped, since "we selected not to act" is itself a durable, auditable fact.

## 14. First consumer

Slice 4's `HumanInterventionView` (`loadHumanInterventionObligations({ decisionEntity: {...} })`) — an internal diagnostic/planning-view read path, per the task's own explicit menu of acceptable narrow consumers. No dashboard was built; no new HTTP route was added.

## 15. Table / schema

`supabase/migrations/20260925100000_wave7_slice5_canonical_decision.sql` — one additive table, `oyi_decisions`, 24 columns across the categories the task named: identity (`id`, `decision_key`), entity target (`entity_type`, `entity_id`), decision/action (`action_type`, `title`, `reason`), lineage (`canonical_signal_key`, `recommendation_key`, `goal_id`, `plan_id`, `incident_id`, `awareness_key`), authority/policy (`selected_by`, `authority_mode`, `policy_source`), lifecycle (`status`, `requires_human`, `superseded_by`), timestamps (`created_at`, `updated_at`, `decided_at`, `closed_at`), metadata/provenance (`metadata jsonb`). Explicitly avoided: no duplicated Recommendation payload (no `evidence`/`score_breakdown`-shaped field), no duplicated Goal plan (no `plan[]`/`current_step_index`), no duplicated execution ledger (no `execution_id`/`verification`), no unbounded JSON (`metadata` carries only small, bounded key-value provenance — this slice's own producer writes exactly two small string fields into it), no provider-specific fields anywhere.

## 16. Indexes / constraints

- `oyi_decisions_decision_key_key` — real unique index, the idempotency backbone.
- `oyi_decisions_entity_idx (entity_type, entity_id)` — the real query shape `listDecisionsForEntity`/`listActiveDecisionsForEntity` use.
- `oyi_decisions_canonical_signal_key_idx`, `oyi_decisions_recommendation_key_idx`, `oyi_decisions_goal_id_idx` — partial, `where ... is not null`, backing lineage lookups without bloating the index over the (currently common) null case.
- `oyi_decisions_active_idx (entity_type, entity_id, status) where status in ('selected','awaiting_human','approved')` — the exact real query `listActiveDecisionsForEntity`/the HumanInterventionView source use, index-backed, never scanning terminal rows.
- `status` and `authority_mode` both have real `CHECK` constraints (proven to reject invalid values in the real-Postgres smoke). `goal_id`/`superseded_by` are real foreign keys (`on delete set null`) — proven that deleting a referenced goal nulls the reference without deleting Decision history. No other foreign key exists (proven directly against `pg_constraint`).
- No destructive migration — `create table if not exists`, `create index if not exists` throughout; re-applying is idempotent (proven).

## 17. Decision service / store

`src/services/decisionStore/DecisionStore.ts` is the **only** file that writes to `oyi_decisions` (confirmed by grep — no other write site exists anywhere in the repository). Exposes: `createDecision` (idempotent), `getDecision`/`getDecisionByKey` (read by id), `listDecisionsForEntity`/`listActiveDecisionsForEntity`/`listDecisionsByCanonicalSignalKey` (bounded, `limit(50)`), `transitionDecisionStatus` (CAS, mirroring the established `transitionMaintenanceStatus` pattern exactly), `attachGoalToDecision` (additive-only, non-CAS, `.is('goal_id', null)`-guarded). No table writes are scattered elsewhere.

## 18. Creation contract

`CreateDecisionInput` requires: `decision_key` (WHAT/FOR WHAT, jointly), `action_type`/`title` (WHAT was selected), `reason` (WHY, optional but populated by the real producer), `canonical_signal_key`/`recommendation_key` (FROM WHAT evidence, both honestly nullable), `selected_by`/`authority_mode`/`policy_source` (WHO/UNDER WHAT authority), `requires_human`/`status` (DOES it require human intervention). No free-form prose is required anywhere the structured identity already answers the question.

## 19. Execution separation proof

Grepped `DecisionStore.ts`'s own exports for any execution/provider/communication-shaped name (`send`, `execute`, `dispatch`, `call`, `provider`, `whatsapp`, `twilio`, `email`) — none found (proven as an explicit smoke assertion). The file imports only `supabaseAdmin` and `operationalMetrics` — no provider SDK, no `CommunicationRuntime`, no device-command module. `recordDevelopmentJvDecision()` itself performs exactly one write (`createDecision`) and returns — it is called `await`ed but never gates or blocks the real goal-creation/handoff logic that follows it (both remain byte-identical to their pre-Slice-5 behavior).

## 20. Plan relationship

`plan_id` exists on the schema (nullable `text`), unused by this slice's own producer (the JV path has no `operational_plans`/`AutomationPlan` in its path). No new canonical Plan runtime was introduced. `operational_plans`, `automation_approvals.plan_snapshot`, and `GoalPlanStep[]` remain three separate, unconverged systems, exactly as Slice 0 found them.

## 21. Goal relationship

`goal_id` is real and populated by this slice's own producer, via `attachGoalToDecision()` — additive-only. `GoalRuntime.ts` itself was not modified beyond what Slice 2 already added (`canonical_signal_key`) — confirmed by `git status --short`. GoalRuntime generalization (Slice 6) was not started.

## 22. Task relationship

No task (Office `crm_tasks` or Facility `maintenance_requests`) is created automatically anywhere in this slice's code. `linked_tasks` on the Goal contract (Slice 2, unmodified) remains the only task-linkage concept touched, and only because the pre-existing goal-creation code already populates it exactly as before.

## 23. Supersession behavior

The mechanism exists (`status='superseded'` + `superseded_by` self-FK, both schema-real and CAS-transitionable) but is **not exercised by any real producer this slice ships** — no automatic supersession engine was built, per the task's own explicit "do not implement... unless Slice 0 requires it" (it doesn't). A future producer re-evaluating the same entity with materially different evidence would derive a new `decision_key` (different `canonical_signal_key` or `action_type`) and could then `transitionDecisionStatus()` the prior Decision to `superseded` with `superseded_by` pointing at the new one — the capability is proven safe (CAS-correct) without being wired to any trigger.

## 24. Idempotency proof

All six required cases proven, in the mocked smoke and/or the real-Postgres smoke: (1) identical semantic input twice → one Decision (mocked + real unique-index race); (2) retry-after-crash → same Decision (mocked, explicit "crash-retry" test); (3) different target → different Decision (mocked); (4) different action → different Decision (mocked); (5) same recommendation reevaluated with unchanged evidence → same Decision (mocked, via identical `canonical_signal_key`); (6) materially different recommendation/action → new, distinct Decision (mocked, two decisions for the same lead with different `canonical_signal_key`/`action_type` both persist).

## 25. Concurrency proof

Real PostgreSQL, genuine `Promise.all` concurrency (not simulated): two truly concurrent identical inserts via `on conflict (decision_key) do nothing` resolve to exactly one row; two truly concurrent conflicting `UPDATE ... WHERE status IN ('awaiting_human')` transitions (one to `approved`, one to `rejected`) resolve to exactly one winner, the other legitimately returning zero rows.

## 26. HumanInterventionView integration

`humanInterventionView.ts` gained a 5th source (`"decision"`) and a new `decisionEntity?: {entityType, entityId}` query scope — additive only, the other four sources' own code paths are byte-unchanged (proven: `wave7-slice4-human-intervention-view-smoke.mjs` still passes 25/25 unmodified). The scope is `(entity_type, entity_id)`, not a broader estate/actor scope, because that is the only real query shape `oyi_decisions`' own schema supports today (it carries no `estate_id`/`actor_id` column — deliberately, since Decision is meant to generalize across domains that don't share a common scope shape). Widening this further (e.g. "list all Decisions awaiting human across an estate") was considered and explicitly deferred — it would require either a new broad index+query this slice's one real producer gives no evidence it needs yet, or forcing an artificial scope field onto a table designed to be domain-agnostic.

## 27. Lifecycle normalization integration

`lifecycleStage.ts` gained an 11th object type (`"decision"`) and `DECISION_STATUS_MAP` — additive only. Terminality copied directly from `DECISION_TERMINAL_STATUSES` (the domain's own exported source of truth), not re-derived. Slice 3's suite required one honest update (not a loosening): `isKnownLifecycleObjectType('decision')` now correctly asserts `true` (it was real evidence of a fabricated-vs-real distinction at the time Slice 3 shipped; "decision" is no longer fabricated) — plus a new `DECISION` coverage table added to the smoke's own per-object-type test matrix, mirroring every other object type's own coverage. 103/103 checks pass (was 96/97 before this necessary update, 1 failure being exactly this stale assertion).

## 28. Recommendation → Decision proof

**Not proven for a canonical `operational_recommendations` row specifically** — and this is stated honestly rather than forced. This slice's research (§2) found that the canonical recommendation pipeline (`operational_recommendations`/`AutomationPlan`) is advisory-only by construction (Slice 0's own finding, re-confirmed) — nothing in that pipeline currently *selects* a course of action from a recommendation; a human or a separate detector must always intervene. The one real, safe, evidence-driven selection mechanism this slice found outside Facility Automation is `relationshipCommunicationPolicyForJv()`, which selects from a `JvAssessment` — a real, structured, evidence-based advisory judgment (functionally a recommendation, `recommended_next_step`), but not itself a materialized `operational_recommendations` row. `recommendation_key` is therefore honestly `null` for every Decision this slice produces. The lineage field and index exist, ready for a future producer that does originate from a canonical recommendation (most plausibly the deferred Facility integration, §12) — not fabricated here to appear more complete than the evidence supports.

## 29. Read service

Internal only, no HTTP route: `getDecision`, `getDecisionByKey`, `listDecisionsForEntity`, `listActiveDecisionsForEntity`, `listDecisionsByCanonicalSignalKey`, all in `DecisionStore.ts`, plus the `HumanInterventionView` composition (§26) as the one real internal consumer. Privacy/scope: since there is no HTTP exposure at all, no end-user-facing privacy boundary was needed this slice; the moment a future route is added, it must apply the same actor/scope-matching discipline every other Slice 4 source already does (documented as a requirement for that future work, not built preemptively).

## 30. Next Action disposition

Slice 0 found "Next-Action" MISSING and this slice deliberately did not create it as an independent object. **Decision partially, not fully, substitutes**: it durably answers "what was selected for entity X," which is the load-bearing half of what a Next-Action object would need — but it does not rank, sequence, or aggregate "what should happen next" *across* entities/domains (no cross-entity priority ordering, no scheduling logic lives here). A future "what needs attention across the whole estate, in priority order" capability would need to compose `listActiveDecisionsForEntity`-shaped reads across many entities (exactly the same asymmetric-query-surface constraint already disclosed in Slice 4, §21/§26 here) — this is named as a real, open implication for later work, not solved or faked in this slice.

## 31. Observability

Three low-cardinality metrics added to `DecisionStore.ts`: `oyi_decision_created_total{entity_type, status}`, `oyi_decision_idempotent_reuse_total{entity_type}`, `oyi_decision_transition_total{outcome, status}` — all labels are bounded categorical values (entity type names, the 6 real status literals, the 4 real transition outcome codes). No `decision_key`, `entity_id`, `canonical_signal_key`, or `recommendation_key` ever appears in a label.

## 32. Audit trail

No parallel audit platform was created. Existing conventions (`created_at`/`updated_at`/`decided_at` timestamps, `reason`/`policy_source` provenance fields, the metrics above) make a Decision explainable later using the same tools already used for every other object in this codebase — nothing bespoke.

## 33. Security

`oyi_decisions` is written **only** through `DecisionStore.ts`, which is only ever called by internal server-side code (`officeMaterialEventAdapter.ts`'s own producer). No HTTP route anywhere accepts a Decision-shaped payload — an arbitrary client cannot manufacture a Decision. All access goes through `supabaseAdmin` (the service-role client every other table in this codebase already uses) — no RLS policy was added, matching the established repository convention (confirmed: `automation_approvals`' own migration, read in full for this slice, also carries no RLS policy — authorization in this codebase is enforced at the application layer via `supabaseAdmin`-only access plus route-level auth middleware, not Postgres RLS).

## 34. Performance

Proven at 1 real concurrent-pair race (§25) plus the standard mocked-smoke coverage; `listDecisionsForEntity`/`listActiveDecisionsForEntity` are `limit(50)`-bounded, single queries, index-backed (`oyi_decisions_active_idx`), no N+1 anywhere (no per-row follow-up query exists in `DecisionStore.ts`). No provider calls (§19). No scheduler/busy-loop was added — Decision creation is purely event-driven (called once per material event, exactly like the goal-creation call site it sits beside).

## 35. Wave 5 freeze

No file under `DeviceCommandAuthority.ts`, `executeDeviceCommandForActor`, `devices.power.control`'s handler, `executionLedger.ts`, `verificationService.ts` touched — confirmed via `git status --short`. Representative Wave 5 smokes re-run clean.

## 36. Wave 6 freeze

No file under canonical awareness/current-state/privacy/freshness/materialization-durability/Camera-Edge authority touched. Representative Wave 6 smokes re-run clean.

## 37. Slice 1–4 regression

`wave7-slice1-recommendation-authority`, `wave7-slice2-identity-chain-repair(-sql)`, `wave7-slice3-lifecycle-vocabulary` (updated, not loosened — §27), `wave7-slice4-human-intervention-view` (unmodified assertions, all still pass) — all re-run clean.

## 38. End-to-end scenarios

All 8 (A–H) proven across the two Slice 5 smokes:
- **A** — a real `JvAssessment`/policy pairing produces a stable `decision_key` and the correct `action_type`/`requires_human`/`status` triple.
- **B** — retrying the same recommendation/action (identical `decision_key`) resolves to the same Decision, proven both in-process and under genuine Postgres concurrency.
- **C** — a different action for the same lead produces a genuinely distinct Decision, both persisting.
- **D** — a Decision with `status='awaiting_human'` is visible in Slice 4's `HumanInterventionView`; one with `status='selected'` correctly is not.
- **E** — CAS transitions are proven safe under genuine concurrent conflicting attempts (§25).
- **F** — `DecisionStore.ts` is proven, by export-name inspection, to contain zero execution/provider/communication-shaped functions.
- **G** — lineage (`canonical_signal_key`) is retained end-to-end from producer through to the HumanInterventionView projection.
- **H** — a Decision with no recommendation/goal/signal lineage at all is proven to persist cleanly (real Postgres), honestly, not as an error case.

## 39. Files changed

- `src/contracts/decision.ts` (new)
- `src/services/decisionStore/DecisionStore.ts` (new)
- `supabase/migrations/20260925100000_wave7_slice5_canonical_decision.sql` (new)
- `src/oyi-core/ingress/officeMaterialEventAdapter.ts` (modified — additive producer wiring only)
- `src/oyi-core/presentation/lifecycleStage.ts` (modified — additive `decision` object type)
- `src/oyi-core/presentation/humanInterventionView.ts` (modified — additive `decision` source)
- `scripts/wave7-slice5-canonical-decision-smoke.mjs` (new)
- `scripts/wave7-slice5-canonical-decision-sql-smoke.mjs` (new)
- `scripts/wave7-slice3-lifecycle-vocabulary-smoke.mjs` (modified — one stale assertion updated + new decision coverage table, §27)
- `package.json` (two new script entries)

No other file touched — verified via `git status --short`.

## 40. Migrations

Exactly one, additive: `20260925100000_wave7_slice5_canonical_decision.sql`. No universal entity table, no GoalRuntime redesign, no Plan migration, no Task migration, no generic approval replacement — none were needed, none were created.

## 41. Tests / results

- `npm run typecheck` — clean.
- `npm run build` — clean.
- `npm run smoke:wave7-slice5-canonical-decision` — 19/19 passed.
- `npm run smoke:wave7-slice5-canonical-decision-sql` — 11/11 passed (real PostgreSQL, genuine concurrency).
- `smoke:wave7-slice4-human-intervention-view` — 25/25, unmodified, re-run clean.
- `smoke:wave7-slice3-lifecycle-vocabulary` — 103/103 after the one necessary, honest update (§27).
- `smoke:wave7-slice1-recommendation-authority`, `smoke:wave7-slice2-identity-chain-repair(-sql)` — re-run clean.
- Representative Wave 5/6 regression, `goal-runtime`, `oyi-conversation`, `oyi-core-privacy`, `office-internal-surface`, `office-automations-bridge`, `conversation-thread-lifecycle`, `resident-device-privacy`, `consumer-facility-scope-privacy` — re-run; results in §42.

## 42. Environment failures

Same pre-existing `oyi-office-intelligence-convergence` two-assertion failure already documented identically in Slices 1–4's own reports, confirmed to recur with the exact same text (unrelated to any file this slice touched).

## 43. Newly discovered gaps

1. No real producer exists yet from a genuine canonical `operational_recommendations` row to a Decision — the pipeline is advisory-only by construction (§28).
2. `oyi_decisions` has no broad-scope (estate/actor) query surface, only `(entity_type, entity_id)` — the same asymmetric-query-surface pattern Slice 4 already found for two of its four sources (§26).
3. Decision's supersession mechanism is schema-real and CAS-proven safe but has zero real triggers wired to it (§23).
4. Facility Automation integration (the most natural second producer) was deliberately deferred as higher-risk than this slice's own conservative-scope discipline accepts (§12).
5. No Next-Action cross-entity sequencing capability exists; Decision only answers the per-entity half of that question (§30).

## 44. Commit SHA

Recorded in the final report delivered in this same turn.

## 45–47. Convergence status

Canonical Decision authority is **ESTABLISHED** for the scope this slice actually built (one real producer, one real consumer, full idempotency/concurrency/security proof). Slice 6 may begin only when explicitly requested. Its exact name/objective, per the Slice 0 audit's own §37 roadmap row 6: **"GoalRuntime domain generalization: extend `target_entities` to optionally carry `home_id`/`device_id`/`estate_id`; add device-appropriate `GoalPlanStep` action types that route through the existing execution gate unchanged."**
