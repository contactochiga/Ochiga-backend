# Wave 6 Slice 14E — Camera operational-health transition authority

Date: 2026-09-24. Local implementation only; no production migration, push or deployment.

## Baselines and scope

Backend started on `main`, `057eea2e1ed86b82c263aca0ac0bd4ac1db1e365`; local `origin/main` is `909d5d0a35ab2de84c7cdc83d0f10be166e0b512` (10 ahead, 0 behind before this commit; no fetch). Edge remains clean at `d2715f1cef7d9291c0ec1cda546551d91e1d2562` and is read-only.

Unrelated tracked changes in `scripts/pilot-import.mjs` and `src/routes/me.routes.ts`, Aider files, pilot assets, prior audit/unrelated docs, opencode configuration and five LOCAL_TEST migrations are excluded. No reader, Edge producer, observation contract, current-state interpreter, physical execution or awareness implementation is changed.

## Producer inventory and narrowing

| Producer | Previous meaning source | Disposition |
|---|---|---|
| Edge stream-health route | `facility_cameras.status` before/after; error-text tamper/NVR heuristics | Compatibility CAS writes remain; independent operational signal and realtime status publication removed; heuristics removed. |
| Infrastructure operator writer | `camera_infrastructure.health_state` before/after | Display/history/audit remain. No operational transition or health realtime emission. Prior-status lookup removed. |
| Ambient `camera.status.updated` | Arbitrary registry/operator status payload | Suppressed before ambient Core ingress and socket delivery. |
| Provisioning `configured` | New configuration row | Separate `camera.binding.changed`; not health or recovery. |
| `submitCameraHealthCanonicalSignal` | Legacy status-string classifier | Operational submissions return null. Only distinct binding/security event classes remain supported. Classifier retained as dead compatibility utility; no live production caller. |
| Manual/legacy `camera_offline`-like event | Operator/provider event label, no accepted state comparison | Historical reports and existing maintenance notifications remain, but health labels cannot enter detection canonical ingress or ambient camera-event realtime as operational truth. |
| Typed camera detections/security | Actual detection/security event | Preserved; detection is not overall health. |
| New transition evaluator | Frozen CameraCurrentStateAuthority | Sole operational interpretation comparison; accepted checkpoint/outbox transaction precedes delivery. |

Before narrowing, both Edge and infrastructure writers could announce contradictory connectivity transitions and also reach ambient ingress. Their independent status comparisons no longer emit operational truth. Search covered helper names, camera.status.updated, connectivity_lost/restored, health_degraded, tamper_detected, recorder_failure, binding_changed and new event names. Remaining legacy literals are compatibility definitions, historical/workflow labels, reader descriptors or security/configuration types, not live operational-health producers.

## Ownership and acceptance

`runtime_observations` remains factual observation storage. Frozen `cameraCurrentStateAuthority.ts` interprets it. `health_transition_checkpoint` is **delivery bookkeeping, never a health read source**. No public endpoint exposes this service. The internal evaluator uses the existing trusted system actor to interpret complete canonical camera rows; it does not create a parallel permission model.

Migration: `supabase/migrations/20260924101810_wave6_camera_health_transition_outbox.sql`.

Exactly one nullable column, one dedicated table and one acceptance RPC are added:

```sql
public.oyi_accept_camera_health_transition(
  p_camera_id uuid,
  p_expected_camera jsonb,
  p_expected_edge jsonb,
  p_expected_checkpoint jsonb,
  p_evaluation jsonb
) returns jsonb
```

Checkpoint JSON: `revision`, accepted `overall`, `policy_revision`, `evaluated_at`, `evidence_revision`, `edge_revision`, bounded `summary`. Summary contains component labels, deterministic reasons, at most 16 observation references, scope fingerprint and policy key. It does not duplicate raw observations or store media/credentials. Reasons are capped at 32; exact full observation comparison still protects acceptance when explanatory references are truncated.

Policy revision is `camera-transition-v1/current-state-14d-v1`, not a Git SHA. Policy key also records effective Edge interval and configured AI interval. Changed interpreter/policy/scope reinitializes silently instead of comparing incompatible interpretations. Future interpreter changes must advance the policy revision deliberately.

