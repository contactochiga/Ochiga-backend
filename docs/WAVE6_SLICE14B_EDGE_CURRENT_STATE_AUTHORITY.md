# Wave 6 Slice 14B — Edge current-state authority

Local implementation/validation: 2026-09-24. No push, deployment, production migration, or Edge modification.

## Baseline and scope

Backend main started at `a4852f1a383e1a4ecb9acbf3b04061a4d3967ad9`; local origin/main `909d5d0a35ab2de84c7cdc83d0f10be166e0b512`; ahead 7, behind 0. Edge main/origin/main `5d30b63866197d6b674951bfdce2dd1211e76d24`, clean. No fetch performed.

Unrelated work excluded: `scripts/pilot-import.mjs`, `src/routes/me.routes.ts`, Aider files/cache, `docs/OYI_DIGITAL_TWIN_ASSET_CONTRACT.md`, prior untracked `docs/WAVE6_CAMERA_EDGE_HEALTH_AUTHORITY_AUDIT.md`, `opencode.json`, pilot/luna-residences, five 20260905 LOCAL_TEST migrations. No resets/stashes/cleanup. Frozen device, execution, awareness, camera privacy/health implementations untouched.

## Wire, timing, and pre-fix defect

Edge `agent.js` heartbeat scheduler creates `site_id`, `agent_id`, `status`, `ts`, `outbox_depth`, `queue_depth`, `camera_count`, `device_count`, `sync_status`, `error_count`, `runtime_version`, `local_runtime_host`. HTTP transport uses the existing bound Edge credential. Failed deliveries retain original payload/ts in durable outbox; live traffic can overtake queued traffic. Default heartbeat 30 seconds, configurable locally/remotely; queue flush 5 seconds; HTTP timeout 10 seconds; exponential retry 2–60 seconds. No jitter. There is no acknowledgement of the agent's effective heartbeat interval. Counts are inventory, not health. Error count reflects retained error keys, not a precise current-fault inventory.

Old route called `upsertEdgeNode` (receipt-time last_seen/status) then independently inserted history. Recovery reproduction showed T1 degraded, T2 online, replay T1 at T3 replacing T2 and refreshing last_seen to T3. History failure could leave projection advanced. Registration/discovery could also refresh apparent health without a heartbeat.

## Schema audit and transactional ingestion

Existing schema: `20260522085935_edge_pilot_onboarding_foundation_20260522_fixed.sql`, with subsequent security hardening. edge_nodes has UUID primary key, unique (estate_id, edge_node_id), estate FK, registry/configuration plus legacy status/time/queue/sync/error mirrors. edge_heartbeats has UUID primary key, estate FK, node text, payload summaries, metadata, received_at/created_at and receipt-time indexes. Neither had a dedicated source timestamp/current observation boundary. Runtime phase 1 hardening enables RLS and removes public/client table access; Backend service-role access is retained.

Migration: `20260924090934_wave6_edge_current_state_atomic_ingestion.sql`.

RPC: `public.oyi_ingest_edge_heartbeat(p_estate_id uuid, p_edge_node_id text, p_heartbeat jsonb, p_expected_interval_ms integer default 30000) returns jsonb`.

Only four additive nullable columns: node heartbeat_observed_at, heartbeat_received_at, heartbeat_observation JSONB; history observed_at. No new table or destructive change. A partial unique history index on estate/node/observed_at applies only to timestamped rows. Existing rows stay null/unknown: no receipt-time backfill pretending to be observation time.

The function inserts missing node identity conflict-safely, locks its unique row `FOR UPDATE`, inserts history, conditionally updates latest projection, and returns the disposition. Concurrent first inserts serialize on the identity unique constraint; subsequent updates serialize on the row lock. Latest means strictly greater source timestamp. Same timestamp is first-write-wins (even conflicting duplicates); no repeated history or timestamp refresh. Older observations remain history with accepted_latest=false. The original accepted history flag describes acceptance at ingestion, not an everlasting latest marker.

observed_at = original Edge ts; received_at = database clock_timestamp at RPC entry. Receipt can precede lock acquisition/commit and is not source ordering. Both appear in node projection and history. Exceptions are not swallowed: history failure, projection failure, and initial node creation all roll back within the caller transaction. No fallback non-atomic writes.

