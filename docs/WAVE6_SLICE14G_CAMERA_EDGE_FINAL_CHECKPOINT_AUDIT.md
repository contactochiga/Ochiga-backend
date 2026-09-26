# Wave 6 Slice 14G — Final Camera/Edge checkpoint audit

Audit date: 2026-09-24. Local, cumulative audit of Slices 14A–14F. **Verdict B: SAFE TO PUBLISH WITH EXPLICIT PRE-DEPLOYMENT BLOCKERS.** Publishing is not deployment. No source/test edits, migration creation, commit, push or deployment performed. This document is intentionally uncommitted.

## 1. Candidate and protected working trees

| Repository | Branch | HEAD before and after audit | Locally recorded origin/main | Ahead / behind |
|---|---|---|---|---|
| Backend `/Users/ochigaidoko/Documents/Ochiga-backend` | main | `0dce3d0d9e39180f8feb5a57c6d16962bc615d90` | `909d5d0a35ab2de84c7cdc83d0f10be166e0b512` | 12 / 0 |
| Edge `/Users/ochigaidoko/oyi-edge-agent` | main | `d2715f1cef7d9291c0ec1cda546551d91e1d2562` | `5d30b63866197d6b674951bfdce2dd1211e76d24` | 1 / 0 |

Both expected HEADs match. Neither repository was fetched/pulled: origin/main is the local remote-tracking reference, not a newly verified remote tip. Edge is clean. Backend has no staged changes. Protected unrelated unstaged changes: `scripts/pilot-import.mjs` and `src/routes/me.routes.ts` (33 insertions, 4 deletions total). They are not part of the checkpoint commit range.

Protected pre-existing untracked work: `.aider.chat.history.md`, `.aider.input.history`, `.aider.tags.cache.v4/`, `docs/OYI_DIGITAL_TWIN_ASSET_CONTRACT.md`, `docs/WAVE6_CAMERA_EDGE_HEALTH_AUTHORITY_AUDIT.md`, `opencode.json`, `pilot/luna-residences/`, and the five `20260905010000` through `20260905050000` LOCAL_TEST migrations. None was staged, removed or included in the candidate. The only intended new repository file from this audit is this document. Test logs and search inventories are under `/tmp/14g-*` and are not commit candidates.

## 2. Ordered unpublished checkpoint ledger

| Order | Backend commit | Area |
|---|---|---|
| 1 | `8d869d0` | Wave 6H.1 awareness/privacy: fail closed on unverified scope |
| 2 | `e0b2fa8` | Wave 6I visitor approval/maintenance transition concurrency |
| 3 | `673920d` | Wave 6J shared freshness contract |
| 4 | `14c7bdc` | Wave 6K device current-state authority |
| 5 | `5966856` | Wave 6K.1 device consumers |
| 6 | `63c4fb4` | Wave 6K.2 residual generic device read closure |
| 7 | `a4852f1` | 14A Camera runtime privacy/media boundaries |
| 8 | `556ac32` | 14B Edge current state + atomic heartbeat ingestion |
| 9 | `8f5a3d8` | 14C Camera observation persistence |
| 10 | `057eea2` | 14D Camera current-state interpretation |
| 11 | `8181f9d` | 14E durable transition acceptance/delivery |
| 12 | `0dce3d0` | 14F generic camera readers |

Edge has exactly one unpublished commit, `d2715f1` (Wave 6N Edge: emit truthful camera observations), paired with Backend `8f5a3d8`. It adds canonical UUID/stream-ID separation, truthful stream/frame/inference envelopes and durable replay integration, plus contract tests/documentation. It is not a heartbeat redesign. Publication should identify these two repository tips together; deployment ordering is different from commit chronology.

## 3. Credential hygiene

Scanned added lines in every unpublished commit, including intermediate commits, in both repositories for private-key headers, common API/provider key formats, JWTs, Bearer literals, password/token/service-role literals and credential-bearing HTTP/RTSP URLs. Reviewed the fixture-only candidates: synthetic smoke credentials, redaction sentinels and deliberately forbidden test URL inputs. No real committed credential was identified; no values are reproduced here. Edge's filename-based secret check also passes, but is not a substitute for content scanning.

This is a pattern/source review, not a mathematical proof that arbitrary secrets cannot exist. No gitleaks/trufflehog certification is claimed. Untracked environment/pilot/Aider content is outside the publication candidate and must not be swept into a later commit. If publication review finds a real credential, stop publication and handle revocation/history remediation separately.

## 4. Production migrations and ordering

Only three production migration files were added in the unpublished range. LOCAL_TEST files are unrelated and excluded.

