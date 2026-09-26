# Wave 6 Slice 14 — Camera + Edge Health Authority Audit

Audit date: 2026-09-24. Source audit; no production requests, hardware probes, source/test changes, migrations, commits, fetches, pushes or deployments. This uncommitted document is the only repository addition. Physical execution, device current-state authority and awareness implementation remain frozen.

## 1. Executive answer and evidence limits

**The two repositories do not yet provide one coherent, freshness-aware camera/Edge operational-health answer.** Canonical camera identity and several secure ingestion/access boundaries exist. Health interpretation is split across mutable registry fields, spatial infrastructure fields, Edge process inspection, frontend normalization and local inference metrics.

Today none of these five claims has a complete unified evidentiary contract:

| Claim | Actual implementation basis | What it really establishes |
| --- | --- | --- |
| Camera is healthy | Stored strings; sometimes go2rtc stream entry/producer/source existence | Previously reported/configured stream state, not current decoded video |
| Camera is offline | Stored offline/error/unreachable strings, or loss transition between status strings | A report/classification; not necessarily physical camera failure |
| Video stream unavailable | Missing configured HLS URL or failed proxy request; Edge's different go2rtc predicate | A particular access/runtime path unavailable; component/reason differs |
| Edge is down | No server-side heartbeat expiry found; stored status persists | Current implementation cannot reliably infer disappearance |
| AI detection unavailable | Local optional bridge configuration/errors; not a persistent Backend health observation | Local inference result only; Backend silence is ambiguous |

Source facts below are verified against the checked-out code and migrations. Database migration application, deployed environment variables, current frontend deployments, go2rtc version-specific responses and real camera behavior were **not** verified. UI rows in the consumer matrix describe Backend/shared-core contracts, not a browser QA of other repositories. Negative findings mean no implementation found in the audited repositories, not proof about external infrastructure.

## 2. Repository states

| Repository | Branch | HEAD | Local origin/main | Ahead / behind |
| --- | --- | --- | --- | --- |
| `/Users/ochigaidoko/Documents/Ochiga-backend` | `main` | `63c4fb42991f34449330981ab5278943d8fa2a68` | `909d5d0a35ab2de84c7cdc83d0f10be166e0b512` | 6 / 0 |
| `/Users/ochigaidoko/oyi-edge-agent` | `main` | `5d30b63866197d6b674951bfdce2dd1211e76d24` | same | 0 / 0 |

Backend matches required HEAD. Neither repository has staged changes. Edge is clean. Tracking refs are local: no fetch was authorized or performed.

Backend pre-existing unstaged files, untouched: `scripts/pilot-import.mjs`, `src/routes/me.routes.ts` (33 insertions / 4 deletions combined at audit). Pre-existing untracked:

- `.aider.chat.history.md`, `.aider.input.history`, `.aider.tags.cache.v4/` (cache.db and WAL/SHM files).
- `docs/OYI_DIGITAL_TWIN_ASSET_CONTRACT.md`, `opencode.json`.
- `pilot/luna-residences/`: buildings.csv, cameras.csv, devices.csv, estate.json, homes.csv, phase3c_infrastructure.sql, residents.csv, rooms.csv, staff.csv, zones.csv.
- Five `supabase/migrations/20260905*LOCAL_TEST*` files: home_zone_building_link, home_canonical_ref, room_canonical_ref, device_canonical_ref, device_parent_relationship. Not part of this audit's implementation or schema proposals.

A second clean Edge checkout was initially found at `/Users/ochigaidoko/Documents/Codex/2026-08-23/oyi-office-office-intelligence-interaction-ui/work/oyi-edge-agent`, branch `codex/camera-runtime-canonical-cleanup`, HEAD `6dfc8a57a974def965e7ec78f90d9c37b6a60358`, 0 ahead / 1 behind local origin/main. Primary checkout is the home-directory main above. **Both commits have identical tree `6b4f2cc0a785fa5bb1fcc2affa3472a7303176fe`**; the extra main commit is the merge. Earlier reading of that second checkout therefore inspected identical code. No clone/pull or lazy object fetch used for the comparison.

## 3. Documents versus executable ownership

Read Backend: `docs/OYI_CAMERA_RUNTIME_ARCHITECTURE.md`, `camera-runtime-phase1.md`, `oyi-camera-core-phase2.md`, `OYI_CAMERA_GATEWAY_PHASE3.md`, `OYI_CAMERA_MEDIA_RUNTIME_PHASE4.md`, `camera-detection-runtime-phase5.md`, `architecture/OFFICE_EDGE_SEPARATION_PLAN.md`, `src/modules/cameras/README.md`.

Read Edge: `README.md`, `EDGE_PHASE_1_CAMERA_PROTOCOL_ONBOARDING.md`, gateway/media docs, `edge/camera/docs/{runtime-recovery,DEPLOYMENT,AI_PROCESSOR}.md`, `docs/REPOSITORY_SEPARATION_AUDIT.md`, `ROTATION_CHECKLIST.md`.

| Concern | Documented owner | Executable assessment |
| --- | --- | --- |
| Camera identity/provisioning | Backend facility_cameras, explicit promotion | Supported; external camera_id versus UUID remains inconsistent across wire |
| Discovery | Edge LAN ONVIF/scan; Backend candidate/approval | Supported; discovered_devices is not automatic camera creation |
| Credentials | Edge local references | Supported in normal generator/gateway; legacy rtsp_url/free metadata still require sanitization care |
| Streaming | External local go2rtc; Backend authorized HLS proxy | Supported; no Backend stream orchestrator in current architecture |
| Frames | Edge capture; Backend private media | Implemented, but continuous frame-freshness reporting is absent |
| Health | Edge observations, Backend projection | Implemented as projections, not a consolidated current-state authority |
| Inference | Optional Edge external detector | Implemented; Backend does not receive inference-health metrics |
| Edge heartbeat | Agent producer, Backend persistence | Implemented without expiry/ordering |
| Canonical events | Backend camera domain ingress | Explicit ingress plus still-active legacy ambient ingress |
| Spatial camera projection | camera_infrastructure | **Contradicted by runtime health writes and canonical signal emission** |

Older module README references WebRTC/old service layout; current playback contract is HLS and sets webrtc_url null. Older shared-token and mixed Office-repository descriptions are superseded by bound identity/separation code. No historical playback or recording-provider completion inferred from live HLS.

## 4. Canonical identity, competing stores and inventory

