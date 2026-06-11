# Ochiga Camera Core

The current camera implementation remains mounted through the existing `/cameras` routes while the codebase migrates toward a clearer module layout.

## Target Module Map

- `camera.routes.ts`: route definitions and middleware.
- `camera.controller.ts`: request/response orchestration.
- `camera.service.ts`: registry and binding operations.
- `cameraPlayback.service.ts`: HLS/WebRTC playback contract and token helpers.
- `cameraEvents.service.ts`: event ingestion, severity, notifications, timeline.
- `cameraAccess.policy.ts`: privacy and permission boundary.
- `cameraDvr.service.ts`: DVR/NVR and channel templates.
- `cameraAiProfile.service.ts`: AI profile persistence and policy.
- `cameraStreamHealth.service.ts`: edge stream health normalization.

## Ownership

- Backend coordinates registry, binding, playback, access, stream health, events, and audit/timeline integration.
- Edge owns local LAN/DVR access, go2rtc, RTSP conversion, local credentials, health checks, and event upload.
- Facility owns estate camera operations.
- Consumer owns private home cameras only when privacy scope is `home`.
- Office can view only explicitly permissioned camera/project scopes.

## DVR/NVR Contract

DVR fields:

- `id`
- `name`
- `brand`
- `model`
- `ip`
- `port`
- `rtsp_port`
- `onvif_port`
- `estate_id`
- `edge_node_id`
- `credential_ref`
- `status`

DVR channel fields:

- `id`
- `dvr_id`
- `channel_number`
- `camera_name`
- `location`
- `rtsp_path`
- `rtsp_url_template`
- `enabled`
- `stream_key`

Common RTSP templates:

- Hikvision / HiLook: `/Streaming/Channels/{channel}01`
- Dahua: `/cam/realmonitor?channel={channel}&subtype=0`
- Uniview: `/media/video{channel}`
- Xmeye/generic: `/user={user}&password={pass}&channel={channel}&stream=0.sdp`

Use `credential_ref`; do not persist frontend-submitted raw camera passwords in long-term records.

## V2 Import Endpoints

- `POST /cameras/dvrs/test`: checks backend-side DVR/IP reachability and returns channel drafts only when a real channel count is supplied or discovered.
- `POST /cameras/dvrs/import`: creates or updates a `camera_dvrs` record and creates `facility_cameras` rows for enabled DVR/NVR channels.
- `GET /cameras/dvrs/estate/:estateId`: lists DVR/NVR records for an estate.
- `GET /cameras/inventory/estate/:estateId`: returns DVRs, cameras, and deployment-readiness counts.
- `GET /cameras/edge-registry/estate/:estateId`: returns an Edge/go2rtc-ready registry contract without raw credentials.
- `POST /cameras/:cameraId/validate-stream`: validates source readiness plus the playback contract.

## Privacy Rules

- `facility` cameras are estate/facility scoped.
- `home` cameras require matching private `home_id` metadata.
- `office` cameras require explicit allowed-user metadata.
- Frontend-submitted passwords are accepted only for immediate connection/import flow and are not persisted to camera or DVR records.