| File | Additions / dependencies | Compatibility and locking |
|---|---|---|
| `20260924090934_wave6_edge_current_state_atomic_ingestion.sql` | Nullable `edge_nodes.heartbeat_observed_at`, `heartbeat_received_at`, `heartbeat_observation`; `edge_heartbeats.observed_at`; partial unique source-time history index; `oyi_ingest_edge_heartbeat(uuid,text,jsonb,integer)` | Requires existing Edge foundation tables/unique node identity. Per-node row lock, conditional latest projection and history in one transaction. Index build and ALTER locks need production scheduling. Old code tolerates additive schema but does not establish new observation truth. |
| `20260924093033_wave6_camera_observation_persistence.sql` | Nullable `facility_cameras.runtime_observations`; `oyi_ingest_camera_observations(uuid,text,jsonb)` | Existing canonical cameras/assignment required. Deterministic camera row locks; bounded whole-batch transaction. Old metadata writers cannot erase this separate column. New ingestion requires RPC; no invented fallback. |
| `20260924101810_wave6_camera_health_transition_outbox.sql` | Nullable `health_transition_checkpoint`; dedicated `camera_health_transition_outbox`, constraints/indexes/RLS; `oyi_accept_camera_health_transition(uuid,jsonb,jsonb,jsonb,jsonb)` | Depends on observation and Edge projections. Edge-table SHARE lock, relevant Edge row SHARE lock and camera row UPDATE lock; CAS + checkpoint/outbox atomicity. New worker requires schema. |

All three RPCs use SECURITY INVOKER with fixed/empty search path and schema-qualified access. EXECUTE is revoked from PUBLIC/anon/authenticated and granted to service_role. Outbox access is service-only with RLS/client privileges restricted. They are not client authority-escalation APIs. ACL tests ran against real PostgreSQL.

Filename chronological order matches dependency order: Edge → observations → transition. Git history likewise introduces each migration with its dependent Backend implementation, then subsequent layers. This proves source ordering, not that production migrations have been applied. Production must apply all required schema before dependent code. No destructive reset was run. The previously reported historical full local migration-chain defect remains a separate unresolved baseline concern: isolated fixture success does **not** certify a clean replay of every historical migration. Its original failure was not reproduced or newly localized in this audit; do not invent a repaired-chain claim.

Rollback: prefer disabling/reverting application writers while retaining additive columns, RPCs, pending outbox and evidence. Dropping schema would destroy delivery obligations/evidence and is not a safe automatic rollback. Validate deployed schema/RLS/index size and backups before rollout; inspect migration history without including LOCAL_TEST noise.

## 5. Final authority map

| Fact | Qualified authority |
|---|---|
| Camera identity/configuration | `facility_cameras` canonical UUID, estate/Home, assignment, configuration |
| Camera privacy/scope | Canonical row + `cameraAccess.policy.ts` + authenticated membership-aware actor |
| Edge identity | `edge_nodes` bound estate/node identity and authenticated Backend Edge boundary |
| Heartbeat observation | Original Edge heartbeat `ts`; atomically persisted accepted projection/history |
| Edge current state | `edgeCurrentStateAuthority.ts`, source-time freshness interpretation |
| Reachability observation | Method-specific accepted `runtime_observations` entry |
| Stream configuration / inspection | Separate go2rtc registry/inspection observations, not inferred video |
| Frame acquisition | Signature-valid acquisition envelope; existing media retains its own historical evidence |
| Inference observation | Per-sample external-detector outcome; not longitudinal AI health |
| Camera current state | `cameraCurrentStateAuthority.ts` only |
| Accepted operational transition | TS transition policy + service-only transactional acceptance CAS |
| Delivery obligation | Dedicated transition outbox; checkpoint is bookkeeping only |
| Canonical operational event | Stable accepted-transition signal through existing canonical ingress |
| Current awareness | Existing canonical Oyi Core persistence/read authority and scope filtering |
| Spatial camera placement | `camera_infrastructure`/spatial relationships, not operational health |

No reader uses the transition checkpoint as a factual health source. Observations do not directly announce health. Legacy fields cannot override the interpreter. The durable delivery layer does not reinterpret physical evidence.

## 6. Identity, privacy, assignment and media chain

`CAMERA_ACCESS_SELECT = id,estate_id,home_id,privacy_scope,metadata`. Metadata is still needed for explicit Office allowlists and legacy scope/Home compatibility. Canonical home_id wins over conflicting metadata. Actor context is membership-aware; the login user's default Home is not silently substituted for active context.

Search inventory covered every `canAccessCamera`, `cameraAccessActor`, `requireCameraAccess` and canonical camera lookup. Current authorization callers use the shared complete projection or full row. The authority's own select extends that projection with assignment/configuration and runtime observations. Reduced-row/full-row parity, media and audience adversarial tests pass. Unresolved legacy infrastructure cannot grant private content access.

