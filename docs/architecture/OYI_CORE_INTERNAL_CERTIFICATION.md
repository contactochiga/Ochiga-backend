# Oyi Core Internal Certification

**Programme 4 — Unified Oyi Core Closure.** This is the closing document for the strangler/cleanup/certification programme that followed Programmes 1–3 (Direct Evidence + Deep Conversation, Room/Home Intelligence, Prediction/Forecasting/Outcomes/Learning/Proactive Intelligence). It does not redesign Oyi Core, and it does not rewrite Programmes 1–3. It proves — with evidence, not assertion — whether Oyi is now one coherent production operating-intelligence system, closes the gaps found, and records what remains open.

Permanent principle this document certifies against: **ONE OYI CORE.** Everything else is a thin compatibility adapter, an evidence/data source, a presentation adapter, or retired.

Detailed phase-by-phase evidence lives in the docs this one indexes — `OYI_INTELLIGENCE_PERMANENT_SITE.md`, `OYI_PREDICTION_LEARNING_MODEL.md`, `OYI_CAPABILITY_MODEL.md`, `OYI_WORKFLOW_ACTION_MODEL.md`, `OYI_DOMAIN_MATURITY_MATRIX.md`, `PLATFORM_CLEANUP_ROADMAP.md`. This document is the synthesis, not a duplicate.

---

## 1. Canonical architecture diagram

```
                     ┌────────────────────────────────────────────┐
                     │            ConversationOrchestrator          │
                     │   src/oyi-core/orchestration/                │
                     │   ConversationOrchestrator.ts                 │
                     │                                                │
                     │   parse → workflow restore → capability        │
                     │   resolve → authority → evidence → answer →    │
                     │   persist → respond                            │
                     └───────────────┬────────────────┬─────────────┘
                                     │                │
                    capability match found     no capability match
                                     │                │
                         ┌───────────▼─────┐   ┌──────▼─────────────────────┐
                         │ CapabilityRegistry│   │ LegacyConversationAdapter   │
                         │ + CapabilityService│  │ → canonicalConversationRuntime│
                         │ (native modules:   │   │ → (exact-target short-circuit│
                         │  15 domains)        │   │    or) oyiUnifiedIntelligence│
                         └───────────┬─────┘   │    Service (legacy engine)   │
                                     │           └──────┬──────────────────────┘
                                     │                  │  measured via
                                     │                  │  oyi_canonical_runtime_
                                     │                  │  legacy_service_fallback_total
                    ┌────────────────▼──────────────────▼───────────┐
                    │         Evidence / Domain layer                 │
                    │  IntelligenceFact (Programme 1 loaders, one      │
                    │  per domain) → evidenceFromFact() → OyiEvidence  │
                    │  (capability envelope with privacy/authority)    │
                    └────────────────┬─────────────────────────────────┘
                                     │
        ┌────────────────────────────┼───────────────────────────────┐
        │                             │                               │
┌───────▼────────┐         ┌──────────▼─────────┐         ┌───────────▼──────────┐
│ Room/Home        │         │ Intelligence          │         │ Workflow/Action        │
│ aggregation        │         │ Orchestrator           │         │                        │
│ (Programme 2)       │         │ (Programme 3)          │         │ WorkflowService +      │
│ runContributors:    │         │ anomalies + predictions │         │ ActionService +        │
│ parallel, isolated,  │         │ + forecasts + recomms   │         │ executionLedger        │
│ per-contributor      │         │ → legacyPredictionAdapter│        │ (device domain          │
│ try/catch            │         │   (camera_anomaly,       │        │  certified end-to-end;  │
│                     │         │    power_or_network_     │         │  device execution shared│
│                     │         │    instability only)      │        │  with ai/commandRouter  │
└─────────────────────┘         └──────────┬───────────────┘         │  via one executor)      │
                                             │                        └───────────┬────────────┘
                              proactive:true │                                    │
                                             ▼                                    │
                              ┌──────────────────────────┐                        │
                              │ proactiveIntelligence      │                       │
                              │ Scheduler (Phase H, BullMQ) │                      │
                              │ — daily learningProposalPass │                     │
                              │   (Phase I, proposal-only)   │                     │
                              └──────────────────────────┘                        │
                                                                                    │
                    ┌───────────────────────────────────────────────────────────────┘
                    ▼
     ai/commandRouter.ts — Watch's (/watch/*) sole action-orchestration authority.
     Shares the same physical executor (executeDeviceCommandForActor) and same
     ai_execution_ledger truth table as the canonical path, but a DIFFERENT
     conversational confirmation state machine. Migration deferred (Phase F) —
     touches live physical execution, no hardware available to verify against.
```

