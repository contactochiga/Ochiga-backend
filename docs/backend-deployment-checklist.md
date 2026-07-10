# Backend Deployment Checklist

## Before Staging

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run smoke:production-readiness`
- `npm run smoke:provider-health`
- `npm run smoke:oyi-runtime`
- `npm run smoke:device-schema`
- `npm run validate:env`
- `npm run validate:security`
- `npm run validate:release`

## Before Production

- Confirm `APP_JWT_SECRET`, Supabase, Redis, Tuya, MQTT, and mail settings are present for enabled features.
- Confirm latest migrations have been applied in order.
- Confirm `devices.parent_device_id` and `devices.is_virtual` exist before promoting a device or IR runtime build.
- Confirm `/health`, `/health/runtime`, and `/metrics` are reachable from the deployment target.
- Confirm smoke credentials and post-deploy verification plan exist.

## After Deploy

- Verify `/health` returns `200`.
- Verify provider health summary returns expected states.
- Verify runtime metrics increment after a controlled signal test.
- Verify socket authentication and protected route access with a real token.
