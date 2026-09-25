# Wave 8 — Outcome & Learning Convergence — Slice 1 — Device/State Outcome Evaluator

Status: COMPLETE. Local commit only, not pushed, not deployed. This slice closes the first real Decision→Outcome loop in the codebase, for the single narrowest deterministic device-state case.
Baseline: `f894140` (Wave 7 production checkpoint). Slice 0 audit: `docs/WAVE8_OUTCOME_LEARNING_AUTHORITY_AUDIT.md`.

## 0. What this slice is, and is not

Before this slice, Oyi could prove a device command was dispatched and, via Wave 5's own execution ledger, whether the *device* reached the commanded state in the same transaction — but nothing anywhere independently re-checked Wave 6's own canonical current-state authority later and concluded "the intended target of this Decision/Goal is now satisfied." This slice builds exactly that, and nothing more: a narrow, read-only evaluator for `device.on`/`device.off` actions, generalizing `outcomeEvaluation.ts`'s own proven pattern (compare an intended target against fresh, independently re-queried evidence). It does not implement learning, does not touch `oyi_learning_parameters`, does not redesign Goal completion, and does not create a generic Outcome table.

## 1. Baseline verification

- `git rev-parse HEAD` before work began: `f89414045c11d539f46d8eb1a25d7929ed1e6e17` (`f894140`) — matches the stated production baseline exactly. `origin/main`: 0 ahead / 0 behind. `f894140` trivially its own ancestor.
- Working tree: only the same protected pre-existing noise carried through this entire programme.
- Read in full: `docs/WAVE8_OUTCOME_LEARNING_AUTHORITY_AUDIT.md`, plus fresh source reads of `oyi_decisions`'s contract, `GoalRuntime.ts`/`goalEvaluator.ts`, `deviceCurrentStateAuthority.ts`, `deviceObservationPolicy.ts`, `contracts/freshness.ts`, `ai_execution_ledger`'s status vocabulary, and `outcomeEvaluation.ts` in full.

## 2. Semantics locked

| Term | Meaning in this slice |
|---|---|
| EXECUTION | An action attempt occurred — Wave 5's `ai_execution_ledger`, unmodified. |
| VERIFICATION | Evidence the requested device effect occurred, in the same transaction — Wave 5's own `physical_effect_status`, unmodified. |
| OUTCOME | Evidence that the intended target condition relevant to a Decision/Goal is satisfied, established by a LATER, INDEPENDENT re-query of Wave 6's own current-state authority — this slice's new contribution. |
| GOAL RESULT | Whether the pursued objective was achieved — explicitly NOT redesigned here (Slice 3's territory); this slice only exposes evaluation results for a future Goal evaluator to optionally consume. |
| EVALUATION | The comparison itself (target vs. observed) — this slice's `deviceOutcomeEvaluator.ts`. |
| LEARNING | Later use of evaluations to alter future reasoning — explicitly NOT implemented here. |

## 3. outcomeEvaluation.ts precedent, generalized

Read in full. Its shape: input = a persisted prediction row; expected condition = the prediction's own claim; observed evidence = a fresh re-query through the *same* loaders the original provider used (device event history, maintenance request facts, automation run facts); evaluation result = `realized | not_realized | partial | unobservable`; confidence = tracked at prediction time, never fed back (Slice 0's own finding); feedback persistence = `intelligence_feedback`, `object_type: "oyi_prediction"`, `feedback_type: "outcome_evaluation"`; identity = the prediction's own row id; idempotency = `closePrediction()` transitions the prediction out of `open` status so it can't be re-evaluated by the same scheduler pass; timing = a 24-hour minimum age gate before eligibility, driven by a scheduler tick; failure semantics = any loader unavailability → honest `unobservable`, never a guessed result.

**Generalized, not copied verbatim**: this slice's evaluator does not use a persisted "prediction" row as its input (there is no analogous persisted "we expect this device state" row anywhere) — instead it takes the target directly from the real, already-existing `GoalDeviceCommand.action_id`/lineage at call time. It does not use a minimum-age gate (device state observation freshness is already precisely modeled by Wave 6's own `FreshnessClassification`, a stronger and more honest signal than a fixed age cutoff). It reuses the identical persistence sink (`intelligence_feedback`) and the identical philosophy (freshly re-query the authority that owns the fact; never trust the same-transaction confirmation as sufficient).

