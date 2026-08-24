# Oyi Camera Runtime Architecture

## Canonical ownership

`facility_cameras` is the single camera identity. `camera_infrastructure` is a spatial/Digital Twin projection that references the canonical camera ID. `discovered_devices` contains pre-provisioning candidates only; generic device records are optional projections and never camera authority.

Oyi Edge owns private-network execution: ONVIF discovery, RTSP reachability, credential resolution, go2rtc configuration, snapshots, bounded media staging and inference providers. The Backend owns identity, tenancy, authorization, discovery orchestration, playback-session authorization, canonical health, events, media, normalized detections and Oyi evidence. Oyi Camera Core owns shared safe client contracts and the browser HLS lifecycle. Facility and Consumer are authorized projections; Digital Twin is a spatial projection.

```text
Camera/NVR -> Oyi Edge -> Ochiga Backend -> Oyi Camera Core
                                      |-> Facility
                                      |-> Consumer
                                      `-> Digital Twin
```

## Source-of-truth map

| Concern | Owner |
| --- | --- |
| Camera identity | `facility_cameras` |
| Spatial placement | `camera_infrastructure.canonical_camera_id` |
| Discovery and private connectivity | Oyi Edge |
| Discovery orchestration and provisioning | Backend Edge command routes |
| Credentials | Edge-local credential references |
| Playback authorization | Backend |
| Browser playback lifecycle | Oyi Camera Core |
| Health | Backend `CameraHealth` projection |
| Events | `camera_events` |
| Media | Camera Media Runtime |
| Detections and visual zones | `camera_detections`, `camera_detection_zones` |
| Inference | Edge `CameraInferenceProvider` |
| Notifications | Existing `NotificationService` path after event aggregation/policy |
| Oyi evidence | Canonical camera evidence composition |

## DO NOT CREATE PARALLEL CAMERA RUNTIMES

Future work must extend this runtime. Do not create another camera registry, cloud LAN scanner, RTSP/HLS transcoder, frontend camera DTO, media store, detector architecture, playback engine or camera-event system. Frontends must not receive raw RTSP credentials, Edge origins or storage keys.

Live playback and historical media are separate. Live playback uses a short-lived Backend-authorized session. Historical playback uses an authorized `CameraMediaReference`; query-string rewind simulation is not supported.

## Camera Core distribution

Canonical source: `packages/oyi-camera-core/src`.

Run `npm run sync:camera-media-distribution` to deterministically update Facility and Consumer generated copies. Run `npm run verify:camera-media-distribution` in CI and before release. Generated files are not edited directly.

## Retained compatibility

| Legacy component | Why retained | Canonical replacement | Removal condition |
| --- | --- | --- | --- |
| `camera_events.snapshot_url` read compatibility | Existing event rows may contain a legacy external snapshot reference | `camera_event_media` + `CameraMediaReference` | Remove only after a measured production backfill and controlled schema retirement |
| DVR/NVR onboarding fields and `facility_cameras.rtsp_url` storage compatibility | Existing provisioning contracts still accept legacy source data while Edge adoption is incomplete | Edge credential reference + canonical camera provisioning | Remove only after every deployed gateway uses credential references and production data is backfilled |
| Generic device ONVIF provider name in observability/contracts | Capability vocabulary and historical signals use the provider label | Edge ONVIF runtime | Keep as vocabulary; it must never register a Backend LAN scanner |
| `POST /edge/cameras/:cameraId/events` | Compatibility for pre-Phase-5 Edge agents that emit already-aggregated events | `POST /edge/cameras/:cameraId/detections` | Remove after request telemetry confirms no legacy agent uses it for one release window |
| `POST /cameras/:cameraId/events` | Authenticated management/test integrations may submit a governed event | Edge detection ingestion and canonical event aggregation | Remove after external API consumer telemetry confirms zero use; no Facility/Consumer caller remains |

No database objects are dropped by this cleanup.
