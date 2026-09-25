# Wave 7 Slice 2 — Identity-Chain Repair

**Scope authority:** `docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §37, row 2 — "Identity-chain repair: add a nullable `canonical_signal_key`-style back-reference column to `oyi_goals`, and replace `operational_recommendations.recommendation_key`'s positional-index component with a stable derivation." SMALL–MEDIUM weight, no dependencies, Low risk, small additive migration on `oyi_goals`, Frozen systems affected: None.
**Backend HEAD (pre-change):** `08840a7345e16be049de044be158af8645b6f85e` (Wave 7A / Slice 1).
**Type:** Narrow identity/lineage repair. One additive migration. No execution-boundary change. No Decision object. No GoalRuntime generalization.

## Pre-fix identity graph (reconstructed from source, not assumed)

| Object | Table/type | Primary ID | Semantic/dedup key | Source/back-reference | Creation point | Retry behavior |
|---|---|---|---|---|---|---|
| Canonical signal | `operational_signals` | `id` (uuid, RPC-generated) | `canonical_signal_key` = `provider\|source:providerEventId\|id:domain:entityId:estateId\|global:homeId\|no-home` (`materialization.ts:9`) | — (root of the chain) | `oyi_register_materialization` | `on conflict(canonical_signal_key) do nothing`, real, stable, unchanged |
| Incident | `operational_incidents` | `id` (uuid) | `incident_key` (from `correlateIncident`) | signal via `oyi_complete_materialization` | `oyi_complete_materialization` | upsert-by-`incident_key`, ordering-guarded, unchanged |
| Awareness | `operational_awareness` | `id` (scoped uuid) | `awareness_key` = pre-scope `awareness:${signal.id}` (stable, signal-id-derived — **not** positional) | `incident_id` | `oyi_complete_materialization` | `on conflict(awareness_key) do nothing`, unaffected by this slice |
| Insight | `operational_insights` | `id` (scoped uuid, `on conflict(id) do nothing`) | pre-scope id was `insight:${domain}:${entityKey}:${index}` — **positional**, index = post-sort array position (`operationalReasoning.ts:339`, pre-fix) | `incident_id` | `oyi_complete_materialization` | **defective pre-fix**: a sibling severity/confidence change could flip `index`, changing `id`, risking a duplicate insert on retry |
| Recommendation | `operational_recommendations` | `id` (scoped uuid) | `recommendation_key` = pre-scope id `recommendation:${domain}:${insight.id}` (`operationalRecommendations.ts:148`) — **inherits insight's instability** | `incident_id` | `oyi_complete_materialization` | **defective pre-fix**: `on conflict(recommendation_key) do nothing` could silently fail to recognize a retry as the same recommendation |
| Plan | `operational_plans` | `id` (scoped uuid, `on conflict(id) do nothing`) | pre-scope id `automation:${domain}:${recommendation.id}` (`safeAutomation.ts:110`) — **inherits recommendation's instability, transitively** | none (plan row has no `incident_id`) | `oyi_complete_materialization` | same defect class, one hop further downstream |
| Goal | `oyi_goals` | `id` (uuid, `randomUUID()`, app-generated) | none (no canonical dedup key at all) | **none** — confirmed no column referencing any upstream object | `GoalRuntime.create()` | caller-enforced only (`findActiveForLead`), no canonical-signal awareness whatsoever |
| Task (`maintenance_requests`, `automation_approvals`, Office `crm_tasks`) | separate tables | `id` (uuid, `gen_random_uuid()`) | none needed — DB-generated at write time, never JS-string-derived | domain-specific, out of this slice's scope | various | `SAFE_STABLE` by construction (see §19 below) |
| Automation (Consumer `consumer_automations`/`consumer_scenes`) | separate tables | `id` (uuid, `gen_random_uuid()`) | n/a | n/a | n/a | `SAFE_STABLE` by construction |

This table is more exhaustive than the Slice 0 roadmap's one-line summary: the roadmap named `recommendation_key`'s positional component, but the actual defect originates one layer upstream, in `insight.id`, and propagates through two more layers (`recommendation.id`, `plan.id`) via direct string derivation — none of which needed independent fixes once the root was repaired.

## Recommendation-key defect — reproduced, not assumed

**Root cause, precisely located:** `operationalReasoningRuntime.evaluate()` already computes a genuinely stable, semantic dedup key for every insight candidate — `key = \`${domain}:${entityKey}:${lower(reason)}\`` (`operationalReasoning.ts:329`), used to collapse duplicate candidates into a `Map`. But the **final `id`** assigned to each surviving insight discarded that key and instead used `insight:${domain}:${entityKey}:${index}`, where `index` is the array position *after* sorting all surviving insights by `severity` then `confidence` (`operationalReasoning.ts:338-339`, pre-fix). A sibling insight's severity or confidence changing — or a new sibling insight appearing — shifts sort order and therefore `index`, silently changing the id of an otherwise-identical insight between two evaluations of the same underlying signal.

