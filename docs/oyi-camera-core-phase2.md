# Oyi Camera Core — Phase 2

## Purpose and ownership

Oyi Camera Core is the surface-neutral TypeScript contract for one authorized camera runtime. `facility_cameras.id` remains the canonical identity; the Backend remains the authority for tenancy, authorization, events, health and playback sessions; Oyi Edge remains responsible for physical RTSP reachability and credentials. Camera Core never receives RTSP credentials, Edge origins or secret references.

The canonical source is `packages/oyi-camera-core`. The repositories are not a monorepo and there is no established private-package publication workflow, so Phase 2 uses a controlled vendoring step: Facility and Consumer contain version-labelled generated runtime sources and regression checks. This avoids a Vercel-incompatible cross-repository `file:` dependency. Moving the same package to an internal registry later is mechanical and must preserve its public contract.

## Layers

- **Camera identity:** `Camera`, scoped by Facility estate or Consumer home.
- **Health:** `CameraHealth`, `CameraRuntimeState` and shared interpretation helpers.
- **Events:** open-ended event types, canonical source/ingestion time selection, optional event-embedded detections, and explicitly legacy snapshot references.
- **Playback:** authorized Backend HLS session only, with native HLS/hls.js attachment, pre-expiry refresh, bounded retry and cleanup.
- **Context:** a safe Oyi camera serializer containing identity, scope, location and status only.
- **Surface projection:** Facility retains DVR/import/validation/profile operations; Consumer exposes home-scoped reads only; a future Twin stores only `camera_id` and consumes Camera Core.

Capabilities use `available`, `configured`, `unavailable` or `unknown`. Unknown data never becomes an advertised feature. Current Backend capability projection marks HLS live view/playback according to configuration and health, while unsupported recording, face recognition and ANPR remain unavailable.

Runtime state rules are conservative: explicit offline/failed/error wins; provider errors and warning/reconnecting states are degraded; online requires affirmative health plus an acceptable stream/status value; insufficient evidence is unknown.

## Integrating a surface

```ts
const cameraClient = createCameraReadClient(authenticatedTransport);
const cameras = await cameraClient.listCameras({ scope: "home", homeId });
const events = await cameraClient.getCameraEvents(cameras[0].id);
const session = await cameraClient.createPlaybackSession(cameras[0].id);
```

Context selects the correct route; it is not an authorization claim. The Backend must independently authorize every camera. A Digital Twin placement stores `camera_id`, then uses these same read/session methods. It does not own streaming.

Existing Socket.IO/signal channels do not provide a stable camera-specific event/health contract. Phase 2 therefore defines `CameraRealtimeAdapter` extension points but does not add aggressive polling or another realtime transport.

## Deliberate exclusions

Camera Core does not own RTSP secrets, Edge identity, recording or clip persistence, CV inference, Facility UI, Consumer privacy UI, or Twin rendering. Legacy `snapshot_url` is labelled `legacy_external`, not promoted to trusted Oyi media. WebRTC/WHEP is rejected because the Backend currently issues HLS only.

## Phase 3 conditions

Before Oyi Edge becomes the full discovery/connectivity gateway, replace controlled source vendoring with an established internal package distribution path, define camera-specific realtime events over the existing authorized channel, and add Edge integration tests against the canonical contract. No new camera identity or browser-visible stream origin should be introduced.
