# Wave 8 — Final Closure Audit — Outcome & Learning Convergence Certification

Status: READ-ONLY VERDICT AUDIT. Uncommitted. No source, test, or migration file was modified while producing this document. No commit, push, deploy, or Wave 9 work occurred in this pass.

Backend HEAD audited: `94ae4ab286cbf361b51658e0889e66b74e684104` (confirmed).
Office HEAD audited: `c08cb926eb8868d8e175bce75104012e6f6694e8` (confirmed).

---

## 1. Repository verification

**Backend** (`/Users/ochigaidoko/Documents/Ochiga-backend`): branch `main`, HEAD `94ae4ab`, matches the expected value exactly. `origin/main..HEAD` = 6 commits ahead, 0 behind — the entire Wave 8 payload (Slices 1–6) is unpublished. Working tree: two pre-existing modified files (`scripts/pilot-import.mjs`, `src/routes/me.routes.ts`) and a long list of pre-existing untracked noise (`.aider.*`, `opencode.json`, `pilot/luna-residences/`, five prior `docs/WAVE*_AUDIT.md` files, five `*_LOCAL_TEST_*.sql` migrations) — all protected, none touched by this audit.

**Office** (`/Users/ochigaidoko/ochiga-office`): branch `communications/handoff-accept-production-fix`, HEAD `c08cb92`, matches exactly. Tracking `origin/communications/handoff-accept-production-fix`, 1 commit ahead / 0 behind — `c08cb92` itself is unpublished. Working tree: one pre-existing untracked `supabase/.temp` directory (local Supabase CLI cache, dated 1 Sept, unrelated to Wave 8) — protected, untouched.

Both repositories are at the expected commits. No divergence from the record.

## 2. Release ledger reconstruction (Backend, `origin/main..HEAD`)

| Commit | Title |
|---|---|
| `17e7fcb` | Wave 8A: establish device-state outcome evaluation |
| `e912f7d` | Wave 8B: surface recommendation dismissal evidence |
| `5494725` | Wave 8C: separate goal outcome from workflow completion |
| `d50652f` | Wave 8D: evaluate commercial opportunity outcomes |
| `8d741d7` | Wave 8E: activate governed learning parameter consumption |
| `94ae4ab` | Wave 8F: converge remaining domain outcome evaluators |

34 files changed, 6,759 insertions, 32 deletions. One migration (`20260926090000_wave8_slice5_learning_parameter_governance.sql`, Slice 5 only — Slices 1–4 and 6 add zero migrations, confirmed by the file list). The Office prerequisite is the single separate commit `c08cb92` ("Wave 8 prerequisite: establish Opportunity outcome authority"), containing `db/20260925120000_proposals_opportunity_id.sql` and its own audit doc.

## 3. Secret hygiene scan

Ran a pattern scan (api key / secret / password / token / bearer / private key / service role / AKIA / PEM headers) across the full `git diff origin/main..HEAD` payload and a high-entropy-literal scan, plus `git show c08cb92` for Office. Findings: zero real secrets. The only header-name match is the literal string `"x-office-api-key"` (a header *name*, not a value); the associated `key` variable resolves via `resolveOfficeSyncKey()` → env var, never a hardcoded literal. Office's own `npm run security:secrets` (independent scanner) also reports `PASS`. The one high-entropy string that surfaced (`11111111-1111-1111-1111-111111111111`) is a test-fixture UUID, not a credential. **Clean.**

## 4. Outcome & learning ontology (reconstructed from current code)