SECURITY INVOKER with empty search_path and qualified objects. EXECUTE revoked from PUBLIC, anon, authenticated; granted only to service_role. Existing trusted database owner remains an administrative authority. No client authority escalation. Backend derives estate/node from authenticated bound credentials, rejects payload aliases mismatching that identity, and refuses legacy unbound tokens for authoritative heartbeat ingestion. RPC repeats primary identity checks; trusted service args are authoritative. Source timestamps require timezone, finite value, and at most ten seconds future lead; SQL independently repeats validation. Invalid observations fail 400, identity failures 403, persistence failures 503, not success/202. Existing agent outbox retry behavior is retained.

## Authority and state

`src/services/edgeCurrentStateAuthority.ts` is the sole generic Backend interpretation. Contract includes nodeId, estateId, connectivity, freshness, observedAt, receivedAt, ageMs, lastKnownStatus, runtimeVersion, queueHealth, syncHealth, errorState, source, reason, and explicit freshness policy.

Healthy fresh report with clear queue/synced/no reported errors => healthy. Queue backlog, reported errors, or abnormal sync => degraded with raw components preserved. Agent-reported offline/unavailable remains an explicit report. Unknown status remains unknown. Old healthy reports are not rewritten to offline.

For expected interval H: fresh through 3H+10s; stale through max(6H,120s)+10s; then expired. At default H=30s, fresh <=100s, stale <=190s, expired >190s. Three heartbeat opportunities tolerate intermittent loss; expiry allows six opportunities/two capped retries plus default HTTP budget. Stale knowledge maps degraded; expired telemetry unavailable; never observed unknown. These are telemetry tolerances, not physical failure detection. Configurable H is the Backend expectation captured at ingestion, explicitly NOT proof the agent applied configuration. Custom agent timeout/backoff settings are not transmitted. Ten-second future allowance tolerates modest clock lead; larger skew rejected rather than refreshing indefinitely. No complex distributed-clock claim.

No cache, network polling, scheduler, or read-side writes. Cold restart reloads persistent observation and recomputes age. Repeated reads agree at the same time. A future Camera authority can consume estate-scoped Edge knowledge, but this slice never interprets camera state.

## Persistence and consumer inventory

| Path/store | Classification and outcome |
|---|---|
| edge_nodes identity/name/estate/node/config/host/capabilities | Identity/configuration; retained |
| Dedicated heartbeat columns | Latest accepted observation; interpreted only by authority |
| Legacy heartbeat_status/last_seen/queue/sync/version | Compatibility mirrors, not independent current truth |
| edge_heartbeats | Honest observation history; latest authority does not query history |
| registration/discovery upsert | Configuration/inventory only; no health refresh |
| Facility infrastructure node/provider/telemetry presentation | Canonical state, source time, components/reason; unknown not provider_error |
| Onboarding discovery gate and provider catalog | One batched authority read; fresh healthy required |
| Camera discovery command node lookup | Existence/config/permission only; selected legacy status unused, not a health decision |
| Office export edge_heartbeats/count | Historical records/count, not currently-online inventory |
| platformGap edge_node_history | Operator history, not authenticated heartbeat; labeled/subscribed as history |
| Camera controller edge_nodes count | Assignment inventory, not operational health |

Broad source searches for edge_nodes, edge_heartbeats, heartbeat_status, Edge online/offline, edge_node_history and heartbeat emissions found no remaining generic Backend current-state reader using raw permanent heartbeat mirrors. Facility list remains bounded at 100; helper at 1000, with one query and no history hydration. No claim of unlimited inventory pagination.

## Signals, privacy, and camera separation

Only newly accepted, currently fresh heartbeats emit source-timestamped realtime observation. Duplicate, older, delayed/expired or failed persistence emits none. Heartbeat uses existing emitSignalSafely skipCanonicalIngress: post-transaction concurrent responses are not ordered transitions and must not manufacture ambient recovery/incidents. No canonical awareness implementation changed. Operator history uses edge.history.recorded, not edge.heartbeat. Per-heartbeat generic audit emission is replaced by the atomic durable heartbeat journal; identity-rejection auditing remains. Camera signal paths are unchanged.

