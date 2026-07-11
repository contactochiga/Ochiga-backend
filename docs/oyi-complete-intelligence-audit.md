# Oyi Complete Intelligence Audit

Updated: 2026-07-11

Scope:
- Backend: `/Users/ochigaidoko/Documents/Ochiga-backend`
- Consumer: `/Users/ochigaidoko/Documents/New project/Oyi-os-frontend`
- Facility: `/Users/ochigaidoko/Documents/facility-oyi`

Audit mode:
- Discovery only
- No runtime fixes in this phase
- Findings are based on direct code inspection and existing validation evidence

## 1. Current Intelligence Architecture

### Canonical intended flow

Operational source  
→ event or user request  
→ context resolution  
→ intent understanding  
→ entity and target resolution  
→ evidence retrieval  
→ reasoning  
→ permission and policy  
→ recommendation or execution proposal  
→ validation  
→ execution  
→ confirmation  
→ activity  
→ awareness  
→ notification  
→ conversation response  
→ memory

### Observed canonical owners

| Stage | Canonical owner | Evidence |
| --- | --- | --- |
| Runtime signal normalization | Backend `src/oyi-core/contracts/operationalSignal.ts`, `src/oyi-core/runtime/universalSignalRuntime.ts` | `/oyi-core` receives and normalizes signals before awareness/reasoning |
| Awareness | Backend `src/oyi-core/runtime/contextAwareness.ts` | `oyiCoreRuntime.receiveSignal()` builds awareness from normalized signal bundles |
| Reasoning | Backend `src/oyi-core/runtime/operationalReasoning.ts` | `oyiCoreRuntime.evaluate()` and `receiveSignal()` call reasoning runtime |
| Recommendations | Backend `src/oyi-core/runtime/operationalRecommendations.ts` | Built after awareness and reasoning |
| Safe automation planning | Backend `src/oyi-core/runtime/safeAutomation.ts` | Automation plans generated from runtime bundle |
| Execution ledger | Backend `src/oyi-core/runtime/executionLedger.ts` | Signal and execution lifecycle stored and summarized centrally |
| Compatibility conversation | Backend `src/services/oyiUnifiedIntelligenceService.ts` | `/oyi/chat`, `/oyi/awareness`, `/oyi/threads` preserve legacy payload shape |
| Canonical runtime conversation | Backend `src/oyi-core/runtime/conversation.ts`, route `/oyi/runtime/conversation` | Structured runtime response from normalized signals and artifacts |
| Context resolution | Backend `src/services/context/contextResolutionService.ts` and `src/middleware/contextResolver.ts` | Resolves actor, surface, estate, home, module |
| Consumer presentation | Consumer `src/services/oyiService.ts`, `src/services/aiService.ts`, `src/lib/consumerAwareness.ts` | Mix of canonical and fallback intelligence paths |
| Facility presentation | Facility `services/oyiService.ts`, `store/useFacilityConversationStore.ts`, `services/facilityRealtime.ts` | More directly aligned to `/oyi` and runtime feeds than Consumer |

### Architectural rule status

Rule:
- Modules produce state, events and capabilities.
- Oyi Core interprets and coordinates them.
- Consumer and Facility present and execute through scoped interfaces.

Status:
- Partially true.
- Canonical runtime exists and is usable.
- Consumer and Facility still retain bypass paths, fallback interpreters, and compatibility layers that can answer or present without fully depending on the canonical runtime.

## 2. Canonical Runtime and Ownership

### Canonical

1. Backend `/oyi-core/*`
- Status: canonical
- Responsibility: normalized signals, awareness, reasoning, recommendations, automation plans, executive outputs, runtime subscriptions, execution ledger
- Evidence:
  - `src/oyi-core/service.ts`
  - `src/oyi-core/runtime/contextAwareness.ts`
  - `src/oyi-core/runtime/operationalReasoning.ts`
  - `src/oyi-core/runtime/executionLedger.ts`
  - `src/oyi-core/runtime/conversation.ts`

2. Backend `/oyi/runtime/*`
- Status: canonical
- Responsibility: direct runtime evaluation, conversation, executive briefing, execution history
- Evidence:
  - `src/routes/oyiRoutes.ts`

