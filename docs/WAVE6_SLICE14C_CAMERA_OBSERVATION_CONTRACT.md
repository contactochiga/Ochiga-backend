# Wave 6 Slice 14C — Camera Observation Contract v1

2026-09-24. Local implementation and test acceptance only. No push or deployment. This contract records evidence; it is **not CameraCurrentStateAuthority**.

## 1. Baselines and protected work

Backend main: `556ac32d3548b720783924cef0d78a9e2c2bf3dc`; local origin/main `909d5d0a35ab2de84c7cdc83d0f10be166e0b512`, ahead 8 / behind 0 before this slice. Edge main/origin/main: `5d30b63866197d6b674951bfdce2dd1211e76d24`, clean before this slice. No fetch. Final SHAs are in the completion report/Git history rather than self-embedded here.

Preserved unrelated Backend work: scripts/pilot-import.mjs, src/routes/me.routes.ts, Aider files/cache, Digital Twin contract doc, earlier untracked Camera/Edge audit, opencode.json, pilot/luna-residences and five 20260905 LOCAL_TEST migrations. No reset/stash/cleanup. Edge's existing ignored runtime outbox/configuration is not committed. Runtime camera outboxes are explicitly ignored.

Read the cross-repository audit and Slice14A/14B closure documents before implementation. Physical execution, generic device authority, awareness, Edge heartbeat authority, camera access policy, canonical camera-health transition helpers and Twin implementation remain untouched.

## 2. Existing observations and actual proof

| Mechanism/source | Timestamp, transport/persistence | What it proves / limitation |
|---|---|---|
| WS discovery / static camera registry | Discovery dates / configured records | Candidate/configuration, not successful runtime access |
| ONVIF Cam connection and discovery work | New per-endpoint completion time; command result plus observation outbox | ONVIF operation succeeded, authentication failed, or connection attempt failed; not video |
| ONVIF GetStreamUri | Candidate rtspAvailable/URI locally | URI supplied, not RTSP decode or live video |
| Subnet TCP scanner | Existing bounded scan | Host:port accepted a connection; no continuous recorder health producer added |
| go2rtc API inspection | Source completion time, ordinary durable outbox | Registry entry and producer/consumer counts; empty producer objects do not prove moving video |
| Snapshot helper | capturedAt at acquisition completion; media and observation transport | Bounded HTTP200 bytes with JPEG/WebP signature; not decoded image or advancing sensor timestamp |
| AI snapshot | Now reuses bounded snapshot validation | Independent frame acquisition, including zero-detection samples |
| AI provider call | Per-sample completion; bounded observation outbox | Valid response with detections/events array, explicit failure, skipped or dropped sample |
| camera_media | Original capture time + existing durable private media | Media history, not an overall health authority |
| camera_detections/events | Existing timestamps/idempotency and tenant policy | Detector output history; no detections is not failure |
| Backend DVR test/import | Existing test metadata/one-time TCP outcome | Reachability from Backend network at that time; operator channel count is configuration |

Reproductions before editing: source-only go2rtc configuration and empty producer both yielded streamAvailable=true; a four-byte JPEG signature passed the existing helper; inference could process a sample successfully with zero detections. Current implementation preserves these evidence-strength distinctions rather than asserting stronger proof.

## 3. Wire vocabulary and source semantics

Envelope (no image, URL, credentials, Home, or client receipt timestamp):

```json
{
  "schema_version": 1,
  "observation_id": "stable UUID allocated when observed",
  "camera_id": "canonical facility_cameras UUID",
  "edge_node_id": "bound Edge identity",
  "kind": "frame",
  "source": "go2rtc_snapshot",
  "observed_at": "source UTC measurement-completion timestamp",
  "result": "acquired",
  "details": {
    "mime_type": "image/jpeg",
    "size_bytes": 12345,
    "validation": "bounded_image_signature",
    "latency_ms": 12
  }
}
```

| kind | source | allowed result | Interpretation |
|---|---|---|---|
| stream_configuration | go2rtc_registry | configured / not_configured | Stream registration only |
| stream | go2rtc_inspection | inspected / failed | API inspection with stream_present, producer_count, consumer_count; not active video |
| reachability | onvif_probe / tcp_probe | succeeded / failed / authentication_failed | Method-specific endpoint result; current camera producer is ONVIF, TCP remains existing scanner/recorder capability, not a new recurring producer |
| frame | go2rtc_snapshot / ai_snapshot | acquired / failed | Validated acquisition attempt, not decoded/fresh sensor evidence |
| frame | media_ingestion | acquired | Reserved Backend-only repair from persisted authorized snapshot/event_snapshot |
| inference | external_detector | succeeded / failed / skipped / dropped | One attempt, not longitudinal AI health |

