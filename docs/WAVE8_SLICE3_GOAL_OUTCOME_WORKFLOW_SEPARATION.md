# Wave 8 — Outcome & Learning Convergence — Slice 3: Goal Outcome / Workflow Completion Separation

Status: COMPLETE. Baseline HEAD: `e912f7d` (Wave 8 Slice 2). No migration created — genuinely not required, per §6.

## 1. Scope, as given

Slice 0's own roadmap (`docs/WAVE8_OUTCOME_LEARNING_AUTHORITY_AUDIT.md` §37, Slice 3): *"introduce an explicit, additive distinction on Goal between 'workflow completed' (existing) and 'outcome confirmed' (new, populated only when a Slice-1-style evaluator ran and agreed) — without changing what status: 'completed' already means."* Hard constraints honored throughout: `oyi_goals.status` and its entire existing meaning are untouched; no learning-parameter or recommendation-weight change; no Decision mutation; no Slice 4 (Commercial Outcome Evaluator) work.

## 2/8. Pre-change Goal completion semantics (reconstructed from source, not assumed)

`goalEvaluator.ts::evaluateGoal()` transitions a Goal to a workflow-terminal or parked status at exactly these points:

| Trigger (file:line) | Sets | What it actually proves | Classification |
|---|---|---|---|
| `schedule.deadline` passed | `expired` | Time ran out | WORKFLOW_ONLY |
| `attempts_completed >= max_attempts` | `blocked` | Retry budget exhausted | WORKFLOW_ONLY |
| Inbound reply classified `unsubscribe` | `cancelled` | Recipient opted out — governance stop, not a result | WORKFLOW_ONLY |
| A `GoalReplyBranch` matches the classified reply | `completed` / `blocked` / `needs_human` / `completed`+task | The reply matched an author-declared branch condition | WORKFLOW_COMPLETE (branch semantics are author-defined, not independently verified) |
| `success_condition.type === "reply_received"` + any reply | `completed` | A reply arrived | WORKFLOW_COMPLETE — "reply received" is this goal's own declared success definition, but for a Goal representing a bigger commercial objective (e.g. JV qualification) a reply is only a proxy, not proof (§20) |
| `success_condition.type === "positive_reply"` + positive sentiment | `completed` | A reply was heuristically classified positive | WORKFLOW_COMPLETE — same proxy risk as above (§19) |
| Plan array exhausted, no condition ever matched | `completed`, reason *"Plan finished with no explicit success condition met"* | The plan ran out of steps | WORKFLOW_PROGRESS/WORKFLOW_COMPLETE only (§18) |
| Last step's own dispatch (`outcome.ok`) succeeded, no more steps | `completed` | The last send/dispatch succeeded | WORKFLOW_COMPLETE — for `device_action`, this is the exact Wave 5 ledger result, never an independent re-check (§21) |
| A step fails, no `needsHuman` flag | `blocked` | A step's own dispatch failed | WORKFLOW_ONLY |
| A device step fails authorization, or an escalate step runs | `needs_human` | Human judgment is required to proceed | HUMAN_OUTCOME_JUDGMENT-adjacent, but about the WORKFLOW being stuck, not a verdict on the objective |
| `ConversationOrchestrator.ts` (3 call sites) | `cancelled` | A human explicitly cancelled/superseded the pursuit | WORKFLOW_ONLY, human-initiated stop, not an outcome judgment |

Two additional findings, disclosed as-is (out of scope to fix): (a) `GoalStatus` includes `"failed"` in its type and in `oyi_goals`'s own CHECK constraint, but grepping the entire codebase found **zero call sites that ever set it** — a dead status value, not something this slice invented or touched. (b) No route or function anywhere lets a human explicitly mark a Goal's *objective* achieved/not-achieved (§11) — the only human-triggered transitions are the three `cancelled` writes above, all of which stop pursuit, none of which judge the outcome. Per the task's own instruction, no such route was invented.

## 3/4. Workflow-vs-outcome model, schema decision

