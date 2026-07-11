# Oyi Canonical Intelligence Migration

Updated: 2026-07-11

Scope:
- Backend: `/Users/ochigaidoko/Documents/Ochiga-backend`
- Consumer: `/Users/ochigaidoko/Documents/New project/Oyi-os-frontend`
- Facility: `/Users/ochigaidoko/Documents/facility-oyi`

## Final Ownership Boundary

### Oyi Core owns

- canonical conversation runtime
- canonical truth contract
- operational-object resolution
- context precedence
- response truth state
- compatibility delegation

### Domain modules continue owning

- source data
- state
- events
- capabilities
- permissions
- provider adapters
- execution handlers

### Consumer, Facility, and future Twin own

- presentation
- interaction
- layout
- visual state
- scoped user input

They no longer decide operational truth independently when canonical runtime is available.

## Systems Retained

### Retained as canonical foundations

- `src/oyi-core/*`
- `src/services/context/contextResolutionService.ts`
- `src/services/deviceOperationalSignalService.ts`
- `src/services/infrastructureEventIntelligenceService.ts`
- existing conversation-thread persistence in `src/services/oyiUnifiedIntelligenceService.ts`

### Retained as compatibility or observability

- `/oyi/chat`
- `/ai/chat`
- `/intelligence/*`
- `src/intelligence-core/*`

## Systems Migrated

### Migrated into canonical ownership

1. Stateful conversation ownership
- Previous owner: `src/services/oyiUnifiedIntelligenceService.ts`
- Canonical owner after migration: `src/oyi-core/runtime/canonicalConversationRuntime.ts`
- Notes:
  - Canonical runtime now wraps the stateful thread and active-entity behavior.
  - Compatibility routes delegate instead of independently reasoning.

2. Selected-object context contract
- Previous owner: surface-specific payload shaping
- Canonical owner after migration: `src/oyi-core/runtime/canonicalConversationRuntime.ts`
- Notes:
  - Explicit request object wins.
  - Thread active object is next.
  - Home and estate scope remain fallback anchors.

3. Truth-state contract
- Previous owner: implicit interpretation in each surface
- Canonical owner after migration: `src/oyi-core/runtime/canonicalConversationRuntime.ts`

## Systems Wrapped

1. `/oyi/chat`
- Now delegates to canonical runtime and adapts the response into compatibility payload shape.

2. `/ai/chat`
- Now delegates to canonical runtime and adapts into the historical AI assistant payload shape.
- Confirm/cancel endpoints remain compatibility handlers for existing confirmation records.

## Systems Deprecated

1. Direct conversational reasoning inside `/ai/chat`
- Deprecated by delegation.

2. Direct route-level reasoning inside `/oyi/chat`
- Deprecated by delegation.

3. Local frontend answer-path ladders
- Consumer now prefers the canonical runtime endpoint.
- Facility now prefers the canonical runtime endpoint.

## Systems Deleted

No major backend subsystem was deleted in this pass.

Reason:
- this migration prioritizes consolidation without breaking compatibility
- deletion should follow usage observation and removal metrics

## Compatibility Concerns

1. Existing clients using `/oyi/chat`
- Safe: payload shape remains available
- Change: truth now originates from canonical runtime

2. Existing clients using `/ai/chat`
- Safe: assistant shape remains available
- Change: answer generation now delegates into canonical runtime

3. Existing thread persistence
- Safe: thread and message persistence remain in the compatibility service
- Change: canonical runtime now depends on that persistence layer instead of re-creating thread state elsewhere

## Database and API Compatibility

### Database

No schema migration was required for this consolidation pass.

### API

- `/oyi/runtime/conversation` is canonical
- `/oyi/chat` remains compatibility
- `/ai/chat` remains compatibility

## Migration Sequence Implemented

1. Added canonical conversation runtime wrapper under Oyi Core
2. Added canonical Operational Object contract
3. Added canonical Truth contract
4. Rewired `/oyi/runtime/conversation` to canonical runtime
5. Rewired `/oyi/chat` to canonical runtime adapter
6. Rewired `/ai/chat` to canonical runtime adapter
7. Switched Consumer `oyiService.chat()` to `/oyi/runtime/conversation`
8. Removed Consumer answer-semantic fallback ladder in `aiService`
9. Switched Facility `oyiService.chat()` to `/oyi/runtime/conversation`
10. Marked Facility local conversation fallback as unconfirmed continuity behavior
11. Marked Facility realtime local runtime rebuild as local fallback provenance

## Validation Evidence

Backend:
- `git diff --check`
- added:
  - `smoke:operational-object-context`
  - `smoke:canonical-truth`
  - `smoke:compatibility-delegation`

Consumer:
- canonical runtime endpoint adopted for Oyi chat
- device drawer now sends explicit operational-object context

Facility:
- canonical runtime endpoint adopted for Oyi chat
- local fallbacks now marked as local continuity behavior

## Recommended Removal Timeline

### Next pass

- observe `/ai/chat` and `/oyi/chat` usage after canonical rollout
- add backend metrics for compatibility-route calls if not already present

### After stable production observation

- move remaining thread persistence helpers out of compatibility service if needed
- reduce route-specific helper logic in `src/routes/aiRoutes.ts`
- retire direct frontend local interpretation where canonical server truth is already available

## Final Rule

There is one Oyi brain, one context, one active operational object, one truth, and one safe conversation path.

- Backend runtime owns truth.
- Compatibility routes adapt.
- Consumer and Facility present.