3. Backend request context resolver
- Status: canonical
- Responsibility: actor + surface + estate + home + module resolution
- Evidence:
  - `src/middleware/contextResolver.ts`
  - `src/services/context/contextResolutionService.ts`

4. Device operational signal emission
- Status: canonical
- Responsibility: normalized device-origin event generation into the Oyi runtime
- Evidence:
  - `src/services/deviceOperationalSignalService.ts`

5. Infrastructure event correlation
- Status: canonical but still domain-bounded
- Responsibility: correlate many low-level device outages into infrastructure incidents
- Evidence:
  - `src/services/infrastructureEventIntelligenceService.ts`

### Compatibility wrappers

1. Backend `/oyi/chat`, `/oyi/awareness`, `/oyi/threads`
- Status: compatibility wrapper
- Evidence:
  - explicit transitional note in `src/services/oyiUnifiedIntelligenceService.ts`
  - explicit compatibility note in `src/routes/oyiRoutes.ts`
- Purpose:
  - preserve older client payloads while canonical runtime lives under `/oyi/runtime/*`

2. Backend `/intelligence/*`
- Status: compatibility supervision layer, not canonical operational runtime
- Evidence:
  - freeze ownership note in `src/routes/intelligenceRoutes.ts`
- Purpose:
  - executive observability
  - event bus history
  - predictions
  - workflow observability

3. Backend `/ai/*`
- Status: compatibility / consumer-facing assistant and tool routing surface
- Evidence:
  - explicit note in `src/routes/aiRoutes.ts`
- Purpose:
  - action-capable assistant path
  - deterministic/fallback routing
- Risk:
  - remains a second conversational surface

### Duplicate or competing paths

1. Canonical runtime conversation vs compatibility chat
- Backend:
  - `src/oyi-core/runtime/conversation.ts`
  - `src/services/oyiUnifiedIntelligenceService.ts`
  - `src/routes/aiRoutes.ts`
- Severity: P1
- Current behavior:
  - there are three answer-capable paths:
    - `/oyi/runtime/conversation`
    - `/oyi/chat`
    - `/ai/chat`
- Expected behavior:
  - one canonical runtime answer path, with compatibility adapters delegating consistently

2. Consumer AI request chain
- Consumer:
  - `src/services/aiService.ts`
- Severity: P1
- Current behavior:
  - tries `/oyi/chat`
  - falls back to `/ai/chat`
  - then falls back to `/oyi/runtime/conversation`
- Expected behavior:
  - one canonical request path with a clear compatibility fallback only for controlled outages

3. Facility local runtime rebuild
- Facility:
  - `services/facilityRealtime.ts`
  - `services/conversationRuntimeService.ts`
- Severity: P2
- Current behavior:
  - if server runtime payload is missing, Facility locally evaluates Oyi runtime or locally builds conversation summaries
- Expected behavior:
  - backend should remain source of truth, with local fallback used only for continuity and clearly marked as such

## 3. Duplicate and Legacy Paths

### Legacy

1. `src/intelligence-core/*`
- Status: legacy but retained
- Role:
  - organizational intelligence
  - predictions
  - workflow orchestration
  - memory directory
  - event bus
- Problem:
  - some of its concepts overlap Oyi Core wording
  - can appear like a second intelligence framework
- Recommended direction:
  - keep as organizational/event-bus/observability layer
  - do not let it become a second operational runtime

2. Consumer `/ai` page and `aiService`
- Status: partially legacy, partially active
- Evidence:
  - `src/app/ai/page.tsx`
  - `src/services/aiService.ts`
- Problem:
  - still treats `/ai/chat` as a valid assistant surface
  - weakens canonicality of `/oyi`

### Safe to retire later

1. Direct consumer reliance on `/ai/chat` after `/oyi/chat` failure
- Safe to retire after canonical `/oyi` is stable enough

2. Facility local conversation fallback builder
- Safe to retire after backend runtime coverage is complete and always available

## 4. Context-Resolution Findings

### What is working

1. Actor, surface, estate, and home resolution are real backend concepts
- Backend file: `src/services/context/contextResolutionService.ts`
- Behavior:
  - validates estate memberships and home memberships
  - enforces that requested home belongs to allowed estate scope
  - supports facility access to homes within scoped estate set