### Locking, revisions and atomicity

The RPC takes a short SHARE lock on `edge_nodes`, locks the matched Edge row FOR SHARE, then the camera FOR UPDATE. The table lock covers concurrent creation of a previously absent Edge row without altering the frozen heartbeat RPC. This is deliberately conservative: it can briefly block heartbeat writers for **all nodes**, a scale/latency limitation to monitor. No network/provider work occurs inside the transaction.

It compares exact canonical identity/configuration/runtime JSON to the evaluated snapshot, exact Edge identity/observation with typed source/receipt timestamps, and the exact prior checkpoint. No arrival-time winner is used. Full JSON equality is authoritative for validation; MD5 fingerprints are compact references, not security decisions.

TypeScript supplies an acceptance deadline no more than one second after evaluation, shortened to the earliest camera/Edge freshness boundary or future-timestamp admissibility boundary. DB receipt cannot extend this deadline. Expired or stale evaluation returns a recompute outcome without writes. Evaluation time cannot regress behind the accepted checkpoint. Observation, Edge, scope and checkpoint changes cause rejection. TypeScript alone interprets raw facts and chooses transition meaning; SQL validates bounded shape, policy consistency and CAS.

Checkpoint update and outbox insertion are one transaction. Insert/constraint failures roll back both. Two evaluators against the same checkpoint have exactly one winner; the loser recomputes on a subsequent sweep.

### Outbox and identity

`camera_health_transition_outbox` stores transition ID, canonical camera/estate/Home, checkpoint revision, previous/current state, event type, policy revision, evaluation timestamp, bounded summary/evidence references, delivery state, attempts, claim token, lease, acknowledgement and bounded error code. Unique `(camera_id, checkpoint_revision)` plus primary transition ID prevents duplicate accepted transitions.

ID is `camera-health:<camera UUID>:<accepted checkpoint revision>`. It depends on the serialized accepted transition, not a delivery attempt or receipt timestamp. It becomes both canonical signal ID and provider event ID. There is no second factual camera-state table.

Payload: max 16 KiB; expected camera snapshot max 1 MiB; allowlisted component/summary/evidence keys; bounded reasons/references; no arbitrary diagnostics, URLs or image bytes. Invalid input rolls back. RPC is SECURITY INVOKER with empty search path; execution revoked from PUBLIC/anon/authenticated and granted only to service_role. Outbox RLS is enabled, all client privileges revoked; service_role receives select/insert/update. Existing server-authoritative camera/Edge RLS and revoked browser privileges remain unchanged.

## Transition policy

| Previous → current | Canonical event |
|---|---|
| uninitialized/unknown → healthy | None; initialization, not recovery |
| uninitialized/unknown → degraded | `camera.health.degraded`; first observed impairment, no claim of prior healthy state |
| uninitialized/unknown → unavailable | `camera.video.unavailable`; first observed acquisition unavailability |
| healthy → degraded | `camera.health.degraded` |
| healthy/degraded → unavailable | `camera.video.unavailable` |
| degraded/unavailable → healthy | `camera.video.restored` |
| unavailable → degraded | `camera.health.improved`; partial improvement, impairment remains |
| any → unknown | Silent checkpoint update; loss of knowledge is not failure |
| same overall | No event, even for frequent new frames/samples |

Unavailable means **observed video acquisition capability**, not electrical/network failure. Recovery does not claim physical reconnection. Component reasons retain inference, frame, stream/control and Edge telemetry impairment. Frame latest-attempt/last-success handling is exclusively the frozen interpreter's. AI failure plus fresh video becomes degradation, never independent offline logic. Edge expiry alone creates no camera failure; camera observations age normally.

Inherited limit: unscheduled ONVIF/TCP evidence has unspecified freshness under 14D and does not independently force current degradation. 14D's explicit test-policy scheduled probe demonstrates control failure + fresh video → degraded; this production transition layer deliberately does not invent a probe TTL. No frozen semantics were changed to force a test outcome.

## Evaluation, delivery and crash behavior