`facility_cameras.id` is canonical camera UUID; `camera_id` is a separate external/stream reference. Estate, home/privacy, room/zone/location, provider/protocol, Edge assignment, nvr_id/channel, credential_ref and metadata/configuration are held here, although writers inconsistently use dedicated columns versus metadata. Camera access explicitly prioritizes columns.

Identity writers/readers (executable source inventory):

| Path | Operation/classification |
| --- | --- |
| `src/controllers/camerasController.ts:125` bind; `:246` importDvr | CANONICAL_IDENTITY writes; rebind/import can also reset statuses |
| `src/routes/edgeDiscovery.ts:677` candidate provisioning | CANONICAL_IDENTITY promotion, fingerprint duplicate check, explicit authorization |
| `src/infrastructure-onboarding/service.ts:682` camera import | CANONICAL_IDENTITY writes from approved candidate |
| `src/routes/edgeDiscovery.ts:171` persistCameraPlaceholder | DEAD legacy helper: definition but no active caller; discovery pushes now candidate-only |
| `src/routes/edgeDiscovery.ts:416` stream-health | Runtime writer on canonical row, not identity authority |
| `src/modules/cameras/cameraMedia.service.ts:31` | Frame/last-seen metadata writer on canonical row |
| `src/controllers/{camerasController,cameraStreamController,cameraIntelController,cameraMediaController,cameraDetectionController}.ts` | Main list, player, event, media, detection readers |
| `src/modules/cameras/{cameraMedia.service,cameraDetection.service}.ts` | Assigned-camera ingestion and authorized media/detection readers |
| `src/services/{platformGapService,spatialFacilityContextService}.ts` | Projection validation and spatial related-camera reader |
| `src/ai/commandRouter.ts:1222`, `src/oyi-core/runtime/canonicalTargetHydrationRegistry.ts:516` | Conversation inventory/target readers |
| `src/intelligence-core/permissionEngine.ts:188`, `src/oyi-core/read/canonicalAwarenessReadService.ts:314` | Batch camera privacy rehydration |
| `src/controllers/superAdminController.ts:70,357` | Counts/operator inventory |
| `camera_dvrs` | CANONICAL recorder identity/configuration, not duplicate per-camera identity |
| `discovered_devices` | PROVISIONING candidate store; canonical_camera_id is projection/link |
| Edge local registry and generated go2rtc streams | PROJECTION/config cache; executable legacy name/IP fallback is not canonical identity |
| `camera_infrastructure` | Canonical-ID projection plus PARALLEL health authority |
| Generic devices camera records / Office live_cameras | LEGACY/derived inventory, not canonical camera registry |

The phase-1 hardening migration adds `camera_infrastructure.camera_id` and `camera_health_history.camera_id` foreign keys to facility_cameras.id as **NOT VALID**. New writes constrained, old ambiguous rows preserved; unresolved-legacy view identifies them. It does not establish that production has no unresolved legacy rows.

**Wire identity incompatibility:** Backend `edgeRegistry` (`camerasController.ts:430`) emits `camera.camera_id || camera.id`. Edge `scripts/edge-camera-common.js:85` also falls back to name/host and sanitizes stream IDs. Stream-health accepts UUID/external-id/IP aliases, but media/detections accept canonical UUID only. DVR stream keys can therefore report status yet fail canonical media/detection ingestion. Canonical UUID and stream_id need separate explicit contract fields; do not create replacement camera records.

## 5. camera_infrastructure exhaustive disposition

Schema: `supabase/migrations/20260602230840_platform_gap_closure_stage_b.sql:108`: id, estate_id, camera_id, placement_id (Twin placement FK), zone, area_owner, infrastructure_relationship, health_state default awaiting_telemetry, metadata, created_at, updated_at; unique estate_id/camera_id.

Only application table read/write family found: `platformGapService.cameraInfrastructure/upsertCameraInfrastructure`, lines494–556. Mounted at `/facility/platform/camera-infrastructure` (`facility.routes.ts:143`, `platformGap.routes.ts:41`). Read returns last100 projection rows and last100 camera_health_history rows. Write accepts operator health_state, defaults omitted health to awaiting_telemetry, replaces metadata, inserts history when health_state supplied, broadcasts camera.status.updated, and emits an explicit canonical transition if a prior row exists. It checks referenced canonical camera in the chosen estate, but does not read runtime observations to substantiate health.

Thus it is **mixed spatial/operator inventory and independently writable health**. A placement-only update can reset previous health through its default. History is primarily operator/projection history, not the Edge stream-health history. Twin placement/reference storage itself is valid. Spatial related-camera context (`spatialFacilityContextService.ts:137`) separately reads facility_cameras + canonicalCameraHealth; these two Twin-facing contracts can disagree.

## 6. Health representations

| Store/representation | Classification | Writer/reader and limitation |
| --- | --- | --- |
| facility_cameras status/health_status/stream_status | CURRENT_STATE mixed with PROVISIONING | Bind/import/gateway/Edge; independently ordered strings, no expiry |
| metadata.stream_status + success/failure/latency/provider error | CURRENT_STATE projection | Edge stream route replaces metadata; top-level values may differ |
| last_seen_at/last_health_check_at | DERIVED receipt/observation mixture | Server receipt and media capturedAt share fields |
| metadata.frame_freshness_at | OBSERVATION projection | Media ingest writes capture time; later health metadata replacement erases it |
| camera_infrastructure.health_state | PARALLEL CURRENT_STATE/operator assertion | Separate writer and signals |
| camera_health_history | HISTORY | Projection writer, not stream-route journal; no pruning found |
| camera_dvrs status/last_seen/connection_test | Historical probe projected as CURRENT_STATE | Backend TCP on test/import, not continuously monitored |
| camera_events / camera_detections | HISTORY / domain OBSERVATION | Detectors/manual events; not health authority |
| camera_media / camera_event_media | HISTORY/evidence | Discrete media, not continuous recording; private storage |
| edge_nodes heartbeat_status/last_seen/queue/error/version | CURRENT_STATE receipt projection | register, heartbeat, discovery; no observed-time guard |
| edge_heartbeats | HISTORY | Payload ts in metadata, received_at default DB time |
| edge_node_history | HISTORY/operator record | platformGapService:361–378; separately broadcasts edge.heartbeat |
| Edge state.cameraHealth/state.go2rtc | CACHE / DERIVED | Local inspection; old camera array survives failed inspection |
| Edge inference metrics/provider.health() | DERIVED ephemeral | Per-call runtime in processor; stdout only |
| playback edge_status / validate-stream status | DERIVED configuration/read result | URL/config existence, not heartbeat/frame evidence |
| canonical operational_signals/incidents/awareness | HISTORY + interpreted awareness | Receives contradictory upstream producers; not camera physical truth |

