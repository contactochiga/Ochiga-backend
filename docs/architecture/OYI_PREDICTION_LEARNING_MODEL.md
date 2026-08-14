# Oyi Prediction, Forecasting, Outcome/Learning And Proactive Intelligence Model

Status: Programme 3 complete — Prediction Standardization (Phase H), Numerical Forecasting (Phase I), Outcome Evaluation + Learning (Phase J), Proactive Intelligence (Phase K). Built on Programme 1's direct evidence + deep conversation layer and Programme 2's Room/Home aggregation.

This supersedes the "Phase A foundation" status this document previously described. The contracts named there (`OperationalAnomaly`, `OperationalPrediction`, `PredictionOutcome`, `RecommendationOutcome`, `ActionOutcome`) had zero call sites before this pass — they are now real, matured in place (extended additively, never replaced), and backed by working code.

## Contract Owner

- `src/oyi-core/contracts/intelligence.ts` — canonical types: `OperationalScope`, `OperationalAnomaly`, `OperationalPrediction`, `OperationalForecast` (new), `OperationalRecommendation` (new), `PredictionOutcome`, `ForecastOutcome` (new), `RecommendationOutcome`, `ActionOutcome`.
- The legacy prediction engine (`src/intelligence-core/predictionEngine.ts`) is preserved untouched, per the explicit strangler instruction — see "Legacy Strangler Adapter" below.

## Distinction (never conflated)