Dedicated worker process starts `cameraHealthTransitionWorker`. A non-overlapping 30-second bounded keyset sweep evaluates up to 100 cameras, then attempts up to 25 outbox deliveries. `CAMERA_HEALTH_TRANSITIONS_ENABLED=false` disables it. Evaluation is not performed on read requests and never polls Edge/providers. Sweeping covers new observations, Edge evidence/time changes, assignments/configuration and pure expiry. Evaluation errors cannot stop delivery of already accepted obligations. Per-row RPC failures do not permanently starve later camera pages.

Sweep coalescing is intentional: intermediate states overwritten before evaluation are not an observation journal and are not claimed as accepted transitions. Expiry advances the checkpoint to unknown silently; a later initial healthy observation then is not misreported as recovery.

Consequently, an older impaired incident followed by expiry → unknown → healthy is not automatically resolved by a fabricated recovery signal. Its downstream lifecycle may require separate review. This slice intentionally does not infer continuity across missing knowledge or change incident resolution policy.

Delivery uses optimistic atomic UPDATE claims (transition ID, updated_at, attempt_count), unique claim tokens and 60-second leases. A later transition for the same camera waits for earlier materialization; blocked rows are delayed to avoid continuously occupying the first page. Restart recovers expired claims. Failures retain a durable retryable row with bounded `materialization_unconfirmed`, not arbitrary provider error text.

Acknowledgement requires persisted canonical signal **and signal-specific awareness and incident evidence**. Neither a returned envelope nor a duplicate signal row alone suffices. The normal real-Core fixture path additionally produces recommendations and insights; production acknowledgement does not claim to prove every optional downstream artifact or external side effect.

Proof lookups use existing indexed canonical_signal_key, awareness_key and the awareness row's incident primary key, with signal-specific evidence validation. They do not scan the entire historical evidence store. These identity conventions are tested against real canonical ingress, not a separately invented acknowledgement model.

Guarantee: durable accepted obligation, at-least-once attempts, stable idempotent canonical identity, conservative verified acknowledgement. **Not exactly-once downstream processing or realtime delivery.** A crash after successful materialization and before acknowledgement retries the same identity, verifies existing artifacts and acknowledges without creating a new factual transition.

Known downstream limitation: Core persists its signal before its bundle, and duplicate ingress does not repair a missing bundle. Such an obligation remains retryable/unacknowledged and blocks later transitions for that camera; operational repair of frozen Core may be needed. The row is not lost or falsely marked delivered. Scope changes similarly retain an unacknowledged obligation rather than delivering under a broader/new audience. Automatic repair/cancellation is not implemented.

## Awareness, incidents, privacy and transports

The existing canonical ingress is used unchanged. Real-Core fixture persistence proves healthy → degraded → unavailable → healthy yields one correlated incident, open → open → resolved, plus signal-specific awareness, recommendations and insights. Generic incident CAS remains unchanged; unrelated producers can still race in that frozen subsystem. Per-camera ordered delivery limits this worker's own sequencing races but is not a generic incident fix.

Signal carries canonical camera entity/estate/Home/privacy scope, previous/current overall state, stable transition ID, policy, reasons and evidence references. It excludes media, credentials and URLs. Before delivery, canonical identity is reloaded and scope/Office allowlist fingerprint checked. Canonical awareness readers still apply canonical camera policy; realtime uses the 14A camera audience filter. No private camera event becomes an estate-room broadcast.

Accepted transitions alone publish `camera.health.transition` with ambient ingress skipped. Legacy operational `camera.status.updated` is disabled, not a second projection. No new legacy automation/event-bus health transport is introduced. Existing historical/manual reports and typed security/configuration events are distinct, not factual overall-health comparisons. Facility/Consumer/Twin/conversation/report readers are not migrated; legacy read descriptors can remain until 14F.

## Validation and performance

Real isolated local PostgreSQL tests cover service-role ACLs, silent initialization, concurrent evaluator CAS, observation/Edge/scope mismatches, time-only expiry, bounded sanitized payloads, rollback on forced outbox failure, pending-row survival, concurrent claims, lease recovery and repeated healthy checkpoint updates without outbox growth. Disposable test databases only; no production/local shared application rows changed.