## 7. canonicalCameraHealth assessment

`src/modules/cameras/cameraHealth.ts:1–39` is **B: projection/normalizer**, useful scaffolding for C, not A current-state authority.

Input: arbitrary camera object. `stream_status` precedence: top-level stream_status → metadata.stream_status → health_status → status → pending. Online = online/active/healthy/ok membership. Output status independently prefers health_status → status. Copies success/failure/seen/health timestamps, latency/reconnect/error and frame timestamp. **No clock, timestamp validity/age check, Edge join, provider-health decision, component conflict rule or fresh-frame requirement.** Provider error does not alter health.online. Capabilities infer live availability from configured HLS URL + health.online; detection flags mean configured, not healthy inference. Recording/recognition/ANPR remain unavailable.

Important disagreement: stream-health writes `status` and metadata.stream_status but **does not update the top-level stream_status**. Schema defaults top-level stream_status to pending. That pending overrides a new Edge online report. Inventory summary separately examines top-level stream_status/health_status/status, ignoring nested metadata; shared core has another status precedence (`packages/oyi-camera-core/src/core.ts:93`). Playback edge_status is available merely when an HLS URL exists. These are not equivalent health decisions.

Pure-function source execution reproduced: a 2020 online row stays online; top-level pending + metadata online yields online=false; wire health_status stream_available plus metadata online yields online=true if top-level absent; fresh frame timestamp + offline status remains offline; never-observed row yields pending/online=false, not explicit freshness.

## 8. Edge end-to-end runtime

All Edge paths below relative to `/Users/ochigaidoko/oyi-edge-agent`.

| Component | Input → output | Time/persistence/Backend destination |
| --- | --- | --- |
| `src/camera/discovery-engine.js` | WS discovery or bounded private subnet/TCP + ONVIF auth/device info/stream URI → candidate fingerprints/profiles | started/completed/discovered timestamps; command result → discovered_devices; does not create camera |
| `src/camera/command-runtime.js` | Bound site/node/expiry command + local credential ref → discovery or snapshot | Executed only after Backend ack; completion separately posted/queued |
| `scripts/edge-camera-common.js` | Remote/local registry + EDGE_CREDENTIAL_* → RTSP URL/go2rtc YAML | Config projection on disk, no observation proof |
| External go2rtc | Configured sources → stream API/HLS/frame endpoints | External supervised service, agent does not own process lifecycle |
| `agent.js:167` checkGo2rtc | GET /api/streams → per-stream cameraHealth and process counters | Local now observedAt/cache; periodic health POST |
| `src/camera/snapshot.js` | GET frame.jpeg → validated JPEG/WebP bytes/hash/capturedAt | Successful acquisition timestamp; media upload/outbox |
| `scripts/camera-ai-processor.js` | Registry + frame bytes → external detector → normalized detections | Separate process; detection outbox; media and detection APIs |
| `src/camera/inference-runtime.js` | Samples → filter types/confidence, counts/latency | Ephemeral metrics; not persisted health |
| `agent.js` heartbeat | Identity/runtime/outbox counters → heartbeat |30s default; durable ordinary outbox on error |

Discovery ONVIF availability is method-specific: authenticated device-information/URI retrieval is evidence of that control service at discovery time; an authentication-error candidate can still mark ONVIF available. `rtspAvailable` means URI obtained, not RTSP decoding. Fingerprint fallback uses mutable network identity when stronger serial/MAC/endpoint UUID absent. Scan bounded /24–/30, private IPv4, concurrency32 TCP then bounded ONVIF work; request timeout is not necessarily an end-to-end deadline across all batches.

## 9. Exact existing health payload: local versus wire

`src/camera/health.js` local object:

```text
cameraId, streamId, state, reachable, streamAvailable,
activeConsumers, observedAt, frameFreshnessAt:null,
capabilities:{live:available|unknown,frameFreshness:unknown}
```

`reachable = Boolean(stream && (producers.length || stream.source || stream.url))`; streamAvailable equals reachable. State is stream_available / degraded (entry exists but predicate false) / configured (no entry). This is registry/producer presence, not physical reachability. Pure execution with only `{source:'rtsp://example.invalid/live'}` returned reachable=true and streamAvailable=true, zero consumers, frameFreshnessAt=null. `{producers:[{}]}` also suffices.

Actual `agent.js:343–371` heartbeat/per-camera POST body is narrower:

```text
site_id, agent_id,
status: streamAvailable ? online : degraded,
health_status: state,
last_success_at: streamAvailable ? observedAt : null,
capabilities
```

It drops reachable, streamAvailable, activeConsumers, observedAt and frameFreshnessAt as explicit fields. Backend stream-health ignores capabilities; timestamps health/seen with server receipt time. It replaces the entire metadata object, including privacy/home/frame keys that are not copied into the new object. That overwrite is both a freshness-loss and privacy-consistency risk.

If go2rtc GET fails, checkGo2rtc resets go2rtc counters but leaves previous cameraHealth array. Subsequent heartbeat can resend prior healthy camera entries. If a stream vanishes from a successful registry response, it is omitted rather than emitting a negative observation for its formerly assigned camera.

## 10. Frame freshness

Snapshot success: HTTP200, bounded timeout, <=5MiB, accepted JPEG/WebP magic/MIME (`snapshot.js`). capturedAt is local acquisition completion; it does not prove advancing sensor timestamps or detect an NVR frozen image. No camera-level successful-frame cache is maintained by the heartbeat path. frameFreshnessAt remains null there.

Backend media ingest (`cameraMedia.service.ts:19–32`) validates media, persists discrete evidence, then sets metadata.frame_freshness_at and last_seen_at from capturedAt. No monotonic guard; delayed older media can regress these. Invalid/missing time falls back to now; no future-clock bound comparable to detector time validation. All accepted media kinds share the update, so clip ingestion also cannot be assumed to prove current live video. Next health metadata replacement can erase frame timestamp. Concurrent read/merge/write media updates can restore older metadata.