- **Fact**: a directly observed current state (Programme 1's evidence loaders).
- **Anomaly**: a detected deviation in current/recent evidence — "what is abnormal now?" No forward-looking claim.
- **Prediction**: a qualitative, rule-based, forward-looking estimate derived from an anomaly — "what is likely to happen next?" Carries `confidence` (0–1), `probability` (a coarse qualitative band, never a fabricated precise percentage), `horizon`, and `model_type: "rule"`.
- **Forecast**: a quantitative numerical projection over real historical time-series data, with a deterministic method, a baseline, and (when data supports it) a backtested confidence interval.
- **Recommendation**: a deduped, ranked, human-facing suggestion derived from anomalies/predictions/forecasts — never itself an anomaly or a prediction.
- **Outcome**: what was later observed to actually happen, compared honestly against a prediction/forecast — never inferred from engagement (a click, a view) as a proxy for success.
- **Learning**: a bounded, versioned, human-reviewed adjustment proposal for a tuning parameter — never an automatic behavior change.

## Module Layout

`src/oyi-core/domains/intelligence/`:

- `detectorTypes.ts` / `predictionProviderTypes.ts` — the `AnomalyDetector` and `PredictionProvider` registry contracts (stable `id`/`version`/`domain`, one async function each — mirrors Programme 2's `Contributor` pattern exactly).
- `deviceEventEvidence.ts` — new direct evidence loader over the real `device_events` table (Programme 1's device evidence only exposes current state, not history).
- `anomalyDetectors.ts` — `ANOMALY_DETECTORS`: `device.offline_cluster`, `maintenance.aging`, `automation.failure_rate`, `security.incident_frequency`, `visitor.volume`. Every detector reuses an existing Programme 1 evidence loader (or the new device-event loader) — no parallel evidence system.
- `predictionProviders.ts` — `PREDICTION_PROVIDERS`: `device.reliability`, `maintenance.risk`, `automation.reliability`, `security.pattern`. Each wraps one detector's anomalies into genuinely forward-looking predictions (never just relabels). `probabilityBand(confidence)` is the one fixed, documented confidence→qualitative-probability mapping (`>=0.65 likely`, `>=0.45 possible`, else `needs_monitoring`) — a deliberately coarse, defensible band, not an invented exact probability.
- `legacyPredictionAdapter.ts` — the strangler adapter (see below).
- `forecastMethods.ts` — pure, dependency-free arithmetic: `naiveLastPeriod`, `movingAverage`, `linearTrendFit`, `forecastForward`, `mae`, `mape` (returns `null`, never a fabricated number, when any actual value is zero), `rmse`, `backtest` (always compares against the naive-last-period baseline on the same train/test split).
- `utilitySpendHistoryEvidence.ts` / `utilitySpendForecastProvider.ts` — the one real forecast (see "Numerical Forecasting" below).
- `predictionPersistence.ts` — `persistPrediction`/`persistForecast`/`listPersistedPredictions`, reusing `ochiga_intelligence_predictions` (see "Storage" below).
- `outcomeEvaluation.ts` — `evaluateOpenPredictions`/`summarizeEvaluatedPredictions` (see "Outcome Evaluation" below).
- `learningParameters.ts` — `getLearningParameter`/`proposeLearningParameterAdjustment`/`promoteLearningParameter` (see "Learning" below).
- `recommendationPlanner.ts` — `buildRecommendations` (pure function: dedup + rank, no I/O).
- `proactiveDelivery.ts` — `runProactiveDelivery` (see "Proactive Intelligence" below).
- `intelligenceOrchestrator.ts` — `runIntelligenceOrchestrator`, the single entry point that runs every detector + provider + the legacy adapter + the forecast provider in parallel, persists native predictions/forecasts, and feeds the recommendation planner. This is what every conversational capability and the Home/Room contributor call.
- `intelligenceCapabilities.ts` — the four conversational read capabilities (see "Conversational Capabilities" below).

## Legacy Strangler Adapter

`predictionEngine.ts` (397 lines) is preserved and still runs unmodified — it still queries its own 9 tables and still persists to `ochiga_intelligence_predictions` itself, exactly as it always did. `legacyPredictionAdapter.ts` calls it unchanged, then classifies its output into the canonical taxonomy: `device_anomaly`/`camera_anomaly`/`power_or_network_instability` → `OperationalAnomaly`; `operational_recommendation` → `OperationalRecommendation`; everything else (`maintenance_risk`, `security_risk`, `visitor_pattern`, `edge_runtime_risk`) → `OperationalPrediction`. A fixed table converts its qualitative confidence (`confirmed:0.9, likely:0.7, possible:0.5, needs_monitoring:0.35`) into the new numeric `confidence` field. Every call logs `oyi_legacy_prediction_adapter_used` with generated/persisted/anomaly/prediction/recommendation/warning counts and latency, so legacy-adapter usage is measurable rather than assumed.

Native detectors fill three real gaps the legacy engine has: it does not query `wallet_transactions` (forecasting), `facility_incidents` (via `security.incident_frequency`, a second lens on top of its own regex-based security detection), or `consumer_automation_runs` failure-rate patterns (only single-event thresholds).

### Retirement criteria (Programme 4 Phase C)

`device_anomaly`, `maintenance_risk`, `visitor_pattern`, and `security_risk` are already fully or largely superseded by native detectors/providers (`device.offline_cluster`/`device.reliability`, `maintenance.aging`, `visitor.volume`, `security.incident_frequency`) — those four legacy output classes could be dropped from `legacyPredictionAdapter.ts`'s consumption today without losing unique signal. They are kept for now only because `legacyPredictionAdapter.ts` forwards `predictionEngine.ts`'s output as a single batch; splitting the adapter to selectively drop already-superseded classes is Programme 4 Phase O scope (retirement pass), not this document's concern.

Two classes have **no native equivalent and must stay** until replaced:

- **`camera_anomaly`** — no detector in `ANOMALY_DETECTORS` inspects `camera_events`. Retirement requires a native `camera.anomaly` detector (same shape as `anomalyDetectors.ts`'s existing entries) reusing a real camera-event evidence loader.
- **`power_or_network_instability`** — no native detector reproduces "≥3 devices offline within a 24h window, correlated across the estate" (distinct from `device.offline_cluster`, which is single-device). `runtime/incidentCorrelation.ts` is the closest native machinery but operates on already-normalized signals from `universalSignalRuntime.ts`, a different pipeline from the raw `device_events` table this legacy path reads. Retirement requires either a native detector reading `device_events` directly with the same clustering window, or `incidentCorrelation.ts` extended to consume `device_events` and produce an equivalent `OperationalAnomaly`.

`legacyPredictionAdapter.ts` itself (the strangler wrapper) can only be fully retired once both native replacements exist AND have been verified (via a smoke test comparing native vs. legacy output on representative historical data) to match or exceed legacy recall. Until then, it stays, and its usage remains measurable via the existing `oyi_legacy_prediction_adapter_used` log line — Programme 4 Phase J should promote that into a first-class counter (e.g. `oyi_legacy_prediction_adapter_calls_total`) so retirement timing is evidence-based, not guessed.

## Numerical Forecasting

Only ONE forecast domain is built: **utility spending** (`utilitySpendForecastProvider.ts`). This is deliberate, not an oversight — production has no reliable electricity consumption, meter-balance, or meter-reading time series anywhere in the schema (confirmed by direct migration audit, consistent with Programme 1's utilities finding). "Your electricity will run out in 3 days" is never built. Utility **spending** is forecastable because `wallet_transactions` is real, populated, and already the source Programme 1's `utilities.spending.read` reads from.

- Method: `linear_trend` over `WINDOW_DAYS = 84` (12 weeks), bucketed into weekly totals **including zero-spend weeks** (skipping silent weeks would bias the trend upward).
- `MIN_WEEKS_FOR_FORECAST = 4` — below this, no forecast is produced (`data_quality` explains why).
- `MIN_WEEKS_FOR_INTERVAL = 6` — below this, a forecast IS produced but `confidence_interval: null` and `data_quality: "limited"` (no fabricated uncertainty range). At/above this, a real `backtest()` runs against a naive-last-period baseline, and the interval is derived directly from that backtest's actual MAE (`predicted ± mae`) — never an invented statistical distribution.
- Every forecast carries its own `baseline` (naive last period) alongside the method's prediction, so a forecast that doesn't beat the trivial baseline is visible, not hidden.

## Storage

No new prediction/forecast/outcome tables were created. Three existing, real tables were confirmed suitable and reused:

- **`ochiga_intelligence_predictions`** — `prediction_type`/`status` are unconstrained free text (verified by reading the migration directly), so it safely holds both the legacy engine's types and Programme 3's new ones (`device_reliability_risk`, `maintenance_sla_risk`, `automation_failure_risk`, `security_review_needed`) plus forecasts, discriminated via `metadata.kind: "forecast"`.
- **`intelligence_feedback`** — its generic `{object_type, object_id, feedback_type, actor_id, reason, outcome_metadata jsonb}` shape holds outcome-evaluation results (`object_type: "oyi_prediction"`).
- **`oyi_learning_parameters`** (new, the one genuinely new table this programme needed — `supabase/migrations/20260814090000_oyi_learning_parameters.sql`) — `name, scope_estate_id, scope_home_id, version, current_value, proposed_value, min_bound, max_bound, rollout_stage, evaluation_basis, created_at, updated_at`. RLS-enabled, no anon/authenticated grants (inherits the repo's blanket `ALTER DEFAULT PRIVILEGES` security posture).

Anomalies and recommendations are deliberately **not** persisted — they are recomputed fresh from current evidence on every call, same as Programme 1/2's facts and Programme 2's aggregate contributors.

## Outcome Evaluation

`outcomeEvaluation.ts`'s `evaluateOpenPredictions` re-checks predictions still `open` in `ochiga_intelligence_predictions` (only once they're at least 24 hours old — a prediction made minutes ago hasn't had time to be tested) against **current** evidence, using the exact same evidence loaders the originating provider used:

- `device_reliability_risk` → re-queries `loadDeviceEventHistory` for the same device; a later offline/failure event → `realized`, none → `not_realized`.
- `maintenance_sla_risk` → re-queries `loadMaintenanceRequestFacts`; still open → `realized`, resolved/gone → `not_realized`.
- `automation_failure_risk` → re-queries `loadAutomationRunFacts`; the next recorded run also failed → `realized`, succeeded → `not_realized`.
- Any other prediction type → `unobservable` (honest — no evaluator exists yet, not a guessed outcome).

Every non-`unobservable` result is written to `intelligence_feedback` (`feedback_type: "outcome_evaluation"`) and the source prediction is closed (`resolved`/`dismissed`). This explicitly never infers success from a recommendation being shown or clicked — only from independently re-observed evidence.

## Learning Boundary

`learningParameters.ts` enforces this in code, not just documentation:

- **Permitted namespaces** (`ALLOWED_NAME_PREFIXES`): `anomaly.`, `prediction.`, `forecast.`, `recommendation.`, `ranking.`, `notification.cooldown.`, `notification.suppression.` — thresholds, ranking weights, anomaly sensitivity, confidence calibration, alert timing, suppression cooldowns.
- **Forbidden pattern** (`FORBIDDEN_NAME_PATTERN`): any name matching permission/RLS/access-control/financial-authority/wallet-limit/confirmation-requirement/security-policy/safety-constraint/allowed-action-type/risk_class/authority is rejected with a thrown error before any read or write — verified by a smoke test that asserts this rejection happens with **zero** rows written.
- **Rollout stages**: `observe → shadow → reviewed → enabled`. `proposeLearningParameterAdjustment` only ever writes `proposed_value` (bounds-clamped) and `evaluation_basis` — `current_value` never changes from a proposal. Only `promoteLearningParameter(id, "enabled")`, an explicit, separately-invoked, human-triggered call, moves `proposed_value` into `current_value` (and bumps `version`). No code path in this module calls that automatically — there is no scheduler or evaluation loop that self-promotes a parameter.

## Recommendation Planner

`recommendationPlanner.ts`'s `buildRecommendations` is a pure function (no I/O): converts warning/critical anomalies and active warning/critical predictions into `OperationalRecommendation`s, plus a forecast-derived recommendation only when the forecast meaningfully exceeds its own baseline (≥20%, so a flat/declining forecast never produces noise). Merges in the legacy adapter's recommendations. Dedups by `dedup_key` (domain + type + object), keeping the higher-severity, more-recent entry on a collision. Every recommendation has `capability_key: null` and `actionability` of `"review"` or `"informational"` — Programme 3 never marks anything as directly executable; any actionable follow-through is a human decision handed to Phase C's existing workflow/action architecture, not executed here.

## Proactive Intelligence

`proactiveDelivery.ts`'s `runProactiveDelivery` calls `NotificationService.sendToHome` directly — **no competing notification, cooldown, or preference architecture was built**. Programme 3's only additions on top of the existing, reused mechanism:

- A severity floor: `info`-severity recommendations are never proactively surfaced.
- A per-run delivery cap (`MAX_DELIVERIES_PER_RUN = 5`) — recommendations beyond the cap are explicitly accounted for (`reason: "over_delivery_cap"`), never silently dropped.
- Severity folded into the notification key (`kind: "recommendation:${severity}"`) — a genuine escalation (e.g. `attention → critical` on the same underlying issue) produces a **different** key, so it is never suppressed by an in-flight cooldown for the lower severity. This reuses `NotificationService`'s existing per-`(category, user, entity, kind)` cooldown mechanism (`notification_decisions`, `decideNotification`) rather than building a second one.
- `routing.source_type: "prediction"` — `NotificationSourceType` already included `"prediction"` as a first-class value before this pass; no new routing vocabulary was added.

Every proactively delivered notification's `payload` carries the recommendation's `reason`, `evidence_ids`, `domain`, and `suggested_action` in full — this is deliberate: "why are you telling me this?" is answered by reading that payload through the SAME conversational explain path described below, not a separate notification-explanation system.

Explicitly opt-in and separate from every conversational read: `runIntelligenceOrchestrator`'s `proactive` flag defaults to `false`, and none of the four conversational capabilities ever set it — asking "any predictions?" never fires a notification as a side effect.

**Known, named gap**: no live scheduled trigger is wired this pass (no BullMQ repeatable job). The evaluation/ranking/delivery-decision logic is a directly-callable, tested function (`runProactiveDelivery`), ready to be invoked from an event hook or a future repeatable job — but nothing calls it automatically in production yet. This is an honest, documented gap, not a claim of a live scheduler.

## Conversational Capabilities

`intelligenceCapabilities.ts` registers four `readModule`s in `ReadCapabilityModules.ts` (domain `"reports"`, reused rather than inventing a new `OyiDomain` value): `anomalies.read`, `predictions.read`, `forecasts.read`, `recommendations.read`. Each runs the full orchestrator (`persist: true, proactive: false`) and presents its own slice of the result. Programme 3 objects are adapted onto the existing `IntelligenceFact` shape (`factFromAnomaly`/`factFromPrediction`/`factFromForecast`/`factFromRecommendation`, each setting `value.reason`) so the whole existing follow-up machinery — `evidenceFromFact`, `factsFromEvidence`, `buildResultSetContext`, and critically `domains/explainAnswer.ts`'s `buildExplainAnswer` — works with zero new plumbing. This is what makes "why are you telling me this?" work without a separate explanation system, and what lets ambiguity resolution ("which one?") work identically to every other domain.

A real phrasing collision was found and fixed at the source: "forecast my electricity spending" previously matched `utilities.spending.read`'s supports() (which reacts to the word "spending") ahead of the new `forecasts.read`. `utilities.spending.read`'s supports() now explicitly excludes the word "forecast" — a one-line, additive exclusion, the same pattern already used elsewhere (e.g. `automations.list.read` excluding "run/failed" wording to avoid colliding with `automations.runs.read`).

## Home/Room Integration

A new `intelligence` contributor was added to both `HOME_CONTRIBUTORS` and `ROOM_CONTRIBUTORS` (`src/oyi-core/domains/roomHome/`). It runs the orchestrator with `persist: false, proactive: false` (a plain "how is my home?" must stay a pure read with no side effect), folds anomalies/predictions/recommendations into the aggregate as attention items (forecasts excluded — a trend is informational, not something needing attention), and reuses the aggregator's existing `dedupeAttentionItems` — a maintenance-aging anomaly and the maintenance contributor's own attention item for the same request collapse into one, keeping the higher severity. The Room contributor only surfaces items whose own `scope.room_id` matches the room in question, never the whole home's intelligence narrowed after the fact. Verified with the full `oyi-programme2-room-home-intelligence-smoke.mjs` suite passing unchanged after this addition (12/12), confirming no regression to Programme 2's accepted behavior.

## Tests

`scripts/oyi-programme3-prediction-forecasting-smoke.mjs` (17 checks, `npm run smoke:programme3-prediction-forecasting`): pure unit coverage for forecast methods (MAPE-zero-denominator honesty, backtest-vs-baseline, linear trend recovery), the learning boundary (forbidden name rejection with zero DB writes; allowed parameter create/propose/promote lifecycle), the recommendation planner's dedup/severity/never-actionable guarantees; live end-to-end orchestrator coverage for all four conversational capabilities, the "why" follow-up (including honest multi-candidate disambiguation), the Home aggregate's intelligence contributor, outcome evaluation (realized and not-realized cases), and proactive delivery (first delivery, cooldown suppression, severity-escalation bypass, info-severity exclusion, delivery cap). Registered in `validate:release`.

## Not Completed In Programme 3

- No live scheduled/event trigger for proactive delivery (see "Proactive Intelligence" above) — the logic is built and tested, not wired to a cron/queue.
- Outcome evaluation covers three prediction types (`device_reliability_risk`, `maintenance_sla_risk`, `automation_failure_risk`); `security_review_needed` and any legacy-adapter-sourced prediction type are honestly `unobservable` rather than guessed.
- Forecasting covers only utility spending — no consumption/usage/meter-balance forecast exists anywhere (no reliable source data), and no other domain's numerical forecast was built this pass.
- Learning parameters can be created, proposed, and promoted, but no automated evaluation loop yet proposes adjustments from real outcome data — the propose path is available to be called, not yet self-driving from `outcomeEvaluation.ts`'s results.
- No `oyi_prediction_outcomes`/`oyi_recommendation_outcomes` table distinct from `intelligence_feedback` — the spec's "potentially... only if needed" condition was not met; the existing generic table was sufficient.

The first two gaps above (no live proactive trigger, no automated learning-proposal loop) are explicitly Programme 4's Phase H and Phase I scope, respectively — not new work, closure of a documented, pre-existing gap.

## Programme 4 Phase H — Proactive Runtime Operationalization (closes the first gap above)

`src/oyi-core/runtime/proactiveIntelligenceScheduler.ts` adds the missing trigger only — it does not reimplement anomaly/prediction/recommendation/delivery logic. Per home per tick it calls `runIntelligenceOrchestrator({ ..., persist: true, proactive: true })` (same function and same `proactive` opt-in flag conversational capabilities deliberately never set) and `evaluateOpenPredictions({ estate_id, home_id })` — both pre-existing, already-tested Programme 3 functions.

Built on the repo's existing BullMQ worker infrastructure (`src/workers/automationWorker.ts`'s `Queue`/`Worker` pattern), started from `src/worker.ts` (the existing separately-deployed `start:workers` process) alongside `startAutomationWorker`/`startIntentWorker`/`startIntentDlqWorker` — no second scheduler mechanism introduced.

Requirements from the programme spec and how each is met:
- **Disabled by default**: `OYI_PROACTIVE_SCHEDULER_ENABLED` must be explicitly `"true"`; the repeatable job is never scheduled otherwise.
- **Bounded batch size**: `OYI_PROACTIVE_SCHEDULER_BATCH_SIZE` (default 25 homes/tick), via keyset-paginated `homes` query with wraparound so every home rotates through across ticks rather than the same first N being processed forever.
- **Per-run delivery cap**: `OYI_PROACTIVE_SCHEDULER_MAX_DELIVERIES_PER_RUN` (default 50) is a cross-home budget threaded through the batch loop, on top of `runProactiveDelivery`'s own existing per-home cap (5).
- **Tenant/home isolation**: each home gets a fresh scope (`estate_id`/`home_id`) and independent evidence loads; no shared mutable state between iterations.
- **Idempotency**: BullMQ's repeatable-job `jobId` prevents duplicate schedule registration; an in-process `runInProgress` guard prevents a slow tick overlapping the next one within a single worker process; `evaluateOpenPredictions`'s own `.eq("status", "open")` guard on prediction close is separately idempotent at the DB layer.
- **Failure isolation**: one home's evaluation throwing is caught, logged, and counted — the batch continues to the next home.
- **Observability**: `oyi_proactive_scheduler_ticks_total`, `_homes_processed_total`, `_homes_failed_total`, `_deliveries_sent_total`, `_deliveries_suppressed_total`, `_outcomes_evaluated_total`, `_tick_duration_ms` (via `operationalMetrics`), plus a structured `oyi_proactive_scheduler_tick_completed` log line per tick.
- **No physical execution**: only read/evaluate functions are called; no `ActionService`/`WorkflowService`/`execute` import anywhere in the file (grep-verified by `smoke:programme4-proactive-scheduler`).
- **No automatic learning promotion**: `promoteLearningParameter` is never imported or called (same grep verification) — that remains Phase I's explicit-review-only concern.

Regression coverage: `scripts/oyi-programme4-proactive-scheduler-smoke.mjs` (`npm run smoke:programme4-proactive-scheduler`), 11 structural checks. The underlying evaluation logic this scheduler invokes is already behaviorally verified end-to-end by `smoke:programme3-prediction-forecasting` — this script certifies only the new wiring, not a re-test of already-proven logic.

**Not done in this pass, honestly**: no live Redis/BullMQ environment was available to observe an actual scheduled tick firing end-to-end in this session — verification here is typecheck + build + structural smoke, not a live production run. Phase M (surface acceptance) or post-deploy verification should confirm the worker process actually picks up and executes the repeatable job in the real Render environment before this is considered fully proven in production, and the scheduler ships disabled (`OYI_PROACTIVE_SCHEDULER_ENABLED` unset) until that's done.

## Programme 4 Phase I — Outcome/Learning Operationalization (closes the second gap above)

`src/oyi-core/domains/intelligence/learningProposalPass.ts` is the automated PROPOSAL step only — it evaluates aggregate outcome quality and calls the existing, pre-built `proposeLearningParameterAdjustment` (`learningParameters.ts`); it never imports or calls `promoteLearningParameter`. Promotion stays exactly what it already was: an explicit, separately-invoked human action.

For each of the three prediction types `outcomeEvaluation.ts` actually evaluates (`device_reliability_risk`, `maintenance_sla_risk`, `automation_failure_risk` — never a type with no real evaluator, which would fabricate learning from nothing), it calls a new global aggregation function, `summarizeEvaluatedPredictionsByType` (added to `outcomeEvaluation.ts`, reusing the same `intelligence_feedback` outcome rows `evaluateOpenPredictions` already writes — no second evaluation pipeline). This is deliberately unscoped (cross-estate, cross-home): a single home rarely accumulates enough evaluated predictions to clear a sample threshold, and a learning parameter is a shared, global calibration, not something independently relearned per home.

Requirements from the programme spec and how each is met:
- **Minimum sample threshold**: `OYI_LEARNING_MIN_SAMPLE_THRESHOLD` (default 20). Below it, the type is reported `insufficient_evidence` with the actual sample size and threshold — never proposed.
- **Versioned proposal**: reuses `learningParameters.ts`'s existing `version`/`rollout_stage` machinery unchanged — proposals write only `proposed_value`, never `current_value`; version increments only happen inside `promoteLearningParameter`, never called here.
- **Reason/evidence basis**: every proposal carries `{ method: "empirical_accuracy_calibration", sample_size, realized, not_realized, accuracy, evaluated_at }`.
- **Bounds enforced**: the parameter row is seeded with explicit `[0, 1]` bounds (`getLearningParameter(..., { min: 0, max: 1 })`) before the first proposal, so `clampToBounds` is never a no-op for a brand-new parameter.
- **Forbidden namespaces still rejected**: parameter names are `prediction.<type>.confidence_calibration`, which `assertLearnableParameter` (unchanged, already existing) validates against the same forbidden-pattern/allowed-prefix checks as every other learning parameter.
- **No permissions/RLS/security/financial authority/confirmation/allowed-action-type changes**: proposals are confidence-calibration values only; `assertLearnableParameter`'s existing forbidden-pattern check (unchanged) is the actual enforcement, exercised on every call.
- **Insufficient evidence returns exactly that**: `{ status: "insufficient_evidence", sample_size, threshold }`, never a fabricated proposal.
- **Never fabricates learning**: the proposed value is the directly-observed empirical accuracy from real evaluated predictions — not an invented number, not extrapolated beyond the sample.

**A real bug was caught and fixed during testing, not just typechecked away**: the first implementation passed the freshly-computed accuracy as the fallback `current_value` when seeding a brand-new parameter row, which meant `current_value` silently took on a data-derived value on a parameter's very first proposal — a real violation of "never auto-promote," even though `promoteLearningParameter` itself was never called. The behavioral smoke test (`scripts/oyi-programme4-learning-proposal-smoke.mjs`, using a fake Supabase) caught this directly by asserting `current_value` stays untouched; fixed by seeding new parameters with a neutral `0.5` instead of the computed value.

Wired into the same BullMQ queue Phase H's scheduler already uses (`oyi-proactive-intelligence`), as a second, independently-flagged (`OYI_LEARNING_PROPOSAL_ENABLED`, separate from `OYI_PROACTIVE_SCHEDULER_ENABLED`) repeatable job with its own interval (`OYI_LEARNING_PROPOSAL_INTERVAL_MS`, default daily) — a deployment can run proactive delivery without learning proposals or vice versa. No second scheduler mechanism introduced.

Regression coverage: `scripts/oyi-programme4-learning-proposal-smoke.mjs` (`npm run smoke:programme4-learning-proposal`) — 6 behavioral checks against a fake Supabase (below-threshold skip, at-threshold proposal with correct bounds/evidence/non-promotion, idempotent re-run, structural no-auto-promotion, real-evaluator-only targeting), all passing. `scripts/oyi-programme4-proactive-scheduler-smoke.mjs` extended with 2 more checks for the independent enable flag and job wiring (now 12 total, all passing). typecheck/build clean.