2. Consumer active-home switching is explicit
- Consumer file: `src/hooks/useActiveContext.ts`
- Behavior:
  - active context is refreshed from backend
  - remembered home/estate are stored locally
  - switching is persisted and rehydrated

3. Facility estate context is explicit
- Facility file: `store/useContextStore.ts`
- Behavior:
  - resolved context comes from `/me/context/resolved?surface=facility`

### What is incomplete or missing

1. Narrow object context is not part of canonical request context
- Severity: P1
- Backend files:
  - `src/services/context/contextResolutionService.ts`
  - `src/types/oisContext.ts`
- Current behavior:
  - canonical resolved context includes surface, estate, home, module, target
  - it does not canonically resolve room, device, visitor, maintenance ticket, wallet, service account, infrastructure asset
- Expected behavior:
  - narrow operational object should be formally resolved or passed in a trusted scoped contract

2. Consumer device drawer sends rich explicit device context, but this is a special-case path
- Severity: P1
- Consumer file:
  - `src/app/devices/DevicesClient.tsx`
  - `src/services/aiService.ts`
- Backend file:
  - `src/services/oyiUnifiedIntelligenceService.ts`
- Current behavior:
  - explicit device context is passed only because the drawer manually includes it
  - this is not generalized across visitors, wallet, services, maintenance, rooms, messages
- Expected behavior:
  - object-bound conversation should be a shared operational-object contract across modules

3. Narrowest-valid-context rule is not formalized centrally
- Severity: P1
- Current behavior:
  - device drawer does explicit priming
  - `/me/context/resolved` handles estate/home only
  - `classifyUniversalIntent()` does domain keyword detection but not scoped entity resolution
- Expected behavior:
  - selected object wins unless user widens scope

4. Consumer remembered context can override freshly resolved context locally
- Severity: P2
- Consumer file:
  - `src/hooks/useActiveContext.ts`
- Current behavior:
  - local remembered context is applied on top of backend-resolved context
- Risk:
  - stale local remembered context can produce context mismatch until refresh settles

## 5. Intent-Understanding Findings

### What exists

1. Universal keyword classifier
- Backend file:
  - `src/intelligence-core/intentRouter.ts`
- Status: incomplete
- Behavior:
  - domain classification by regex
  - intent classification by regex
  - action classification by regex

2. Canonical runtime conversation classifier
- Backend file:
  - `src/oyi-core/runtime/conversation.ts`
- Status: presentation-only classifier
- Behavior:
  - maps query into broad conversation intent categories by regex
  - builds summarized response from provided artifacts

3. Compatibility conversational intent system
- Backend file:
  - `src/services/oyiUnifiedIntelligenceService.ts`
- Status: active and richer than the canonical runtime conversation
- Behavior:
  - carries conversation state
  - active entity
  - pending confirmation
  - operation routing

### Core problem

The most capable conversational behavior currently lives in the compatibility layer, not in the canonical `/oyi/runtime/conversation` path.

- Severity: P1
- Current behavior:
  - `src/oyi-core/runtime/conversation.ts` mainly summarizes filtered signals/awareness/insights
  - `src/services/oyiUnifiedIntelligenceService.ts` is where active entity handling, confirmation handling, thread persistence, and operation responses actually live
- Expected behavior:
  - canonical runtime should own this behavior or the compatibility layer should be explicitly elevated and simplified into canonical runtime ownership

### Natural-language strength

Observed strengths:
- understands common domain nouns through keyword patterns
- supports some action verbs: approve, assign, turn on/off, pay, create
- supports confirmation flow words: cancel, yes/no

Observed weaknesses:
- no evidence of robust pronoun resolution beyond active entity carry-over
- no evidence of Nigerian English specialization
- no evidence of ordinal resolution like “the second one” in canonical shared logic
- no evidence of generalized cross-module follow-up handling outside compatibility chat
- no evidence of deep correction handling like “No, I meant the other light” as a shared runtime skill

Severity:
- P1 for object-bound follow-ups outside the device drawer and compatibility state
- P3 for richer language variety beyond current product-freeze requirements

## 6. Conversation Findings

### Backend

1. Thread persistence exists
- Backend file:
  - `src/services/oyiUnifiedIntelligenceService.ts`