All four conversation-turn surfaces (`/oyi/chat`, `/ai/chat`, `/office/conversation/*`, `/communications/*`) enter at the top of this diagram. `/oyi/awareness` and `/oyi/threads*` are documented, measured, read-only compatibility routes that call `oyiUnifiedIntelligenceService.ts` directly (never independently reason/act) — see §3.

## 2. Canonical runtime owners

| Concern | Owner |
|---|---|
| Conversation orchestration | `src/oyi-core/orchestration/ConversationOrchestrator.ts` |
| Capability truth | `src/oyi-core/capabilities/CapabilityRegistry.ts` + `CapabilityService.ts` |
| Evidence | `src/oyi-core/contracts/canonicalConversation.ts` (`IntelligenceFact`, the one ground-truth shape) + `contracts/evidence.ts` (`OyiEvidence`, the capability-layer envelope derived from it) |
| Workflow state | `src/oyi-core/workflows/WorkflowService.ts` |
| Action state | `src/oyi-core/actions/ActionService.ts` |
| Anomaly/prediction/forecast/recommendation | `src/oyi-core/domains/intelligence/intelligenceOrchestrator.ts` |
| Outcome evaluation | `src/oyi-core/domains/intelligence/outcomeEvaluation.ts` |
| Learning proposals | `src/oyi-core/domains/intelligence/learningProposalPass.ts` + `learningParameters.ts` |
| Proactive delivery trigger | `src/oyi-core/runtime/proactiveIntelligenceScheduler.ts` |
| Room/Home aggregation | `src/oyi-core/domains/roomHome/aggregator.ts` + `roomHomeCapabilities.ts` |
| Conversation-turn persistence | `src/oyi-core/persistence/canonicalConversationPersistence.ts` |
| Observability | `src/oyi-core/observability/ConversationTracer.ts` + `ConversationMetrics.ts` + `src/observability/metrics.ts` (`/metrics`, Prometheus) |

## 3. Surface authority map

| Surface | Entry point | Resolves through |
|---|---|---|
| Consumer, Facility | `POST /oyi/chat`, `POST /oyi/runtime/conversation` | `ConversationOrchestrator` directly |
| Consumer | `POST /ai/chat` | `ConversationOrchestrator` directly (migrated Programme 4 Phase B) |
| Office corporate/public | `POST /office/conversation/corporate` | `ConversationOrchestrator` directly, wrapped by `corporatePublicConversationPolicy.ts` (deny-gate + advisory CRM/handoff tool proposals — never executes; Programme 8 scope for native capability-module conversion) |
| Office internal | `POST /office/conversation/internal` | `ConversationOrchestrator` directly, wrapped by `corporateOfficeInternalPolicy.ts` (same pattern) |
| Communications (public/office-internal/support voice+visual) | `/communications/*` | `ConversationOrchestrator` directly (migrated Programme 4 Phase B) |
| Consumer/Facility (read-only, legacy shape) | `GET /oyi/awareness`, `GET /oyi/threads*` | `oyiUnifiedIntelligenceService.ts` directly — documented compatibility-only, measured (`oyi_compatibility_route_calls_total`), read-only |
| Watch | `/watch/command`, `/confirm`, `/cancel` | `ai/commandRouter.ts` — separate action-orchestration authority (§10 below), not migrated |
| Office (organizational supervision) | `/intelligence/*` | `intelligence-core/*` — deliberately frozen legacy layer, explicit code freeze note, genuinely separate concern from Oyi's conversational answer surface |

