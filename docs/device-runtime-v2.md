# Oyi Device Runtime V2

Device Runtime V2 makes Oyi's in-process runtime and `device_states` snapshots the read path for device state. Provider adapters synchronize state into the runtime; HTTP consumers do not wait for provider cloud reads.

## Canonical flow

```text
Provider adapter
  -> DeviceRuntimeStateService
  -> in-memory runtime snapshot
  -> device_states persistence
  -> device.state.updated websocket event
  -> Oyi operational signal when state meaningfully changes
```

`DeviceRuntimeStateService` owns state freshness, refresh scheduling, single-flight deduplication, persistence, and realtime publication. Adapters retain discovery, command dispatch, and live-state reads only.

## Freshness policy

- `0-10s`: fresh; return immediately.
- `10-60s`: stale; return immediately and enqueue a normal refresh.
- `>60s`: expired; return immediately and enqueue a high-priority refresh.
- Missing snapshot: return a synchronizing runtime response and enqueue a high-priority refresh.

The refresh queue permits five concurrent provider reads. Requests for the same device share one in-flight refresh.

## HTTP contracts

`GET /devices/:deviceId/state` returns the current memory or persistent snapshot and never waits for a provider read. Existing enriched fields remain available, with additional runtime fields:

- `provider_timestamp`
- `runtime_timestamp`
- `last_refresh`
- `ttl`
- `stale`
- `freshness`
- `provider_latency_ms`
- `synchronizing`

`GET /devices/runtime` returns active-scope runtime summaries for dashboard use. It performs no inline provider reads. Residents remain restricted to their active home; estate-wide roles remain estate-scoped.

## Commands and events

After an adapter accepts a command, the request returns `partial_confirmation` without waiting on a provider state read. A high-priority refresh runs after the provider has had time to apply the command. Its result updates the snapshot and arrives through WebSocket.

MQTT/provider events enter the same runtime service. Virtual IR children keep their canonical child ID while live reads route through the parent hub.

## Realtime contract

The canonical event is `device.state.updated`. Its payload includes:

- canonical device and location IDs
- `state` and `summary`
- `normalized_state`
- `primary_state`
- health and provider health
- provider/runtime timestamps
- freshness metadata

The compatibility events `device.status.updated` and `device:update` carry the same payload during migration.

## Validation

Run `npm run smoke:device-runtime-v2`. It verifies hydration without provider access, stale and expired behavior, single-flight refresh, concurrency five, persistence, WebSocket payloads, command-triggered refresh, and cached dashboard latency.
