# Wave 6 Slice 9 — Current State & Freshness Authority Audit

**Status:** Read-only audit deliverable. No application code, tests, or migrations were modified to produce this document.
**Governing question:** *When Oyi says something IS true right now, what observation makes that statement trustworthy?*
**Repo audited:** `/Users/ochigaidoko/Documents/Ochiga-backend`
**Starting/ending HEAD:** `aac222cbb53abbc66d564cdd681bdd8837d579f5` (Wave 6 Slice 8 — legacy conversation awareness narrowing). Verified exact match; unchanged at end of this audit (no commit made). Working tree carried only the same pre-existing, unrelated modifications present at the start of every prior slice (`scripts/pilot-import.mjs`, `src/routes/me.routes.ts`, plus the same set of untracked files). 9 commits ahead of `origin/main`, 0 behind.
**Method:** four parallel, independent, read-only research passes (device current-state/freshness; camera+Edge health; domain current-state races; cross-cutting freshness/conflict/terminology), each re-verifying every carried-forward claim from the earlier "Slice 0" audit against current HEAD with fresh file:line citations rather than restating old text, followed by coordinator-run targeted verification of the state→awareness and state→UI handoff paths.

**Explicit scope boundary honored throughout**: canonical awareness READS (Slices 1–8), physical execution/verification, Facility Automation reconciliation, and privacy convergence were **not** touched or re-examined for correctness — only referenced where a current-state fact enters or is consumed by them.

---

## Executive summary

Current-awareness READ convergence (Slices 1–8) solved a real and important problem: *which store answers "what needs attention right now."* This audit finds that problem's sibling — *which store answers "is device/camera/utility X actually true right now"* — remains **exactly as fragmented as the original Slice 0 audit found it**, plus **two newly-discovered issues** Slice 0 never caught:

1. **A structural type-contract bug** (not merely duplication) makes the Room/Home "devices" contributor's aggregate freshness permanently stuck at `"unknown"` — it can never report `"stale"`, regardless of how old the underlying device data actually is (Section 24/17).
2. **Edge node heartbeat (`edge_nodes.heartbeat_status`) has no server-side staleness threshold at all** — a crashed Edge box that stops heartbeating without a final "offline" signal is reported online indefinitely (Section 10).

The single strongest asset in the codebase for this convergence is **`deviceRuntimeStateService`** — real out-of-order rejection, real adaptive per-device refresh scheduling, real command-confirmation integration, real persistence and broadcast. It is undermined by three things: (a) its own flat 10s/60s freshness window doesn't consult the richer per-device-class policy that exists right next to it; (b) several controllers and the direct conversation "is my AC on" path bypass it and read raw tables instead; (c) it is one candidate among at least **five** independently-implemented freshness classifiers across the codebase, several of which disagree for the identical fact.

Camera health has a confirmed, still-live duality: two independent writers (an automatic Edge heartbeat and a manual/operator API) each submit their own canonical health signal for the same camera with no reconciliation — meaning this is not just a "which table do I read" problem but a genuine **upstream signal-conflict risk that can reach canonical incidents/awareness as two disagreeing rows**, even though the *read* side is correctly unified.

Visitor and maintenance status transitions have the **exact same unguarded race** the automation-approval path was explicitly fixed for — the fix was never generalized to the two domains that need it most.

Infrastructure/utility-derived awareness (power outage, generator started, solar takeover) is produced by a service that **only publishes to the legacy event bus**, which is structurally disconnected from canonical signal ingress — meaning these genuinely useful derived facts likely **never reach canonical awareness at all**, a coverage gap distinct from (and more basic than) a freshness disagreement.

---

## 1. Device current state (Sections 3–7)

### 1.1 Inventory

| Surface | Fields | Timestamp(s) | Freshness model | Writer(s) | Authority claim |
|---|---|---|---|---|---|
| `devices` table | `online`, `status`, `last_seen_at`, `last_event_at`, `bind_state`, `sync_state`, `commissioning_status` | `last_seen_at`, `updated_at` | None applied by most direct readers | `deviceAssignController.ts`, `edgeDiscovery.ts`, `deviceRegistryController.ts` | Implicitly claims to BE current state where read directly — no freshness gate found on these direct reads |
| `device_states` table | `device_id` (PK), `status` (jsonb), `last_seen`, `updated_at` (trigger) | `last_seen`, `updated_at`, embedded `status._oyi_runtime.*` | None at raw-table level | Sole writer: `deviceRuntimeStateService.ts` (`defaultPersistSnapshot`) | Runtime-authoritative row, but bypassable — direct DB readers skip the fresher in-memory layer |
| `deviceRuntimeStateService` in-memory cache | `state`, `provider_timestamp`, `runtime_timestamp`, `last_refresh`, `ttl`, `stale`, `freshness`, `age_ms`, `provider_error`, `refresh_class`, `viewed_until_at` | `provider_timestamp` (adapter payload), `runtime_timestamp` (service clock) | Own flat model: fresh ≤10s, stale ≤60s, else expired | `.set()`/`acceptProviderState()` | The freshest, most complete authority — only for callers that go through the service |
| Provider live state (Tuya adapter) | Raw provider payload | Provider-supplied, extracted via `providerTimestamp()` precedence chain | None of its own | Adapter registry | Source for one refresh cycle, not a store |
| Execution ledger (`deviceCommandExecutionStore.ts`) | `expected_state`, `observed_state`, `truth_state`, `confirmation_status`, `physical_effect_status` | Command dispatch/confirmation timestamps | Explicit lifecycle, not fresh/stale | `deviceRuntimeStateService.acceptProviderState()` | Authoritative for command-confirmation truth only, not general device state |
| `ProviderHealthRegistry` | `status`, `latencyMs`, `failures`, `healthScore` | `lastEventAt`/`lastSuccessAt`/`lastFailureAt` | Own scoring, no bucket | Adapter layer | **Per-provider**, not per-device — a fourth-ish state surface, consumer routes unconfirmed |
| Conversation evidence (`deviceEvidence.ts::runtimeEvidenceForDevice`) | `EvidenceEnvelope` with `freshness`/`observed_at` | `provider_timestamp \|\| runtime_timestamp \|\| last_refresh` | `observationPolicyForDevice()` + `contracts/freshness.ts` | — | The one place freshness is threaded correctly into a device fact — *if* the caller passes a real runtime snapshot |
| Conversation evidence (`deviceEvidence.ts::loadHomeDeviceInventoryFacts`) | Batch inventory facts | `stateRow?.last_seen \|\| stateRow?.updated_at \|\| device.last_seen_at \|\| device.updated_at` (mixes observation and DB-touch timestamps in one fallback chain) | `deviceFreshnessFromTimestamp` — flat 2min/15min, type-agnostic | — | The path `devices.status.read` capability actually uses for "Is my AC on?" (see Section 26) — a **different, less sophisticated** freshness model than the one above, for the same underlying `device_states` value |