- Tables:
  - `oyi_conversation_threads`
  - `oyi_conversation_messages`
- Status: canonical enough for compatibility chat

2. Active entity state exists
- Backend file:
  - `src/services/oyiUnifiedIntelligenceService.ts`
- Fields:
  - `active_entity_type`
  - `active_entity`
  - `active_entity_id`
  - `active_entity_label`
  - `conversation_state`
  - `pending_confirmation_id`
- Status: strong foundation

3. Runtime conversation does not appear to own thread persistence
- Backend files:
  - `src/oyi-core/runtime/conversation.ts`
  - `src/services/oyiUnifiedIntelligenceService.ts`
- Severity: P1
- Current behavior:
  - canonical runtime conversation returns structured response
  - compatibility layer owns persisted conversational state and follow-up continuity

### Consumer

1. Device drawer thread continuity exists
- Consumer file:
  - `src/app/devices/DevicesClient.tsx`
- Current behavior:
  - restores matching thread
  - sends `thread_id`
  - preserves message history in the drawer

2. Global consumer AI uses `aiService` fallback ladder
- Consumer file:
  - `src/services/aiService.ts`
- Problem:
  - continuity and truthfulness differ depending on which backend route answered

### Facility

1. Facility conversation store is coherent
- Facility file:
  - `store/useFacilityConversationStore.ts`
- Strength:
  - hydrates thread list
  - restores threads
  - persists current thread in session storage
- Limitation:
  - only facility assistant surfaces are wired this way, not every facility object drawer

## 7. Memory Findings

### Existing memory layers

1. Thread/message memory
- Backend:
  - `oyi_conversation_threads`
  - `oyi_conversation_messages`
- Status: canonical for compatibility chat

2. Resident memory
- Backend file:
  - `src/services/intelligenceMemoryService.ts`
- Storage:
  - `resident_memory`
- Uses:
  - recent intelligence query
  - latest maintenance request
  - favorite scenes

3. Home timeline
- Backend:
  - `home_timeline`
- Used by:
  - activity
  - infrastructure event intelligence
  - device memory answers

4. Execution ledger memory
- Backend:
  - `src/oyi-core/runtime/executionLedger.ts`

### Gaps

1. Memory is fragmented across thread state, resident memory, home timeline, activity, device usage counters, and execution history
- Severity: P1
- Current behavior:
  - memory exists in many stores but is not clearly unified into one canonical memory query layer

2. Cross-module memory is incomplete
- Severity: P2
- Evidence:
  - resident memory explicitly stores some scene and maintenance context
  - no equivalent shared object memory layer for wallet, services, visitors, or facility assets is obvious

3. Memory retrieval is selective, not generalized
- Severity: P2
- Example:
  - `answerDeviceHistoryQuestion()` has specialized retrieval logic for device history and infrastructure outages
  - this is not generalized as a single evidence/memory retrieval framework

## 8. Evidence and Truthfulness Findings

### Strengths

1. Canonical runtime has explicit evidence objects
- Backend:
  - `src/oyi-core/contracts/operationalSignal.ts`
  - `src/oyi-core/runtime/conversation.ts`
  - `src/oyi-core/runtime/contextAwareness.ts`
  - `src/oyi-core/runtime/operationalReasoning.ts`

2. Device runtime already preserves:
- observed vs provider vs physical origin
- confidence/trust score
- changed keys
- old/new state
- telemetry summary

3. Infrastructure event correlation uses grouped evidence
- Backend:
  - `src/services/infrastructureEventIntelligenceService.ts`

### Problems

1. Truth-state language is not formalized across surfaces
- Severity: P1
- Current behavior:
  - backend has confidence/evidence
  - frontend language does not consistently distinguish confirmed vs inferred vs predicted vs pending confirmation

2. `/ai/chat` can still produce tool-routed answers that are not obviously tied back to the canonical Oyi runtime truth model
- Severity: P1

3. Consumer and Facility do some local interpretation of runtime into human text
- Severity: P2
- Consumer:
  - `src/lib/consumerAwareness.ts`
- Facility:
  - `services/signalAwarenessService.ts`
- Risk:
  - same event can be described differently per surface

## 9. Execution and Safety Findings

