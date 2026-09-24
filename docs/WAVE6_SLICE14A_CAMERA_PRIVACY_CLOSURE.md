# Wave 6 Slice 14A — Camera runtime privacy/media boundary closure

Date: 2026-09-24. Local implementation and fixture acceptance only. No production requests, push, deployment, database writes, migrations, Edge edits or hardware operations.

## 1–2. Repository baseline

Backend: `main`, pre-implementation HEAD `63c4fb42991f34449330981ab5278943d8fa2a68`; local `origin/main` `909d5d0a35ab2de84c7cdc83d0f10be166e0b512`, ahead 6 / behind 0. No fetch performed. Post-implementation SHA is the local commit containing this document (reported separately; `git log -1 --format=%H -- docs/WAVE6_SLICE14A_CAMERA_PRIVACY_CLOSURE.md`).

Edge: `/Users/ochigaidoko/oyi-edge-agent`, `main`, HEAD and local origin/main `5d30b63866197d6b674951bfdce2dd1211e76d24`, ahead 0 / behind 0; clean and unchanged.

Initially nothing staged. Unrelated modifications retained and excluded: `scripts/pilot-import.mjs`, `src/routes/me.routes.ts`. Untracked Aider files/cache, `opencode.json`, pilot/luna-residences fixtures, Digital Twin asset-contract document, prior Camera/Edge audit document and five `20260905*LOCAL_TEST*` migrations retained and excluded. No reset, clean, stash or broad staging.

## 3–7. Policy, reproduction and caller inventory

Read `docs/WAVE6_CAMERA_EDGE_HEALTH_AUTHORITY_AUDIT.md`. Revalidated reduced projections, segment binding, shared-media-server query selectors, destructive metadata replacement, infrastructure scope, camera notification/realtime audiences and legacy shared Edge identity risks.

Canonical authority remains `facility_cameras` plus **unchanged** `canAccessCamera` semantics. New `CAMERA_ACCESS_SELECT` is `id,estate_id,home_id,privacy_scope,metadata`. Metadata is necessary for legacy scope/Home fields and the explicit Office allowlist. Actor inputs: authenticated id/role and resolver-approved estate/Home. No new role privileges or parallel privacy model.

Reproduction: a camera has canonical Home A and conflicting metadata Home B. Full row denies resident B; old `id,estate_id,metadata` projection allows B. The selected-field-aware smoke reproduces this disagreement and proves the shared projection equals full-row decisions.

Home precedence is unchanged: column, metadata.home_id, metadata.homeId, metadata.bound_home_id, metadata.private_home_id. Privacy scope uses column before metadata. Office access requires the existing explicit allowed-user array. Runtime/Edge metadata does not supply actor scope.

| Caller | Scope input / disposition |
| --- | --- |
| cameraStreamController playlist + segment | Shared select; FIXED_THIS_SLICE |
| cameraIntelController playback/events/AI profiles | Shared resolver select; FIXED_THIS_SLICE |
| cameraIntelController security report | New batch policy filtering before aggregation; FIXED_THIS_SLICE |
| cameraMediaController access/snapshot/policy/event media | Shared select and canonical event relationship; FIXED_THIS_SLICE |
| cameraMedia.service resolveMediaAccess | Shared select; FIXED_THIS_SLICE |
| cameraDetectionController + cameraDetection.service reads | Shared select; FIXED_THIS_SLICE |
| platformGap camera infrastructure read/write | Membership context + shared canonical select; FIXED_THIS_SLICE |
| cameraAudience | Shared select, active memberships, existing policy; NEW transport boundary |
| cameraPlayback.service | Caller canonical row; issuance now checks policy too |
| camerasController lists/inventory/registry/validate | Full canonical rows; SAFE |
| commandRouter camera module | Full canonical rows and existing actor filter; SAFE, unchanged |
| spatialFacilityContextService | Full canonical rows; SAFE, unchanged |
| intelligence-core permissionEngine | Explicit complete scope projection; SAFE, unchanged |
| canonicalAwarenessReadService | Explicit complete scope projection; SAFE, frozen/unchanged |
| Edge ingestion | Canonical camera constrained by server-bound estate/node; SPECIALIZED_SAFE after legacy-token gate |