| Term | Meaning | Storage | Writers |
|---|---|---|---|
| **Execution** | A Decision/Goal step ran (device command dispatched, etc.) | `oyi_goals.plan` step status | `goalEvaluator.ts::executeStep` |
| **Verification** | Wave 6's current-state authorities' own factual read of device/camera state | `oyi_devices`/camera tables via authorities | Wave 6 authorities (untouched) |
| **Outcome** | Did the real-world objective the step/Goal named actually hold, per fresh independent evidence | `intelligence_feedback` (`feedback_type='outcome_evaluation'`) | 4 new evaluators (device/camera/maintenance/visitor) + commercial (read-only, no persistence) + `outcomeEvaluation.ts` (predictions) |
| **Goal Result** | `deriveGoalOutcome`/`Batch`'s reduction of one Goal's outcome evidence into `achieved\|not_achieved\|unverified\|mixed` | Not stored — pure, on-demand derivation | `goalOutcomeEvaluator.ts` |
| **Feedback (dismissal)** | A human said a recommendation was unhelpful/wrong | `intelligence_feedback` (`feedback_type` ∈ `dismissed`/`not_useful`/`false_positive`, `object_type='recommendation'`) | `canonicalIntelligenceStore.recordFeedback` via `POST /runtime/feedback` |
| **Evaluation (prediction)** | Did a specific prediction come true | `intelligence_feedback` (`object_type='oyi_prediction'`) | `outcomeEvaluation.ts::persistOutcome` |
| **Learning Proposal** | A computed adjustment awaiting review | `oyi_learning_parameters.proposed_value` | `learningProposalPass.ts` (pre-existing, Programme 4) |
| **Learning Parameter** | A named, bounded, staged tunable | `oyi_learning_parameters` | `learningParameters.ts` |
| **Promotion** | An explicit, human-approved stage advance (only `→enabled` moves `proposed_value → current_value`) | `oyi_learning_parameters` + `oyi_learning_parameter_promotions` (append-only) | `promoteLearningParameter` |
| **Adaptation** | The *consumption* of a promoted parameter — presently, advisory-text calibration only | in-memory, per-call | `predictionProviders.ts::applyCalibration` |

Each of these **never** means: permission grant, financial authority, safety constraint, or a claim of causation (every evaluator carries an explicit `causalNote`/`CAUSAL_NOTE` disclaiming causal proof — the "causal ceiling").

## 5. Execution / outcome separation

Confirmed by direct read of `goalEvaluator.ts::executeStep`: the Wave 8 Slice 1 evaluation call is additive-only, wrapped in `try/catch` that swallows all errors, placed strictly *after* `ok`/`detail`/`needsHuman` are already computed and returned unconditionally below it. An evaluator failure can never affect execution result. Workflow `status` (`oyi_goals`) and outcome (`intelligence_feedback`) are two disjoint tables written by two disjoint code paths — no shared write, no shared column.

## 6. Goal workflow / outcome separation

`deriveGoalOutcome`/`deriveGoalOutcomesBatch` (`goalOutcomeEvaluator.ts`) are pure, read-only, on-demand functions. **Verified: zero callers anywhere in `src/` outside the file's own internal batch→single fallback and the Slice 1–6 test scripts.** No route, scheduler, or `goalEvaluator.ts`/`GoalRuntime.ts` call site invokes Goal-level outcome derivation. `goalEvaluator.ts`'s own diff (+40 lines) is scoped entirely to the device-outcome-evaluator side-call described in §5 — zero lines touch `status`/workflow logic. This is honestly disclosed in the Slice 3 and Slice 6 docs as "capability before producer."

## 7. Per-domain outcome authority audit

