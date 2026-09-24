# Wave 6 Slice 14F — Camera current-state reader convergence

2026-09-24. Local Backend implementation. No push, deployment, new migration, Edge modification, or UI redesign.

## 1. Baselines and protected work

Backend main started at `8181f9d71011205b4be336fd3f2972e543d85496`; local `origin/main` was `909d5d0a35ab2de84c7cdc83d0f10be166e0b512` (11 ahead, 0 behind). No remote fetch. The post-implementation SHA is the single commit containing this record (also reported in the task completion).

Edge `/Users/ochigaidoko/oyi-edge-agent` remains on `main` at `d2715f1cef7d9291c0ec1cda546551d91e1d2562`, clean and unchanged; local `origin/main` is `5d30b63866197d6b674951bfdce2dd1211e76d24` (1 ahead, 0 behind). Its observation compatibility smoke was run; no source or dependency changes.

Unrelated tracked changes in `scripts/pilot-import.mjs` and `src/routes/me.routes.ts` were preserved and excluded. Existing Aider files/cache, `opencode.json`, pilot Luna content, Digital Twin asset-contract doc, original Camera/Edge audit doc and five `20260905*_LOCAL_TEST*` migrations remain unrelated/untracked. No blanket staging, reset, stash or clean.

## 2. Frozen interpretation and read contract

`CameraCurrentStateAuthority` is unchanged. It consumes canonical identity/configuration plus `runtime_observations` and batched `EdgeCurrentStateAuthority` input. It does not read the transition checkpoint, infrastructure health, legacy registry health, media history or providers to establish current truth.

Readers consume `overall`, `videoEvidence`, component state/freshness/reasons, component observation and last-success provenance, informational `observedAt`, `sources`, and Edge telemetry state. Full operational projections preserve the authority result. Resident projections retain overall/video meaning, component state/freshness/reason/observed times and last-success time, but omit raw evidence details, observation identifiers, received timestamps and operational configuration details. Same interpretation does not grant the same detail or visibility.

Vocabulary remains **healthy / degraded / unavailable / unknown**. Healthy means recent bounded image-signature-valid acquisition with no interpreted impairment. It does not prove decoded/advancing frames, continuous playback, recording or electrical/network connectivity. Unavailable means the authority's observed acquisition-capability failure, not physical offline. Missing/expired evidence is unknown, never synthetic failure. Each component retains its own freshness; the maximum timestamp is informational, not a global freshness clock.

The frozen interpreter's default unscheduled ONVIF/TCP and on-demand/media-capture windows are unspecified. Readers do not invent TTLs. In particular, an unscheduled ONVIF failure alone does not force degradation; 14D's explicitly scheduled test policy demonstrates that scenario without changing production semantics. Recorder/channel health remains unknown because the observation contract cannot establish it.

## 3. Shared presentation boundary

`src/modules/cameras/cameraCurrentStatePresentation.ts` implements presentation, not interpretation. It policy-filters canonical candidates, batches IDs by estate in groups of at most 100, then invokes the frozen authority with a shared read clock. Authority denial/missing rows are omitted; errors never fall back to registry health. Duplicate IDs are deduplicated before resolution. No writes, cache, history lookup, provider calls or Edge polling.

It emits an explicit identity/configuration allowlist and canonical `current_state`. Compatibility `status` and `health_status` are the canonical overall; `stream_status` is the interpreted stream component. `health.online` is nullable for unknown and otherwise describes recent acquisition evidence, not electrical connectivity. Legacy timestamps/errors/checkpoint/raw observations are not copied as competing truth. Media configuration capabilities say configured/unknown, not live video available. Detection configuration remains configuration.

`cameraStateCounts` separates healthy, degraded, unavailable and unknown. `cameraStateExplanation` explains acquisition failure, inference/control impairment and missing telemetry without saying physically offline. It does not promote an unspecified/stale component failure into a fresh claim.

## 4. Reader ownership/inventory matrix

