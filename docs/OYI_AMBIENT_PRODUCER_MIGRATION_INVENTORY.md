# Ambient-Only Producer Migration Inventory (Canonical Signal Path Hardening Slice)

**Status:** Classification and documentation only. No producer listed here was migrated in this slice. `legacyAmbientCanonicalIngress()` (`src/realtime/emitSignal.ts`) remains every one of these producers' only route into Core, unchanged, and must not be removed or weakened until a producer is explicitly migrated in a future, narrowly-scoped wave.

Classification taxonomy used below: **CANONICAL INTELLIGENCE SIGNAL** (should eventually get an explicit `submitCanonicalSignal()` call), **REALTIME ONLY** (broadcast is the whole point; Core has nothing useful to reason about), **AUDIT ONLY** (compliance/traceability record, not intelligence), **DOMAIN TELEMETRY — NORMALIZE BEFORE CORE** (real signal, but only after debouncing/state-change detection, not every raw event), **NEEDS ARCHITECTURAL DECISION** (genuinely unclear, or explicitly out of scope for another reason).

## audit.recorded (`core/foundation/audit.ts::emitAuditEvent`)

**Classification: AUDIT ONLY.**

Fires on nearly every audited action across the entire codebase (every `emitAuditEvent()` call site, dozens of them, excluding resident-device-private audits) — this is a compliance/traceability log, not a single domain event. Treating every audit entry as a canonical intelligence signal would flood Core with noise unrelated to any one domain's real state ("do not force every broadcast into Core merely for architectural symmetry" — this is the clearest case of that). The domain events audit.recorded WRAPS are frequently already, or should become, canonical signals in their own right at their OWN call sites (e.g. `security.incident.created` already migrated in the Signal Transport Convergence slice) — that is where the real signal belongs, not in the generic audit sink. **Recommendation: never migrate `audit.recorded` itself.**

## Infrastructure onboarding (`infrastructure-onboarding/service.ts`)

**Classification: CANONICAL INTELLIGENCE SIGNAL** (narrowly scoped).

Fires on real onboarding lifecycle transitions (candidate discovered, verified, promoted to a canonical device/infrastructure record) — request-actor-attributed, session-scoped, with genuine before/after state. This is exactly the shape of event Core's awareness should be able to reason about ("a new infrastructure candidate failed verification," "an onboarding session completed"). **Eventual canonical shape:** `type: <input.eventType>` (already meaningful, e.g. `infrastructure.candidate.verified`), `domain: "infrastructure"`, `source: "infrastructure_onboarding_registry"`, `origin: "facility_app"`, `entity: {id: candidateId, type: "infrastructure_candidate", status: input.status}`, `estateId`/`unitId` (home) from the session, `actor` from `input.actor`, `correlationId: "infrastructure_onboarding:<candidateId>"`. **Scope narrowly**: only real lifecycle-transition event types, not every intermediate status write.

## Device registry (`controllers/deviceRegistryController.ts`, `device.registry.updated`)

**Classification: CANONICAL INTELLIGENCE SIGNAL.**

Fires specifically on device home/room binding and ownership-class reassignment — a real identity/scope change (which home a device belongs to, who owns it), not routine telemetry. This is directly relevant to anything Core reasons about that's scoped by home/room (automation, capability authority, awareness). **Eventual canonical shape:** `type: "device.registry.updated"`, `domain: "registry"`, `source: "device_registry"`, `origin: "facility_app"`, `entity: {id: deviceId, type: "device", status: bind_state}`, `estateId`/`unitId` (home/room) from the updated record, `actor` from the request, `correlationId: "device_registry:<deviceId>"`.

## Edge discovery (`routes/edgeDiscovery.ts::emitEdgeSignal`)

**Classification: NEEDS ARCHITECTURAL DECISION — deferred to Camera convergence, except edge.heartbeat.**

`emitEdgeSignal()` is called for five event types: `edge.heartbeat`, `camera.status.updated`, `camera.event`, `camera.media.created`, `camera.discovery.updated`. Four of these five are camera-domain events, explicitly out of scope for this slice ("do not migrate cameras" — this programme has a dedicated Camera convergence wave already planned in the Phase 1 audit). Classifying and migrating them here would be exactly the "broad domain migration disguised as transport cleanup" this slice was told not to do. **`edge.heartbeat` specifically** — see below, same classification as `platformGapService`'s own `edge.heartbeat`.

## Tuya registry events (`services/tuyaRegistrySyncService.ts`)

Three event types fired from one sync pass: `device.registry.updated`, `device.discovered` (only when `kind === "added"`), `device.status.updated`.