### Strong parts

1. Execution ledger statuses exist centrally
- Backend:
  - `src/oyi-core/runtime/executionLedger.ts`

2. Device signal origin classification is rich
- Backend:
  - `src/services/deviceOperationalSignalService.ts`

3. AI confirmation workflow exists
- Backend:
  - `src/ai/commandRouter.ts`
  - `src/services/oyiUnifiedIntelligenceService.ts`

### Weak points

1. Action safety is split between AI command router and compatibility conversation layer
- Severity: P1
- Current behavior:
  - `/ai` tool routing can propose and confirm actions
  - `/oyi/chat` compatibility layer can also manage pending confirmations and entity operations
- Expected behavior:
  - one canonical action proposal and confirmation model

2. Canonical runtime conversation is not obviously the execution gatekeeper
- Severity: P1

3. Some suggestion chips are UI-routed rather than intelligence-routed
- Severity: P2
- Example:
  - Consumer device drawer “Create automation” and similar actions route directly to other pages rather than always resolving through one canonical intent/execution path

## 10. Awareness Findings

### Backend

1. Awareness engine is real and useful
- Canonical:
  - `src/oyi-core/runtime/contextAwareness.ts`

2. Infrastructure event awareness is advanced
- Canonical:
  - `src/services/infrastructureEventIntelligenceService.ts`

### Consumer

1. Home awareness is a merge of:
- backend awareness
- latest signal interpretation
- latest execution interpretation
- local dedupe
- Files:
  - `src/app/home/page.tsx`
  - `src/lib/consumerAwareness.ts`

Problem:
- the merged result is practical, but it means awareness is not a single backend-authored sentence in all cases

### Facility

1. Facility awareness can be server-authored or locally rebuilt
- Files:
  - `services/facilityRealtime.ts`
  - `services/signalAwarenessService.ts`

Problem:
- if server runtime payload is missing, Facility computes local awareness fallback

Severity:
- P1 where contradictory awareness can emerge
- P2 where fallback remains semantically close but not guaranteed identical

## 11. Notification Findings

### Strengths

1. Notification routing is canonicalized
- Backend:
  - `src/services/notifications/notificationRoutingService.ts`
- Status: strong

2. Notification decision policy is centralized
- Backend:
  - `src/services/notificationPolicyService.ts`

### Problems

1. Consumer activity reinterprets notifications again into resident activity language
- Consumer:
  - `src/services/activityService.ts`
- Severity: P2

2. Facility notification-to-target mapping is still mostly page/drawer routing, not deeper object conversation handoff
- Severity: P2

## 12. Activity Findings

### Strengths

1. Backend activity feed is normalized and notification-aware
- Backend:
  - `src/routes/activity.ts`

2. Consumer activity page humanizes raw activity into safer language
- Consumer:
  - `src/services/activityService.ts`

### Problems

1. Activity is not always the same wording as awareness or conversation
- Severity: P2

2. Consumer activity derives extra runtime awareness on the client
- Severity: P2
- Risk:
  - same event can read differently in home hero, activity tab, notification, and conversation

## 13. Module-by-Module Capability Assessment

### Devices

Current state:
- State reporting: working
- Channel identification: working for multi-gang switch runtime
- Capability-first classification: partially working
- Health explanation: partially working
- Last action explanation: partially working
- Physical vs app vs automation vs provider distinction: backend working, frontend surface partially aligned
- Activity retrieval: working via specialized path
- Memory retrieval: partial
- Relationship retrieval: partial
- Diagnose failure: partial
- Timer: partial, mostly UI-driven for current drawer
- Schedule: partial
- Automation creation: mostly navigational handoff, not full conversational completion
- Rename/change room: partial UI flows
- IR parent/child handling: architecture exists, provider import honesty still unresolved
- Selected-device scoping: strongest in Consumer device drawer, not generalized globally

Assessment:
- Canonical backend foundation is strong
- Consumer device drawer is the most advanced object-bound intelligence surface
- Still not the shared contract for every module

### Spaces and rooms

Current state:
- Room context exists in UI and some routing
- No evidence of fully canonical room-scoped object conversation contract
- Facility and Consumer both treat rooms more as pages/filters than first-class intelligence objects