### 1.2 Provisioning vs runtime (Section 4)

Confirmed disagreement risk: `devices.online`/`status` (provisioning-flavored) vs `device_states` (runtime-observed) **can disagree with no reconciliation**. `src/controllers/deviceEstateController.ts` is confirmed to read **both** tables within the same file. `deviceRuntimeStateService` itself correctly treats `devices` as provisioning metadata (estate/home/room/provider/capabilities via `defaultResolveDevice()`) and `device_states`/live polls as runtime truth — that split is intentional and correct *inside the service*. The risk is entirely in **other code paths that read `devices.online` directly, bypassing the service** — no explicit precedence rule exists for these bypassing readers; this looks like an accident of incremental development, not a design choice.

### 1.3 `deviceRuntimeStateService` maturity (Section 5)

**Assessment: by a clear margin, the strongest existing candidate for canonical DEVICE CURRENT STATE authority.**

Real, working mechanisms confirmed: provider-timestamp-based **out-of-order rejection** (an incoming update older than the cached `provider_timestamp` is dropped, metered, and logged — `oyi_device_runtime_out_of_order_updates_total`); **adaptive refresh scheduling** with 7 distinct `refresh_class` buckets (`provider_disconnected`/`offline`/`active_critical`/`recently_commanded`/`currently_viewed`/`recently_active`/`inactive`) each with its own interval, plus deterministic per-device jitter to avoid refresh storms; a real **active-view lease model** (`markViewed()`/`releaseViewed()`, 15s–120s TTL) that measurably speeds up refresh while a user is looking at a device; **provider-error classification with exponential backoff** (5min→60min for auth failures); **command-confirmation integration** that correctly distinguishes provider-ack from physical confirmation (`physical_effect_status: "inferred"|"contradicted"|"unknown"`, never fabricating `"confirmed"`); real **persistence** (upsert to `device_states` after every accepted update) and real **realtime broadcast** to socket rooms.

Its three real gaps: (1) its own `fresh`/`stale`/`expired` classification is a flat 10s/60s window that does **not** consult `deviceObservationPolicy.ts`'s per-device-class policy sitting in the same feature area — a battery lock is treated identically to a viewed switch by this classifier, contradicting the explicit design intent of the policy file next to it; (2) it is not universally consulted — controllers and the conversation-inventory path (Section 1.1, `loadHomeDeviceInventoryFacts`) read the underlying tables directly instead; (3) in-memory cache means a process restart loses all runtime state until re-hydrated from the DB row, which may itself be stale.

### 1.4 Device observation policy (Section 6)

`DEVICE_OBSERVATION_POLICIES` (`deviceObservationPolicy.ts:11-18`) — precise, per-class thresholds:

| Class | Mode | expected | stale-after | expired-after |
|---|---|---|---|---|
| currently_viewed_switch | actively_polled | 30s | 75s | 180s |
| inactive_switch | periodically_polled | 600s | 720s | 1800s |
| battery_lock | event_driven | — | — | — (never) |
| virtual_ir_appliance | parent_derived | — | 1800s | 86400s |
| provider_disconnected / disabled | — | — | — | — |

Confirmed callers: `deviceEvidence.ts` and `oyiRoutes.ts` only — **not canonical**, not consulted by `deviceRuntimeStateService`'s own classifier (Section 1.3), not consulted by `loadHomeDeviceInventoryFacts`'s flat model. Three independently-maintained "how fresh should a viewed switch be" answers exist for the identical device class: 75s (this policy), 60s flat (the runtime service), 2min (the inventory-facts flat model).

### 1.5 Device state consumers matrix (Section 7)