**GOAL WORKFLOW STATE** = `oyi_goals.status` and everything that drives it — completely unchanged by this slice (confirmed: `git diff --stat` shows zero lines touched in `GoalRuntime.ts`, `goalEvaluator.ts`, `goalScheduler.ts`, or `contracts/goal.ts`).

**GOAL OUTCOME STATE** = a new, fully separate, read-only, on-demand *derivation* — `deriveGoalOutcome(goal)` in the new `src/services/goalRuntime/goalOutcomeEvaluator.ts`. It is never stored on `oyi_goals`, never computed automatically by `evaluateGoal()`/`goalScheduler.ts`, and has no caller anywhere in the codebase yet (confirmed: `grep -rl "goalOutcomeEvaluator" src/` matches only its own file) — inert until a future, separately-authorized consumer wires it in, matching Wave 8 Slice 2's own "queryable only" precedent.

## 6. Migration gate — not triggered, with justification

The task anticipated (Slice 0 roadmap) this slice would "likely" need one additive nullable column/table. It does not, for a concrete reason: **Wave 8 Slice 1 already built the exact durable evidence this slice needs.** A Goal's own `plan` field (already on `oyi_goals`, unmodified) tells this module which `device_action` steps exist and their `device_id`/`action_id`. Slice 1's own `intelligence_feedback` rows (`object_type: "device_state_outcome"`, already persisted, zero new writes from this slice) tell it what was observed. Reconstructing Slice 1's own deterministic `objectIdFor(lineage, actionId)` identity (imported directly, not duplicated — see §41) lets this module look up the *exact* evaluation row(s) for a goal's own device steps, with no fuzzy matching. No new column, no new table, no new write path was needed. This is a genuine "derived evaluation" design (exactly what Slice 0's own §36 proposed architecture recommended), not a workaround chosen to dodge the gate.

## 5/9. Outcome taxonomy and device outcome integration

`GoalOutcomeState = "achieved" | "not_achieved" | "unverified" | "mixed"` (§5's suggested "unknown" was folded into `unverified` — the task's own Scenario D language uses "unverified" for both "no evaluator" and "insufficient evidence," so a fifth value would only fragment the same honest meaning; the *reason* is carried in `provenance` instead).

`GoalOutcomeProvenance = "device_state_evaluation" | "no_evaluator_available" | "insufficient_evidence"`.

Reduction rule (documented, not silently invented): only Slice 1 `achieved`/`contradicted` results count as strong signal for a device step; `unverified`/`unsupported` steps, or steps with no evaluation row at all, contribute nothing (never coerced toward failure). Among a goal's device-action steps:
- No device-action steps at all → `unverified` / `no_evaluator_available` (Office/communication goals, §10).
- Device-action steps exist, but zero carry a strong (`achieved`/`contradicted`) signal → `unverified` / `insufficient_evidence`.
- Every strong signal is `achieved` → `achieved`.
- Every strong signal is `contradicted` → `not_achieved`.
- Strong signals disagree (one achieved, one contradicted) → `mixed`, honestly, rather than picking a side.

`device.toggle` steps are excluded identically to Slice 1's own `unsupported` handling (never guessed on/off).

## 7. Historical Goal behavior

No speculative backfill anywhere. A historical Goal (created before this slice existed) has, by construction, either zero device-action steps (→ `unverified`/`no_evaluator_available`) or device-action steps with no `intelligence_feedback` rows yet (→ `unverified`/`insufficient_evidence`, evidence array empty). Proven directly in the functional smoke ("G: historical completed Goal without outcome evidence").

## 10. Office Goal behavior

Every currently-live JV/commercial Goal is communication-only (confirmed in Slice 1's own doc, re-confirmed here) — zero `device_action` steps — so `deriveGoalOutcome()` always returns `unverified`/`no_evaluator_available` for them, regardless of workflow status. Proven directly ("D: Office follow-up Goal gets reply"). Slice 4 (Commercial Outcome Evaluator) remains the only future path to a real Office outcome verdict, and is explicitly not started here.

## 11. Human outcome judgment

No mechanism exists today for a human to mark a Goal's *objective* achieved/not-achieved (distinct from cancelling pursuit). Per the task's own instruction, none was invented in this slice.

## 12. Decision relationship

`deriveGoalOutcome()` performs exactly one read-only lookup against `oyi_decisions` (`select id where goal_id = ...`, byte-identical to the query `goalEvaluator.ts` already performs at Slice 1's own call site) to resolve the correct lineage key, and never writes to `oyi_decisions` — proven both structurally (the mock `supabaseAdmin.from("oyi_decisions")` throws if `.update()` is ever called; smoke "I" asserts zero such calls occurred) and by design (no `.update`/`.insert` against that table appears anywhere in the new file). Decision→Goal→Outcome lineage is exposed (each evidence item's origin is traceable back through the goal's own device steps and the resolved `decisionId`) without this slice inferring "the Decision was good."

## 13/14. Provenance and evidence references

Every `GoalOutcome` carries a `provenance` field (see §5) and an `evidence: GoalOutcomeEvidenceRef[]` array — each entry is a pointer (`stepIndex`, `deviceId`, `actionId`, `result`, `feedbackId`, `evaluatedAt`), never a copied blob of the underlying `intelligence_feedback` row's full `outcome_metadata`.

## 15. Timestamps

`evaluatedAt` on the returned `GoalOutcome` is the latest `evaluated_at`/`created_at` among the contributing Slice 1 rows — explicitly distinct from `oyi_goals.updated_at` (the workflow's own last-touched timestamp, never read by this module) and from `completion_reason`'s own implicit timing.

## 16/17. Re-evaluation and reversal semantics

Because this is a pure, on-demand derivation (nothing cached or stored), re-evaluation is automatic and safe by construction: calling `deriveGoalOutcome()` again after Slice 1 writes a newer evaluation row for the same device step picks up the new result via the "latest row per `object_id`, by `created_at`" reduction — proven directly (functional smoke "H", real-Postgres smoke's "latest-row-wins" check). The underlying `intelligence_feedback` history is never rewritten (both smokes assert row counts remain 2 after a second evaluation exists).

**Explicit limitation, not invented as a universal rule**: because each call re-reads the *latest* evidence, a goal's derived outcome CAN honestly flip between two calls if new, contradicting evidence arrives (e.g. "pump off" achieved at T1, then someone turns it back on and a later evaluation is `contradicted` at T2) — this is correct for goals representing a *sustained* condition, and is disclosed on every result via the `note` field (`LIVE_DERIVATION_NOTE`) rather than silently assumed. No universal "once achieved always achieved" semantic was invented, per the task's own explicit instruction.

## 18/19/20/21. Plan exhaustion, positive sentiment, reply received, last dispatch ok

None of these four workflow triggers ever produces a strong `achieved`/`not_achieved` signal on their own — `deriveGoalOutcome()` never reads `success_condition`, `completion_reason`, or `outcome.ok` at all; it only reads `plan` (for step identity) and Slice 1's own evidence. A goal that reaches `completed` via any of these four triggers, with no device-outcome evidence, is honestly `unverified` — proven directly (functional smoke "E/F").

## 22/23. needs_human, Goal read contract

`needs_human` is untouched — this slice never reads or writes `status` at all. No existing Goal read/serialization path was modified; `deriveGoalOutcome()` is a new, standalone, importable function only — no broad API redesign, matching §23's explicit instruction.

## 24/25. Lifecycle reporting, HumanInterventionView

`src/oyi-core/presentation/lifecycleStage.ts` and `src/oyi-core/presentation/humanInterventionView.ts` (the two files matching these concepts in Backend) are untouched — confirmed via `git status --short`. Neither was read for modification purposes; both remain exactly as Wave 7 left them.

## 26. Evaluator architecture

A separate module (`src/services/goalRuntime/goalOutcomeEvaluator.ts`), not folded into `GoalRuntime.ts`/`goalEvaluator.ts` — avoiding turning GoalRuntime into a domain-specific outcome authority, per the task's own explicit preference. It consumes Slice 1's own evaluator output; it does not re-implement device evaluation.

## 27. No learning

Grepped: zero references anywhere in the new file to `oyi_learning_parameters`, `learningParameters.ts`, `learningProposalPass.ts`, or recommendation ranking. This slice records nothing new and proposes nothing — it only derives a read-time answer to "what does existing evidence say."

## 28/29. Slice 1 and Slice 2 relationship

Slice 1: `deriveGoalOutcome()` imports and calls Slice 1's own exported `objectIdFor`/`OBJECT_TYPE`/`FEEDBACK_TYPE` (three symbols made `export`-visible in `deviceOutcomeEvaluator.ts` — a zero-behavior-change visibility edit, confirmed by an unchanged functional-smoke pass count for Slice 1 itself) rather than re-deriving device truth or duplicating the identity formula. One factual evaluation authority, as instructed.

Slice 2: recommendation dismissal evidence (subjective human feedback) is never read by this module and never sets Goal outcome — confirmed by inspection (no reference to `recommendationDismissalEvidence` anywhere in the new file) and by construction (different `object_type` family entirely: `"recommendation"` vs `"device_state_outcome"`).

## 30. Feedback-concurrency ledger

This slice introduces **zero new writes** to `intelligence_feedback` — `deriveGoalOutcome()` only ever performs `select` calls (proven structurally: the smoke's mocked `intelligence_feedback.insert` throws if ever called; "J" asserts zero such calls). The Slice 1/2 concurrency gap (no DB-level uniqueness constraint on `intelligence_feedback`) is therefore **not amplified or newly exposed by this slice** — there is nothing for this slice to race with, since it never inserts. No shared fix was proposed or required here.

## 31. Multi-domain matrix

| Domain | Outcome capability |
|---|---|
| Device | SUPPORTED — consumes Slice 1's real evaluator |
| Camera | NO_EVALUATOR (Slice 0 roadmap's own future Slice 6) |
| Facility Automation | NO_EVALUATOR (not Goal-owned at all — `automation_approvals`, not `oyi_goals`) |
| Maintenance | NO_EVALUATOR (no Goal-linked maintenance evaluator exists) |
| Visitor/Security | NO_EVALUATOR |
| Office/CRM | NOT_APPLICABLE today — zero live device-action steps on any commercial Goal; Slice 4 (Office-blocked) is the only future path |
| Communication | NOT_APPLICABLE — channel delivery (`CommunicationOutcome`) is a different, lower-layer concept than Goal outcome, never conflated here |

No remaining evaluator was implemented in this slice, per its own explicit scope limit.

## 32. End-to-end scenarios (A–J, all proven)

All ten scenarios proven directly in `wave8-slice3-goal-outcome-workflow-separation-smoke.mjs` (13/13 checks, including 3 additional structural checks beyond the ten): A (achieved), B (contradicted → not_achieved), C (unverified), D (Office goal → unverified, no evaluator), E/F (plan exhaustion / last-dispatch-ok never fabricate achieved), G (historical goal → unverified, no backfill), H (new evidence later establishes outcome, non-destructively), I (never mutates `oyi_decisions`), J (never changes learning parameters — no such reference exists in the file at all). Plus: mixed-evidence honesty, multi-step agreement, decisionId-preference lineage, and toggle exclusion.

## 33. Real PostgreSQL proof

`wave8-slice3-goal-outcome-workflow-separation-sql-smoke.mjs`, 5/5 checks passed: the decisionId lookup (both null and found cases) against real `oyi_decisions`; latest-row-wins re-evaluation semantics against real timestamps, with both rows provably retained; an unevaluated device step returning no evidence rather than a guess; and an `EXPLAIN`-verified index-assisted query plan on `intelligence_feedback`, matching Slice 1/2's own proof.

## 34/35/36. Wave 5/6/7 freeze

Wave 5 (`ai_execution_ledger`, `DeviceCommandAuthority`, `executeDeviceCommandForActor`): zero diff, zero reads by this slice's new file. Wave 6 (`deviceCurrentStateAuthority.ts`, `deviceObservationPolicy.ts`, `contracts/freshness.ts`): zero diff, zero reads — this slice never re-queries Wave 6 truth itself, only Slice 1's own already-persisted conclusions (§28). Wave 7 (`GoalRuntime.ts`, `goalEvaluator.ts`, `goalScheduler.ts`, `contracts/goal.ts`, `oyi_decisions`'s own contract): zero diff, confirmed via `git diff --stat`. `deviceOutcomeEvaluator.ts` itself received only a three-line visibility change (`export` added to one function and two constants already fully implemented by Slice 1) — no behavioral change, reconfirmed by Slice 1's own smoke still passing at the same count.

## 37. Slice 1/2 regression

Both re-run as part of this slice's own verification pass — results in the final report.

## 38. Performance

No N+1: `deriveGoalOutcome()` issues exactly two queries per call regardless of how many device steps a goal has (one bounded `oyi_decisions` lookup, one batched `.in("object_id", [...])` lookup covering every device step at once) — proven by construction (no query inside the per-step loop) and exercised directly by the multi-step smoke scenarios. No provider/device call of any kind — this module never touches Wave 6 state itself.

## 39. Observability

`operationalMetrics.increment("goal_outcome_derivation_total", { state, provenance })` — both low-cardinality (4 and 3 possible values respectively). No goal id, device id, or decision id appears in any metric label; failures log via `logger.warn` with real identifiers as structured log fields, not metric labels — matching this codebase's own established convention (Slice 1/2's own precedent).

## 40. Same-class search

Searched for other code treating workflow completion / dispatch success / reply-received as a business outcome:

| Mechanism | Classification |
|---|---|
| `goalEvaluator.ts`'s four completion triggers (§2/§8) | FALSE_OUTCOME_COLLAPSE risk, now addressed by this slice's separate derivation (workflow status itself is unchanged, but a caller now has a truthful alternative to read) |
| Facility Automation `applyVerificationOutcome` (Slice 0's own §14 finding) | DOMAIN_SPECIFIC, device-level-only, out of this slice's scope — not touched |
| `CommunicationOutcome` vs `InboundReplyOutcome` (Slice 0's own §20 finding) | VALID_NARROW_OUTCOME / WORKFLOW_ONLY, already correctly separated in existing code, not touched |
| Office `commercial_stage`/proposal cascade (Slice 0's own §19 finding) | GAP (Lead-scoped, not Opportunity-scoped) — Office-side, out of this Backend slice's control, not touched |

No other domain's collapse was fixed in this slice, per its own explicit scope limit.

## 41. Files changed

- `src/oyi-core/domains/devices/deviceOutcomeEvaluator.ts` — three-line visibility change only (`export` added to `objectIdFor`, `OBJECT_TYPE`, `FEEDBACK_TYPE`); zero logic change.
- `src/services/goalRuntime/goalOutcomeEvaluator.ts` (new) — the entire Slice 3 implementation.
- `scripts/wave8-slice3-goal-outcome-workflow-separation-smoke.mjs` (new) — 13/13 passing.
- `scripts/wave8-slice3-goal-outcome-workflow-separation-sql-smoke.mjs` (new) — 5/5 passing.
- `docs/WAVE8_SLICE3_GOAL_OUTCOME_WORKFLOW_SEPARATION.md` (new) — this file.
- `package.json` — two new script entries.

## 42. Migrations

None.

## 43. Tests/results

`npm run typecheck` — clean. `npm run build` — clean. New functional smoke — 13/13. New real-Postgres smoke — 5/5. Representative regression — results in the final report.