Assessment:
- Incomplete
- P1 for future Digital Twin reuse if not aligned

### Visitors and access

Current state:
- compatibility conversation layer contains visitor operations and pending confirmation
- target routing exists
- history and access operations are available

Assessment:
- partial
- not yet clearly lifted into canonical runtime conversation

### Maintenance

Current state:
- compatibility layer supports assignment and read-only explanations
- activity and workflow information exist

Assessment:
- partial
- escalation and shared infrastructure correlation need clearer unified path

### Wallet and finance

Current state:
- payment runtime and wallet flow exist
- notification and receipt flow exist
- conversational object memory appears limited

Assessment:
- partial
- financial confirmation and conversational continuity need stricter object-bound handling

### Infrastructure Services

Current state:
- backend service registry and signals exist
- Consumer service cards exist
- conversation context appears less mature than devices

Assessment:
- partial
- service-account targeting and tariff/billing reasoning still need stronger scoped intelligence contract

### Community and messages

Current state:
- message/community routing exists
- object target routing exists
- no evidence of deep thread-scoped intelligence parity with device drawer

Assessment:
- partial

### Facility infrastructure

Current state:
- facility attention, operational reasoning, and runtime feeds are strong
- multiple local fallback builders still exist

Assessment:
- strong but not fully canonicalized end-to-end

### Digital Twin readiness

Current state:
- signals already carry estate/building/room/device relationships
- OIS contexts do not yet canonically resolve spatial object nodes beyond estate/home/module
- object conversation contract is not yet generalized

Assessment:
- moderate readiness for runtime reuse
- low readiness for full object-bound Twin conversation without context contract expansion

## 14. Consumer Intelligence Gaps

1. `aiService` still falls through three answer engines
- File: `src/services/aiService.ts`
- Severity: P1

2. Object-bound intelligence is advanced for devices but not generalized for wallet, service, visitor, maintenance, message, room
- Files:
  - `src/app/devices/DevicesClient.tsx`
  - lack of equivalent shared object contract elsewhere
- Severity: P1

3. Home awareness is assembled client-side from multiple sources
- Files:
  - `src/app/home/page.tsx`
  - `src/lib/consumerAwareness.ts`
- Severity: P2

4. Activity humanization is separate from awareness/conversation wording
- File:
  - `src/services/activityService.ts`
- Severity: P2

## 15. Facility Intelligence Gaps

1. Facility realtime and conversation runtime perform local fallback intelligence generation
- Files:
  - `services/facilityRealtime.ts`
  - `services/conversationRuntimeService.ts`
- Severity: P1

2. Facility object-bound conversation is centralized on intelligence surfaces, not uniformly embedded in every asset drawer
- Severity: P2

3. Typed Oyi target routing is good, but facility still has multiple page-specific interpretive services
- Severity: P2

## 16. Digital Twin Readiness

### Reusable now

- normalized operational signals
- awareness objects
- execution ledger
- infrastructure event correlation
- device relationships
- room and estate references
- typed target model

### Missing for Twin-grade object intelligence

- canonical selected-object resolution for building/floor/zone/twin node
- generalized object conversation state beyond device drawer
- shared relationship query contract for non-device objects
- formal narrowest-context policy across all modules

## 17. Language Inconsistencies

Violations found:

1. Backend/runtime terms still appear in some frontend helper and labels
- Examples:
  - `runtime`
  - `provider`
  - `telemetry`
  - `execution`
  - `source`
- Files:
  - Consumer `src/lib/consumerAwareness.ts`
  - Consumer `src/services/activityService.ts`
  - Facility service and module labels around runtime/posture tooling

2. Error wording remains inconsistent across services
- Example:
  - “Oyi could not reach the operational runtime right now.”
  - generic “Failed to load”
  - module-specific fallback messages

3. Same event can be rendered as:
- awareness summary
- activity summary
- notification title
- conversation answer
with different wording

Severity:
- mostly P2

## 18. Fallback Problems

1. Consumer AI fallback ladder can change answer semantics
- File: `src/services/aiService.ts`
- Severity: P1

2. Facility local runtime fallbacks can diverge from server truth
- Files:
  - `services/facilityRealtime.ts`
  - `services/conversationRuntimeService.ts`