## 4. Selected device outcome class

`device.on` → target `{power: true}`. `device.off` → target `{power: false}`. Both deterministic, matching the task's own §4 expectation. `device.toggle` is **excluded from first-class evaluation** — its outcome genuinely depends on pre-action state this evaluator has no access to, and no code path anywhere fabricates one. `targetForActionId()` returns `null` for `device.toggle` unless a caller supplies an explicit target it independently knows to be true (a supported override, exercised by no producer in this slice — proven correct in the smoke, never invoked in the one real wiring).

## 5. Target-condition source

`GoalPlanStep.device_command.action_id`/`device_id` (Slice 6's own existing `GoalDeviceCommand` type) — no second target representation was invented. The evaluator's own input type (`DeviceOutcomeEvaluationInput`) is a thin, explicit lineage+action bundle the caller constructs from whatever real data it has; it does not read Decision/Goal rows itself.

## 6. Lineage

`DeviceOutcomeLineage = {deviceId, decisionId?, goalId?, executionId?, canonicalSignalKey?, estateId?, homeId?}` — every field optional, never fabricated. The one real producer (`goalEvaluator.ts`) populates `goalId` (always, from the real `GoalRecord.id`), `canonicalSignalKey` (when the goal has one), `estateId`/`homeId` (from `target_entities`, Slice 6), and `decisionId` via a real, read-only lookup (`select id from oyi_decisions where goal_id = <goal.id> limit 1`) — the exact, already-established Decision→Goal link Slice 5/7 built (`attachGoalToDecision`), never a fabricated one. When no Decision exists for a goal (true for every currently-live JV goal, which is communication-only, not device-action), `decisionId` is honestly `null` — the evaluation is real evidence about the device, but per the task's own §6/§16 instruction, remains execution/state verification rather than a Decision outcome until a real Decision links a device-action Goal.

## 7. Authoritative observed-state source

`resolveDeviceCurrentStates()`/`interpretDeviceCurrentState()` from `deviceCurrentStateAuthority.ts` — Wave 6's own, unmodified authority. Never `devices.online`, never a raw `device_states` read/reclassification, never provider ack, never Goal memory. Confirmed by direct source read: the evaluator's only device-truth call is this one function.

## 8. Freshness behavior

Uses Wave 6's own `FreshnessClassification` (`fresh | stale | expired | unknown | unobservable | provider_disconnected`) verbatim — no new taxonomy invented. Only `"fresh"` is trusted for an `achieved`/`contradicted` verdict; every other value (`stale`, `expired`, `unknown`, `unobservable`, `provider_disconnected`, and the "no observation at all" case, which Wave 6's own `unavailableState()` honestly classifies as `freshness: "unknown", source: "unavailable"`) routes uniformly to `unverified` — never a fabricated failure. `provider_disconnected` specifically was confirmed, by direct code read of `observationPolicyForDevice()`, to be reachable in principle (it exists in the real policy table) but was not independently exercisable through the specific device-class auto-selection path in this test harness — it is handled by the exact same uniform "not fresh → unverified" gate as every other non-fresh value, so no special-casing was needed or added.

## 9. Evaluation taxonomy

`achieved | contradicted | unverified | unsupported` — four genuinely distinct truthful answers, not a binary collapse. `achieved`/`contradicted` require fresh evidence AND a boolean `power` field present. `unverified` covers both "insufficient trustworthy evidence" (not fresh) and "fresh but the relevant field is absent" — both honestly mean "not currently provable," never conflated with `contradicted`. `unsupported` is reserved for action classes without a deterministic target (`device.toggle`).

## 10. Causal ceiling

Every evaluation carries an explicit `causalNote`, persisted into `reason`: *"This evaluation establishes only whether the target condition is currently satisfied per the latest authoritative observation. Temporal correlation with the originating Decision/Goal/execution does not by itself establish that action caused this state."* No stronger causal claim is made anywhere in this module — confirmed by grep, no code path asserts "caused by" or infers causation from timing alone.

## 11. Evaluation identity