**Live reproduction** (`scripts/wave7-slice2-identity-chain-repair-smoke.mjs`, check 1; `scripts/wave7-slice2-identity-chain-repair-sql-smoke.mjs`, checks 8–9): calling the real, unmodified-elsewhere `OperationalReasoningRuntime.evaluate()` twice with the same device signal but a sibling community signal whose severity differs between the two calls produces two different sort orders — and, pre-fix, two different insight ids for the *same* infrastructure insight (`...device-1:estate-1:0` vs `...device-1:estate-1:1`, proven by stashing the fix, rebuilding, and rerunning both smoke suites — both failed with exactly this diff). Because `recommendation.id = recommendation:${domain}:${insight.id}` (`operationalRecommendations.ts:148`, unchanged) and that value becomes `recommendation_key` at persistence time (`materialization.ts:35`, unchanged), the instability propagated all the way to the column `on conflict(recommendation_key) do nothing` depends on — meaning a retry/re-materialization with a perturbed sibling ordering could, pre-fix, have inserted a **second** row instead of recognizing the first, silently reopening a recommendation a human had already dismissed.

**Retry / re-materialization / crash-recovery / insertion / removal — all tested** (see Node smoke suite): identical signal set evaluated twice → identical ids (retry semantics); a lower-severity sibling inserted without changing the primary insight's rank → no id change (insertion); the SQL smoke's crash-recovery path reuses the exact `oyi_claim_materialization`/`oyi_complete_materialization` machinery Final A already crash-tests (unmodified).

## Stable recommendation identity — design

**Smallest stable derivation, using what the code already computed:** the insight's final `id` now reuses the exact `key` string the `unique` Map already used for semantic deduplication (`insight:${key}` = `insight:${domain}:${entityKey}:${lower(reason)}`), instead of discarding it in favor of `index`. This is not a new hash of free-form prose — `reason` is a **fixed, hardcoded, one-per-domain literal string** in the `reasons` object (e.g. `"Security-related signals show elevated operational exposure."` for every security insight, verbatim, never interpolated with entity-specific data), confirmed by direct read of all 8 domain entries in `operationalReasoning.ts`. Including it in the id costs nothing (it's redundant with `domain` today) and keeps the id formula in lockstep with the dedup key it's drawn from, so a future change to `reason` per domain can't silently desynchronize the two.

`recommendation.id` and `plan.id` needed **zero changes** — both already derive directly from `insight.id`/`recommendation.id` by string interpolation (`operationalRecommendations.ts:148`, `safeAutomation.ts:110`), so stabilizing the root made the whole chain stable transitively. This was verified, not assumed (Node smoke checks: "recommendation.id must still literally be `recommendation:${domain}:${insight.id}`", "plan.id must still literally be `automation:${domain}:${recommendation.id}`").

**Required invariant, proven:** same logical insight/recommendation/plan from the same accepted intelligence → same id regardless of sibling ordering (Node smoke, real-pipeline SQL smoke). Distinct insights/recommendations (different domain or different entity) → distinct ids (collision tests below).

## Collision semantics (§15, tested)