| Actor / source | Private Home A | Home B / cross-estate | Common/facility |
|---|---|---|---|
| Resident in Home A | Allowed by canonical policy | Denied | Existing resident policy preserved |
| Resident in Home B | Denied for Home A | Only own authorized scope | Existing policy preserved |
| facility_manager / estate_admin | No blanket private-Home bypass | Estate boundary enforced | Existing operational access |
| security_operator / ochiga_admin literal roles | No invented privilege from label | Existing policy only | Exact role mapping matters |
| Actual `admin` / `system_admin` | Existing explicit platform-admin exception | Explicit global exception, not accidental leakage | Allowed by existing policy |

The recognized facility role list includes security/operator (not arbitrary similarly named roles). Tests use actual policy outcomes rather than granting roles the prompt happens to name.

Edge telemetry is accepted only after authenticated node/estate resolution and canonical camera assignment. RPC revalidates assignment under lock. Payload estate/Home cannot grant authority; cross-estate/unassigned camera tests reject. Detection and media ingestion retain the same assignment checks. Media retry repairs a missing frame projection even when the media record already exists.

Playlist and segment both require camera-bound authorization; Camera A token does not grant Camera B playlist or segment. Canonical policy applies to snapshot/media lookup, token expiry/invalid/missing bindings reject, and a known segment path is not authorization. Reader convergence did not change token lifetimes or media transport. Protected events/notifications resolve source cameras before recipients; per-user realtime does not broadcast Home-private payloads to an estate-wide audience. Canonical awareness reads recheck source camera scope. These are local functional/source proofs, not a production penetration test.

## 7. Edge heartbeat and current-state result

Path: agent scheduler → payload with original `ts` → immediate HTTP or durable queue → authenticated Backend node → `oyi_ingest_edge_heartbeat` → history + conditional node projection → Edge authority → authorized presentation/camera interpreter.

Default heartbeat cadence is 30s and configurable. Agent uses exponential retry capped by configuration; queued payload and original timestamp are retained, not regenerated on replay. Backend expectation is separately configured, not an acknowledged per-node effective cadence: deployment must align them.

`observed_at` is source time; Backend/database derives receipt time. Strictly newer source time advances current projection. Same source-time duplicate does not refresh receipt/freshness; older history may persist without replacing current state. History and latest projection roll back together. Cold restart reads persisted observation age, not startup time. No read-time Edge polling/cache authority.

For expected interval H, fresh tolerance is 3H+10s; expiry is max(6H,120s)+10s. Default boundaries are 100s/190s. Fresh healthy → healthy; fresh error/backlog/unsynced telemetry → degraded; stale → degraded knowledge; expired → unavailable telemetry; never observed → unknown. Last-known status remains separate. Timestamps over 10s into the future reject; conservative clock guard is not clock synchronization. Counts alone are not health.

Real SQL tests passed duplicate/replay/concurrency/rollback. Expiry never writes camera offline or emits a camera failure. Backend network loss can coexist with continued local streams/inference.

## 8. Camera observation contract and persistence result

| Kind/source | Result / actual proof | Non-claim |
|---|---|---|
| stream_configuration / go2rtc_registry | configured/not_configured | No reachability/video proof |
| stream / go2rtc_inspection | inspected/failed, stream presence and producer/consumer counts | Successful API inspection is not fresh frame or advancing video |
| reachability / onvif_probe or tcp_probe | succeeded/failed/authentication_failed at source time | No universal camera/video/recording health |
| frame / go2rtc_snapshot, ai_snapshot, media_ingestion | acquired/failed; bounded MIME/signature validation and correlation where supported | Not decoded image or advancing video proof |
| inference / external_detector | succeeded/failed/skipped/dropped; zero detections can succeed | No longitudinal persistent AI runtime health |
| recorder/channel | Existing one-shot TCP test/configuration only | No continuous recorder/channel observer in frozen contract |

Canonical camera UUID is separate from external go2rtc stream identity. Observation UUID is created once and retained across retry. Backend receipt is server-derived. `runtime_observations` is a bounded latest projection, not a history journal. Slots are independent `kind:source` dimensions with latest entry and frame last_success. Ordering is `(observed_at, observation_id COLLATE C)`; equal-time different IDs have deterministic lexical tie-break, not arrival-time precedence. Same retained ID with changed content is rejected. Older replay cannot regress a slot or erase another dimension; later failed frame retains latest successful acquisition independently.

Batch limits: 1–128 entries, JSONB text <=512KiB, details <=2KiB, UUID identities, constrained kind/source/result, scalar detail allowlist, image size <=5MiB for acquisition evidence, timezone-bearing finite source timestamp from year 2000 through receipt+10s. Arbitrary metadata, credentials, URLs/tokens and image bytes are not accepted details. All affected camera rows lock in deterministic order; tenant/assignment rechecked while locked; any failure rolls the batch back. SQL tests prove this on real PostgreSQL, including forced later-row failure.

No runtime observation writes to camera_infrastructure, camera_health_history or canonical overall-health fields. Existing media/detection records remain history. No legacy backfill fabricates source observation time. Failed stream inspection emits its own new failure, not a retimestamped cached success.