Searches covered table names (including indirect `selectRows`/generic loader configurations), legacy field names, `canonicalCameraHealth`, semantic online/offline/healthy/degraded/stream claims, helper mappers, shared Camera Core, and infrastructure status. The 19 source files referencing the camera registry/infrastructure were traced together with indirect presentation consumers. Archived `.bak` files are not executable readers.

| Surface / endpoint or function | Previous source / fact | Final source / classification | Privacy / freshness |
|---|---|---|---|
| Facility `/cameras/estate/:estateId`, `listByEstate` | Registry + legacy normalizer | Shared authority presentation; CANONICAL_CURRENT_STATE | Existing membership + canonical camera policy; component clocks |
| Consumer `/cameras/home/:homeId`, `listByHome` | Registry + legacy normalizer | Authority, reduced resident detail; explicit requested-Home narrowing | Existing actor/Home gate plus canonical policy |
| Camera Center `inventoryByEstate` | Registry health-string counts | Authority camera list + four canonical counts | Same policy; no unknown-to-offline collapse |
| Bind/import response mappers | Legacy normalizer after provisioning | Authority presentation only; provisioning writes unchanged | Canonical policy; configured never implies healthy |
| `validateStream` | RTSP/credential + HLS configuration called healthy | Canonical current state separately from configuration checks | No new probe; media authorization unchanged |
| `cameraIntelController.getPlaybackUrl` | Registry stream status; configured HLS called available | Authorized media contract + reduced canonical state | Existing camera policy and token mechanism |
| `cameraPlayback.service` | HLS presence/legacy status | SPECIALIZED_COMPONENT configuration contract; supplied canonical stream component, otherwise unknown | URL/token/TTL/playlist/segment behavior unchanged |
| Spatial Home context `boundedCameras` | Registry + legacy normalizer | Canonical authority, existing Home relationships preserved | `cameras.view`, Home filter, canonical policy |
| Twin/infrastructure `platformGapService.cameraInfrastructure` | `camera_infrastructure.health_state` | Join canonical camera ID → authority; placement/zone/ownership relationship retained | Membership-resolved context + canonical scope; orphan/private denied |
| Oyi `commandRouter` camera module | Registry status/health | Canonical camera entities and reasons | Existing module/surface permission and source-camera policy |
| Oyi exact target `genericExactLoader(camera)` | Reduced row/status, missing privacy inputs, obsolete `dvr_id` | Shared policy select + authority hydration + reduced projection | Membership-aware actor/context; canonical camera and target scope checks |
| Oyi `objectStateLine`, spatial impairment answer | Generic status / infrastructure string regex | Canonical explanation and canonical overall only | Already-authorized hydrated object/relationships |
| Canonical Camera Core package | Independent online/offline/error classifier | Version `6.0.0-canonical-current-state`; accepts canonical result only | No permission grant; no legacy status inference; missing contract → unknown |
| Current Camera Center snapshot/report counts | Online/offline strings | Four canonical counts; compatible aliases documented below | Filter before aggregation |
| Office export `groupBuildings` | `live_cameras` counted camera-like **device inventory names** | IDENTITY_CONFIGURATION: explicit configured-device count; live count unknown (`null`) | No new camera/private-data authority granted to shared export credential |
| Camera event/detection/security reports | Event/media/detection history | HISTORY; unchanged, not current-state claims | Existing source-camera filtering before aggregation |
| `/intelligence/*`, executive/awareness summaries | Canonical awareness/event evidence | HISTORY / canonical awareness; frozen, unchanged | Existing canonical awareness privacy |
| Super-admin estate summary | ID/name/IP/created camera inventory | IDENTITY_CONFIGURATION, no current-health claim | Existing administrative boundary |
| Edge registry / camera-observation-registry | Assignment, external stream ID, disabled flag | IDENTITY_CONFIGURATION; unchanged | Existing Edge tenant/assignment boundary |
| Realtime | 14E accepted operational transitions | TRANSITION_WRITE/event transport, unchanged | 14A audience; event delivery is not a new current-state clock |

