# Release Gates

## Must Pass Before Staging

- Backend CI workflow
- `npm run validate:env`
- `npm run validate:security`
- `npm run validate:release`
- all backend smoke tests

## Must Pass Before Production

- Staging validation complete
- production environment variables verified
- database migrations applied
- runtime health endpoints verified
- provider health verified for enabled integrations

## Release Blockers

- Missing `APP_JWT_SECRET`
- Missing Supabase or Redis connectivity for enabled runtime paths
- failing runtime smoke tests
- failing security validation
- missing rollback or monitoring readiness

## Post-Deploy Verification

- call `/health`
- call `/health/runtime`
- call `/metrics`
- verify one authenticated API route
- verify one socket subscription
- verify one controlled runtime signal path
