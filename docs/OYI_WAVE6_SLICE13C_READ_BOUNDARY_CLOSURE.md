# Wave 6 Slice 13C — Generic device read-boundary closure

Local recovery and implementation record, 2026-09-24. No push or deployment.

## Recovery and scope

- Branch: `main`.
- Starting HEAD: `59668560cca24672c555e03d488587bc90128299`.
- Local `origin/main`: `909d5d0a35ab2de84c7cdc83d0f10be166e0b512`; starting relationship: ahead 5, behind 0. No remote fetch/production verification was necessary for this local-only task.
- No Slice 13C commit existed; index was empty.
- Retained recovered work in geoController, proximityService, commandRouter, package.json and the untracked Slice 13C smoke. Corrected, rather than discarded, its incomplete gates and fixtures.
- Post-HEAD is the local commit containing this record; obtain the exact SHA with `git log -1`. It is also reported in the final handoff.

### Excluded working-tree material

PRE_EXISTING_UNRELATED, unchanged and not staged:

- `scripts/pilot-import.mjs`, `src/routes/me.routes.ts`.
- `docs/OYI_DIGITAL_TWIN_ASSET_CONTRACT.md`.
- `pilot/luna-residences/`: buildings.csv, cameras.csv, devices.csv, estate.json, homes.csv, phase3c_infrastructure.sql, residents.csv, rooms.csv, staff.csv, zones.csv.
- Five `20260905010000` through `20260905050000` LOCAL_TEST migrations: home_zone_building_link, home_canonical_ref, room_canonical_ref, device_canonical_ref, device_parent_relationship.

UNKNOWN, excluded and untouched: `.aider.chat.history.md`, `.aider.input.history`, `.aider.tags.cache.v4/` database/WAL/shared-memory files, `opencode.json`.

All other files in this commit are SLICE_13C_INTENDED. No broad staging, reset, clean or stash was used.

## Authority contract and input consistency

`devices` remains provisioning/identity; `device_states` and deviceRuntimeStateService remain observed runtime; deviceObservationPolicy retains its existing class freshness policy; deviceCurrentStateAuthority remains the generic interpreter; provider health and the execution ledger retain their existing responsibilities.

Shared `deviceCurrentStateSelect` supplies existing fields needed for interpretation/enrichment: id, is_virtual, type, category, metadata, adapter, provider, vendor, parent_device_id, external_id, capabilities. Additional scope/display fields are caller-specific. Neither online nor registry status is authority evidence.

`deviceCurrentStateInput` consistently resolves control_profile and device_type aliases from their existing metadata fields. It does not select nonexistent database columns. Complete provisioning metadata now reaches migrated batched readers and the canonical exact-device resolver.

The existing interpretation body was extracted as synchronous `interpretDeviceCurrentState` inside the same authority, so readers already holding an authorized snapshot can use exactly the same rules without another query. Batched resolution delegates to it. No freshness thresholds, runtime scheduling TTLs, provider polling rules or availability classifier were redesigned.

The compact runtime API retains cache scheduling fields (`runtime_freshness`, ttl, stale, is_cache_expired). Generic `freshness`, availability and current_state are the per-class authority result. Legacy visual contracts represent expired as stale because their enum lacks expired; full current_state preserves expired. Last-observed state is not presented as current power when unavailable.

## Closed boundaries

| Boundary | Previous defect | Final behavior |
| --- | --- | --- |
| Geo evaluateGeoAlerts | Registry/raw snapshot interpretation; recovered gate considered freshness alone | Complete inputs, batched authority, fresh AND online plus observed ON required before physical-active alert/notification |
| Proximity countActiveDevices | Physical count could accept stale/mirror or fresh disconnected ON | Counts only fresh, canonically online, observed active devices; geofence math and thresholds unchanged |
| commandRouter home/list/status reads | Mirror status, unknown could become available; timeline inferred online | Canonical batch/list and exact read; current ON gated; timestamps sourced from observation |
| Spatial related devices and selected device | Direct device.online and registry fallback when hydration absent | Filter visibility first, batch authority; unknown on unavailable hydration; no provisioning fallback |
| Office export and portfolio | Registry status/online aggregates | Canonical exported status and online counts; configured totals unchanged; reporting requires fresh online/offline evidence |
| Facility estate/registry/infrastructure and Office device lists | Registry status could override canonical state or remain in other list endpoints | Shared batched projection, tri-state online, canonical status; registry_status/raw_status retained as provisioning diagnostics |
| Exact device panel/runtime dashboard | Cache TTL interpretation differed from class freshness authority | Same synchronous authority interpretation; generic availability/freshness consistent; raw observations remain evidence, not asserted live state |
| Conversation follow-up | Stored conversation list details reused as current ON | Rehydrates exact device through existing authorized canonical resolver |
| Conversation health/channel/spatial answers | Substring available could match unavailable; channels and spatial strings could assert old ON | Exact canonical online test; historical channels labelled last observed; spatial ON requires canonical fresh online observation |
| Online inventory answer | Online request could get offline-oriented answer/table | Filters canonical availability == online; fresh disconnected excluded |