AI sampling fetch is a separate less strict path: requestBuffer accepts <400 responses, lacks snapshot helper's image signature/size checks, and captures evidence only when detections exist. No-detection successful samples are not Backend frame-health observations.

**Process reachable ≠ stream registered ≠ producer attached ≠ bytes acquired ≠ decoded advancing fresh video.** Current code proves only some of these, at different times.

## 11. Recorder/NVR

`camerasController.testDvrConnection/importDvr` use Backend-network TCP reachability at supplied port (default554); channel count is supplied by operator, not discovered live channel-health proof. `camera_dvrs` persists status/test metadata and last_seen when successful. Import creates channel facility_cameras with nvr_id/channel/credential_ref and pending-stream states. No recurring recorder probe/heartbeat/channel runtime table found. Edge represents recorder channels as streams; no explicit recorder health producer. `recorder_failure` canonical event currently derives from text matching recorder/nvr/dvr in a reported error, not a structured recorder observation. Recorder health is **explicit one-shot TCP test, missing ongoing operational contract, partly conflated with stream error text**.

## 12. AI/inference health

`CameraInferenceRuntime` exposes processedFrames, detectionsEmitted, droppedSamples, providerFailures, cumulative latency, queueDepth, busy/per-camera sampling guard. ExternalDetectorProvider health is available if URL configured before any successful request, degraded on last error, unavailable without URL.

Actual processor constructs a **new provider and runtime for each detect call**. Counters/lastSampleAt do not represent continuous process history. Default sample interval15s, maxCameras12, sequential loop. Metrics/provider_health are stdout result fields, not included in Backend detection POST. There is no persisted last successful inference heartbeat, no distinction at Backend between healthy zero detections, disabled sampling, failed provider and stopped process. Camera ai_enabled/profile is configuration only. Labels supported by normalizer are not evidence of installed detectors; optional bridge defaults motion/person/vehicle; no face recognition or ANPR implemented.

## 13. Edge node identity, heartbeat and staleness

Identity: edge_nodes unique `(estate_id,edge_node_id)`; credentials bound by OYI_EDGE_AGENT_IDENTITIES via `edgeIdentityPolicy.ts`. DB id and textual edge_node_id differ; use estate+node binding consistently.

Agent defaults: heartbeat30s, discovery120s, config pull180s, queue flush5s; request timeout10s; retry exponential2–60s; no jitter. Backend config can override intervals. Agent always sends status online; queue sets degraded sync status, not node physical status. Runtime version, local host, queue depth, error count sent. Camera/device counts derive static CAMERA_IP list (0/1), not go2rtc camera count. Errors accumulate by operation key and are not cleared on successful recovery.

Backend `edgeDiscovery.ts:99–169,318`: register/heartbeat/discovery update edge_nodes.last_seen_at to **receipt now**. Heartbeat stores payload ts in edge_heartbeats.metadata, not in a current monotonic observation field. Health/service/go2rtc/AI details are not included in heartbeat contract. Row metadata replacement can discard previously configured metadata such as consumer discovery opt-in.

**No Backend server-side heartbeat expiry or current read-time age interpretation found.** Search of all edge_nodes/edge_heartbeats/heartbeat_status references reaches routes, infrastructure controller, onboarding and Office export, not an expiry worker. Edge can report online once and remain online indefinitely. `infrastructure-onboarding/service.ts:273,818` readiness tests strings without age; discovery command route checks node exists, not recent heartbeat. Local /healthz backend_reachable means any historic heartbeat/register success, not current reachability.

### Proposed timing, not implemented

Use actual per-node effective interval H, request bound R and measured scheduling/network allowance J. Candidate fresh window `3H + R + J`; with H30s/R10s/J0 nominal100s. Candidate telemetry-expired `max(6H, 2*retryMax) + R + J`, nominal190s. These are operational starting points (three missed opportunities; six misses/beyond capped retry), **not empirically validated production thresholds**. Negotiate/report H and measure J before fixing values. Late replay must not refresh observation freshness. Receipt time tracks transport contact separately. Missing heartbeat means telemetry stale/unavailable, not node powered off and never attached cameras physically offline. Frame/inference schedules require their own windows; do not reuse heartbeat TTL blindly.

## 14. Disconnection and evidence strength

No explicit Backend fan-out that marks all attached cameras offline when Edge expires was found; expiry itself is absent. That absence must not be replaced by an unjustified physical-failure inference.

| Evidence | What it supports, strongest only within its own claim |
| --- | --- |
| Operator status/configured URL | Intent/configuration, no physical reachability |
| TCP connection | Particular host/port reachable from probing network at time; not video |
| ONVIF response | Camera/recorder control endpoint reachable/auth result at time |
| RTSP URI from ONVIF | Stream descriptor exists, not usable stream |
| go2rtc API + stream entry | Stream-manager API/registration present |
| Producer object | Producer attached/reported; no required frame counters checked |
| Snapshot validated bytes | Image acquired on path at time; may be cached/frozen |
| Recent detector result | A provider processed some input at source time; not current global health |
| Successful HLS HTTP | That resource fetched; not decoded/live advancing video |

No global precedence is justified across these different facts. Direct camera probe failure with a valid recorder-mediated frame is not a contradiction: vantage/path differs.

## 15. Stream/event signal paths and conflicts

Stream: go2rtc → cameraHealth → agent periodic POST → bound token/site/node → facility_cameras updates → API/core projections. Separately emits realtime camera.status.updated and explicit health transition.

Exactly two direct `submitCameraHealthCanonicalSignal` caller families found:

1. `edgeDiscovery.ts:499–519`: prior facility_cameras.status versus payload status, optional regex tamper/recorder error. Signal uses server now; can emit even if update failed, provided prior row existed. No prior row means no explicit transition; unmatched row may still receive success HTTP and realtime emission.
2. `platformGapService.ts:541–554`: prior projection.health_state versus operator's resulting health_state. Omitted health defaults awaiting_telemetry. Operator assertion becomes `origin:physical`, `verified:true` through helper.

Classifier (`cameraCanonicalSignal.ts:136`) online→nononline = connectivity_lost (including degraded or pending); nononline→online = restored; two different nononline strings = degraded. Tamper/recorder flags precede unchanged comparison, so repeated matching error text can repeatedly emit those signals. binding_changed exists in union/map but no direct producer supplies it. Initial prior-row absence suppresses signal, but provisioned pending→online is called restoration even without previous proven online.

