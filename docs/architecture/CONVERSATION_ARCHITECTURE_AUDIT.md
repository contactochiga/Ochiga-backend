# Conversation Architecture Audit

This audit maps what exists now. It does not approve a large rewrite.

## Current Entry Points

Backend:

- `POST /oyi/runtime/conversation` in `src/routes/oyiRoutes.ts`
- `POST /oyi/chat` compatibility route in `src/routes/oyiRoutes.ts`
- `GET /oyi/threads`
- `GET /oyi/threads/:threadId/messages`
- Legacy AI confirmation routes under `/ai`
- Operational signal routes under `/signals`
- Runtime evaluation routes under `/oyi/runtime/evaluate`

Consumer:

- `src/services/oyiService.ts` calls `/oyi/runtime/conversation`, `/oyi/threads`, and `/oyi/threads/:id/messages`.
- `src/services/aiService.ts` normalizes Oyi responses for the AI page and device drawers.
- `src/app/ai/page.tsx` owns general AI page state.
- `src/app/devices/DevicesClient.tsx` owns device drawer conversation state.

Facility:

- `services/oyiService.ts` calls the same Backend Oyi routes with `surface: facility`.
- `store/useFacilityConversationStore.ts` persists Facility conversation UI state in session storage and restores Backend threads.
- Local `lib/conversationRuntime.ts` still exists for Facility-side runtime/presentation logic.

Office/Website:

- Office lead agents have a separate conversation/lead runtime in `/Users/ochigaidoko/oyi-edge-agent/src/lead-agents/runtime.js`.
- Website public widget routes can forward to the lead-agent service.
- Backend already has `office` as a possible intelligence surface in several contracts, but Office conversation is not yet fully converged into Backend Oyi Core.

## Backend Runtime Map

Current canonical route path:

1. `src/routes/oyiRoutes.ts`
2. `mapOyiRouteBodyToConversationRequest`
3. `conversationOrchestrator.run`
4. `parseSemanticFrame`
5. `resolveTurnAuthority`
6. `selectCapability`
7. Registered capability adapter, currently only `deviceDomainAdapter`
8. Otherwise `legacyConversationAdapter.run`
9. Legacy adapter delegates to `runCanonicalConversation`
10. `canonicalConversationRuntime.ts` builds response, evidence, persistence, compatibility shape and presentation metadata.

## Existing Modular Pieces

The Backend already contains the desired vocabulary:

- `src/oyi-core/contracts/*`
- `src/oyi-core/interpretation/*`
- `src/oyi-core/orchestration/*`
- `src/oyi-core/capabilities/*`
- `src/oyi-core/domains/devices/*`
- `src/oyi-core/workflows/*`
- `src/oyi-core/actions/*`
- `src/oyi-core/evidence/*`
- `src/oyi-core/presentation/*`
- `src/oyi-core/persistence/*`

This means the next phase should extend and migrate into existing structures rather than invent a new runtime.

## Hotspots And Bottlenecks

Measured file sizes:

- `src/oyi-core/runtime/canonicalConversationRuntime.ts`: 6,651 lines
- `src/services/oyiUnifiedIntelligenceService.ts`: 2,931 lines
- `src/controllers/servicesController.ts`: 2,815 lines
- `src/device/adapters/tuya/TuyaAdapter.ts`: 2,251 lines
- `src/ai/commandRouter.ts`: 1,763 lines
- `src/controllers/deviceCommandController.ts`: 1,741 lines

Conversation-specific bottlenecks:

- `canonicalConversationRuntime.ts` still does too much: interpretation fallback, target normalization, device/home/room builders, presentation shaping, persistence, recent changes, internal event suppression, and compatibility response shaping.
- `ConversationOrchestrator.ts` is intentionally small and promising, but currently has only one registered domain adapter and falls back to legacy for most capabilities.
- `CapabilityRegistry.ts` is generic but underpopulated.
- `LanguageNormalizer.ts` is only 5 lines; full normalization currently remains fragmented.
- Device domain adapter exists, but most domains do not yet have adapters.

## Coupling Risks

- Consumer and Facility duplicate Oyi response types instead of importing a generated/shared contract.
- Facility has a local conversation runtime that could drift from Backend truth.
- Office lead-agent conversation is entirely separate from Backend Oyi conversation.
- Compatibility routes and legacy adapters are still required for older clients.
- Thread persistence is centralized in Backend, which is good, but response metadata shape is broad and duplicated in frontends.
- Device control, IR truth, and Smart Access are safety-critical and tightly coupled to conversation behavior.

## Current Strengths