Functional tests use real frozen interpretation and real canonical ingress against accurate fixture persistence: transition matrix, policy rebaseline, inference/stream impairment, latest frame failure, expiry/return, deadline boundary, stable signal identity, sequential incident evolution, crash-after-submission recovery, signal-only partial write and failed-submission retry. Mocks honor selected columns/tenant filters. SQL guarantees are tested with PostgreSQL, not inferred from these mocks.

1/10/50/100-camera evaluation: one camera read, zero or one batched Edge read, one serialized acceptance RPC per camera. No per-camera history scan, provider call or Edge polling. Delivery is bounded but performs per-transition claim/proof/scope queries (max 25 normally), not a bulk acknowledgement shortcut. Repeated healthy evidence generates no signal storm. This is bounded query-count proof, not a production latency/load benchmark. Table-level Edge locking, per-camera checkpoint writes and append-only delivered outbox retention require operational monitoring; retention/deletion policy is not added here.

Regression results: typecheck/build passed; Slice 14A (15 groups), 14B authority (16 groups) and SQL (10), 14C Backend and SQL (10), 14D (78 assertions plus guards), canonical signal ingress, awareness V3, camera intelligence, security adversarial, representative Slice 13 device authority (31 assertions), representative Wave 5 physical authority, and Edge 14C compatibility all passed with normal process exits. No environment-only or known unrelated failures were observed in this requested run. Old camera tests were updated only where they expected the intentionally retired legacy operational path; security/detection and privacy audience assertions remain.

## Rollout and compatibility

1. Apply this additive migration after 14B/14C migrations. Existing rows have null checkpoint; old Backend can continue compatibility writes without knowing the new column/table.
2. Deploy narrowed Backend API and worker code with transition worker disabled while old producer processes are drained. Mixed old/new producers cannot provide the single-authority guarantee.
3. Enable the new dedicated worker after all old operational producers are stopped. New Backend requires the migration; there is no fallback to legacy health strings if it is missing.
4. Verify CAS rejection counts, pending age, leases, materialization proof, scope failures and lock latency. Existing latest observations initialize truthfully; no invented backfill or restoration.

Edge is wire-compatible and unchanged. Rolling back to old operational producers ends the convergence guarantee; do not concurrently run those with the new transition worker. No deployment performed in this task.

## Completion decision

Intended files in the local commit:

- `docs/WAVE6_SLICE14E_CAMERA_HEALTH_SIGNAL_CONVERGENCE.md`
- `supabase/migrations/20260924101810_wave6_camera_health_transition_outbox.sql`
- `src/modules/cameras/cameraHealthTransition.service.ts`
- `src/workers/cameraHealthTransitionWorker.ts`
- `src/worker.ts`
- `src/routes/edgeDiscovery.ts`
- `src/services/platformGapService.ts`
- `src/realtime/emitSignal.ts`
- `src/oyi-core/domains/camera/cameraCanonicalSignal.ts`
- `src/controllers/cameraIntelController.ts` (explanatory comment only)
- `scripts/wave6-slice14e-camera-transition-smoke.mjs`
- `scripts/wave6-slice14e-camera-transition-sql-smoke.mjs`
- `scripts/wave6-slice14a-camera-privacy-smoke.mjs`
- `scripts/oyi-camera-intelligence-convergence-smoke.mjs`
- `package.json`

One accepted operational-health transition path is established. WRITE/MEANING can be frozen within the documented delivery guarantees and inherited evidence limits; reader convergence may proceed as a separate authorized slice. This does not claim production rollout, exactly-once Core side effects, automatic partial-bundle repair, or universal physical camera connectivity knowledge. Camera infrastructure retirement, reader migration, incident CAS and Wave 7 remain untouched.

The containing local commit records the implementation and this report; use `git log -1 --format=%H -- docs/WAVE6_SLICE14E_CAMERA_HEALTH_SIGNAL_CONVERGENCE.md` for its SHA without a self-referential commit hash in the file.