| Consumer | State source | Freshness applied? | Can show stale as current? | Authority status |
|---|---|---|---|---|
| Facility (`deviceEstateController.ts`) | Both `devices.online` AND `device_states` in the same file | Not confirmed on the raw-table path | **Yes** | AMBIGUOUS |
| Consumer routes | Presumed similar; not exhaustively traced | — | Unconfirmed | UNKNOWN |
| Conversation "is my AC on" (`devices.status.read` → `loadHomeDeviceInventoryFacts`) | `device_states`/`devices` fallback chain | Yes, but the flat 2min/15min model, not the per-class policy | No (a freshness field is always attached) but the **verdict itself can be wrong** relative to the richer model | STRONG_CANDIDATE surface with an internal inconsistency |
| Conversation recent-change facts (`runtimeEvidenceForDevice` path) | `deviceRuntimeStateService` snapshot | Yes, per-class policy | No | Does it right |
| Automation (`facilityAutomationService.ts`) | `device_states` | Not confirmed whether staleness gates condition evaluation | Possibly | AMBIGUOUS |
| `smartAccessController.ts` (locks) | `device_states`, with genuine provenance flags (`declaredByProvider`, `liveVerified`, `verifiedAt`) | Yes — the best-engineered non-generic consumer found | No | STRONG_CANDIDATE |
| Watch / Twin | No distinct device-state read confirmed this pass | — | Unconfirmed | UNKNOWN — flagged for follow-up |
| Verification / Reports | Not traced this pass | — | — | UNKNOWN — flagged for follow-up |

---

## 2. Camera health (Sections 8–9)

**Three stores, confirmed still real and still unreconciled**, with one correction to the prior audit's framing: `facility_cameras` is **more actively maintained than previously characterized** — not merely set-once-at-creation.

- **`facility_cameras`** (`status`, `health_status`, `stream_status`, `last_seen_at`, `last_health_check_at`, `last_success_at`, `last_failure_at`, `latency_ms`, `reconnect_count`, `provider_error`). Real ongoing writer: `POST /edge/cameras/:cameraId/stream-health` (`edgeDiscovery.ts:415-524`, Edge-token-gated) — the Edge node itself pushes live stream health. `last_seen_at` is stamped **only** when `status==="online"`. Separately, `cameraMedia.service.ts` stamps only `last_seen_at`/`metadata.frame_freshness_at` on actual frame capture — a distinct "last frame received" signal, not a health verdict.
- **`camera_infrastructure`** (`health_state`, default `"awaiting_telemetry"`). Written **only** by `platformGapService.ts::upsertCameraInfrastructure` — an **operator/API-driven** endpoint, not an automatic heartbeat. Paired append-log `camera_health_history`.
- **`camera_dvrs`** — legacy, DVR registry only, no other reader/writer found.

**The duality is not just a read-time ambiguity — it reaches canonical signals.** Both writers independently call `submitCameraHealthCanonicalSignal` (`oyi-core/domains/camera/cameraCanonicalSignal.ts:189`) on a genuine transition: `edgeDiscovery.ts:506` (automatic) and `platformGapService.ts:545` (operator-driven). **No reconciliation exists between the two before either submission.** Concrete scenario: an Edge agent pushes `stream-health status:"offline"` → `facility_cameras` correctly flips to offline and a canonical camera-health signal fires. No operator has touched `camera_infrastructure` for that camera, so it still reads a stale/manually-entered `"healthy"`. `GET /facility/cameras` (reads `facility_cameras`) reports **offline**; the infrastructure-overview projection (reads `camera_infrastructure`) reports **healthy**, for the identical physical camera. If an operator later manually re-submits `camera_infrastructure` health while the Edge-reported state is still offline, canonical incident ingestion can receive **two independently-sourced, disagreeing camera-health signals for the same camera**, since incident correlation keys off the transition classification computed independently by each writer (see Section 3.5, incident-level last-write-wins).

**Camera detection vs. health: properly separated, no conflation found.** `cameraDetection.service.ts` only reads `facility_cameras` for access-control fields (never health fields) when logging a detection; detection ingestion never touches a health field. A recent detection is never treated as implicit health evidence anywhere found in this pass.

---

## 3. Edge, infrastructure, access, and domain lifecycle findings (Sections 10–16)

### 3.1 Edge health (Section 10)

Real two-table current-state + append-log pattern, both written together on every heartbeat (`edgeDiscovery.ts::recordHeartbeat`): `edge_nodes` (current row: `heartbeat_status`, `last_seen_at`, `local_runtime_host`, `camera_count`, `device_count`, `queue_depth`, `sync_status`, `error_count`) + `edge_heartbeats` (insert-only log). No dedicated MQTT-connectivity field or local-detector-health field distinct from overall `heartbeat_status`/`error_count`.

**Newly discovered risk, not in the prior audit**: exhaustive search for staleness logic near `edge_nodes` (stale/threshold/offline/minutes/timestamp-diff patterns) returned **zero results**. There is **no server-side TTL** that would flip a node to "offline" if heartbeats simply stop — an Edge box that crashes without sending a final "offline" heartbeat is reported **online indefinitely** by every consumer of `edge_nodes.heartbeat_status`. Edge node health DOES reach canonical signal ingress — `emitEdgeSignal()` (`edgeDiscovery.ts:274-283`) calls the realtime `emitSignal()` helper without `skipCanonicalIngress: true`, so it falls through to `legacyAmbientCanonicalIngress()` and reaches `oyiCoreRuntime.receiveSignal()` — but this ingress is triggered **only when a heartbeat actually arrives**; it has nothing to say about the absence of one.