- Backend has durable conversation tables and public thread endpoints.
- Current release validation covers thread persistence, device intelligence, IR truth, Smart Access, wallet flows, runtime evidence and context precedence.
- Conversation orchestrator now records semantic frames/resolved turn metadata in response execution.
- Backend security audit reports no RLS gaps and no tables without RLS.
- Consumer validates durable history and device-control behavior through release smokes.

## Facility-Specific Behavior

Facility conversation store:

- Uses Backend threads.
- Restores messages from `/oyi/threads/:id/messages`.
- Persists local UI state in `sessionStorage`.
- Sends `surface: facility`, estate/home context, operational object and active runtime context.

Risk:

- Local `lib/conversationRuntime.ts` and local runtime subscription helpers must remain presentation-side only. They should not decide canonical operational truth.

## Consumer-Specific Behavior

Consumer:

- Sends separated page launch, selected UI object, current turn hints and operational object fields.
- Owns rich device drawer context and control confirmation cards.
- Uses active context store and Runtime V2 state.

Risks:

- Active Consumer code is nested inside a dirty parent repo rather than a clean standalone checkout.
- Frontend response and thread types are duplicated rather than generated from Backend contracts.
- Device drawer conversation code remains large and specialized, but it currently passes release smokes and should be protected.

## Office / Website Conversation State

Office lead agents:

- Have their own runtime, memory, prompt packs, tools and Supabase-backed lead conversations.
- Own OMA/OSA commercial workflows.

Website:

- Can load the lead-agent widget and can forward deployment requests to lead-agent public chat.

Risk:

- Office conversation should not be folded blindly into Consumer/Facility Oyi Core. It needs a channel/domain adapter with separate authority, data retention and CRM contracts.

## Recommended Modular Boundaries

Future modules should extend existing `src/oyi-core` structure:

- `interpretation`: language normalization, semantic frame parsing, temporal/reference extraction.
- `orchestration`: immutable resolved turn, authority, workflow selection, capability routing.
- `domains/<domain>`: domain adapter with resolver, evidence loader, read/draft/action builders.
- `actions`: durable action lifecycle and verification.
- `workflows`: clarification, review, approval, cancellation, supersession, expiry.
- `presentation`: policy and block shaping.
- `persistence`: thread/message/workflow/action persistence.
- `channels`: Consumer, Facility, Office, Website, Voice request/response adapters.

Do not move files into this shape in one jump. Use adapters and strangler migrations.

## Migration Strategy

1. Freeze current public route contracts.
2. Add contract tests around `/oyi/runtime/conversation`, `/oyi/threads`, `/oyi/threads/:id/messages`.
3. Add domain adapters one at a time, starting with domains already stable in the legacy runtime.
4. Keep legacy fallback, but require structured logging whenever used.
5. Move builders out of `canonicalConversationRuntime.ts` only after adapter tests pass.
6. Generate or centralize shared response types for Consumer and Facility.
7. Treat Office as a separate channel with separate CRM authority.

## What Must Not Change In Phase 1

- No device command lifecycle rewrite.
- No IR FIFO/truth rewrite.
- No Smart Access authority changes.
- No Facility resident privacy changes.
- No public thread route contract break.
- No website UI changes.
- No Office/Edge code move until extraction gates exist.

## Implementation Update — 2026-08-11

The first behavior extraction has started without introducing a second runtime:

- Presentation time/freshness helpers moved from `src/oyi-core/runtime/canonicalConversationRuntime.ts` into `src/oyi-core/presentation/timeFreshness.ts`.
- Structured answer/table presentation helpers moved into `src/oyi-core/presentation/conversationAnswerPresentation.ts`.
- `canonicalConversationRuntime.ts` now delegates those responsibilities and dropped from 6,651 lines at audit time to 6,262 lines after the extraction.
- The new platform boundary contract records that conversation remains a Backend-owned canonical runtime while responsibilities migrate into modules.

Next safe conversation extractions should target:

- destination/navigation mapping;
- clarification/workflow persistence helpers;
- domain capability selection;
- target/context authority decisions.

## Structural Cleanup Update — 2026-08-11

The canonical runtime remains the single Oyi Core conversation path. No second runtime or V2 compatibility engine was introduced.

Current active route shape:

1. Public route maps the incoming request into `CanonicalConversationRequest`.
2. `runCanonicalConversation` remains the lifecycle spine.
3. Context candidates are assembled by `src/oyi-core/context/conversationTargetCandidates.ts`.
4. Target resolution remains in `src/oyi-core/runtime/conversationTargetResolver.ts`.
5. Object hydration is owned by `src/oyi-core/context/conversationObjectHydration.ts` and `src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts`.
6. Surface hydration policy lives in `src/oyi-core/policy/surfaceConversationPolicy.ts`.
7. Domain facts and answer behavior live in first-class domain modules.
8. Canonical conversation messages are still persisted once by the canonical runtime path.
9. Thin caller adapters live in `src/oyi-core/runtime/canonicalConversationAdapters.ts`.

