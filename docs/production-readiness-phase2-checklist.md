# Ochiga Production Readiness Phase 2

## Required Environment Variables

- `APP_JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REDIS_URL`
- `PORT`
- `TUYA_ACCESS_ID`
- `TUYA_ACCESS_SECRET`
- `TUYA_BASE_URL`
- `MQTT_URL` when MQTT bridge is enabled
- `MQTT_USERNAME` and `MQTT_PASSWORD` when broker auth is enabled

## Migration Readiness

- Apply `migrations/schema.sql` for baseline installs.
- Apply all dated migrations in `/migrations` in order.
- Confirm `audit_events`, `device_states`, `device_events`, and intelligence/runtime tables exist before cutover.
- Confirm provider webhook/event tables exist before enabling provider ingestion.

## Health Checks

- `GET /health`
- `GET /health/runtime`
- `GET /metrics`
- Smoke scripts:
  - `npm run smoke:production-readiness`
  - `npm run smoke:provider-health`
  - `npm run smoke:oyi-runtime`

## Rollback Notes

- Roll back application deploy first.
- Revert only schema changes that are known to be backward-safe.
- Keep provider ingestion disabled during rollback if signal compatibility is uncertain.
- Preserve Redis and Supabase credentials during rollback to avoid cascading auth failures.

## Backup Notes

- Confirm Supabase backup/snapshot policy before deploy.
- Confirm Redis persistence or managed snapshot policy if queues/state are relied upon operationally.
- Export critical environment configuration before release.

## Monitoring Hooks

- Structured JSON logs now include request, correlation, and runtime IDs.
- Provider health is exposed through runtime health summaries.
- Metrics cover HTTP requests, runtime evaluations, runtime stage latency, provider failures, socket events, and provider command/discovery/state reads.
- Alert on:
  - `/health` non-200
  - provider `status = offline|degraded`
  - sustained increases in `oyi_provider_failures_total`
  - sustained increases in runtime stage latency metrics
