# Wave 6 Slice 14D — Camera Current-State Authority

Local source/fixture acceptance, 2026-09-24. No push, deployment, reader migration or production access.

## 1–2. Baselines and scope

Backend main started at `8f5a3d88630c3e4061dc82059b93c38187d090f9`, local origin/main `909d5d0a35ab2de84c7cdc83d0f10be166e0b512`, ahead9/behind0. Edge main `d2715f1cef7d9291c0ec1cda546551d91e1d2562`, local origin/main `5d30b63866197d6b674951bfdce2dd1211e76d24`, ahead1/behind0, clean and unchanged. No fetch. Final Backend SHA is in Git/completion report, not self-embedded.

Unrelated Backend changes preserved: scripts/pilot-import.mjs, src/routes/me.routes.ts; Aider files/cache; prior untracked audit; Digital Twin contract; opencode.json; pilot/luna-residences; five 20260905 LOCAL_TEST migrations. Nothing reset, removed or broadly staged.

Read Camera/Edge audit and Slice14A/B/C records, Edge14C contract, actual policy, SQL projection, Edge producers and Edge authority. Supabase skill used for read-boundary review; no schema or privileges changed.

## 3. Frozen observation inventory

All accepted envelopes have schema_version, observation_id, canonical camera_id, edge_node_id, kind, source, result, original observed_at and server received_at. `runtime_observations` version1 stores latest per kind/source; frame slots also retain last_success. Receipt never determines freshness. No contract changes.

| Dimension/source | Results and detail | Proof and limits |
|---|---|---|
| stream_configuration/go2rtc_registry | configured, not_configured | Configuration seen by registry inspection, not video |
| stream/go2rtc_inspection | inspected, failed; stream_present, producer_count, consumer_count, error_code | Inspection result; even producer presence is not decoded/advancing video |
| reachability/onvif_probe | succeeded, failed, authentication_failed; latency/port/error where supplied | Method-specific control endpoint result, not RTSP/video |
| reachability/tcp_probe | same vocabulary | Particular endpoint result; envelope has no recorder identity/vantage, cannot attribute it to an NVR merely because camera.nvr_id exists |
| frame/go2rtc_snapshot | acquired, failed; MIME, size, bounded_image_signature, latency/error | On-demand acquisition, signature only; last_success preserved |
| frame/ai_snapshot | acquired, failed; same details | Sample acquisition, not continuous/advancing video; last_success preserved |
| frame/media_ingestion | acquired; media correlation/MIME/size/validation | Backend-verified stored frame evidence, source capture time; last_success preserved |
| inference/external_detector | succeeded, failed, skipped, dropped; detection_count, queue_depth, latency, dropped_samples/error | Per-sample result; zero-detection success is success; not longitudinal AI uptime |

Details are projected through a finite key list; no raw registry metadata, media URLs, credentials or image bytes leave the interpreter. Identity/provenance/version/timestamps and successful frame validation evidence are checked defensively. Changed assignment invalidates old-node observations. No observation producer is added.

## 4–6. Contract and overall definition

`CameraCurrentState` is the inferred exported return type of `cameraCurrentState` in src/modules/cameras/cameraCurrentStateAuthority.ts. It contains cameraId, capability=`observed_video_acquisition`, overall, videoEvidence, configuration, reachability, stream, frame, recorder, edge, inference, reasons, sources and informational observedAt.

Each observation-bearing component retains state, freshness, reason, evidence[] and lastSuccess[]. Evidence retains source/kind/result/id, observedAt, receivedAt, ageMs, policy/basis and sanitized details. No speculative confidence score. There is intentionally **no global freshness bucket**: the maximum observedAt is informational, never used to freshen another component.

Overall is explicitly a summary of **observed video acquisition**, not certification of continuous HLS playback, image decoding, physical power, recording, recognition, or all configured features:

- healthy: at least one fresh latest acquired frame on a path, with no observed current impairment/aging component/known Edge impairment or invalid-evidence warning.
- degraded: that fresh successful path remains evidenced but another component/path is impaired, has aged, or Edge telemetry is impaired. Unknown optional components alone do not prove failure.
- unavailable: a fresh latest frame attempt failed and no fresh latest successful acquisition path exists. Means observed acquisition unavailable, **not camera physically offline**.
- unknown: no sufficient fresh acquisition outcome; configuration, inspection, reachability, missing evidence and expired evidence do not establish video health.

This is the strongest defensible existing capability. A signature-valid image proves the acquisition worked at T, within a declared recency policy; it does not prove sensor motion or continuous playback. No new Edge evidence is required to return honest unknowns.

## 7–15. Components, freshness and disagreement

