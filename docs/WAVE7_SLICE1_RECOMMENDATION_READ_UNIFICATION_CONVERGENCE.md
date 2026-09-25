# Wave 7 Slice 1 — Recommendation-Read Unification Convergence

**Scope authority:** `docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §37, row 1 — the Slice 0 audit's own ordered Wave 7 roadmap. No other Wave 7 slice touched. No new ontology created.
**Backend HEAD (pre-change):** `834f672a3f6c5ff66155674621527b895d1b3fd8`.
**Type:** Narrow read-path convergence. No migration. No execution-boundary change.

## Before

Duplicate-authority finding A (Slice 0 audit §20, §36): `operational_recommendations` (canonical, persisted, feedback-tracked, written via `oyi_register_materialization`) and `recommendationPlanner.ts`'s ephemeral, never-persisted `OperationalRecommendation` type were two structurally independent producers with no shared identity. Every caller of `runIntelligenceOrchestrator()` — conversational capabilities (`intelligenceCapabilities.ts`), Room/Home contributors, and the proactive-intelligence scheduler — always received the ephemeral computation, regardless of whether a canonical answer for that scope already existed. The same underlying situation could surface two structurally different "recommendations" with no reconciliation (Slice 0 audit §35 Scenario F).

## Duplicate authority — proven, not assumed

`scripts/wave7-slice1-recommendation-authority-smoke.mjs`, check 1 ("pre-fix reproduction"), calls `runIntelligenceOrchestrator` with a mocked canonical `operational_recommendations` row (`CANONICAL-rec-1`) and a mocked ephemeral legacy-adapter recommendation (`ephemeral-rec-1`) for the *same scope*, using the exact pre-Slice-1 code path (actor never consulted). The caller received only `ephemeral-rec-1`; `canonical-rec-1` never surfaced — reproducing the audit's finding live, not theoretically. This check remains in the suite (it now exercises the `no_actor_context` branch) as a permanent regression guard.

## Selected canonical authority

`canonicalAwarenessReadService.listRecommendations()` — already the frozen Wave 6 canonical read path for `operational_recommendations` (privacy/scope-gated via `resolveActorAuthority`/`actorMayViewScope`, the same authority Slice 0/Wave 6 established for `listActiveAwareness`, `listIncidents`, `listInsights`, `listPlans`). Not created new; consumed as-is. No other candidate existed — this is the only real read implementation for the table.

## After

`intelligenceOrchestrator.ts`'s `runIntelligenceOrchestrator()` now mirrors the exact disclosed-fallback shape `awarenessPresentationAdapter.ts::getConvergedAwarenessDigest` already validated in Wave 6 Final C:

1. If a real `actor: AuthUser` is present and the call is not the proactive-delivery path, attempt `listRecommendations(actor, oisContext, {})`.
2. If canonical answers (`ok: true`, including a truthful zero-row answer — a canonical "nothing right now" is still authoritative, never treated as a reason to fall back), its rows (filtered to the live statuses `pending`/`monitoring`) are mapped into the existing `OperationalRecommendation` shape via `mapCanonicalRecommendation()` and returned as `result.recommendations`.
3. If canonical cannot answer, or no actor is available, or the call is the proactive-delivery path, ephemeral computation (`buildRecommendations`) runs exactly as before this slice — unchanged code, unchanged behavior.
4. Every outcome is disclosed on the result: `recommendation_source: "canonical" | "ephemeral"` and `recommendation_fallback_reason: "no_actor_context" | "canonical_coverage_gap" | "proactive_delivery_path" | null`. Never silently blended.

### Canonical → ephemeral-shape mapping (presentation-only translation)

- `domain`: parsed from the real `recommendation_key`'s middle segment (`recommendation:${domain}:${insightId}`, set at write time by `operationalRecommendations.ts:148`) and translated through a small, explicit `OperationalRecommendationDomain → OyiDomain` table (the two vocabularies don't share literals — a separate, disclosed gap, not this slice's to close).
- `severity`: canonical `urgency` (`monitor|review|act|urgent`) mapped to the ephemeral 4-value severity vocabulary, the same style of translation `awarenessPresentationAdapter.ts`'s `URGENCY_TO_SEVERITY` already uses.
- `dedup_key`: the real `recommendation_key` (an improvement over the ephemeral path's own weaker, positional-index-based key).
- `capability_key`: always `null` — unchanged, Slice 1 never widens executability.
- `actionability`/`requires_confirmation`: derived from the real `approval_required` column.
- `suggested_action`: best-effort synthesis from `reason`/`summary` (the canonical read layer doesn't select a dedicated field; `payload` jsonb, where one might live, is deliberately not selected by the frozen read service, so it isn't fabricated here either).

## Callers migrated

- `intelligenceCapabilities.ts::runOrchestratorForContext` — already passes `actor: context.actor` (a real `AuthUser | null`) and `proactive: false`. No caller-side code change; canonical preference now activates automatically whenever an actor is present.

## Callers intentionally retained on ephemeral (fallback disposition)

- `roomContributors.ts` / `homeContributors.ts` — `ContributorContext` structurally carries no `actor` field at all (verified by reading `contributorTypes.ts`). Threading a new actor parameter through this contributor pipeline (~15+ contributor implementations) would be a materially larger, riskier change than the audit's own "SMALL / read-path only" classification for Slice 1 — deferred, not fixed silently. `recommendation_fallback_reason: "no_actor_context"`.
- `proactiveIntelligenceScheduler.ts` — passes `actor: null` by design (a system-level scheduled tick with no signed-in user; `resolveActorAuthority` structurally requires a real actor to derive privacy/scope authority, and there is no safe way to consult per-actor canonical truth for a home-batch loop with no actor). `recommendation_fallback_reason: "no_actor_context"`.
- The proactive-delivery path (`context.proactive === true`) is additionally excluded even when an actor happens to be present, because `runProactiveDelivery()` sends real notifications (`NotificationService.sendToHome`) and Slice 1 is explicitly scoped to the read path only (Slice 0 audit §37: "Frozen systems affected: None"). `recommendation_fallback_reason: "proactive_delivery_path"`. No live caller combines actor+proactive today; this branch exists so a future caller that does cannot accidentally widen notification authority by inheriting canonical preference.

## Identity/lineage disposition

Not extended in this slice (that is Slice 0's proposed Slice 2, "identity-chain repair"). What Slice 1 does *not* break: canonical rows already carry `recommendation_key` (their real identity) end to end into the mapped `dedup_key` field — this slice's mapping is the first place the ephemeral shape's dedup key becomes the *real* canonical key rather than an independently-derived one, a small, incidental identity improvement, not the systemic fix Slice 2 will need to do (positional-index instability in `recommendation_key` itself, and the missing goal↔signal back-reference, are both still open — documented in the Slice 0 audit §29, untouched here).

## Scheduler boundary

Unaffected. No scheduler cadence, decision logic, or "what should happen next" authority changed. `proactiveIntelligenceScheduler.ts` still answers only "when should this be evaluated" and still never determines what canonical truth to prefer — it structurally cannot reach the canonical branch (`actor: null`).

## Human authority / execution boundary

Untouched. This slice is read-only with respect to `operational_recommendations` (only ever `SELECT`, never `UPDATE`/`INSERT`). No plan, approval, or execution object is created, read, or referenced by this change. `DeviceCommandAuthority`, `executeDeviceCommandForActor`, `devices.power.control`, the execution ledger, verification, and Facility Automation reconciliation are not imported, called, or exercised anywhere in this diff — confirmed by `git diff --stat` (single source file touched, plus one new test script and one package.json line).

## Domain behavior

Verified across Facility (`wave6-slice5-facility-consumer-ambient`, `wave5-slice1-facility-automation-device-authority`), Consumer (`consumer-facility-scope-privacy`), Office/commercial (`office-internal-surface`, `oyi-office-intelligence-convergence` — JV assessment suite, 6/6 passing; the one *unrelated* pre-existing failure in this script's idempotency-store tests is documented below), and conversation (`oyi-conversation`, `wave6-slice4-conversation-awareness`) — see Testing.

## Testing

- `npx tsc --noEmit -p .` — clean.
- `npm run build` — clean.
- New dedicated suite: `npm run smoke:wave7-slice1-recommendation-authority` — 9/9 passing, covering: pre-fix reproduction; canonical preferred when actor present; terminal-status (resolved) rows excluded; mapping correctness (domain/severity/dedup_key/capability_key/actionability); disclosed fallback on canonical read failure; truthful-empty-canonical still preferred (no unnecessary fallback); proactive-scheduler shape unaffected; actor+proactive still excluded; Room/Home-contributor shape (actor `undefined`) behaves identically to `actor: null`.
- Regression battery (19 scripts): `wave6-slice2-canonical-awareness`, `oyi-awareness`, `oyi-core-convergence`, `oyi-conversation`, `wave6-slice5-facility-consumer-ambient`, `consumer-facility-scope-privacy` (`intelligence-authority-smoke.mjs`), `goal-runtime`, `automation-runtime-v2`, `cross-domain-automation`, `event-driven-automation`, `office-internal-surface`, `oyi-office-intelligence-convergence`, `wave6-slice1-privacy-boundary`, `resident-device-privacy`, `programme4-authority-privacy-closure`, `wave5-slice1-facility-automation-device-authority`, `wave5e-automation-worker-device-authority`, `wave4b-slice4-commandrouter-device-command-authority`, `wave6-slice4-conversation-awareness`. 17/19 exit 0. The 2 failures (`cross-domain-automation`: "entity_id guard was not relaxed for notification.notify"; `oyi-office-intelligence-convergence`: idempotency/duplicate-detection store assertions) were reproduced identically — same failure text, same assertion counts — on the pre-Slice-1 baseline (`git stash` of the one modified source file, rebuild, rerun) — confirmed pre-existing, unrelated to this change, not touched by this slice.

## Performance

No N+1 introduced: the canonical branch adds exactly one additional network round-trip per `runIntelligenceOrchestrator()` call (`listRecommendations`'s single `SELECT ... LIMIT` query), independent of row count — verified by reading the query (`canonicalAwarenessReadService.ts:725-732`, one `await query`, no per-row queries) and confirmed structurally by the smoke suite's 2-row and 0-row canonical scenarios exercising the identical code path. No new provider call is added to the ephemeral pipeline (it is unchanged). No scheduler loop is added or altered.

## Observability

One new low-cardinality metric, `oyi_recommendation_source_total{source, reason}` (2 × 4 = 8 possible label combinations), alongside the pre-existing `oyi_recommendations_built_total` (left unchanged in meaning — it still counts ephemeral computation, not the served result, preserving existing dashboards). No private content in either label.

## Known/environment failures

`cross-domain-automation-smoke.mjs` and `oyi-office-intelligence-convergence-smoke.mjs` fail identically on the unmodified pre-Slice-1 baseline — pre-existing, out of this slice's scope, not fixed here (fixing them would be unrelated cleanup, explicitly disallowed).

## Newly discovered gaps (for later slices, not fixed here)

- Room/Home contributors have no actor available at all — a structural gap Slice 6 (GoalRuntime domain generalization) or a dedicated future pass would need to address if canonical preference is ever required there too.
- `recommendation_key`'s positional-index component (Slice 0 audit §29) remains unrepaired — Slice 2's stated scope, not Slice 1's.
- The `OperationalRecommendationDomain → OyiDomain` vocabulary mismatch (10 canonical values, no shared literal set with the 30+-value `OyiDomain`) is now visible in one more place (this mapping table) but was already a documented Slice 0 finding (§30), not newly introduced.

## Files changed

- `src/oyi-core/domains/intelligence/intelligenceOrchestrator.ts` (modified)
- `scripts/wave7-slice1-recommendation-authority-smoke.mjs` (new)
- `package.json` (one new script entry: `smoke:wave7-slice1-recommendation-authority`)
- `docs/WAVE7_SLICE1_RECOMMENDATION_READ_UNIFICATION_CONVERGENCE.md` (this file)

## Migrations

None. Read-path only, per the Slice 0 audit's own migration-likelihood classification for this slice ("None (read-path only)").

## Slice 1 authority: CONVERGED

`operational_recommendations` vs. the conversational-capability ephemeral path is no longer PARALLEL for any caller that carries a real actor — it is now canonical-preferred with an honest, observable fallback. The two remaining actor-less callers (Room/Home contributors, proactive scheduler) remain on ephemeral computation by structural necessity (no actor to authorize a canonical read against), explicitly disclosed via `recommendation_fallback_reason: "no_actor_context"` rather than silently unresolved.

## No blocker for Slice 2

Slice 2 ("Identity-chain repair": add a nullable `canonical_signal_key`-style back-reference column to `oyi_goals`, replace `recommendation_key`'s positional-index component with a stable derivation) has no dependency on anything this slice touched beyond read-only consumption of `recommendation_key`, which Slice 1 leaves untouched.
