# Wave 6 Slice 0 — Exhaustive Current-State Architecture Audit

**Status:** Read-only audit deliverable. No application code, tests, or migrations were modified to produce this document.
**Governing question:** *How does Oyi know what is happening right now?*
**Repo audited:** `/Users/ochigaidoko/Documents/Ochiga-backend`
**Baseline commit:** `b0c9f4f29f3c20ecfcdb37b891a7e7010635e994` ("Wave 5E: converge legacy automation device authority") — the frozen Wave 4B/5 physical-action-convergence checkpoint. This audit does not reopen or evaluate that convergence; `DeviceCommandAuthority`, `executeDeviceCommandForActor`, and the capability system are treated as settled.
**Method:** Parallel, independent, read-only investigation across ~12 work packages, each verifying claims against actual source (not filenames, comments, or design docs) and citing file:line evidence. Findings below preserve each subsystem's own terminology alongside a shared analytical vocabulary: **RAW SIGNAL → OBSERVATION → CANONICAL EVENT → CURRENT STATE → DERIVED STATE → AWARENESS**, plus **PRIORITY**, **INCIDENT**, **HISTORY**.

**A note on section numbering.** The governing task specified 30 numbered sections. A handful of mid-range section boundaries (roughly 19–23) could not be reconstructed with certainty after conversation compaction truncated the original task text. Section numbers below are given wherever they were directly confirmed by an agent's own report title; elsewhere, sections are identified by topic name and placed in the task's original prose order. No topic area from the original 30-section brief is omitted.

---

## Section 0 — Scope & the central finding

Before the detail: **there is no single answer to "how does Oyi know what's happening right now."** There are two coexisting, only-partially-reconciled architectures answering it independently:

- A **canonical pipeline** (`src/oyi-core/*`) — `NormalizedSignal` → `operational_signals`/`operational_incidents`/`operational_awareness`/`operational_insights` (`canonicalIntelligenceStore.ts`), read by `ConversationOrchestrator.ts`, which is the single entry point for facility, consumer, office-internal, and public-corporate chat surfaces alike.
- A **legacy pipeline** (`src/intelligence-core/*` + `src/services/oyiUnifiedIntelligenceService.ts`) — `ochiga_intelligence_events` bus, read by `getOyiUnifiedAwareness`, which **still serves the live `GET /oyi/awareness` route** and remains the documented fallback for `/ai/chat`, `/office/*`, and `/communications/*`.

Both self-describe as canonical in their own source comments. Neither is fully deprecated. The legacy pipeline is not a dead branch kept for compatibility optics — it is the one actually answering ambient-awareness requests today, while the canonical pipeline's richest tables (`operational_awareness`, `operational_recommendations`, `operational_insights`, `operational_plans`) are, as far as this audit could determine, **write-only**: populated by `canonicalIntelligenceStore.ts` but never read back anywhere in `src/`.

Three concrete, evidence-backed problems fall directly out of this split and recur across sections below:
1. **A privacy leak**: facility/security staff with ordinary `cameras.view` permission can see event text from a resident's home-privacy-scoped camera via the legacy ambient-awareness feed, despite being correctly blocked from that camera directly (§26).
2. **A privacy gap**: any resident can request `surface: "facility"` context for a home they don't live in and receive that home's meter numbers, gate code, and unit identity, because the surface-resolution layer checks estate membership, not role (§15, §26).
3. **Duplicate, disagreeing "current state"** for the same entities — device provisioning vs. runtime state, two independent camera-health fields, and no fewer than four incompatible time-freshness models (§16–18).

---

## Section 1–3 — Ingestion sources, event architecture, and the canonical-event claim

**Headline: at least four parallel "what happened" pipelines exist, not one.**

1. **`ochiga_intelligence_events`** (`src/intelligence-core/eventBus.ts`) — the legacy bus. Its own source comment calls `publishIntelligenceEvent` "the one true canonical event choke point." Fed by 11 direct callers plus a 17-site wrapper, `publishSourceIntelligenceEvent` (`src/intelligence-core/sourceEventPublisher.ts:52-98`), covering visitor, maintenance, community, wallet, services, weather, device-analytics, notification, and workflow events. This is the **only** pipeline `matchEventDrivenAutomationRules` (Facility Automation's event-rule matcher) listens to — confirmed as its single caller (`eventBus.ts:146`).
2. **`operational_signals`/canonical `NormalizedSignal` pipeline** (`src/oyi-core/*`, `canonicalIntelligenceStore.ts`) — the newer system, also self-described as canonical in its own comments. **Never** calls `publishIntelligenceEvent`/`publishSourceIntelligenceEvent` — confirmed by grep. It therefore **can never trigger a Facility Automation rule**, and the legacy bus can never populate `operational_signals`. Two structurally disconnected event universes.
3. **`src/core/control-plane`'s `handleSignal()`** — a third signal concept, explicitly documented in-repo (`src/oyi-core/ingress/canonicalSignalIngress.ts:1-44`) as one of "three disconnected signal concepts operating side by side," discovered by a prior internal "Phase 1 audit." Contains genuinely dead branches for `visitor.arrived`/`room.motion` handling that are still wired into the live decision path but never actually fire (no producer reaches them).
4. **`deviceRuntimeStateService`'s `emitSignal()`** — a fourth, "realtime/broadcast only, never reaches Core" per the same in-repo comment. `canonicalSignalIngress.ts` then adds a **fifth** entry point, `submitCanonicalSignal → oyiCoreRuntime.receiveSignal`, explicitly "alongside" the other four rather than merging them.

**Read-time compensation layers exist specifically because no single bus has full coverage**: `src/intelligence-core/normalizers.ts` and `src/routes/activity.ts` re-derive "what happened" at query time by scanning raw domain tables (`home_timeline`, `device_events`, `camera_events`, `maintenance_requests`, `visitors`, `visitor_access`, `notifications`, `audit_events`) rather than trusting any canonical event log to be complete — an implicit admission, in the code's own shape, that no bus is authoritative.

**Producer-level gap concretely traced for automations (§23)**: MQTT-push device transitions reach `ochiga_intelligence_events` as `device.online`/`device.offline` (via `recordDeviceEvent`); poll-refresh-detected transitions of the identical kind go through `emitOperationalDeviceSignal → handleSignal` (control-plane) instead, and **never** reach the legacy bus. A device that silently goes offline and is only caught by the poll scheduler can never fire a configured `device.offline` automation rule — only MQTT-observed transitions can.

**Edge ingestion auth weakness**: a legacy shared-token Edge auth mode allows a caller to self-assert its own agent identity rather than being independently verified — flagged as a security-relevant gap in the ingestion layer, not yet a proven exploit.

**Dead/inert producers found**: Tuya's `startEventStream()` is confirmed an inert placeholder (declared, never wired to a live stream). `access_points` (a table that looks like it should hold live gate/door state) has zero readers or writers anywhere in `src/` — real door/lock state instead rides the generic `device_states` model.

---

## Section 4–5 — Device state, and command-vs-physical-state

Devices have **two independent "current state" surfaces**, not one:

- **`devices`** — provisioning-flavored (`bind_state`, `sync_state`, `commissioning_status`), with runtime-ish fields (`online`, `last_seen_at`, `last_event_at`) bolted on later. Written by `deviceAssignController.ts` and `edgeDiscovery.ts`.
- **`device_states`** — the true runtime CURRENT STATE table: `device_id` primary key, opaque `status jsonb`, `last_seen`, trigger-maintained `updated_at`. Sole writer: `deviceRuntimeStateService.ts:276` (`upsert`).

A likely live bug: `smartAccessCapabilityService.ts:674` writes `devices.update({metadata, updated_at})`, but **no migration ever adds an `updated_at` column to `devices`** — worth independent runtime verification, not provable from static read alone.

**Command vs. physical confirmation is modeled correctly where it matters**: the frozen Wave 4B/5 convergence (`DeviceCommandAuthority` → `executeDeviceCommandForActor`) distinguishes a provider's command-acknowledgment from actual physical state confirmation, and `domainReasoningPolicies.ts` explicitly separates "provider ack" from "physical confirmation" as different evidence tiers (confirmed functionally by the Wave 5E smoke suite's PASS on exactly this distinction).