**Additional ingress:** `emitSignal.ts:42–65` invokes legacyAmbientCanonicalIngress when socket IO exists unless skipped. Both camera producers retain camera.status.updated without skip. platformGap's migrated set only contains incident.created and twin.state.updated. Edge heartbeat and operator edge history also use ambient ingress. Therefore explicit transition-only comments do not mean all current camera/Edge Core ingress is transition-only.

Conflict example: facility_cameras previously online → Edge degraded → connectivity_lost; independent camera_infrastructure previously offline → operator healthy → connectivity_restored. Both emit for same camera without reconciling source/time. Or projection-only edit healthy→awaiting_telemetry yields loss while stream remains working.

Canonical correlation ID camera_health:<id> associates events, not evidentiary precedence. `canonicalIntelligenceStore.ts:15` durable key includes provider event ID or signal ID, entity and tenant, not a resolving source order. `incidentCorrelation.ts` treats online/restored as recovery. Contradictory arrivals can update/recover correlated incidents; correlation/dedup is **not a contradiction resolver**. Do not repair incident CAS in this task; converge producer input before frozen awareness.

Detection ingestion writes camera_events/detections, not camera status. Media from detection separately updates frame metadata. Manual camera event producer emits a detection observation, not fabricated health. Old Edge events route persists/publishes event metadata and ambient realtime; recent event silence is never proof of offline.

## 16. Privacy and Edge security

Positive boundaries: bound-token policy uses timing-safe token comparison and exact requested site/node; disabled entries rejected. Health/events/media/detections constrain estate and assigned edge_node_id. Media/detection use UUID; health legacy aliases remain estate/node scoped. Server-only migrations revoke direct anon/auth camera/Edge tables and enable RLS. Production application of those migrations is unverified. Legacy shared-token mode is explicit opt-in; when enabled client-supplied site/node binding is weaker. Deployment setting was not read.

Camera routes apply requireAuth → resolveRequestContext → cameraAccessActor. Policy requires active resolved home for home-scoped cameras; ordinary residents cannot view facility cameras merely by selecting a home; office-scoped requires explicit allowed user. Canonical awareness and intelligence event lookup select full `home_id,privacy_scope,metadata`, batch filter fail-closed. Preserve these rules unchanged.

**Source defects/risks discovered, not fixed:**

- Media, detection, cameraIntel playback/events and HLS queries omit top-level home_id/privacy_scope (`cameraMedia.service.ts:11`, `cameraMediaController.ts:11`, `cameraDetection.service.ts:29`, `cameraDetectionController.ts:8`, `cameraIntelController.ts:96`, `cameraStreamController.ts:123,199`). Policy then sees only legacy metadata. Pure check: full camera bound Home B, metadata Home A denies A; reduced projection allows A. This is a proven projection-dependent policy decision; production conflicting rows were not inspected.
- HLS playlist explicitly checks token camera_id; **segment handler does not**. It rechecks policy for requested camera and constrains target URL to that camera's configured origin/path, but token for camera A can satisfy policy for another camera B accessible to the same token actor. It is not a cross-estate bypass by itself; violates camera-token binding. Existing P0 source regex smoke checks one occurrence in whole file, not both handlers.
- `cameraMediaPolicy.ts` bounds origin and directory prefix, not stream-selecting query values. Shared go2rtc `/api/` URLs distinguished by `src` need explicit resource-binding acceptance coverage; directory/origin checks alone cannot prove the selected camera's media when query parameters choose the stream. No production exploit attempted.
- HLS tokens preserve issued scope for120s; proxy does not reload current home membership on each segment. Revocation/switch semantics are limited by token lifetime. Signed media links similarly remain usable for their short signed TTL.
- stream-health replaces metadata, dropping metadata-only privacy/home/allowed-user data. Top-level canonical columns are not consistently written or projected across callers; no claim that all cameras are protected by intact columns is justified.
- `platformGapService.estateIdFrom/scopedEstate` trusts explicit query/body estate before membership fallback; camera-infrastructure API only gates coarse permission. Read lacks per-camera policy; write checks camera belongs to chosen estate, not actor membership of that chosen estate. Mount shows no additional estate-validation middleware for this route family. Potential cross-estate operational metadata/read/write boundary, not exercised against production.
- High/critical detection path calls NotificationService.sendToEstate; `NotificationService.ts:345` selects users by users.estate_id and applies delivery preferences, **not canAccessCamera**. Private camera title/summary can fan out beyond authorized camera audience. Signed-media denial does not retract notification text.
- Realtime emit sends estate room as well as home room, not either/or. Camera payloads can include status/event metadata; canonical API read filtering alone does not protect this transport. Subscriber eligibility and deployed socket audience require acceptance tests before claiming leak-free operation.
- Health lookup miss can return200 camera:null and still emit realtime; failed write can still signal prior/new comparison. Payload status arbitrary string; no source-time/sequence validation, freshness bounds or observation idempotency.
- Edge default registry URL is `/cameras/edge-registry/estate/...` requiring user auth/cameras.view; Edge common helper defaults to Edge token. No bound-Edge middleware on this registry endpoint. A separately configured CAMERA_REGISTRY_TOKEN may be required; successful deployment not established. Registry scope is actor-filtered estate, not automatic assigned-node filtering. Do not solve with broad user/admin token.
- Generated go2rtc listens0.0.0.0:1984; agent healthz listens0.0.0.0:9090. Network isolation/auth must be deployed intentionally; cannot infer safe LAN exposure from source. Generated RTSP config contains resolved local credentials; never expose it through Backend/report.

## 17. Consumers and Twin

Freshness column describes current behavior, not desired policy. Frontend appearances outside shared core were not executed.