### 3.2 Infrastructure/utilities (Section 11)

| Fact | Classification | Detail |
|---|---|---|
| `utility_telemetry` (power/water/network/environmental only — **no gas**) | OBSERVED (nominal) | `state` field (`live/degraded/offline/awaiting_telemetry/no_source_configured`) is **caller-supplied, never computed server-side**; `observed_at` is also caller-supplied — no independent verification against receipt time; no staleness sweep exists |
| `utility_events` | HISTORY (write-only) | Confirmed still dead — zero query call sites anywhere, per the codebase's own comment |
| Meter reading (any utility) | **MISSING** | No `meter_reading`-style table exists in any migration; `home_service_accounts.meter_id` is only an identifier string, not a reading series — "latest meter value" as current state does not exist at all |
| Electricity/generator/solar/battery "state" | DERIVED | Purely device-connectivity-clustering heuristics (`infrastructureEventIntelligenceService.ts`) — pattern-inferred from device online/offline timing and name-matching, never from an actual sensor reading |
| Gas / diesel / pumps / streetlights | **MISSING** | No representation of any kind found, not even a stub |
| Billing/entitlement | PROVISIONING | Structurally disjoint from all telemetry above, not re-traced in depth |

### 3.3 Access/door/gate (Section 12)

**More positive finding than the prior audit's blanket characterization.** Locks specifically have a real, freshness-aware current-state model riding on `device_states`: `smartAccessCapabilityService.ts` computes `lock_state`, `lock_state_freshness`, `lock_state_confirmed_at`, `lock_state_source_dp_code`, plus explicit provenance flags (`declaredByProvider`, `readableByOyi`, `liveVerified`, `verifiedAt`). This refines (not just reconfirms) the prior "MISSING" claim — only the dedicated **`access_points`** table is confirmed dead (zero references anywhere). Gates reuse the same lock/device machinery with no gate-specific semantics (e.g., no "ajar" state) and no dedicated table. No conflation of access-event-history with current physical state was found in the paths inspected, though this was not exhaustively verified against every read path.

### 3.4 Visitor lifecycle (Section 13) — **race confirmed still present**

`visitorController.ts::approveVisitor` and `::denyVisitor` both perform an unconditional `.update({status}).eq("id", id)` with **no status precondition**, guarded only by ownership/authority (`authorizeVisitorForUser`), not concurrency. Two concurrent approve/deny calls on the same row both pass authorization and both execute; whichever commits last silently wins with zero detection or audit trail of the lost write. This is the identical shape of bug the automation-approval CAS guard (Section 3.6) was built to close — the fix was never generalized here.

### 3.5 Maintenance lifecycle (Section 14) — **both prior findings confirmed still present**

`maintenance.controller.ts::updateMaintenance` reads `existing` unlocked, computes lifecycle timestamps from the *new* status, then writes with no `.eq("status", existing.status)` precondition — identical race shape to visitors, and the resulting timeline insert's `from_status` can itself be stale. Separately, `maintenance_requests` still has no `CREATE TABLE` in tracked migration history, yet the controller writes `resident_id`/`category`/`priority` directly onto it — inline comments show the *code* was patched to match a live schema that was **never captured in a migration file**, a real, still-present tracked-schema/live-schema drift.

**Incident state (`operational_incidents`, the canonical Wave 6 table)**: `status`/`severity` have **no CHECK constraint** (unlike legacy `facility_incidents`) and are set from the current signal's freshly-computed correlation on every upsert — **effectively last-write-wins**, no CAS guard of any kind on the upsert path. A second, more subtle race exists in `evidence`/`affected_entities` accumulation: these fields are merged client-side (read `existing`, append, write back) before the upsert commits — two concurrent signals for the same `incident_key` can both read the same snapshot and one's append silently clobbers the other's, a genuine read-modify-write race distinct in shape from the status last-write-wins. `facility_incidents`'s CHECK-constraint bug was not re-traced to the exact SQL this pass — carried forward as unconfirmed-this-pass, not asserted as still-current fact.

### 3.6 Automation state (Section 16) — reference example, unchanged, not touched

Both CAS guards re-confirmed present and unchanged: approval-claiming (`facilityAutomationService.ts`, `.eq("status","pending_approval")`, with an explicit, separately-checked distinction between "lost the race" and "genuine DB error") and scheduler run-claiming (`scenes.ts`, `.eq("next_run_at", scheduledFor)`, with an explicitly logged `automation_run_duplicate_suppressed` outcome on a lost race). The execution ledger's per-command upsert (keyed by unique `command_execution_id`) is a structurally different, monotonic-writer pattern rather than a shared-row CAS — whether out-of-order upserts on the *same* execution id could regress status was not fully traced and is flagged as worth a closer look, not confirmed as a defect.

---

## 4. Freshness models, terminology, and conflict resolution (Sections 17–24)

### 4.1 The freshness models — five found, not four