Results are not healthy/degraded/unavailable/unknown camera states. An inspected source-only entry has producer_count=0; no stream-available boolean is created. Even producer_count>0 proves only returned producer presence. Failed inspection clears previous local camera-health data and generates new failed-inspection evidence rather than resending a prior success as new. Missing probe remains absence. Successful inference with zero detections is explicit succeeded/detection_count=0. Invalid provider response shape and non-2xx transport fail; no configuration-only provider success is inferred.

## 4. Canonical identity and authorization

New GET `/edge/camera-observation-registry` uses existing requireCameraEdgeToken and returns only cameras assigned to the authenticated estate/node, capped at 1000. Output separates canonical_camera_id from sanitized stream_id; host supports unambiguous existing ONVIF discovery association. No credentials or Home/privacy metadata returned. Duplicate stream identifiers are not used to fabricate two camera observations. Unprovisioned/ambiguous discoveries remain candidates.

Existing user-authorized edge registry gains additive canonical_camera_id/stream_id without replacing camera_id. Snapshot commands retain canonical cameraId and add streamId for capture only. Media/detection/observations use the canonical UUID. No duplicate camera records. Legacy external-only local AI registry entries without canonical UUID now fail closed/skipped instead of guessing identity.

POST `/edge/camera-observations` requires existing bound camera Edge credentials. Backend derives estate/node from authenticated identity, never payload scope. Unbound legacy credentials are denied by Slice14A middleware. Node mismatch is rejected before RPC; SQL rechecks estate and node against locked canonical rows. Scope fields inside observations are invalid. Backend-only media_ingestion source is denied on this Edge endpoint. Public camera access policy/HLS/media audience rules are unchanged.

The AI processor defaults to the new bound registry when no explicit registry override exists; explicit registry paths/URLs are preserved. A bound registry uses Edge credentials even when a separate old registry token is configured. Old user-auth registry URLs can still reject an Edge token; operators must deliberately migrate explicit overrides. Local canonical registry configurations permit offline AI; an unavailable remote-only registry still cannot support new sampling.

## 5. Approved persistence migration

File: `supabase/migrations/20260924093033_wave6_camera_observation_persistence.sql`.

Exactly one nullable column: `public.facility_cameras.runtime_observations jsonb`. No default/backfill of existing legacy state. No new table. No camera_health_history reuse. No camera_infrastructure writes.

Exactly one RPC:

```sql
public.oyi_ingest_camera_observations(
  p_estate_id uuid,
  p_edge_node_id text,
  p_observations jsonb
) returns jsonb
```

Projection structure:

```text
{ version: 1, dimensions: {
    "stream:go2rtc_inspection": { latest: <envelope + server received_at> },
    "reachability:onvif_probe": { latest: <envelope + server received_at> },
    "frame:go2rtc_snapshot": {
       latest: <last attempt + server received_at>,
       last_success: <latest acquired frame + server received_at>
    },
    "frame:ai_snapshot": { latest: ..., last_success: ... },
    "frame:media_ingestion": { latest: ..., last_success: ... },
    "inference:external_detector": { latest: ... }
} }
```

Dimension key is kind + allowlisted source: different acquisition/probe paths do not overwrite one another. There is no global ordering/freshness timestamp. Future authority can read each last_success.observed_at; this slice does not aggregate or classify camera freshness.

### Ordering, replay and atomicity

- Validate entire bounded batch first; resolve camera UUIDs; lock rows in deterministic UUID order; recheck estate/node while locked; reject missing or unauthorized rows. Every mutation in the RPC rolls back on any error.
- Latest ordering uses `(observed_at, observation_id COLLATE C)`. Greater source timestamp wins; equal timestamps use lexical UUID-string tie-break, not receipt order. This is deterministic, not a claim of causal ordering within a clock tick.
- Duplicate retained observations do not update timestamps. Reusing a retained ID with changed content is rejected. Older reports cannot replace latest; an older successful frame may still advance last_success if newer than the retained success. Later failure does not erase success.
- observed_at is original source time. received_at is database clock at RPC entry (may precede lock wait/commit). Replayed payloads retain IDs/times.
- Projection is NOT a permanent journal. IDs evicted from latest/last_success are not permanently remembered; unchanged old replays remain non-regressive by source-time comparison. No permanent dedup-history guarantee claimed.
- Corrupt non-null projection shape fails closed. No compatibility metadata/updated_at/health field is rewritten by the RPC.
- No SQL or application canonical signal, incident, camera-health transition, provider poll or inference trigger.

### Payload and privilege bounds