| Consumer | Source | Fact claimed | Freshness | Privacy | Authority status |
| --- | --- | --- | --- | --- | --- |
| Facility camera list/inventory | camerasController + facility_cameras | health/stream counts, AI enabled | none | full row policy | divergent normalizers |
| Consumer camera list | /cameras/home + canonicalCameraHealth | camera runtime/availability | none | resolved active context + full row | static projection |
| Shared camera-core | core.ts runtimeState | online/degraded/offline/unknown | dates copied, not aged | upstream | second classifier |
| Playback/player | token contract + HLS proxy | configured/ready/fetch failure | token TTL, not camera evidence age | gaps above | transport outcome only |
| Twin infrastructure | /facility/platform/camera-infrastructure | health_state, placement | updated/history dates only | coarse route; gaps above | mixed parallel authority |
| Spatial home/room context | boundedCameras + facility_cameras | sanitized camera health | none | full camera policy + home filter | projection, not independent runtime |
| Conversation module list | commandRouter:1222 | row health/status + events | no camera-specific expiry | full row policy; event IDs filtered | raw current-state presentation |
| Conversation target hydration | canonicalTargetHydrationRegistry:516 | camera record status/health | updated_at, not camera freshness | surrounding target policy | registry projection; not physical guarantee |
| Security conversation | securityConversationAnswers | record/evidence available | no camera runtime authority | canonical conversation boundary | cautious record language, not health proof |
| /intelligence events/summaries | intelligenceRoutes + event bus | camera/Edge event history and predictions | event-window logic, not node expiry | batch full camera filter for event reads | history-derived, not health source |
| Canonical awareness | operational_signals/awareness/incidents | upstream camera transitions | producer time/server receipt | full camera privacy rehydration | protected read, conflicting inputs |
| Facility Edge admin/infrastructure | edge_nodes + last100 heartbeats | status/last heartbeat/count/queue | no expiry | estate-scoped controller | stale row can remain online |
| Onboarding readiness | edge_nodes status strings | online Edge supports discovery | no expiry | onboarding scope | false-ready after disappearance |
| Office exports | edge_heartbeats; generic device groups | history and live_cameras count | history export only | Office authority scope | camera count is inventory regex, not live proof |
| Camera security reports | cameraIntelController events | recorded incidents/events | history time filters | camera query/policy projection gap | historical, not operational health |

Twin is **mixed today**: spatial entities/placements are correctly spatial; related cameras use canonical identity projection; camera_infrastructure is independently writable health. Narrow the latter, do not change coordinates/navigation or frozen generic device state.

## 18. Failure-scenario matrix — TODAY versus knowable

No single TODAY answer exists across all readers. Assume inputs are persisted where supported; caveats show unobservable dimensions.

| Scenario | System today | Facts actually knowable |
| --- | --- | --- |
| A reachable/stream/frame/Edge/AI healthy | May say online if status precedence allows; pending column can suppress it; AI success not persisted | Individual successful observations at their timestamps; not indefinite overall health |
| B camera reachable, stream unavailable | Edge no-producer entry → degraded; classifier may call connectivity_lost; direct ONVIF result not joined | Control path reachable, stream path unavailable; not physical camera offline |
| C stream available, frame stale | Can remain online indefinitely; frame timestamp ignored/erased | Stream registration/producer exists; fresh video unproven |
| D camera/stream healthy, AI failed | Camera remains online; local processor error; Backend no distinct AI-health result | Video and AI must be separate; inference unavailable cannot be deduced from silence |
| E stale heartbeat, last stream healthy | edge_nodes online and camera may remain online | Last observations only; telemetry stale, physical state unknown |
| F Edge unavailable, recorder previously healthy | Both historical row statuses can persist, no join | Recorder last TCP success does not prove current operation; cloud loss does not prove camera failure |
| G direct probe fails, recorder frames arrive | No component reconciliation; media updates frame timestamp but offline string may win | Recorder-mediated media succeeded; direct vantage failed |
| H registry online, Edge unavailable report | status/health updated, top-level stream_status may still override; unmatched/failed writes still broadcast | New observation relevant to its path; registry flags are not competing physical evidence |
| I infrastructure offline, facility_cameras online | Twin infrastructure offline; lists online/unknown; both can signal | Operator assertion conflicts with last stream projection; no unified adjudication |
| J never observed | pending/configured, health.online=false, shared-core unknown; URL can yield playback ready | Provisioned only; neither online nor offline proven |

## 19. Options grounded in code

| Option | Advantages/compatibility | Failure/truthfulness | Migration weight |
| --- | --- | --- | --- |
| A Edge heartbeat primary camera health | Existing one/node transport; cheap | Node/cloud contact says nothing about per-camera stream/frame/AI; offline LAN may work | Small implementation, unacceptable inference |
| B facility_cameras runtime primary | All main readers already use row; simplest DTO | Current fields conflict/never expire, metadata overwrite; workable **storage location**, not sufficient interpretation contract | Small for storage reuse, medium to repair interpretation |
| C recorder/stream primary | Directly relevant to viewing and existing go2rtc | Direct IP cameras have no recorder; configured stream != frame; cannot answer AI/Edge questions | Medium, incomplete coverage |
| D interpretation of independent observations | Fits existing separated components; preserves uncertainty | More explicit provenance/time model required; risk of overengineering and false overall health if all components assumed mandatory | Medium Backend + Edge, bounded if reusing rows |

**Recommendation D as a small interpretation layer using B's existing identity/storage, not a new multi-service architecture.** It wins because concrete C/D/E/G counterexamples cannot be represented honestly by A–C alone. Do not poll every component merely to fill a richer schema. Absent evidence stays unknown/not configured. Overall healthy should name the capability profile it summarizes (e.g. live viewing), not imply configured AI or recording is operational.

## 20. Independent hypothesis assessment

| Hypothesis | Assessment | Evidence |
| --- | --- | --- |
| facility_cameras canonical identity/provisioning | SUPPORTED | bind/import/promotion and FK references; also holds mixed runtime fields today |
| camera_infrastructure only spatial/Twin projection | CONTRADICTED | independent health mutation/history/signals |
| Edge strongest local physical observation source | PARTIALLY_SUPPORTED | ONVIF/frame vantage useful; current go2rtc predicate weak; no universal strongest ranking |
| EdgeCurrentStateAuthority owns operational interpretation | NOT_IMPLEMENTED | stored heartbeat strings/no expiry |
| CameraCurrentStateAuthority owns interpretation | NOT_IMPLEMENTED | canonicalCameraHealth normalizer only |
| overall healthy/degraded/unavailable/unknown | PARTIALLY_SUPPORTED | useful vocabulary; current core online/degraded/offline/unknown differs; semantics require capability-specific definition |
| retain reachability/stream/frame/recorder/Edge/AI components | PARTIALLY_SUPPORTED | scattered observations exist, recorder/current AI wire missing |
| only canonical transitions feed awareness | CONTRADICTED | two independent transition sources + ambient ingress |
| Edge unavailable does not imply physical camera offline | SUPPORTED as epistemic rule | local external go2rtc independent of cloud; no reliable physical-failure inference |

## 21. Minimum convergence ownership and schema impact

