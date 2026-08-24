# Oyi Camera Gateway Phase 3

## Boundaries

- **Edge:** private LAN discovery, ONVIF/RTSP reachability, local credential resolution, go2rtc stream configuration and camera observations.
- **Backend:** authenticated discovery commands, estate/home policy, candidate persistence, explicit provisioning into canonical `facility_cameras`, canonical health/events and realtime authorization.
- **Camera Core/surfaces:** safe camera semantics and Backend-issued playback only. Private IPs, ONVIF endpoints, RTSP URLs and credentials are excluded.

## Lifecycle

`command → Edge discovery → candidate → authorized provision → facility_cameras → Edge stream → health/events`

Candidates live in `discovered_devices` and cannot become canonical cameras implicitly. Reconciliation uses a stable fingerprint, preferring ONVIF endpoint UUID, serial, hardware or MAC identity over mutable IP addresses. Duplicate and cross-scope provisioning is rejected.

Commands are delivered through the existing Edge config poll and are bound to the authenticated estate/node. They expire and use acknowledgement/completion state to prevent replay. Consumer discovery additionally requires matching home scope and explicit node opt-in.

Cloud-side ONVIF scanning has been removed. Oyi Edge is the only private-LAN camera discovery executor. Offline Edge nodes keep already configured local media running; discovery synchronization resumes through the authenticated command/outbox path.

Phase 4 may add snapshots, clips, recording references and retention without changing canonical camera identity or the Edge/private-network boundary.