1–128 observations, <=512KiB JSONB text; details <=2KiB. UUID-format camera/observation IDs, bounded node ID, fixed kind/source/result allowlists. ISO timestamp with timezone, year >=2000, no infinity, max ten seconds future lead; no receipt fallback or maximum replay age. Details accept only typed metrics, booleans, constrained MIME/validation/error enums and Backend media correlation. Unknown/nested arbitrary metadata, URLs, credentials, tokens and image bytes are rejected. Frame acquired requires signature-validation evidence, MIME and positive size <=5MiB. Generic metrics are nonnegative/bounded.

SECURITY INVOKER, empty search_path, qualified public tables. EXECUTE revoked from PUBLIC/anon/authenticated; granted to service_role. Existing table RLS/client revokes remain. Database administrative owner access is not represented as a new client privilege. API maps denial 403, malformed input 400, persistence failure 503; no non-durable success acknowledgement.

## 6. Media retry and frame preservation

`repairMediaFrameObservation` runs after a new successful media insert and on duplicate/existing-media retry. It uses media UUID as stable observation ID, canonical media camera/node/estate, matching original supplied capture timestamp, stored MIME/size, and signature-validation provenance. If RPC fails, return retriable 503 while retaining the already stored media; retry repairs projection without another blob upload. Missing/unprovable legacy capture timestamps do not fabricate observations. Thumbnail/clip/recording rows do not imply live frame acquisition.

This is an explicitly repairable storage saga: blob/catalog persistence is not claimed atomic with observation RPC. The RPC batch itself is atomic. Existing media/event relationship and authorization behavior remain. Existing legacy frame_freshness_at metadata writes remain compatibility behavior, not authoritative observation input. Later stream/legacy metadata replacements cannot erase the independent column.

## 7. Edge production and offline behavior

Agent emits bounded configuration/inspection batches via existing durable outbox; it no longer sends configuration-derived online reports to legacy stream-health. Existing Backend legacy route/classifier remains unchanged for old agents. This can leave legacy display fields stale until later read/health convergence: do not label them the new authority.

Remote snapshot commands emit acquisition/failure evidence and retain canonical identity independently of stream key. Discovery emits mapped ONVIF outcomes at each endpoint completion, not scan-start time. No standalone RTSP decode or recorder-channel-health producer invented.

AI now uses the bounded image helper and emits independent acquisition + per-sample inference results, including zero detections. Per-sample runtime/provider recreation is retained; metrics are per sample, not process uptime/history. Sampling drops are represented when the runtime supplies them. Frame failure does not become camera failure. No persistent inference-runtime redesign.

Observation IDs created once survive ordinary/outbox retry. Agent camera-observation queue is capped at 256 batches/10MiB, evicting oldest camera-observation batches only; other queues are not redesigned. Separate AI observation outbox is capped at 500 batches using existing DetectionOutbox. These are bounded latest-evidence transports, not lossless journals. Exhausted retention, file corruption or crash may lose evidence; absence stays absence. Stream mapping survives a cloud outage in process memory; after restart without canonical mapping, no camera identity is fabricated. AI offline continuity requires a usable local canonical registry.

AI dry-run now skips detection-outbox delivery and performs no inference. Existing release checks still make read-only registry/health probes; they are not hardware acceptance.

## 8. Existing field disposition / frozen boundaries

| Field/store | Classification / disposition |
|---|---|
| facility_cameras identity/estate/Home/privacy/assignment/NVR/channel | Canonical identity/configuration; KEEP |
| status (includes disabled), health_status, stream_status | Mixed configuration/legacy derived state; KEEP, no backfill |
| last_seen_at, last_health_check_at, last_success_at, last_failure_at | Legacy mixed source/receipt projections; KEEP, not new observation truth |
| latency_ms, provider_error, reconnect_count | Legacy component diagnostic projections; KEEP |
| metadata.frame_freshness_at / normalizer output | Legacy capture projection; KEEP, may remain null/out of order |
| runtime_observations | New latest source-time component evidence only |
| camera_media / detections / events | Existing historical evidence, retained |
| camera_health_history | Existing operator/health history; no raw observations added |
| camera_infrastructure | Unchanged mixed legacy/spatial projection; no new writer |

No changes to classifyCameraHealthTransition, submitCameraHealthCanonicalSignal, canonicalCameraHealth, EdgeCurrentStateAuthority, device authority, physical execution, canonical awareness, Twin, incident CAS or meters. No CameraCurrentStateAuthority implemented. Existing camera media/detection signals remain existing paths; new observation ingestion is silent.

## 9. Validation and scale

Real PostgreSQL dedicated suite builds isolated disposable databases from repository camera schema, applies the actual migration, and drops only those fixtures. Covers service-role ACL, null existing rows, actual Edge envelopes, independent dimensions, source/receipt separation, last-success preservation, duplicate/conflict/equal-time behavior, metadata independence, wrong node/cross-estate/missing camera/scope spoof, payload bounds, concurrent ingestion, actual trigger-induced failure on second camera rolling back first camera, and 10/50/100-camera batches with untouched legacy health. No migration applied to shared local or production DB.