## 9. Camera current-state semantics and contradiction matrix

Authority inputs are canonical scope/configuration, accepted runtime observations and batched Edge state. Legacy status/health/stream/time fields and infrastructure health are absent from the factual projection. Normal reads have no writes, provider calls or signal emission.

Healthy means sufficient fresh acquisition evidence with no interpreted impairment; degraded preserves usable evidence with supported impairment/staleness; unavailable describes observed video acquisition capability failure, not electrical/network death; unknown means insufficient current evidence. Each component has its own clock/provenance. The maximum observedAt is informational, not a global refresh clock.

Default scheduled AI capture/inference cadence 15s gives 55s fresh / 100s expiry; stream policy follows 30s heartbeat cadence (100s/190s). Unscheduled ONVIF/TCP and on-demand/media acquisition have unspecified freshness unless a trusted policy supplies a cadence. Do not invent TTLs in readers. Last-success exists for explanation but does not erase a newer failed attempt.

| Evidence | Frozen interpretation |
|---|---|
| Fresh acquired frame + healthy required components | healthy |
| Fresh frame + fresh inference failure | degraded; video evidence retained |
| Fresh frame + fresh policy-qualified ONVIF failure | degraded control path, not offline |
| Unscheduled ONVIF failure with unspecified freshness | Historical/method-specific evidence; not automatically a fresh degradation |
| Expired Edge + old frame | unknown; no physical-failure assertion |
| Expired Edge + fresh independently usable acquisition evidence | degraded with current video evidence retained |
| Fresh acquisition failure with no usable fresh success | unavailable acquisition capability |
| Stream inspected + stale frame | insufficient fresh acquisition for healthy; stale/unknown interpretation per component policy |
| Registry online + authority unavailable | unavailable wins |
| Registry/infrastructure offline + authority healthy | healthy wins |
| Configured-only / never observed | unknown |

Frame success is bounded signature-valid acquisition, not decoded or continuous video. Recorder TCP evidence cannot override stronger frame evidence or prove recording. Inference skipped/dropped is not camera physical failure. The 14D and 14F matrices pass; no frozen interpretation was altered to satisfy readers.

## 10. Transition acceptance, policy and concurrency

`cameraHealthTransition.service.ts` evaluates the frozen interpreter, prepares bounded reasons/evidence references and transition policy, then invokes the acceptance RPC. `health_transition_checkpoint` stores accepted overall, summary, policy/revisions/evaluation bookkeeping—not duplicate raw observations or current-state read authority.

Policy revision is `camera-transition-v1/current-state-14d-v1`, with relevant policy/config fingerprint. Acceptance compares expected canonical camera observation/config/scope, relevant Edge evidence and exact checkpoint. Camera row lock + expected checkpoint CAS means two evaluators of the same revision cannot both accept. Relevant Edge existence/update is protected by the table/row locks. A <=1s validity deadline is shortened at component/Edge freshness boundaries, so wall-clock expiry can invalidate otherwise unchanged evidence. Stale candidates are rejected for recomputation, not accepted last-write-wins.

Checkpoint increment and outbox insertion commit atomically. Stable transition ID is `camera-health:<camera UUID>:<checkpoint revision>`, independent of delivery attempt. Real PostgreSQL proof: one concurrent winner; source/Edge/scope/expiry mismatch rejected; forced outbox failure rolls checkpoint back; silent initialization; durable pending row and lease recovery.

| Change | Signal policy |
|---|---|
| Uninitialized/unknown → healthy | Initialize silently; not recovery |
| Initial degraded | camera.health.degraded, no invented prior failure |
| Initial or later unavailable | camera.video.unavailable, not connectivity_lost |
| healthy → degraded | One degradation |
| unavailable → degraded | camera.health.improved, partial recovery |
| degraded/unavailable → healthy | camera.video.restored |
| Any → unknown due to expiry | Silent knowledge-loss checkpoint; no physical failure |
| Same overall / repeated healthy samples | No repeated signal |
| Policy/scope rebaseline | No fabricated transition between incompatible meanings |

The bounded worker evaluates up to 100 cameras per 30s tick, keyset-paginated, and attempts delivery of up to 25 rows. It does not evaluate on reads or poll providers. Observation, assignment and Edge changes are caught by reconciliation; expiry is likewise caught. This guarantees durable **accepted** transitions, not capture of every transient condition between sweeps: latest observations are not an event journal.

## 11. Delivery, crash windows and downstream materialization

Pending rows use conditional claim/update, attempt count, claim token and 60s lease. Failed/unfinished rows remain retryable. Earlier undelivered transition for the same camera blocks later delivery, preserving order. Current canonical scope is checked again before delivery. Stable signal/provider identity and correlation are retained through crash/retry.