| # | Location | Output vocabulary | Basis |
|---|---|---|---|
| 1 | `oyi-core/contracts/freshness.ts::classifyFreshness` | fresh/stale/expired/unknown/unobservable/provider_disconnected | Driven entirely by an injected policy (no hardcoded numbers of its own) |
| 2 | `deviceObservationPolicy.ts` | (feeds #1) | Per-device-class thresholds — genuinely part of #1's system, not fully independent, though its real effect (a lock that never goes stale) stands |
| 3 | `deviceEvidence.ts::deviceFreshnessFromTimestamp` | fresh/stale/expired/unknown | Hardcoded, type-agnostic: ≤2min fresh, ≤15min stale, else expired — used by the batch home-inventory path (i.e., "Is my AC on?") |
| 4 | `contributorSummary.ts::classifyFreshness` | fresh/recent/stale/historical/unknown/unavailable | Domain-level bucketing (devices 15min/6h, security 60min/24h, maintenance/visitors/utilities 24h/7d, wallet always historical) |
| 5 | `canonicalAwarenessReadService.ts` (private) | current/stale/unspecified | Based solely on canonical `expires_at` — **frozen canonical-awareness code, not re-audited for correctness, cited only for the terminology inventory** |

Models 1+2 together are legitimate, deliberate, sophisticated domain policy. Model 5 is legitimate and frozen. Models 3 vs. 1/2 are the clear **accidental** duplication — same device class, two different verdicts, and (Section 4.4) one causes a real downstream bug. Model 4 is a legitimate coarser aggregation layer in principle, but it assumes every producer feeds it a real timestamp or a defined sentinel — an assumption device evidence violates (Section 4.4).

Concrete consequence, re-confirmed: the identical device idle for a given duration can be `"fresh"` under one model and `"stale"`/`"expired"` under another depending solely on which of two to three code paths answers the request — device state is the domain where this is worst, but not the only one.

### 4.2 Terminology

"Expired" means three unrelated things across the codebase (device-observation threshold; signed camera-media URL/retention TTL; not used at all in model 4). "TTL" means a freshness threshold in two places and a pure performance-cache expiry in a third (`deviceReadScopeCache.ts`, 30s in-memory, explicitly cache not truth). "Unavailable" and "historical" are, by contrast, the **one area of organic consistency found**: every non-device evidence loader (security/visitor/maintenance/utility/wallet/automation/community) uses these two literal sentinel strings consistently when no real timestamp exists.

### 4.3 Timestamp authority

`deviceEvidence.ts::runtimeEvidenceForDevice` uses a genuine, deliberate precedence chain favoring the provider's own clock (`provider_timestamp || runtime_timestamp || last_refresh`) — the most rigorous timestamp discipline found anywhere in this audit, matched by `deviceRuntimeStateService`'s own out-of-order-rejection logic. By contrast, `loadHomeDeviceInventoryFacts` mixes a genuine observation timestamp (`last_seen`) with a raw DB-touch timestamp (`updated_at`) in the same fallback chain with no way for a caller to know which one actually answered. Non-device evidence loaders uniformly treat `updated_at` as observation time — plausible for status-transition-driven tables, but not independently verified per-domain in this pass.

### 4.4 Confirmed dangerous collapse — device freshness bucket permanently stuck

**The single most concrete, highest-severity finding of this audit.** `homeContributors.ts::devicesContributor` feeds `loadHomeDeviceInventoryFacts`'s output (already-classified strings: `"fresh"|"stale"|"expired"|"unknown"`) into `contributorSummary.ts::buildContributorSummary`, whose `classifyFreshness(domain, rawFreshness, now)` expects `rawFreshness` to be a **parseable ISO timestamp** or one of the sentinel strings `"unavailable"`/`"historical"`/`"unknown"`. Every other evidence loader in the codebase correctly passes a real timestamp or a valid sentinel; **devices is the sole exception**. `new Date("fresh")`, `new Date("stale")`, `new Date("expired")` all produce `Invalid Date` → the function's `Number.isNaN` guard fires → it returns `"unknown"` **unconditionally**. Net effect: the Room/Home "devices" contributor's aggregate freshness is **structurally always `"unknown"`**, and its derived `status` can **never** become `"stale"` — that branch is now unreachable for devices specifically — regardless of how old the underlying device data actually is. Per-device facts retain correct individual freshness; only the aggregate signal is broken, silently.

A second, smaller, opposite-direction issue: `walletEvidence.ts` falls back to claiming `"fresh"` (not `"unknown"`) when `updated_at` is empty — the wrong direction for a missing-data fallback.

No dangerous "unknown→false" collapse was found in device availability status (`canonicalDeviceAvailabilityStatus` correctly falls through to a literal `"unknown"`, the safe direction) or in the `TruthState` vocabulary used through the evidence pipeline.

### 4.5 Conflict resolution / out-of-order / source precedence (Sections 21–23, consolidated)

| Domain | Multiple writers? | Current rule |
|---|---|---|
| Devices (`device_states`) | Yes | **Real**: provider-timestamp precedence with explicit out-of-order rejection |
| Devices (`devices` table) | Effectively single-writer per field | No CAS observed; not the primary risk area |
| Camera health | Yes (two independent canonical-signal submitters) | **None** — no cross-reconciliation before either submits |
| Edge health | Effectively single-writer (heartbeat) | N/A for conflict; **absence-of-heartbeat has no threshold at all** (Section 3.1) |
| Visitors | Yes (concurrent approve/deny) | **None** — confirmed unguarded race |
| Maintenance | Yes (concurrent status updates) | **None** — confirmed unguarded race |
| Incidents (`operational_incidents`) | Yes (concurrent signals for one incident_key) | **Last-write-wins on status**; read-modify-write race on evidence-array accumulation |
| Meters/utilities | Single writer per reading | No conflict rule; no staleness sweep |
| Automation approvals / scheduler runs | Yes | **Real CAS**, explicitly guarded, explicitly observable on lost race |
| Camera media retention | Single cleanup job | Real CAS (`.eq("status","ready")`), though for housekeeping not state-freshness |

No explicit source-precedence table exists anywhere for "cloud provider vs. Edge vs. DB vs. manual operator vs. derived inference" outside the devices domain, where provider-timestamp precedence is real and explicit. This audit does not invent a precedence rule where none exists — camera and infrastructure health genuinely have none today.

---

## 5. State → awareness handoff (Section 25)

Traced with fresh verification, beyond what the forks covered:

- **Device runtime state → signal → awareness**: real and explicit. `deviceRuntimeStateService` calls its injected `emitSignal()` on any genuine change or confirmation (`:667-668`), feeding the canonical signal pipeline that Wave 6's awareness convergence reads from. This path is sound.
- **Camera health → signal → awareness**: real, but **not conflict-free upstream**. As established in Section 2, two independent writers each submit their own canonical camera-health signal with no cross-check. Canonical awareness's *read* side is correctly unified (Wave 6's own work), but it can still receive — and durably store as two separate incidents — two disagreeing accounts of the same camera's health, because the conflict exists **before** the canonical store, not in how the canonical store is read. This is not a regression in Wave 6's awareness convergence; it is a pre-existing upstream gap that convergence did not and could not fix by construction.
- **Edge health → signal → awareness**: real, via the "ambient ingress" fallback path (`emitSignal()` without `skipCanonicalIngress`, falling through to `legacyAmbientCanonicalIngress()` → `oyiCoreRuntime.receiveSignal()`). Sound for the "heartbeat arrived" case; has nothing to say about a heartbeat that stops arriving (Section 3.1's gap).
- **Utility/infrastructure state → signal → awareness**: **structurally broken, newly identified this audit.** `infrastructureEventIntelligenceService.ts` (the one subsystem that derives real power-outage/generator/solar-takeover meaning) publishes exclusively via `publishSourceIntelligenceEvent` — the **legacy** event bus (`ochiga_intelligence_events`). Per this Wave 6 series' own repeated, independently-reconfirmed finding (most recently Slice 7's audit), the legacy bus is structurally disconnected from canonical `operational_signals` — nothing bridges legacy-bus publishes into canonical signal ingress. **This means power-outage/generator/solar-derived facts likely never reach canonical awareness at all** — not a freshness or conflict problem, a **coverage gap**: a real, useful signal that simply cannot appear in the primary canonical awareness surface today, only (rarely) via `/oyi/awareness`'s narrow, explicit legacy-technical-failure fallback path.

