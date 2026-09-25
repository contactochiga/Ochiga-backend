# Wave 8 — Outcome & Learning Convergence — Slice 2: Recommendation Dismissal Feedback Loop

Status: COMPLETE. Baseline HEAD: `17e7fcb` (Wave 8 Slice 1). No migration created or required.

## 1. Scope, as given

Roadmap text (`docs/WAVE8_OUTCOME_LEARNING_AUTHORITY_AUDIT.md`, §26H):

> Slice 2 — Recommendation Dismissal Feedback Loop: close the §11/§26(H) gap — aggregate repeated
> dismissals of the same recommendation type/reason and surface it (read-only, advisory) without
> auto-suppressing anything.

Hard constraints honored throughout: no auto-suppression, no score/ranking change, no learning-parameter
change, no policy change. A human dismissal is evidence, not automatic proof Oyi was wrong. This slice
surfaces evidence and stops.

## 2. The write path (reconstructed, not assumed)

There is exactly ONE write path for recommendation dismissal feedback:
`canonicalIntelligenceStore.recordFeedback()` (`src/oyi-core/persistence/canonicalIntelligenceStore.ts:346-362`),
called by the real, authenticated `POST /runtime/feedback` route (`src/routes/oyiRoutes.ts:147-165`,
`requireAuth` + `resolveRequestContext`). It does two things per call:

1. A plain `insert` into `intelligence_feedback` (`object_type`, `object_id`, `feedback_type`, `actor_id`,
   `reason`, `outcome_metadata`) — **no idempotency check of any kind**, unlike Wave 8 Slice 1's device
   evaluator (see §11 below).
2. When `object_type === "recommendation"` and `feedback_type` is one of `dismissed` / `not_useful` /
   `false_positive`, it additionally updates `operational_recommendations` (`status = "dismissed"`,
   `dismissed_by = actorId`) via `.eq("recommendation_key", input.objectId)`.

No second, ad-hoc dismissal-tracking mechanism exists anywhere in the codebase (grepped `dismissed_by` /
`accepted_by` / `resolved_by` across `src/` — the only writer is this one function). §27's classification is
therefore simple: CANONICAL, ONE PATH, no duplicates to reconcile.

## 3. Dismissal semantics (not assumed to be one thing)

`dismissed`, `not_useful`, and `false_positive` are collapsed into the same `operational_recommendations.status`
transition by the write path above, but they are NOT the same claim:

- `dismissed` — closed by a human; could mean "already handled," "not relevant now," or genuine disagreement.
- `not_useful` — an explicit signal the recommendation itself didn't help.
- `false_positive` — an explicit signal the recommendation was wrong.

This slice never merges these into one opaque number. Every evidence result reports `byFeedbackType`
(a count per type) alongside the summed `dismissalCount`, so a consumer can see the breakdown.

## 4/5. Recommendation identity and the aggregation key

`recommendation_key` traces back through `materialization.ts:35` (`recommendation_key: a.id`) to
`src/oyi-core/runtime/operationalRecommendations.ts:148`: `id: \`recommendation:${domain}:${insight.id}\``,
and `insight.id` in turn comes from `operationalReasoning.ts`'s own Wave 7 Slice 2 identity repair:
`id: \`insight:${domain}:${entityKey}:${lower(reason)}\`` — a deterministic, semantic key, not positional.