Acknowledgement is deliberately stronger than submit-returned or signal-exists: matching canonical signal, matching awareness related-signal evidence, and matching incident evidence must be found. Only then is the row materialized. Recommendations/insights are demonstrated in normal Core fixture flow, not claimed as individually acknowledged delivery obligations.

| Crash/failure | Result |
|---|---|
| Acceptance commits then process dies | Pending outbox survives and is retried |
| Signal/bundle persists then process dies before ack | Same signal identity retried; proof lookup can acknowledge existing materialization |
| Submit fails | Retryable durable obligation; no false ack |
| Acceptance/outbox insert fails | Transaction rolls back checkpoint and outbox |
| Signal persists but bundle only partly persists | Row remains retryable; later camera transitions can be blocked |

Actual guarantee: **at-least-once delivery attempts + stable canonical identity + durable accepted obligation + conservative materialization acknowledgement**. Not exactly-once downstream side effects, not unconditional eventual bundle completion. Lease expiry during a slow submission and crash before local acknowledgement can repeat side-effect attempts; canonical identity dedup is not a global transaction.

**Downstream gap: REQUIRES_PRE_PRODUCTION_REPAIR (not a blocker to publishing this local checkpoint).** `src/oyi-core/service.ts` persists the signal before downstream bundle completion. A subsequent durable duplicate can return before redoing missing materialization. Retry retains the obligation but does not necessarily repair it. Consequently no accepted transition is silently deleted, yet awareness can remain absent and per-camera queue progression can stall indefinitely. Before enabling production delivery, require an approved, tested materialization recovery mechanism/runbook and monitoring; do not claim retry alone solves it. Frozen Core was not modified.

Normal sequential real-Core fixture behavior for healthy → degraded → unavailable → healthy: one correlated incident evolves open → open → resolved, with signal-specific awareness and recommendation/insight paths. Generic operational_incidents evidence-array read/merge/write CAS race remains outside this audit; this worker's ordering reduces its own races but does not repair concurrent external writers.

## 12. Duplicate producer and realtime result

Repeated searches cover submitCameraHealthCanonicalSignal, classifyCameraHealthTransition, camera.status.updated, connectivity_lost/restored, health_degraded, tamper_detected, recorder_failure, binding_changed and new camera operational event names.

| Producer family | Final classification |
|---|---|
| Accepted transition outbox → canonical ingress | CANONICAL_TRANSITION: one live operational meaning path |
| Edge stream-health legacy registry writes | LEGACY_COMPATIBILITY / DIAGNOSTIC; no independent operational signal |
| Infrastructure manual health writer/history | Operator/display metadata + HISTORY; no operational-health announcement |
| Ambient camera.status.updated bridges | Disabled/narrowed before canonical ingress; cannot create parallel truth |
| Configured/discovery/binding events | CONFIGURATION, not health |
| Typed authenticated detection/security events | SECURITY / OBSERVATION, not overall-health comparisons |
| Legacy classifier/submission helpers | Retained definitions/compatibility vocabulary; no live operational caller found |

No error-text heuristic is allowed to turn a generic transport failure into tamper/recorder/physical connectivity loss. Accepted `camera.health.transition` realtime uses privacy-filtered audiences with ambient ingress skipped. Realtime is event transport; arrival does not refresh observation time. Clients should invalidate/refetch authorized current state, not reconstruct a competing state machine from legacy messages.

## 13. Reader ownership and cross-surface consistency

Searches included direct/indirect camera table lookups, old health fields, helpers, semantic online/offline/stream claims, infrastructure reads and Camera Core. Search inventories are `/tmp/14g-camera-reader-inventory.txt`, `...policy-inventory.txt`, `...producer-inventory.txt`. No unjustified generic Backend/committed Camera Core current-state bypass was found. This is not certification of external frontend source not changed in these repositories.

| Surface | Current factual source / privacy |
|---|---|
| Facility list / Camera Center / direct API | `presentCameraRows` → batched authority; full canonical policy inputs |
| Consumer Home list / playback metadata | Same authority, requested Home + policy; reduced details |
| Twin/Spatial/infrastructure GET | Canonical camera ID join → authority; orphan denied/unknown, never infrastructure fallback |
| Oyi camera module / exact target / explanations | Authority hydration and reasons; source-camera policy |
| Camera Center snapshot counts | Four canonical buckets after authorization |
| Office export | Configured camera-like device inventory only; live_cameras null, not fake current count |
| Executive/intelligence awareness | Canonical awareness/history; not a registry current classifier |
| Admin inventory / Edge registry | Identity/configuration only; does not claim camera healthy from Edge status |
| Shared Camera Core | Canonical current_state only; absent contract unknown |
| Event/security/history reports | History remains history, not rewritten from today's state |

