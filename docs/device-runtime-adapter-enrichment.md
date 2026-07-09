# Device Runtime Adapter Enrichment

## Canonical adapter flow

1. Adapter/provider event or live read enters the device runtime.
2. Provider state is normalized with `enrichDeviceProviderState`.
3. Previous and next state are diffed with `diffEnrichedDeviceState`.
4. The bridge emits:
   - enriched `device_states` persistence
   - device analytics/activity
   - Oyi Core operational signals
   - legacy realtime compatibility events
5. Frontends read the normalized contract through `summarizeDeviceFrontendContract`.

## Tuya mapping approach

Tuya state is normalized into:

- `normalized_state`
- `primary_state`
- `health_status`
- `telemetry_summary`
- `supported_controls`
- `control_profile`
- `device_type`
- `device_family`
- `provider_health`
- `activity_summary`

The adapter recognizes common Tuya codes for:

- `switch`, `switch_1`, `switch_2`, `switch_3`
- `online`
- brightness
- color / color temperature
- temperature / humidity
- battery
- lock state
- curtain/blind position
- countdown / timer / schedule hints
- device faults

Raw provider payload remains available in metadata/evidence and is not the primary frontend state.

## Signal types emitted

Meaningful transitions emit one of:

- `device.power.on`
- `device.power.off`
- `device.state.changed`
- `device.telemetry.received`
- `device.online`
- `device.offline`
- `device.health.degraded`
- `device.command.executed`
- `device.command.failed`
- `device.provider.sync`

## Origin inference

The runtime classifies changes as:

- `consumer_app`
- `facility_app`
- `office_app`
- `automation`
- `physical`
- `provider`

If a provider/device state change arrives without a recent matching Oyi command, the runtime treats switch-like changes as likely physical/manual actions and other background updates as provider-origin sync.

## Frontend contract

Backend device read endpoints now expose a stable contract built from the enriched state:

- `state`
- `normalized_state`
- `capabilities`
- `supported_controls`
- `control_profile`
- `health_status`
- `provider_health`
- `primary_state`
- `telemetry_summary`
- `device_family`
- `device_type`
- `last_signal`
- `activity_summary`

This preserves backward compatibility while giving Consumer, Facility, Activity, Notifications, and future Digital Twin a richer operational model.

## Next integrations

The same enrichment/runtime contract should be extended to:

- KNX
- ONVIF / DVR / NVR
- Matter
- MQTT-native edge devices