However, `materialization.ts`'s `scopeMaterializationIdentities()` then re-derives the FINAL, persisted id via
`uuid(\`${canonicalSignalKey(signal)}:${kind}:${item.id}\`)`, and `canonicalSignalKey` includes the triggering
signal's own `providerEventId || id` (`materialization.ts:8`). **This means `recommendation_key` is stable only
against retried/duplicate delivery of the SAME signal occurrence — not across genuinely repeated real-world
occurrences of the same semantic recommendation.** A device faulting again next week produces a brand-new
`recommendation_key`, even though it's "the same kind of recommendation." Confirmed directly against a real
Postgres instance (`wave8-slice2-recommendation-dismissal-evidence-sql-smoke.mjs`, "recommendation_key
instability" check): two independently-seeded rows share the same `(domain, action_type)` and are both
real, valid, distinct `recommendation_key` values.

The aggregation key this slice uses is therefore **`(target->>'domain', action_type)`** — both are real,
persisted, non-free-text columns on `operational_recommendations` (confirmed via
`supabase/migrations/20260728143000_oyi_core_convergence_canonical_storage.sql:111-142`), shared by every
occurrence of "the same kind of recommendation." `reason` is deliberately excluded from the grouping key: it
is generator-authored prose (e.g. `"3 further offline events..."`), not a taxonomy field — grouping on it
would fragment identical patterns by incidental wording. Distinct reasons are still surfaced, unaggregated,
via `getRecommendationDismissalEvidence()`'s `reasons` array.

## 6. Actor/scope semantics

`intelligence_feedback` itself carries no scope columns. `operational_recommendations` does
(`estate_id`, `home_id`), so `listDismissalPatternEvidence()` accepts optional `estateId`/`homeId` filters and
joins through `recommendation_key`. Unscoped calls aggregate across all scopes but the read contract never
exposes actor identifiers — only `distinctActorCount` (a number, computed in-process from a set that is never
returned to the caller). Operational recommendations are staff/ops-facing signals (infrastructure, maintenance,
security, etc.), not private resident content, so cross-scope pattern aggregation (e.g. "how often is
`schedule_preventive_inspection` dismissed system-wide") is a legitimate operational question; per-recommendation
evidence (`getRecommendationDismissalEvidence`) is always scoped to one specific `recommendation_key` regardless.

## 7. Temporal window

No arbitrary day-count constant was invented. Every evidence result reports `firstSeenAt`/`lastSeenAt` (the
real min/max `created_at` of the underlying rows) instead of a windowed count — callers can apply their own
recency judgment. `operational_recommendations` scans are ordered `updated_at desc` with a bounded `limit`
(default 500, same bounding idiom already used by `outcomeEvaluation.ts`'s `summarizeEvaluatedPredictionsByType`).

## 8/9. Evidence contract

`RecommendationDismissalEvidence` (per-recommendation) and `DismissalPatternEvidence` (per-pattern) expose only
factual fields: `dismissalCount`, `byFeedbackType`, `distinctActorCount`, `firstSeenAt`, `lastSeenAt`, and (for
the per-recommendation form only) the distinct free-text `reasons`. Neither type answers "should we suppress
this" or "is this a bad recommendation" — no qualitative label ("strong evidence", "unreliable") is invented,
since no existing governed classifier produces one.

## 10. Schema sufficiency — no migration

Confirmed via real Postgres (`wave8-slice2-recommendation-dismissal-evidence-sql-smoke.mjs`, 7/7 passing):
the existing `idx_intelligence_feedback_lookup(object_type, feedback_type, object_id)` index is used by the
exact filter this module issues (`EXPLAIN` shows an index-assisted plan, not a sequential scan), and
`operational_recommendations`'s existing unique `recommendation_key` index makes the join 1:1 and cheap. No
migration was created or is proposed.

## 11. Slice 1 concurrency gap — reconfirmed and classified

Wave 8 Slice 1 disclosed that `intelligence_feedback` has no DB-level uniqueness constraint, and its device
evaluator's app-level SELECT-then-INSERT is a best-effort (not atomic) idempotency check — 10 genuinely
concurrent automated evaluation attempts produced 10 rows. **`recordFeedback()`'s dismissal write path has a
different, and in one respect worse, profile: it does not even attempt a SELECT-then-INSERT check — every call
is an unconditional insert.** The two gaps share the same underlying limitation (no unique constraint on
`intelligence_feedback`) but differ in realistic exposure: Slice 1's producer is automated and can genuinely
fire many truly concurrent requests; dismissal feedback's producer is a single authenticated human clicking one
button, so the realistic duplicate source is a UI double-submit or network retry of one decision, not a
high-frequency race. **No shared migration was applied.** Per the task's explicit instruction, this is
disclosed and classified rather than unilaterally fixed: if a future slice needs a DB-level fix, a single
partial/composite constraint could serve both gaps, but that is a proposal for explicit authorization, not
something this slice creates.

## 12. Deduplication semantics

Because no "reopen" path was found anywhere in the codebase once `operational_recommendations.status` becomes
`"dismissed"`, more than one feedback row for the SAME `actor_id` + SAME `recommendation_key` + SAME
`feedback_type` is far more plausibly a transport retry/double-submit than two independent human decisions.
The read layer (not the write layer) collapses rows in that exact identity bucket when they land within 30
seconds of each other into one counted occurrence — proven in the functional smoke ("D: retry collapse" /
"D2: NOT collapsed when far apart"). This is a read-time heuristic only: **no row is ever deleted, rewritten,
or hidden** — the full, uncollapsed history remains queryable by anyone reading `intelligence_feedback`
directly (§13, occurrence-vs-pattern preserved).

## 13/14/15. Occurrence vs. pattern, adjacent signals, human vs. factual outcome

- Occurrence-level evidence (`getRecommendationDismissalEvidence`) and pattern-level evidence
  (`listDismissalPatternEvidence`) are two distinct functions; neither is lossy relative to the raw
  `intelligence_feedback` rows.
- Other `object_type`/`feedback_type` families in the same generic table (`oyi_prediction`/`outcome_evaluation`
  from `outcomeEvaluation.ts`, `device_state_outcome`/`device_state_outcome_evaluation` from Wave 8 Slice 1)
  are excluded by construction (`object_type = "recommendation"` + `feedback_type IN (dismissed, not_useful,
  false_positive)`) — proven directly in both smokes ("H"/"Non-dismissal-family feedback_type" checks).
- Human dismissal (subjective) and device-outcome evaluation (factual) are never combined into one score —
  they live in different `object_type` families and this module only ever reads the `recommendation` family.

## 16/17. Consumer and learning-proposal boundary

This slice ships as an internal, read-only module
(`src/oyi-core/domains/intelligence/recommendationDismissalEvidence.ts`) with **no HTTP route and no caller
anywhere in the codebase** (confirmed: `grep -rl "recommendationDismissalEvidence" src/` matches only the
module's own file). It is intentionally inert until a future, separately-authorized slice chooses to consume
it — matching the roadmap's own "queryable only" framing (option A) and the explicit instruction not to
generate a learning proposal in this slice.

## 18/19. Zero behavioral impact — proven, not asserted

- `grep -rl "recommendationDismissalEvidence" src/` → only the module itself. No recommendation generator
  (`recommendationPlanner.ts`, `operationalRecommendations.ts`), scorer, ranker, or `learningProposalPass.ts`
  reads it.
- The module contains no `.insert(`, `.update(`, or `.delete(` call anywhere — verified by inspection and by
  the functional smoke's explicit "Zero-mutation proof" check (byte-identical table state before/after every
  read). It never touches `oyi_learning_parameters`, any policy table, `DeviceCommandAuthority`, or
  `operational_recommendations` itself.

## 20. Privacy

`distinctActorCount` is a number; no actor identifier is ever returned by either exported function. `reasons`
surfaces only the free text a human actually entered when dismissing — no cross-actor inference, no identity
attached to individual reason strings in the returned shape.

## 21. Multi-domain behavior

The functional smoke exercises maintenance, infrastructure, security, utility, environmental, community, and
financial domains directly against the real `RecommendationActionType`/`OperationalRecommendationDomain`
vocabulary (`src/oyi-core/runtime/operationalRecommendations.ts`). No production dismissal data was queried by
this slice (would require touching production, out of scope for a local-only slice); the real-Postgres smoke
proves the query/index/join shape is correct against the actual schema instead.

## 22. Recommendation-versioning limitations

No version field exists on `operational_recommendations` or in `OperationalRecommendation`'s payload. If a
recommendation generator's semantics for a given `(domain, action_type)` pattern change over time, older and
newer occurrences are indistinguishable to this module — disclosed here rather than inventing a version field.

## 23. Read-only over immutable evidence

Confirmed by inspection and by the functional smoke's zero-mutation check — this module performs `select` only.

## 24. Bounded read service

Two functions, matching the roadmap's own suggested consumers: `getRecommendationDismissalEvidence(key)` (one
recommendation) and `listDismissalPatternEvidence(filter)` (patterns, optionally scoped by domain/actionType/
estateId/homeId, capped at `limit` recommendations scanned, default 500, max 2000). No dashboard API was added.

## 25. Performance

`listDismissalPatternEvidence` issues exactly two queries regardless of row count (one bounded
`operational_recommendations` scan, one `IN`-clause batch fetch from `intelligence_feedback`) — no N+1.
Aggregation happens in application code after both fetches, which is appropriate at the scale these tables
realistically reach (in-process grouping of a few thousand rows is sub-millisecond). The real-Postgres smoke
seeded 50 additional rows and confirmed via `EXPLAIN` that the `intelligence_feedback` lookup remains
index-assisted, not a sequential scan.

## 26. Observability

`operationalMetrics.increment("dismissal_evidence_read_total", { domain, result })` on every read
(`domain` is either the requested domain filter, `"all"`, or `"single_recommendation"`; `result` is
`ok`/`empty`/`error`) — low-cardinality, no recommendation keys, actor ids, estate/home ids, or free-text
reasons in any label.

## 27. Adjacent ad-hoc dismissal tracking

None found. See §2 — exactly one write path, no duplicates to reconcile or migrate.

## 28. Scenario proof (functional smoke, 12/12 passing)

A (single dismissal → count 1), B (three distinct actors → count 3), D (rapid same-actor retry → collapsed to
1), D2 (same actor, hours apart → NOT collapsed, count 2), E (two different `recommendation_key` occurrences of
the same `(domain, action_type)` pattern aggregate together; a different pattern stays separate), F (distinct
reasons preserved verbatim, nothing fabricated), G (`dismissed`/`not_useful`/`false_positive` broken down
separately, never blurred into one number), H (a `device_state_outcome` row for the same object_id never leaks
into dismissal evidence), I (estate/home/domain/actionType scope filters correctly narrow results), J (no
evidence → honest zero, not an error), plus an explicit zero-mutation proof and a sanity check that the
module's own `DISMISSAL_FEEDBACK_TYPES` constant matches `recordFeedback()`'s real literal list.

## 29. Real-Postgres proof (SQL smoke, 7/7 passing)

Both tables' real column shapes; DB-enforced `recommendation_key` uniqueness; two independently-seeded
`recommendation_key` rows sharing one `(domain, action_type)` pattern (the direct schema proof behind §4/§5's
identity-instability finding); the exact two-step join the module performs, on real data; a recommendation with
zero feedback rows returning a clean empty set; a non-dismissal `feedback_type` correctly excluded; and an
`EXPLAIN`-verified index-assisted query plan.

## 30-33. Regression

Representative Wave 5/6/7/Wave 8 Slice 1 smokes plus the full `validate:release` battery were run as part of
this slice's own verification pass (see the final report for exact pass/fail counts). The one pre-existing,
unrelated `smoke:oyi-office-intelligence-convergence` idempotency-store failure (present since early Wave 7)
is unaffected by this slice's changes.

## 34. Migration gate

Not triggered. No migration was created. Both real-Postgres proofs above confirm the existing schema and
indexes are sufficient for this slice's read shape.

## Remaining gaps (honestly disclosed, not fixed here)

- `intelligence_feedback` has no DB-level uniqueness constraint (shared with Slice 1's own disclosed gap;
  see §11) — this slice's read-time retry-collapse heuristic mitigates the dismissal-specific exposure without
  touching the schema.
- No HTTP route exposes this evidence yet — by design, per §16/17; a future, separately-authorized slice would
  need to choose and justify a first real consumer before adding one.
- No "recommendation reopened" signal exists, so the retry-collapse heuristic's underlying assumption (a given
  `recommendation_key` is dismissed at most once, genuinely) is inferred from the absence of a reopen code
  path, not from an explicit schema guarantee — disclosed rather than silently relied upon.
