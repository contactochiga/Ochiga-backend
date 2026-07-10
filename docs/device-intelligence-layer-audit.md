# Oyi Device Intelligence Layer Audit

Date: 2026-07-10

## Scope

This audit reviews the canonical device lifecycle across:

- Ochiga Backend device adapters, registry, runtime, command, and signal layers
- Oyi Core awareness, execution, activity, and notification integration
- Consumer OS device listing, runtime contract handling, and device drawer conversation
- Facility OS device registry and live infrastructure consumption

The goal is consolidation, not replacement.

## Canonical Lifecycle

Canonical device flow:

1. Provider account connection
2. Device discovery/import
3. Canonical device record
4. Estate/home/room assignment
5. Capability normalization
6. Renderer selection from normalized capabilities
7. Command validation and dispatch
8. Provider acknowledgement
9. State verification or partial confirmation
10. Execution/event recording
11. Oyi Core operational signal
12. Activity, awareness, and notification policy
13. Conversation, scenes, and automation follow-up

## System Classification

### Canonical

- `src/device/runtime/deviceStateEnrichment.ts`
  - canonical provider-state normalization
  - capability-first device classification
  - control profile, supported controls, health, telemetry, activity summary
- `src/controllers/deviceEstateController.ts`
  - canonical resident/facility registry response surface
  - IR child upsert support for estate listing
- `src/controllers/deviceStateController.ts`
  - canonical per-device runtime contract endpoint
- `src/controllers/deviceCommandController.ts`
  - canonical permission, scope, validation, provider dispatch, and signal path
- `src/services/deviceOperationalSignalService.ts`
  - canonical translation from runtime/device events into normalized Oyi Core signals
- `src/device/bridge.ts`
  - canonical provider/device-event ingestion and dedupe boundary
- `src/controllers/deviceIrController.ts`
  - canonical IR hub / virtual appliance API surface
- `src/services/deviceAnalyticsService.ts`
  - canonical device event history and usage counters

### Compatibility Wrappers

- `src/routes/aiRoutes.ts`
  - may initiate device actions, but should continue delegating execution to the canonical device command controller
- `src/services/watchAdapterService.ts`
  - watch-triggered device actions route into the canonical command path
- legacy websocket `device:update` emissions in `src/controllers/deviceCommandController.ts` and `src/device/bridge.ts`
  - retained for frontend compatibility

### Incomplete / Needs Migration

- Device command lifecycle status was previously too coarse
  - provider acceptance and late confirmation were collapsing to executed/failed
- Device runtime response lacked derived memory, relationship, and predictive context
- Consumer drawer still exposed multiple primary surfaces instead of one Oyi response surface

### Deprecated But Retained

- Older AI route fallbacks for chat are retained as compatibility layers, but Oyi conversation remains the canonical intelligence entry
- Direct provider-shaped UI assumptions are deprecated and should be removed progressively from remaining frontend edge cases

### Safe To Retire Later

- Any resident-facing UI that still depends on raw provider/state labels instead of:
  - `primary_state`
  - `health_status`
  - `supported_controls`
  - `control_profile`
  - `activity_summary`

## Ownership Rules

### Oyi Core Owns

- normalized operational signals
- awareness
- reasoning
- recommendations
- automation plans
- conversation runtime
- executive intelligence
- execution ledger
- runtime subscriptions

### Device Runtime Owns

- provider communication
- discovery
- state read
- command execution
- provider/device health
- telemetry conversion into normalized signals

### Consumer / Facility Own

- visualization
- scoped device control entry points
- device activity presentation
- conversation UX

They must not create a second intelligence model.

## Current Backend Status

### Capability-First Classification

Status: canonical after refinement

The runtime now prioritizes:

1. explicit canonical override
2. capability codes / provider function schema
3. provider category and metadata
4. product/model metadata
5. name text only as the final hint

Result:

- `Room 2 AC Switch` remains a switch when it exposes switch or relay capabilities
- water-heater relays remain switches
- IR AC children can remain climate remotes when their profile truly exposes climate controls

### Multi-Gang Channels

Status: canonical after refinement

The normalized runtime now exposes `channel_definitions` with:

- `index`
- `code`
- `name`
- `state`
- `controllable`
- `last_update`

### Command Lifecycle

Status: improved, canonical path retained

The command path now distinguishes:

- pending
- dispatched
- provider accepted
- state confirmed
- executed
- partial confirmation

Notes:

- provider acceptance without an immediate readable state now returns partial confirmation instead of a false failure
- unsupported commands are still rejected before provider dispatch
- self-initiated state confirmations continue to enrich the same operational path

Remaining future hardening:

- extend execution-ledger status vocabulary end-to-end if broader reporting requires these intermediate states natively in ledger storage

### IR Architecture

Status: canonical import flow improved, provider-limited

Backend currently supports:

- IR hub detection
- provider profile listing
- virtual child creation
- automatic IR child upsert from exposed provider profile hints
- parent-child command routing

Provider limitation:

- Tuya cloud support still depends on which remote profiles and profile metadata the connected project exposes
- Oyi should not invent unavailable remotes or unsupported learning flows

## Consumer / Facility Audit

### Consumer

Canonical:

- enriched runtime contract consumption
- capability-first renderer selection
- conversational device drawer direction

Needs refinement:

- remove remaining duplicate primary sections in the drawer
- keep one live Oyi response surface
- keep one loading stage visible at a time

### Facility

Canonical:

- registry and live infrastructure surfaces already consume enriched device health/runtime fields

No backend duplication found in Facility.

## Device Intelligence Context

The canonical per-device runtime should expose derived context from existing data, not a parallel store:

- memory summary
- relationships
- predictive findings
- recent executions
- active scenes
- active automations
- conversation context

This is now derived from:

- `device_states`
- `device_events`
- `device_usage_counters`
- `consumer_scenes`
- `consumer_automations`
- device parent/child relationships

## Remaining Risks

- Intermediate execution states are surfaced in command metadata and responses, but some older consumers may still only understand executed/failed
- IR completeness still depends on provider-visible profile availability
- Facility UI was audited but not deeply refactored in this pass; remaining gaps there should be visual/consumption-level, not architectural
- Real-device verification remains required for final freeze confidence

## Freeze Boundary Recommendation

Treat the following as freeze-critical and canonical:

- one capability-first runtime contract
- one command lifecycle
- one Oyi Core signal path
- one resident/facility visualization model
- one parent-child IR relationship model

Do not introduce:

- provider-specific UI branches
- a second device intelligence engine
- a second conversation path
- separate virtual-device command systems outside the canonical parent-hub route