14F fixture proves the same evidence across authority, Facility/API, Consumer, Camera Center counts, conversation hydration and Twin. 1/10/50/100-camera batched paths pass without provider/Edge polling or per-camera history queries. Facility can receive operational detail; Consumer omits raw observation details/IDs/received times/private configuration. Presentation differences do not change overall meaning or component time. Unknown is not offline. No new global Office camera actor/access was invented to make a report count non-null.

## 14. Remaining fields and stores

| Remaining use | Classification |
|---|---|
| facility_cameras status/health_status/stream_status provisioning/stream-health writes | CONFIGURATION / WRITE_MIRROR / LEGACY_COMPATIBILITY, not runtime authority |
| last_seen_at/last_health_check_at/last_success_at/last_failure_at/provider_error/frame_freshness_at | Legacy write/diagnostic compatibility; generic readers use canonical component provenance |
| camera_media status/expiry and detections/events | STILL_REQUIRED specialized storage lifecycle / HISTORY |
| camera_health_history | Operator/legacy HISTORY, not raw observation authority |
| camera_infrastructure health_state/operator PUT acknowledgement | LEGACY_COMPATIBILITY / HISTORY; not current operational truth |
| Spatial relationships/coordinates/zone placement | STILL_REQUIRED spatial/configuration projection |
| cameraHealth.ts canonicalCameraHealth and internal helper | DEAD generic normalizer / RETIREMENT_CANDIDATE: only definition/self-call, no live factual caller found |
| Legacy transition classifier exports/comments | Compatibility/dead candidate; no live operational producer |
| HTTP/media transport status, discovery/test status | DIAGNOSTIC / SPECIALIZED_COMPONENT, not camera overall |

camera_infrastructure can now be described as the spatial/infrastructure projection **with retained legacy operator health/history fields**, not a pure schema containing no health columns. It no longer owns current operational health or canonical health transitions. Deletion is neither necessary nor authorized.

## 15. Frontend Camera Core work before rollout

Backend reader convergence is complete within the audited code; downstream UI adoption is not certified. Shared `packages/oyi-camera-core` typechecks at version `6.0.0-canonical-current-state`. Required external consumer changes:

1. Adopt current_state and four overall values; remove online/offline inference from registry strings, Edge health or HLS configuration.
2. Preserve nullable/unknown compatibility values, including health.online and Office live_cameras; use configured_camera_devices only as inventory.
3. Render healthy/degraded/unavailable/unknown counts without folding unknown into offline; do not call acquisition-capability unavailability electrical disconnection.
4. Present independent component timestamps/reasons; never promote a maximum observedAt or event arrival into freshness for every component.
5. Keep configured media access separate from observed stream/frame availability; preserve playlist/segment/token flow.
6. Handle reduced Consumer versus richer Facility payloads; no client assumption that private diagnostics always exist.
7. Treat accepted transition events as invalidation/provenance and refetch authorized current state. Do not build another health authority in Camera Core/Twin.
8. Verify external frontend typechecks and role-based UI/end-to-end playback. This audit ran the committed shared package typecheck, not every frontend repository build.

Old frontend/new Backend is a dangerous mixed-version window: enums changed, unknown is nullable, component meaning is richer. Backward shape compatibility is not semantic UI compatibility.

## 16. Hardware acceptance plan — designed, not executed

Use one controlled estate, Home A/Home B actors, a bound real Edge, real ONVIF/RTSP camera, go2rtc and an actual AI provider; no customer/private test media. Record source/receipt timestamps and accepted transition IDs.

| Controlled action | Required evidence/state/transition result |
|---|---|
| Configure without streaming | Configuration only; camera unknown; no false restoration |
| Acquire signature-valid frame and run AI | Frame and inference observations; zero detections still success; healthy only under frozen freshness policy |
| Break ONVIF but retain video path | Method failure retained; scheduled/fresh policy may degrade, never erase fresh video |
| Fail AI provider with video intact | Inference failed; degraded, not camera offline |
| Disconnect camera / restore it | Explicit acquisition failure can produce video_unavailable; later fresh acquisition recovery uses stable accepted transition |
| Wrong RTSP credential | Typed failure, no secret in logs/payload; no fabricated physical connectivity loss |
| Disconnect Backend only | Local operation may continue; replay preserves original timestamps/IDs; no receipt-time rejuvenation |
| Stop/restart Edge | Backend telemetry ages to stale/unavailable; camera evidence ages independently; no synthetic camera-offline write |
| Delay/reorder/replay observations | Per-dimension monotonic projection, retained frame success, no reverse/duplicate operational transition |
| Home B/cross-estate/API/HLS token substitution | Denied across state, history, notifications, realtime and media; authorized Home A preserved |
| Crash worker at each delivery boundary | Pending obligation survives; stable retry identity; conservative ack and repair alarm for incomplete Core bundle |

Pass only if source evidence, interpreted state, scope, canonical signal and UI language agree. Test recorder TCP as endpoint reachability only, not recording health. Do not enable unsupported product claims to make acceptance appear broader.