Search covered all `canAccessCamera`, `requireCameraAccess`, `cameraAccessActor` callers and camera/infrastructure readers. No identified access decision remains based on an insufficient canonical projection.

## 8–11. Media boundary

Normal requests: authentication → membership context resolver → camera actor → canonical lookup → policy. Playback issues a 120-second camera-bound JWT. Playlist validates it, reloads canonical scope, checks policy, fetches configured source and rewrites resource URLs.

Previously the segment handler omitted the playlist's camera-id comparison. Origin/directory restrictions alone also allowed client-selected go2rtc query selectors. Now every segment/key/nested-playlist URI delegated by the playlist has an HMAC bound to **camera ID + complete playback token + exact absolute resource URL**. Segments verify JWT, camera match, resource proof, canonical scope and media origin/path/selector constraints before fetching. Redirect constraints remain. Token lifetime and player protocol are unchanged. A fresh playlist is needed for old URLs lacking resource proofs.

| Media path | Authentication / binding / policy | Result |
| --- | --- | --- |
| Playback contract | Session, resolved context, canonical camera policy | Bound JWT only for authorized actor |
| HLS playlist | JWT camera ID + full canonical scope | A token cannot select B |
| HLS segment/key/nested playlist | Same JWT + exact resource HMAC + canonical policy | No arbitrary known resource path or changed selector |
| Snapshot request | Session + canonical camera policy before Edge command | Canonical Home/surface; denied actor produces no command |
| Media list / thumbnails / existing clips or recording records | Session + canonical camera policy; scoped camera query | Existing records only; no recording implementation added |
| Event media / event detections | Event's canonical camera policy; nested records must match camera | Malformed legacy links fail closed |
| Signed media access | Media → canonical camera → policy → ready/unexpired object | Existing private-store signed URL, 90-second TTL |
| Preserve / recording-policy operations | Existing manage permission + canonical camera policy | No weaker read/write boundary |
| Legacy event snapshot_url | Returned only with authorized source event; not a new public Backend proxy | External origin's security is not certified by this local test |

Short-lived bearer capabilities remain transferable within their existing TTL; no instantaneous membership revocation is claimed. Scope changes on the canonical camera are rechecked by HLS. Source server correctness and physical stream-to-camera mapping still require deployment/hardware acceptance.

## 12–15. Metadata and infrastructure

Authority fields: canonical id/estate/Home/privacy scope and Backend-held legacy scope/Office allowlist. Observation fields: stream status, success/failure times, frame timestamp, latency/reconnect information. Diagnostic fields: provider/protocol/error. Ephemeral transport fields do not become authorization.

Stream-health now merges the explicit observation allowlist into existing persisted metadata, never arbitrary payload.metadata. It preserves frame/legacy scope/configuration rather than replacing the JSON object. Update is constrained to canonical id + estate + node + prior updated_at; scope miss returns 403, persistence error 503, concurrent change 409, with no subsequent success signal. Media's existing frame metadata update also compares the read revision to avoid overwriting a concurrent scope edit. This is privacy preservation, **not** observation ordering/freshness convergence.

The two externally reachable camera-infrastructure operations retain `cameras.view` / `cameras.manage`. Both now resolve membership-aware context. Reads batch-load canonical camera scope and filter both projection/history before returning them. Writes require the canonical camera and policy permission before mutation. Unresolved legacy rows are not returned and cannot be written through this path. No infrastructure retirement or spatial/Twin redesign. Health transition classification remains unchanged; only Home scope is taken from the canonical camera rather than projection metadata.

## 16–17. Realtime and notifications

Previously a private-camera message could be emitted to its estate room as well as its Home room, and detection escalation used estate/role notification fan-out without camera policy.

`cameraAudience.service.ts` batch-loads canonical scopes, current user roles and active estate/Home memberships, then invokes the existing camera policy per candidate. No `users.home_id` default grants a delivery context. Errors/missing canonical records produce no authorized audience.

