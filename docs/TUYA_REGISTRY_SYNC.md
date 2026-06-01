# Tuya / Smart Life registry sync

`POST /integrations/tuya/sync` is the canonical authenticated registry refresh endpoint.
The legacy `POST /me/integrations/tuya/sync` route remains available for existing
Consumer builds and delegates to the same service.

## Identity and assignment

- Smart Life and Tuya share provider family `tuya`.
- `devices.external_id` stores the stable Tuya device ID.
- Existing Oyi device IDs and home/room assignments are preserved.
- New devices are stored as `available_unassigned`.
- Missing devices are marked `unavailable`; registry rows are never hard deleted.
- Assigned display names are preserved. The latest provider name is stored in
  `metadata.oyi.provider_name` so provider renames do not overwrite resident naming.

## Background refresh foundation

`syncTuyaRegistryBatch()` is intentionally scheduler-neutral. A production worker
may invoke it periodically for hydrated linked actors. For near-real-time parity
with Alexa-style discovery, configure Tuya webhooks where available and enqueue a
sync when device add, remove, online, or metadata events arrive. Keep periodic
polling as reconciliation because webhook delivery is not guaranteed.