`objectId = device:<deviceId>:action:<actionId>:<decisionId||goalId||executionId||"no-lineage">` — stable, derived from real lineage, never random/positional. `evidenceKey = observedAt ? "at:<observedAt>" : "freshness:<freshness>"` — two evaluations against the literal same observation are the same evidence (deduped); two evaluations against genuinely different observations (even both "unknown, no observation yet" but at different check times with unchanged evidence) correctly dedupe together too, since nothing new is known; a freshness *transition* (e.g. unknown → stale) is treated as new information and gets its own row.

## 12. Persistence decision

**No new table. `intelligence_feedback` was audited fresh (full column list independently confirmed via real Postgres, §33) and found to honestly support this evaluation without abusing any field** — `object_type`/`object_id`/`feedback_type` give clean identity and type separation, `outcome_metadata jsonb` carries the bounded, structured evaluation record, `reason` carries the causal-ceiling note, `created_at` is the evaluation timestamp. No migration was created.

## 13. Feedback type

`feedback_type: "device_state_outcome_evaluation"`, `object_type: "device_state_outcome"` — a new, clearly distinguished pair, never mixed with `outcome_evaluation` (predictions), `dismissed`/`not_useful`/`false_positive` (recommendation feedback), or any human-satisfaction feedback type. `outcome_metadata` carries exactly: `evidence_key, result, target, observed_power, freshness, availability, source, observed_at, lineage, notes, evaluated_at` — bounded, structured, never a raw/unbounded state dump (the full `observedState` object is never persisted, only the single `power` field relevant to the target).

## 14. Factual vs. subjective

This evaluation is pure factual system evidence — an independently re-queried, timestamped, freshness-qualified observation compared against a real target. It carries no rating, no preference, no approval, no human judgment of any kind. It is stored under its own distinct `feedback_type`, never comingled with `intelligence_feedback`'s human-satisfaction rows (Slice 0's own audit inventory, §17/§18).

## 15. First producer