- **Camera identity:** facility_cameras.id, full canonical scope columns, explicit recorder/channel and Edge assignment. Preserve IDs.
- **Edge identity:** edge_nodes estate+edge_node_id plus bound credential identity. Registration is not health proof.
- **Edge observation:** authenticated source-time heartbeat/service report; transport receipt separately recorded.
- **Camera observation:** identified component/path outcome with source time/method/evidence; never generic manually set healthy string disguised as physical observation.
- **Edge current state:** one Backend read interpretation over accepted latest heartbeat/service observations, expiring by effective cadence, returning reason/age. No implementation in this audit.
- **Camera current state:** one Backend pure interpretation of accepted component observations + optional Edge telemetry availability; independent component freshness. Never derive physical failure just from telemetry loss.
- **Spatial projection:** camera_infrastructure placement/zone/relationships; health derived from camera authority, not written by spatial API.
- **History:** edge_heartbeats, camera_health_history and event/media/detection history remain historical. Distinguish source observed_at from received_at.
- **Canonical awareness:** existing frozen ingress receives only accepted canonical camera-state transitions once. Retire duplicate camera producer ingress locally; do not redesign Core.
- **Consumers:** Facility/Consumer/Twin/conversation use same safe DTO, then their existing scope-specific access policy. HLS/media access remains independently authorized.

**No new table is demonstrated necessary for the minimum model.** Existing edge_nodes.metadata can hold versioned latest observations; edge_heartbeats holds history; facility_cameras.metadata can hold namespaced component observations; camera_health_history can journal accepted component/transition records with event_type and metadata. Reuse requires retiring destructive metadata replacement and atomic conditional/monotonic updates. JSON compatibility alone does not supply concurrency control. A focused implementation must choose an existing safe CAS mechanism or an atomic DB operation. If that requires a migration, seek separate authorization; no migration created here.

A dedicated observation table becomes justified only if concurrent component/source rows, indexed source sequence/idempotency or retention queries cannot be expressed safely/economically in current schema. Do not store high-rate frames as health-history rows. Existing camera_health_history requires a camera_id: it must not receive an invented camera ID for recorder-only evidence. Recorder observations could initially use camera_dvrs metadata; associated camera history may reference the recorder in component metadata without pretending it directly observed that camera. A dedicated recorder history schema is deferred until an actual recorder producer exists.

## 22. Proposed cross-repository contract — not implemented

Common envelope (proposal, not current wire):

```text
schema_version: 1
observation_id: stable UUID reused for retries
estate_id, edge_node_id: asserted but validated against credential binding
boot_id: process epoch, not global ordering authority
sequence: monotonic within node boot/component stream
observed_at: source measurement completion in UTC
received_at: Backend-only, never accepted from client as authority
source: producer + method + vantage
subject: canonical camera UUID / recorder UUID / edge node
assignment_revision: optional, required if reassignment replay must be rejected
```

| Contract | State fields and evidence | Freshness/idempotency |
| --- | --- | --- |
| EdgeHeartbeatObservation | runtime_version, effective heartbeat interval, process/service states, outbox depth, sync/error diagnostics; no camera-online inference | Backend computes age; idempotency by observation_id; source order within boot; old boot replay cannot replace accepted newer observation |
| CameraHealthObservation | component=reachability, result succeeded/failed/unknown/not_configured, method ONVIF/TCP/etc, error_code, latency; camera_id distinct stream_id | Independent path freshness; do not claim direct reachability from go2rtc registry |
| Recorder/StreamObservation | subject recorder_id/channel or camera_id+stream_id, method registry/producer/HTTP/RTSP, configured, producer_present, optional measured packets/decoded frames if implemented | Registry evidence != valid media; no invented recorder producer |
| CameraFrameObservation | camera_id, stream_id, acquisition result, acquired_at, optional proven source_frame_at/decoded status, media_id only if stored, validation_method | No image/base64 in health; source frame time null if unknown; acquisition time not sensor freshness; last-success monotonic |
| CameraInferenceHealthObservation | provider/model, enabled, availability, sampled_at/last_success_at, processed/dropped/failures/latency/queue, sample interval; successful zero detections explicit | Separate process epoch/counters; no fabricated success from URL configured; observation idempotency |

Errors sanitized; camera privacy/home/estate taken from full canonical record, not report metadata. Source bounds/future-clock tolerance must be explicit. Use observed_at plus accepted ordering, not received time, for freshness. Do not use sequence across independent processes/components; boot IDs require server acceptance/replay rules. Transition idempotency keyed by canonical state revision/from→to, not transport attempt. Correlation uses canonical subject+tenant; no raw URL/credential in signals.

## 23. Replay, offline operation and performance

Ordinary agent outbox is file-backed; live messages send immediately while older retries remain queued. Flush continues beyond a failed older message. Timer callbacks have no global in-flight lock. Older observations can arrive after newer ones; duplicate retries can overlap. Heartbeat and stream-health have **no source-time or sequence compare**. Media idempotency prevents exact duplicate media creation but older distinct captures can regress last-seen/frame time. Detection idempotency protects event records for matching keys and validates timestamps within7days, but does not establish camera current-state ordering. Device runtime, by comparison, explicitly rejects older incoming provider timestamps (`deviceRuntimeStateService.ts:477–483`); frozen code left untouched.

Offline: external go2rtc can keep streaming and serving local frames independent of cloud. Agent health probes and periodic jobs continue and queue writes; register/discovery cannot create canonical identities offline. Command polling/ack requires Backend, so new remote snapshot/discovery requests cannot execute then. Local AI may continue **only with a usable local registry configuration**: with remote registry selected, processor disables live fallback, runOnce load failure propagates to top-level exit. Hence the broad documentation claim 'AI continues offline' is conditional, not guaranteed. Detection outbox caps500 items by default, newest retained; ordinary heartbeat/health outbox unbounded and no expiry/coalescing; media capped25MiB/20 items. No jitter. File writes are not a durable transactional queue; crash/parse failure can lose queued content.

Scale arithmetic, not measured load test (default30s):

| Cameras/node | Camera health HTTP requests/minute | Approximate minimum camera prior-read+update queries/minute |
| --- | --- | --- |
| 10 | 20 | 40 |
| 50 | 100 | 200 |
| 100 | 200 | 400 |