Contracts moved out of the runtime:

- `src/oyi-core/contracts/canonicalConversation.ts` now owns canonical request, response, truth, operational object, resolved turn, presentation policy, pending clarification and intelligence fact contracts.
- Extracted domain/context/presentation modules now import canonical conversation types from contracts rather than from `canonicalConversationRuntime.ts`.
- `canonicalConversationRuntime.ts` consumes those contracts instead of acting as the public type system.

Authority/context ownership:

- Current-turn authority, inherited-target eligibility, current-turn control detection and referential-target checks now live in `src/oyi-core/context/currentTurnAuthority.ts`.
- The runtime still enforces the authority decision during lifecycle orchestration, but no longer owns the decision implementation block.

Compatibility ownership:

- `src/oyi-core/runtime/canonicalConversationAdapters.ts` owns active response adapters for `/ai` and `/oyi` callers.
- The adapters are intentionally thin: they do not run interpretation, target resolution, evidence loading, execution or persistence.
- Active callers are `src/routes/aiRoutes.ts` and `src/routes/oyiRoutes.ts`.

Domain ownership after extraction:

- Devices: `src/oyi-core/domains/devices/*`
- Wallet: `src/oyi-core/domains/wallet/*`
- Utilities: `src/oyi-core/domains/utilities/*`
- Maintenance: `src/oyi-core/domains/maintenance/*`
- Visitors/Access: `src/oyi-core/domains/visitors/*`
- Security: `src/oyi-core/domains/security/*`
- Services: `src/oyi-core/domains/services/*`
- Community/Messages: `src/oyi-core/domains/community/*`
- Scenes/Automations: `src/oyi-core/domains/automations/*`
- Reports/Analytics: `src/oyi-core/domains/reports/*`

Final structural cleanup ownership:

- Contracts: `src/oyi-core/contracts/canonicalConversation.ts`.
- Context and candidate assembly: `src/oyi-core/context/conversationContextLayers.ts` and `src/oyi-core/context/conversationTargetCandidates.ts`.
- Authority and inheritance: `src/oyi-core/context/currentTurnAuthority.ts`.
- Target resolution: `src/oyi-core/runtime/conversationTargetResolver.ts`.
- Hydration: `src/oyi-core/context/conversationObjectHydration.ts` and `src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts`.
- Surface policy: `src/oyi-core/policy/surfaceConversationPolicy.ts`.
- Domain evidence and behavior: `src/oyi-core/domains/<domain>/*`.
- Clarification/workflows: `src/oyi-core/workflows/conversationClarification.ts` plus the existing workflow runtime/state machine.
- Presentation/fallback/spatial reasoning: `src/oyi-core/presentation/conversationAnswerPresentation.ts`, `src/oyi-core/presentation/objectFallbackPresentation.ts`, and `src/oyi-core/presentation/timeFreshness.ts`.
- Builder selection, resolved-turn projection and presentation policy: `src/oyi-core/runtime/canonicalTurnResolution.ts`.
- Persistence/finalization: `src/oyi-core/persistence/canonicalConversationPersistence.ts` and `src/oyi-core/persistence/canonicalConversationTruth.ts`.
- Compatibility: `src/oyi-core/runtime/canonicalConversationAdapters.ts`.
- Test-support seams: `src/oyi-core/testing/canonicalConversationTestSupport.ts`.
- Canonical lifecycle spine: `src/oyi-core/runtime/canonicalConversationRuntime.ts`.

The final runtime responsibility is:

`request → normalize/interpret → assemble context → assemble candidates → resolve target → hydrate object → decide authority → load authorized evidence → select capability → invoke domain/workflow → finalize response/action → persist canonical turn → adapt response`.

Structural guardrail:

- `npm run smoke:canonical-runtime-structure` verifies canonical contracts no longer originate in the runtime, extracted modules do not type-import from the runtime, compatibility adapters remain thin, persistence internals are outside the runtime, fallback/spatial/clarification/selection implementations are externally owned, and test-only helpers no longer export from the runtime.

Extension pattern:

1. Add or update canonical contracts only in `contracts` when the public shape changes.
2. Add target/context rules through `context` and `conversationTargetResolver`, not inside the runtime.
3. Add evidence and answer/action behavior under `domains/<domain>`.
4. Add presentation blocks through presentation modules and policy selection through `canonicalTurnResolution`.
5. Let `runCanonicalConversation` orchestrate the lifecycle and call the single persistence owner.
6. Keep compatibility adapters thin: caller shape in, canonical request out, canonical response adapted back.