**Conclusion for Section 25's own question**: yes, canonical awareness can still be fed stale/ambiguous state (camera health case) — and, more fundamentally, it can also silently **not be fed at all** for an entire class of genuinely important derived facts (utility/infrastructure case). Awareness read convergence correctly guarantees *if* a fact reaches canonical storage, there is one truth about it — it does not and cannot guarantee every fact that should reach canonical storage actually does, or that two upstream sources agree before they both try.

---

## 6. State → conversation/UI direct reads (Section 26)

Canonical awareness is not the only consumer of state, and this audit confirms awareness convergence does **not** automatically solve direct state-query truth.

Traced concretely: **"Is my AC on?"** resolves via the `devices.status.read` capability module (`ReadCapabilityModules.ts:222-237`, matched by `deviceStatusSupports` on `frame.domain === "devices"` + `inspect`/`device.status` operations), whose `collect` step is `deviceInventoryEvidence` → `loadHomeDeviceInventoryFacts`. This is the **same function** confirmed in Sections 1.1 and 4.4 to use the flat, hardcoded 2min/15min freshness model and to be the one producer whose freshness output breaks `contributorSummary`'s aggregation. So the answer to "Is my AC on?" is state-source-correct (it does read `device_states`/`devices`, the right tables) but freshness-model-inconsistent with what the *same* device would report through `runtimeEvidenceForDevice`'s richer, per-class-policy path (used for "recent changes" queries) or through `deviceRuntimeStateService`'s own direct `snapshot()` classification. Three different freshness verdicts are structurally possible for the identical device, identical instant, depending only on which of these three entry points a user's phrasing happens to route through.

**"Is Camera 4 online?"**: answered from `facility_cameras.health_status` (confirmed exposed to conversation via `commandRouter.ts:1238`) — the Edge-heartbeat-driven store, not `camera_infrastructure`. Consistent with what Facility's own camera list shows (Section 2), but genuinely different from what an infrastructure-overview panel reading `camera_infrastructure` would show for the same camera.

**"What's my battery level?"** (a sensor-shaped device fact): follows the same `device_states`-based path as general device inventory — same freshness-model inconsistency risk as the AC example applies here too, not independently re-verified per-sensor-type in this pass.

**Conclusion for Section 26**: direct state-query authority is **table-correct but freshness-model-inconsistent** for devices, and **write-source-correct but cross-store-inconsistent** for cameras. Neither is solved by the awareness-read convergence work, and neither should be assumed solved by it.