Realtime observation consumers must use source timestamp or re-read canonical state; no claim of transactional realtime delivery. No new expiry transition publisher or signal outbox. This is deliberate narrowing of untrustworthy ambient heartbeat transition semantics, not Camera signal convergence.

Expired Edge knowledge never updates facility_cameras/camera_infrastructure, creates camera incidents, or emits camera-health signals. Scope and assignment protections from Slice 14A remain intact.

## Validation

- Typecheck/build pass.
- Dedicated authority suite: 16 groups, normal exit 0. Fresh/degraded/stale/expired/unknown, custom cadence, timestamp distinction, replay suppression, cold restart, future skew, actor binding, persistence failure, Facility presentation, onboarding readiness. Selected-column-aware mocks preserve estate relationships. Provider catalog test isolates optional adapter installation, not Edge truth.
- Dedicated real PostgreSQL suite: 10 groups, normal exit 0. Invoker/ACL/service-role proof; older replay; duplicate; concurrent first/new/old/duplicate maximum timestamp; forced overlapping transactions blocking on node lock; injected history and projection failures proving rollback; invalid timestamps/tenant mismatch; old-writer mirror isolation; unchanged camera sentinel rows.
- SQL ran in uniquely named disposable databases built from repository Edge schema using local Docker PostgreSQL 17.6; no shared/production schema changed. Existing local DB lacks Edge tables. Local security advisors reported no error-level issues on the shared local DB, NOT certification of the migrated fixture; fixture ACL tests provide migration-specific proof.
- 1/10/50/100-node authority lists: exactly one scoped query, zero provider/Edge polling. SQL tests use real concurrency, not mocked ordering. No throughput benchmark claimed.
- Passed with normal process exit: Slice14A (15 groups), Slice1 (24), Slice1B (53), camera intelligence convergence, canonical signal ingress, awareness V3, security adversarial, Consumer context, Facility spatial context, Slice13 device authority (31), Slice13C (149), Wave5 Slice1 physical authority, camera active-context, camera runtime Phase1, full-domain architecture.
- Additional existing infrastructure-onboarding smoke: BLOCKED at Supabase Management API login-role request (`connect: no route to host`). Script unchanged from HEAD; this is remote integration access failure, not a passed assertion or claimed missing-service-key failure. Local new onboarding readiness test passes. No live hardware QA or production migration acceptance claimed.
- Nonblocking Node punycode deprecation warning in existing Slice13C suite. No known new assertion failure remains.

## Rollout compatibility and order (NOT executed)

1. Review deployed schema/migration inventory and existing RLS/service grants; back up normally. Do not apply unrelated LOCAL_TEST migrations. Confirm per-node bound credentials and Backend expected interval.
2. Apply this additive migration through normal production workflow BEFORE new Backend. Test RPC service access/client denial and schema cache availability. Index/table lock duration depends on history size; schedule appropriately.
3. Drain/quiesce old heartbeat handlers and deploy new Backend consistently. Old binaries remain schema-compatible but still have receipt-time semantics and cannot populate new observation columns. They cannot overwrite dedicated authority columns, but a mixed fleet is NOT fully converged and must not be treated as such.
4. Resume ingestion. Observe fresh timestamped heartbeat and verify history/projection/source time plus replay/tenant-denial checks using safe fixtures. Previously existing nodes honestly remain unknown until observed by new ingestion.
5. Verify Facility/Admin/onboarding consumers. No Edge release needed. No camera mutation expected.
6. If reverting Backend, retain additive schema/data; old read behavior is not authority-safe. Rollback availability is not a claim of preserving convergence. Never drop columns/history to roll back application code.

## Conclusion / limitations

One Backend Edge current-state authority exists and local acceptance supports freezing its contract. Production convergence remains conditional on the above rollout and operational verification, which were not authorized here. History retention remains existing/unbounded; no new retention infrastructure. Agent interval acknowledgement and active-vs-historical error detail are wire limitations, explicitly exposed/conservatively handled. Remote onboarding integration remains unexecuted. Camera Observation Contract may be considered next; no Camera implementation started. Final commit SHA is recorded by Git and the completion report, not self-embedded in this file.