No new Office/global camera-health export was introduced: that endpoint has no authenticated camera actor or canonical building-camera association. Naming devices like cameras cannot justify a live camera count. Its old `live_cameras` is now explicitly unknown, not silently renamed to conceal a runtime classifier. The true inventory count is retained as `configured_camera_devices`. Authorized current snapshots are supplied by Camera Center; historical security reports remain historical.

Realtime subscribers in this repository are an interface, not an executable frontend subscription implementation. Accepted 14E events retain their event/provenance meaning; they do not refresh current evidence by arrival time. Camera Core no longer converts raw legacy health messages into current online/offline truth. Downstream subscribers should refresh the authorized current-state endpoint when invalidated; this task does not certify generated external frontend consumers.

## 5. Remaining occurrence classification

| Source family / occurrences | Classification and disposition |
|---|---|
| `cameraCurrentStateAuthority`, new presentation adapter | CANONICAL_CURRENT_STATE; the only generic interpretation/presentation path |
| `cameraHealth.ts` definitions | DEAD / RETIREMENT_CANDIDATE; deprecated, retained. Search found no live caller; only self-call and historical comment |
| `edgeDiscovery` upsert/discovery/provisioning `status`, `health_status`, `stream_status` | IDENTITY_CONFIGURATION or legacy compatibility writer; unchanged |
| `edgeDiscovery` stream-health timestamp/error updates | TRANSITION_WRITE/DIAGNOSTIC compatibility ingestion; frozen 14C/14E behavior, not a reader |
| `cameraMedia.service` capture-time/metadata updates | Observation/legacy compatibility write; media record status is SPECIALIZED_COMPONENT storage/retention, not camera health |
| `cameraHealthTransition.service` checkpoint/outbox/delivery | TRANSITION_WRITE; never read as camera current state |
| `platformGapService.upsertCameraInfrastructure` + `camera_health_history` | Retained operator declaration/write acknowledgement + HISTORY. Not an operational health interpreter. The GET presentation no longer trusts this health string |
| `infrastructure-onboarding/service` camera selects/upserts | IDENTITY_CONFIGURATION, duplicate resolution/provisioning acknowledgement; no generic operational read |
| `cameraAudience.service`, `permissionEngine`, `canonicalAwarenessReadService` camera lookups | IDENTITY_CONFIGURATION authorization inputs only; unchanged |
| `cameraMediaController`, `cameraDetectionController`, media/detection services | Scope/assignment authorization + HISTORY/SPECIALIZED_COMPONENT; unchanged |
| `cameraStreamController` | SPECIALIZED_COMPONENT HTTP/media transport failures + canonical media authorization; not a camera overall classifier |
| `cameraDvr.service` and DVR controller test/history | SPECIALIZED_COMPONENT one-shot TCP/configuration; no continuous recorder/channel health invented |
| `cameraGateway` discovery availability and last_seen | IDENTITY_CONFIGURATION / historical discovery evidence; not current camera operational state |
| Prediction engine camera-event regex / workflows | HISTORY/event classification; explicitly refers to recent events, not registry current truth |
| `cameraCanonicalSignal` legacy vocabulary | Frozen event classification/configuration/security and 14E accepted transitions; no reader change |
| Camera Core transport/media/detection helpers | Media/event specialized contracts; only current-state normalization changed |
| `.status` on requests/HTTP, commands, discovery jobs, storage media | DIAGNOSTIC / IDENTITY_CONFIGURATION / SPECIALIZED_COMPONENT; not camera-health bypasses |

Legacy `last_seen_at`, `last_health_check_at`, `last_success_at`, `last_failure_at`, `provider_error`, `frame_freshness_at`, registry `status/health_status/stream_status`, and infrastructure health no longer independently determine generic current health in live Backend/package readers. Their retained writes/history/configuration roles were not cosmetically migrated.

## 6. Cross-surface failure matrix

All migrated readers use the same interpreter; operational detail can differ by authorized projection.

