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

## Consumer onboarding surfaces

- `GET /me/integrations/tuya` reports whether the linked UID exists and whether
  `TUYA_ACCESS_ID` plus `TUYA_ACCESS_SECRET` are configured on the backend.
- `PATCH /me/integrations/tuya` stores the resident's supported Tuya UID.
- Connected Systems owns provider linking and cloud sync.
- Add Device owns assignment of imported `available_unassigned` devices into the
  active home and optional room.

## Current provider limitations

- Smart Life / Tuya devices are best imported through cloud sync. Direct Wi-Fi
  scan will not normally find Tuya devices without local keys and Oyi Edge.
- The Consumer nearby scan currently uses supported LAN discovery adapters such
  as SSDP. Deeper ONVIF, MQTT, and offline/local execution depend on an installed
  Oyi Edge node and its supported bridge path.
- Provider room/group metadata may be retained in device metadata but must not
  overwrite Oyi room assignments without resident confirmation.
- Imported provider scenes and automations are not executed until a safe provider
  scene contract is implemented.
- Alexa, Google Assistant, and Apple Home statuses must remain informational and
  must not be presented as connected unless their own backend records confirm it.