- **`device.registry.updated` / `device.discovered`: CANONICAL INTELLIGENCE SIGNAL.** Structural device-inventory changes (a device appeared, or its registry record changed) — same class of event as `deviceRegistryController.ts`'s `device.registry.updated` above; these two producers should converge on the same eventual canonical shape rather than each inventing their own.
- **`device.status.updated`: DOMAIN TELEMETRY — NORMALIZE BEFORE CORE.** Fires on every Tuya sync pass regardless of whether the device's operational status actually changed meaningfully. Raw, frequent, low per-event intelligence value. `deviceOperationalSignalService.ts`'s `emitOperationalDeviceSignal()` already correctly routes REAL device state transitions through `handleSignal()` canonically (confirmed in the Phase 1 audit and re-confirmed as a representative producer in this slice's `handleSignal()` test). This Tuya-sync-driven `device.status.updated` broadcast may be substantially redundant with that already-canonical path — **before any migration, a future wave should first determine whether this event is real signal or duplicate noise of an already-canonical path**, not just wire it into Core as-is.

## Remaining `platformGapService.ts` events

### utility.telemetry.updated

**Classification: DOMAIN TELEMETRY — NORMALIZE BEFORE CORE.**

A manually-recorded (operator/actor-attributed, request-driven) utility telemetry reading — `utility_type`, `state`, optional `severity`. Real signal content exists here (severity is already captured), but `infrastructureEventIntelligenceService.ts`/`infrastructureServiceSignals.ts` already correctly canonicalize utility telemetry through `handleSignal()` for the automated/sensor path (confirmed non-bypass in the Phase 1 audit). **Before migrating this specific producer, a future wave must first determine whether this is a genuinely separate manual-entry telemetry source that deserves its own canonical signal, or should simply feed the SAME already-canonical utility telemetry path** — wiring it in blind risks creating a third, parallel utility-telemetry route into Core.

### edge.heartbeat

**Classification: DOMAIN TELEMETRY — NORMALIZE BEFORE CORE.**

A periodic edge-node liveness/queue-depth/runtime-version record. A single heartbeat, by itself, is not a meaningful intelligence event — Core reasoning about "an edge node sent a heartbeat" has no value; Core reasoning about "an edge node went offline" or "an edge node's queue depth has been abnormally high for N minutes" would. **Eventual canonical signal, if built, should be derived** (a debounced connectivity-state-change detector sitting in front of this raw event stream), not a 1:1 mapping of every heartbeat to a canonical signal. Migrating this producer as-is would be exactly the low-value noise this classification taxonomy exists to prevent.

### incident.updated

**Classification: CANONICAL INTELLIGENCE SIGNAL — best next candidate.**

Status transitions (`acknowledged`/`escalated`/`resolved`/`verified`/`closed`) on `facility_incidents` rows. Its sibling event, `incident.created`, already has a real, tested, working canonical mapping (`facility.incident.created`, migrated in the Signal Transport Convergence slice). `incident.updated` is the exact same entity type undergoing a real state transition — of everything in this inventory, this is the most directly ready to migrate next, since the entity shape, estate/home scope, and severity mapping are already proven. **Eventual canonical shape:** `type: "facility.incident.updated"`, same `domain`/`source`/`origin` as the creation signal, `entity.status` reflecting the new incident status, `correlationId: "facility_incident:<id>"` (same correlation id as the creation signal, so Core can associate the two).

### facility.handover.updated

**Classification: NEEDS ARCHITECTURAL DECISION.**

Shift handover notes: a free-text summary plus `open_items`/`handover_items` arrays. There's a real argument this should be canonical (continuity of open issues across shifts is exactly the kind of thing Facility awareness should track), and a real argument it's fundamentally a narrative communication tool between human operators, not structured domain state. The `open_items`/`handover_items` arrays may substantially duplicate incidents/tasks already tracked (and now partially canonical) elsewhere, which would make a SEPARATE canonical signal for the handover record itself redundant rather than additive. **Flagged for an explicit decision in a future wave, not guessed at here.**

### camera.status.updated

**Classification: NEEDS ARCHITECTURAL DECISION — deferred to Camera convergence.**

Camera infrastructure (zone/placement/health_state) updates. Explicitly out of scope: camera convergence (CV/detection domain processing vs. severity/escalation/interpretation convergence through Core) is its own dedicated wave in the Phase 1 audit, with its own careful classification work already done there (`docs` from that audit — not duplicated here). Do not migrate this producer outside that dedicated wave.

## Summary table

| Producer | Event(s) | Classification |
|---|---|---|
| `core/foundation/audit.ts` | `audit.recorded` | AUDIT ONLY |
| `infrastructure-onboarding/service.ts` | onboarding lifecycle events | CANONICAL INTELLIGENCE SIGNAL |
| `controllers/deviceRegistryController.ts` | `device.registry.updated` | CANONICAL INTELLIGENCE SIGNAL |
| `routes/edgeDiscovery.ts` | `edge.heartbeat` | DOMAIN TELEMETRY — NORMALIZE BEFORE CORE |
| `routes/edgeDiscovery.ts` | `camera.*` (4 event types) | NEEDS ARCHITECTURAL DECISION (Camera convergence wave) |
| `services/tuyaRegistrySyncService.ts` | `device.registry.updated`, `device.discovered` | CANONICAL INTELLIGENCE SIGNAL |
| `services/tuyaRegistrySyncService.ts` | `device.status.updated` | DOMAIN TELEMETRY — NORMALIZE BEFORE CORE (possible duplicate of an already-canonical path) |
| `platformGapService.ts` | `utility.telemetry.updated` | DOMAIN TELEMETRY — NORMALIZE BEFORE CORE (possible duplicate of an already-canonical path) |
| `platformGapService.ts` | `edge.heartbeat` | DOMAIN TELEMETRY — NORMALIZE BEFORE CORE |
| `platformGapService.ts` | `incident.updated` | CANONICAL INTELLIGENCE SIGNAL — best next candidate |
| `platformGapService.ts` | `facility.handover.updated` | NEEDS ARCHITECTURAL DECISION |
| `platformGapService.ts` | `camera.status.updated` | NEEDS ARCHITECTURAL DECISION (Camera convergence wave) |

Not every ambient-only producer is a meaningful intelligence signal. This inventory intentionally leaves the DOMAIN TELEMETRY and NEEDS ARCHITECTURAL DECISION rows unmigrated — forcing them into Core now would be symmetry for its own sake, not real convergence.
