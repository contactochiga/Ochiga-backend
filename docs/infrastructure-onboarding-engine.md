# Oyi Infrastructure Onboarding Engine

## Purpose

The Infrastructure Onboarding Engine is a backend capability behind the existing Facility registries. It is not a deployment-management product and does not add a `Deployment` navigation surface.

The resident and operator workflow remains:

```text
Create Property
→ Create Building
→ Create Home
→ Assign Resident
→ Discover Existing Infrastructure
→ Authenticate
→ Import
→ Verify
→ Operate
```

The engine records the technical history, partner attribution, verification evidence, and registry promotion automatically.

## Canonical flow

```text
Provider or Oyi Edge
→ existing provider adapter
→ staged discovery candidate
→ compatibility classification
→ provider authentication reference
→ location mapping
→ non-destructive verification
→ existing canonical registry
→ Device Runtime V2 / camera runtime
→ Oyi Core signal, audit, activity, and realtime presentation
```

Discovery candidates are temporary. A candidate becomes operational only after it has a stable identity, passes scope and duplicate checks, satisfies provider access requirements, and is promoted into an existing Oyi registry.

## Ownership boundaries

- Provider adapters own discovery, provider reads, and provider commands.
- Oyi Edge owns access to private property networks and keeps local credentials local. The cloud stores only credential references.
- Infrastructure Onboarding owns staging, classification, verification, partner attribution, and promotion orchestration.
- Device and camera registries remain canonical after promotion.
- Device Runtime V2 remains the live device-state owner.
- Oyi Core consumes normalized onboarding signals and may recommend action, but it does not perform irreversible promotion automatically.
- Facility presents discovery, integration readiness, health, and history within existing registry pages.
- Consumer receives only assigned operational homes, devices, services, and permissions. It does not consume onboarding records.

## Provider adapter contract

The provider catalog maps onboarding readiness onto the existing `DeviceAdapter` contract:

- `discover(context)` finds provider objects.
- `getLiveState(externalId)` may be used for safe verification when supported.
- `executeCommand(...)` is never called by onboarding verification.
- Runtime V2 owns state caching and synchronization after promotion.

Provider manifests describe discovery mode, authentication methods, protocols, supported object classes, Edge requirements, and implementation readiness. Adding a provider extends the manifest and supplies an adapter; it does not change the onboarding workflow.

Initial active paths are Tuya / Smart Life, ONVIF through Oyi Edge, SSDP / UPnP through Oyi Edge, existing Edge discovery reports, and the established DVR/NVR import path. Matter, HomeKit, MQTT, ESPHome, Home Assistant, Shelly, Modbus, access control, smart meters, BACnet, and KNX remain explicit adapter/future states until their real adapters exist. The engine does not fabricate support.

## Classification

Candidates use one of these states:

- `compatible`: a supported adapter supplied a stable identity.
- `needs_adapter`: the object is understood but no active adapter is installed.
- `needs_edge`: the source is on a private network without a reachable Oyi Edge node.
- `needs_credentials`: provider access must be connected or refreshed.
- `unsupported`: the current runtime cannot onboard the source.
- `unknown`: evidence is insufficient for a safe decision.

Duplicate objects remain `compatible` because promotion updates the existing canonical record rather than inserting a second object.

## Authentication and secret handling

`infrastructure_provider_connections` stores provider identity, integration owner, authentication method, status, and an optional secret-store reference. Passwords, API secrets, access IDs, tokens, and authorization payloads are removed from onboarding metadata.

Local-network credentials belong on Oyi Edge or in the configured credential vault. Edge-reported candidates inherit the authenticated Edge trust boundary and expose only a `credential_ref` to the cloud.

## Verification

Verification records independent checks for:

- stable identity;
- duplicate handling;
- provider permission;
- communication evidence;
- state-read readiness when safely supported;
- property, home, room, and zone relationships;
- runtime initialization readiness.

Onboarding never toggles equipment merely to prove that a command works. Command commissioning remains a deliberate operator action through the existing permission and execution ledger path.

## Registry promotion

Promotion is idempotent:

- device candidates use the canonical provider identity upsert and preserve local names, room assignment, visibility, and other Oyi overrides;
- camera candidates update or insert the existing `facility_cameras` registry;
- duplicate targets are updated, not duplicated;
- device promotion schedules a high-priority Runtime V2 refresh;
- each result emits audit and Oyi Core signals.

Candidate metadata records the onboarding reference, partner, installer, and actor without replacing provider metadata.

## Hidden governance and memory

`infrastructure_onboarding_sessions` is the lightweight historical record. It contains a generated onboarding reference, property scope, optional building/home scope, partner and installer attribution, status, notes, and result summary. It is intentionally shown as discovery history rather than project tasks.

`infrastructure_compatibility_observations` retains sanitized compatibility outcomes so future discovery and adapter work can learn from real integrations without becoming a second registry.

## API

All routes are under `/facility/infrastructure/onboarding` and use existing Facility permissions.

- `GET /providers`
- `GET /history`
- `GET /partners`
- `POST /partners`
- `POST /sessions`
- `GET /sessions/:sessionId`
- `POST /sessions/:sessionId/providers/:providerKey/authenticate`
- `POST /sessions/:sessionId/discover`
- `POST /sessions/:sessionId/import`
- `POST /sessions/:sessionId/verify`
- `POST /sessions/:sessionId/promote`

The Estate Registry also exposes canonical building creation and listing through `POST /facility/buildings` and `GET /facility/estates/:estateId/buildings`. Homes may carry `building_id` while retaining the legacy `block` label for compatibility.

## Operational safeguards

- No discovery request directly mutates canonical registries.
- No candidate is promoted without verification.
- One candidate identity is unique per onboarding session.
- Provider connection identities are unique per property/provider/connection.
- Local scans require Oyi Edge by default; direct server scans require an explicit controlled override.
- Public responses sanitize credential material.
- One malformed provider result is isolated to that provider and does not abort other discovery sources.
- Row-level access to onboarding tables is service-role only with explicit server grants; API authorization is enforced through existing permissions and property scope.

## Release verification

Run:

```bash
npm run smoke:infrastructure-onboarding
npm run validate:release
```

The smoke verifies provider-independent manifests, staged discovery, authentication references, secret sanitization, verification gates, duplicate-safe registry promotion, Runtime V2 handoff, hidden history, and required schema constraints.