Geo has no active-device notification side effect when every observation is untrustworthy. Proximity still records legitimate user location transitions and may send its existing generic transition message; it does not invent a device-active event/claim. This slice intentionally does not suppress real geofence transitions because device state is unavailable.

## Exhaustive read-boundary inventory

Searches included `.from("devices")`, `.from("device_states")` (both quote styles), online/is_online/status/last_seen_at, normalizeDeviceOnlineState, isDeviceDefinitelyOffline, runtimeStatusLabel, and online/active/available/offline-device/status vocabulary. Matches were traced to producers/callers, not classified solely by the matching word.

### CANONICAL_CURRENT_STATE

- `src/ai/commandRouter.ts`: summarizeHomeStateTool, summarize_devices and classification.risk read branch. Other command branches are exceptions below.
- `src/controllers/{geoController,deviceEstateController,deviceRegistryController,deviceRuntimeStateController,deviceStateController,facilityInfrastructureController,superAdminController}.ts`: generic read paths described above; mutation/provisioning branches remain separate.
- `src/services/{proximityService,spatialFacilityContextService,canonicalDevicePanelHydrationService,canonicalDeviceReadResolver,watchAdapterService}.ts`.
- `src/routes/officeExport.ts`: export and portfolio device state. Corporate consumers use this projection, not raw mirrors.
- `src/oyi-core/domains/devices/{deviceCurrentStateAuthority,deviceCurrentStateInput,deviceCurrentStatePresentation,deviceEvidence,deviceConversationAnswers}.ts`.
- `src/oyi-core/capabilities/ReadCapabilityModules.ts`, device availability answer/table presentation, canonical target hydration and conversation runtime, objectFallbackPresentation spatial device claims, and oyiUnifiedIntelligenceService device reads.
- roomHome contributors consume canonical evidence facts rather than reading device mirrors. Watch runtimeStatusLabel adapts the canonical vocabulary to its existing online/offline/unknown API.

### PROVISIONING / identity / existence

- deviceAssignController assignment/duplicate/unavailable-enrolment checks and assignment payload; deviceDiscoveryController discovery; deviceRegistryController create/reassign; deviceIrController IR enrolment identity.
- deviceGeoController installation coordinates and geoController location updates (not runtime availability).
- facility.controller device/room counts, facilityOverview configured device count (legacy field named active_devices counts registered inventory, not online observations); superAdminController inventory totals and disable mutation.
- infrastructure-onboarding providerRegistry/service discovery and binding; tuyaRegistrySyncService inventory ingestion.
- canonicalReferenceResolver, deviceIdentityService, deviceInventoryVisibility, conversationTargetResolver name/identity matching, deviceIntelligenceService parent/child relationships.
- routes/devices favorite mutation and identity/scope check; routes/automations device reference validation; server socket subscription authorization.
- DeviceActionCapabilityModules reads device_states for channel definitions/capability discovery, not a generic online/current-state presentation.

### COMMAND_EXECUTION — frozen

- deviceCommandController, DeviceCommandAuthority, executeDeviceCommandForActor, executionRegistry, execution ledger/store and verification/reconciliation.
- commandRouter deviceOffline/isDeviceDefinitelyOffline preflight and confirmation/dispatch branches.
- scenes action preflight, SpatialDeviceActionService, Watch command/scene validation and Facility Automation preconditions.
- FacilityAutomationService device_states precondition read remains an execution exception, not migrated cosmetically.

### SPECIALIZED_DOMAIN / authority internals

- smartAccessController/smartAccessCapabilityService retain stronger lock/access evidence and provenance.
- deviceRuntimeStateService owns persisted snapshots, enrichment, cache refresh scheduling and provider observations. device/bridge is ingestion; TuyaAdapter is provider discovery/observation. These are not alternate generic presentation authorities.
- Camera/Edge health and discovery are a distinct domain for the next audit, untouched.
- Message user presence, push-registration timestamps and language/intelligence memory timestamps are not device physical state.

### HISTORY / DIAGNOSTIC / DEAD

- deviceRuntimeService.buildDeviceTimeline, deviceAnalyticsService, deviceOperationalSignalService, infrastructureEventIntelligenceService, activity routes and trigger vocabulary concern recorded transitions/history. Timeline no longer determines current online state in the migrated list.
- normalizeDeviceOnlineState remains only for history, physical-command gates and diagnostic logging (commandRouter/deviceCommandController/Watch). It is NOT a generic read classifier anymore and was not deleted because those intentional consumers remain.
- tuyaAuthorizationDiagnosticsService and `/oyi/runtime/internal/device-runtime-audit` are diagnostics.
- `src/workers/intentWorker.ts.bak` is dead backup code, not a compiled/live read path.

No unjustified generic current-state read/presentation GAP remains in this inventory. This claim excludes the explicitly frozen/specialized domains, not undisclosed generic endpoints.

## Proof and test harness

Slice 13C fixtures honor selected columns (including joined aliases), so SELECT id cannot silently return is_virtual or other omitted metadata. Same switch, 20-minute virtual IR, battery lock, fresh provider-disconnected and unknown-class observations are compared across evidence, Watch, Facility, geo, proximity, commandRouter, Spatial, Office export/portfolio, registry/infrastructure lists, exact authorized hydration, panel and dashboard. Comparisons cover availability, freshness, observedAt, source and reason.