## 17. Load/soak acceptance and rollout monitoring

Run isolated production-like 10/50/100-camera sets, several cameras per Edge and multiple Edges per estate; sustained healthy flow, outages/replay, failures/recovery, and 24-hour soak. At default H=30s there are 2 heartbeats/minute/Edge; stream configuration+inspection is roughly 4 entries/minute/camera if inspected every heartbeat. At 15s active sample cadence, frame+inference may add roughly 8 entries/minute/camera. Actual attempted/acquired/enabled samples must be measured, not assumed; snapshot/media duplicate sources and batching affect totals.

Required pass criteria: no unauthorized delivery; zero stale-projection regression; no lost accepted outbox rows; duplicates stable; no repeated healthy signal storm; memory/disk queues bounded; sustained input drains after outage within an agreed recovery SLO; bounded list queries as camera count increases; no history N+1/provider read polling; concurrent RPC invariants hold. Establish measured latency/lock SLOs before production approval rather than inventing a passed numeric SLO now.

Monitor: Edge source/receipt lag, queue depth/oldest age/evictions, clock skew rejections, camera observation batch failures, acceptance CAS/deadline rejections, full evaluator scan time, outbox oldest pending age/attempts/lease recovery, per-camera head-of-line stalls, materialization gaps, canonical dedup, privacy rejection and SQL lock waits/deadlocks.

Specific 14E risk: Edge-table SHARE lock can briefly block heartbeat writes for unrelated nodes. Measure p95/p99 lock duration and ingestion lag under multi-node load; reject rollout if contention pushes ordinary heartbeat delivery into stale windows. A sweep processes 100 cameras per tick: larger global installations lengthen full scan time, and transient states can occur entirely between sweeps. Delivery capacity is 25 attempts per default tick before failures/head-of-line blocking. Burst tests must prove operationally acceptable catch-up, not just bounded queries.

Edge durable queue is bounded latest-evidence transport, not an audit journal: camera observations are capped at 256 queued batches / 10MiB and old batches can be evicted. Disk persistence uses writeFile, not a demonstrated crash-atomic/fsync journal. Abrupt power-loss/corruption durability is not proven. Backend crash guarantees start after accepted persistence; do not extend them to all locally created Edge observations. Include queue-pressure and power-loss recovery in pre-production acceptance.

## 18. Explicit evidence limitations and safe language

| Limitation | Classification / permitted claim |
|---|---|
| Unscheduled ONVIF/TCP freshness | Acceptable explicit v1 limitation; future scheduler enhancement. A past probe cannot assert currently reachable/unreachable. Continuous control-path SLA requires further work. |
| Per-sample inference | Adequate for honestly reporting latest sample success/failure/skip/drop, including zero detections. No longitudinal AI uptime/provider-health claim. |
| Recorder TCP only | Acceptable if UI says endpoint reachable at T. Prohibit recording healthy, channel healthy, recording retained or playback guaranteed. |
| Signature-valid frame only | Say “An image response was acquired at T” / “Recent video acquisition evidence.” Prohibit decoded-valid, advancing/live video, no frozen picture or continuous surveillance claims. |
| Configured go2rtc stream | Configuration only; inspected producer counts are not independent frame proof. |

These limitations do not require weakening unknown semantics. If product launch requires stronger promises, they become product-specific pre-production blockers, not evidence the current interpreter should fabricate.

## 19. Safe deployment and rollback boundaries

No deployment executed. Proposed order:

1. Verify actual deployed schema/history/grants, backups and full-chain compatibility; exclude unrelated local work. Apply the three additive migrations in timestamp order through the normal migration process.
2. Deploy compatible Backend ingestion/read support with transition delivery held disabled until downstream materialization recovery and observability are approved. Verify service RPC access and client denial.
3. Deploy coordinated Edge observation producer; verify canonical UUID assignment, cadence/config, original source timestamps and bounded offline replay.
4. Deploy/adopt frontend Camera Core/current-state contract, then perform controlled hardware/privacy and load acceptance. Keep feature exposure gated during incompatible mixed versions.
5. Enable transition worker only after acknowledgement/repair acceptance; monitor and canary before broader activation.

Old Backend/new DB is structurally compatible, but old producers/readers/signals retain old meaning. New Backend/old Edge yields missing observations/unknown and must not backfill invented truth. New Edge/old Backend may queue/reject new routes and lose bounded evidence under prolonged mismatch. New Backend/old frontend can mislabel canonical states. New Backend before migrations fails RPCs and is unsafe.

Edge rollback: retain Backend observations, which age naturally; no fake freshness. Backend rollback: keep additive schema/outbox; stop worker first and preserve pending rows, but acknowledge rollback can restore legacy competing meanings—gate camera-health features. Frontend rollback is safe only to a contract-compatible client or gated feature. Never drop checkpoint/outbox to silence retry alarms. Resume compatible delivery with stable IDs after recovery.