Latest frame attempt drives current interpretation per source. Retained last_success is independently returned as historical evidence with its own age/policy. A newer failure is never overwritten by the existence of a success. Across independent paths, a fresh success and failure coexist → degraded, rather than universal source ranking.

Stream state `inspected` is intentionally not called available. Failed inspection says the management/API inspection failed, not that HLS or recorder video failed. ONVIF failure plus acquired frame → control-plane degradation, video evidence retained. ONVIF authentication_failed remains visible in evidence; it is not proof of unreachable hardware.

Recorder component remains unknown/unspecified with reason no_recorder_bound_observation_contract. TCP success/failure remains method-specific reachability. Frozen14C has no recorder identity/channel observation; existing operator TCP history is not imported as current evidence. This is a capability limitation, not permission to invent a recorder producer or reopen14C.

Edge is interpreted by the unchanged frozen `edgeCurrentState` using only the assigned node with matching estate. Expiry makes Edge telemetry unavailable; it never changes camera observation timestamps, manufactures failure or writes camera state. Fresh acquisition plus expired Edge can remain usable/degraded. Unknown Edge alone does not negate independently available video evidence. Only limited Edge knowledge (connectivity/freshness/reason/times) is returned, not estate-wide node records.

Inference preserves success including zero detections, failed, skipped and dropped. Failure/skip/drop alongside fresh video degrades the summary, not video evidence. No samples means unknown, not failed. Queue/count/latency remain per-sample details; no invented process health.

### Freshness policy

| Sources | Default fresh/stale/expired policy | Basis / limitation |
|---|---|---|
| go2rtc inspection/configuration | fresh <=3H+10s, stale <=6H+10s, then expired | Runs with heartbeat. H from assigned Edge authority policy or Backend expected30s; default100s/190s. Three/six scheduled opportunities plus10s transport allowance; expectation, not measured SLA or agent acknowledgement |
| AI frame/inference | same3H/6H+10s rule, H=Backend CAMERA_AI_INTERVAL_MS or15s | Edge loop default15s; default55s/100s. Sequential camera processing, provider delay, max12-camera cap and CLI/env overrides mean actual cadence can differ. This conservatively ages evidence; it never treats late receipt as fresh |
| ONVIF/TCP, on-demand snapshot, media_ingestion | unspecified | No defensible repeat interval supplied by frozen envelope. Timestamp/result retained but no current healthy/unavailable claim made from these alone |

Trusted internal options.windows may specify per-source freshMs/expiresMs/basis when an integration has an established sampling requirement. Positive finite ordered windows and nonempty justification are required. These options are NOT accepted from an HTTP request or observation payload. Tests explicitly supply a fixture probe schedule to test fresh/stale success/failure; they do not pretend deployed probes report a cadence. Invalid Backend AI interval disables those implicit windows instead of fabricating one.

Ten-second future tolerance follows14C ingestion's clock bound. Observation and receipt must be finite; observed cannot exceed receipt+10s or read clock+10s; receipt cannot exceed read clock+10s. Impossible times fail closed. Age is always now-observedAt. No restart/cache timestamp reset.

No simplistic frame>ONVIF priority: components describe different claims. Fresh frame can coexist with failed control or failed inspection. Stale/expired ancillary evidence warns rather than rewriting video evidence. Unspecified recency does not silently become fresh.

## 16–19. Failure matrix / legacy disagreements

| Scenario | Current authority result |
|---|---|
| A fresh frame, successful reachability/inspection/inference, healthy Edge | healthy, recent_acquisition |
| B ONVIF success, inspection failed, no fresh frame | unknown video; explicit failed inspection retained. Unlike a video request failure, frozen stream result does not prove video unavailable |
| C inspected stream, stale frame | unknown video; frame stale retained |
| D fresh video, failed inference | degraded, video remains evidenced |
| E expired Edge, old camera success | unknown camera, telemetry unavailable; no physical offline claim |
| F expired Edge, fresh acquired frame | degraded, recent_acquisition retained; recorder is not fabricated |
| G failed ONVIF, fresh frame | degraded, control-path failure and video evidence both retained |
| H legacy online, fresh frame failure | unavailable acquisition; legacy online ignored |
| I infrastructure/registry offline, fresh good evidence | healthy when no other observed impairment; legacy fields ignored |
| J never observed | unknown |

Fresh frame failure with retained success also returns unavailable acquisition when no other fresh latest successful path exists. Configured-only returns unknown. Missing probe/frame/inference never turns into failure. facility_cameras.status/health_status/stream_status/last_seen_at/frame_freshness_at and metadata health never enter runtime interpretation. Metadata is read solely for the existing access policy.

## 20–29. APIs, privacy and frozen boundaries