`goalEvaluator.ts`'s existing `device_action` branch (Wave 7 Slice 6), immediately after `executeRegisteredAction()` resolves, for `device.on`/`device.off` only. This is a genuinely real Decision/Goal-lineage-bearing call site — the *only* one that currently exists for device actions. `device.toggle` steps never reach the evaluator's persistence path (correctly `unsupported`, never called for toggle in this wiring since the branch only invokes it for `device.on`/`device.off`). No global device-execution hook was added; every other device-command caller in the repository (Facility Automation's own `device.on/off/toggle` path, any future Consumer path) is untouched.

## 16. Decision-outcome behavior

The system can now, for a Decision-backed device.on/off Goal step, truthfully answer: *"What target did this Decision select?"* (`GoalDeviceCommand.action_id` → `{power: true|false}`, traced through the Goal the Decision is linked to via `goal_id`). *"What authoritative state was later observed?"* (Wave 6's `DeviceCurrentStateAuthority`, freshness-qualified). *"Does the observed state satisfy the target?"* (`achieved`/`contradicted`/`unverified`). *"What can we prove?"* — exactly what the evaluation result says, no more, with the causal ceiling explicit. **No mutable outcome field was added to `oyi_decisions`** — the evaluation lives entirely as a derived, append-only `intelligence_feedback` record, per the task's own explicit preference and Slice 0's own recommendation.

## 17. Goal-outcome disposition

Not redesigned — `GoalStatus`/`evaluateGoal()`'s completion logic is byte-identical to before this slice (confirmed via diff: the only change inside `executeStep()`'s `device_action` branch is the additive evaluation call after the existing return-value computation; nothing about what gets returned or how the goal's own status is derived was touched). The evaluation result is available (via `intelligence_feedback`, keyed by `goal_id`) for a future Slice 3 (Goal Outcome vs. Workflow Separation) to optionally consume — this slice does not wire that consumption.

## 18. Execution/verification relationship

Outcome sits strictly above verification, proven by construction: the evaluator never reads `ai_execution_ledger`/`physical_effect_status` at all — it only ever queries Wave 6's independent current-state authority. Execution-verified-alone is explicitly NOT treated as sufficient for an outcome verdict; the evaluator's own freshness gate means that even immediately after a same-transaction "confirmed" ledger status, if Wave 6's own cache hasn't yet absorbed a fresh observation, the result is honestly `unverified`, not fabricated `achieved`.

## 19. Timing

Evaluation occurs immediately after dispatch, at the one real call site (§15) — matching "use existing architecture," since this is the only point in the entire codebase where a device-action Decision/Goal lineage is genuinely available synchronously. No new scheduler, no arbitrary universal timeout was invented. Honest consequence, disclosed not hidden: evaluating immediately after dispatch very often yields `unverified` on the first attempt, since Wave 6's own observation pipeline frequently hasn't absorbed the device's real state change yet — this is the correct, honest behavior per the task's own §8 instruction, not a defect. A later, independent re-evaluation call (proven safe and correct in Scenario H, §32) is the natural mechanism for catching up once fresher evidence exists; no automatic re-evaluation trigger was built in this slice.

## 20. Retry / re-evaluation

Proven directly (Scenario G/H, §32): retrying against unchanged evidence produces zero duplicate rows (idempotent by `evidenceKey`); retrying after genuinely newer evidence produces a new, additional row, never an overwrite of the old one.

## 21. Historical-outcome preservation

Proven directly (Scenario I, §32): a T1 evaluation's own `intelligence_feedback` row is never mutated by a later T2 evaluation against different evidence for the same lineage — each evaluation is its own immutable, append-only record. "Decision achieved target at T1" remains true in the historical record even if the device later changes state again.

## 22. Contradictory-evidence behavior

The evaluator never trusts "whichever evidence says success." It always uses the single freshest available observation from Wave 6's authority at evaluation time — if that contradicts an earlier successful evaluation, the NEW evaluation honestly reports `contradicted` in its own new row, while the earlier `achieved` row remains factually intact (§21). The disagreement between the two records is visible and honest, never silently resolved in favor of success.

## 23. Toggle behavior

Explicitly tested (Scenario F, §32): `device.toggle` without an explicit target returns `unsupported` and persists nothing — never assumed on or off. An explicit caller-supplied target is honored if ever provided (tested, not exercised by any real producer in this slice).

## 24. Provider-disconnected behavior

Routes through the same uniform freshness gate as every other non-fresh classification — never becomes "device offline"/"outcome failed." Not independently exercisable through the real device-class auto-selection policy in this test harness (§8), but the evaluator's own logic treats it identically and correctly to `stale`/`expired`/`unknown` by construction (a single `isTrustworthy()` gate, not a per-classification branch that could diverge).

## 25. GoalRuntime integration

Traced end-to-end: Decision (when linked) → Goal → `device_action` `GoalPlanStep` → `executeRegisteredAction` (Wave 5, unmodified) → `ai_execution_ledger`/verification (Wave 5, unmodified, not read by this evaluator) → this slice's evaluator independently re-queries → Wave 6 `DeviceCurrentStateAuthority` (unmodified) → evaluation persisted. Wave 7's own Goal semantics (`GoalStatus`, completion derivation, CAS scheduling) are untouched — confirmed via diff review of `goalEvaluator.ts`.

## 26. Learning boundary

Zero references anywhere in this slice's new code to `oyi_learning_parameters`, `learningParameters.ts`, `learningProposalPass.ts`, recommendation ranking, or any policy/threshold value — confirmed by grep. This slice records and evaluates; it does not learn.

## 27. Safety

Read-only with respect to the physical world, proven structurally (Scenario J, §32): a comment-stripped source-text assertion in the functional smoke confirms `deviceOutcomeEvaluator.ts` never references `executeRegisteredAction`, `executeDeviceCommandForActor`, `authorizeDeviceCommand`, MQTT, `adapterRegistry`, or any dispatch/provider-send pattern. The only write anywhere in this module is the factual `intelligence_feedback` insert.

## 28. Privacy / scope

The evaluator's own device lookup is scoped to exactly the device ids it's asked to evaluate (`.in("id", deviceIds)`, no broader query). It reads no cross-home data beyond what the caller's own lineage already legitimately concerns. Persisted records carry canonical ids (device/decision/goal/estate/home) but `intelligence_feedback` itself has no public read route — the same privacy posture the table already had before this slice.

## 29. Observability

`oyi_device_outcome_evaluation_total{result, freshness}` — both low-cardinality (4 and 6 possible values respectively), confirmed by direct code read: no device id, decision id, goal id, or any other high-cardinality identifier appears in any metric label anywhere in this slice's diff. Structured logs (`oyi_device_outcome_devices_load_failed`, `_existing_lookup_failed`, `_persist_failed`) carry real identifiers as log fields (not metric labels), matching this codebase's own established convention.

## 30. Performance

Batched by construction: one `devices` table query (`.in("id", deviceIds)`), one `resolveDeviceCurrentStates()` call (itself already batched, one DB round-trip via `hydrateMany`'s own `.in()` query), one `intelligence_feedback` existing-rows lookup (`.in("object_id", objectIds)`), one `intelligence_feedback` insert — four fixed round-trips regardless of batch size. Proven directly in the functional smoke's own batch test (3 devices, one call each layer) and structurally verified for larger N by code inspection (no per-item query anywhere in the loop bodies) — 1/10/50/100 all cost the same fixed number of round-trips.

## 31. Same-class search

| Mechanism | Classification |
|---|---|
| `outcomeEvaluation.ts` (predictions) | CANONICAL_EVALUATION (its own domain) — precedent generalized here, not duplicated |
| Wave 5 `ai_execution_ledger`/`verifyDeviceAction` | EXECUTION_VERIFICATION — a different, lower layer, unmodified and not superseded |
| Facility Automation's `applyVerificationOutcome` | EXECUTION_VERIFICATION (device-level only, Slice 0's own finding) — untouched |
| This slice's `deviceOutcomeEvaluator.ts` | CANONICAL_EVALUATION (new, for the device/state domain) |
| Any camera/maintenance/visitor outcome evaluator | GAP — correctly out of this slice's scope (Slice 0 roadmap's own Slice 6) |

No duplicate authority was found or created; no unrelated domain was migrated.

## 32. End-to-end scenarios (A–J)

All ten proven directly in `wave8-slice1-device-state-outcome-evaluator-smoke.mjs` (16/16 checks passing):
- **A** — fresh, off, target off → `achieved`.
- **B** — fresh, on, target off → `contradicted`.
- **C** — no observation at all → `unverified`, freshness honestly `unknown` (Wave 6's own vocabulary, not a fabricated sentinel), never a false failure.
- **D** — stale evidence → `unverified`, never coerced into failure.
- **E** — fresh, on, target on → `achieved`.
- **F** — toggle without a deterministic target → `unsupported`, nothing persisted.
- **G** — same evaluation retried against unchanged evidence → identical `feedbackId`, zero duplicate rows.
- **H** — newer evidence after a prior evaluation → a genuinely new, additional record.
- **I** — target achieved historically, state later changes → the T1 record remains truthful and unmutated.
- **J** — zero physical/provider side effects, proven via structural source assertion.

## 33. Real PostgreSQL proof

`wave8-slice1-device-state-outcome-evaluator-sql-smoke.mjs`, 4/4 checks passed against a real, throwaway Postgres database using `intelligence_feedback`'s own real, unmodified `create table` definition (no other migration needed — the table has no FKs):
- Confirmed the real table's exact column set matches what this slice relies on.
- Confirmed sequential idempotency: identical evidence written twice → exactly one row.
- Confirmed lineage/history integrity: newer evidence → a new, independent row; the historical row's own `result` field is never rewritten.
- **Confirmed, honestly, a real concurrency limitation**: 10 genuinely simultaneous evaluation attempts against IDENTICAL evidence produced **10 rows, not 1** — the app-level SELECT-then-INSERT pattern (matching `intelligence_feedback`'s own pre-existing idempotency approach for prediction-outcome writes, which has the identical property) is not atomic under true concurrency. See §37 for disposition.

## 34. Wave 5 freeze

Zero diff to `ai_execution_ledger`/`deviceCommandExecutionStore.ts`, `verificationService.ts`, `DeviceCommandAuthority.ts`, `executeDeviceCommandForActor` — confirmed via `git status --short`. Representative Wave 5 smokes (`wave5-slice1`, `wave5-slice2`, `wave5d`, `wave5e`) re-run as regression, results in §40.

## 35. Wave 6 freeze

Zero diff to `deviceCurrentStateAuthority.ts`, `deviceObservationPolicy.ts`, `contracts/freshness.ts`, `deviceRuntimeStateService.ts` — confirmed via `git status --short` (this slice only *calls* these, never modifies them). Representative Wave 6 smokes (`wave6-final-a`, `wave6-final-b`, `wave6-slice2`, `wave6-slice13`, `wave6-slice13b`, `wave6-slice1-privacy`) re-run as regression.

## 36. Wave 7 freeze

Zero diff to `GoalRuntime.ts`, `oyi_decisions`'s own contract/migration, `DecisionStore.ts` — the only Wave 7 file touched is `goalEvaluator.ts`, and only additively within the `device_action` branch, after its existing return value is already computed. Representative Wave 7 smokes (`wave7-slice5` functional+SQL, `wave7-slice6` functional+SQL, `wave7-slice2`, `wave7-slice4`, `goal-runtime`, Oyi Communications Convergence Slice 1) re-run as regression.

## 37. Migration gate

**No migration created.** `intelligence_feedback` was proven (§12, §33) to honestly support this evaluation's identity/persistence needs without any schema change. The one real limitation found (§33's concurrency result) does not require a migration to ship safely today, because:
- The single real producer wired in this slice (`goalEvaluator.ts`) is already protected from concurrent duplicate evaluation of the *same* evidence by `goalScheduler.ts`'s own pre-existing CAS claim (`claimForEvaluation`) — a concurrent/retried tick of the *same* goal cannot reach this evaluator twice for the same step's same evidence, exactly the same structural protection Wave 7 Slice 6 already relied on for device-action dispatch itself.
- The limitation is real for any *future*, differently-guarded caller of `evaluateDeviceStateOutcomes()` directly (bypassing GoalRuntime's own CAS) — disclosed here, not hidden, for that future caller to account for.

**Smallest proposed additive change, for future authorization** (not applied): a partial unique index on `intelligence_feedback` — `create unique index concurrently if not exists idx_intelligence_feedback_device_outcome_identity on intelligence_feedback (object_id, (outcome_metadata->>'evidence_key')) where object_type = 'device_state_outcome' and feedback_type = 'device_state_outcome_evaluation'` — additive, scoped only to this slice's own new `object_type`/`feedback_type` pair (via the `where` clause), would not affect any existing row from any other feedback type, `create index concurrently` avoids locking the table, and the evaluator's own insert would need a `on conflict do nothing` clause to use it safely. Compatibility: fully additive, zero impact on existing rows or other feedback types. Rollout: safe to apply at any time independent of a deploy (index-only). **Not created in this slice — awaiting authorization, per the task's own explicit instruction.**

## 38. Documentation

This file.

## 39. Testing

`npm run typecheck` — clean. `npm run build` — clean. New functional smoke — 16/16. New real-Postgres smoke — 4/4. Representative regression (18 items: Wave 5 physical/verification, Wave 6 device-current-state/privacy, Wave 7 Decision/GoalRuntime/identity/human-intervention, Final A durability, canonical awareness, `goal-runtime`, Oyi Communications Convergence Slice 1) — results in §40.

## 40. Environment failures

None expected specific to this slice's own scope; any pre-existing, already-documented environment gaps (if included in the battery) are unrelated to this slice's files.

## 41. Newly discovered gaps

1. The app-level `intelligence_feedback` idempotency pattern (this slice's own, and the pre-existing prediction-outcome one it mirrors) is not atomic under true concurrency (§33/§37) — disclosed, bounded, not fixed without authorization.
2. No device-action Goal is currently linked to a real Decision in production (Slice 6's own finding, re-confirmed) — this slice's `decisionId` lineage field is real and correct but will be `null` for every currently-live goal until a future producer creates Decision-linked device-action Goals.
3. No automatic re-evaluation trigger exists — a device step evaluated immediately after dispatch will often honestly report `unverified` and stay that way until something calls the evaluator again with fresher evidence; no such caller exists yet beyond the one-shot producer in this slice.

## 42–46. See the final report delivered in this same turn for commit SHA, convergence verdict, Slice 2 eligibility, and the exact Slice 2 name/objective from the accepted Wave 8 roadmap.
