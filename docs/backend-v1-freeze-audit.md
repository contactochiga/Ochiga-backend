# Ochiga Backend v1.0 Freeze Audit

## Canonical systems

### Oyi Core runtime
- `src/oyi-core/contracts/operationalSignal.ts`
- `src/oyi-core/runtime/*`
- `src/oyi-core/service.ts`
- `src/routes/oyiRoutes.ts`

Ownership:
- normalized operational signals
- awareness
- reasoning
- recommendations
- automation plans
- runtime conversation
- executive briefing
- execution ledger
- runtime subscriptions

### Device runtime
- `src/device/adapters/*`
- `src/device/bridge.ts`
- `src/controllers/deviceCommandController.ts`
- `src/services/deviceRuntimeService.ts`
- `src/services/deviceOperationalSignalService.ts`
- `src/services/deviceAnalyticsService.ts`

Ownership:
- adapter communication
- discovery
- state reads
- command execution
- provider/device health
- telemetry conversion into Oyi Core signals

### Infrastructure Services
- `src/controllers/servicesController.ts`
- `src/routes/services.ts`
- `src/services/homeServiceProvisioning.ts`
- `src/services/infrastructureServiceProviders.ts`
- `src/services/infrastructureServiceSignals.ts`
- `src/services/serviceRegistryEvents.ts`

Ownership:
- resident service accounts
- tariffs and policies
- provider readiness
- vending and transaction foundation
- settlements
- service operational signals

### Activity / notifications
- `src/routes/activity.ts`
- `src/routes/notifications.ts`
- `src/services/NotificationService.ts`
- `src/services/PushNotificationService.ts`
- `src/services/notifications/notificationRoutingService.ts`

Ownership:
- user-visible event history
- push / in-app / digest routing
- notification actionability

## Compatibility wrappers

### Oyi compatibility endpoints
- `GET /oyi/awareness`
- `POST /oyi/chat`
- `GET /oyi/threads`
- `GET /oyi/threads/:threadId/messages`

Status: compatibility wrapper

Reason:
- preserves older frontend payload shapes
- canonical runtime remains `/oyi/runtime/*`

### Generic signal ingress
- `src/routes/signals.ts`
- `src/controllers/signal.controller.ts`
- `src/services/signalService.ts`

Status: compatibility wrapper

Reason:
- still useful for simple command ingress
- canonical evaluation happens only after handoff into `handleSignal()` -> `src/oyi-core`

## Deprecated but retained

### Legacy intelligence core
- `src/intelligence-core/*`

Status: deprecated but retained

Reason:
- still owns event-bus history, predictions, organizational observability, workflow orchestration, and compatibility read models
- should not expand into a second operational runtime

### Unified intelligence service
- `src/services/oyiUnifiedIntelligenceService.ts`

Status: deprecated but retained

Reason:
- still backs compatibility awareness/chat payloads
- should progressively become a read-only adapter over canonical Oyi Core surfaces

## Needs migration

### `/ai/*` orchestration layer
- `src/routes/aiRoutes.ts`
- `src/ai/*`

Needs migration:
- tool routing is valid
- runtime reasoning should continue moving behind `/oyi/runtime/*`

### Source intelligence event publishing
- `publishSourceIntelligenceEvent()` callers across controllers/services

Needs migration:
- still useful for historical event bus and workflow continuity
- should not be treated as the primary operational runtime once Oyi Core output already exists

## Safe to remove later

No blind removals were performed in the freeze pass.

Likely future removals after parity verification:
- duplicate read-only awareness/chat shaping inside `oyiUnifiedIntelligenceService`
- thin alias-only signal helper surfaces that add no compatibility value

## Duplicate or overlapping paths resolved in this pass

### Device state handling
Before:
- MQTT bridge persisted state
- analytics recorded activity
- thin `device.state.reported` signal entered Oyi Core

After:
- `src/services/deviceOperationalSignalService.ts` is the canonical device telemetry-to-signal translator
- MQTT/Tuya bridge still persists state and analytics, but now emits rich normalized Oyi Core signals with:
  - origin detection
  - recent-command correlation
  - command provenance
  - changed keys
  - runtime trace metadata
  - provider references
  - telemetry evidence

### Device command handling
Before:
- command request signal
- provider execution
- activity / notifications
- no dedicated rich execution success/failure signal

After:
- success and failure also emit canonical rich operational signals
- execution path now feeds Oyi Core with the same provenance model used by provider/device state updates

## Device runtime freeze outcomes

Added:
- `src/services/deviceOperationalSignalService.ts`

Capabilities added:
- recent command correlation for physical vs app/facility/automation/provider origin
- rich metadata and evidence payloads
- control profile and capability enrichment
- upstream duplicate transition suppression window
- execution provenance alignment for device command success/failure

## Remaining risks before v1.0 freeze

1. `src/intelligence-core/*` still exists beside `src/oyi-core/*`.
   - acceptable for freeze only if treated as historical/event-bus compatibility, not a second runtime

2. Some controllers still call `publishSourceIntelligenceEvent()` directly.
   - acceptable for compatibility/history
   - should not become the only source of truth for operational meaning

3. Device state enrichment still depends on current device metadata quality.
   - deeper DP/function normalization may improve after the next Tuya adapter expansion pass

4. Notification side effects still exist beside runtime subscriptions.
   - current behavior is retained intentionally for compatibility
   - future consolidation can move more user-facing notification policy behind runtime subscribers

## Recommended freeze checklist

1. Verify `/oyi/runtime/*` remains the only operational kernel API for new clients.
2. Verify `/oyi/awareness` and `/oyi/chat` are documented as compatibility-only.
3. Verify Tuya/provider events create rich Oyi Core signals for:
   - power on/off
   - physical switch detections
   - online/offline
   - command executed/failed
   - telemetry updates
4. Verify duplicate device transitions do not spam activity or notifications.
5. Verify command-origin correlation works for consumer, facility, automation, and provider flows.
6. Verify Infrastructure Services remains canonical for resident-consumable services.
7. Verify no new feature work expands legacy intelligence paths.