**Direct readers bypass the fresher in-memory runtime cache**: canonical conversation evidence (`deviceEvidence.ts:241`) and seven other call sites read only the persisted `device_states` DB row, not `deviceRuntimeStateService`'s fresher in-memory snapshot — so a device's conversational "current state" can lag its live dashboard state by up to the cache's write-debounce interval. Documented as a legitimate cache-ahead-of-DB pattern, not a duplicate-authority problem, but a real latency gap.

**Device online/offline is reachable as up to three different, potentially disagreeing answers** depending which surface asks (already established in earlier work packages, reconfirmed structurally here): the `devices.online` flag, `device_states.status`, and `ProviderHealthRegistry`'s per-adapter health — each written by a different code path with no reconciliation between them.

---

## Section 6 — Camera awareness

**Three parallel camera-health stores, two of which independently claim "current health" for the same camera with no reconciliation:**

| Table | Field | Writer |
|---|---|---|
| `facility_cameras` | `health_status`/`status`/`stream_status` | `camerasController.ts`, `edgeDiscovery.ts`, `cameraMedia.service.ts` |
| `camera_infrastructure` | `health_state` | `platformGapService.ts` only |
| `camera_dvrs` | `status` | DVR registry (legacy migration tree only) |

`camera_infrastructure`'s writer (`upsertCameraInfrastructure`, `platformGapService.ts:504-556`) does apply a real transition-classification step before writing — but only against **its own history**, never against `facility_cameras.health_status`. **The two "is this camera healthy right now" fields can silently disagree**, and no code path reads both to reconcile them.

**A concrete privacy leak traced end-to-end (see also §26)**: the ambient awareness/timeline feed (`intelligence-core/normalizers.ts:226-232`, `loadNormalizedTimelineEvents`) queries `camera_events` scoped only by `estate_id` — it never joins back to `facility_cameras.privacy_scope`/`home_id` or calls `canAccessCamera`. The only gate applied is a coarse role-level boolean (`can_view_camera`), broadly granted to `facility_manager`/`security_operator` via ordinary `cameras.view`. Net effect: a facility/security actor can see human-readable camera-event summaries — including from a resident's `privacy_scope: "home"` camera — through `GET /oyi/awareness`, despite the same actor being correctly denied direct access to that exact camera by `cameraAccess.policy.ts`'s fine-grained, per-camera gate (which has no facility-role bypass for `scope: "home"`). Residents themselves are unaffected (`can_view_camera` is hardcoded `false` for them).

---

## Section 7 — Security/access/visitor state

- **`visitor_access`** is the actively-used per-visit lifecycle table (`pending → approved/denied → entered/exited`) — but has **no `CREATE TABLE` in any tracked migration**, meaning it predates the tracked migration history or was created out-of-band.
- **`visitors`** is a genuine orphaned duplicate, superseded by `visitor_access`, with an explicit hardening step (`revoke ... from anon,authenticated on visitors`) consistent with deliberate deprecation.
- **Visitor/access data never reaches the canonical Core reasoning engine.** Only three producers feed the canonical side at all: camera, office-material-events, and platformGap. Visitor approve/deny events stay in the legacy bus only.
- **Zero failed/denied-access-attempt tracking exists anywhere in the codebase** — self-disclosed as absent in the code's own comments, not merely unimplemented by omission.
- **Race condition, no conflict resolution**: `visitorController.ts`'s `approveVisitor`/`denyVisitor` both do an unconditional `.update({status}).eq("id", id)` with no status precondition. Two guards racing to approve/deny the same `visitor_access` row produce silent last-write-wins with no detection.
- **`access_points`** (the table that should carry live gate/door state) has zero readers or writers in `src/` — confirmed dead. Real lock/door state instead flows through the generic `device_states` model.

---

## Section 8 — Occupancy/presence

Four distinct concepts exist and are **not interchangeable, but the code does not always keep them apart**:

1. **ACTUAL OBSERVED PRESENCE** — `resident_proximity_settings` (`last_state ∈ {near_home, leaving_home, away, approaching_estate}`), the one genuine current-state table for this domain, single-writer (`proximityService.ts`), unique per `(user_id, home_id)`. Has **no staleness/ordering guard** — an out-of-order or delayed ping is not rejected the way `deviceRuntimeStateService` rejects stale device updates.
2. **UI NAVIGATION/CURRENT TWIN VIEW** — separate from presence entirely; conflated nowhere structurally, but worth naming since Oyi's conversational target-binding chain (`TurnAuthorityResolver.ts`) has its own, unrelated "page context" concept (see §11) that shares vocabulary with presence-adjacent ideas without being the same thing.
3. **ASSIGNED HOME/ROOM** — ownership/tenancy, not presence.
4. **INFERRED OCCUPANCY** — `isBuildingOccupied()` conflates tenancy/assignment with live presence (established in an earlier work package): it answers "is someone assigned to this home" as a proxy for "is someone home right now," which is not the same claim.