Adversarial ON observations include disconnected, offline, unknown, stale/expired and missing observation. Geo does not alert; proximity does not claim still-on; read status never maps unknown to available. Exact conversation evidence and online-list presentation use the same authority. Spatial fallback regression includes missing authority, fresh disconnected and stale last-known ON.

Cold 10/50/100-device runs for proximity, commandRouter listing, Spatial related lists and Office portfolio each issue one batched device_states query, no per-device authority queries, and zero provider calls.

The 13B/13C exit leak was import-time BullMQ/Redis construction through read-only dependency graphs. Test-only module isolation rejects accidental queue/physical dispatch and prevents those sockets. Runtime modules were not modified to force exit. Both scripts now finish assertions and exit naturally with code 0 under a 45-second bound. Existing Spatial fixtures were updated to mock hydrateMany/get (the new read dependency), and canonical-truth fixtures now supply explicit canonical device evidence instead of treating the string state=on as sufficient proof.

## Validation

Typecheck and production TypeScript build pass. Test processes were bounded; successful assertion output alone was not counted as successful exit.

| Suite | Result |
| --- | --- |
| Slice 10 / 10B / 11 / 12 | 33 / 30 / 42 / 35 assertions passed; exit 0 |
| Slice 13 / 13B / 13C | 31 / 34 / 149 assertions passed; exit 0 |
| Privacy Slice 1 / 1B | 24 / 53 assertions passed; exit 0 |
| Device runtime adapter / runtime V2 / payload budget / fast state read | Pass, exit 0 |
| Evidence presentation / Oyi conversation / Consumer context | Pass, exit 0 |
| Facility Spatial / Watch / security adversarial | Pass, exit 0 |
| Canonical signal ingress / awareness V3 | Pass, exit 0 |
| Shared Automation PR2 Facility / Wave 5 Slice 1 physical authority | Pass, exit 0 |
| Operational object context / canonical truth | Pass, exit 0 |
| Wave 5 Slice 3 verification / Slice 4 reconciliation | NOT EXECUTED: exit 1 at explicit missing OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY guard |

The two environment failures occur before application imports/DB fixtures; inspected source requires the local service-role key and pins local Supabase. No fake key was substituted for that required variable, and no application change was made to green these tests. They remain unexecuted integration coverage, not passing tests.

Some pre-existing suites emit Redis connection-refused or dummy-JWT diagnostics with fixture configuration while completing successfully; no real hardware acceptance is claimed. New read smokes isolate external dependencies. Punycode deprecation warning is non-blocking.

Physical-authority files and canonical awareness implementation have no diff. Conversation presentation changes are read-boundary changes, not awareness generation or execution changes.

## Disposition

- Recovered defects A–E closed; extra live generic read bypasses found during the search also closed.
- No migrations; LOCAL_TEST migration noise excluded.
- Zero unjustified generic current-state read/presentation bypasses remain in the audited backend scope.
- Device current-state read authority convergence is complete in that scope and may be frozen. Freeze does not erase the two unexecuted local-DB regression checks or convert specialized/execution exceptions into generic authority guarantees.
- Wave 6 may proceed to the separate cross-repository Camera/Edge Health Authority audit. No Camera/Edge implementation, incident CAS, meters or Wave 7 work was started.
- One local-only commit; no push, deployment or production mutations.

## Intended file manifest

```text
package.json
scripts/canonical-truth-smoke.mjs
scripts/facility-spatial-context-smoke.mjs
scripts/helpers/device-read-smoke-isolation.mjs
scripts/wave6-slice13b-device-current-state-consumer-convergence-smoke.mjs
scripts/wave6-slice13c-residual-device-bypass-closure-smoke.mjs
src/ai/commandRouter.ts
src/controllers/deviceEstateController.ts
src/controllers/deviceRegistryController.ts
src/controllers/deviceRuntimeStateController.ts
src/controllers/deviceStateController.ts
src/controllers/facilityInfrastructureController.ts
src/controllers/geoController.ts
src/controllers/superAdminController.ts
src/oyi-core/capabilities/ReadCapabilityModules.ts
src/oyi-core/domains/devices/deviceConversationAnswers.ts
src/oyi-core/domains/devices/deviceCurrentStateAuthority.ts
src/oyi-core/domains/devices/deviceCurrentStateInput.ts
src/oyi-core/domains/devices/deviceCurrentStatePresentation.ts
src/oyi-core/domains/devices/deviceEvidence.ts
src/oyi-core/presentation/conversationAnswerPresentation.ts
src/oyi-core/presentation/objectFallbackPresentation.ts
src/oyi-core/runtime/canonicalConversationRuntime.ts
src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts
src/routes/officeExport.ts
src/services/canonicalDeviceReadResolver.ts
src/services/oyiUnifiedIntelligenceService.ts
src/services/proximityService.ts
src/services/spatialFacilityContextService.ts
docs/OYI_WAVE6_SLICE13C_READ_BOUNDARY_CLOSURE.md
```
