# Oyi Intelligence Permanent-Site Architecture

Status: Programme 3 complete — Prediction Standardization (Phase H), Numerical Forecasting (Phase I), Outcome Evaluation + Learning (Phase J), Proactive Intelligence (Phase K), built on Programme 2's Room/Home Intelligence, Programme 1's direct evidence + Deep Domain Conversation layer, and the Phase A/B/C durable conversation/workflow/action foundation.

## Target Lifecycle

Input / signal -> canonical evidence -> operational knowledge -> awareness -> reasoning -> anomaly / prediction -> recommendation -> capability -> workflow -> authority -> action -> verification -> outcome -> learning -> proactive intelligence.

## Conversation Lifecycle

Request -> normalize / interpret -> assemble context -> assemble candidates -> resolve target -> hydrate object -> resolve active workflow -> decide authority -> determine capability -> plan/load authorized evidence -> invoke domain intelligence -> compose read/draft/action response -> execute only when explicitly approved and allowed -> verify -> persist canonical turn/workflow/action -> adapt response to surface.

## Current Architecture Preserved

- One canonical conversation runtime in `src/oyi-core/runtime/canonicalConversationRuntime.ts`.
- Thin adapters in `src/oyi-core/runtime/canonicalConversationAdapters.ts`.
- Domain-specific behavior in `src/oyi-core/domains/*`.
- Target assembly, resolution and hydration remain separate.
- Office/Public, Consumer and Facility remain surfaces over one Oyi Core.
- Existing device command truth, Smart Access, wallet idempotency, communications handoff and conversation persistence remain protected.

## Phase A Implemented

- Enriched canonical evidence hierarchy.
- Final capability definition shape.
- Stronger enabled-capability executable guard.
- Home/Room contributor contracts.
- Prediction, anomaly and outcome contracts.
- Required conversation trace event vocabulary.
- Domain maturity matrix.

## Phase B Implemented

- `CapabilityService` evaluates capability rollout, surface, actor, permissions and scope before evidence loading.
- Enabled read capabilities now route through registry-owned handlers before legacy fallback.
- Capability-owned read responses now finalize through canonical conversation persistence and can appear in Oyi History/thread restoration.
- `What can you do?` is generated from `CapabilityService.listForActor(...)` and only advertises enabled, authorised capabilities.
- Internal/admin capability introspection is available at `GET /oyi/runtime/internal/capabilities`.
- Structured production traces are emitted for capability resolution, authority, evidence loading, handler completion and legacy fallback.
- Enabled read outcomes preserve distinct `answered`, `empty`, `unavailable`, `unsupported` and `permission_restricted` states.
- Wallet transaction evidence has parity with the existing home wallet relationship path and avoids raw internal references in resident-facing labels.
- Capability resolution no longer chooses the nearest enabled capability in the same domain when the exact semantic capability is not enabled.
- Resolved-but-not-enabled capabilities now return safe canonical fallback responses with explicit rollout/fallback metadata rather than generic runtime failure wording.
- Capability advertising no longer emits unrelated Home update presentation artifacts, and capability source metadata is deduplicated into useful resident-facing provenance labels.

## Phase B Enabled Scope (superseded by Programme 1 below — kept for history)

- Devices: status, availability, activity, failures, diagnosis, relationships and capabilities.
- Wallet: consumer home transaction history.
- Utilities: consumer home utility spending derived from wallet/service transaction evidence.
- Maintenance: consumer/facility maintenance request reads.
- Visitors: consumer/facility visitor access reads (access codes redacted).
- Global: capability/help advertising from the registry.

Security, Services, Community, Messages, Scenes, Automations, Reports, Home and Rooms remain registered below enabled until direct evidence ownership is complete.

## Direct Evidence — Maintenance & Visitors

- `loadMaintenanceRequestFacts`/`loadVisitorAccessFacts` (`src/oyi-core/domains/*/*.Evidence.ts`) query `maintenance_requests`/`visitor_access` directly via `supabaseAdmin`, modelled on the existing wallet transaction loader — never the client-supplied `input.relationships` the two domains previously read from.
- Scope is resolved server-side per surface: `home_id` for the consumer surface, `estate_id` for the facility surface, so a facility-wide read is never rejected for lacking a resident's home.
- A query failure returns an explicit `unavailable` fact (never a silent empty array), so "no open requests" and "could not check" remain distinguishable at every layer, including the final response.
- Visitor access codes are redacted (`redactAccessCredentialForConversation`) before they ever become conversation evidence.
- `maintenance.requests.read` and `visitors.pending.read` are now `enabled` `readModule`s in `ReadCapabilityModules.ts`, replacing their `declaredModule` stubs.
- Two previously-declared, zero-call-site Phase A safety guards are now real:
  - `assertEnabledCapabilityHasAdapter` (`CapabilityRollout.ts`) rejects registration of any capability marked `enabled` whose evidence collector is still the `declaredModule` placeholder (tagged via an `__isDeclaredStub` sentinel), catching a mis-flipped rollout status at startup rather than silently advertising a capability that loads nothing.
  - `assertClaimDoesNotPromoteUnavailable` (`contracts/evidence.ts`) is now called for every enabled read capability's response in `ConversationOrchestrator.ts`. A violation is caught and the result is downgraded to an honest `unavailable` answer rather than thrown raw, since nothing upstream of the canonical runtime currently guarantees an uncaught rejection here becomes a clean HTTP error.