Camera realtime is delivered directly only to eligible authenticated sockets, never broad estate/Home rooms. Unresolved camera messages (including discovery notifications without canonical identity and camera audit messages lacking source-camera binding) are suppressed. Discovery polling remains; unresolved discovery live refresh is deliberately narrower. Generic noncamera realtime and canonical ingress are unchanged.

Notification candidates are filtered **before** preference/cooldown decision records, notification inserts, realtime or push; insertion rechecks as defense in depth. Private camera text is not republished as a generic estate notification intelligence event that loses camera provenance. This is not post-send redaction. Existing historically persisted notifications are not deleted or migrated by this local change.

## 18–21. Edge, detections and frame/media ingress

Existing authentication resolves configured token → server-bound node/site using `edgeIdentityPolicy`; conflicting payload node/site is rejected. Camera runtime endpoints now require this bound identity and reject the optional unbound legacy shared-token mode. Other Edge endpoints/heartbeat architecture are unchanged. No wire change: existing configured credentials and payloads continue to work.

Stream health/events retain estate+node-constrained alias compatibility, resolving to a canonical camera. Media/detections require canonical UUID + estate + assigned node. Another estate, unassigned same-estate camera, arbitrary id or spoofed payload tenant cannot supply camera runtime writes. Aliases never remove assignment constraints. Events return not-found for unresolved assignment; stream health rejects it explicitly.

Detection media relationships require the same camera/estate before insertion. Frame/media storage uses the canonical camera's tenant path and Home. Signed access reauthorizes the media's canonical camera. Successful snapshot fixture ingestion and denied cross-camera access are exercised without an external store. Detection remains detection, not health. Canonical signal Home scope corrections do not alter classifiers, severity, precedence or awareness implementation.

## 22–26. Adversarial acceptance

| Actor (same estate unless stated) | Home A private | Other Home | Facility/common | Cross-estate | Unresolved infrastructure |
| --- | --- | --- | --- | --- | --- |
| Resident with active Home A | Allow | Deny | Deny | Deny | Deny |
| Resident Home B | Deny | Own Home only | Deny | Deny | Deny |
| facility_manager / estate_admin, no private Home membership | Deny | Deny | Allow | Deny | Deny |
| security (actual canonical policy role) | Deny | Deny | Allow | Deny | Deny |
| literal security_operator / ochiga_admin | No invented privilege; private access only with valid Home scope | Deny absent matching Home | Deny | Deny | Deny |
| admin / system_admin | Existing platform policy exception | Existing exception | Allow | Existing exception | Deny without canonical link |

Office scope still uses explicit allowed users (or existing platform exception), not Facility authority.

Dedicated smoke exercises: full/reduced projection reproduction and equality; actual role semantics; A-token/A-playlist and A-segment allowed; A-token/B-playlist and B-segment denied; changed URL/missing resource proof denied; private-camera wrong-Home denied; missing binding/expired/invalid token denied; common playback retained; snapshot/media privacy; infrastructure private/orphan/cross-estate denial; realtime and notification private/common audiences; Edge identity spoof/legacy rejection; health/event/detection/media tenant/node checks; positive detection/snapshot ingest; signed-media pre-URL denial; report aggregation; malformed media/detection links; unresolved camera audit suppression.

Mocks honor selected columns, equality/membership filters and tenant relationships. Tests call compiled controllers/services, not just source regexes. All fixtures are local. Existing intelligence smoke gained real request headers/method and membership/estate fixtures for its newly authorized infrastructure path; assertions were not relaxed.

## 27. Performance

10/50/100 distinct-camera notification batches exercise exactly four scope queries per batch (cameras, users, estate memberships, Home memberships), not one per camera. Report tests cover 10/50/100 event rows with one canonical scope query for their referenced IDs; production code chunks IDs by 100. Infrastructure reads add one canonical batch to bounded projection/history lists. HLS adds no extra database query over its existing camera lookup. No provider polling introduced.