| Case | Frozen evidence | Reader result |
|---|---|---|
| A | Fresh scheduled acquisition, healthy Edge, no impairment | healthy |
| B | Fresh acquisition + failed inference sample | degraded; acquisition retained, no physical-offline claim |
| C | ONVIF failure + fresh acquisition | degraded only with justified scheduled-probe policy; default unscheduled probe is unspecified and does not force degradation |
| D | Expired Edge + old acquisition | unknown; telemetry unavailable, not physical camera failure |
| E | Expired Edge + fresh accepted acquisition | degraded; current acquisition evidence retained |
| F | Fresh failed acquisition, no fresh latest successful path | unavailable |
| G | Configured stream only | unknown |
| H | Never observed | unknown |
| I | Registry online + authority acquisition failure | unavailable |
| J | Registry/infrastructure offline + fresh healthy evidence | healthy |

Frame last success remains independently explainable; it does not override a newer failed attempt. Receipt/replay order is not interpreted here: component evidence and timestamps are copied from the frozen authority. 14C/14D regressions prove accepted projection ordering and source-time behavior.

Compatibility counts: `healthy_streams = healthy_count`; legacy `offline_streams = unavailable_count` describes acquisition unavailability, **not electrical offline**, and excludes unknown/degraded. New consumers should use the four explicit counts. Stream component `inspected` is not decoded-video proof.

Camera Core's new `hasRecentCameraAcquisition` returns true/false/null from the canonical `videoEvidence` enum. Deprecated `isCameraOnline` / `isCameraStreamHealthy` are aliases with that explicitly limited meaning, not independent classifiers. Unknown returns null; an AI-only degradation does not erase affirmative acquisition evidence.

## 7. Privacy and media

No camera policy changes. Actual policy matrix tested for Home A/B, common/private and cross-estate cameras, resident, facility_manager, estate_admin, security, security_operator, ochiga_admin and admin. Literal aliases `security_operator` / `ochiga_admin` do not receive invented privileges. Existing admin/system_admin exception remains existing policy, not new broadening. Home-private cameras remain Home-bound even for normal operational roles. Orphan infrastructure rows fail closed; no fallback to their online/offline string.

Full canonical scope (`id,estate_id,home_id,privacy_scope,metadata`) is preserved for authorization. Authority re-fetches its complete input projection. Resident output excludes credentials, raw observations, checkpoints, diagnostic detail, device IP/provider config and raw media URLs. Authorized media URLs are still obtained through the existing playback access flow.

Playlist, segment, snapshot, media, detection, token binding, invalid/expired token, notification and realtime audience tests remain passing in 14A. Only playback **metadata** changed: configured HLS is not called operationally available. No token lifetime/algorithm/resource authorization, media ingestion, notification recipient or realtime producer changes.

## 8. Performance and test quality

Dedicated 14F fixtures honor selected fields and tenant relationships, reject unexpected writes/provider/history queries, and execute real list/Home/inventory handlers, Oyi module summary and exact-target hydration. They compare states and resident/rich projections for A–J, test actual canonical role outcomes and verify 1/10/50/100-camera batches. Camera Center inventory stays bounded (at most five reads including membership/inventory). Adapter: one canonical camera query + one Edge query per estate/100-ID batch; no new cache or read-time polling.

Additional actual Twin/Home path tests in Facility spatial smoke cover healthy, inference degradation, failed acquisition, expired and absent evidence despite conflicting registry offline. Infrastructure tests in 14A cover conflicting operator health, orphan privacy and 10/50/100 records: **eight total queries at each size**, including existing context resolution, two canonical-camera reads and one Edge batch. There is no history N+1; existing infrastructure history read remains one bounded query. These are functional/query-count tests, not production latency benchmarks or real-camera QA.

Projection-aware updates to old 14A, Slice1B and Spatial fixtures add newly required selected columns/Edge table instead of weakening assertions. The new test initially opened imported queue sockets; it now uses the existing `device-read-smoke-isolation` dependency boundary, forbidding queue submissions. No forced success exit or application runtime modification. Assertions **and normal process exit** pass.

## 9. Validation results

Backend `npm run typecheck`, `npm run build`, and separate Camera Core TypeScript no-emit check pass. `git diff --check` passes.

Passing Backend scripts (normal exit 0):