## Phase C Implemented

- Conversation workflows and actions are durable backend records rather than thread metadata or process memory.
- `WorkflowService` owns create, restore, input save, transition, cancel, expire, supersede and action attachment.
- `ActionService` owns create, idempotent reuse, approve, transition, cancel, supersede, execution adapter invocation and verification recording.
- Supabase repositories provide production persistence; in-memory repositories remain test-only.
- Workflows/actions carry optimistic `revision` fields to prevent last-write-wins corruption.
- Device power/channel control is the first action capability integrated with the durable path.
- Device execution still goes through the existing device command pipeline and `ai_execution_ledger`; Oyi conversation actions do not call providers directly.
- Confirmation/cancellation turns restore active workflow state before creating any new action.
- Phase C correction makes workflow continuation first-class before ordinary capability routing: pending target/channel clarifications cannot fall through to device availability reads.
- Device action commands now extract exact named device, requested state and requested channel in one turn when all evidence is present.
- Pending workflow continuation is typed by missing input; target, channel, confirmation and cancellation replies are not interpreted by one generic fallback parser.
- Unrelated reads can still be served while a workflow remains pending, preserving durable continuation for the next compatible reply.
- Device action preparation now has stage-level production tracing from capability resolution through target resolution, durable workflow persistence, durable action persistence and confirmation response composition.
- Workflow/action thread references are treated as restoration/trace references rather than hard ordering dependencies on canonical conversation thread persistence.
- Preparation failures are localized as `target_resolution`, `workflow_persistence`, `action_persistence` or `action_preparation`, and all failure responses preserve the no-execution boundary.
- Final Phase C multi-gang correction enforces: multi-channel target plus unspecified channel means durable channel clarification; exact target plus explicit valid channel means exact durable confirmation. Oyi must not silently default to Channel 1 or all channels.
- Automated validation uses a fake device adapter and stops before physical execution.

## Programme 1 — Direct Evidence Expansion

Extends the Direct Evidence pattern proven on maintenance/visitors (above) to six more domains, in priority order: utilities, security, services, community, automations/scenes, wallet balance.