## 20. Final regression evidence

All listed Backend processes exited 0 under a 120s-per-command bound; passing assertions and clean process exit were both observed:

- npm run typecheck; npm run build.
- Shared Camera Core standalone TypeScript check (`tsc --noEmit --skipLibCheck --target ES2022 --module commonjs packages/oyi-camera-core/src/core.ts`).
- Slice 14A privacy, 14B Edge current state, 14C observations, 14D camera state, 14E transitions, 14F readers.
- Real PostgreSQL 14B, 14C and 14E suites in isolated disposable fixture databases; no shared DB reset or production migration. 14E SQL reports seven groups including actual concurrent CAS/rollback/claim/crash recovery.
- Wave6 Slice1 privacy, Slice1B surface authority; camera intelligence convergence; canonical signal ingress; awareness V3; security adversarial; Consumer context; Facility spatial context; Slice13 device current state; Wave5 Slice1 physical authority.

Edge: check, lint, build, validate:release, 14C observations, runtime canonicalization, gateway Phase3, media Phase4 and detection Phase5 ran. Observation tests cover actual processor zero-detection success/failure/skip and durable replay; gateway/media/detection fixture checks passed. Build validates runtime assets, not a new binary compilation.

**Release validation is non-strict and not hardware readiness.** Its diagnostic output explicitly reports remote registry 401 with example-registry fallback, absent camera credentials, missing generated go2rtc config, and ECONNREFUSED at local go2rtc. AI dry-run skips unavailable configured inputs. These are unavailable live prerequisites, not green hardware assertions. No physical camera/recorder/AI/network interruption/production workload verification was performed. No missing OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY failure occurred in the executed final battery. Historical remote onboarding access failure/full migration-chain issue are carried separately, not relabeled passes.

Logs: `/tmp/14g-*.log`. SQL assertions prove actual database locking and transaction behavior; functional Core/read/privacy fixtures are not a substitute for live end-to-end deployed acceptance.

## 21. Remaining Wave 6 ledger

| Item | Current disposition |
|---|---|
| Incident CAS / evidence-array race | REQUIRED FOR WAVE6 CLOSURE review/repair; present generic read-merge-write risk, not solved by camera outbox |
| Partial canonical downstream materialization | REQUIRES_PRE_PRODUCTION_REPAIR for reliable camera transition delivery; frozen Core unchanged |
| Visitor approve/deny and maintenance status CAS | Already addressed by e0b2fa8; do not reopen as if unchanged |
| Visitor markEntry/markExit | REQUIRED FOR WAVE6 CLOSURE: visitorController still performs unconditional status updates by ID; approval CAS did not close these paths |
| Maintenance tracked/live schema drift | REQUIRED deployment/schema reconciliation; no CREATE TABLE maintenance_requests found in tracked migration search; current migration fixtures do not settle production drift |
| Utility/meter current-state semantics | REQUIRED scope/disposition decision for Wave6 closure; constructing new meter telemetry is a SEPARATE PRODUCT CAPABILITY, not this audit |
| Legacy awareness fallback remnants | DEFERRED TECHNICAL DEBT with explicit monitoring/scope fences; cannot delete mixed intent/language/history paths mechanically. Recheck missing-scope behavior against H.1, not old audit assumptions |
| Dead normalizers/classifiers and legacy columns | HYGIENE/retirement candidates; not a reason to reintroduce independent authority or delete history |
| Frontend adoption, hardware, soak, migration-chain acceptance | REQUIRED BEFORE PRODUCTION, distinct from local architecture checkpoint |

No Wave7, meters, incident fix or new camera implementation was started.

## 22. Final decision and next action

The audited Backend + Edge architecture is **locally coherent and architecturally complete for its documented evidence model**: one identity/privacy boundary, ordered observations, one Edge interpreter, one camera interpreter, durable accepted transition path, one operational meaning producer and converged authorized Backend/Camera Core readers. No new generic duplicate authority was found. Local contracts may be frozen within these explicit limits; “frozen” does not mean production-ready or exactly-once intelligence materialization.

**Verdict B — SAFE TO PUBLISH WITH EXPLICIT PRE-DEPLOYMENT BLOCKERS.** No real committed secret was identified. Automated local regression and isolated SQL proof pass. Publication recommendation applies only to the two verified committed tips, excluding dirty/untracked work and this uncommitted report unless separately authorized.

Production blockers: conservative materialization recovery/repair acceptance, external frontend adoption, actual schema/migration-chain verification, controlled credentials/hardware/role tests, multi-node load/lock/queue/soak acceptance and operational monitoring. No hardware availability or deployed state is inferred from passing mocks/non-strict release checks.

Exact next action: review this report and decide whether to authorize publishing the two coordinated local checkpoints. Obtain separate approval and a release plan for pre-production repairs/acceptance and deployment. **Do not push or deploy from this audit.**
