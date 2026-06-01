# Oyi Facility OS 120-Unit Pilot Onboarding

This folder contains safe import templates for onboarding the first real 120-unit estate into Oyi Facility OS.

## Required Data

Provide the following files in one folder:

- `estate.json` - estate profile and estate code.
- `buildings.csv` - blocks/buildings inside the estate.
- `homes.csv` - all 120 units/homes.
- `rooms.csv` - optional room/space records for unit-level device binding.
- `residents.csv` - resident account placeholders and home assignments.
- `staff.csv` - facility operators/security/admins.
- `zones.csv` - security, utility, access, traffic, shared, and operational zones.
- `access_points.csv` - gates, pedestrian entry points, service gates, turnstiles.
- `cameras.csv` - Hikvision/DVR/NVR camera placeholders.
- `devices.csv` - access controllers, meters, sensors, lighting, utilities, smart-home and edge placeholders.
- `edge_nodes.csv` - local edge runtime placeholders.

## Safety Rules

- Do not put camera passwords in any CSV file.
- Do not put raw RTSP credentials in public records.
- Use `AWAITING_STREAM_DETAILS` for unknown stream URLs.
- Run dry-run first. Do not use `--apply` until dry-run returns `ok: true`.
- Do not use `--allow-existing` unless you intentionally want to append non-duplicate records to an existing estate.

## Dry-Run Command

```bash
node scripts/pilot-import.mjs --dir=pilot/120-unit-template/sample
```

For real data:

```bash
node scripts/pilot-import.mjs --dir=/absolute/path/to/pilot-data
```

If you want the dry-run itself recorded in `audit_events` without creating estate/building/unit records:

```bash
node scripts/pilot-import.mjs --dir=/absolute/path/to/pilot-data --record-dry-run --actor-email=contactochiga@gmail.com
```

## Production Import Command

```bash
node scripts/pilot-import.mjs --dir=/absolute/path/to/pilot-data --apply --actor-email=contactochiga@gmail.com
```

If appending to an already-created estate after confirming there are no accidental duplicates:

```bash
node scripts/pilot-import.mjs --dir=/absolute/path/to/pilot-data --apply --allow-existing --actor-email=contactochiga@gmail.com
```

## Required Environment For Apply

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Migration Required First

Apply:

```sql
migrations/2026-05-21-pilot-onboarding-foundation.sql
```

This creates/import-readies:

- `estate_buildings`
- `estate_zones`
- `access_points`
- `facility_cameras`
- `edge_nodes`
- `edge_heartbeats`
- `utility_events`
- `incidents`
- `deployment_milestones`
- device telemetry placeholder columns

## Stream Onboarding Checklist

1. Confirm Hikvision DVR/NVR model and channel count.
2. Map every physical camera to `camera_id`, `name`, `location`, and `zone_ref`.
3. Keep camera username/password outside CSV and frontend records.
4. Validate RTSP/HLS stream through backend camera endpoints.
5. Set camera status from `pending` to `online` only after stream validation.
6. Set `health_status` to `healthy`, `degraded`, or `error` after real stream tests.
7. Run AI detection test only after stream health is stable.

## Edge Runtime Checklist

1. Provision edge machine/NVR network access.
2. Configure `OYI_EDGE_AGENT_TOKEN` or token set.
3. Register `edge_node_id` in `edge_nodes.csv`.
4. Verify local runtime host is not public unless intentionally exposed.
5. Push first `edge.heartbeat` event.
6. Confirm `camera_count`, `device_count`, `queue_depth`, `sync_status`, `error_count`, and `runtime_version` update.
7. Confirm Office/Facility realtime surfaces receive `edge.heartbeat`.

## Deployment Documentation Checklist

Record milestones for:

- estate setup
- building import
- unit import
- camera onboarding
- device onboarding
- edge runtime test
- stream test
- AI detection test
- incident test
- operator action
- verification checkpoint

The import script writes deployment milestones and audit events for completed imports, camera placeholders, edge placeholders, and verification checkpoints. Dry-runs can write `pilot.import.dry_run` only when `--record-dry-run` is explicitly passed.