---

## 7. State authority matrix (Section 27)

| Fact | Provisioning source | Observation source | Current-state source | Freshness model | Conflict rule | Primary consumers | Authority status |
|---|---|---|---|---|---|---|---|
| Device power (on/off) | `devices` | Provider adapter poll/push | `device_states` via `deviceRuntimeStateService` | 3 competing models depending on entry point | Provider-timestamp precedence (in the service); none for direct table reads | Facility, conversation, automation | **AMBIGUOUS** (strong candidate exists, not universally used) |
| Device online/offline | `devices.online` | Provider/Edge | `device_states` / `ProviderHealthRegistry` (per-provider) | Same as above | Provider-timestamp precedence where the service is used | Facility, conversation | **PARALLEL** |
| Device battery level | `devices`/`device_states` sensor payload | Provider adapter | `device_states` | Flat 2min/15min (inventory path) | None specific | Conversation | **STRONG_CANDIDATE**, inconsistent freshness |
| Camera online | `facility_cameras` (config default) | Edge stream-health heartbeat | `facility_cameras.health_status`/`status` | None explicit at read time (raw field) | **None** vs. `camera_infrastructure` | Facility camera list, conversation | **PARALLEL** |
| Camera stream health | — | Edge heartbeat | `facility_cameras.stream_status` | None | None | Facility, conversation | **PARALLEL** (component of the above) |
| Camera infrastructure health (projection) | Operator entry | Manual/API | `camera_infrastructure.health_state` | None | **None** vs. `facility_cameras` | Infrastructure-overview panel | **PARALLEL** |
| Edge online | — | Heartbeat | `edge_nodes.heartbeat_status` | **None — no offline TTL at all** | N/A (single writer) | Onboarding, infra summary, exports | **STRONG_CANDIDATE with a real gap** (no staleness detection) |
| Electricity availability | — | None (inferred) | `infrastructureEventIntelligenceService` derived state | None persisted as current-state | N/A | Legacy-bus notifications only (does not reach canonical awareness) | **LEGACY / MISSING** as canonical current state |
| Water availability | `utility_telemetry` provisioning-adjacent | Caller-supplied | `utility_telemetry.state` | None (caller-supplied, unverified) | None | Direct reads only | **AMBIGUOUS** |
| Latest meter value | — | — | **Does not exist** | N/A | N/A | N/A | **MISSING** |
| Door/lock state | `devices` | Provider DP | `device_states` (`lock_state`+provenance flags) | Real, freshness-aware, with `liveVerified`/`verifiedAt` | Provider-timestamp (via the generic device runtime path) | Smart-access, conversation | **STRONG_CANDIDATE** (best-engineered non-generic case found) |
| Visitor lifecycle | — | Guard action | `visitor_access.status` | Timestamp-per-transition, no aggregate freshness bucket | **None — confirmed unguarded race** | Visitor routes, awareness (via canonical incident correlation) | **AMBIGUOUS / racy** |
| Maintenance lifecycle | — | Resident/staff action | `maintenance_requests.status` | Same pattern | **None — confirmed unguarded race**; also tracked-schema drift | Maintenance routes, awareness | **AMBIGUOUS / racy** |
| Incident state (`operational_incidents`) | — | Canonical signal correlation | `operational_incidents.status` | `expires_at`-based (frozen canonical code) | **Last-write-wins on status; read-modify-write race on evidence arrays** | Canonical awareness (frozen, Slices 1-8) | **CANONICAL for read, PARALLEL/racy for write** |
| Automation execution state | — | Execution ledger | `ai_execution_ledger`/scheduler tables | Explicit lifecycle, not freshness-bucketed | **Real CAS, explicit, observable** | Automation UI, verification | **CANONICAL** (reference-quality) |

---

## 8. Proposed convergence target (Section 28 — NOT implemented)

Derived from what this audit actually found, not a generic template:

**Per-domain canonical current-state authority (recommended, not built)**:
- **Devices**: `deviceRuntimeStateService` should become the *only* current-state authority consulted for device power/online/battery facts — it already has the right mechanisms (out-of-order rejection, adaptive refresh, confirmation integration); it needs (a) to consult `deviceObservationPolicy.ts`'s per-class thresholds instead of its own flat window, and (b) every direct-table reader (Facility controllers, `loadHomeDeviceInventoryFacts`) migrated to call it instead of `devices`/`device_states` directly.
- **Camera health**: needs a genuine decision, not just a merge — is Edge-heartbeat-reported health or operator-entered health authoritative when they disagree? This audit found no existing precedent to defer to; a precedence rule (most likely: automatic heartbeat wins unless a human override is time-bounded) would need to be a deliberate design choice, not inferred from current code.
- **Edge health**: needs a server-side staleness sweep (a scheduled job or read-time TTL check against `last_seen_at`) — this is a comparatively small, contained fix relative to the others.
- **Visitor/maintenance**: needs the exact CAS pattern already proven in `facilityAutomationService.ts`/`scenes.ts` applied to `approveVisitor`/`denyVisitor`/`updateMaintenance` — a known-good pattern already exists in this codebase to copy, not invent.
- **Utility/infrastructure**: needs a decision on whether `infrastructureEventIntelligenceService`'s derived facts should be bridged into canonical signal ingress (making them visible to canonical awareness) — currently they structurally cannot be.