Backend functional suite calls actual media ingestion and actual observation route with selected-field-aware tenant fixtures: persistence failure then existing-media repair, stable ID/time, no extra blob write, denied assignment, reserved-source denial, 503 retry, zero signals, scoped registry, and one RPC for 10/50/100 observations. Cross-repository SQL suite imports the actual Edge envelope builder; set OYI_EDGE_CHECKOUT to override sibling checkout location.

Edge suite exercises actual snapshot helper, actual inference runtime and processor with local HTTP detector fixture, zero detections, failure/skip/drop, malformed image, source/config distinction and durable file-outbox replay. Gateway regression now explicitly expects producer_present, not stream_available, and proves ONVIF success/auth failure/connection failure/absence. No permissive replacement of policy assertions.

Backend typecheck/build pass. Eighteen Backend scripts pass: Slice14C functional, Slice14B authority, Slice14A privacy, Slice1, Slice1B, camera intelligence convergence, canonical signal ingress, awareness V3, security adversarial, Consumer context, Facility spatial context, Slice13, Slice13C, Wave5 Slice1 physical authority, camera active context, camera runtime Phase1, media Phase4 and detection Phase5. Slice14B real SQL suite also passes. Passing scripts exit normally; no hidden passing-assertions/hung-process classification.

Edge observation, runtime canonicalization, gateway, media, detection, syntax/check, lint, build and release validation pass. Initial missing local onvif dependency was corrected with npm ci --ignore-scripts using unchanged lockfile (0 vulnerabilities); existing deprecation warnings are nonblocking. Existing release readiness checks reported unavailable local go2rtc/credentials and a 401 from the old configured user-auth registry endpoint; these are genuine deployment/hardware readiness limitations, not successful runtime playback. Those checks make read-only requests, not a deployment. No real camera, inference hardware, lock, payment or production mutation performed.

Supabase error-level security advisors returned no issues on existing shared local DB, NOT certification of the isolated migrated fixture. Fixture-specific ACL and rollback tests supply migration proof. Migration list confirms new migration is not applied to shared local DB. No missing-service-role-key failure or remote onboarding pass is claimed for this slice.

| Assigned cameras | Stream facts/minute at 30s cadence | Observation batch HTTP requests/minute |
|---|---:|---:|
| 10 | 40 | 2 |
| 50 | 200 | 2 |
| 100 | 400 | 4 |

Plus one assigned-registry query per heartbeat (2/minute). SQL locks canonical rows in a batch; one RPC per <=128 observations, per-camera updates inside transaction, no per-observation HTTP camera lookup or provider polling. No raw observation history growth/signals. AI default max12 cameras/15s yields at most about96 frame+inference facts/minute before processing delays (10 cameras:80); larger camera fleets are not all sampled under that existing cap. Snapshot commands are on-demand; existing event media persistence remains separate. No throughput or hardware benchmark claimed.

## 10. Rollout / compatibility (not executed)

1. Review real migration inventory and existing table grants/RLS. Apply only this additive migration through normal workflow, not unrelated LOCAL_TEST files. Existing rows remain null. Check service-only RPC and schema cache availability.
2. Deploy Backend ingestion, bound registry, snapshot stream key and media retry support. New Backend requires migration; absent RPC returns failure, not fake persistence. Old Backend is schema-compatible and cannot erase the dedicated column through existing metadata updates, but does not ingest the new contract.
3. Deploy Edge producer with proper bound credentials and canonical registry mapping. Explicit old registry URLs/local external-only IDs require deliberate configuration correction. Old agents continue legacy endpoints but cannot populate runtime_observations; do not backfill their status as evidence.
4. Verify cross-repository frames, zero-detection success, failure/absence, source time, replay, assignment denial, and media retry in a controlled environment. Separately verify real camera/recorder paths, clock synchronization, cloud outage and canonical stream mapping.
5. If rolling back application versions, retain additive column/data. Old binaries are compatible, not observation-converged. No destructive rollback migration.

## 11. Completion boundary

The v1 Camera Observation Contract is locally complete and can be frozen as an evidence contract, not as a production/hardware certificate. Remaining limitations are explicit: signature-only images, no advancing-frame guarantee, producer presence not video, no ongoing recorder/channel observer, per-sample AI lifecycle, bounded lossy outbox, remote-only registry offline limitation, no permanent ID journal, and legacy display/health fields not converged. Wave6 may proceed to CameraCurrentStateAuthority under a separate task. This slice stops before that work, signal convergence, Twin migration or camera_infrastructure retirement.