- Pure `cameraCurrentState(camera, actor, assignedEdgeRow?, options?)` requires full CAMERA_CURRENT_STATE_SELECT and canonical camera policy before returning information. Caller actor must already be authenticated/membership-resolved. No users.home_id resolution/fallback is added.
- `resolveCameraCurrentStates(estateId, cameraIds, actor, options?)` takes <=100 explicit IDs in one estate: one camera projection query, canonical-policy filter, at most one assigned-Edge projection query, then the pure interpreter. Missing/denied IDs return no result. DB failure throws with a low-cardinality failure counter, not a fabricated status.
- CAMERA_CURRENT_STATE_SELECT reuses CAMERA_ACCESS_SELECT (including canonical Home/privacy/legacy policy metadata), plus assignment/configuration/runtime projection. Reduced incomplete projections fail closed. Existing platform-role exceptions remain exactly those in canAccessCamera.
- No cache, provider requests, Edge polling or history scan. One read clock per batch. Restart is identical given same persistent projection and clock.
- canonicalCameraHealth is LEGACY_NORMALIZER / COMPATIBILITY_PROJECTION / REWIRE_LATER. Existing consumers remain intentionally unmigrated for14F. It is not imported or used as competing evidence. This slice creates one new authoritative interpreter, **not end-to-end reader convergence**.
- camera_infrastructure untouched/unread; later narrowing target. No legacy field mutation, new signal call, canonical awareness change or feedback loop. New file contains no insert/update/RPC path.
- Counters: camera_current_state_reads_total with only four-valued overall label; camera_current_state_read_failures_total with no labels. No camera IDs/private content in metrics/logs.

Deterministic explanations include recent_signature_valid_frame_acquired_not_continuous_video_proof, stream_inspection_failed_not_video_failure_proof, control_endpoint_failure_does_not_negate_frame_evidence, inference_failed_not_camera_failure and edge_telemetry_impaired_not_physical_camera_offline. Components retain evidence to phrase narrower resident-safe answers later. No conversation reader is changed here.

## 30–37. Validation

Dedicated `scripts/wave6-slice14d-camera-current-state-smoke.mjs` tests components, A–J, current latest failure versus retained success, conflicting paths, unspecified probe freshness, TCP success/failure without invented recorder binding, zero detections, skips/drops, invalid/future/wrong-node observations, legacy disagreement, deterministic cold reads and receipt-independent freshness. It tests private/common/cross-estate role outcomes, reduced projection rejection, selected-column-aware batch queries, DB failure, metric labels and no mutation/signal/history/provider paths.

1/10/50/100 cameras each require exactly two bounded queries when assigned Edge nodes exist, otherwise one. All-denied batches load no Edge rows. No history/provider queries. This is query-complexity proof, not a hardware latency benchmark.

Typecheck/build and dedicated14D suite pass. Required regressions pass with normal exit:14A privacy(15 groups),14B Edge authority(16),14C Backend functional, Slice1(24),Slice1B(53),Slice13 device(31),awarenessV3,Wave5Slice1 physical(7),security adversarial. Edge14C compatibility suite passes; Edge source unchanged.

14C real PostgreSQL suite passes all10 groups including ordering/concurrency/rollback using isolated disposable DB. 14B real SQL suite passed all10 groups on rerun. Its first run hit a **pre-existing timestamp-format assertion** at line48 comparing PostgreSQL `.57+00:00` against JS `.570+00:00` for identical instants; test file is byte-unchanged from HEAD. This is not an ingestion/order failure or missing-env issue. Frozen test/runtime left unchanged; report the flaky test rather than hiding it.

No environment-only failures in the executed14D checks. No real-camera/provider/production acceptance claimed. No new migration; existing SQL suites apply only their disposable fixtures. No local shared or production schema changes.

## 38–47. Files, gaps and completion

Intended files only:

1. src/modules/cameras/cameraCurrentStateAuthority.ts (new)
2. scripts/wave6-slice14d-camera-current-state-smoke.mjs (new)
3. package.json (one smoke entry)
4. this report

No Edge edits/commit, migrations, reader changes, health-signal changes, physical/device/awareness/Edge-authority changes. One local Backend commit after acceptance; no push/deploy.

Remaining evidence limits: decoded/advancing video not proven; on-demand evidence has unspecified recency absent a justified policy; no recorder-bound observation; effective AI cadence unacknowledged and sequential; legacy readers/signals remain for14E/F. The existing14B SQL timestamp string comparison is a test-harness follow-up, not a reason to modify frozen state logic here.

One Backend Camera Current-State interpreter now exists and can be frozen at this local evidence-contract boundary. It does not certify production/hardware health or claim every reader already uses it. Wave6 may proceed to separately authorized Camera Health Signal Convergence, taking care that unavailable means the defined acquisition capability and unknown never becomes physical offline. Stop after this slice.