**`OperationalContext.occupancy`** is a fully-typed field on the canonical context object that is **never populated anywhere** — a dead field, not a bug exactly, but a gap between the type system's ambition and the actual data pipeline. No dedicated "who is home right now" aggregate table exists; occupancy is inferred ad hoc from proximity + camera detections, never persisted as its own domain state.

---

## Section 9 — Infrastructure/utilities state

**Fragmented across five independent, barely-connected subsystems** for the same underlying question ("what's happening with power/water/gas/energy right now"):

1. **Generic device registry** (`devices`/`device_states`/`device_events`) — utility-agnostic, no unit/value semantics; a solar inverter and a light switch look identical at this layer.
2. **`utility_events`** — genuinely dead. Zero read call sites anywhere in `src/`, confirmed by the codebase's own comment (`ReadCapabilityModules.ts:469-474`): "no consumption table is ever queried in this codebase (utility_events has zero call sites)." Only ever dumped raw in an export/reporting endpoint.
3. **`utility_telemetry`** — CHECK-constrained to `power/water/network/environmental` (**no `gas`**), scoped to `home_id`/`room_id`/`edge_node_id` with **no `device_id` column** (a specific meter/pump/inverter can't be identified, only a home/room). Its `state` field looks like a freshness indicator but is never computed server-side — `recordUtilityTelemetry` just stores whatever the caller passes; no staleness sweeper exists. Real live consumption exists in exactly one place: `automationConditionEvaluator.ts`'s `indoor_sensor_threshold` condition evaluation.
4. **Device-connectivity-clustering heuristics** (`infrastructureEventIntelligenceService.ts`) — the only subsystem genuinely wired into live awareness/notifications for power/generator/solar (`power_outage`, `generator_started`, `inverter_takeover`, `solar_takeover`, etc.), and it works **entirely independently** of tables 2 and 3, inferring meaning purely from clustered device online/offline timing and device-name pattern-matching — never from an actual electrical/utility sensor reading.
5. **Billing/entitlement layer** (`home_service_assignments`, `estate_service_configs`, `service_transactions`) — a fifth, separate representation for "is this utility active/paid," disjoint from all telemetry above. `UTILITY_SERVICE_KEYS` includes `gas_service`, `generator_recovery`, `solar_battery_service` — billing concepts with **no telemetry-type counterpart** in `utility_telemetry`'s CHECK constraint. `home_service_accounts.balance`/`.outstanding` are declared columns **never written by any code path**.

**No table reconciles these five into one canonical "current utility state" view.** `DOMAIN_REASONING_POLICIES` declares a reasoning policy referencing `utility_telemetry` as evidence, but has **zero importers anywhere in `src/`** — dead declarative code.

---

## Section 10 — Maintenance/facility operations

- **Schema/code mismatch, likely a live bug**: `maintenance_requests` was never given `resident_id`/`membership_id`/`category`/`priority` columns in any migration (verified against every migration touching the table) — yet `maintenance.controller.ts`'s `createMaintenance` inserts exactly those fields, and `listMyMaintenance` filters `.eq("resident_id", userId)`. The write path is silently masked by `insertWithSchemaFallback`, which strips unrecognized fields before retrying — meaning a consumer-submitted request is persisted with **no requester identity at all** on the row (the real `user_id` column is never set). The read path (`listMyMaintenance`) has no such fallback, so filtering on a nonexistent column would 500 on every call — a strong, source-grounded finding, not independently confirmed against a live DB.
- **No asset-level identity**: `maintenance_requests` has only `home_id`/`room_id` — no `device_id`/`asset_id` column exists, ever, in any migration. A request can be scoped to "this room," never to "this specific pump."
- **The codebase demonstrably knows the "N repeated signals on one entity ⇒ concerning" pattern and simply never applied it to maintenance.** `deviceOfflineClusterDetector` groups `device_events` by `device_id` and raises severity at ≥3 occurrences. The maintenance equivalent, `maintenanceAgingDetector`, only checks a single ticket's own age (≥3 days) — never frequency, never grouping, because no asset key exists to group by. **Concretely: if a pump had three unresolved maintenance tickets, Oyi's awareness layer cannot currently know that pump is operationally concerning** — blocked by both the missing schema (no asset FK) and the missing logic (no frequency detector was ever built for this domain).
- **A conversational path that looks like an answer is dead**: `maintenanceLinkedIssueSummary` reads `object.relationships.maintenance_requests` off a hydrated object — but nothing in the codebase ever populates that relationship array (confirmed by exhaustive grep), so this path always returns "no unresolved maintenance linked," regardless of actual database state.
- **Race condition, no conflict resolution**: `maintenance.controller.ts`'s `updateMaintenance` reads-then-writes with no status precondition — identical shape of bug to the visitor approve/deny race in §7.
- **Duplicate-request detection is real**: `detectDuplicateMaintenanceRequest` (72h window, same home, title/category match) is genuinely wired in and does change present behavior.

---

## Section 11 — Spatial/Digital Twin context

A real, deliberately-designed data contract exists (`canonical_ref`, `twin_entity_placements`, `twin_models`), but it is **operationally disconnected from Oyi's conversational awareness pipeline**, and one layer of it isn't live in production yet.

- **Two identity concepts, correctly kept distinct in the type system**: `CanonicalTarget.canonical_id` (transient, per-turn, rebuilt every conversation turn) vs. `canonical_ref` (a persisted, stable, human-readable string like `LUNA-L06-APT-A`, meant to address the same object across Building Ingestion, Facility spatial binding, and a future Twin Engine without depending on backend UUIDs).
- **`canonical_ref` columns are migration files only — not yet applied to any deployed database.** `canonicalReferenceResolver.ts` defensively treats Postgres's "column does not exist" error as an honest `not_found` rather than a 500, meaning resolution today silently and correctly returns nothing in production.
- **No live Digital Twin exists yet.** `docs/OYI_DIGITAL_TWIN_ASSET_CONTRACT.md` is an honest, verified-against-source design/data-contract document for a *future* visual twin (its own header: "Status: V1 frozen... Still local-only, not yet applied to production"). `facilitySpatialReadiness.ts` hardcodes `twin.operationally_connected: false` always — the code explicitly refuses to fabricate "connected" from a mere `updated_at` timestamp, since no heartbeat/session/freshness field exists on the twin tables. The consumer-facing `/spaces` twin API (`spacesTwin.ts`/`twinProviderService.ts`) is a hardcoded stub returning `configured: false`/`model_url: null` for every provider.
- **The spatial bridge never touches Oyi's chat target-resolution.** Oyi's actual conversational target-binding chain (`TurnAuthorityResolver.ts`'s `targetSource()`: `active_workflow → current_turn → current_scope → valid_reference → page_context → thread_memory → none`) has no branch anywhere that calls `resolveCanonicalRef` or treats a `canonical_ref` as one of its inputs — confirmed by exhaustive grep (only `SpatialDeviceActionService.ts`, `facility.controller.ts`, `platformGapService.ts`, and the resolver/service themselves reference `canonicalReferenceResolver`/`resolveCanonicalRef`). Spatial-mode actions explicitly set `suppress_awareness: true` on their synthetic turns, reinforcing that this is a deliberately separate, non-conversational execution path.
- **Naming collision, not the same mechanism**: `TurnAuthorityResolver`'s `page_context` TargetSource and `conversationContextLayers.ts`'s `page_launch` resolution are two independent concepts that happen to share vocabulary.
- **Data is genuinely single-sourced** (one set of `homes`/`rooms`/`devices`/`twin_models`/`twin_entity_placements` tables, correctly reused rather than duplicated by both the Facility spatial-context projection and platform-gap diagnostics), but there are two independent, differently-gated access surfaces (Facility `twin.view`/`twin.control` vs. Consumer `hasWatchScope`), and the write path (`registerModel`/`upsertPlacement`) accepts `assigned_entity_id`/`building_id` with **no FK validation** — a real data-integrity risk resting entirely on caller discipline.

---

## Section 12 — Edge awareness

Covered substantially under §1–3's ingestion findings. Key points specific to Edge:

- A legacy shared-token auth mode permits a caller to **self-assert its own agent identity** rather than being independently verified by the platform — the clearest security-relevant finding in the ingestion layer.
- Edge heartbeats (`edge_heartbeats` → `edge_nodes.heartbeat_status`/`last_seen_at`) follow the same real current-state + append-log pattern used elsewhere (§16), and are genuinely current-state, not just logged.
- Edge-originated device/camera events are subject to the same MQTT-push-vs-poll-refresh gap described in §1–3: only MQTT-push-observed transitions reach the legacy event bus that Facility Automation listens to.

---

## Section 13 — Facility awareness

Facility staff's "current state" is assembled from real, live endpoints, not a single unified store:
- `GET /facility/overview` — estate-wide counts: homes, active devices, open maintenance, visitors today, unread alerts, wallet/dues.
- `GET /facility/devices/operations`, `/facility/devices` — device state and control, gated `devices.read`/`devices.control`.
- Facility visitor/security routes — list, verify, trigger lockdown, export, gated `visitors.manage`.
- Facility maintenance routes — queue and timeline, gated `support.read`.
- The AI/awareness layer for facility staff routes through the **same** `getOyiUnifiedAwareness`/`buildAwareness` pipeline as consumer, parameterized by `surface: "facility"` — this is genuinely one policy engine branching on surface, not a separately-coded system (confirmed by tracing `CanonicalConversationRequest.surface` through `ConversationOrchestrator.run()`, called identically from facility/consumer chat, general AI routes, communications follow-ups, and Office CRM conversation endpoints).

---

## Section 14 — Consumer awareness

Residents' "current state" is single-home-scoped by construction: `buildFilters` defaults `home_id`/`estate_id` to the actor's own, and role-scoping (`applyRoleScopeToFilters`) hard-forces `home`-scope for the `resident` role regardless of what's requested — this layer of enforcement is sound. At the REST/CRUD layer (not the AI/awareness layer), consumer routes are genuinely separate files from their facility equivalents (`devices.ts`, `consumerMaintenanceRoutes.ts`, `visitors.ts`, `notifications.ts`), each per-request-scoped to the resident's own home — real separation exists at this layer even though the conversational layer above it is unified.

---

## Section 15 — Office/business context

Two distinct things share the name "Office":

1. **"office" as a surface/role-scope value** inside the awareness system — but notably, `ROUTES.office` in the legacy pipeline maps every domain to `"/"`, i.e. the legacy awareness pipeline treats the `office` surface as an unwired stub, unlike its real per-domain routing tables for `consumer`/`facility`.
2. **"Ochiga Office"**, the actual CRM/back-office product (`src/routes/officeExport.ts`) — genuinely separate at the transport/auth layer: every route is gated by a static shared-API-key compare, not JWT/session auth. It **does** intersect with physical-estate awareness concretely: `GET /portfolio/projection` builds a real cross-estate rollup (devices online/offline, major open escalations, last activity) by querying `estates`/`homes`/`devices`/`maintenance_requests`/`incidents` directly. Office also gets full conversational parity through the same `ConversationOrchestrator` used by facility/consumer (`surface: "public_corporate"`/`"office_internal"`), with `public_corporate` explicitly, code-enforced-blocked from resident/facility/device/visitor/wallet/security/operational systems.

**A concrete privacy gap, distinct from the camera leak (§26)**: `contextResolutionService.ts:141` resolves `surface: "facility"` requests by checking only whether the requested home's `estate_id` is among any estate the actor is a member of — **not** whether the actor actually holds a facility/staff role. A plain `resident` who is a member of an estate can send `surface: "facility"` with another home's `home_id` in that same estate and receive that home's name/block/unit/electricity_meter/water_meter/internet_id/gate_code via `oisContext.home` — bypassing the "not your home" restriction that correctly applies under `surface: "consumer"`. The downstream role-scoped event/awareness filtering (`getIntelligencePermissionPolicy`) is sound and independently enforced, but the raw context-resolution layer itself is not — this specific gap was not traced all the way through to confirm downstream exploitability (e.g., whether device-command/camera-stream authorization independently re-checks role), and is flagged as a finding requiring follow-up verification, not a fully proven end-to-end exploit.

**The Office export layer has no privacy_class/role scoping comparable to the rest of the system** — `/portfolio/projection` is gated only by the single shared API key, with isolation resting entirely on "trust the key holder," structurally different from the role/privacy_class model used everywhere else.

---

## Section 16 — State-store inventory

A recurring, generally sound pattern: **`<domain>_state`/registry table (single-row-per-entity, upsert) paired with a `<domain>_history` append-only log.** Full domain-by-domain inventory (devices, cameras, access/security, occupancy, utilities/infrastructure, maintenance, automations, and the canonical `operational_*` stack) is detailed in §4–10 above and not repeated here. The two headline structural problems, true across domains:

1. **Duplicate current-state surfaces for the same entity with no reconciliation**: `devices` vs. `device_states` (provisioning-flavored vs. runtime-flavored); `facility_cameras.health_status` vs. `camera_infrastructure.health_state` (§6).
2. **`operational_awareness` — the table most literally named for this audit's governing question, complete with a real `expires_at` staleness column — appears write-only.** `canonicalIntelligenceStore.ts` upserts to it; no `SELECT` against it was found anywhere in `src/`. Either it's consumed by a system outside this repo, or it's populated but not yet wired into any in-repo query — flagged, not conclusively proven absent by static analysis alone.

---

## Section 17 — Freshness/time semantics

**At least four independent, mutually inconsistent staleness conventions exist for the devices domain alone**, plus further inconsistency elsewhere:

1. `src/oyi-core/contracts/freshness.ts` — a genuinely sophisticated policy model (`fresh/stale/expired/unknown/unobservable/provider_disconnected`).
2. `deviceObservationPolicy.ts` — per-device-*type* thresholds (e.g. a currently-viewed switch goes stale at 75s; a battery lock **never** goes stale under this model — event-driven assumption).
3. `deviceEvidence.ts`'s `deviceFreshnessFromTimestamp` — a separate, hardcoded, type-agnostic model (fresh ≤2min, stale ≤15min) used specifically in the batch home-inventory query path.
4. `contributorSummary.ts`'s `DOMAIN_FRESHNESS_POLICY` — a third, domain-level bucketing (devices 15min/6h, security 60min/24h, maintenance/visitors/utilities 24h/7d; wallet permanently "historical").
5. `domainReasoningPolicies.ts` — a fourth, again numerically distinct, per-domain `timeWindowMinutes` for the incident-correlation layer.

**Concrete consequence**: the identical lock, idle for 20 minutes, is "fresh forever" under model #2 but "expired" under model #3 — depending only on which of two code paths answers the conversational request.

**Time-field vocabulary is unstandardized** across tables: `last_seen`, `last_seen_at`, `observed_at`, `occurred_at`, `received_at`, `generated_at`, `updated_at` — each table invented its own convention.

**Stores with no staleness concept at all** (return however-old data as if current): `utility_telemetry` reads, `camera_infrastructure` reads, and `resident_proximity_settings` consumption in `proximityService.ts`.

---

## Section 18 — Conflict resolution

Beyond `deviceRuntimeStateService`'s already-audited provider-timestamp precedence: **a sharp split between real, deliberate compare-and-swap (CAS) discipline in the automation-execution path, and naive last-write-wins everywhere else that has the identical shape of problem.**

- **Real, comment-documented CAS**: `facilityAutomationService.ts`'s approval-claiming (`.eq("status","pending_approval")` guard) and its scheduler's run-claiming (`.eq("next_run_at", scheduledFor)` guard) — both explicitly added, per an inline comment, to close a race found by a prior "Cross-Domain Fabric Closure audit." This is the best-engineered conflict-resolution code found anywhere in this audit.
- **No conflict resolution, same shape of bug, found in two other domains**: `maintenance.controller.ts`'s `updateMaintenance` (§10) and `visitorController.ts`'s `approveVisitor`/`denyVisitor` (§7) both read-then-write with no status precondition — two actors racing produce silent last-write-wins with no detection, and in maintenance's case, a timeline entry that can record an already-stale `from_status`.
- **Camera health** (§6): two independently-written fields for the same camera, never cross-reconciled.
- **Occupancy** (§8): single-writer today, so no active race, but also no staleness/ordering guard on writes.

**The strongest inference in this section**: the CAS discipline reads as a targeted fix applied to one subsystem after a specific incident, not a platform-wide convention — the maintenance and visitor domains have never received the equivalent fix despite having the structurally identical problem.

---

## Section 19 — Awareness scoring/priority

At least four to five independently-implemented scoring systems coexist, confirmed and partially disambiguated in this pass:

- **`attention_score` / `score_breakdown.surface_priority`** — the real scoring engine matching an earlier "buildAwareness/surface_priority" lead, located in the **legacy** file `oyiUnifiedIntelligenceService.ts` (`scoreSignal`, `surfacePriorityScore`), not in the canonical `contextAwareness.ts` as initially suspected. Facility surface weights security/camera/infrastructure highest.
- **`contextAwareness.ts`'s `buildAwareness`/`buildAwarenessFromSignal`** — a same-named but structurally different function: a pure signal→card formatter with **no privacy filtering and no surface parameter in its signature at all**. Two functions named `buildAwareness`, different generations, different behavior, easy to conflate (also relevant to §27, duplicate paths).
- **`urgency`**, **`signalSeverity`/`signalPriority`**, and a device-specific classifier — additional, independently-coded severity/priority vocabularies established in earlier work packages, not re-derived here but consistent with the pattern of parallel, unreconciled scoring logic found throughout this audit.
- **The literal claim "Awareness Scoring V3" does not exist under that name anywhere in the codebase** — refuted directly.

---

## Section 20 — Incident model

Two genuinely different incident systems, each with a capability the other lacks:

- **`operational_incidents`** (canonical) — real cross-domain correlation via `incidentCorrelation.ts`, but **no list endpoint** exists to browse them.
- **`facility_incidents`** (legacy/direct) — a real, working list endpoint, but **no cross-domain correlation** — each incident stands alone.
- **A genuine DB CHECK-constraint bug**: `escalated`/`verified` statuses are accepted and written by application code but are **not permitted by the original CHECK constraint** on the table — an application/schema mismatch independent of the dual-system problem.

---

## Section 21 — Oyi context assembly

**At least five independently-implemented context-assembly systems**, now more precisely characterized after this pass's confirmation:

1. **`ConversationOrchestrator.ts`** — the canonical path, capability+evidence-driven, the single entry point actually called by all four in-repo conversational surfaces (facility, consumer, general AI, communications follow-ups, and Office's public/internal conversation endpoints).
2. **`oyiUnifiedIntelligenceService.ts`'s `runOyiUnifiedChat`** — the legacy fallback, explicitly still reachable: `canonicalConversationRuntime.ts` falls through to it whenever its own "exact target read" short-circuit doesn't apply, with an inline comment naming `/ai/chat`, `/office/*`, `/communications/*` as reachable callers and a dedicated metric (`oyi_canonical_runtime_legacy_service_fallback_total`) added specifically to make a future retirement decision evidence-based. This is instrumented, disclosed technical debt, not hidden debt.
3. **Watch's independent `commandRouter.ts`** — a separate resolution path for the Watch surface.
4. **The signal-driven `oyiCoreRuntime`** — reacts to canonical signals independently of the conversational turn-by-turn path.
5. **The self-admittedly-still-live legacy `intelligence-core` organizational layer** — still load-bearing for `GET /oyi/awareness`, `GET /intelligence/*`.

**Correction from this pass**: the canonical runtime's "kernel surface" framing (its own routing comment calls `/oyi/runtime/*` "the backend-owned kernel surface") **overstates how separated the two engines actually are** — the kernel surface itself depends on the legacy engine as an active fallback and unconditionally calls legacy thread-context loading (`loadOyiConversationContext`) for continuity, correctly `user_id`-scoped but still a legacy dependency in the "canonical" path's own critical chain.

---

## Section 22 — UI/API projections

Established in an earlier work package and reinforced structurally here: UI-facing projections are assembled by re-derivation at read time (`normalizers.ts`, `activity.ts`) rather than being served directly from a canonical store, precisely because no canonical store has full coverage (§1–3). This means a UI projection's correctness depends on the completeness of ad hoc, per-endpoint table-scanning logic rather than on a single trusted read path — the same structural risk that produces the privacy-scoping gaps found in §6 and §15, since re-derivation logic must independently reimplement scoping/privacy checks rather than inheriting them from a canonical, pre-filtered source.

---

## Section 23 — Automation event input

**Hybrid, not canonical.** The event-*rule* matching mechanism itself is architecturally clean — `matchEventDrivenAutomationRules` has exactly one caller (`eventBus.ts:146`), fed by the legacy bus. But Facility Automation as a whole is **not** single-path: four independent trigger mechanisms all terminate in `proposeAutomationApproval`:

1. Registered event rules (via the canonical bus matcher, admin-configured).
2. `detectDuplicateMaintenanceRequest` — called **directly** from the maintenance controller on every request creation, bypassing the event bus entirely.
3. `scanStaleVisitorAuthorizations` — not event-driven at all; a lazy, on-read scan triggered by a GET request loading the Automation workspace.
4. Scheduled custom automations — a completely separate, time-driven `setInterval` polling loop (30s tick) in `scenes.ts`.

On a single maintenance-request creation, mechanisms (1) and (2) can both independently fire and both attempt to propose the same action against the same entity — only reconciled downstream by a DB-level "one pending per target" unique index (execution itself stays safe; the *trigger surface* is genuinely fragmented).

**Two registered trigger types are dead**: `maintenance.completed`/`maintenance.cancelled` are listed as valid automation triggers in `TRIGGER_REGISTRY`, but **have no producer anywhere in `src/`** — an estate admin can configure a rule against them with no error, and it will silently never fire.

**Real, DB-enforced dedup**: a partial unique index on `(source_table, source_event_id)` genuinely prevents duplicate canonical-bus inserts for every domain producer checked except one low-risk AI-observability logger. **Real loop protection**: `metadata.automation_origin === true` structurally short-circuits the matcher, preventing automation chains from re-triggering themselves.

**Scope gap**: rules are matched strictly `estate_id`-scoped with **no home-level scoping on the rule itself** — a rule with no explicit home-scoped condition fires for every home in the estate regardless of which home produced the triggering event.

---

## Section 24 — History-vs-current-awareness

Applying a strict test (real query + real consumption that changes present output required for "implemented"):

**Genuinely implemented and live**: duplicate-maintenance-request detection (72h window); device-offline clustering (7-day window, ≥3/≥5 thresholds); automation-outcome failure-rate assessment (≥30%/≥60% thresholds, assessment-only — does not throttle or disable the automation); security-incident-frequency elevation (≥2 unresolved); utility **spend** forecasting (real linear-trend backtest over 12 weeks of `wallet_transactions` — explicitly **not** consumption/usage forecasting, which the code declined to fabricate given no reliable telemetry source exists); device-usage-counter-based repeated-fault detection; maintenance SLA aging (single-record age only, not cross-record pattern); short-window (90s) infrastructure outage correlation; in-memory same-entity signal recurrence for a single request's insight generation.

**Absent**: no code looks up a device's or home's *past resolved* maintenance history to set priority/urgency on a *new*, unrelated request.

**Partially implemented — the most interesting finding in this section**: a real "learning" system computes genuine empirical prediction-outcome accuracy (`realized/(realized+not_realized)`, ≥20-sample threshold) and can even write a new calibrated parameter value. But `current_value` on `oyi_learning_parameters` is **written and never read anywhere else in `src/`** — no detector or prediction provider consults it. The mechanism to *act* on learning exists structurally but has zero live wiring: a closed accounting loop, not a feedback loop.

---

## Section 25 — Prediction/anomaly/learning

**There is no real ML model or trained statistical classifier anywhere in the backend.** Every "anomaly detector" and "prediction provider" is a deterministic count/ratio/age threshold check, and — notably — the codebase is unusually candid about this in its own comments: `model_type: "rule"` and explicit `limitations` fields self-disclose "rule-based estimate... not a statistical model" rather than overstating maturity. The one genuinely statistical component, `forecastMethods.ts`'s linear-regression/moving-average/backtested forecasting, is honestly labeled as simple arithmetic and applied only to utility *spend*, never consumption (§24).

Camera "AI" detections (`detectionType`/`confidence`) are **ingested, not computed** — no ML inference library exists anywhere in `src/`; any actual model runs off-repo on edge hardware. The proactive-intelligence scheduler that would run these detectors periodically is real, correctly wired to `worker.ts`, but gated by two environment flags (`OYI_PROACTIVE_SCHEDULER_ENABLED`, `OYI_LEARNING_PROPOSAL_ENABLED`) that are **absent from `.env`/`.env.example`** — disabled by default in this repo's current configuration.

---

## Section 26 — Privacy/representation policy

**No single "Representation Policy" module exists under that name.** Instead, at least **four independently-coded privacy/authorization vocabularies** answer the same underlying question ("can this actor see this fact"):

1. `CapabilityService.ts`'s `privacyAllowed` — `privacy_class` × `surface`, gating canonical conversation evidence.
2. `intelligencePolicyResolver.ts`'s `privacyClassForSignal`/`outputSetFor` — a *different* `privacyClass` enum, gating which delivery channels a canonical signal may fan out to.
3. `intelligence-core/permissionEngine.ts`'s role→scope policy — post-hoc filtering of the legacy awareness/timeline feed. This is the layer that is **correctly enforced** for home/estate scoping in the common case.
4. `cameraAccess.policy.ts`'s per-camera `privacy_scope` — direct camera access only.

**Two confirmed, concrete gaps**, both already detailed above and repeated here as the audit's central privacy findings:

- **§6's camera-awareness leak**: facility/security staff's ordinary `cameras.view` role permission is sufficient to see event text from a resident's home-privacy-scoped camera through the legacy ambient-awareness feed, though the same actor is correctly blocked from that camera directly. This is the single most concrete, fully-traced finding in the entire audit.
- **§15's surface-spoofing gap**: `contextResolutionService.ts`'s `facilityHome()` checks estate membership, not facility/staff role, when resolving `surface: "facility"` — allowing a plain resident to request another home's identity fields within the same estate.

**A third, lower-severity gap**: the canonical scope-resolution precedence (`oisContext` before raw `actor.home_id` — correct, and explicitly documented as correct in `cameraAccess.policy.ts`'s own header comment, which warns that `users.home_id` "is only a login/default convenience and is stale for a multi-Home user after a context switch") is **inverted** in the legacy pipeline's `applyRoleScopeToFilters` for the `home`-scope case, where raw `actor.home_id` wins over the already-membership-verified `oisContext`-derived filter. A resident who has switched active home can be silently scoped to the *wrong* home by the legacy awareness/timeline feed.

**A fourth, narrower gap**: `loadRecentDeviceChangeFacts` only excludes an audit row when `metadata.home_id` is *present and mismatched* — a row whose free-form metadata simply omits `home_id` passes through on estate match alone.

**Executive-briefing gating is inconsistent between the two pipelines**: the legacy `GET /intelligence/executive`/`/brief` is role-gated; the canonical `POST /oyi/runtime/executive` has **no role gate at all** — low-risk today only because it builds its briefing from caller-supplied signals rather than querying the DB, but a real gap in the authorization *model* that would become an actual hole the moment that endpoint is wired to read persisted signals.

---

## Section 27 — Duplicate intelligence paths (full inventory)

| Pair/group | Classification | Risk |
|---|---|---|
| `operational_*` canonical persistence vs. legacy `ochiga_intelligence_events` + raw-table scan | CONFLICTING AUTHORITY | The data users actually see today comes from the legacy pipeline; canonical persistence is largely write-only (§16, §0). |
| Two `buildAwareness()` functions (canonical formatter vs. legacy scored/privacy-filtered version) | DUPLICATE | Same-named, structurally different; a fix to one doesn't propagate. |
| Two executive-briefing implementations (canonical, no role gate; legacy, role-gated) | CONFLICTING AUTHORITY | Materially different authorization postures for the same conceptual feature (§26). |
| `mergeEvents()` reimplemented near-identically twice | DUPLICATE | Slightly different fallback dedup-key logic; a fix in one silently doesn't apply to the other. |
| `cameraAccess.policy.ts` (fine-grained) vs. `permissionEngine.ts`'s `can_view_camera` (role-only) | CONFLICTING AUTHORITY | The concrete camera leak (§6, §26). |
| `oisContext`-first scope resolution (canonical) vs. actor-first (legacy `authenticatedActorScope`) | DUPLICATE, bordering CONFLICTING AUTHORITY | Stale-home scoping for multi-home residents in the legacy pipeline (§26). |
| `canonicalConversationRuntime.ts` vs. `oyiUnifiedIntelligenceService.ts`'s `runOyiUnifiedChat` | LEGACY, but disclosed and instrumented for retirement | Not hidden debt — the team is actively tracking this for a future "Phase O" deletion decision. |
| `deviceRuntimeStateService` in-memory cache vs. 8 direct DB readers of `device_states` | LEGITIMATE PROJECTION, with a latency caveat | Single writer, well-documented pattern; canonical evidence reads the DB row, not the fresher cache (§4–5). |
| `canonicalReferenceResolver.ts` (spatial bridge) vs. `conversationTargetCandidates.ts`/`conversationObjectHydration.ts` (chat entity resolution) | LEGITIMATE PROJECTION — not a problem | Different concerns, each correctly scoped by its own callers. |
| `SpatialDeviceActionService.ts`/`spatialFacilityContextService.ts` reusing rather than reimplementing authoritative services | ADAPTER — exemplary | Positive calibration point: the codebase clearly knows how to avoid duplication when it wants to. |
| `LegacyConversationAdapter.ts` (name is misleading) | LEGITIMATE PROJECTION — not dead code | A thin metrics-tagging wrapper around the canonical runtime itself, despite its name. |

**What's genuinely healthy**: the Facility Spatial Mode Convergence code explicitly documents, in its own comments, that it reuses rather than duplicates authoritative services, and does so correctly. The canonical domain evidence loaders for security/visitors/devices are carefully home/estate-scoped with inline reasoning comments. The legacy-fallback path in the conversation runtime is instrumented specifically so it can be safely retired, rather than being silent, undocumented debt.

---

## Section 28 — Awareness Authority Matrix

Classification key: **CANONICAL** (one system, no known competing authority) · **PARTIAL** (canonical system exists but has known coverage/latency gaps) · **PARALLEL** (two or more independently-coded systems answer the same question, unreconciled) · **LEGACY** (an older system is still load-bearing pending a disclosed retirement) · **MISSING** (no system answers this today) · **UNKNOWN** (not conclusively determined by static analysis alone).

| Domain fact | Classification | Authority / detail |
|---|---|---|
| Device power state (current) | PARALLEL | `devices.online` vs. `device_states.status` vs. `ProviderHealthRegistry` — 3 independently-written answers, no reconciliation. |
| Device online/offline | PARALLEL | Same as above; additionally MQTT-push vs. poll-refresh reach different downstream event pipelines (§1–3, §23). |
| Camera online/offline | PARALLEL | `facility_cameras.health_status` vs. `camera_infrastructure.health_state`, independently written, never cross-checked. |
| Camera detection event | LEGACY (functionally) | Ingested from edge, routed almost entirely through the legacy `camera_events`/timeline path; canonical evidence loaders exist but the live ambient-awareness surface uses the legacy path. |
| Access/door state | MISSING (as dedicated model) | No live door/lock current-state table (`access_points` is dead); door state rides the generic device model with no domain-specific semantics. |
| Visitor status | LEGACY | `visitor_access` is real and live but never reaches the canonical Core; race-condition-vulnerable on approve/deny (§7, §18). |
| Electricity state | PARALLEL / MISSING | No unified representation; derived almost entirely from device-connectivity clustering heuristics, not real electrical telemetry (§9). |
| Water state | PARTIAL | `utility_telemetry` exists and is CHECK-constrained for `water`, but has no device-level identity and no staleness enforcement. |
| Meter reading | MISSING | No per-meter reading series exists anywhere; explicitly disabled as a stub capability in code. |
| Maintenance fault | PARTIAL | Real current-state table (`maintenance_requests`) with a likely-live schema/code identity bug (§10) and no asset-level binding. |
| Active incident | PARALLEL | `operational_incidents` (real correlation, no list endpoint) vs. `facility_incidents` (real list endpoint, no correlation) — genuinely complementary, unreconciled capabilities, plus a CHECK-constraint bug (§20). |
| Room/home context | CANONICAL, with a PARALLEL caveat | Direct FK hierarchy (`homes`/`rooms`/`devices`) is single-sourced and correctly reused; but the parallel `canonical_ref`/Twin bridge (§11) is disconnected from the conversational layer that would otherwise consume it. |
| Automation outcome | CANONICAL (execution) / PARALLEL (trigger) | Execution/claiming has real, deliberate CAS conflict resolution — the best-engineered path in this audit. Trigger *input* is genuinely fragmented across 4 mechanisms (§23). |
| Occupancy/presence | MISSING (as a unified concept) / PARTIAL (proximity only) | Real presence signal exists (`resident_proximity_settings`) but no aggregate "who's home" store; `OperationalContext.occupancy` is a dead, never-populated field (§8). |
| Utility billing/entitlement | PARTIAL | Real and live, but structurally disjoint from all telemetry representations (§9). |
| Spatial/Twin identity | PARTIAL | Real, single-sourced data model; not yet live in production (`canonical_ref` columns) and not wired into conversational awareness (§11). |

---

## Section 29 — End-to-end traces

### A. Device physical change → observation → state → Oyi context → Facility/Consumer projection

1. **RAW SIGNAL**: a physical device change is reported to the backend, either via MQTT push (`src/device/bridge.ts`) or via the poll-refresh scheduler (`deviceRuntimeStateService.ts`'s `refresh()`).
2. **OBSERVATION/diff**: both paths independently compute the same diff via `diffEnrichedDeviceState` (`src/device/runtime/deviceStateEnrichment.ts`). The code is aware of the collision risk for realtime broadcast (`bridge.ts` explicitly passes `emitSignal: false` when calling through `acceptProviderState` to avoid double-emitting the realtime event) — but the two paths still diverge for **canonical-event purposes**: MQTT-push calls `recordDeviceEvent`, which writes `device_events` (HISTORY) **and** publishes `device.online`/`device.offline` to the legacy `ochiga_intelligence_events` bus (CANONICAL EVENT, legacy sense). Poll-refresh instead calls `emitOperationalDeviceSignal → handleSignal` (control-plane) — **never** reaching the legacy bus.
3. **CURRENT STATE**: both paths upsert `device_states` via `deviceRuntimeStateService`'s conflict-resolved writer (provider-timestamp precedence, out-of-order rejection) — this part is genuinely unified regardless of which path observed the change.
4. **Oyi context / AWARENESS**: if the change reached the legacy bus (MQTT-push only), `contextAwareness.ts`'s vocabulary (or the legacy `buildAwareness`/`scoreSignal` scoring engine) can turn it into a human-readable awareness card. If it reached the control-plane instead (poll-refresh only), it can feed `oyiCoreRuntime`'s canonical signal pipeline and the `operational_*` tables — but those are largely write-only today (§0, §16), so the practical, user-visible awareness output for a poll-refresh-only-observed change is materially thinner than for an MQTT-push-observed one, despite `device_states` (the actual current-state answer) being identical either way.
5. **Facility/Consumer projection**: both surfaces ultimately read from the same `device_states`/evidence-loader layer for "what is this device's state right now," but the ambient-awareness *narrative* ("your fridge just went offline") depends on which ingestion path observed the event, per step 4.

**Trace verdict**: the *fact* of current device state is unified and reliably correct; the *narrative awareness* built on top of that fact is not guaranteed to fire consistently, because it depends on an ingestion-path fork that has nothing to do with the physical event itself.

### B. Camera security event → observation → state → Oyi context → Facility/Consumer projection

1. **RAW SIGNAL**: an edge node reports a detection event (`detectionType`/`confidence`) — the backend ingests this; no ML inference happens in this repo (§25).
2. **OBSERVATION**: written to `camera_events`/`camera_detections` (HISTORY/RAW).
3. **CURRENT STATE (health, separately from the detection itself)**: `facility_cameras.health_status` and/or `camera_infrastructure.health_state` are updated independently, by different writers, with no cross-reconciliation (§6, §16).
4. **AWARENESS**: the ambient-awareness feed (`loadNormalizedTimelineEvents`) reads `camera_events` scoped **only by `estate_id`**, with no join back to the camera's `privacy_scope`/`home_id`. The only gate is the coarse `can_view_camera` role boolean.
5. **Facility projection**: a facility_manager/security_operator with ordinary `cameras.view` sees the event summary — **even if the originating camera is `privacy_scope: "home"`** — through this ambient feed.
6. **Direct camera access (contrast)**: the *same actor*, attempting to access that *same camera* directly (media/stream/detail), is correctly blocked by `cameraAccess.policy.ts`'s fine-grained per-camera gate, which has no facility-role bypass for `scope: "home"`.

**Trace verdict**: this is the audit's single most concrete, fully end-to-end-traced defect — the ambient-awareness projection and the direct-access projection for the *identical underlying camera* enforce two different, disagreeing privacy policies, and the weaker one (ambient awareness) is the one that leaks.

---

## Cross-cutting patterns worth carrying into any future remediation slice

1. **The canonical/legacy split is the root cause of most other findings**, not merely one finding among many — nearly every PARALLEL/CONFLICTING-AUTHORITY entry in §28 traces back to "the newer `oyi-core` system and the older `intelligence-core`/`oyiUnifiedIntelligenceService` system each independently implement the same concept."
2. **Where the codebase has fixed this class of problem once (automation-execution CAS, §18; spatial-service reuse, §27), it did so well and left a comment trail explaining why.** The gap is not skill — it's that the fix has not yet been applied uniformly to the other domains with the same underlying race/duplication shape (maintenance, visitor approval, camera health).
3. **The codebase is unusually honest about its own limitations in comments** — "no consumption table is ever queried," "not yet applied to any deployed database," "rule-based estimate... not a statistical model," "operationally_connected: false" hardcoded rather than fabricated. This audit found very little that the code itself was hiding; most findings here are things the code discloses about itself once you go looking, or structural consequences of two systems that were each honestly built but never reconciled with each other.
4. **The two fully-traced privacy findings (§6/§26 camera leak, §15/§26 surface-spoofing gap) are the most actionable items in this document** — both are narrow, well-understood, and each has a clear, already-correctly-implemented sibling mechanism nearby (`cameraAccess.policy.ts`; the `consumer`-surface home check in `contextResolutionService.ts`) that the buggy path could be brought in line with.