Realtime performs one batch eligibility resolution per camera message over currently connected sockets. Cost scales with connected audience; no multi-node load test claimed. Database row caps can underdeliver large audiences, not authorize missing rows. Larger-scale fan-out optimization is separate work.

## 28–30. Files and schema

Implementation files:

- `src/modules/cameras/cameraAccess.policy.ts`
- `src/modules/cameras/cameraAudience.service.ts` (new)
- `src/modules/cameras/cameraPlayback.service.ts`
- `src/modules/cameras/cameraMediaPolicy.ts`
- `src/modules/cameras/cameraMedia.service.ts`
- `src/modules/cameras/cameraDetection.service.ts`
- `src/controllers/cameraStreamController.ts`
- `src/controllers/cameraIntelController.ts`
- `src/controllers/cameraMediaController.ts`
- `src/controllers/cameraDetectionController.ts`
- `src/middleware/edgeToken.ts`
- `src/routes/edgeDiscovery.ts`
- `src/realtime/emitSignal.ts`
- `src/services/NotificationService.ts`
- `src/services/platformGapService.ts` (camera methods only)
- `scripts/wave6-slice14a-camera-privacy-smoke.mjs` (new)
- `scripts/oyi-camera-intelligence-convergence-smoke.mjs` (fixture adaptation)
- `package.json` (dedicated smoke entry)
- this document.

Migrations: NONE. Edge files changed: NONE. Frozen physical execution, generic device authority, canonical awareness implementation, heartbeat expiry, camera health classifiers and Twin implementations: unchanged.

## 31–35. Validation / commit gate

Typecheck and production TypeScript build passed. Regression scripts are run directly after building once, matching their package entrypoints without recompiling for each fixture. Required acceptance: Slice14A; Slice1 privacy; Slice1B surface authority; camera privacy handoff/full-domain; camera intelligence convergence; canonical signal ingress; awareness V3; security adversarial; Consumer context; Facility spatial context; Slice13 device current-state; Wave5 Slice1 physical authority. Additional camera-active-context, runtime canonicalization, runtime Phase1, media Phase4 and detection Phase5 smokes passed.

Final run: **17 suites passed, zero failures, zero timeouts; every process exited 0.** Slice14A has 15 adversarial groups; Slice1 has 24 assertions, Slice1B 53, device Slice13 31, physical Wave5 7, camera intelligence 15. Typecheck/build both exited 0. `git diff --check` passed.

The initial camera-intelligence failure was an introduced **test-fixture incompatibility**, not dismissed as unrelated: fake requests omitted Express headers and membership context. Corrected fixtures preserve actual context authorization and all original transition assertions pass. No remaining known unrelated or environment-only failure in these runs. No live Supabase credential-dependent acceptance was claimed. Assertion success and normal process exit were both verified with a 45-second per-script bound.

Only listed intended files enter one local commit: `Wave 6L: close camera runtime privacy boundaries`. The SHA is reported after the commit. Prior audit artifact and unrelated work remain unstaged.

## 34, 36–38. Gaps, closure and next boundary

Additional same-class gaps found and closed: security report aggregation lacked camera filtering; event-media joins could expose malformed cross-camera links; generic notification republishing could lose source privacy; unresolved camera audit transport could fall back to estate broadcast.

The identified Backend runtime privacy/media boundaries are closed at local source/fixture acceptance level. The invariant and tested policy boundary may be frozen, **not** represented as a deployed security certification. Deployment remains unauthorized. Before any later rollout, configure bound Edge identities, verify private bucket/RLS migrations are actually applied, and exercise genuine HLS/key/nested-playlist playback and authenticated Socket.IO delivery. Existing external snapshot URLs, provider content identity, hardware, and previously delivered historical notification data are not certified/remediated by this slice.

Known separate audit work remains: UUID/stream registry compatibility, observation replay/order, heartbeat expiry, frame semantics, AI/recorder health and duplicate health-signal convergence. No health authority is implemented here. Wave6 may proceed to a separately authorized Edge Current-State Authority slice after this local commit review. This task stops without starting it.