- **Device** (Slice 1, `deviceOutcomeEvaluator.ts`): the only domain with a **live automatic caller** — invoked inline by `goalEvaluator.ts` after every `device.on`/`device.off` dispatch. Application-level idempotency (`existingByObjectId` pre-check), frozen/not refactored onto Slice 6's shared helper by design.
- **Camera** (Slice 6, `cameraOutcomeEvaluator.ts`): reads only `resolveCameraCurrentStates` (CameraCurrentStateAuthority) — never `facility_cameras.status`/`camera_infrastructure.health_state`/legacy event strings directly. Preserves the frozen Wave 6 semantic ceiling verbatim (`healthy` = "sufficient fresh acquisition evidence," never "physically powered/recorder healthy"). Verified batching: one `resolveCameraCurrentStates` call per estate, not per camera.
- **Maintenance** (Slice 6, `maintenanceOutcomeEvaluator.ts`): see §9 for the integrity gate. Correctly has no `not_achieved` case (no schema column represents an explicit resident rejection — confirmed by direct schema read) — absence of verification is honestly `unverified`, never fabricated as failure.
- **Visitor** (Slice 6, `visitorOutcomeEvaluator.ts`): `visitor_analytics.arrived_at` (durable, set once by `markEntry`, never cleared by `markExit`) is the primary evidence; a later `exited` status never erases an earlier `achieved` verdict. Falls back to `visitor_access.status` only when the analytics row is missing.
- **Commercial** (Slice 4, `commercialOutcomeEvaluator.ts`): read-only, pure function — never writes to either repository. Reduction rule mirrors Office's own real `commercialStageOrder.ts` ordinal, never an independently invented Backend ordering. Historical achievement (`stagesEverReached`) survives a later `lost` terminal state.

All four persisted evaluators (device/camera/maintenance/visitor) share the invariant: fresh, independently re-queried evidence only, never inferred from reply/sentiment/workflow completion.

## 8. Office migration status

`db/20260925120000_proposals_opportunity_id.sql`: `alter table proposals add column if not exists opportunity_id uuid references crm_opportunities(id) on delete set null` + an index. Nullable, additive, `IF NOT EXISTS`-guarded, zero backfill (historical proposals stay honestly `NULL`). **Not yet applied to any database** — local-only, unpushed, undeployed, matching Backend's own posture. Classification: safe to apply at deploy time; carries no destructive risk.

## 9. Maintenance integrity gate — reconfirmed, not fixed

Re-read `maintenance.controller.ts::updateMaintenance` directly (lines 449–524) at current HEAD. Confirmed exactly as disclosed: `verified_by_resident` is destructured from the request body and folded into the same `patch` object as `status`/`completion_summary` (line 476–486). When `status` is present, `transitionMaintenanceStatus` CAS-guards only the `status` column's own transition — no precondition exists anywhere on `completed_at`. When `status` is **absent** from the request, execution falls straight to the unconditional `supabaseAdmin...update({...patch, updated_at: now}).eq("id", id)` at line 521 — meaning a caller can `PATCH {verified_by_resident: true}` alone, with zero CAS, zero completion precondition, at any time. **The gap is real, present, and unmodified by this audit**, per instruction. `maintenanceOutcomeEvaluator.ts` mitigates it at read time only (`hasValidCompletionSequence`), which is verified in §7.

**Classification: B — PRE-DEPLOYMENT-ADJACENT, NOT A WAVE 8 BLOCKER.** The read-time defensive check makes the learning/outcome system itself trustworthy today without the fix. Closing the write-path gap (a real CAS precondition or a dedicated resident-confirmation route mirroring `transitionVisitorAccessStatus`) is recommended as a near-term follow-up but does not block Wave 8 closure, since Wave 8 built no automatic learning on top of the untrustworthy state — the evaluator's own integrity gate prevents that.

## 10. Outcome persistence, feedback idempotency, outcome identity

Shared helper `outcomeFeedbackPersistence.ts::persistOutcomeEvaluations` (camera/maintenance/visitor) and `deviceOutcomeEvaluator.ts`'s own analogous inline logic (frozen, Slice 1) both: pre-check existing rows by `object_id`, batch-insert the rest, and on a genuine concurrent `23505` fall back to per-row inserts tolerating their own `23505`. All four persisted evaluators + `outcomeEvaluation.ts` (predictions) share **one real DB-level partial unique index** — `idx_intelligence_feedback_outcome_evaluation_identity` on `(object_type, object_id, feedback_type) WHERE feedback_type='outcome_evaluation'` (Slice 5's migration, reused with zero new migrations by Slice 6).

