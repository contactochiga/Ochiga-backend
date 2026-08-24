# Oyi Camera Intelligence Runtime — Phase 1

## Authority and projections

`facility_cameras.id` is the canonical camera identity. `camera_infrastructure`
contains spatial/twin and operational projection metadata only. Its `camera_id`
must resolve to a camera in the same estate. The Phase 1 foreign key is `NOT
VALID`: it protects new writes without deleting or silently merging legacy rows.
Unresolved legacy projections are reported by
`camera_infrastructure_unresolved_legacy` for an explicit later reconciliation.

## Runtime boundary

- Backend: identity, estate/home tenancy, RBAC, playback authorization, events,
  canonical health metadata and Oyi evidence.
- Edge: local RTSP reachability, credential resolution, go2rtc configuration,
  stream health and machine event publishing.
- Facility: estate/operator projection.
- Consumer: authorized home projection.
- Digital Twin: spatial projection referencing `facility_cameras.id`.

Edge credentials are configured through `OYI_EDGE_AGENT_IDENTITIES`, a JSON
array of `{ "token", "agent_id", "site_id", "enabled" }`. Payload identifiers
are assertions, never authority. Temporary legacy shared-token support requires
the explicit `OYI_EDGE_ALLOW_LEGACY_TOKEN=true` flag and must be removed after
all nodes receive bound credentials.

Raw camera credentials are onboarding-only inputs. Browser camera responses omit
usernames, passwords, RTSP URLs, internal HLS origins and nested secret values.
Edge resolves `credential_ref` locally and writes generated go2rtc configuration
with owner-only permissions.

## Canonical compatibility fields

Camera responses retain existing snake-case fields and add a normalized `health`
object. Facility and Consumer should converge in Phase 2 on:

- Camera: `id`, privacy scope, estate/building/home/zone IDs, name, location,
  status, stream status, last seen, health, capabilities, provider and Edge node.
- Playback: camera ID, protocol, authorized Backend URL, expiry and optional
  session ID.
- Event: ID, camera ID, type, severity/confidence, `created_at` as ingestion time,
  optional `source_timestamp`, and sanitized metadata.

## Phase 2 gaps

Shared TypeScript contracts/player hooks, Edge-local ONVIF discovery, a durable
media model, recordings/clips/retention, normalized detections, access/visitor
correlation and CV modules remain out of scope for Phase 1.