| Scenario | Result | Where proven |
|---|---|---|
| Same recommendation, same signal, reordered siblings | identical id | Node smoke + SQL smoke |
| Same recommendation, same signal, sibling inserted | identical id (when it doesn't change the primary's rank) | Node smoke |
| Same recommendation, retried | identical id | Node smoke + SQL smoke (real `ON CONFLICT`) |
| Same recommendation, after crash recovery | identical id (crash-recovery machinery itself is Final A's, unmodified — re-verified via the existing Final A suite, still 100% passing) | `wave6-final-a-materialization-sql-smoke.mjs` |
| Different recommendation, same signal | distinct ids | Node smoke |
| Same recommendation semantics, different signal (different entity) | distinct ids | Node smoke |
| Same target, same domain, multiple raw signals | collapse to exactly one insight (pre-existing `entityKey`-based Map behavior, unchanged by this slice — now correctly reflected in a stable id instead of an unstable one) | Node smoke |

No new collision was introduced: the `unique` Map's own dedup boundary (`domain:entityKey:reason`, and `reason` is domain-determined) was already the true uniqueness boundary before this slice; the fix only stopped discarding that boundary in favor of a positional artifact.

## Cross-signal semantics decision (§16)

**Decision: two distinct canonical signals for the same domain+entity, evaluated together (i.e. both present in one `evaluate()` call's `signals`/`signalHistory`), converge to one insight — deliberately, and this is pre-existing behavior, not something this slice introduced or chose.** The `unique` Map's dedup key is `domain:entityKey:reason`, with no signal-id component at all; two signals for the same entity within the same reasoning window were already designed to describe one underlying situation, not two. This slice's contribution is only that the *id representing that one situation* is now itself stable — it does not change *whether* two signals converge, only guarantees a converged insight keeps the same identity across re-evaluations. Choosing option B (converge) was not made to reduce row count; it is simply what the existing `entityKey`-based collapse already does, and re-deriving a different choice here would have been an undocumented, out-of-scope behavior change to the reasoning runtime itself.

## Mutable recommendation-state preservation (§5, §13)

The Final A RPC (`oyi_complete_materialization`, unmodified by this slice) already writes every incoming recommendation row via `on conflict(recommendation_key) do nothing` (`20260924112951_wave6_canonical_materialization_durability.sql:135-136`) — a retry that matches an existing key is silently skipped, never overwritten. This slice's fix makes the *key itself* trustworthy; the retry-safety mechanism was already correct. Proven end-to-end with the real pipeline (SQL smoke, checks 12–14): first materialization → `status='dismissed'` set by a human → retry with a **sibling-perturbed** bundle (the exact scenario that could have produced a second row pre-fix) → still exactly one row, `status` still `dismissed`.

## `oyi_goals` schema — before/after

**Before:** `id, correlation_id, requesting_actor_id, surface, conversation_thread_id, organization_scope, objective, target_entities, status, success_condition, stop_condition, reply_branches, plan, current_step_index, schedule, event_conditions, communication_preferences, max_attempts, attempts_completed, observations, evidence, linked_crm_records, linked_tasks, linked_meetings, linked_automations, linked_communication_threads, execution_history, last_evaluated_at, next_evaluation_at, completion_reason, created_at, updated_at`. No column referencing any upstream canonical object.

**After (additive only):** `+ canonical_signal_key text` (nullable, no default, no FK), `+ idx_oyi_goals_canonical_signal_key` (plain btree, partial `where canonical_signal_key is not null`, **not unique** — a signal may legitimately motivate more than one goal over its lifetime, e.g. a cancelled goal followed by a fresh one).

## Migration

`supabase/migrations/20260925090000_wave7_slice2_goal_canonical_signal_lineage.sql`. Additive, nullable, backward-compatible, idempotent (`add column if not exists`, `create index if not exists`), no FK (justified below), no unrelated Decision/Plan schema. Applied and verified against a real, throwaway PostgreSQL database (`wave7-slice2-identity-chain-repair-sql-smoke.mjs`, checks 1–7): clean apply, idempotent reapply, nullable confirmed, non-unique index confirmed, no FK confirmed, real write+read round trip for both a signal-driven and a conversational goal, lineage lookup query confirmed.

**Why no FK, deliberately:** `officeMaterialEventAdapter.ts`'s goal-creation path (`activateDevelopmentRelationshipGoal`) runs `void`-fired (fire-and-forget) **before** `submitCanonicalSignal()` is even called in the same function (`submitOfficeMaterialEventCanonicalSignal`, lines 221-227) — goal creation and canonical-signal materialization are two independent, unordered async write paths with no shared transaction and no guaranteed completion order. A hard FK would make that ordering artifact into an intermittent write failure. The nullable, unconstrained column correctly represents "this is what the goal believes its provenance is," not "this is guaranteed to already exist."

## Write-path propagation (§9) — every `GoalRuntime.create()` caller, classified

Exactly two real callers exist in the entire codebase (confirmed by `grep -rn "goalRuntime.create("`), and the TypeScript compiler now enforces that both supply the new required field explicitly (no silent omission possible):

| Caller | Classification | Disposition |
|---|---|---|
| `officeMaterialEventAdapter.ts:activateDevelopmentRelationshipGoal` (Office material-event → JV relationship goal) | **CAN_DERIVE_CANONICAL_SIGNAL** | Recomputes the *identical* `canonical_signal_key` `submitCanonicalSignal()` will independently produce for the same event, using the real, unmodified `canonicalSignalKey()` function (`materialization.ts`) fed the same `source: "office"`, `providerEventId: event.idempotency_key`, `domain: "office"`, `entity`, and `estateId: null` fields `submitOfficeMaterialEventCanonicalSignal()` itself passes two lines later. Deterministic recomputation of real provenance from the same underlying event — not an inference from timestamp/text/entity similarity. Proven deterministic (same event → same key twice) and non-colliding (different `idempotency_key` → different key) in the Node smoke suite. |
| `ConversationOrchestrator.ts` (`office_internal` conversational goal proposal) | **MUST_REMAIN_NULL** | A human-initiated conversational request has no canonical signal behind it. `canonical_signal_key: null` is now an explicit, deliberate line at the call site (not a passive omission) — verified via the real-Postgres round-trip test. |

No `NO_CANONICAL_SIGNAL` case (a caller that plausibly *could* have one but structurally doesn't) was found beyond the conversational path already covered above.

## Office commercial-goal lineage (§10)

The Office `development_enquiry_received` material event **does** carry everything needed to derive a real canonical signal identity (`event.idempotency_key`, `event.subject.id`/`.label`) — it is persisted. No upstream Office schema change was made or needed; the derivation is entirely client-side (Backend-side), matching the same fields Office already sends today. `developmentJv.ts`, `officeTaskBridgeService.ts`, and Office's own event ingestion are untouched — this slice does not redesign Office event ingestion and does not make goals opportunity-centric (the goal's `target_entities` remains `lead_id`-only, exactly as before; see Slice 0 §17–18's still-open lead/opportunity conflation finding, explicitly out of this slice's scope).

## Recommendation → Goal relationship (§11)

No live path creates a goal from a recommendation — confirmed by an exhaustive grep of every file referencing `goalRuntime.` (6 files total: the two creation call sites, `inboundEventPipeline.ts` and `goalScheduler.ts` which only read/claim goals, and `goalProposal.ts`, a thread-metadata pointer helper). None reference `operational_recommendations` or any recommendation object. No relationship was invented here — per instruction, none exists to preserve, and none was fabricated.

## Plan identity compatibility (§12)

Not converged (correctly out of scope — Slice 0 classified Plan authority as PARALLEL, a later-slice concern). Inspected only enough to confirm the recommendation-key fix doesn't break plan references: `AutomationPlan.id = automation:${domain}:${recommendation.id}` (`safeAutomation.ts:110`) and `sourceRecommendationId: recommendation.id` (`safeAutomation.ts:114`) both derive directly from the now-stable `recommendation.id` — confirmed transitively stable, zero changes needed. `operational_plans` persists via `on conflict(id) do nothing` (unchanged). No positional/index-derived plan identity was found anywhere in `safeAutomation.ts` — this concept had no defect of its own to report to a later slice.

## Final A materialization compatibility (§13)

Proven, not assumed: (1) the existing, unmodified Final A durability suite (`wave6-final-a-materialization-sql-smoke.mjs`, 11 checks — registration/duplicate/claim-fencing/completion, rollback at every table, stable artifact identities, delayed-signal ordering guard, lease crash-recovery, 1/10/50/100-signal bounded batching, service-only RPC privileges, real Core prepared-bundle integration) still passes 100% after this slice's changes; (2) a new, dedicated proof (`wave7-slice2-identity-chain-repair-sql-smoke.mjs`, Part 2) runs the *real* `OperationalReasoningRuntime` → `buildOperationalRecommendations` → `buildAutomationPlans` → `scopeMaterializationIdentities` → `prepareMaterialization` pipeline (every function real, none hand-rolled) with a sibling-perturbed retry scenario, through the real `oyi_register_materialization`/`oyi_claim_materialization`/`oyi_complete_materialization` RPCs against a real, throwaway PostgreSQL database, and confirms: same prepared bundle content → same recommendation identity across the retry; exactly one row survives; prior mutable lifecycle state (`dismissed`) is untouched.

## Historical-row disposition (§14)

**Forward-safe only, no backfill.** Existing `operational_recommendations`/`operational_insights`/`operational_plans` rows keep whatever id/key they were written with — this slice does not rewrite history. New key derivation applies only to newly generated recommendations from this point forward. This is safe because `recommendation_key` participates in dedup only *within* a signal's own materialization lifecycle (via `on conflict`), not as a cross-row join key read by other tables — an old row with an old-format key and a new row with a new-format key coexist without conflict or ambiguity. For `oyi_goals`: every existing row's new `canonical_signal_key` column is `NULL` by default (the migration adds the column with no default value other than SQL `NULL`) — no speculative backfill was performed or considered, exactly as instructed.

## Lineage reads / diagnostics (§17)

No public API response shape was changed. The new `oyi_goals.canonical_signal_key` column is available to any internal/operator diagnostic query today via ordinary `SELECT`/the existing `GoalRuntime.get()`/`listForActor()` (both already `select("*")`, so the field is already present on every `GoalRecord` returned anywhere goals are read) — no new read-path code was required or added. A dedicated lineage lookup (`WHERE canonical_signal_key = ...`) is index-backed and was verified directly against real PostgreSQL.

## End-to-end lineage proof (§18)

`canonical signal → (awareness/incident) → recommendation → [no live goal relationship, confirmed above] → downstream`: fully traced and proven stable end-to-end via the SQL smoke's Part 2 (signal → real reasoning → real recommendation → real materialization → real DB row, retry-safe). Separately, `canonical signal → Office material event → goal` is now a real, provable lineage edge (Node smoke: deterministic derivation) even though no recommendation sits between them for this path — Office's commercial-goal creation is signal-adjacent, not recommendation-derived, confirmed in §11. Lineage genuinely ends at the goal for the Office path (no further downstream object references `oyi_goals.id` back into the canonical chain) and at the recommendation/plan for the Facility/Consumer path (no live goal relationship exists there at all, per §11) — this is stated plainly rather than fabricating a further hop; the future Decision object (Slice 5, not started) is where broader causal ownership across these two lineage endpoints would eventually be unified.

## Same-class identity search (§19)

| Object | Classification | Evidence |
|---|---|---|
| `operational_insights.id` | **POSITIONAL_GAP → FIXED this slice** | `operationalReasoning.ts:339` (pre-fix) — the sole match for a positional-index-in-id pattern found anywhere in `src/oyi-core` (verified by grep across the entire tree; zero other matches) |
| `operational_recommendations.recommendation_key` | **POSITIONAL_GAP → FIXED this slice (transitively)** | derives directly from insight.id |
| `operational_plans.id` | **POSITIONAL_GAP → FIXED this slice (transitively)** | derives directly from recommendation.id |
| `operational_awareness.awareness_key` | **SAFE_STABLE** | `awareness:${signal.id}` — signal.id is a real upstream identity, not positional |
| `oyi_goals.id` | **SAFE_STABLE** (identity) / **had no lineage** (fixed this slice, separately) | `randomUUID()`, app-generated, never positional |
| `maintenance_requests.id`, `automation_approvals.id`, Office `crm_tasks` | **SAFE_STABLE** | `gen_random_uuid()`, DB-generated at write time |
| `consumer_automations.id`, `consumer_scenes.id` | **SAFE_STABLE** | `gen_random_uuid()`, DB-generated at write time |
| `recommendationPlanner.ts`'s ephemeral `dedup_key` (the parallel, never-persisted path — Slice 0 duplicate-authority A) | **EPHEMERAL_BY_DESIGN, OUT_OF_SCOPE** | Never persisted, never conflicts with anything; already disclosed in Slice 0/Slice 1 documentation as a separate, deliberate parallel path, not touched here |

No other positional/index-derived identity exists in the current codebase — the defect this slice repairs was genuinely isolated to one function, confirmed by exhaustive grep, not sampling.

## Wave 5 freeze proof

`git diff --stat` for this slice touches exactly: `package.json`, `src/contracts/goal.ts`, `src/oyi-core/ingress/officeMaterialEventAdapter.ts`, `src/oyi-core/orchestration/ConversationOrchestrator.ts`, `src/oyi-core/runtime/operationalReasoning.ts`, `src/services/goalRuntime/GoalRuntime.ts`, plus new files (two smoke scripts, one migration, this doc). `DeviceCommandAuthority`, `executeDeviceCommandForActor`, the execution ledger, `verification`, and `devices.power.control` are not imported, referenced, or exercised anywhere in this diff. Representative regression: `wave5-slice1-facility-automation-device-authority-smoke.mjs` and `wave4b-slice4-commandrouter-device-command-authority-smoke.mjs` both pass unchanged.

## Wave 6 freeze proof

No factual truth/awareness/current-state authority file was modified. Representative regression, all passing unchanged: `wave6-slice2-canonical-awareness-smoke.mjs`, `oyi-awareness-v3-smoke.mjs`, `oyi-core-convergence-smoke.mjs`, and the full, unmodified Final A durability suite (`wave6-final-a-materialization-sql-smoke.mjs`, 11/11).

## Slice 1 regression

`wave7-slice1-recommendation-authority-smoke.mjs` — 9/9 passing, unchanged. Slice 1's canonical-preference logic reads `recommendation_key` but never writes or derives it; this slice's changes to how that key is *generated* have no effect on Slice 1's read-side behavior, confirmed.

## Office / goal regression (§23)

`goal-runtime-smoke.mjs`, `office-internal-surface-smoke.mjs`: passing. `oyi-office-intelligence-convergence-smoke.mjs`: 2 pre-existing failures reproduced with identical text on the unmodified Slice-1 baseline (already documented in `docs/WAVE7_SLICE1_RECOMMENDATION_READ_UNIFICATION_CONVERGENCE.md`'s "Known/environment failures" section — an idempotency-store assertion unrelated to recommendation/goal identity, not touched or worsened by this slice). The nullable lineage addition does not break legacy/manual goal creation — confirmed directly (`ConversationOrchestrator.ts`'s explicit `null`, real-Postgres round trip).

## Performance (§24)

Stable insight/recommendation/plan identity generation is deterministic, local, in-memory string concatenation — no new DB query, no new network call, replacing one deterministic derivation (positional index) with another (the pre-existing dedup key), same computational cost. Goal lineage persistence is one additional column on an existing `INSERT`/`UPDATE` — no N+1, confirmed by reading `GoalRuntime.ts`'s `recordToRow()` (one extra key in an existing field-mapping loop, no extra query). The Office material-event derivation (`canonicalSignalKeyForMaterialEvent`) is a single pure-function call, no I/O.

## Observability (§25)

No new metrics were added. No canonical signal key or recommendation key appears in any metric label anywhere in this diff — confirmed by grep (`operationalMetrics.*canonical_signal_key`, `operationalMetrics.*recommendation_key`: zero matches). Diagnostics/lineage visibility is via ordinary row reads (§17), not metrics.

## Files changed

- `src/oyi-core/runtime/operationalReasoning.ts` (modified — the identity-stability fix, root cause)
- `src/contracts/goal.ts` (modified — new required `canonical_signal_key` field)
- `src/services/goalRuntime/GoalRuntime.ts` (modified — read/write mapping for the new field)
- `src/oyi-core/ingress/officeMaterialEventAdapter.ts` (modified — real derivation + explicit population)
- `src/oyi-core/orchestration/ConversationOrchestrator.ts` (modified — explicit `null`)
- `supabase/migrations/20260925090000_wave7_slice2_goal_canonical_signal_lineage.sql` (new)
- `scripts/wave7-slice2-identity-chain-repair-smoke.mjs` (new)
- `scripts/wave7-slice2-identity-chain-repair-sql-smoke.mjs` (new)
- `package.json` (two new script entries)
- `docs/WAVE7_SLICE2_IDENTITY_CHAIN_REPAIR.md` (this file)

## Migrations

`supabase/migrations/20260925090000_wave7_slice2_goal_canonical_signal_lineage.sql` — the one migration authorized by the Slice 0 roadmap for this slice. Applied and verified locally against real PostgreSQL only (not pushed, not deployed).

## Remaining identity gaps (for later slices, not fixed here)

- The lead/opportunity identity conflation in Office's commercial-goal path (Slice 0 §17–18) remains open — `opportunity_id` is still dead on every live write path; this slice did not touch it (explicitly out of scope: "Do NOT make goals opportunity-centric yet").
- `oyi_goals` still has no `home_id`/`device_id`/`estate_id` fields — GoalRuntime remains Office/commercial-scoped (Slice 0 §16); this slice added lineage, not scope generalization, per explicit instruction.
- The Decision object remains MISSING (Slice 0 §36); this slice does not create it.
- `recommendationPlanner.ts`'s ephemeral, never-persisted path (duplicate-authority A) still has its own independently-formatted `dedup_key`, unrelated to and unconverged with `recommendation_key` — this was already disclosed in Slice 0/1 and is not this slice's concern (`EPHEMERAL_BY_DESIGN`).
- Plan authority remains PARALLEL between `operational_plans` and `automation_approvals` (Slice 0 §36, duplicate-authority B) — untouched, confirmed compatible only, not converged.