**Design correction verified as load-bearing and correct**: camera/maintenance/visitor evaluators fold the evidence key directly into `object_id` (`objectIdFor(lineage, evidenceKey)`), because the index has no separate evidence column — this is what lets a genuinely repeated evaluation of the same target get a new row (historical preservation) while an exact-duplicate re-insert of identical evidence still collides (idempotency). Re-verified against **real Postgres** this pass (SQL smoke, §12): same-evidence insert twice → 23505 on the second; different-evidence for the same target → 2 independent rows; concurrent identical-evidence race → exactly 1 survivor; cross-domain (camera/maintenance/visitor sharing a lineage string) → 3 independent rows, never collide.

## 11. Causal ceiling

Every evaluator (device, camera, maintenance, visitor, commercial) carries its own explicit causal-disclaimer string, verified present in each file read this pass. None claims a Decision/Goal action *caused* the observed state — only that the state currently satisfies (or doesn't) the named target.

## 12. Decision → Goal → Outcome / commercial lineage

`GoalOutcomeEvidenceRef`/lineage objects carry `decisionId`/`goalId`/`canonicalSignalKey` pointers, never copied blobs. `findDecisionIdForGoal` is a pure read (`oyi_decisions.id` by `goal_id`), never a mutation. Commercial lineage: `deriveCommercialGoalOutcome`/batch path fetches via `fetchOfficeOpportunitySnapshots` (2 Office HTTP calls total regardless of Goal count — verified: `GET .../crm/opportunities` + `GET .../crm/activities`), Office remains the sole authority for stage truth.

## 13. Learning infrastructure, governance, safety

`learningParameters.ts` re-read in full this pass. Governance is enforced **in code**, not convention: `FORBIDDEN_NAME_PATTERN` regex blocks any parameter name touching permissions/RLS/access-control/financial-authority/security-policy/safety-constraint/allowed-action-type/risk-class/authority, checked in `assertLearnableParameter` on every read/propose/promote/rollback call. `ALLOWED_NAME_PREFIXES` is an explicit whitelist (`anomaly.` / `prediction.` / `forecast.` / `recommendation.` / `ranking.` / `notification.cooldown.` / `notification.suppression.`).

**Only transition to `enabled`** (the one stage that moves `proposed_value → current_value`) requires a named `approver` — refused outright without one. CAS is real: `expectedVersion`/`expectedStage` repeated verbatim in the UPDATE's WHERE clause; a stale caller is told `stale`; a genuine retry of an already-applied transition is detected via a **sound** fact (a promotion-history row with matching `version_before` + `to_stage` — provably unique per version, not a shape-heuristic on current state, which the Slice 5 design deliberately corrected away from — see Errors and Fixes in prior session record).

**Verified this pass: `promoteLearningParameter`/`rollbackLearningParameter` have zero live callers anywhere in `src/routes/`** — no HTTP route wires promotion today. The only real automatic pipeline is the pre-existing (Programme 4, commit `0fb9b9f`, untouched by Wave 8) `proactiveIntelligenceScheduler.ts → runLearningProposalPass()`, which **only ever writes `proposed_value`**, confirmed by its own code comment "`promoteLearningParameter` is never imported or called here" and independently confirmed by grep. Promotion today is a fully governed, human-only capability with no live trigger at all — an honest, disclosed state, not a gap.

## 14. Automatic-learning boundaries per domain

- **Device**: automatic evaluation (not learning) — outcome rows are written automatically; no automatic promotion follows.
- **Commercial**: zero automatic anything — read-only evaluator, no persistence, no live Goal producer sets `commercial_target_stage` (confirmed by repo-wide grep — zero matches outside contracts/evaluators/tests).
- **Maintenance/Camera/Visitor**: zero automatic anything — zero live callers of `deriveGoalOutcome`/`Batch` (§6), zero live producers of `camera_id`/`maintenance_request_id`/`visitor_access_id` on any Goal (confirmed by the same grep).
- **Dismissal**: `intelligence_feedback` rows recorded via `POST /runtime/feedback`, feeding `getRecommendationDismissalEvidence`/pattern queries — read-only surfacing, no automatic parameter mutation found downstream of it in this codebase.

## 15. Evaluator dispatch — structured-only, confirmed

Re-read `deriveGoalOutcome`'s dispatch chain in full: device steps first (plan-step `action_type==="device_action"` + `action_id` literal check) → `opportunity_id && commercial_target_stage` presence → `camera_id` presence → `maintenance_request_id` presence → `visitor_access_id` presence → `no_evaluator_available`. Every check is a plain field-presence/literal-equality test. **No free-text inspection, no LLM classification, no keyword matching anywhere in the dispatch path.**

## 16. Multi-domain outcome matrix

| Domain | Evaluator exists | Persists outcome | Live automatic caller | Live Goal producer |
|---|:-:|:-:|:-:|:-:|
| Device | Yes (Slice 1) | Yes | **Yes** (inline post-dispatch) | Yes (existing device steps) |
| Camera | Yes (Slice 6) | Yes | No | No |
| Maintenance | Yes (Slice 6) | Yes | No | No |
| Visitor | Yes (Slice 6) | Yes | No | No |
| Commercial | Yes (Slice 4) | No (read-only) | No | No |
| Communication | No | — | — | — |
| Facility Automation | No | — | — | — |
| Consumer Automation | No | — | — | — |

## 17. Duplicate-authority search

**Outcome authority**: `intelligence_feedback` is written from exactly 6 real writers — the 4 new/existing outcome evaluators, `outcomeEvaluation.ts` (predictions), `recommendationDismissalEvidence.ts`'s sibling dismissal writer, and the generic `canonicalIntelligenceStore.recordFeedback`. **Finding (pre-existing, not Wave 8-introduced)**: `POST /runtime/feedback` (`src/routes/oyiRoutes.ts:147`, last touched Wave 6F.1, commit `bb30321`) accepts caller-supplied `object_type`/`feedback_type`/`outcome` with only `requireAuth` gating — an authenticated caller could in principle submit a row under `feedback_type='outcome_evaluation'`. This is a genuinely adjacent, pre-existing surface, not a Wave 8 regression: Wave 8 added no new route, and exploiting it would require the caller to construct the exact evidence-scoped `object_id` string the relevant evaluator would have produced to actually collide with or masquerade as real evidence. Classified under §18 bucket **H (pre-existing, out of Wave 8 scope)** — noted for future hardening, not a Wave 8 blocker.

**Learning authority**: only `learningParameters.ts` writes `oyi_learning_parameters`/`oyi_learning_parameter_promotions`. No second promotion/enable pathway exists (confirmed by grep for `current_value` writers outside `learningParameters.ts`/`predictionProviders.ts` — the one other match, `learningProposalPass.ts`, is explanatory comment text, not a write).

**Outcome vs. satisfaction**: dismissal feedback (`object_type='recommendation'`, `feedback_type` ∈ dismissed/not_useful/false_positive) and outcome feedback (`object_type` ∈ device/camera/maintenance/visitor/prediction-specific, `feedback_type='outcome_evaluation'`) occupy fully disjoint `(object_type, feedback_type)` space — verified by direct read of `recommendationDismissalEvidence.ts`. No collision, no shared reduction logic.

## 18. Wave 5/6/7 freeze reconfirmation

`goalEvaluator.ts`'s only diff is the additive, error-swallowed Slice 1 hook (§5). `GoalRuntime.ts`, `goalScheduler.ts`, `cameraCurrentStateAuthority.ts`, `visitorAccessTransition.ts`, `maintenance.controller.ts`'s CAS logic, and every Wave 5/6/7 authority module show **zero diff** in `origin/main..HEAD` (confirmed by the file-change list in §2 — none of those files appear). Representative regression (§19) exercises Wave 6 camera-state and Wave 6 Slice 11 maintenance-CAS paths transitively through the Slice 6 evaluators and passes clean.

## 19. Migration inventory & chain

One new migration: `20260926090000_wave8_slice5_learning_parameter_governance.sql` — adds `idx_intelligence_feedback_outcome_evaluation_identity` (partial unique index, additive) and `oyi_learning_parameter_promotions` (new table, additive). No destructive operation. Ordering confirmed: sorts correctly after `20260925100000_wave7_slice5_canonical_decision.sql`, before nothing (latest). **Timestamp uniqueness confirmed** — `ls | grep -oE '^[0-9]{14}' | sort | uniq -d` returns empty. The five pre-existing `LOCAL_TEST` migrations remain untracked/local-only, correctly excluded from this ledger (not part of Wave 8, protected noise per established convention).

## 20. Full regression — this pass

Re-ran from current HEAD (not reused from a prior session):
- `npm run typecheck` → **exit 0**
- `npm run build` → **exit 0**
- All 11 Wave 8 Slice 1–6 smoke scripts (functional + real-Postgres SQL smokes) → **11/11 exit 0**, zero `^FAIL` lines in the combined log, explicit pass-counts where the script reports them (4, 7, 5, 10, 9 — all present, all correct for their own known scenario counts).
- Office: `npm run check` → exit 0, `npm run lint` → exit 0, `npm run build` → exit 0 (18 runtime assets validated), `npm run security:secrets` → PASS.

**Zero failures anywhere.**

## 21. Performance & observability

No N+1 identified: camera evaluator batches per-estate (2 Supabase reads per estate regardless of camera count, confirmed by direct read); commercial evaluator batches Office calls to exactly 2 regardless of Goal count; `persistOutcomeEvaluations` batches the existing-row pre-check and the insert. No polling loop, no busy-wait introduced. Metric labels (`operationalMetrics.increment` calls) use only low-cardinality dimensions (`result`, `provenance`, `state`) — never raw IDs, confirmed by reading every `increment(...)` call site touched by this diff.

## 22. Historical integrity

Confirmed by the real-Postgres SQL smokes (§10, §20): an earlier `achieved` evidence row is never overwritten by a later `contradicted` one — both survive as distinct rows, keyed by evidence-scoped `object_id`. `visitor_analytics.arrived_at` survives a later `exited` status (§7). Commercial `stagesEverReached` survives a later `lost` terminal state (§7).

## 23. Classification of every remaining finding

1. **Maintenance write-path integrity gap** (§9) → **Bucket B: pre-deployment-adjacent, not a Wave 8 blocker** (mitigated at read time; write-path fix recommended as follow-up work, not required for this closure).
2. **`POST /runtime/feedback` generic write surface** (§17) → **Bucket H: pre-existing, out of Wave 8 scope** (predates Wave 8 by two waves, unmodified by this diff; noted for future hardening).
3. **Promotion/rollback have zero live HTTP callers** (§13) → **Bucket C: disclosed, intentional current state** (governed capability awaiting a future admin surface — not a defect, matches the programme's established "capability before producer" pattern already used for camera/maintenance/visitor/commercial).

No finding in this pass falls into "vague gap," "unclassified," or any bucket implying unaddressed risk to what Wave 8 itself shipped.

## 24. Verdict

**COMPLETE.**

Every claim made in the Slice 1–6 completion reports was re-derived from current source, not merely re-cited, and holds. Secret hygiene is clean in both repositories. The full regression battery (typecheck, build, 11/11 smokes, Office check/lint/build/secrets) passes with zero failures at the exact audited HEADs. The one known integrity gap (maintenance write path) is real, disclosed, deliberately not fixed per instruction, and does not undermine anything Wave 8 built because the affected evaluator defends against it at read time. No duplicate outcome or learning authority exists inside Wave 8's own surface; the one adjacent pre-existing surface (`/runtime/feedback`) predates this wave and is out of scope. Nothing here blocks publishing Backend's 6 unpublished commits and Office's 1 unpublished commit, and applying the two additive migrations (Backend Slice 5, Office `proposals.opportunity_id`), when a human authorizes that release.

**Wave 9 may begin only after Wave 8's commits are published and its migrations are deployed** — not before, and not as part of this audit. No Wave 9 work was started.

---

*This document is intentionally left uncommitted, per the audit's own read-only mandate.*