- Slice14A camera privacy (16 groups, including new infrastructure read checks).
- Slice14B Edge current state.
- Slice14C observation contract.
- Slice14D camera current state.
- Slice14E transition functional.
- Slice14E real PostgreSQL (7 groups: ACL, CAS/concurrency, revision races, rollback, claim/retry and durable crash windows).
- New Slice14F reader smoke.
- Canonical signal ingress; awareness V3; camera intelligence convergence.
- Security adversarial; Consumer context resolution; Facility spatial context.
- Slice13 device current-state authority; Wave5 Slice1 physical execution authority.
- Camera Core Phase2; camera runtime Phase1; camera active context; media Phase4; detection Phase5.
- Slice1 privacy; Slice1B surface authority (53 passed, 0 failed).

Edge Slice14C observation compatibility passes unchanged. SQL tests used a newly named isolated temporary local PostgreSQL database and removed that fixture, not shared application or production data. No new migration file, shared schema migration or production operation.

No environment-only failure remains among these executed tests. Earlier fixture failures (missing `edge_nodes` / incomplete projection) were reproduced and corrected in test fixtures. The initial new-test queue resource leak is recorded above; its successful assertions were not mistaken for successful process exit. No unrelated failure was hidden or fixed. Broader historical live-provider/onboarding suites requiring production/local service credentials were not claimed as executed.

## 10. Freeze proof and files

No changes to observation ingestion/RPCs, camera/Edge/device interpretation, transition checkpoint/outbox/policy/delivery, canonical awareness, physical authorization/execution, camera privacy policy, HLS playlist/segment controllers or Edge source. No current-state write or signal was added. The camera bind/import handlers only change their response mapping; provisioning writes are untouched. Infrastructure write/history path remains unchanged.

Intended implementation: `cameraCurrentStatePresentation.ts`; camera controllers/playback metadata; commandRouter camera read branch; canonical camera target hydration and object presentation; Spatial and infrastructure GET readers; Office inventory label; Camera Core normalization; deprecated legacy-normalizer annotation. Tests: dedicated 14F, privacy fixture/reader checks, Slice1B selected-field mock, Spatial integration cases, Camera Core expectations and npm entry. This document completes the inventory/report. No unrelated local files enter the commit.

## 11. Completion and exact production work remaining

Within the audited Backend and canonical shared Camera Core source, zero unjustified live generic camera current-state reader bypasses remain. Reader convergence is complete **locally**, within the frozen 14D evidence contract. Identity/configuration, history, transport diagnostics and operator write acknowledgements remain explicitly distinct. No Camera/Edge evidence or health semantics were redesigned to force a result.

The local Camera/Edge architecture can be treated as frozen within the documented 14A–14F guarantees, not as production-ready or deployed. Production readiness still requires:

1. Review/apply the previously committed 14B/14C/14E migrations in their documented order; deploy compatible Backend before enabling the coordinated 14C Edge producer. No migration was applied to shared/production DB here.
2. Regenerate/update downstream Facility/Consumer Camera Core copies to version 6 with canonical vocabulary; verify old client `online/offline` assumptions, `offline_streams` compatibility alias and Office `live_cameras: null` handling. This task does not modify external frontend repositories or certify rendered UI.
3. Verify real Edge/camera credentials, assignment, go2rtc, actual acquisition, authenticated HLS/segment/snapshot playback, Home/privacy isolation and deployed cross-surface UI under real hardware/network conditions.
4. Verify effective producer cadences against Backend freshness expectations. Unscheduled ONVIF/TCP and media snapshots retain unspecified freshness; no continuous recording/advancing-frame or recorder/channel health claim is possible from the existing contract.
5. Enable/observe 14E evaluator and delivery reconciler; verify persisted canonical signal, awareness and incident materialization. Existing partial-Core-bundle retry/repair and scope-change obligations remain documented operational work, not fixed here.
6. Load/latency and retention monitoring, including 14E Edge-table SHARE locking, transition checkpoint write volume and delivered-outbox retention. Query bounds here do not substitute for deployment load tests.

No push, deploy, infrastructure deletion, incident CAS repair, Camera/Edge redesign or Wave7 work was performed.