- Severity: P1

3. Device list and activity layers sometimes reinterpret missing/failed data into empty or generic states
- Severity: P2

4. Context fallback depends on local remembered home/estate
- File: `src/hooks/useActiveContext.ts`
- Severity: P2

## 19. Test Matrix Results

This audit did not run the full corpus live. Results below are evidence-based classifications from code inspection.

### Static pass

- Canonical estate/home context resolution exists
- Device explicit object context can be passed end to end
- Conversation threads persist
- Pending confirmation model exists
- Infrastructure event correlation exists
- Notification policy is centralized
- Execution ledger is centralized

### Static fail / partial

- One canonical conversational runtime path for all surfaces: fail
- Generalized object-bound context across all modules: fail
- One canonical frontend answer path: fail
- Canonical truth-state language across awareness/activity/notification/conversation: fail
- Rich natural-language understanding beyond keyword heuristics: partial
- Canonical room/service/wallet/visitor object memory: partial

See `docs/oyi-intelligence-capability-matrix.json`.

## 20. Critical Production Failures

### P0

None directly proven in this audit phase by code inspection alone.

### P1

1. Multiple conversational answer engines can produce different truths
- Backend + Consumer

2. Narrow selected-object context is not a shared canonical contract across modules
- Backend + Consumer + Facility

3. Canonical runtime conversation is less capable than the compatibility conversation layer
- Backend

4. Facility and Consumer both locally reinterpret canonical runtime into surface-specific awareness/activity copy
- Consumer + Facility

5. Action safety is split across compatibility chat and `/ai` command router
- Backend

## 21. High-Priority Alignment Work

1. Promote one canonical conversational execution contract
- likely by consolidating `oyiUnifiedIntelligenceService` stateful capabilities into the canonical `/oyi` ownership model rather than rebuilding a new engine

2. Generalize object-bound context
- device
- room
- visitor
- maintenance
- wallet
- service
- infrastructure asset
- message thread

3. Make the narrowest-valid-context rule explicit and shared

4. Standardize frontend answer path
- prefer `/oyi`
- retain `/ai` only as controlled compatibility wrapper

5. Standardize truth states and response policy
- confirmed
- observed
- inferred
- predicted
- pending confirmation
- unavailable
- unsupported
- permission restricted

## 22. Medium-Priority Refinements

1. Remove local awareness/conversation fallbacks where backend runtime is already sufficient
2. Unify language across awareness/activity/notification/conversation
3. Expand memory retrieval across modules
4. Strengthen ordinal/pronoun/correction handling
5. Add formal test harness for object-bound conversation flows

## 23. Items Already Complete and Not to Rebuild

Do not rebuild these from scratch:

1. Oyi Core signal normalization and runtime bundle generation
2. Execution ledger
3. Infrastructure event correlation
4. Notification routing policy
5. Context resolution for estate/home membership
6. Device operational signal enrichment
7. Conversation thread persistence foundation
8. Device drawer object-context foundation in Consumer

## 24. Recommended Implementation Phases

### Phase 1
- Canonicalize conversation ownership
- settle `/oyi` vs `/ai` vs `/intelligence`
- preserve compatibility wrappers but stop divergent logic growth

### Phase 2
- Generalize operational-object context contract
- add object scope for room, visitor, maintenance, wallet, service, infrastructure asset

### Phase 3
- Align frontend consumers
- Consumer and Facility both consume one canonical truth model
- remove contradictory local fallbacks where safe

### Phase 4
- Standardize language, truth states, and evidence display

### Phase 5
- Expand memory and relationship reasoning
- prepare Digital Twin object selection reuse

## 25. Release-Candidate Acceptance Criteria

Oyi should be considered intelligence-aligned when:

1. One canonical backend runtime owns interpretation, execution proposal, and confirmation logic.
2. Compatibility layers only adapt payload shape; they do not introduce competing reasoning.
3. A selected object remains the active target until the user explicitly changes scope.
4. Consumer and Facility describe the same operational event consistently.
5. `/ai` does not bypass canonical runtime truth or safety policy.
6. Every operational object has:
   - identity
   - scoped context
   - awareness
   - conversation
   - activity/history
   - safe actions