Alias misses multiply queries up to3 prior reads+3 update attempts per camera. Heartbeat adds node lookup/update+history and audit; each camera update broadcasts and may ambiently enter Core. At10s network timeout, sequential100 camera failures can exceed16minutes while30s timers launch another iteration. This is a concurrency/outbox risk, not a throughput benchmark. Multi-node estate scales linearly; assignment filters prevent legitimate wrong-node updates but no per-source ordering resolves racing reports.

Lists are normally one estate query + in-memory map, no per-camera provider calls; inventory queries DVRs+cameras in parallel. Spatial context bounded policy filtering uses estate camera query. Media/detection event paths have per-record/zone/history queries; inference samples first12 enabled cameras and can starve later ones. History read limits100 do not bound table growth: no camera-health/Edge-heartbeat retention cleanup found. Routine heartbeats produce audit/history and ambient signals; repeated tamper text can produce signal storms.

## 24. Retirement/narrowing candidates

| Candidate | Disposition |
| --- | --- |
| facility_cameras canonical identity/config | KEEP |
| scattered top-level/metadata health fields | NARROW to compatibility projection from accepted observations |
| canonicalCameraHealth name/normalizer | REWIRE behind defined current-state interpretation, retain safe DTO compatibility |
| camera_infrastructure placement/relationships | KEEP |
| independently writable infrastructure health | DEPRECATE; derive display, preserve historical operator assertions separately |
| camera_health_history | KEEP/NARROW event provenance and retention |
| Edge health source/url predicate called reachable | REWIRE terminology/evidence; do not silently upgrade proof |
| persistCameraPlaceholder dead helper | DELETE_LATER after separate cleanup approval |
| aliases/name/host camera identities | DEPRECATE as wire authority; retain explicit compatibility mappings if needed |
| recorder TCP status presented as ongoing health | NARROW to historical probe |
| validate-stream healthy based on config existence | NARROW label/contract; not an observed stream test |
| frontend independent runtime classifier | REWIRE to Backend interpretation with transport-local playback errors separate |
| benchmark synthetic health POST | KEEP diagnostic-only, never production health proof |
| ambient camera/Edge ingress alongside explicit transitions | REWIRE producer-by-producer; keep unrelated awareness unchanged |
| Office live_cameras from device regex | NARROW inventory wording or REWIRE real camera count; not live health |
| local inference counters recreated per sample | REWIRE process-level observation lifecycle |

## 25. Recommended implementation slices and gates

Weights are relative engineering size, not delivery promises: S=localized, M=several contracts/tests, L=cross-repository integration.

| Order | Scope | Repositories | Risk / weight | Dependencies and acceptance |
| --- | --- | --- | --- | --- |
| 0 | Camera safety/identity boundary: complete privacy projections, segment token binding, scope/notification transport checks, UUID versus stream ID contract | Backend, Edge where registry contract changes | High security / M | Existing privacy contracts; negative tests before runtime expansion; do not redesign roles |
| 1 | Source-time/idempotent Edge heartbeat contract and read-time expiry | Backend+Edge | Medium / M | Effective interval and replay tests; stale telemetry must not imply physical camera offline |
| 2 | Minimal stream/frame observations, safe metadata ownership, batching/backpressure | Backend+Edge | Medium-high / L | Canonical assignment/UUID, monotonic update strategy; failed go2rtc check must not replay healthy current state |
| 3 | Persistent inference health observations; recorder only where a real producer exists | Edge+Backend | Medium / M | Zero-detection success, local/offline registry policy; no fabricated recorder/AI health |
| 4 | One pure camera current-state interpretation + agreed capability summaries | Backend | Medium / M | Failure A–J, time/provenance and component semantics fixed; no new generic device authority |
| 5 | Single camera-health transition producer into existing ingress | Backend | High operational / M | Accepted state revision; dedup/replay/stale tests; no incident CAS or Core rewrite |
| 6 | Facility/Consumer/Twin/conversation/Office read convergence and spatial health narrowing | Backend, then affected frontend repos | Medium / L | Safe DTO and tests; no coordinates/navigation redesign; preserve token/media architecture |
| 7 | Compatibility retirement/retention/load/hardware acceptance | Backend+Edge | Medium / M | Verified deployments and rollout observability; legacy rows audited before cleanup |

Do not combine these into a giant rewrite. Decide evidence vocabulary and atomic storage strategy before implementations. Hardware acceptance must include LAN-only operation during cloud outage, camera power loss versus go2rtc loss, cached/frozen frame, inference-only failure, late replay, reassignment and multi-tenant negative cases.

## 26. Audit verification and newly discovered risks

Performed read-only git inspection, repository-wide symbol/table/caller searches, source/migration/document review, and pure in-memory executions of existing helpers (TypeScript transpiled in memory; no app bootstrap, provider call or database access). Pure checks demonstrated stale-online, pending-column precedence and privacy-projection disagreement; Edge checks demonstrated source-string/empty-producer false strength. No full application build/smoke or hardware acceptance is claimed. Existing tests were inspected where relevant: camera-active-context smoke's whole-file binding regex does not prove segment binding.

Most consequential newly established risks:

1. Metadata replacement destroys scope/frame evidence; reduced query projection can alter authorization.
2. Segment camera token binding differs from playlist binding.
3. Operator spatial health and Edge health independently produce canonical transitions; ambient ingress remains additional.
4. No heartbeat expiry; replay turns old evidence into fresh receipt state.
5. go2rtc failure retains healthy camera cache; source string is mislabeled reachability.
6. top-level pending stream_status shadows new online metadata.
7. UUID versus external stream-ID and registry-auth contract mismatch.
8. Local AI health does not reach Backend; per-sample runtime destroys longitudinal metrics; cloud registry outage may stop AI.
9. Notification/realtime/legacy platform routes need privacy hardening independent of safe canonical awareness reads.
10. Unbounded ordinary outbox/history plus overlapping sequential polling at scale.

## 27. Final decision

**Architecture is sufficiently understood to agree a minimum convergence model and authorize bounded implementation slices. It is not yet a truthful unified Camera/Edge Current-State Authority and cannot be declared complete or frozen.** Confirm component vocabulary, threshold calibration and atomic persistence approach before code changes. Production schema/config, frontend integration and real-hardware behavior remain explicit acceptance gates, not assumptions.

Only this audit document added. No source/test/migration changes, no staging/commit, no push/deploy. No CameraCurrentStateAuthority or EdgeCurrentStateAuthority implemented. No heartbeat threshold, camera signal, Twin, incident CAS, meter, Wave7 or frozen execution/device/awareness code changed.