- `utilities.active.read` / `.tariff.read` / `.purchases.read` read `home_service_assignments`+`home_service_accounts` (shared with services), `estate_service_configs`, and `service_transactions`. `usage`/`balance`/`meter` were investigated and deliberately kept below enabled — no consumption series, maintained per-meter balance, or reading-series table exists anywhere in the schema; `home_service_accounts.balance`/`outstanding` are declared columns with zero write sites. `utilities.spending.read` (pre-existing) gained the `unavailable`-guard it was missing.
- `security.incidents.read` reads `facility_incidents` — the real, actively-written incident table, confirmed via write-site audit against the near-empty `operational_incidents` table used elsewhere. Failed-access-attempt data was proven not to exist anywhere (`smart_access_records` has zero insert sites; no `access_attempts`/`access_logs` table exists) and is never fabricated.
- `services.active.read` reuses the exact same service-account loader as utilities (unfiltered vs. utilities' `UTILITY_SERVICE_KEYS` filter) rather than duplicating the query.
- `community.latest.read` reads `community_posts`, ranking official/pinned/management posts ahead of chatter using the same `is_official` logic as the production `communityController.ts`.
- `scenes.list.read`, `automations.list.read`, `automations.runs.read` read `consumer_scenes`, `consumer_automations`, `consumer_automation_runs`. No execution capability was added.
- `wallet.balance.read` reads `wallets.balance`/`currency`/`is_frozen` (the pre-existing transaction loader only ever selected `wallets.id`).
- New `OperationalObjectType`/hydration-registry members: `security_incident`, `utility_tariff`, `utility_purchase`.
- `contributorSummary.ts` added: a generic `{domain, status, summary, facts, attention_items, severity, freshness, object_refs}` shape any mature domain's facts convert into, for a future Home/Room aggregator (not built).
- No database migration — every domain's evidence comes from existing tables.

## Programme 1 — Deep Domain Conversation

Closes the remaining Programme 1 gap: Oyi can continue a conversation about previously-returned operational objects across turns, generically — not via new hand-written branches in `oyiUnifiedIntelligenceService.ts` (that legacy engine's maintenance/visitor ordinal behavior is a *different*, untouched code path reachable only from `aiRoutes.ts`, not the capability pipeline this section describes).

Architecture: `DomainResult → canonical object references → thread result-set context → generic follow-up resolver → target hydration → domain capability → grounded response`.

- **Result-set context** (`src/oyi-core/context/resultSetContext.ts`): every capability answer's facts become an ordered `object_refs[]` (type, canonical id, label, timestamp, metric, status, generic attribute bag) plus `timeframe`/`filters`/`metric`/`selected_object_ref`. Persisted **per domain** (not a single overwritten slot) in the existing `oyi_conversation_threads.metadata.result_sets` JSONB map, with `metadata.active_domain` pointing at the one a bare follow-up resolves against — this is what makes "go back to that maintenance issue" possible after switching to Visitors mid-thread. No migration; a legacy single-slot shape from the first closure attempt is still read-compatible.
- **Generic follow-up resolver** (`src/oyi-core/interpretation/followUpResolver.ts`): domain-agnostic parsing of ordinal (first/second/third/last/latest/oldest — first/second/third/last use presented order, latest/oldest use timestamps), pronoun ("that one"/"it"), attribute ("the failed one"), filter ("show only the high priority ones" — narrows to a subset, accumulates in `filters`), why/status/field (who/when/where/how much), temporal follow-up, comparison, and domain-switch-back ("go back to..."). Wired into `ConversationOrchestrator.run()` ahead of normal capability routing (strangler pattern) — resolves only against the previous turn's own result set, never a broad re-query; returns `null` (falls through to normal/legacy routing) whenever there's nothing safe to resolve.
- **Grounded explain** (`src/oyi-core/domains/explainAnswer.ts`): "why" follows source-authored-reason → deterministic open-since-timeline → bare recorded status → honest "no reason recorded" — never invented causation.
- **Utility comparison**: temporal follow-ups re-invoke the *same* capability with the new message's own temporal wording (fixed a real bug in `temporalScopeFor` where "this/last week/month" fell through to a 6-hour "recent" window); "which was higher?" re-invokes `utilities.spending.read` for two complementary periods and diffs them via `buildUtilitySpendingComparisonAnswer`.
- **Ambiguity**: when a follow-up matches more than one candidate with no way to disambiguate, Oyi asks — it never guesses.
- **Hydration defects fixed**: `utility_meters`/`facility_assets` phantom-table entries removed (neither table exists; now honestly `unsupported`); `wallet_transactions.currency` (nonexistent column) removed from its hydration select; two previously-undiscovered missing aliases added — `visitor_access` and `automation_run` (the evidence loaders' real object types, which had no hydration entry at all, silently breaking "tell me more" for both).
- **Observability**: `oyi_followup_detected` plus per-turn `execution.orchestrator_v2.followup` (resolver, reference_type, source_domain, result_set_id, candidate_count, resolution_status, resolved_object_ref/type, hydration_status) and comparison metadata (comparison_metric, period_a, period_b, evidence_count, comparison_status).
- **Tests**: `oyi-programme1-deep-conversation-smoke.mjs` — live end-to-end orchestrator threads (with a fake Supabase) for maintenance, wallet, visitors, security, community, automations, scenes, services, and utilities, plus filter continuity, cross-domain switching, ambiguity clarification, and hydration-defect regressions.

## Programme 2 — Room Intelligence (Phase F) + Home Intelligence (Phase G)

Full detail in `OYI_ROOM_INTELLIGENCE.md` / `OYI_HOME_INTELLIGENCE.md`. Summary:

`DOMAIN EVIDENCE -> DOMAIN CONTRIBUTORS -> ROOM/HOME AGGREGATION -> COVERAGE + FRESHNESS -> ATTENTION + PRIORITY -> OPERATIONAL SUMMARY -> CANONICAL OBJECT REFERENCES -> PROGRAMME 1 FOLLOW-UP/DETAIL`.

- Contributor contract matured (not redesigned): `contributorSummary.ts` gained `coverage`/`source_health` fields, a 5-level severity scale aligned with the existing `CanonicalTruth.severity` vocabulary, and per-domain freshness reconciliation (`classifyFreshness`) — devices need near-live freshness, wallet facts are always historical, everything else in between.
- New `src/oyi-core/domains/roomHome/` module: `contributorTypes.ts` (the `Contributor`/`ContributorContext` interface), `homeContributors.ts` (10 contributors), `roomContributors.ts` (3 contributors — only domains with a real `room_id` relationship), `aggregator.ts` (parallel execution with per-contributor failure isolation), `aggregateContract.ts` (coverage/severity/overall-state/attention-dedup), `roomHomeAnswers.ts` (deterministic NL composition), `roomTargetResolution.ts` (room-name resolution for broad "how is X" questions), `roomHomeCapabilities.ts` (the 7 capabilities).
- Two real, previously-undiscovered production bugs fixed while wiring this up: `resolveRoomForRead` selected a nonexistent `rooms.metadata` column (real column is `ai_profile`) — natural-language room resolution was silently broken; the hydration registry's `home`/`room` entries selected a nonexistent `updated_at` column on both tables — direct home/room object hydration was silently broken. Both fixed with regression coverage.
- Multi-domain result-set continuity: Programme 1's thread-metadata result-set storage moved from a single overwritten slot to a `result_sets: {domain: ResultSetContext}` map (`resultSetContext.ts`), and `followUpResolver.ts`'s domain-switch detection was broadened from only "go back to X" to also recognize "tell me about the automation" / "what about the maintenance issue?" — this is what lets one broad Home/Room answer surfacing several domains support natural cross-domain drill-down, without a second follow-up system.
- No new database tables. No new evidence system. Every contributor is a thin wrapper around an existing Programme 1 loader.

## Not Completed In Programme 1

- Filter continuity is generic and works (see above), but only for keyword-style refinements against the already-presented list — it does not re-query with an additional server-side constraint.
- Financial/metric comparison is wired only for `utilities.spending.read`, not generically across all domains with a numeric metric.
- Forecasting and prediction evaluation persistence.
- Proactive notification integration.
- Durable action execution for wallet, visitors/access, maintenance, community, scenes, automations and other sensitive domains — Programme 1 is read/intelligence only, Phase C's action-safety boundary is unchanged.

Room and Home aggregation are now complete (Programme 2, above).

## Not Completed In Programme 2

- Scene/automation Room relevance derived indirectly from device-target membership (parsing `actions` JSON against a room's devices) — not built; scenes/automations remain Home-only contributors, documented as a real schema gap in `OYI_ROOM_INTELLIGENCE.md` rather than fabricated.
- `home.activity.read`/`room.activity.read` use a generic recency-ordered fact composition, not a purpose-built cross-domain activity feed with per-domain temporal bucketing (today/yesterday/overnight are approximated via the existing `temporalScopeFor` "recent" 6-hour fallback where a domain has no dedicated today/yesterday branch).
- No caching layer — every Room/Home answer re-queries current evidence live (deliberate, per §60: avoid caching unless profiling shows a need; ~10 contributors run in parallel, not sequentially).
- Forecasting, prediction, proactive/anomaly intelligence — explicitly out of scope for Programme 2 (Programme 3 territory).

## Programme 3 — Prediction + Forecasting + Outcomes/Learning + Proactive Intelligence

Full detail in `OYI_PREDICTION_LEARNING_MODEL.md`. Summary:

`CANONICAL EVIDENCE -> OPERATIONAL KNOWLEDGE -> ANOMALY -> PREDICTION -> FORECAST -> RECOMMENDATION -> OUTCOME -> EVALUATION -> LEARNING -> PROACTIVE SURFACING`.

- New `src/oyi-core/domains/intelligence/` module: `AnomalyDetector`/`PredictionProvider` registries (5 detectors, 4 providers — `device.offline_cluster`, `maintenance.aging`, `automation.failure_rate`, `security.incident_frequency`, `visitor.volume`, wrapped into `device.reliability`, `maintenance.risk`, `automation.reliability`, `security.pattern` predictions), a strangler adapter around the preserved, untouched legacy `predictionEngine.ts`, one real forecast (utility spending, `linear_trend` with baseline + backtested confidence interval), outcome evaluation against re-observed evidence, a bounded/versioned/human-gated learning-parameter module, a pure recommendation planner (dedup + rank, never marks anything actionable), and proactive delivery that calls the existing `NotificationService`/cooldown mechanism directly.
- Canonical contracts matured in place (not redesigned): `OperationalAnomaly`/`OperationalPrediction` extended additively; `OperationalForecast`/`OperationalRecommendation`/`ForecastOutcome` are new. Zero duplicate names introduced.
- Four new conversational capabilities (`anomalies.read`, `predictions.read`, `forecasts.read`, `recommendations.read`) and a new `intelligence` contributor in both `HOME_CONTRIBUTORS` and `ROOM_CONTRIBUTORS` — "why are you telling me this?" is answered entirely through Programme 1's existing grounded-explain/result-set machinery, no separate explanation system.
- No new prediction/forecast/outcome tables — `ochiga_intelligence_predictions` and `intelligence_feedback` (both real, generic, pre-existing) are reused. The one genuinely new table is `oyi_learning_parameters` (bounded/versioned tuning parameters, RLS-enabled, service-role only).
- Learning boundary enforced in code (`learningParameters.ts`'s `assertLearnableParameter`): anomaly/prediction/forecast/recommendation/ranking/notification-cooldown parameters are tunable; anything permission/RLS/financial-authority/confirmation/security-policy/safety-constraint/action-type-shaped is rejected before any read or write, with a smoke-tested regression guard.
- No automatic execution or auto-applied learning anywhere — every recommendation is `capability_key: null`; every learning proposal requires an explicit, separate `promoteLearningParameter(..., "enabled")` call that nothing in the codebase invokes automatically.

## Not Completed In Programme 3

- No live scheduled/event trigger wired for proactive delivery — the evaluation/ranking/delivery logic is a directly-callable, tested function, not yet attached to a cron/queue.
- Outcome evaluation covers three prediction types; anything else is honestly `unobservable`.
- Forecasting covers only utility spending — no consumption/usage/meter-balance source data exists anywhere in the schema.
- No automated loop yet proposes learning-parameter adjustments from real outcome data — the propose/promote path exists and is tested, not yet self-driving.

## Extension Pattern

To add or mature a domain:

1. Add direct evidence loader using `OyiEvidence`.
2. Define capability metadata using `OyiCapabilityDefinition`.
3. Implement deterministic authority and required permissions.
4. Add read/draft/execute/verify handlers as needed.
5. Add Home/Room contributors only when direct evidence exists.
6. Add prediction/anomaly/outcome hooks only when measurable evidence exists.
7. Add tests before moving rollout status to `enabled`.

## Production Enablement

Phase C introduces production migrations for durable conversation workflow/action state and a device-first explicit-confirmation action path. The production runtime correction adds a migration that relaxes workflow/action `thread_id` foreign keys so action preparation can occur before canonical turn persistence upserts the conversation thread, while preserving the `thread_id` value for trace and restoration. The final multi-gang correction requires explicit channel binding before confirmation for independently controllable multi-channel devices and does not require a new database migration.

The reload-durability correction makes restored thread state explicit: thread/message APIs expose a normalized `active_workflow` summary, and canonical chat requests can include that workflow reference as a continuity hint. The backend still reloads authoritative workflow state from durable storage and only accepts the reference when authenticated actor, surface, estate/home scope and canonical `thread_id` match. It deliberately does not restore physical-action workflows by broad actor/home scope.

Phase C does not include automated physical acceptance, financial mutations, access mutations, message send, scene execution, automation execution, Home aggregation, Room aggregation, forecasting or learning.

## Programme 4 Phase G — Programme 1/2/3 Integration Certification

Verified the full evidence-to-delivery chain shares one vocabulary set at each layer, by direct code inspection rather than assumption:

- **One evidence vocabulary.** `IntelligenceFact` (`contracts/canonicalConversation.ts`) is the single ground-truth shape every domain evidence loader produces (Programme 1). `OyiEvidence` (`contracts/evidence.ts`, used by pipeline-1 capability modules) is not a second, independently-invented evidence system — `evidenceFromFact()` (`ReadCapabilityModules.ts:53`) is the one conversion function that derives it from `IntelligenceFact`, adding only the privacy/authority-scoping metadata `CapabilityService` needs.
- **One truth-state vocabulary, by derivation not duplication.** `IntelligenceFact.truth_state` (`confirmed/observed/inferred/predicted/pending_confirmation/unavailable/unsupported/permission_restricted`) is set directly by domain evidence loaders. `OyiEvidence.truth_class` is derived from it inside the same `evidenceFromFact()` conversion (`unavailable`/`permission_restricted` pass through, everything else becomes `source_record`) — one source, one explicit mapping, not two independently-maintained classifications.
- **Severity is deliberately three-layered, not duplicated.** `SignalSeverity`/`OperationalAnomaly|Prediction|Recommendation.severity` (`info/attention/warning/critical` — no "nothing wrong" value, since a signal/anomaly/prediction only exists when there's something to report) is distinct from `ContributorSeverity` (adds `"none"` — a single domain's rollup contribution can have nothing to flag) which is distinct from `AttentionItem.severity` (adds `"normal"` — the final Home/Room-level presentation needs an explicit "all clear" state). Each layer answers a different question; verified no domain contributor writes an invalid cross-layer value.
- **One result-set/follow-up mechanism.** `domains/intelligence/intelligenceCapabilities.ts:147` calls `buildResultSetContext` from `context/resultSetContext.ts` directly — the same mechanism Programme 1/2 use, not a Programme-3-specific follow-up system.
- **One persistence model for canonical conversation turns.** Confirmed zero files under `domains/intelligence/**` or `domains/roomHome/**` touch `oyi_conversation_threads`/`oyi_conversation_messages` directly (grep-verified) — only `persistence/canonicalConversationPersistence.ts` owns that. Domain-specific tables these modules do write to directly (`ochiga_intelligence_predictions` via `predictionPersistence.ts`, `oyi_learning_parameters` via `learningParameters.ts`) are a different, appropriate concern, not conversation-turn state.
- **No duplicated evidence queries.** `domains/contributorSummary.ts`'s `buildContributorSummary` carries an explicit comment confirming it converts already-loaded Programme 1 facts into a Room/Home contributor shape and "never talks to a database itself" — Programme 2's aggregation reuses Programme 1's evidence loads rather than re-querying.
- **Programme 3 reuses Programme 2's aggregator, not a separate Home/Room system** — already verified and documented during Phase C (`OYI_PREDICTION_LEARNING_MODEL.md`, "Home/Room Integration"): the `intelligence` contributor added to `HOME_CONTRIBUTORS`/`ROOM_CONTRIBUTORS` reuses the aggregator's existing `dedupeAttentionItems`, confirmed via the full Programme 2 smoke suite passing unchanged (12/12) after the addition.

`smoke:programme1-deep-conversation`, `smoke:programme2-room-home-intelligence`, `smoke:programme3-prediction-forecasting` all pass end-to-end, confirming the chain from evidence through conversation persistence through prediction/outcome/proactive-delivery holds together as one system, not three coexisting systems.

## Programme 4 Phase J — Observability Closure

Audited existing tracing/logging before adding anything. Found it substantially more built-out than expected: `ConversationTracer` (`oyi-core/observability/ConversationTracer.ts`) already stage-traces every canonical turn through `request_received → context_loaded → turn_normalized → workflow_restored → turn_resolved → capability_selected → authority_decided → evidence_planned → evidence_loaded → response_composed → action_created → execution_started → verification_completed → persistence_completed → response_sent`, each stage logged with `request_id`/`correlation_id`/`runtime_id` and emitted as a `oyi_conversation_stage_latency_ms` histogram observation — this already covers "latency per major stage" and most of "traceable through request/context/target/capability/authority/evidence/handler/persistence" without any change needed. A working `/metrics` endpoint (`src/observability/http.ts::metricsHandler`, mounted at `GET /metrics` behind `requireInternalAccess`) already exposes every `operationalMetrics` counter in Prometheus format — confirmed this is real, consumed infrastructure, not dead code, before investing in adding to it.

No duplicate/conflicting observability vocabularies were found to remove — domain/surface/status labels are consistent across existing and new counters.

Against the spec's explicit counter list, found genuine gaps — several signals existed only as **log lines**, not **counters**, meaning they couldn't be cheaply aggregated via `/metrics` without external log tooling. Promoted the highest-value ones:

| Counter (new unless noted) | What it closes |
|---|---|
| `oyi_canonical_runtime_legacy_service_fallback_total` | **The most important gap.** The second-hop fallback from `canonicalConversationRuntime.ts` into the fully-legacy `oyiUnifiedIntelligenceService.ts` (reachable from `/ai/chat`, `/office/*`, `/communications/*`) had **zero** instrumentation — not even a log line. This is exactly the evidence Phase D's capability-truth-duplication retirement decision was blocked on ("requires proof... that native capability resolution never actually fails for those domains in production — not done in this pass"). Now measurable. |
| `oyi_legacy_prediction_adapter_calls_total` / `_latency_ms` | Promoted from the existing `oyi_legacy_prediction_adapter_used` log line, per Phase C's own noted retirement-criteria dependency. |
| `oyi_capability_resolution_total{outcome}` (`unsupported`/`permission_restricted`/`denied`/`allowed`) | Promoted from the existing `oyi_capability_authority_decided` log line. Covers "capability unsupported" and "permission restricted" from the spec's list in one counter. |
| `oyi_workflow_restored_total{source}` / `oyi_workflow_reference_rejected_total{reason}` | Promoted from existing `oyi_workflow_restored`/`oyi_workflow_reference_rejected` logs (`WorkflowService.ts`, both restore paths). The rejection counter is a bonus — it directly measures Phase F's "stale-context protection" (thread/actor/surface/scope/terminal/expired mismatches). |
| `oyi_action_transitions_total{domain, to_status}` | New. Every action status change (confirmed/cancelled/failed/unobservable/provider_rejected/etc.) already flows through one `ActionService.transition()` method — instrumented there once rather than at every caller. |
| `oyi_anomalies_generated_total` / `oyi_predictions_generated_total` / `oyi_forecasts_generated_total` / `oyi_recommendations_built_total` (labeled `triggered_by: conversational|scheduled`) | New. `runIntelligenceOrchestrator` had zero metrics despite being the single entry point for both conversational reads and Phase H's scheduler. |
| `oyi_outcome_evaluations_total{prediction_type, outcome}` | New, instrumented in `evaluateOpenPredictions` itself (not just Phase H's scheduler-level aggregate), so any future caller is covered too. |
| `oyi_proactive_deliveries_total{outcome, reason}` | New, at the `runIntelligenceOrchestrator` source (in addition to Phase H's scheduler-level `oyi_proactive_scheduler_deliveries_*_total`, which remain as tick-level summaries). |
| `oyi_learning_proposal_proposed_total` / `_insufficient_evidence_total` | Already added in Phase I. |

**Known remaining gaps, documented not silently dropped**:
- "Evidence unavailable" and "ambiguous target" are not yet discrete counters — they're diffuse across dozens of individual domain evidence loaders (`truth_state: "unavailable"`) and workflow clarification paths respectively. Promoting these would mean touching every evidence loader; left as a bounded, named gap rather than doing a sweeping cross-cutting change in this pass.
- "Proactive delivery... failed" (a genuine send failure, distinct from suppressed-by-policy) isn't cleanly distinguishable in `ProactiveDeliveryResult` today — `delivered: false` conflates "suppressed by cooldown/cap" and "attempted but the notification send itself failed" under one boolean. Not fixed here — would require a `proactiveDelivery.ts` contract change, which is Programme 3's code, not new Programme 4 territory, and the existing `reason` string field does distinguish the common cases informally.
- "Canonical turns" doesn't have a dedicated named counter, but is already derivable from `oyi_conversation_stage_latency_ms_count{stage="request_received"}` (the histogram's observation count) via the existing `ConversationTracer` — judged not worth a redundant counter for the same signal.

Re-ran the full regression sweep after these changes (typecheck, build, `smoke:programme1-deep-conversation`, `smoke:programme2-room-home-intelligence`, `smoke:programme3-prediction-forecasting`, `smoke:programme4-authority-privacy-closure`, `smoke:programme4-proactive-scheduler`, `smoke:programme4-learning-proposal`, `smoke:oyi-workflow-action-phase-c-reload`, `smoke:oyi-workflow-action-phase-c-multigang`, `smoke:command-lifecycle-truth`, `smoke:security-adversarial`, `smoke:compatibility-delegation`, `smoke:corporate-public-integration`, `smoke:office-internal-surface`, `smoke:canonical-runtime-structure`, `smoke:enterprise-intelligence-phase1`) — all clean, since these changes only added metric emission alongside existing logic, never changed behavior.

## Programme 4 Phase K — Failure Isolation / Performance

Audited every item on the spec's failure-isolation checklist by reading the actual handling code, not assuming it existed:

| Concern | Finding |
|---|---|
| Parallel evidence execution / one contributor failing inside Home/Room | Already correct — `domains/roomHome/aggregator.ts::runContributors` runs contributors in `Promise.all` with per-contributor `try/catch`, explicitly commented "§31: one contributor throwing must never fail the whole Room/Home answer." Returns `unavailableContributorSummary`, never fabricates. |
| Prediction detector / provider / legacy-adapter / forecast failure | Already correct — every detector/provider/adapter call in `intelligenceOrchestrator.ts` is wrapped in `.catch()`, degrading to `data_quality: "unavailable"` and a collected warning, never thrown past the orchestrator. |
| Persistence failure | Already correct — `intelligenceOrchestrator.ts`'s prediction/forecast persistence is `.catch()`-wrapped and logged (`oyi_intelligence_orchestrator_persist_failed`), never blocks the response. |
| Provider failures (device adapters) | Already correct — `oyi_provider_failures_total` counter present across Tuya/MQTT/ONVIF adapters; Tuya HTTP client has an explicit 15s timeout. |
| Redis failures | Already correct — `redis.on("error")` updates the health registry, increments `oyi_provider_failures_total{provider:"redis"}`, and respects `OYI_REDIS_RECONNECT_DISABLED` for a clean-disconnect escape hatch. |
| Queue failures | Already correct — every BullMQ worker (existing and Phase H/I's new one) has a `worker.on("failed", ...)` handler. |
| Notification failure | Already correct — `NotificationService.sendToHome` returns `{ error }` rather than throwing; `proactiveDelivery.ts` interprets that into a non-fabricated `delivered: false` result. |
| Timeout behavior | Present where it matters — Tuya client (15s), device-runtime-refresh race (1800ms, `Promise.race`) — not a gap. |
| Database failures | Consistent try/catch → `logger.warn` → graceful `unavailable`/`{error}` pattern throughout, verified repeatedly across every phase of this audit, not just this one. |

**No caching found that violates "never cache permission decisions across actors"** — grepped `capabilities/`/`authority/` directories specifically; there is no cache there at all (capability/authority decisions are computed fresh on every call).

**Real gaps found — profiling, not failure handling**: two of the spec's explicitly-named profile targets had zero latency instrumentation.
- `runIntelligenceOrchestrator` (the "intelligence orchestrator" / "prediction/forecast path" targets) had no timing at all. Added `oyi_intelligence_orchestrator_latency_ms` (labeled `triggered_by: conversational|scheduled` so scheduled-batch and per-turn latency aren't blended into a meaningless average) and `oyi_forecast_provider_latency_ms` around the utility-spend forecast call specifically.
- Home/Room aggregation latency (`aggregateLatencyMs`/`latencyByDomain`, already computed inside `runContributors` — see Phase K's contributor-isolation entry above) was **log-only** (`oyi_room_home_aggregate_completed`), invisible to `/metrics`. Promoted to `oyi_room_home_aggregate_latency_ms{aggregate_type}` and `oyi_room_home_contributor_latency_ms{aggregate_type, domain}` (per-domain as a label, not a separate metric per domain, to avoid unbounded cardinality growth as domains are added).

**Caching**: none added. Per the spec's own instruction ("do not add caching unless profiling proves it is necessary"), and with no live production load to profile against in this session, the correct action was to add the missing instrumentation so a *future* session with real traffic can make that call with evidence — not to guess at a caching layer now.

Regression: typecheck/build clean; `smoke:programme2-room-home-intelligence`, `smoke:programme3-prediction-forecasting`, `smoke:programme4-proactive-scheduler` re-verified passing (these three exercise every function touched in this phase). No behavior changes — purely additive instrumentation, same as Phase J.

## Programme 4 Phase L — Schema/Migration/Hydration Integrity

Cross-checked every table this session's own new code touches directly (`oyi_learning_parameters`, `ochiga_intelligence_predictions`, `intelligence_feedback`) plus a wider follow-up pass (execution ledger, notification decisions, and every Programme 1/2/3 direct-evidence loader) against the actual migration SQL, not assumption — the same methodology that previously found the `rooms.metadata`/`wallet_transactions.currency`/phantom-table bugs this repo's history references.

**Two real, previously-undetected functional bugs found and fixed**, both silent-failure cases exactly matching that pattern:

1. **`maintenanceEvidence.ts::loadMaintenanceRequestFacts`** selected `resident_id, category, priority` from `maintenance_requests` — none of these columns exist (base schema only has `user_id`; no later migration adds the other two; confirmed by reading `migrations/schema.sql` and every `ALTER TABLE maintenance_requests` in `supabase/migrations/`). The select always errored against real Postgres, so this loader silently returned `unavailable` on every call — **Programme 1's "Direct Evidence: maintenance... read from the database" work never actually worked**, despite existing, tested-looking code and a real git commit for it. The write path (`maintenance.controller.ts`) never surfaced this because its `insertWithSchemaFallback` helper silently drops any column Postgres reports missing on retry — masking the same schema drift from the other direction. Fixed: select only real columns (`user_id` instead of `resident_id`, `category`/`priority` dropped — `maintenanceFromRow`'s existing `|| null`/`|| "medium"` fallbacks already handle their absence safely, no other code change needed).
2. **`src/routes/activity.ts`**'s `devices` query in the activity feed selected `room_name` — not a real column on `devices` (it's derived via a join against a separately-loaded rooms map, as `deviceEvidence.ts` correctly does). This silently zeroed out the entire devices section of every user's activity feed. Fixed: removed from the select; the one downstream `device?.room_name` reference already degrades safely via `||` fallback to `category`/`type`.

**One privacy over-fetch found and fixed**: `src/ai/commandRouter.ts`'s `listAiLedger`/`listAiConfirmations`/`updateAiConfirmation` used `select("*")` on `ai_execution_ledger`, which has `actor_email` and `prompt_excerpt` (raw user prompt text) columns — returned unredacted to any authenticated user via `GET /ai/executions`, `GET /ai/confirmations`, `POST /ai/confirmations/:id/confirm|cancel`, scoped only by `home_id`/`estate_id` — meaning any other resident in the same home, or staff in the same estate, could read every other actor's email and raw prompt text. Fixed with a `publicLedgerRecord()` redaction function mirroring the pattern `deviceCommandExecutionStore.ts::publicRecord()` already uses for the same table, applied at all three return points.

**One missing index found and fixed**: `intelligence_feedback` had zero indexes beyond its primary key, despite being queried by `(object_type, feedback_type, object_id)` in `outcomeEvaluation.ts` (existing, Programme 3) and this programme's new global `summarizeEvaluatedPredictionsByType` (Phase I, now run daily via the scheduler). Added `idx_intelligence_feedback_lookup` via a new additive migration (`20260814203000_intelligence_feedback_lookup_index.sql`).

**Everything else checked came back clean** (verified, not assumed): `oyi_learning_parameters`, `ochiga_intelligence_predictions`, `oyi_conversation_threads`/`messages`, `oyi_conversation_workflows`/`oyi_actions`/`oyi_action_events`/`oyi_action_evidence`, `ai_execution_ledger`'s columns themselves (only the `select("*")` exposure was wrong, not the schema), `user_notification_preferences`/`notification_decisions`, `operational_delivery_outbox`, `devices`/`device_states`/`rooms`/`audit_events` (deviceEvidence.ts itself — the activity.ts bug was a separate, unrelated call site), `wallets`/`wallet_transactions` (confirmed the previously-fixed `currency` bug stays fixed — neither loader queries that column), utility/service tables, `consumer_scenes`/`consumer_automations`/`consumer_automation_runs`, `device_events`, `rooms` (roomHome).

**Two tables flagged for follow-up, not fixed (out of scope for a code change)**: `visitor_access` and `community_posts` are real, heavily-used, correctly-queried tables, but their base `CREATE TABLE` statement is missing from tracked migration history (only later `ALTER TABLE`s exist) — a documentation/history gap, not a schema bug. Noted so a future session doesn't waste time treating them as phantom tables.

**Minor, low-priority index gaps noted but not acted on** (would need production query-frequency evidence to justify, per Phase K's own "don't add without profiling" principle): `maintenance_requests` has no index on `home_id` (every resident conversation's filter column); `device_events` has no estate-only index for the facility/estate-scoped prediction path; `facility_incidents`'s existing index sorts by `created_at` while the query orders by `opened_at`.

Added `scripts/oyi-programme4-schema-hydration-smoke.mjs` (`npm run smoke:programme4-schema-hydration`) as a regression guard for the two column-mismatch bugs specifically — asserts the bad column names can never silently reappear in either select. This exists because the *existing* smoke coverage for both files uses fake Supabase mocks that don't enforce real column existence, which is exactly why these bugs went undetected in the first place; a structural source-text check closes that blind spot cheaply without needing a real database.

Regression: typecheck/build clean; `smoke:direct-evidence-maintenance-visitors`, `smoke:command-lifecycle-truth`, `smoke:consumer-facility-scope-privacy`, `smoke:security-adversarial`, `smoke:intelligence-fabric-phase2`, `smoke:programme1-deep-conversation`, `smoke:programme2-room-home-intelligence`, `smoke:programme3-prediction-forecasting`, `smoke:direct-evidence-programme1`, `smoke:full-circle-intelligence-acceptance` all re-verified passing.