**What can legitimately remain domain-specific**: exact staleness thresholds (a battery lock genuinely should not expire the same way a viewed switch does — that's real domain policy, not a bug) and exact conflict semantics (an incident's evidence-array accumulation is a different kind of problem than a boolean device-online flag).

**What should be shared globally** (a common vocabulary, not necessarily one function): `observed_at` as the one name for "when was this fact actually true," distinct from `updated_at`/`received_at`; a single 4-6-state freshness vocabulary (the existing `contracts/freshness.ts` vocabulary is the strongest existing candidate to standardize on, since Section 4.1 found its underlying policy mechanism already sound); a single `source` provenance field (provider/edge/manual/derived); and — given Section 4.4's concrete bug — **a hard rule that any producer feeding a shared aggregator must emit that aggregator's expected shape**, enforced by type, not convention.

---

## 9. Recommended implementation slices (Section 29 — NOT started)

| Slice | Scope | Risk | Dependencies | Weight |
|---|---|---|---|---|
| **A. Device state authority consolidation** | Route all device-state readers through `deviceRuntimeStateService`; make it consult `deviceObservationPolicy.ts` instead of its own flat window; fix `loadHomeDeviceInventoryFacts`'s mixed timestamp chain | Medium — touches many call sites, but the target service already exists and is proven | None blocking | Large |
| **B. Devices-contributor freshness bug fix** | Narrow, surgical: make `loadHomeDeviceInventoryFacts` emit a real timestamp (or a valid sentinel) instead of a pre-classified bucket string, matching every other evidence loader's contract | Low — one function, one call site, clear existing pattern to copy | None | Small |
| **C. Camera/Edge health precedence decision + fix** | Decide and implement authoritative-source precedence between Edge-heartbeat and operator-entered camera health; add Edge-heartbeat staleness TTL | Medium — requires a genuine product decision (not just a code fix) before implementation can start | A design decision from the user/product owner | Medium |
| **D. Visitor/maintenance transition-safety** | Apply the proven `facilityAutomationService.ts` CAS pattern to `approveVisitor`/`denyVisitor`/`updateMaintenance`; consider migrating `maintenance_requests`'s untracked schema drift into a real migration | Low-Medium — the pattern is proven, but touches actor-facing write paths directly | None blocking | Medium |
| **E. Utility/current-meter semantics** | Decide whether to bridge `infrastructureEventIntelligenceService` into canonical signal ingress; decide whether "latest meter value" as current state is even a near-term goal given no meter-reading table exists at all | High uncertainty — this is closer to a new-feature decision than a convergence fix | A scoping decision from the user/product owner | Large (or descoped) |
| **F. Direct-read convergence** | Audit and align every "Is X currently true" conversation/API answer path to a single per-domain authority, closing the gap Section 26 found between capability-module entry points | Medium — cuts across many capability modules | Depends on A being done first for devices specifically | Large |

Recommended order if pursued: **B first** (small, safe, immediately stops a live silent bug), then **D** (proven pattern, contained blast radius), then **A** (the biggest architectural win, unlocks F), then **C** and **E** only after an explicit product decision on precedence/scope, then **F** last since it depends on A.

---

## 10. Newly discovered risks not in the original Slice 0 audit

1. **Edge node heartbeat has no server-side staleness threshold** — a silently-dead Edge box reports online forever (Section 3.1).
2. **Devices-contributor aggregate freshness is structurally stuck at `"unknown"`** due to a type-contract mismatch between one producer and one consumer of the same field (Section 4.4) — the single most concrete, highest-confidence bug found in this audit.
3. **`walletEvidence.ts` defaults to `"fresh"` (not `"unknown"`) when a timestamp is missing** — the wrong direction for a safety fallback, smaller severity than #2 but the same class of bug.
4. **Utility/infrastructure-derived awareness (power outage, generator, solar) structurally cannot reach canonical awareness** — it is produced exclusively via the legacy event bus, which nothing bridges into canonical signal ingress.
5. **Camera-health conflicts can propagate all the way into canonical incidents as two separate rows**, not merely as a read-time ambiguity — because two independent writers each submit their own canonical signal with no upstream reconciliation.
6. **`operational_incidents`'s evidence/affected_entities arrays have a read-modify-write race** distinct from (and in addition to) the already-known last-write-wins-on-status behavior.

---

## Cross-cutting observations

1. **The codebase already knows how to do this well** — `deviceRuntimeStateService`'s out-of-order protection and `facilityAutomationService.ts`'s CAS guards are both genuinely excellent, comment-documented, deliberate engineering. The gap everywhere else is not skill, it's that these patterns were never generalized to the domains that need them (visitor/maintenance races; camera/Edge health precedence).
2. **Freshness fragmentation is a symptom of organic growth, not a single bad decision** — five classifiers exist because five different features were built at five different times against the nearest convenient timestamp, not because anyone designed five competing systems on purpose.
3. **The one clear, unambiguous, low-risk fix available right now** is Section 4.4's devices-contributor bug — it is a one-function type-contract fix with an existing correct pattern to copy from six other evidence loaders in the same codebase.

---

## Audit artifact

This document: `docs/WAVE6_CURRENT_STATE_FRESHNESS_AUDIT.md`. Left untracked/uncommitted per this slice's explicit instruction.