Privacy/authority model (Programme 4 Phase E, `CapabilityService.ts`): `privacyAllowed()` blocks `resident_private`/`household_private` evidence from `office_internal`/`public_corporate`; `financial_sensitive` from every non-`consumer` surface; `credential_sensitive` from all read capabilities, any surface; `facility_sensitive` from `office_internal`/`public_corporate` (fixed this programme — was previously unchecked). `publicSurfaceDenied()` blocks `public_corporate` from all 14 operational domains as a hard blocklist independent of what a capability module declares. `scopeAllowed()` plus `resolveOisContext`'s real Supabase membership check (`src/services/context/contextResolutionService.ts`) together prevent scope escape for every role, not just residents. Regression: `smoke:programme4-authority-privacy-closure` (13 checks).

## 4. Evidence model

One ground-truth shape (`IntelligenceFact`, Programme 1's contribution) produced by one direct-evidence loader per domain. `OyiEvidence` (the capability-authorization envelope, adding `privacy_class`/`authorised_scope`) is derived from it by exactly one conversion function, `evidenceFromFact()` — not an independently maintained parallel system. `truth_state` (fact-level) and `truth_class` (envelope-level) are similarly one-directional derivations, not two competing classifications. Verified Programme 4 Phase G.

## 5. Capability model

`CapabilityRegistry` + `CapabilityService` are the one capability truth for 15 domains (`home, rooms, devices, visitors, security, maintenance, wallet, utilities, services, community, messages, scenes, automations, reports, global`). Two known, bounded, documented gaps (Programme 4 Phase D):
- 5 domains (`access, transactions, cameras, notifications, incidents`) have no native capability module — `domainCapabilityRegistry.ts` (pipeline-2-only) is the sole capability truth for these. Building native modules is new implementation, deliberately not rushed to close an audit checkbox — `access`/`cameras` touch unlock/credential/live-view territory.
- The 15 overlapping domains are latently duplicated in `domainCapabilityRegistry.ts` too, reachable only via the `LegacyConversationAdapter`/`canonicalConversationRuntime` fallback (not first-line). Retiring that overlap needs the Phase J fallback counter to prove native resolution never actually fails for those domains in production — not yet available (needs live traffic).

`PUBLIC_CORPORATE_SURFACE_POLICY` and `AI_TOOL_REGISTRY` are NOT capability-truth duplicates — the former is a surface-safety deny-gate for an anonymous-actor class, the latter belongs to the separate Watch action authority (§10).

## 6. Context/target model

`OisContext` (server-resolved membership scope, `resolveOisContext`) + `ResolvedTurn`/`CanonicalTarget` (per-turn target resolution, `canonicalTargetHydrationRegistry.hydrateCanonicalTarget` — the one genuinely shared seam between pipeline 1 and pipeline 2). `resultSetContext.ts` is the one result-set/follow-up mechanism, confirmed reused (not reinvented) by Programme 3's intelligence capabilities (Phase G).

## 7. Conversation model

`ConversationOrchestrator.run()` — parse semantic frame → restore workflow → resolve capability → decide authority → collect evidence → build answer → persist → respond, each stage traced (`ConversationTracer`) and latency-observed (`oyi_conversation_stage_latency_ms`). One persistence model for canonical conversation turns (`canonicalConversationPersistence.ts`, `oyi_conversation_threads`/`oyi_conversation_messages`) — confirmed (Phase G) that no Programme 2/3 domain file touches these tables directly.

## 8. Home/Room model

`domains/roomHome/aggregator.ts::runContributors` — every domain contributor runs in parallel (`Promise.all`) with per-contributor `try/catch` isolation (one contributor throwing never fails the whole answer), per-domain latency captured and (Programme 4 Phase K) now exposed as `oyi_room_home_aggregate_latency_ms`/`oyi_room_home_contributor_latency_ms` (previously log-only). Programme 3's `intelligence` contributor reuses this same aggregator and its `dedupeAttentionItems` — confirmed not a separate Home/Room system (Phase G).

## 9. Prediction/anomaly/forecast model

`intelligenceOrchestrator.ts` is the single entry point for both conversational reads (`proactive: false`) and the Phase H scheduler (`proactive: true`) — never a source of notification side effects from a plain question. Native detectors/providers cover `device_anomaly`/`reliability`, `maintenance_aging`/`risk`, `automation_failure_rate`/`reliability`, `security_incident_frequency`/`pattern`, `visitor_volume`. The legacy strangler adapter (`legacyPredictionAdapter.ts` → `intelligence-core/predictionEngine.ts`) remains load-bearing for exactly two classes with no native equivalent: `camera_anomaly`, `power_or_network_instability` — documented retirement criteria in `OYI_PREDICTION_LEARNING_MODEL.md`. One real forecast exists (`utility_spend`, linear trend, backtested) — deliberate, not an oversight (no other reliable time-series source in the schema). Now latency-profiled (`oyi_intelligence_orchestrator_latency_ms`, `oyi_forecast_provider_latency_ms` — Phase K, previously zero instrumentation).

## 10. Workflow/action model

`WorkflowService` + `ActionService` + `executionLedger` own draft → clarification → confirmation → approval → cancellation → execution → verification → restoration → outcome for the device domain, certified end-to-end (reload restoration, cancellation, confirmation, explicit multi-gang channel, stale-context protection, monotonic lifecycle, unobservable handling, no-execution-from-read-intent — all regression-tested). Every action status transition is now counted at one instrumentation point (`ActionService.transition()` → `oyi_action_transitions_total`, Phase J).

**One confirmed, deliberately-deferred gap**: `ai/commandRouter.ts` is a second, live (not fallback-only) action-orchestration authority for `/watch/*`. Physical device execution itself is **not** duplicated — both paths call the same `executeDeviceCommandForActor(...)` and share the same `ai_execution_ledger` truth table — only the conversational confirmation state machine above it differs. Migration explicitly deferred per user decision (Phase F): touches live physical-device execution, no hardware available in this programme to verify a migration against. Top-priority item for a dedicated future pass with real device testing.

Non-device action domains (visitor approve/reject, maintenance assignment, CRM/handoff proposals) are explicitly Programme 8 scope, not expanded here.

## 11. Outcome/learning model

`evaluateOpenPredictions` re-checks eligible open predictions (≥24h old) against **current** evidence via the same Programme 1 loaders the originating provider used — never infers success from engagement. Writes to `intelligence_feedback` (now indexed — Phase L). `learningProposalPass.ts` (Programme 4 Phase I) closes the "no automated proposal loop" gap Programme 3 left open: aggregates global (cross-home) outcome accuracy per prediction type, gated by a minimum sample threshold (default 20, `OYI_LEARNING_MIN_SAMPLE_THRESHOLD`), and calls the pre-existing `proposeLearningParameterAdjustment` — never `promoteLearningParameter` (grep-verified, never imported). Promotion remains exclusively an explicit, separately-invoked human action. A real bug (proposal accuracy leaking into `current_value` on first parameter creation) was caught by a behavioral test before shipping, not left for production to find.

## 12. Proactive runtime

`proactiveIntelligenceScheduler.ts` (Programme 4 Phase H) closes Programme 3's other documented gap ("no live scheduled/event trigger"). Built on the repo's existing BullMQ worker infrastructure (`src/workers/automationWorker.ts`'s pattern), started from the existing separately-deployed `start:workers` process — no second scheduler mechanism. Two independently-flagged repeatable jobs on one queue: the per-home proactive tick (`OYI_PROACTIVE_SCHEDULER_ENABLED`, default off) and the daily learning-proposal pass (`OYI_LEARNING_PROPOSAL_ENABLED`, default off). Bounded batch (keyset-paginated, wraparound rotation), cross-home delivery budget on top of the existing per-home cap, per-home failure isolation, in-process overlap guard, full observability. **Ships disabled by default** — no live Redis was available in this session to observe an actual tick firing end-to-end; enabling in production should follow a real verification pass, not this document's say-so (§17).

## 13. Persistence model

Conversation turns: `oyi_conversation_threads`/`oyi_conversation_messages` (one owner, §7). Workflow/action: `oyi_conversation_workflows`/`oyi_conversation_workflow_inputs`/`oyi_actions`/`oyi_action_events`/`oyi_action_evidence` — fully indexed, status enums verified to match code exactly (Phase L). Predictions: `ochiga_intelligence_predictions` (shared by native and legacy paths, discriminated by `metadata.kind`). Outcomes: `intelligence_feedback` (generic, reused — now indexed, Phase L). Learning: `oyi_learning_parameters` (the one genuinely new table Programme 3 needed; RLS-enabled, no relationship to permissions/security/financial-authority tables). Watch/legacy action execution truth: `ai_execution_ledger` (shared physical-execution truth with the canonical device path, §10).

## 14. Observability model

`ConversationTracer` traces every canonical turn through 15 named stages, each stage-latency-observed. `/metrics` (Prometheus, `requireInternalAccess`-gated) exposes the full `operationalMetrics` registry — confirmed real, consumed infrastructure before investing further in it (Phase J). Programme 4 promoted 6 previously log-only signals to counters and added 4 new ones at their single correct instrumentation point each (not scattered per-caller): most importantly `oyi_canonical_runtime_legacy_service_fallback_total`, which had **zero** instrumentation before this programme despite being exactly the evidence needed to eventually retire the capability-truth duplication in §5. Full list in `OYI_INTELLIGENCE_PERMANENT_SITE.md`, "Programme 4 Phase J". Two counters explicitly not built (evidence-unavailable, ambiguous-target — too diffuse for a bounded pass; proactive-delivery "failed" vs "suppressed" — needs a Programme 3 contract change) are documented gaps, not silent omissions.

## 15. Remaining legacy adapters

See §3/§5/§10/§11 above and the full "RETAINED AS ADAPTER" table in `PLATFORM_CLEANUP_ROADMAP.md`, "Programme 4 Phase O": `LegacyConversationAdapter` + `canonicalConversationRuntime` + `oyiUnifiedIntelligenceService`; `legacyPredictionAdapter` + `intelligence-core/predictionEngine`; `ai/commandRouter` + `ai/toolRegistry`; `domainCapabilityRegistry`; `intelligence-core/*` (~20 files, frozen organizational-supervision layer). Every one of these has a documented reason it's still needed and, where applicable, a documented retirement criterion.

## 16. Retired components

12 files deleted (5 orphaned oyi-core stubs with confirmed canonical replacements; 7 never-instantiated intelligence-core adapter classes) plus ~700 lines of dead functions removed from two otherwise-live files (`intelligenceMemoryService.ts`, `aiRoutes.ts` — the latter's entire pre-Programme-4-Phase-B `/ai/chat` narrative-building pipeline). Two Phase A dead-code findings were themselves wrong and corrected before deletion: `canonicalConversationTestSupport.ts` (load-bearing for ~15 smoke scripts — the original search only checked `*.test.ts` files) and `learningParameters.ts`/`outcomeEvaluation.ts` (now genuinely live via §11/§12). Three files retained temporarily (test-only dependency, deletion deferred pending verification of what their sole remaining smoke-test caller actually protects). Full manifest: `PLATFORM_CLEANUP_ROADMAP.md`, "Programme 4 Phase O".

## 17. Production scheduler status

**Not yet verified live.** `proactiveIntelligenceScheduler.ts` is built, typechecked, built, and structurally regression-tested (`smoke:programme4-proactive-scheduler`, 12 checks), but no live Redis/BullMQ environment was available in this development session to observe an actual scheduled tick fire end-to-end. Ships with both jobs disabled by default (`OYI_PROACTIVE_SCHEDULER_ENABLED`, `OYI_LEARNING_PROPOSAL_ENABLED` both unset). **Before enabling in production**: deploy, confirm the `start:workers` process picks up and executes at least one tick of each job, then enable via environment variable — not before.

## 18. Active migrations

Programme 4 added two additive migrations, both safe (no drops, no destructive updates):
- `20260814090000_oyi_learning_parameters.sql` (Programme 3, verified clean in Phase L)
- `20260814203000_intelligence_feedback_lookup_index.sql` (Programme 4 Phase L — closes a real missing-index gap on a table now queried daily by the learning-proposal pass)

No schema was fabricated. Two real column-mismatch bugs were fixed in *application code*, not by adding columns that were never part of the product (`maintenance_requests.resident_id/category/priority`, `devices.room_name` — see §19 and `OYI_INTELLIGENCE_PERMANENT_SITE.md`, "Programme 4 Phase L").

## 19. Known limitations

- Watch's action authority remains unmigrated (§10) — deferred, not resolved.
- 5 domains have no native capability module (`access, transactions, cameras, notifications, incidents`, §5).
- The 15-domain capability-truth overlap (§5) can't be retired yet — needs live fallback-counter evidence.
- `legacyPredictionAdapter.ts` can't be retired until `camera_anomaly`/`power_or_network_instability` have native detectors (§9).
- Proactive scheduler and learning-proposal pass are unverified against a live queue (§17).
- `visitor_access` and `community_posts` tables are real and correctly used but their base `CREATE TABLE` migration is missing from tracked history — a documentation gap, not a schema bug (Phase L).
- Physical device acceptance (Programme 4 Phase N) was not run — no hardware authorization exercised this session, per explicit user decision.
- Authenticated surface acceptance (Programme 4 Phase M) was not run — no production credentials available in this session; deferred to the deployment step per explicit user decision.

## 20. Programme acceptance evidence

Every phase A–O has a dedicated write-up with direct evidence (file:line references, migration cross-checks, smoke-suite results) in the docs this document indexes. Summary verdicts:

| Phase | Verdict |
|---|---|
| A — Intelligence runtime inventory | Complete — full classification table, corrected across later phases as new evidence emerged |
| B — Conversation authority closure | Complete — all 4 turn surfaces unified; 2 compatibility routes documented as compliant fallbacks |
| C — Legacy intelligence-core closure | Complete — confirmed already-correct freeze boundary; retirement criteria documented |
| D — Capability truth closure | Complete — unified for 15/20 domains; remaining gap bounded and evidenced |
| E — Authority + privacy closure | Complete — one real gap found and fixed (`facility_sensitive`), one false alarm ruled out with evidence |
| F — Action/workflow single authority | Complete for device domain; Watch migration explicitly deferred by user decision |
| G — Programme 1/2/3 integration certification | Complete — one vocabulary/persistence model confirmed, not assumed |
| H — Proactive runtime operationalization | Built, structurally verified; live-fire verification pending (§17) |
| I — Outcome/learning operationalization | Built, behaviorally verified (caught and fixed a real bug pre-ship) |
| J — Observability closure | Complete — critical fallback-usage gap closed; 2 minor gaps documented |
| K — Failure isolation / performance | Complete — failure handling already correct throughout; 2 profiling gaps found and fixed |
| L — Schema/migration/hydration integrity | Complete — 2 real functional bugs + 1 privacy leak + 1 missing index found and fixed |
| M — Surface acceptance | Deferred to deployment (no credentials available; explicit user decision) |
| N — Physical device acceptance | Stopped at dry-run (no hardware authorization exercised; explicit user decision) |
| O — Dead code / retirement pass | Complete — 12 files + ~700 lines removed; 3 retained pending test-coverage review |

**Final verdict: `OYI_CORE_CLOSURE_PARTIAL — BLOCKER REMAINS`.**

Not because the internal architecture is unsound — every phase's own evidence shows a coherent, well-instrumented, honestly-degrading system with one canonical conversation authority. The blockers are specifically: (1) Phases M and N were explicitly deferred/stopped by user decision, not completed, and the spec's own acceptance criteria treat authenticated and physical acceptance as mandatory; (2) the proactive scheduler has never been observed running against a live queue. Both are closeable in the deployment step that naturally follows this document, not further architecture work.