7. Truth states are explicit and honest.
8. Fallbacks distinguish:
   - no data
   - missing context
   - permission denied
   - provider unavailable
   - backend failure
   - network failure
   - unsupported capability

## Detailed Findings

| ID | Severity | Repository | File | Function / Component | Current behavior | Expected behavior | Dependency | Recommended correction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-001 | P1 | Backend | `src/services/oyiUnifiedIntelligenceService.ts` | compatibility conversation service | Most stateful conversation behavior lives here instead of canonical runtime conversation | Canonical Oyi conversation should own stateful object handling or this layer should be formally promoted as the canonical `/oyi` stateful runtime | Backend | Consolidate ownership; avoid a second “smart” conversation layer |
| F-002 | P1 | Backend | `src/oyi-core/runtime/conversation.ts` | `buildConversationResponse` | Summarizes artifacts but does not appear to own thread state, active object, or confirmations | Canonical runtime conversation should support stateful scoped conversation | Backend | Expand canonical runtime ownership using existing compatibility behaviors rather than rebuilding |
| F-003 | P1 | Consumer | `src/services/aiService.ts` | `chat` | Falls through `/oyi/chat` → `/ai/chat` → `/oyi/runtime/conversation` | One canonical answer path should remain primary and deterministic | Backend + Consumer | Collapse fallback ladder into one canonical path plus explicit degraded-mode fallback |
| F-004 | P1 | Backend | `src/services/context/contextResolutionService.ts` | `resolveOisContext` | Resolves estate/home/module but not narrow object context | Narrow selected object should be part of trusted scoped context | Shared | Extend operational context contract to typed object scope |
| F-005 | P1 | Consumer | `src/app/devices/DevicesClient.tsx` | device conversation flow | Device drawer manually passes rich object context, but only for devices | Same object-bound pattern should apply across all operational objects | Shared | Promote drawer context contract into shared operational-object payload |
| F-006 | P1 | Facility | `services/conversationRuntimeService.ts` | `runConversationRuntime` | Builds local fallback conversation response if backend runtime is unavailable | Facility should prefer backend-authored conversation truth | Backend + Facility | Keep as temporary continuity fallback only, not equal path |
| F-007 | P1 | Facility | `services/facilityRealtime.ts` | `emitLocal` | Locally rebuilds runtime bundle when server runtime payload is absent | One canonical runtime should author awareness/recommendation truth | Backend + Facility | Tighten server payload contract or clearly mark fallback provenance |
| F-008 | P1 | Backend | `src/ai/commandRouter.ts`, `src/routes/aiRoutes.ts` | AI tool routing | Action proposal and confirmation also exist in `/ai` lane | Action safety should not diverge from canonical Oyi runtime | Backend | Merge or wrap `/ai` actions through canonical confirmation/execution contract |
| F-009 | P2 | Consumer | `src/hooks/useActiveContext.ts` | remembered context handling | Local remembered context can override fresh backend-resolved context | Backend-resolved context should remain authoritative | Consumer | Apply remembered context only after explicit backend compatibility validation |
| F-010 | P2 | Consumer | `src/lib/consumerAwareness.ts` | awareness interpreter | Converts runtime into natural language locally | Surfaces should consume one canonical truth model and only lightly adapt wording | Shared | Define shared truth-state and wording contract |
| F-011 | P2 | Consumer | `src/services/activityService.ts` | activity normalization | Reinterprets notifications and runtime into separate activity copy | Activity, awareness, notification, and conversation should agree | Shared | Normalize event language policy centrally |
| F-012 | P2 | Facility | `services/signalAwarenessService.ts` | realtime signal mapping | Rebuilds awareness from realtime payload locally | Same incident should read the same across surfaces | Shared | Prefer server-authored awareness or shared interpretation library |
| F-013 | P2 | Backend | `src/services/intelligenceMemoryService.ts` | resident/home memory utilities | Memory exists across multiple stores with selective use | Memory should be queryable as one explainable layer | Backend | Build unified memory access contract over existing stores |
| F-014 | P3 | Backend | `src/intelligence-core/intentRouter.ts` | `classifyUniversalIntent` | Regex-based broad intent/domain classification only | Richer informal, ordinal, corrective language support | Backend | Expand intent coverage after canonical ownership alignment |

