# Wave 8 — Outcome & Learning Convergence — Slice 6: Camera / Maintenance / Visitor Outcome Evaluators

Status: COMPLETE (Camera, Visitor — full evaluators). Maintenance — COMPLETE WITH A DISCLOSED, DEFENDED-AGAINST INTEGRITY GAP (see §10-12). Baseline: Backend HEAD `8d741d7` (Wave 8 Slice 5), Office HEAD `c08cb92`, unchanged. No migration — this slice reuses Slice 5's own real partial unique index (`idx_intelligence_feedback_outcome_evaluation_identity`) verbatim; every table it reads (`facility_cameras`, `edge_nodes`, `maintenance_requests`, `visitor_access`, `visitor_analytics`) already exists, unmodified.

**This is the final implementation slice of Wave 8.**

## 1. Shared evaluator architecture

Reused, not reinvented: `cameraOutcomeEvaluator.ts`, `maintenanceOutcomeEvaluator.ts`, and `visitorOutcomeEvaluator.ts` all mirror Slice 1's own proven shape (`deviceOutcomeEvaluator.ts`) — a lineage type, a result taxonomy, a stable-but-evidence-scoped `objectIdFor()`, an `evidenceKeyFor()`, a batched `evaluate*Outcomes(inputs)` entry point, a single-item convenience wrapper, an explicit `CAUSAL_NOTE`. What is genuinely shared as code (Section 3's own explicit instruction — "avoid copy/pasting three domain-specific evaluator frameworks... but do not create an over-generalized abstraction if domain semantics genuinely differ") is exactly the mechanical persistence plumbing — a new `src/oyi-core/domains/intelligence/outcomeFeedbackPersistence.ts::persistOutcomeEvaluations()` helper (check existing rows by evidence-scoped object_id, batch-insert the rest, fall back to per-row inserts only on a genuine concurrent 23505) — used by all three new evaluators (and NOT retrofitted onto Slice 1's own frozen device evaluator, which keeps its own established, already-accepted pattern unchanged). Domain semantics — what counts as a target, what counts as achieved evidence, what the causal ceiling says — stay fully separate in each file, because they are genuinely different: camera acquisition, resident confirmation, and visitor entry are three unrelated facts owned by three unrelated authorities.

## 2. A genuine design correction made during this slice

Initially, `objectIdFor()` in all three evaluators (mirroring Slice 1's own stable, lineage-only identity) did NOT include the evidence key. Building the real-Postgres proof surfaced a genuine bug: Slice 5's partial unique index constrains `(object_type, object_id, feedback_type)` with **no separate evidence column** — it was built for `outcomeEvaluation.ts`'s own predictions, which are evaluated **exactly once, ever**, by construction. Camera/maintenance/visitor targets are legitimately **re-evaluated many times** over their lifetime (that is the entire point of Section 9's historical-preservation requirement). Reusing Slice 5's index with a evidence-independent object_id would have silently collapsed every later evaluation of the same target into the first one ever recorded — a real, would-have-shipped correctness bug, caught by the real-Postgres smoke before any code was committed. **Fix**: the evidence key is folded directly into `object_id` for all three new evaluators (e.g. `camera:<id>:target:healthy_acquisition:<lineage>:at:<observedAt>`). This makes the SAME real index do both jobs correctly at once: a genuine re-insert of the exact same evidence collides (real idempotency), while genuinely new evidence gets its own object_id and its own row (real history) — proven in both the functional smoke (in-memory) and the SQL smoke (real Postgres, including a genuine concurrent-race proof).

## 3. Camera authority

`CameraCurrentStateAuthority` (`src/modules/cameras/cameraCurrentStateAuthority.ts`) only, via its real batch entry point `resolveCameraCurrentStates(estateId, cameraIds, actor, options)` — one estate, up to 100 explicit camera IDs, exactly 2 Supabase reads (`facility_cameras`, `edge_nodes`) regardless of batch size. Uses the same system-actor precedent already established in this codebase (`cameraHealthTransition.service.ts:13`): `{ id: "camera-outcome-evaluator", role: "system_admin" }`. Confirmed by direct read: never touches `facility_cameras.status`, `camera_infrastructure.health_state`, legacy event strings, go2rtc configuration alone, or Edge availability alone — the authority itself only reads `runtime_observations` (structured Wave 6 evidence) plus the bound Edge node's own current-state read. `cameraHealth.ts`'s deprecated `canonicalCameraHealth()` is never imported.

## 4. Camera outcome semantics

`overall === "healthy"` → achieved: the frozen meaning (`docs/WAVE6_SLICE14G_CAMERA_EDGE_FINAL_CHECKPOINT_AUDIT.md`): "sufficient fresh acquisition evidence with no interpreted impairment" — never "camera physically powered, recorder healthy, AI inference healthy, or ONVIF control healthy." `overall === "degraded"` or `"unavailable"` → contradicted, with the top-level result never overclaiming: `notes` explicitly distinguishes "usable evidence with supported impairment" (degraded) from "acquisition capability failure, never physical/electrical/network camera death" (unavailable) — the frozen ceiling is preserved in wording, not just in the coarse result. `overall === "unknown"` → unverified: "insufficient current evidence," never a fabricated failure.

## 5. Camera target contract

One new additive field: `GoalTargetEntities.camera_id?: string | null`. No separate target-state field was added — the ONE supported camera objective ("restore trustworthy video acquisition," i.e. `overall === "healthy"`) is implicit whenever `camera_id` is set, mirroring device evaluator's own action-id-implies-target pattern. No migration.

## 6. Camera freshness

Delegated entirely to the authority's own `overall` computation — never reimplemented. The authority's own freshness/staleness classification already determines `overall`, so this evaluator inherits correct behavior by construction rather than duplicating it.

## 7. Edge-expiry behavior

Proven directly (scenario D): an expired Edge heartbeat alone pushes `overall` only to `"degraded"` (mapped to `contradicted`), **never** to `"unavailable"` — the authority's own code explicitly tags this with reason `"edge_telemetry_impaired_not_physical_camera_offline"`, surfaced verbatim in the persisted evaluation's `reasons` array. The frozen Wave 6 invariant (Edge telemetry expiry ≠ camera physically failed ≠ camera outcome not achieved) is preserved by construction, not reimplemented.

## 8. Camera historical preservation

Proven (scenario E, functional + real-Postgres): an intermediate `achieved` evaluation and a later `contradicted` evaluation for the SAME camera/target both persist as distinct rows — the DB's own real unique index (with evidence folded into object_id, §2) makes this a structural guarantee, not an application convention that could be silently bypassed.

## 9. Maintenance authority

`maintenance_requests` re-audited directly against source (`maintenance.controller.ts`), confirming the Slice 0 finding is still exactly accurate: `completed_at` (staff says done), `verified_at` (a separate staff-side technical-verification step, set only when `status` transitions to `"verified"`), and `verified_by_resident` (boolean, the resident's own confirmation) are three genuinely separate columns. `verified_by_resident` — never `status=completed` alone — is the strongest factual authority this evaluator uses.

## 10. Maintenance outcome semantics

`status="completed"` (work completed) is explicitly NOT equated with "issue resolved" (scenario F). `verified_at` (technical verification) and `resident_rating`/`resident_feedback` (subjective satisfaction) are both structurally excluded from this evaluator's SELECT and from its reduction logic (scenario H proves `resident_rating` is never read). Only `verified_by_resident=true`, subject to the integrity check below, produces `achieved`.

## 11. Maintenance sequencing integrity — audited, real gap confirmed, defended against

Re-audited directly against `maintenance.controller.ts::updateMaintenance` (the ONLY write path for `verified_by_resident`): the field is folded into the same unconditional PATCH body as `status`/`completion_summary`/etc, with **zero server-side precondition** that `status` (or `completed_at`) ever reached `"completed"` first. The Wave 6 Slice 11 CAS (`transitionMaintenanceStatus`) only guards the `status` column's OWN transition — it does not gate sibling fields in the same patch. Confirmed via the real-Postgres smoke: a row with `completed_at=NULL, verified_by_resident=true` is a legal row in this schema today. **This is exactly the Section 12 "STOP at integrity gate" condition** — resolved not by refusing to build a maintenance evaluator, but by the evaluator **defending itself**: `hasValidCompletionSequence(row)` requires `completed_at IS NOT NULL` before trusting `verified_by_resident=true`; a row that fails this check is honestly reported `unverified`, never `achieved` (proven directly, "Integrity gate" scenario). **The disclosed, un-fixed prerequisite**, per the task's own "report the narrow prerequisite" instruction: a real server-side CAS precondition in `updateMaintenance` (or a dedicated resident-confirmation route mirroring `transitionVisitorAccessStatus`'s own CAS shape) requiring `existing.status === "completed"` before accepting `verified_by_resident=true`. This was NOT built in this slice (out of scope — a write-path change to a shared, heavily-used controller, not a narrow evaluator addition) but is now precisely specified for a future slice.

## 12. Maintenance target

One new additive field: `GoalTargetEntities.maintenance_request_id?: string | null`. Identifies the request structurally; never inferred from title/prose. No migration.

## 13. Maintenance negative-outcome behavior

Confirmed by direct schema read: no column represents an explicit resident rejection/"unresolved" confirmation distinct from the default-false `verified_by_resident`. `blocking_reason` exists but its exact semantics (operational blocker vs. resident-authored rejection) were not confirmed with certainty, so it was deliberately NOT used as negative evidence (no invention). Result: `MaintenanceOutcomeResult` has no `not_achieved` case at all — only `"achieved" | "unverified"` — proven directly (scenario I): absence of verification, or any non-"completed" status, is always `unverified`, never fabricated as failure.

## 14. Visitor authority

The real, CAS-guarded Wave 6 Slice 11 lifecycle: `transitionVisitorAccessStatus(id, fromAny, to)` (`src/services/visitorAccessTransition.ts`) — a genuine `UPDATE ... WHERE id=? AND status IN (fromAny)` compare-and-swap, confirmed as the sole write path for `visitor_access.status` transitions. `entered` is only reachable from `"approved"`; `exited` only from `"entered"` (both confirmed in `visitorController.ts`). No write access from this evaluator anywhere.

## 15. Visitor outcome semantics

Exactly one supported objective: "authorized visitor successfully entered." `approved` = authorization only, not an outcome (scenario K: `unverified`, still possible). `entered`/`exited` = factual lifecycle outcome — entry is what the target asks about; exiting later does not undo it (scenario M). `denied`/`expired` establish `not_achieved` **only** when no entry evidence exists at all (scenario N) — a real, structural guarantee here, not a heuristic: the CAS preconditions above make "denied/expired AFTER a real entry" impossible by construction, so this ordering concern the task raised is provably moot in this codebase.

## 16. Visitor target identity

One new additive field: `GoalTargetEntities.visitor_access_id?: string | null`. The canonical `visitor_access.id`, never inferred from name/phone/gate-code/conversation text. No migration.

## 17. Visitor historical preservation

`visitor_analytics.arrived_at` — a separate, durably-timestamped column written once by `markEntry` and never cleared by `markExit` (confirmed by direct read of `visitorController.ts`) — is the PRIMARY achieved-evidence source, more defensible than the current `status` enum alone. Falls back to `status IN ('entered','exited')` only when the analytics row itself is missing (a disclosed, weaker-but-real secondary source). Proven both functionally and against real Postgres (§8 pattern applied to the visitor domain): entry at T1 survives exit at T2.

## 18. Goal target contract additions

Three new, additive, optional fields on `GoalTargetEntities` (`src/contracts/goal.ts`): `camera_id`, `maintenance_request_id`, `visitor_access_id`. Zero migration — `target_entities` is the same already-extensible jsonb column every prior Slice 4/5/6 field used. No live Decision/Goal producer sets any of the three today (confirmed: no camera/maintenance/visitor Decision producer exists anywhere in this codebase) — exactly matching Slice 4's own "contract built, zero live producers" precedent.

## 19. Goal outcome integration

Zero lines changed in `GoalRuntime.ts`, `goalEvaluator.ts`, or `goalScheduler.ts` (confirmed via `git diff --stat`). Workflow status and outcome state remain fully separate, exactly as Slice 3 established — this slice only extends `goalOutcomeEvaluator.ts`'s own dispatch, never touches workflow lifecycle.

## 20. Evaluator dispatch

Structured only (Section 21): `deriveGoalOutcome()`'s device-less branch checks, in order, `opportunity_id`+`commercial_target_stage` (Slice 4, unchanged), then `camera_id`, then `maintenance_request_id`, then `visitor_access_id` — each a plain identity-field presence test. No free-text objective inspection, no LLM classification, anywhere in this dispatch. `deriveGoalOutcomesBatch()` partitions goals into 5 mutually-exclusive domain groups (commercial/camera/maintenance/visitor/other) and issues exactly one batched evaluator call per domain present in the batch — proven at 1/10/50/100 camera Goals in the same estate: exactly 1 `facility_cameras` read regardless of N (§29).

## 21. Persistence

`intelligence_feedback` only — no new table. `object_type` values `camera_state_outcome`, `maintenance_outcome`, `visitor_outcome`; `feedback_type: "outcome_evaluation"` shared with Slice 5's own prediction-outcome rows, deliberately, to reuse the exact same real unique index (see §2). Object_type differentiates every domain under that one shared, already-proven constraint — no collision risk, proven directly (functional + real-Postgres: the identical lineage-suffix string used across 3 different object_types yields 3 independent rows).

## 22/23. Feedback identity / idempotency

Concurrent identical evaluations produce exactly one row (proven via a genuine concurrent double-insert race against real Postgres — one of the two racing inserts always fails with 23505, exactly one row survives). Genuinely different evidence for the same target produces genuinely distinct rows (§2/§8).

## 24. Factual-vs-subjective separation

Maintained explicitly throughout: camera current-state evaluation (factual system evidence), maintenance `verified_by_resident` (factual human confirmation, subject to the disclosed integrity check), visitor `entered` (factual lifecycle evidence) are all kept structurally separate from `resident_rating` (subjective, never read) and Slice 2's own dismissal feedback (subjective, untouched, different `object_type`/`feedback_type` entirely).

## 25. Decision lineage

Preserved where it exists (`decisionId` passed through lineage when a real Decision links to the Goal); never fabricated. Confirmed by direct grep: no live Decision producer exists for camera, maintenance, or visitor domains today (`docs/WAVE8_OUTCOME_LEARNING_AUTHORITY_AUDIT.md`'s own domain matrix already classified Maintenance as `DOMAIN_SPECIFIC, no Decision link`; Camera/Visitor confirmed the same by this slice's own research).

## 26. Producer-adoption disposition

Evaluator capability only, exactly as instructed — no Camera/Maintenance/Visitor Decision producer was built or even sketched. `deriveGoalOutcomesBatch`'s batch-mode camera/maintenance/visitor lineage deliberately omits the per-goal decisionId lookup (uses `null`, matching the honest "no live producer sets this yet" reality) to avoid reintroducing an N+1 query for a lookup that would always return null today — a disclosed, zero-behavioral-impact simplification, not a capability gap.

## 27. Camera scenarios A-E

All proven (functional + a subset against real Postgres): A (healthy+healthy→achieved), B (healthy target+degraded authority→contradicted, reasons preserved), C (unknown→unverified), D (Edge-expiry-alone→degraded not unavailable, never fabricated failure), E (historical achieved survives later contradicted, both rows real).

## 28. Maintenance scenarios F-J

All proven: F (completed status alone→not achieved), G (verified_by_resident=true with valid completed_at→achieved), H (resident_rating never read), I (no negative authority exists→never not_achieved), J (no evidence→unverified). Plus the disclosed integrity-gate scenario (verified_by_resident=true without completed_at→unverified, defended against).

## 29. Visitor scenarios K-O

All proven: K (approved only→unverified), L (entered→achieved), M (entered then exited→historical achieved), N (denied/expired before entry→not_achieved, both sub-cases), O (unknown/missing→unverified).

## 30. Cross-domain scenarios P-T

All proven: P (one shared GoalOutcome interface, provenance/sub-object never flattened across camera/maintenance/visitor/commercial), Q (one domain's evidence never satisfies another domain's Goal — a healthy camera has zero bearing on a maintenance Goal for the "same" id), R (zero physical/provider side effects — source-grep proof), S (zero learning-parameter references), T (zero Decision/Goal history writes).

## 31. Causal ceiling

Each evaluator carries its own explicit `CAUSAL_NOTE`, mirroring Slice 1/4's own established pattern: observed target satisfaction is never claimed to prove any Decision/Goal action caused it.

## 32. Performance

Camera: exactly 2 Supabase reads per estate per batch (inherited from `resolveCameraCurrentStates`'s own batching), proven flat at 1/10/50/100 Goals. Maintenance/Visitor: one batched `IN (...)` read per table per call, regardless of N. No provider polling anywhere — confirmed by source-grep (scenario R).

## 33. Observability

`oyi_camera_outcome_evaluation_total{result, provenance}`, `oyi_maintenance_outcome_evaluation_total{result, provenance}`, `oyi_visitor_outcome_evaluation_total{result, provenance}` — low-cardinality labels only (result/provenance enums), no camera/request/visitor IDs in any metric label.

## 34. Same-class search

| Location | What it does | Classification |
|---|---|---|
| `cameraOutcomeEvaluator.ts` (this slice) | Compares camera target vs. `CameraCurrentStateAuthority` | CANONICAL_EVALUATION (new) |
| `maintenanceOutcomeEvaluator.ts` (this slice) | Compares maintenance target vs. `verified_by_resident` + integrity check | CANONICAL_EVALUATION (new) |
| `visitorOutcomeEvaluator.ts` (this slice) | Compares visitor target vs. lifecycle/analytics evidence | CANONICAL_EVALUATION (new) |
| `commandRouter.ts`'s camera entity projection (`health_status`, `current_state`) | Surfaces raw camera fields for display/command routing | DOMAIN_SPECIFIC — a projection, never an outcome claim |
| `facilityVisitors.controller.ts`'s timeline `"approved"` push | Displays the real status in a human-readable timeline | WORKFLOW_ONLY — describes lifecycle, claims no objective achievement |
| `maintenance.controller.ts`'s `status === "completed"` → `lifecycle.completed_at = now` | Records the real completion timestamp | CANONICAL_EVALUATION source (this IS the authority `completed_at` this slice reads) |

No FALSE_OUTCOME_COLLAPSE found anywhere in this search.

## 35. Learning boundary

No parameter changes. None of the three new evaluators reference `oyi_learning_parameters`/`learningParameters.ts` anywhere (proven, scenario S). These new factual outcomes become eligible evidence for a FUTURE, explicitly-governed proposal pass only — no automatic wiring into Slice 5's loop was added or implied.

## 36/37/38. Wave 5/6/7 freeze regression

Representative smokes re-run clean after this slice: `wave5-slice1-facility-automation-device-authority`, `wave4b-slice4-commandrouter-device-command-authority` (Wave 5 physical execution); `wave6-slice2-canonical-awareness`, `wave6-slice13-device-current-state-authority`, `wave6-slice11-visitor-maintenance-transition-safety`, `wave6-slice14a-camera-privacy`, `wave6-slice14d-camera-current-state` (Wave 6 state/awareness/privacy/transition-safety); `wave7-slice5-canonical-decision`, `wave7-slice6-goalruntime-domain-generalization`, `wave7-slice7-lead-opportunity-identity-resolution` (Wave 7 Decision/Goal). See final report for exact counts.

## 39. Wave 8 Slice 1-5 regression

`wave8-slice1-device-state-outcome-evaluator`, `wave8-slice2-recommendation-dismissal-evidence`, `wave8-slice3-goal-outcome-workflow-separation`, `wave8-slice4-commercial-outcome-evaluator`, `wave8-slice5-learning-parameter-consumer` (+ its SQL smoke) all re-run clean — no outcome/learning semantics changed by this slice.

## 40. Real PostgreSQL proof

`scripts/wave8-slice6-remaining-domain-outcome-evaluators-sql-smoke.mjs`, 9/9 passing: same-evidence idempotency (23505 rejection), different-evidence historical preservation, a genuine concurrent double-insert race (exactly one survivor), cross-domain object_type isolation, maintenance factual-state query shape including the confirmed-real integrity gap, visitor lifecycle evidence query shape including historical entry preservation across a real status UPDATE, and the shared index's own existence in `pg_indexes`.

## 41. Files changed

- `src/contracts/goal.ts` — added `camera_id`, `maintenance_request_id`, `visitor_access_id` to `GoalTargetEntities`.
- `src/oyi-core/domains/intelligence/outcomeFeedbackPersistence.ts` (new) — shared persistence helper.
- `src/modules/cameras/cameraOutcomeEvaluator.ts` (new).
- `src/services/maintenanceOutcomeEvaluator.ts` (new).
- `src/services/visitorOutcomeEvaluator.ts` (new).
- `src/services/goalRuntime/goalOutcomeEvaluator.ts` — extended `GoalOutcomeProvenance`/`GoalOutcome`, added 3 new single-Goal dispatch helpers + batch partitioning for camera/maintenance/visitor.
- `scripts/wave8-slice6-remaining-domain-outcome-evaluators-smoke.mjs` (new, 31/31).
- `scripts/wave8-slice6-remaining-domain-outcome-evaluators-sql-smoke.mjs` (new, 9/9).
- `package.json` (2 new script entries).
- `docs/WAVE8_SLICE6_REMAINING_DOMAIN_OUTCOME_EVALUATORS.md` (this file).

`GoalRuntime.ts`, `goalEvaluator.ts`, `goalScheduler.ts`, `deviceOutcomeEvaluator.ts`, `commercialOutcomeEvaluator.ts`, `learningParameters.ts`, `maintenance.controller.ts`, `visitorController.ts`, `cameraCurrentStateAuthority.ts` — zero lines changed.

## 42. Migrations

None. This slice reuses Slice 5's existing partial unique index and every table it reads, unmodified.

## 43. Domain support matrix

| Domain | Evaluator | Trustworthy today | Live Goal producer | Notes |
|---|---|---|---|---|
| Camera | Full | Yes | None yet | Contract built, inert until a producer sets `camera_id` |
| Maintenance | Full, with a self-defended integrity check | Conditionally — only rows passing `hasValidCompletionSequence` | None yet | Server-side prerequisite disclosed in §11, not yet built |
| Visitor | Full | Yes | None yet | Contract built, inert until a producer sets `visitor_access_id` |
| Device | Full (Slice 1) | Yes | None yet | Unchanged |
| Commercial | Full (Slice 4) | Yes | None yet | Unchanged |

## 44. Remaining unsupported domains

Everything outside Device/Camera/Maintenance/Visitor/Commercial remains without an outcome evaluator — communication/Office follow-up Goals still honestly return `no_evaluator_available`, unchanged by this slice.
