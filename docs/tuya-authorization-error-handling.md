# Tuya Authorization Error Handling

## Canonical behavior

Tuya error `1106` is a device/account authorization condition. It is not evidence that the physical device is offline.

Runtime V2 preserves the last cached or persisted state, exposes `provider_health=authorization_required`, and returns the resident-safe warning: `This device needs its Tuya connection refreshed.` If no prior state exists, physical connectivity remains unknown rather than being reported as offline.

Provider failures use these canonical classifications:

- `permission_denied`
- `device_not_linked`
- `integration_expired`
- `provider_unavailable`
- `rate_limited`
- `authentication_failed`
- `unknown_provider_error`

## Retry and recovery

Authorization failures use per-device persisted backoff. The first retry is delayed for five minutes, then doubles to ten, twenty, forty, and sixty minutes. One hour is the maximum delay. Screen opens during suppression return cached state and do not call Tuya.

A successful provider read clears the error and returns the authorization state to `authorized`. Saving a new Smart Life UID clears the retry gate so the relink can be verified immediately. Registry sync clears suppression only for devices rediscovered under the linked account.

## Attention and state events

Runtime V2 emits one deduplicated `device.provider.authorization_required` signal for an unresolved authorization condition. It does not emit `device.offline` or `device.state.changed` merely because provider authorization metadata changed. Recovery emits `device.provider.sync` through the existing Oyi Core signal path.

## Operator diagnostic

Facility operators can request:

`GET /devices/runtime/diagnostics/tuya?verify_provider=true`

The endpoint requires authentication, `devices.read`, an active estate, and an operator/facility role. Provider verification lists the linked Smart Life devices once per UID and compares them with canonical registry identities. It never returns Tuya secrets or raw credential payloads.

The report includes internal and external device IDs, integration owner, linked UID, metadata ownership trace, raw category/owner fields, last successful refresh, last safe provider error, authorization state, and suggested remediation.

