# Wave 8 — Outcome & Learning Convergence — Slice 4: Commercial Outcome Evaluator

Status: COMPLETE. Baseline: Backend HEAD `5494725` (Wave 8 Slice 3), Office HEAD `c08cb92` (Wave 8 Slice 4 Prerequisite). No Backend migration created — genuinely not required. Office was not modified in this slice.

## 1. Scope, as given

This slice extends Slice 3's Goal-outcome architecture with one new, deterministically-evaluable outcome class: whether a commercial Goal's intended Office `crm_opportunities` stage was actually reached, per Office's own authoritative transition record. It implements Opportunity-based commercial outcome evaluation only. It does not implement Decision effectiveness scoring, sales learning, OMA/OSA changes, or follow-up-timing changes, and does not start Slice 5.

## 2. Office authority, re-confirmed at this slice's own baseline

Re-verified against Office HEAD `c08cb92` (the Slice 4 Prerequisite's own commit): `crm_opportunities.stage`/`.status` are mutated by exactly one function, `transitionOpportunity()` in `office-operational-workflows.js`, via a genuine `stage=eq.<expected>` compare-and-swap. Every transition is additionally recorded as a `crm_activities` row with `activity_type: "opportunity_stage_changed"` and a `metadata.target_stage`/`metadata.previous_stage` pair — this activity history is what makes historical-outcome preservation (§9 below) possible. Backend never writes to either table; it only reads Office's two existing read-only admin list routes (`GET .../crm/opportunities`, `GET .../crm/activities`), both already built in the prerequisite slice, not modified here.

## 3. Missing commercial-target contract — resolved additively

Audited `GoalRecord`, `Decision`, and `JvAssessment` for any structured field naming an intended commercial stage. None existed: `GoalSuccessCondition` only expresses reply/task/call conditions; `Decision.action_type` is a `RelationshipCommunicationPolicy` value (a communication policy, not a stage target); `JvAssessment.recommended_next_step` is a next-action recommendation, not an objective. Per this slice's own instruction not to invent an LLM parser, one new optional field was added: `GoalTargetEntities.commercial_target_stage?: string | null` (`src/contracts/goal.ts`), mirroring the exact additive pattern of the existing `opportunity_id` field from Wave 7 Slice 7. Zero migration (jsonb `target_entities` already supports this). Honestly absent on every currently-live Goal — no producer sets it yet; the evaluator treats absence as `no_target_specified`, never an invented default.

## 4. Commercial stage order — explicitly versioned mirror

`src/oyi-core/domains/development/commercialStageOrder.ts` copies Office's own `PIPELINE_STAGES` (`ochiga-office/src/lead-agents/commercial-ops.js`, re-confirmed at Office HEAD `c08cb92`) verbatim as `COMMERCIAL_STAGE_ORDER`, with `"intake_received"` prepended at ordinal 0 (it is `crm_opportunities.stage`'s own real DB default and Office's own `OPPORTUNITY_STAGE_TRANSITIONS` sole entry point, but not itself a `PIPELINE_STAGES` member). A `MIRROR_SOURCE` constant pins the exact repo/file/symbol/Office-HEAD this was copied from.

**Drift risk (disclosed, not hidden):** Backend and Office share no package; there is no automated cross-repo check today. If Office's `PIPELINE_STAGES` is ever renamed, reordered, or extended, this mirror goes stale silently until a future audit hand-diffs it against `MIRROR_SOURCE`. This is a real, accepted limitation of the two-repository boundary, not something this slice can close without a shared package — which was out of scope.

## 5. Read bridge — batched by construction

`src/oyi-core/ingress/officeOpportunityBridge.ts`'s `fetchOfficeOpportunitySnapshots(opportunityIds: string[])` mirrors the existing Backend→Office outbound pattern (`officeHandoffBridge.ts` et al.: `resolveOfficeSyncKey()`, `OFFICE_APP_URL`-based base URL, `x-office-api-key` header, `validateStatus: () => true`, discriminated-union result). It issues exactly two Office HTTP calls total — one `GET .../crm/opportunities`, one `GET .../crm/activities` — regardless of how many opportunity IDs are requested. The activities fetch degrades independently: if it fails, every requested snapshot is still returned with an empty `stageHistory` rather than failing the whole evaluation (the evaluator then falls back to current-stage-only comparison for intermediate targets, a disclosed degradation).

**Known scaling limitation (disclosed):** Office's admin routes are list-only — no per-ID GET, no server-side filtering or pagination. A very large `crm_activities` table means every batch evaluation fetches the full table. Not a blocker at today's real volume (Office has no Opportunity-stage-transition traffic yet — see §11), but a real limitation that would need a paginated or filtered Office route if activity volume grows substantially.

## 6. Commercial outcome reduction algorithm

`src/oyi-core/domains/development/commercialOutcomeEvaluator.ts`'s `evaluateCommercialOpportunityOutcome(targetStage, snapshot)` is a pure function (no I/O):

- `targetStage` absent → `unverified` / `no_target_specified` (the Goal itself never named a commercial target).
- `snapshot` absent (Office unreachable, or the `opportunity_id` doesn't resolve) → `unverified` / `office_unavailable` — never `not_achieved` merely because Office couldn't be reached.
- `targetStage === "won"`: `achieved` iff currently `"won"`; `not_achieved` iff currently `"lost"`; else `unverified`.
- `targetStage === "lost"`: symmetric, defensive case (no real producer ever sets this).
- Any intermediate target: build `stagesEverReached` from the Opportunity's current stage plus every `target_stage` in its own `opportunity_stage_changed` activity history. `achieved` iff this set contains the target stage or any stage at or past its ordinal position in `COMMERCIAL_STAGE_ORDER` (`"lost"` never counts as forward progress; `"won"` always satisfies any intermediate target). If never reached and currently `"lost"` → `not_achieved`. If never reached and still open → `unverified`.

This design was deliberately corrected during implementation: a naive current-stage-only comparison would have reported `not_achieved` for a Goal whose intermediate target was genuinely reached before the Opportunity later became `"lost"` — violating the historical-preservation requirement below. Consulting the stage-change history instead of only the current stage fixes this.

## 7. Result taxonomy

`CommercialOutcomeResult = "achieved" | "not_achieved" | "unverified"`. `CommercialOutcomeProvenance = "commercial_opportunity_evaluation" | "no_target_specified" | "office_unavailable"` — three genuinely distinct facts, never blurred. `GoalOutcomeProvenance` (Slice 3's own type) is extended with these same three values so a caller inspecting only `GoalOutcome.provenance` gets the same honesty; the richer `CommercialOutcomeEvaluation` (target/observed stage, `stagesEverReached`, `evaluatedAt`, `causalNote`) is additionally exposed via the new optional `GoalOutcome.commercial` field.

## 8. Won/lost semantics — never inferred from proposal-accepted

`evaluateCommercialOpportunityOutcome` only ever compares against `snapshot.stage`/`snapshot.status`, both sourced from Office's own `crm_opportunities` row — it never reads a proposal's `status`, a lead's `pipeline`/`stage`, or any reply/sentiment signal. Proven structurally (scenario F's source-grep, below) and behaviorally (scenario E: target=won/actual=lost → `not_achieved`, exercised against a snapshot where a proposal could independently show `accepted` and it still has no bearing).

## 9. Historical outcome preservation

An intermediate target achieved at T1 remains `achieved` even if the Opportunity later becomes `lost` at T2 — proven by scenario K (qualified reached, then lost; still `achieved` for target=qualified) and its negative counterpart (never reached before lost → `not_achieved`). `"won"`/`"lost"` themselves are evaluated via current-stage-only logic since Office's own terminal-state protection (Slice 4 Prerequisite) means a won/lost Opportunity never regresses — "currently won" and "ever won" are the same fact for those two targets specifically.

## 10. Multi-opportunity isolation

Two Opportunities for the same lead evaluate completely independently — proven by scenario H (one `won`, one `lost`, same `lead_id`, correct opposite verdicts) — since every evaluation is keyed by `opportunity_id`, never by `lead_id`.

## 11. Legacy and unsupported Goal behavior

A Goal with `target_entities.lead_id` but no `opportunity_id` never triggers commercial evaluation and never guesses an Opportunity — `no_evaluator_available` (scenario I). A Goal with `opportunity_id` but no `commercial_target_stage` (i.e. every currently-live commercial Goal in production today — confirmed by audit: no producer sets the new field) also stays `no_evaluator_available`. **Production activation of this slice's evaluation path is therefore fully inert today** — the same "contract built, zero live producers" precedent Wave 8 Slice 1 established — pending a future, separately-authorized change to a Goal producer (e.g. `activateDevelopmentRelationshipGoal()` in `officeMaterialEventAdapter.ts`) to actually populate `commercial_target_stage`. That producer change is explicitly out of scope here.

## 12. Office-unavailable behavior

A network failure, non-2xx response, or missing shared secret yields `unverified` / `office_unavailable` for every affected Goal — never `not_achieved` — proven by scenario J (single-Goal) and the batch-unavailable scenario (multi-Goal).

## 13. Causal ceiling

`CAUSAL_NOTE` (mirroring Slice 1's own precedent) states explicitly that this evaluation establishes only whether Office's Opportunity record satisfies the target stage — never that any specific Decision, Goal, or communication *caused* that progression. Decision effectiveness scoring remains unimplemented, exactly as scoped.

## 14. Reply/sentiment/delivery cannot establish commercial outcome — proof

Structural: `commercialOutcomeEvaluator.ts` and `officeOpportunityBridge.ts` never reference `InboundReplyOutcome`, sentiment, delivery status, or `reply_received`/`positive_reply` in their actual code (comments describing the exclusion are permitted and present; the smoke's grep strips comment lines before asserting). Behavioral: scenario F proves a reply-only Goal with no commercial target never evaluates commercially regardless of reply state, and makes zero Office calls.

## 15. Same-class search — other outcome-collapse code in Backend

| Location | What it does | Classification |
|---|---|---|
| `goalEvaluator.ts::evaluateGoal()` (`success_condition.type === "reply_received"`/`"positive_reply"` → `status: "completed"`) | Marks Goal **workflow** complete on reply/positive-sentiment | WORKFLOW_PROGRESS — already correctly separated from outcome by Slice 3's own architecture; this slice does not touch it and Goal.status continues to mean only "workflow finished," never "objective achieved" |
| `corporateIntelligence.ts::classifyLeadRoutingSignal` (`lead_stage`, OMA/OSA routing) | Heuristic lead-stage classification used only to route a conversation to OMA vs OSA | WORKFLOW_PROGRESS / OUT OF SCOPE — explicitly not touched per "DO NOT UPDATE OMA/OSA"; never consulted by this slice's evaluator |
| `intelligence-core/workflows.ts` (`proposal_accepted` workflow-type routing entry) | Routes a proposal-accepted event to the OSA agent | WORKFLOW_PROGRESS — an internal routing table entry, not a claim that the underlying Opportunity is won |
| `routes/officeExport.ts` (`proposal_accepted` literal, x2) | Passes through/validates an inbound material-event type string | CANONICAL_OFFICE_TRUTH (pass-through only) — never interpreted as commercial success anywhere downstream in Backend |

No FALSE_OUTCOME_COLLAPSE code (code that silently reports commercial success from a non-Office signal) was found anywhere in Backend at this baseline.

## 16. Batch performance

`deriveGoalOutcomesBatch(goals: GoalRecord[])` (`goalOutcomeEvaluator.ts`) partitions goals into commercial-eligible (no device steps, both `opportunity_id` and `commercial_target_stage` set) vs. all others, issues exactly one `fetchOfficeOpportunitySnapshots()` call covering every commercial goal's `opportunityId` (deduplicated), then evaluates each against the shared snapshot map. Non-commercial goals (device-path or no-evaluator) still resolve via the existing single-goal `deriveGoalOutcome()` path, unaffected. Proven at 1/10/50/100 simultaneous commercial evaluations: exactly 1 opportunities call and 1 activities call in every case, regardless of N (functional smoke's batch-performance section). `deriveGoalOutcome()` itself (the single-goal entry point) still costs one Office call pair per invocation when called in a loop — `deriveGoalOutcomesBatch` is the entry point a caller evaluating many Goals at once must use to realize the batching benefit.

## 17. Migration gate — not triggered

No new Backend persistence was introduced. Every commercial evaluation is a pure, on-demand derivation over data already available (the Goal's own `target_entities`, and Office's existing read-only admin routes) — the same "derived evaluation, zero new writes" precedent Slice 3 established for the device-outcome path. `intelligence_feedback` was considered per the task's own instruction and found unnecessary: there is no evidence to durably record here that Office doesn't already durably record itself (the Opportunity row and its `crm_activities` history *are* the durable record; Backend only re-reads them on demand). No Backend migration file exists in this slice's diff.

## 18. Office modification — not required

No Office change was made. The two Office read routes this slice depends on (`GET .../crm/opportunities`, `GET .../crm/activities`) were already built and committed in the Slice 4 Prerequisite (`c08cb92`); Office's working tree and HEAD were re-verified unchanged at the end of this slice (`git status --short` shows only the pre-existing untracked `supabase/` noise; `git rev-parse HEAD` still `c08cb92`).

## 19. Files changed

- `src/contracts/goal.ts` — added `GoalTargetEntities.commercial_target_stage?: string | null`.
- `src/oyi-core/domains/development/commercialStageOrder.ts` (new) — the versioned stage-order mirror.
- `src/oyi-core/ingress/officeOpportunityBridge.ts` (new) — the batched read bridge.
- `src/oyi-core/domains/development/commercialOutcomeEvaluator.ts` (new) — the pure reduction function.
- `src/services/goalRuntime/goalOutcomeEvaluator.ts` — extended `GoalOutcomeProvenance`/`GoalOutcome`, added `deriveCommercialGoalOutcome()` dispatch inside the existing device-less branch of `deriveGoalOutcome()`, added `deriveGoalOutcomesBatch()`. Zero lines of the existing device-path logic were changed.
- `scripts/wave8-slice4-commercial-outcome-evaluator-smoke.mjs` (new) — functional smoke, scenarios A-M plus batch-performance and mixed-batch coverage, 21/21 passing.
- `package.json` — one new script entry.
- `docs/WAVE8_SLICE4_COMMERCIAL_OUTCOME_EVALUATOR.md` (this file).

`GoalRuntime.ts`, `goalEvaluator.ts`, `goalScheduler.ts` — zero lines changed (confirmed via `git diff --stat`).

## 20. Testing

- `npx tsc --noEmit -p tsconfig.json` — clean, zero errors, after all edits.
- `npm run build` — clean.
- `scripts/wave8-slice4-commercial-outcome-evaluator-smoke.mjs` — 21/21 passing (scenarios A-M, batch performance at 1/10/50/100, mixed-batch, Office-unavailable batch).
- Regression: `wave8-slice1-device-state-outcome-evaluator`, `wave8-slice2-recommendation-dismissal-evidence`, `wave8-slice3-goal-outcome-workflow-separation`, `wave7-slice6-goalruntime-domain-generalization`, `wave7-slice7-lead-opportunity-identity-resolution`, `wave6-slice2-canonical-awareness`, `wave5-slice1-facility-automation-device-authority`, `oyi-communications-convergence-slice1`/`slice2`, `oyi-core-convergence`, `oyi-core-privacy` — all passing (see final report for exact counts).

## 21. Commit

One local Backend commit: "Wave 8D: evaluate commercial opportunity outcomes". Not pushed, not deployed. Office remains at `c08cb92`, untouched.
