# Wave 6 Slice 7 — Legacy Awareness Retirement Audit

**Status:** Read-only audit deliverable. No application code was modified to produce this document — see "Implementation performed" below for the final disposition.
**Starting HEAD:** `bb303211b39884df2902c5bc7815998b0e51d9a7` (Slice 6B — executive intelligence awareness convergence). Verified exact match; working tree carried only the same pre-existing, unrelated modifications present at the start of every prior slice in this series (`scripts/pilot-import.mjs`, `src/routes/me.routes.ts`, and the same set of untracked files). 8 commits ahead of `origin/main`, 0 behind.
**Governing question:** now that all five primary CURRENT-AWARENESS consumers derive factual awareness from `CanonicalAwarenessReadService.listActiveAwareness()`, which legacy code is safe to retire — and which is load-bearing for a *different*, legitimate reason?
**Method:** three parallel, independent, read-only research passes (intelligence-core file inventory; `oyiUnifiedIntelligenceService.ts`/`runOyiUnifiedChat` deep trace; legacy event fabric + Facility Automation dependency + legacy scoring inventory), each citing file:line for every caller claim, followed by coordinator-run targeted verification of every item the passes flagged as ambiguous or needing a second look.

---

## 1. `intelligence-core` inventory

| Module | Purpose | Live callers | Reads/writes | Classification |
|---|---|---|---|---|
| `eventBus.ts` — `publishIntelligenceEvent` | Writes `ochiga_intelligence_events`; fire-and-forget dispatches Facility Automation's rule matcher. | 8 direct call sites (`workflows.ts`, `collaboration.ts`, `sourceEventPublisher.ts`, `oyiObservabilityBridge.ts`, `cameraDetection.service.ts`, `edgeDiscovery.ts`, `cameraIntelController.ts`) | writes `ochiga_intelligence_events` | **CANONICAL_STILL_REQUIRED** (transport + Facility Automation trigger, not awareness interpretation) |
| `eventBus.ts` — `matchEventDrivenAutomationRules` dispatch | `eventBus.ts:146` is the sole dispatch site; `facilityAutomationEventRuleService.ts:189` the sole consumer. Re-verified unchanged from Slice 0. | eventBus.ts:146 only | — | **load-bearing, do not touch** |
| `eventBus.ts` — `listPersistedIntelligenceEvents` | Scoped raw read of `ochiga_intelligence_events`. | `executive.ts` (both fns, disclosed-fallback branch only), `intelligenceRoutes.ts` (`/intelligence/events` history + `/intelligence/summary` disclosed fallback), `oyiUnifiedIntelligenceService.ts` | reads `ochiga_intelligence_events` | **HISTORY + FALLBACK_TEMPORARY + COMPATIBILITY** |
| `eventBus.ts` — `summarizeIntelligenceEvents` | Computes total/attention/by_category/by_agent/latest from a raw event array. | `summaryEngine.ts:71` (→ `buildIntelligenceSummary`), `executive.ts` (both fns, disclosed-fallback branch only) | pure | **SUPERSEDED_AWARENESS, fenced to FALLBACK_TEMPORARY** — every live primary-surface call site is already gated behind an explicit `legacy_fallback_used` flag (Slice 6/6B) |
| `normalizers.ts` — `loadNormalizedTimelineEvents` | Read-time re-derivation scanning 8 raw domain tables. | `executive.ts` (fallback + collaboration_hints), `intelligenceRoutes.ts` (`/intelligence/events` + `/intelligence/summary` fallback), `oyiUnifiedIntelligenceService.ts` | reads `home_timeline`, `device_events`, `camera_events`, `maintenance_requests`, `visitors`, `visitor_access`, `notifications`, `audit_events` | **HISTORY + FALLBACK_TEMPORARY** |
| `summaryEngine.ts` — `buildIntelligenceSummary` | Wraps `filterEventsForActor` + `summarizeIntelligenceEvents` into `/intelligence/summary`'s legacy shape. | `intelligenceRoutes.ts` (`/intelligence/summary`'s own disclosed fallback branch only), `oyiUnifiedIntelligenceService.ts:972` (unconditionally, inside `loadUnifiedContext` — feeds both `getOyiUnifiedAwareness` and `runOyiUnifiedChat`) | pure | **FALLBACK_TEMPORARY (route) + COMPATIBILITY (chat engine, entangled with `runOyiUnifiedChat` — see §5)** |
| `permissionEngine.ts` | Role→scope policy (`getIntelligencePermissionPolicy`, `filterCameraProtectedEvents`, `loadCameraAccessLookup`, `filterEventsForActor` — confirmed NOT dead, 3 live callers, `applyRoleScopeToFilters`). | Multiple, across `executive.ts`, `intelligenceRoutes.ts`, `summaryEngine.ts`, `oyiUnifiedIntelligenceService.ts` | reads `facility_cameras` | **CANONICAL_STILL_REQUIRED** — genuine, still-load-bearing privacy machinery on top of every remaining legacy read path; must outlive any of them |
| `sourceEventPublisher.ts` — `publishSourceIntelligenceEvent` | Wraps `publishIntelligenceEvent` (transport) + calls `orchestrateWorkflowForSourceEvent` (workflow trigger) for 17 domain producers. | Re-confirmed all 17 call sites present (visitor/wallet/maintenance/community/services/facility-visitors/platformGap/device-analytics/service-registry/weather/notification/infrastructure-intelligence controllers/services + 2 workers + canonicalSignalIngress + executionRegistry + verificationService). | writes via `publishIntelligenceEvent`; triggers `orchestrateWorkflowForSourceEvent` | **CANONICAL_STILL_REQUIRED** (event ingress + workflow trigger, not awareness) |
| `workflowOrchestrator.ts` — `orchestrateWorkflowForSourceEvent` | Auto-creates workflows from qualifying source events. | `sourceEventPublisher.ts:89` (confirmed live — a coordinator follow-up check corrected the initial inventory pass's "zero callers" finding; the import is direct, not dynamic) | reads/writes `ochiga_workflows` | **WORKFLOW, CANONICAL_STILL_REQUIRED** |
| `collaboration.ts` | `getCollaborationHints` (pure, advisory routing hints — `executive.ts` only), `listAgentCollaborations` (`intelligenceRoutes.ts` `/collaboration`), `recordAgentCollaboration` (confirmed **zero callers anywhere**, including no dynamic import). | see above | reads/writes `ochiga_agent_collaborations` | `getCollaborationHints`/`listAgentCollaborations`: **OBSERVABILITY/WORKFLOW-adjacent, not awareness**. `recordAgentCollaboration`: **DEAD** (confirmed, not an awareness function — unrelated to this slice's mission, see §18) |
| `timeline.ts` — `homeTimelineEventFromCore`/`writeHomeTimelineFromCore` | Would write `home_timeline` from a core event. | Confirmed **zero callers anywhere** (coordinator re-verified with a dedicated grep pass, no dynamic-import pattern found either). | writes `home_timeline` (never invoked) | **DEAD** (not an awareness function, unrelated to this slice's mission, see §18) |
| `memory.ts` — `writeScopedMemory` | Would write a scoped agent-memory record. | Confirmed **zero callers anywhere**. | writes (never invoked) | **DEAD** (not an awareness function, unrelated to this slice's mission, see §18) |
| `awarenessWorkflowProvider.ts` — `rankActiveWorkflowsForAwareness` | Hardcoded weight table injecting workflow rows into the legacy awareness digest with a computed `awareness_priority` — literally "workflow priority as awareness priority." | **Only** `oyiUnifiedIntelligenceService.ts:1279,1896,1921` (inside `buildSignals`, which only `buildAwareness` calls). | pure | **SUPERSEDED_AWARENESS — the strongest single retirement candidate found**, but entangled with `runOyiUnifiedChat` (see §5) |
| `executive.ts` | `getExecutiveBrief`/`getExecutiveIntelligence` — already canonical-first per Slice 6/6B. | `intelligenceRoutes.ts` (`/intelligence/brief`, `/intelligence/executive`) | — | **CANONICAL_STILL_REQUIRED** (already migrated) |
| `predictionEngine.ts` | Real prediction generation/scoring/acknowledgement. | Route + worker + `executive.ts` | `ochiga_intelligence_predictions` | **PREDICTION** — untouched, correctly separate |
| `workflows.ts` | Real workflow lifecycle (create/transition/list/escalate). | Multiple routes + `executive.ts` (`getWorkflowSummary`) | `ochiga_workflows`, `ochiga_workflow_events`, `ochiga_agent_responsibilities` | **WORKFLOW** — untouched, correctly separate |
| `observability.ts`/`organizationObservability.ts`/`oyiObservabilityBridge.ts` | Agent health/observability, wraps every intelligence route handler via `observeAgentAction`. | `intelligenceRoutes.ts` handlers | `ochiga_agent_observability` | **OBSERVABILITY** — untouched, correctly separate |
| `organization.ts` | Org/staff directory/summary. | `intelligenceRoutes.ts`, `executive.ts` | org/staff tables | **ORGANIZATIONAL_FACT** — untouched, correctly separate |
| `executionRegistry.ts` | High-risk registered executive actions against real domain tables (maintenance/visitor/membership), gated. | Route(s) | `estate_memberships`, `homes`, `maintenance_requests`, `visitor_access` | **DIRECT_DOMAIN/ACTION** — untouched, not awareness |
| `verificationService.ts` | Workflow verification against real domain tables. | Routes | `maintenance_requests`, `service_registry_events`, `visitor_access` | **WORKFLOW/DIRECT_DOMAIN** — untouched |
| `health.ts`, `memoryDirectory.ts`, `agentRegistry.ts`, `toolRegistry.ts`, `triggerRegistry.ts`, `surfaceRegistry.ts`, `agentCapabilities.ts`, `types.ts`, `intentRouter.ts` | Config/registry/health-rollup/type infrastructure. | Various single-digit route callers | none/config | **CANONICAL_STILL_REQUIRED (config) / OBSERVABILITY / COMPATIBILITY** — none own awareness truth |
| `index.ts` | Barrel re-export consumed by 16 real domain producers/workers/controllers. | 16 files | — | **CANONICAL_STILL_REQUIRED** — the mechanism by which `publishSourceIntelligenceEvent` reaches every domain producer |

**Naming-collision resolved**: `buildAwareness`/`buildAwarenessFromSignal` exist in TWO unrelated places. The one in `src/oyi-core/runtime/contextAwareness.ts` is genuinely canonical — live callers confirmed at `src/oyi-core/service.ts:97,249,256` (the real `oyiCoreRuntime` signal-processing pipeline) and `src/oyi-core/runtime/operationalReasoning.ts:314`. **Classification: CANONICAL_STILL_REQUIRED, unrelated to the legacy one.** The legacy, scored one lives inside `src/services/oyiUnifiedIntelligenceService.ts:1390` — see §5.

---

## 2. `oyiUnifiedIntelligenceService.ts` inventory (2961 lines)

The file's own header (lines 19–23) states its status plainly: *"Transitional compatibility service... stays in place only to preserve older /oyi/awareness and /oyi/chat payload contracts while the remaining clients complete cutover."*

Real production exports: `loadOyiConversationContext` (thread state glue, not awareness), `listOyiConversationThreads`/`getOyiConversationMessages` (pure thread-persistence reads, not awareness), `getOyiUnifiedAwareness` (§3), `runOyiUnifiedChat` (§4). Nine `*ForTest` exports are unit-test-only re-exports, not production callers.

Internal, non-exported legacy scoring engine — confirmed present exactly as the Slice 0 audit described: `scoreSignal`, `surfacePriorityScore`, `relevanceScore`, `actionabilityScore`, `riskScore`, `recencyScore`, `sourceReliability`, module-private `signalSeverity` (distinct from the unrelated canonical `signalSeverity(value)` in `src/oyi-core/contracts/operationalSignal.ts:246` — another naming collision, now disambiguated), `maxSeverityRank`, `scoreFromDecision` → `buildSignals` → `buildAwareness` (legacy, line 1390) → `buildSources`/`buildSuggestedActions`. All of these helpers are confirmed **self-contained**: zero callers outside this one cluster, not shared with predictions/workflows/device classification (those live in entirely separate files).

`buildAwareness` (legacy, 1390) has exactly 3 callers: `buildOyiAwarenessScenarioForTest` (test-only), `getOyiUnifiedAwareness` (2863), `runOyiUnifiedChat` (2892).

---

## 3. `getOyiUnifiedAwareness` status

Body: `loadUnifiedContext` → legacy `buildAwareness` → `decorateOyiTargets`.

**Every current caller, exhaustively confirmed:**
1. `src/oyi-core/read/awarenessPresentationAdapter.ts:156` — fires when `!actor` (unauthenticated/null-actor shortcut, not a "canonical failed" case at all).
2. `src/oyi-core/read/awarenessPresentationAdapter.ts:158-163` — fires when `!canonical.ok`, logged via `logger.warn("oyi_awareness_canonical_fallback", ...)`.
3. `src/oyi-core/read/canonicalVsLegacyAwarenessDiagnostic.ts:76` — diagnostic comparison tool, not live traffic.
4. `oyiRoutes.ts` — confirmed **no import** (the dead import Slice 6B removed stays removed).

`listActiveAwareness` never throws to its caller (internal errors are caught and converted to typed `{ok:false, reason}`, confirmed at `canonicalAwarenessReadService.ts` lines 481/531/573/639); its only two failure reasons are `"no_verified_estate"` and `"read_failed"`.

**A structural nuance, not a proven exploit**: the Slice 0 audit (§26/§27) already flagged that legacy's own scope resolution (feeding `loadUnifiedContext`) uses raw `actor.estate_id`/`actor.home_id` rather than the verified `oisContext` — the exact staleness gap Slice 1B's "SURFACE ≠ AUTHORITY" work closed elsewhere. Falling back to legacy specifically when canonical reports `"no_verified_estate"` means answering with a *less* scope-verified engine at exactly the moment scope verification is in question. No full trace was performed to confirm this leaks anything (that would require a dedicated privacy-adversarial pass, out of this audit's scope), but it is flagged as a newly discovered, narrow structural concern (§28 of the final report) rather than something fixed here — fixing it would be a scope-resolution change, not a retirement.

**Verdict: KEEP_TEMPORARILY.** Both fallback branches are explicit, logged, and never blend with canonical output. The `"no_verified_estate"` branch's practical value is questionable (see above) but changing its behavior is a design decision, not a safe mechanical retirement.

---

## 4. `runOyiUnifiedChat` — caller/intent analysis (the priority target)

**Every current caller, exhaustive:** exactly one — `src/oyi-core/runtime/canonicalConversationRuntime.ts:1344`.

**Exact trigger condition** (read in full context, lines ~1230–1344):
- Canonical resolves one exact object AND natively handles the requested operation class → canonical response, never reaches legacy.
- `operation_class ∈ {read, report, recommend}` AND `scope_mode === "exact_target"` AND an object resolved → a controlled canonical-only degraded answer, still never reaches legacy.
- **Otherwise** (ambiguous target, non-exact scope mode, or any operation canonical doesn't explicitly implement) → falls through to `runOyiUnifiedChat`.

This is a **broad catch-all, not a rare technical-failure edge case** — it is the default path for any conversational turn that isn't cleanly "one exact object + an operation canonical explicitly implements." Office (`office_internal`/`public_corporate` surfaces) and Communications conversational turns flow through the identical `canonicalConversationRuntime` and are subject to the same trigger condition — no separate Office-only or Communications-only conversation path was found bypassing it.

**`runOyiUnifiedChat`'s own body**: calls `loadUnifiedContext` + legacy `buildAwareness` **unconditionally, on every single call** (line 2891-2892), before any intent branching. That `awareness` object then feeds:
- `compatibilityConversationPayload` for read-only-shaped messages — wraps the legacy `AwarenessResult` into a synthetic canonical-shaped signal fed through `oyiCoreRuntime.conversation(...)` for *wording*, but the underlying *fact* (which signal, what severity) still comes from legacy scoring.
- `runOperatingLayer`'s awareness branch (`intent === "awareness"/"recommendation"`) and `response.awareness` whenever `displayMode === "awareness"`.

**Conclusion, confirmed by two independent research passes**: `runOyiUnifiedChat` genuinely and unconditionally derives current-awareness truth on every call. It is not a language/compatibility shim that happens to also touch awareness — awareness computation is unconditional, upstream of intent classification.

**Does it perform physical actions?** No independent execution authority. Validation/preparation branches only ever return `"validation_required"`; device-control-shaped intents delegate to the real, governed `routeAiCommand` (`ai/commandRouter.ts`) — the same Wave 4B/5 `DeviceCommandAuthority` pipeline everything else uses. It is a second *conversational front end*, not a second *execution authority*.

**Fallback-reason classification**: ambiguous/general "what's happening" queries → **LEGACY_AWARENESS**. Domain intents canonical hasn't implemented (workflow prep, visitor-invite prep, capability queries) → **CANONICAL_INTENT_MISSING**. Read-only phrasing → mixed **LEGACY_AWARENESS** (fact) + **LANGUAGE_FALLBACK** (wording). Device-control-shaped intents → **ACTION** (delegates to the real executor). General help/capability questions → **LANGUAGE_FALLBACK**. No distinct, separately-coded OFFICE_COMPATIBILITY/COMMUNICATIONS_COMPATIBILITY mechanism exists — Office/Communications turns run the identical generic engine, differentiated only by a `surface` parameter.

**Metric available for future evidence-gathering**: `oyi_canonical_runtime_legacy_service_fallback_total{surface, module}` — added specifically (per its own inline comment) so a future "Phase O" retirement decision could be evidence-based. Nobody has yet consulted it; this audit does not have production traffic data to draw on.

**Verdict: DEFER.** Per Section 20's explicit safety rule, `runOyiUnifiedChat` cannot be safely narrowed as a mechanical step in this slice:
1. Legacy awareness computation is unconditional and threaded into at least three downstream shapes — removing it is a control-flow rewrite, not a call-site deletion.
2. The fallback trigger is the *default* path for a broad class of real conversational traffic, not a rare failure case — no traffic evidence exists yet to bound the blast radius of changing it.

A safe narrowing is structurally *possible* (swap legacy `buildAwareness`'s scoring for `buildAmbientAwarenessProjection(actor, oisContext, surface)` reshaped into the existing `AwarenessResult` contract) but is a migration comparable in size to Slices 5/6/6B — new surface mapping, new privacy-authority re-verification for the conversational context, new explicit-fallback contract. It must not be attempted as a byproduct of an audit slice.

---

## 5. Conversation fallback classification

See §4 above for the per-reason classification table. Summary: legacy awareness INSIDE `runOyiUnifiedChat` **cannot** currently be disabled independently of its language/compatibility role without the narrowing migration described above — the same function call (`buildAwareness`) backs both. The distinction the task hoped might allow partial retirement (awareness vs. compatibility as separable concerns) is real in principle but not yet separable in the current code shape.

---

## 6. Legacy summary-builder callers

`buildIntelligenceSummary` (summaryEngine.ts) and `summarizeIntelligenceEvents` (eventBus.ts): every remaining caller across the codebase is either (a) an explicit, disclosed fallback branch on a primary surface (`/intelligence/summary`, `executive.ts`'s two functions — all gated behind `canonical_status`/`legacy_fallback_used`, Slices 3/5/6/6B), or (b) internal machinery inside `oyiUnifiedIntelligenceService.ts`'s `loadUnifiedContext`, itself only reachable via `getOyiUnifiedAwareness` (KEEP_TEMPORARILY, §3) and `runOyiUnifiedChat` (DEFER, §4).

**Proven: no primary CURRENT-AWARENESS consumer's canonical-success path calls either function.** All five primary surfaces (`/oyi/awareness`, conversation `home_operational_summary`, `/intelligence/summary`, `/intelligence/brief`, `/intelligence/executive`) source their canonical-success awareness content exclusively from `CanonicalAwarenessReadService.listActiveAwareness()` via `buildAmbientAwarenessProjection`/`canonicalConversationAwarenessAdapter`/`awarenessPresentationAdapter`'s canonical branch — confirmed by direct code inspection across Slices 2–6B and re-confirmed by this audit's fresh grep of every caller.

---

## 7. Legacy event-fabric responsibilities

EVENT TRANSPORT/HISTORY (keep, not awareness interpretation): `publishIntelligenceEvent`, `publishSourceIntelligenceEvent`, `listPersistedIntelligenceEvents`, `loadNormalizedTimelineEvents`, `normalizeIntelligenceCategory`, `normalizeCoreBusEvent`, `orchestrateWorkflowForSourceEvent`.

AWARENESS INTERPRETATION (now fallback-only, not primary): `summarizeIntelligenceEvents`, `buildIntelligenceSummary` (route-level uses only — its internal `oyiUnifiedIntelligenceService.ts` use is entangled with §4's DEFER verdict).

The separation the task asked for is real and clean: nothing in the transport layer independently claims "this is what's happening right now" — that claim is made only by the summary/scoring layer built on top, and that layer's only remaining reach is through disclosed fallbacks and the DEFERred `runOyiUnifiedChat`.

---

## 8. Facility Automation dependency (re-verified, unchanged)

Exactly one call site of `matchEventDrivenAutomationRules`: `eventBus.ts:146` (fire-and-forget dynamic import inside `publishIntelligenceEvent`). Exactly one definition: `facilityAutomationEventRuleService.ts:189` — confirmed real behavior (queries `facility_automation_event_rules`, evaluates conditions, calls `proposeAutomationApproval`). No alternate/canonical path exists — grep for the same symbols under `src/oyi-core/` returns zero hits. **`publishIntelligenceEvent` MUST be retained.** Sanity baseline re-run (read-only): `smoke:wave5-slice1-facility-automation-device-authority` PASSED, `smoke:wave5e-automation-worker-device-authority` PASSED.

---

## 9. History/timeline status

`GET /intelligence/events` remains intentionally historical, sourced from `listPersistedIntelligenceEvents` + `loadNormalizedTimelineEvents` via `intelligenceRoutes.ts`'s `loadRoleAwareEvents`, with the same actor/estate/home scoping and camera-privacy filtering as every other legacy read path. Not migrated, per every prior slice's explicit scope boundary and this slice's own Section 10. No change.

---

## 10. Prediction / workflow / observability status

All three (`predictionEngine.ts`, `workflows.ts`, `observability.ts`/`organizationObservability.ts`/`oyiObservabilityBridge.ts`) are confirmed live, correctly separate from awareness, and untouched by this audit's findings — see the §1 table. No retirement action applies to any of them.

---

## 11. Office/communications dependencies

`ConversationOrchestrator.ts` remains the single canonical entry point for facility/consumer/general-AI/communications/Office conversation surfaces (confirmed unchanged from the Slice 0 audit's §21 finding, re-verified in §4 above). No Office-specific or Communications-specific awareness machinery exists separately from the generic `runOyiUnifiedChat` fallback described in §4 — Office/Communications business intelligence (organization directory, CRM-adjacent data) is genuinely separate, legitimate, and untouched (`organization.ts`, executive's `lead_activity`/`sales_activity` fields, all previously classified DIRECT_DOMAIN/ORGANIZATIONAL_FACT and explicitly out of scope since Slice 6).

---

## 12. Legacy scoring inventory

`scoreSignal`, `surfacePriorityScore`, `buildAwareness` (legacy), `buildSignals`, `buildSources`, `buildSuggestedActions`, `rankActiveWorkflowsForAwareness`, and their private sub-scoring helpers form one self-contained cluster, confirmed to share zero code with predictions/workflows/device classification. The literal string "Awareness Scoring V3"/`awareness_v3` does not exist anywhere — re-confirmed, matching the Slice 0 audit's refutation. This cluster is the actual "second version of what's happening now" the task's closing statement names — but it is reachable only via `getOyiUnifiedAwareness` (KEEP_TEMPORARILY) and `runOyiUnifiedChat` (DEFER), so it cannot be deleted independently of those two verdicts.

---

## 13. Fallback observability findings

Static/local audit only — no production metrics were available to consult. Qualitatively: `/oyi/awareness`'s and `/intelligence/summary`'s/`/intelligence/brief`'s/`/intelligence/executive`'s fallback branches are all exercised and passing in their respective Slice 2–6B smoke suites (reachable, tested, not merely theoretical). `runOyiUnifiedChat`'s fallback path has a dedicated metric (`oyi_canonical_runtime_legacy_service_fallback_total`) but it has never been consulted for a retirement decision — this audit does not change that; it's named as unfinished evidence-gathering work for whoever eventually attempts the `runOyiUnifiedChat` narrowing migration.

---

## 14. Decorative executive preview

`oyiCoreRuntime.executive("daily", {signals: [], ...})` on `GET /intelligence/executive` (`intelligenceRoutes.ts`): traced into `src/oyi-core/service.ts:414`'s real `executive()` method — it genuinely calls `this.evaluate(input)` and builds a real `ExecutiveBriefing` object, but since the route always passes `signals: []`, the evaluation has no actual data to reason over, so the resulting `briefing` is structurally empty. Only `briefing.id`/`generatedAt`/a hardcoded `status: "generated"` are surfaced. **Classification: DECORATIVE, not misleading about facts** (it doesn't fabricate false awareness content — it just produces an empty, uninformative preview object) **but the surrounding `deprecation.live_operational_truth: "delegated_to_oyi_core"` label, which predates Slice 6B, is now actually true for the response's real awareness fields** (`focus`/`summary.events`, migrated in Slice 6B) even though the separate `canonical_runtime` block remains non-data-bearing. **Verdict: DEFER.** Removing or fixing this decorative block would touch response shape beyond "duplicate awareness authority," and Section 22 explicitly forbids expanding into an Executive redesign. Flagged as a retirement candidate for a future presentation-focused pass only.

---

## 15. Retirement matrix

| Module/Function | Current callers | Current purpose | Canonical replacement | Side effects | Retirement class | Action |
|---|---|---|---|---|---|---|
| `eventBus.ts` `publishIntelligenceEvent` | 8 direct sites | Event write + Facility Automation trigger | none (not awareness) | writes `ochiga_intelligence_events`, triggers automation rules | **KEEP** | none |
| `eventBus.ts` `listPersistedIntelligenceEvents` | `executive.ts`, `intelligenceRoutes.ts`, `oyiUnifiedIntelligenceService.ts` | History read + disclosed fallback source | canonical awareness (for the fallback use only) | read-only | **KEEP** (history) / **KEEP_TEMPORARILY** (fallback use) | none |
| `eventBus.ts` `summarizeIntelligenceEvents` | `executive.ts` (fallback only), `summaryEngine.ts` | Legacy current-awareness computation | `buildAmbientAwarenessProjection` | pure | **KEEP_TEMPORARILY** | none — retained by fallback safety rule |
| `normalizers.ts` `loadNormalizedTimelineEvents` | `executive.ts`, `intelligenceRoutes.ts`, `oyiUnifiedIntelligenceService.ts` | History re-derivation + fallback source | n/a (history) | read-only | **KEEP** | none |
| `summaryEngine.ts` `buildIntelligenceSummary` | `intelligenceRoutes.ts` (fallback), `oyiUnifiedIntelligenceService.ts` (unconditional, chat engine) | Legacy summary shape | canonical projection (route use only) | pure | **KEEP_TEMPORARILY** | none |
| `sourceEventPublisher.ts` `publishSourceIntelligenceEvent` | 17 domain producers | Event ingress + workflow trigger | none (not awareness) | writes events, triggers workflows | **KEEP** | none |
| `workflowOrchestrator.ts` `orchestrateWorkflowForSourceEvent` | `sourceEventPublisher.ts:89` | Auto-workflow creation | none (not awareness) | writes `ochiga_workflows` | **KEEP** | none |
| `awarenessWorkflowProvider.ts` `rankActiveWorkflowsForAwareness` | `oyiUnifiedIntelligenceService.ts` (`buildSignals` only) | Workflow-priority-as-awareness-priority scoring | `buildAmbientAwarenessProjection`'s canonical urgency + domain ordering | pure | **DEFER** | entangled with `runOyiUnifiedChat`; cannot isolate yet |
| `oyiUnifiedIntelligenceService.ts` legacy scoring cluster (`scoreSignal`/`surfacePriorityScore`/`buildAwareness`/`buildSignals`/`buildSources`/`buildSuggestedActions` + helpers) | `getOyiUnifiedAwareness`, `runOyiUnifiedChat` | Legacy current-awareness computation | `CanonicalAwarenessReadService.listActiveAwareness()` | pure | **DEFER** | needs a dedicated narrowing slice, not a byproduct of this audit |
| `getOyiUnifiedAwareness` | `awarenessPresentationAdapter.ts` (2 branches), `canonicalVsLegacyAwarenessDiagnostic.ts` | Explicit/disclosed fallback + diagnostic | canonical (already primary) | none | **KEEP_TEMPORARILY** | none; flag `"no_verified_estate"` branch's scope-safety nuance for future design review |
| `runOyiUnifiedChat` | `canonicalConversationRuntime.ts:1344` | Conversational fallback (awareness + language + intent-missing + some action delegation) | none yet for the awareness portion | delegates real device actions to the governed executor | **DEFER** | no change this slice; recommend a dedicated future slice |
| `contextAwareness.ts` `buildAwareness`/`buildAwarenessFromSignal` | `oyi-core/service.ts`, `operationalReasoning.ts` | Canonical signal-processing formatter | — (this IS canonical) | none | **KEEP** | none — unrelated to the legacy duplicate, naming collision only |
| `timeline.ts` `homeTimelineEventFromCore`/`writeHomeTimelineFromCore` | none (confirmed) | intended `home_timeline` writer, never wired | n/a | none (never runs) | **DEAD** | not deleted — out of this slice's mission (not an awareness function); reported as a future hygiene finding |
| `collaboration.ts` `recordAgentCollaboration` | none (confirmed) | intended collaboration recorder, never wired | n/a | none (never runs) | **DEAD** | not deleted — same reasoning |
| `memory.ts` `writeScopedMemory` | none (confirmed) | intended scoped-memory writer, never wired | n/a | none (never runs) | **DEAD** | not deleted — same reasoning |
| `intelligenceRoutes.ts` `oyiCoreRuntime.executive("daily", {signals:[]})` + `canonical_runtime`/`deprecation` fields | `/intelligence/executive` route | Decorative preview metadata | n/a | none (empty-input evaluation) | **DEFER** | flagged only; removal would be a response-shape change outside this slice's mission |
| `oyiRoutes.ts` dead `getOyiUnifiedAwareness` import | (already removed, Slice 6B) | — | — | — | **DONE** | already retired |

---

## 16. Safe retirement package

**None was implemented.** Every genuine duplicate-awareness-authority candidate found (the `oyiUnifiedIntelligenceService.ts` scoring cluster, `awarenessWorkflowProvider.ts`, `getOyiUnifiedAwareness`'s fallback nuance, `runOyiUnifiedChat`) fails the Implementation Gate (Section 19): none has zero legitimate non-awareness callers, and none can be cleanly narrowed without a real migration. The four fully-dead functions found (`timeline.ts` x2, `collaboration.ts`, `memory.ts`) meet the gate technically (zero callers at all) but are **not duplicate awareness authority** — they are unrelated dead code discovered incidentally, and this slice's own mission statement explicitly warns against "speculative cleanup" and against retiring "legacy by name" rather than "duplicate awareness authority" specifically. They are reported, not deleted.

**Conclusion: this slice is audit-only.** No source files were modified. No smoke test was created (Section 25's condition — "if code is changed" — was not triggered). No commit was made, per Section 28's explicit instruction not to commit merely to produce a report.
