# Wave 8 — Outcome & Learning Convergence — Slice 5: Learning Parameter Consumer

Status: COMPLETE. Baseline: Backend HEAD `d50652f` (Wave 8 Slice 4), Office HEAD `c08cb92`, unchanged. One additive migration (`20260926090000_wave8_slice5_learning_parameter_governance.sql`), applied only to a local throwaway Postgres database for proof — not applied to any shared/dev/production database by this slice.

## 1. Scope, as given

Close one narrow, governed learning loop: real evidence produces a real proposal, a real human-gated promotion durably changes one parameter, and exactly one real reasoning consumer reads that promoted value — without turning Oyi into an unbounded self-modifying system. This slice does not enable broad automatic learning, does not touch OMA/OSA, sales policy, or execution authority.

## 2. Learning infrastructure before this slice

Reconstructed from source (`learningParameters.ts`, `learningProposalPass.ts`, `outcomeEvaluation.ts`, `proactiveIntelligenceScheduler.ts`):

- `oyi_learning_parameters` (migration `20260814090000`) is real: `id, name, scope_estate_id, scope_home_id, version, current_value, proposed_value, min_bound, max_bound, rollout_stage (observe|shadow|reviewed|enabled), evaluation_basis`.
- `assertLearnableParameter()` enforces a hard boundary: a forbidden-term regex (`permission|rls|access.control|financial.authority|confirmation.requirement|security.policy|safety.constraint|allowed.action.type|risk_class|authority|...`) and an allow-listed namespace prefix (`anomaly.`, `prediction.`, `forecast.`, `recommendation.`, `ranking.`, `notification.cooldown.`, `notification.suppression.`) — both unmodified by this slice.
- `runLearningProposalPass()` (`learningProposalPass.ts`) is real and IS wired to a scheduler (`proactiveIntelligenceScheduler.ts`, gated by `OYI_LEARNING_PROPOSAL_ENABLED`, off by default, daily cadence): for each of exactly 3 prediction types (`device_reliability_risk`, `maintenance_sla_risk`, `automation_failure_risk`) with at least `OYI_LEARNING_MIN_SAMPLE_THRESHOLD` (default 20) evaluated predictions, it computes `accuracy = realized / total` from real `intelligence_feedback` rows (`outcomeEvaluation.ts`'s own evaluated-prediction outcomes) and proposes it as `prediction.<type>.confidence_calibration` via `proposeLearningParameterAdjustment()`.
- The chain stopped exactly here, confirmed by exhaustive grep: `getLearningParameter` has exactly one call site outside its own module (the row-seeding call inside `learningProposalPass.ts` itself — not a reasoning consumer); `promoteLearningParameter` had **zero** callers anywhere in the repo. `proactiveIntelligenceScheduler.ts`'s own comment states this explicitly: "no automatic learning promotion: this file never imports or calls promoteLearningParameter." So: evidence → evaluation → proposal was live; proposal → approval/promotion → parameter → consumer was completely dormant. This slice's job was to close exactly that remaining stretch, for exactly one parameter.

## 3. Learnable parameter inventory

| Name | Domain | Type | Default | Range | Proposal source | Consumers before this slice | Authority sensitivity | Risk |
|---|---|---|---|---|---|---|---|---|
| `prediction.device_reliability_risk.confidence_calibration` | devices | number | 0.5 (neutral) | [0,1] | `learningProposalPass.ts` (real, evidence-backed, scheduled) | 0 | none — advisory text only | LOW |
| `prediction.maintenance_sla_risk.confidence_calibration` | maintenance | number | 0.5 | [0,1] | same | 0 | none | LOW |
| `prediction.automation_failure_risk.confidence_calibration` | automations | number | 0.5 | [0,1] | same | 0 | none | LOW |
| Any other `anomaly.*` / `forecast.*` / `recommendation.*` / `ranking.*` / `notification.cooldown.*` / `notification.suppression.*` name | — | — | — | — | **none exist** — the allow-list permits these namespaces, but no code anywhere proposes a value under them | 0 | n/a | n/a (no live evidence pipeline; not invented for this slice) |

No new parameter was invented. The three `prediction.*.confidence_calibration` instances are the only rows any real code path in this repository will ever create.

## 4. Selected parameter and risk rationale

Selected: `prediction.device_reliability_risk.confidence_calibration` (with `maintenance_sla_risk`/`automation_failure_risk` wired identically as the same class, since all three share one evaluator/proposal/consumer code path — treating them separately would be an arbitrary distinction the evidence itself doesn't support).

Why safest: it is a **confidence threshold for advisory presentation** (§4's own preferred category, verbatim), already represented in the existing allow-list (`prediction.` prefix), with a real evidence producer already live. It cannot touch permissions, privacy, physical authority, security, pricing, or commercial/legal commitments — the consumer wired in this slice (§13) only adjusts the wording of a prediction's advisory `predicted_value`/`reasoning` text (a probability band: "likely" / "possible" / "needs_monitoring"), never the persisted numeric `confidence` field that ranking/severity/awareness elsewhere in oyi-core actually depend on.

## 5. Learning, locked definition

For this slice: **Learning = a governed, evidence-backed, durable parameter change that affects future advisory reasoning.** Not: rewriting historical facts, changing permissions, changing execution authority, editing Goal/Decision history, training the LLM, changing provider credentials. Enforced structurally: the consumer (§13) only ever reads `oyi_learning_parameters`; it has zero write access to any other table, zero reference to `oyi_decisions`/`oyi_goals`, and zero reference to device/camera/edge current-state authorities (proven in the functional smoke, scenarios F/J/K).

## 6. Proposal evidence

Unchanged from the pre-existing, already-live `learningProposalPass.ts`: minimum evidence volume = `OYI_LEARNING_MIN_SAMPLE_THRESHOLD` (default 20) evaluated predictions of that exact type; evaluation types = exactly the 3 `outcomeEvaluation.ts` implements (`realized`/`not_realized`, `unobservable` excluded); scope = global (no estate/home split — a single home rarely accumulates enough samples, and this is a shared, cross-home calibration by design, matching the existing code's own choice); confidence = the raw `realized/total` ratio, no additional weighting; proposal identity = §7 below. This slice did not modify `learningProposalPass.ts`'s evidence logic at all — it only made the evidence trustworthy (§28 below) and built the missing consumer.

## 7. Proposal identity

A repeated proposal from the same underlying evidence is naturally idempotent: `oyi_learning_parameters` already has a real unique index on `(name, scope_estate_id, scope_home_id)` (migration `20260814090000`), so `proposeLearningParameterAdjustment()` always updates the SAME row's `proposed_value`/`evaluation_basis` in place — never inserts a duplicate row on a scheduler retry. This slice did not need to change this; it was already correct.

## 8. Approval / promotion — the narrowest legitimate mechanism

Per §8's own instruction to inspect current architecture first: `HumanInterventionView` (`humanInterventionView.ts`) was inspected as the obvious reuse candidate. It was **not** wired in as a sixth source in this slice — disposition explained in §11. Instead, the promotion mechanism built is the "internal operator/service call" option §8 explicitly permits: `promoteLearningParameter(id, nextStage, { approver, expectedVersion, expectedStage })` in `learningParameters.ts`, not bound to any new public HTTP route (none was created — `DO NOT create a public arbitrary parameter-write route` is honored by never exposing this function through `routes/`). Default posture is **HUMAN APPROVAL**: the one transition that can change future reasoning (`-> "enabled"`, moving `proposed_value` into `current_value`) is refused outright (`{ok:false, reason:"approver_required"}`) without a non-empty `approver` string. Earlier curation transitions (`observe -> shadow`, `-> reviewed`) never touch `current_value`, so they are not gated the same way.

## 9. Human intervention — disposition: deferred, not overbuilt

`oyi_learning_parameters` rows with `proposed_value IS NOT NULL` and `rollout_stage` in `(observe, shadow, reviewed)` are already durable, re-queryable objects — no new schema would be required to project them as a `HumanInterventionView` source. They were **not** wired in this slice for a concrete, disclosed reason: every existing source in `humanInterventionView.ts` is scoped by an actor/estate/thread identity the caller already holds (`estateId`, `goalActorId`, `thread`, `decisionEntity`) — a learning-parameter proposal is a **global, operator-level** object with no natural actor/estate/thread owner, so adding it as a sixth source would require inventing a new authorization dimension for this view (who is allowed to see a global proposal) that this slice was not asked to design. Per §9's own explicit escape hatch ("If not: document/defer rather than overbuild"), this is deferred rather than built ad hoc. The governance path proven in this slice (§8) does not depend on it.

## 10. Versioning

`oyi_learning_parameters.version` already existed but was previously only ever incremented on promotion with no accompanying history. This slice's migration adds `oyi_learning_parameter_promotions` (append-only, never updated or deleted): `parameter_id, from_stage, to_stage, previous_value, new_value, version_before, version_after, evidence, approver, is_rollback, promoted_at`. Written by `recordPromotion()` immediately after every successful CAS update (both `promoteLearningParameter` and `rollbackLearningParameter`).

## 11. Rollback

`rollbackLearningParameter(id, { approver })` restores `current_value` to the `previous_value` recorded in the parameter's own latest promotion-history row, as a **new**, separately-audited promotion event (`is_rollback: true`) — never a raw overwrite, never a deleted history row. Requires a named approver (same default posture as §8). Proven in both the functional smoke (mocked) and the real-Postgres SQL smoke.

## 12. Scope

Global (`scope_estate_id: null, scope_home_id: null`) — matching the existing evidence producer's own choice (`learningProposalPass.ts` already creates/reads these rows at global scope; this slice's consumer reads the identical scope, never a per-home preference applied globally, and never a global value applied to a home that hasn't consented to it — there is no such consent concept here since nothing home-specific is ever touched).

## 13. First consumer

`predictionProviders.ts`'s three eligible providers (`deviceReliabilityProvider`, `maintenanceRiskProvider`, `automationReliabilityProvider`) each call `getLearningParameterCached()` **once** at the top of their own `evaluate()` (before mapping over anomalies, never per anomaly/prediction — §29), then apply the pure, synchronous `applyCalibration(parameter, rawConfidence)` to every anomaly the provider produces. The calibrated value ONLY feeds `probabilityBand()` calls used to compose `predicted_value`/`reasoning` **text** — the persisted numeric `confidence` field on `OperationalPrediction` (consumed by ranking/severity/awareness elsewhere in oyi-core) is completely untouched, still `anomaly.confidence`, byte-identical to before this slice.

Falls back to raw, uncalibrated confidence (i.e. the exact pre-slice behavior) whenever: no row exists, `rollout_stage !== "enabled"`, or `current_value` is non-numeric/out-of-range — never a crash, never a fabricated value.

## 14. Default behavior

Proven directly (functional smoke scenario A/C): with no parameter row, or a row still in `observe`/`shadow`/`reviewed` with a real `proposed_value`, the scale factor is 1.0 (neutral) and `probabilityBand()` receives the exact same input it always did — behavior is byte-for-byte unchanged. Learning infrastructure is fully additive; no deployment changes reasoning merely because this consumer now exists.

## 15. Invalid parameter behavior

Proven (scenario G): `rollout_stage === "enabled"` with `current_value` out of `[0,1]` or non-numeric falls back to the raw, uncalibrated confidence — never crashes, never propagates an invalid learned value into reasoning.

## 16. Application semantics — explicit

What changes: which of "likely" / "possible" / "needs_monitoring" a prediction's advisory text uses for one of 3 prediction types, once a human has promoted real evidence-backed calibration for that type. What does NOT change: the persisted numeric `confidence` field; `predicted_value`'s underlying risk claim; `severity`; any ranking/ordering elsewhere in oyi-core (this consumer touches zero ranking code); any factual state.

## 17. Authority safety

Repository-wide: `assertLearnableParameter()`'s forbidden-pattern/allow-list gate is unmodified by this slice and is still the only path into `oyi_learning_parameters` (re-verified: `promoteLearningParameter`/`rollbackLearningParameter` both call it before any write, proven in functional smoke scenario J — a `permission.wallet.limit`-named row is rejected even mid-promotion). Neither this slice's new code nor its migration references `DeviceCommandAuthority`, any permission table, camera privacy, home/estate scope authority, approval-requirement logic, security policy, or provider credentials anywhere.

## 18. Physical-execution safety

Zero device/automation/execution code was touched. `predictionProviders.ts`'s consumer only affects text composed for already-read-only prediction rows; no learned parameter is consulted anywhere in the device-command, automation-run, or execution-authority call paths (confirmed by grep: `learningParameters.ts`/`predictionProviders.ts` are never imported by `DeviceCommandAuthority`, `executionRegistry.ts`, or any Wave 4B/5 authority file).

## 19. Truth safety

No learned parameter is read anywhere in `DeviceCurrentStateAuthority`, `CameraCurrentStateAuthority`, `EdgeCurrentStateAuthority`, or canonical-awareness code — confirmed by grep (zero references). The persisted prediction `confidence` field (the one thing closest to a "fact" this consumer touches) is explicitly never modified (§13/§16).

## 20. History preservation

Past `oyi_decisions`/`oyi_goals`/`intelligence_feedback` rows are never written or modified by this slice's code (functional smoke scenario F: source-text proof that `learningParameters.ts` never references `oyi_decisions`/`oyi_goals`). `oyi_learning_parameter_promotions` is itself append-only — a promotion or rollback is always a NEW row, never an edit to an old one.

## 21. Outcome evidence connection, demonstrated end-to-end

Proven in the functional smoke as one continuous chain: (B) real evidence (`{sample_size:40, accuracy:0.82}`) → `proposeLearningParameterAdjustment` sets `proposed_value` only, `current_value` untouched → (C) with the proposal still unapproved, consumption stays neutral → (D) `promoteLearningParameter(..., {approver, expectedVersion, expectedStage})` moves `proposed_value` into `current_value`, bumps `version`, writes an audit row with the evidence snapshot → (E) `getLearningParameterCached` immediately returns the enabled row, and the documented `scale = current_value / 0.5` contract is exactly what `predictionProviders.ts` consumes.

## 22. Slice 1 (device outcome) evidence — disposition: SEPARATE

Slice 1's `intelligence_feedback` rows (`object_type: "device_state_outcome"`) are a structurally different evidence class from this slice's evidence (`object_type: "oyi_prediction"`, `feedback_type: "outcome_evaluation"`, written by `outcomeEvaluation.ts`). The one live proposal pipeline in this repo (`learningProposalPass.ts`) only reads the latter. Device-outcome evidence was not forced into this loop, per the task's own explicit instruction not to combine unrelated outcome classes into one learning loop; a future device-reliability-specific calibration parameter, if ever proposed, would need its own evidence wiring, not a reuse of this one.

## 23. Slice 2 (dismissal) evidence — disposition: NOT ELIGIBLE, kept explicitly distinct

Dismissal evidence (Slice 2) is subjective (a human said "not useful") and was never combined with this slice's factual accuracy evidence (`realized`/`not_realized`, derived from independently re-queried current state). `learningProposalPass.ts` does not read dismissal-feedback rows at all, and this slice added no code path that would. No automatic suppression logic exists or was added.

## 24. Slice 4 (commercial outcome) evidence — disposition: FUTURE, untouched

Commercial Opportunity outcome evidence has zero bearing on `prediction.*.confidence_calibration` — a completely different domain (sales pipeline vs. device/maintenance/automation reliability predictions). No sales-policy or follow-up-timing parameter exists in the allow-list, and none was invented. OMA/OSA were not touched.

## 25. Observability

`oyi_learning_parameter_promote_failed` / `oyi_learning_parameter_rollback_failed` / `oyi_learning_parameter_promotion_audit_write_failed` (warn-level, existing `logger` convention, no actor/entity IDs beyond the bounded, allow-listed parameter name and stage literals). `oyi_prediction_outcome_already_recorded` (info-level, new — the expected, benign idempotent-insert outcome). The existing `oyi_learning_proposal_pass_completed` metric (proposed/insufficient_evidence/failed counts) is unmodified. No new per-request metric was added for the consumer itself, since it never crosses a request boundary on its own — its effect is observable through the existing prediction-generation path's own logging.

## 26. Auditability, demonstrated for one learned behavior

For `prediction.device_reliability_risk.confidence_calibration`: WHAT EVIDENCE existed — `oyi_learning_parameter_promotions.evidence` (a snapshot of `evaluation_basis` at promotion time: `sample_size`, `realized`, `not_realized`, `accuracy`, `evaluated_at`). WHAT PROPOSAL was made — `proposed_value` at the moment of promotion (captured as `new_value` in the same row). WHO/WHAT APPROVED — `approver` (a required, non-null string for any `-> enabled` transition). WHAT VALUE CHANGED — `previous_value -> new_value`. WHEN — `promoted_at`. WHAT FUTURE REASONING CONSUMED IT — the `prediction.device_reliability_risk` provider's own `predicted_value`/`reasoning` text, traceable via `applyCalibration()`'s documented contract in `predictionProviders.ts`.

## 27. Concurrency, proven against real Postgres

`scripts/wave8-slice5-learning-parameter-consumer-sql-smoke.mjs`, 10/10 passing: two concurrent `UPDATE ... WHERE id=? AND version=? AND rollout_stage=?` statements on the same row resolve to exactly one successful transition (version advances by exactly one step, never corrupted); a stale CAS attempt (old `version`) affects zero rows; rollback restores the prior value as a new, distinct history row (2 total rows, original never overwritten); a different parameter row is completely unaffected by another parameter's CAS update.

## 28. intelligence_feedback concurrency — disposition: BLOCKER, fixed

Per this slice's own explicit instruction: the shared Slice 1/2 feedback-idempotency gap was audited and found to be a real, material risk here. `outcomeEvaluation.ts`'s `persistOutcome()` (INSERT into `intelligence_feedback`, `feedback_type: "outcome_evaluation"`) had no DB-level guard, and `closePrediction()`'s own CAS guard (`.eq("status","open")`) runs AFTER the insert — a race between two overlapping `evaluateOpenPredictions()` runs on the same still-open prediction could produce two outcome rows, directly inflating/deflating the `realized/total` accuracy ratio `learningProposalPass.ts` proposes. **Fix applied** (not deferred): a partial unique index (`idx_intelligence_feedback_outcome_evaluation_identity`, scoped to `feedback_type = 'outcome_evaluation'` only — Slice 2's dismissal-feedback rows, which legitimately allow multiple rows per object, are completely unaffected) plus a code change in `persistOutcome()` to treat Postgres error `23505` (unique violation) as an expected, benign idempotent no-op rather than a logged failure. Proven against real Postgres: a genuine concurrent double-insert resolves to exactly one surviving row; dismissal-feedback rows remain uncapped.

## 29. Performance

`getLearningParameterCached()` (60s default TTL, `OYI_LEARNING_PARAMETER_CACHE_TTL_MS`-overridable) is called exactly once per provider `.evaluate()` invocation, never per anomaly/prediction item. Proven at 1/10/100/1000 sequential lookups within the TTL window: exactly 1 real read in every case (functional smoke's performance section).

## 30. Cache / refresh semantics

Read-side cache only, 60s default TTL. A promotion or rollback additionally evicts the specific cache entry it just wrote (`parameterCache.delete(...)` inside both `promoteLearningParameter` and `rollbackLearningParameter`), so the SAME process sees its own change immediately; a different process (a separate worker) sees it within, at most, the TTL window. No restart is required in either case.

## 31. Same-class search

| Location | What it does | Classification |
|---|---|---|
| `predictionProviders.ts::probabilityBand()` (0.65/0.45 thresholds) | Confidence -> qualitative band for prediction text | FIRST_CANONICAL_CONSUMER (this slice's own, via `applyCalibration`) |
| `predictionPersistence.ts:20` (duplicate 0.65/0.45 thresholds, used to derive a persisted `confidence` label) | Same qualitative banding, independently re-implemented at persistence time | DUPLICATE — documented, not touched; migrating it risks a live/persisted text mismatch that is out of this slice's narrow scope |
| `operationalReasoning.ts:104` (`item.confidence >= 0.8` "strong awareness" threshold) | Gates whether an awareness item counts as "strong" for executive reasoning | FUTURE_CONSUMER — a plausible future `ranking.`-namespace parameter, not backed by any allow-listed name today; not invented here |
| `contextAwareness.ts:362`, `operationalReasoning.ts:331/355` (confidence used as an ordering/tie-break term) | Ranking-shaped code | FUTURE_CONSUMER — same reasoning |
| `learningProposalPass.ts`'s `MIN_SAMPLE_THRESHOLD` (env override) | Evidence-sufficiency bar for proposing a change | STATIC_BY_DESIGN — deliberately an operator/env config, not something Oyi should learn to adjust about its own evidence bar (that would be circular) |
| `outcomeEvaluation.ts`'s `MIN_AGE_HOURS_FOR_EVALUATION` | Minimum prediction age before evaluation | STATIC_BY_DESIGN — same reasoning |

No UNSAFE_TO_LEARN code (a constant that governs permissions/authority/truth/security masquerading as a tunable) was found in this search.

## 32. Scenarios A-L

All proven in `scripts/wave8-slice5-learning-parameter-consumer-smoke.mjs` (21/21 passing): A (no row -> default), B (evidence -> proposal, `current_value` untouched), C (proposal alone -> unchanged behavior), D (promotion -> durable value + audit row), E (future reasoning consumes the promoted value), F (past Decisions/Goals untouched — source-text proof), G (invalid value -> safe default, both out-of-range and non-numeric), H (stale concurrent promotion rejected — including the sound history-based idempotent-retry distinction from a genuinely different concurrent winner), I (rollback restores prior value as a new audited event), J (zero permissions changed — forbidden-namespace rejection still enforced), K (zero factual state touched — no unexpected table access), L (default posture is human approval; non-enabling transitions don't require one).

## 33. Migration decision

Triggered, and applied: `20260926090000_wave8_slice5_learning_parameter_governance.sql` — the smallest additive design covering both the promotion-governance gap (§10/§11/§27/§33's own requirement) and the feedback-idempotency blocker (§28). Applied only to a local throwaway Postgres database for proof (both SQL smokes); not applied to any shared/dev/production database.

## 34/35/36. Wave 5/6/7 freeze regression

Representative smokes re-run clean after this slice's changes: `wave5-slice1-facility-automation-device-authority`, `wave4b-slice4-commandrouter-device-command-authority` (Wave 5/4B physical authority), `wave6-slice2-canonical-awareness`, `wave6-slice13-device-current-state-authority` (Wave 6 state/awareness), `wave7-slice5-canonical-decision`, `wave7-slice6-goalruntime-domain-generalization`, `wave7-slice7-lead-opportunity-identity-resolution` (Wave 7 Decision/Goal). See final report for exact pass counts.

## 37. Wave 8 Slice 1-4 regression

`wave8-slice1-device-state-outcome-evaluator`, `wave8-slice2-recommendation-dismissal-evidence`, `wave8-slice3-goal-outcome-workflow-separation`, `wave8-slice4-commercial-outcome-evaluator` all re-run clean — no outcome semantics changed by this slice.

## 38. Files changed

- `supabase/migrations/20260926090000_wave8_slice5_learning_parameter_governance.sql` (new).
- `src/oyi-core/domains/intelligence/learningParameters.ts` — CAS-based `promoteLearningParameter`, new `rollbackLearningParameter`, new `getLearningParameterCached`, new `PromotionResult` type. `getLearningParameter`/`proposeLearningParameterAdjustment` unchanged.
- `src/oyi-core/domains/intelligence/outcomeEvaluation.ts` — `persistOutcome()` now treats Postgres 23505 as a benign idempotent no-op.
- `src/oyi-core/domains/intelligence/predictionProviders.ts` — the one real consumer (`loadCalibration`/`applyCalibration`), wired into the 3 eligible providers' `.evaluate()`.
- `scripts/wave8-slice5-learning-parameter-consumer-smoke.mjs` (new, 21/21).
- `scripts/wave8-slice5-learning-parameter-consumer-sql-smoke.mjs` (new, 10/10).
- `package.json` (2 new script entries).
- `docs/WAVE8_SLICE5_LEARNING_PARAMETER_CONSUMER.md` (this file).

`learningProposalPass.ts`, `proactiveIntelligenceScheduler.ts`, `GoalRuntime.ts`, `goalEvaluator.ts`, any device/camera/edge authority file, OMA/OSA — zero lines changed.

## 39. Migrations

One: `20260926090000_wave8_slice5_learning_parameter_governance.sql` (partial unique index on `intelligence_feedback` + new `oyi_learning_parameter_promotions` table). Applied locally to a throwaway Postgres database only, for proof.

## 40. Tests / results

`npx tsc --noEmit` — clean. `npm run build` — clean. Functional smoke — 21/21. SQL smoke — 10/10. Regression — see §34-37 (all clean; exact counts in final report).

## 41. Environment failures

None encountered specific to this slice's own work.

## 42. Newly discovered gaps

The `intelligence_feedback` outcome-evaluation duplicate-write risk (§28) — found and fixed, not merely disclosed. `operationalReasoning.ts`'s hardcoded `0.8` strong-awareness threshold and `predictionPersistence.ts`'s duplicate probability-band thresholds (§31) — found, classified, left untouched as genuinely out of this slice's narrow scope.

## 43. Learning Parameter Consumption: CONVERGED for this one narrow loop

One parameter class (`prediction.*.confidence_calibration`), one governed human-approval promotion path with real CAS/versioning/rollback/audit, one real reasoning consumer, proven end-to-end with zero authority/truth/history impact. Every other allow-listed namespace remains genuinely dormant (no evidence producer exists for them) — this was not expanded, per the task's own explicit "do not invent new parameters" instruction.

## 44. Slice 6

Not started, per this slice's own explicit stop condition. The next Wave 8 slice, per the accepted Slice 0 roadmap, is Slice 6 — its exact objective is recorded in the final report below, taken verbatim from `docs/WAVE8_OUTCOME_LEARNING_AUTHORITY_AUDIT.md`'s own roadmap section, not guessed.
