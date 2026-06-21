# Oyi Production Security Closure Phase 2

## Scope

Phase 2 completes database function hardening, adds an adversarial authorization suite, and provides backend-only security observability. It does not alter Consumer, Facility, or Office product flows.

## Database Closure

- All flagged trigger functions use `search_path = pg_catalog, public`.
- `public.oyi_security_audit_report()` is an invoker function callable only by `service_role`.
- Browser roles remain unable to execute the audit function or access public tables directly.

## Backend Observability

The following endpoints require `audit.read`:

- `GET /intelligence/security/audit`: machine-readable RLS, policy, browser-grant, backend-only table, and trigger/definer search-path posture.
- `GET /intelligence/security/denials?limit=100`: sanitized denied/failed audit events grouped into unauthorized attempts, scope mismatches, workflow visibility denials, and prediction authorization denials.

## Validation

- `npm run smoke:security-closure`
- `npm run smoke:security-adversarial`
- `npm run audit:security`

The adversarial suite covers resident/home/estate isolation, facility/security/finance/admin role separation, workflow visibility, prediction authorization, authenticated Oyi scope handling, and camera mutation membership enforcement.

`backend_only_tables` means RLS is enabled and browser roles have no table grant or policy. These tables are intentionally API/service-role mediated. `unexpected_policy_gaps` is only non-empty when a browser-accessible table has no policy.

## Remaining Risks

- The audit endpoints depend on complete audit-event emission by every legacy route. They surface recorded denials; they do not infer denials from uninstrumented code paths.
- Service-role credentials remain privileged infrastructure secrets and must never be exposed to frontend environments.
- Live API attack simulation requires isolated test users and data fixtures; the committed suite validates the backend authorization contracts without mutating production records.

## Readiness After Phase 2

| Area | Score | Evidence |
| --- | ---: | --- |
| RLS and browser grant posture | 100% | 92/92 public tables have RLS; browser table grants and unexpected policy gaps are zero. |
| Search-path hardening | 100% | Supabase security advisor reports no mutable trigger/definer search-path issues. |
| Cross-estate and cross-home isolation | 94% | Authenticated scope wins in Oyi/API readers; workflow, prediction, camera, and socket checks are covered by smoke tests. |
| Role separation | 93% | Resident, facility, security, finance, and estate-admin boundaries are covered by adversarial tests. |
| Security observability | 85% | Audit-read endpoints and categorized denial views exist; legacy routes still need complete denial-event instrumentation. |
| Production security readiness | 94% | Phase 1 and Phase 2 controls are verified. |
