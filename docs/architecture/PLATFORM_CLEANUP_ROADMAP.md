# Platform Cleanup Roadmap

This roadmap turns the audit findings into small executable phases. It is intentionally conservative.

## Phase 0 - Baseline / Audit

Objective:

- Establish repository truth, architecture map, risks, tests and safe docs.

Repositories:

- Backend, Edge/Office, Consumer, Facility, Website.

Status:

- Completed in this documentation pass.

Validation run:

- Backend: `npm run typecheck -- --pretty false` PASS.
- Backend: `npm run build` PASS.
- Backend: `npm run validate:security` PASS with warning: `aws-sdk` v2 still present.
- Backend: `npm run audit:security` PASS; no RLS gaps reported.
- Backend: `npm run validate:release` PASS.
- Edge/Office: `npm run check` PASS.
- Edge/Office: `npm run build` PASS.
- Edge/Office: `npm run lint` PASS.
- Edge/Office: `npm run validate:release` PASS.
- Facility: `npm run lint` PASS.
- Facility: `npm run build` PASS.
- Facility: `npm run validate:release` PASS.
- Consumer active nested copy: `npx tsc --noEmit --pretty false` PASS.
- Consumer active nested copy: `npm run build` PASS with warnings and Next workspace-root warning.
- Consumer active nested copy: `npm run lint` PASS with 43 warnings.
- Consumer active nested copy: `npm run validate:release` PASS.
- Website: `npm run lint` PASS.
- Website: `npm run build` PASS with edge-runtime/static-generation and localstorage-file warnings.

What must not change:

- Runtime behavior, schemas, deployments, public APIs.

Rollback point:

- Documentation-only commit can be reverted without runtime effect.

## Phase 1 - Contracts And Safety Rails

Objective:

- Make current boundaries explicit before moving or modularizing code.

Repositories:

- Backend primary.
- Consumer/Facility for contract validation only.
- Edge/Office and Website for intake/edge contract tests only.

Likely files/modules:

- Backend `src/oyi-core/contracts/*`
- Backend `src/routes/officeExport.ts`
- Backend `src/routes/edgeDiscovery.ts`
- Backend `src/routes/oyiRoutes.ts`
- Consumer `src/services/oyiService.ts`
- Facility `services/oyiService.ts`
- Edge/Office `agent.js`, `src/lead-agents/office-sync.js`
- Website `app/api/leads/route.ts`, `app/api/deployments/route.ts`

Work:

- Add versioned contract docs for Edge heartbeat/discovery/config.
- Add versioned contract docs for Office export/projection.
- Add versioned conversation request/response contract tests.
- Add ownership comments in key files where behavior is protected.
- Add no-secrets validation to Edge/Office repo.
- Decide active Consumer checkout location and clean up stale/nested workspace risk.

Tests before:

- Current Phase 0 validation matrix.

Tests after:

- Backend typecheck/build/security/release.
- Consumer typecheck/build/validate.
- Facility lint/build/validate.
- Edge/Office validate release.
- Website build/lint.

Rollback point:

- Revert safety-rail docs/tests only.

Must not change:

- No public API shape changes.
- No production schema changes.
- No deployment target changes.

Expected commits:

- Backend: contract docs/tests.
- Edge/Office: optional no-secret guard.
- Website/Consumer/Facility only if tests require compatibility.

## Phase 2 - Office / Edge Separation

Objective:

- Separate Office/CRM/lead-agent responsibilities from local Edge runtime without breaking live public routes.

Repositories:

- Edge/Office mixed repo.
- New or selected Office repo.
- Website for endpoint config only.

Dependencies:

- Phase 1 contracts and tests.
- Decision: create new Office repo or use existing repo.

Migration requirements:

- Preserve Render lead-agent health/API routes.
- Preserve Vercel rewrites until replacement passes.
- Split env templates.
- Validate no Edge local credentials are required by Office.

Tests before:

- Edge validate release.
- Lead-agent tests.
- Website build.

Tests after:

- Edge dry-run health.
- Office lead-agent health/public intake.
- Website form-to-Office test using non-production fixture.

Rollback point:

- Restore Vercel rewrites to old Render service.

Must not change:

- Backend canonical operational truth.
- Website UI.
- Edge payload contracts.

## Phase 3 - CRM Normalization + Website Ingestion

Objective:

- Make website enquiries durable CRM intake instead of email-first storage.

Repositories:

- Website.
- Office.
- Backend only if Office ingestion is hosted there by decision.

Dependencies:

- Office boundary decision.
- CRM target contract approval.

Migration requirements:

- Canonical intake endpoint.
- Idempotency keys.
- Lead/contact/account/opportunity mapping strategy.
- Email as notification after durable write.

Tests before:

- Website lead API tests/build.
- Office CRM ingestion tests.

Tests after:

- Duplicate submission test.
- Email failure does not lose CRM event.
- CRM failure returns clear website error.

Rollback point:

- Keep old email/fallback path behind config.

Must not change:

- Website visual design during concurrent active work.

## Phase 4 - Office / Backend Convergence

Objective:

- Make Office consume Backend operational projections/events without duplicating canonical building truth.

Repositories:

- Backend.
- Office.

Work:

- Harden `/office/export`.
- Define projection freshness and authority.
- Remove Office writes to operational projection tables where Backend source is available.

Tests:

- Office sync contract.
- Backend permission/privacy tests.
- Facility/Consumer no-regression tests.

Rollback point:

- Continue using existing Office projection tables.

Must not change:

- Backend canonical operational models without migration plan.

## Phase 5 - Conversation Modularization

Objective:

- Move one domain at a time from legacy monolith into `ConversationOrchestrator` domain adapters.

Repositories:

- Backend primary.
- Consumer/Facility for rendering contract tests.

Likely modules:

- `src/oyi-core/orchestration/*`
- `src/oyi-core/capabilities/*`
- `src/oyi-core/domains/*`
- `src/oyi-core/runtime/canonicalConversationRuntime.ts`

Migration:

- Device domain first because partial adapter exists.
- Then rooms/home summaries.
- Then wallet/services/visitors/maintenance.
- Then Office/website channels.

Tests before/after:

- Public conversation route roundtrip.
- Thread persistence/restoration.
- Domain-specific authority/privacy tests.
- Device/IR/Smart Access safety tests.

Rollback:

- Capability rollout flags fall back to legacy.

Must not change:

- Protected device control behavior.
- Thread/history behavior.
- Facility privacy.

## Phase 6 - Intelligence / Knowledge Convergence

Objective:

- Align Backend Oyi Core, Office knowledge, website messaging and agent prompt packs without merging private data scopes.

Repositories:

- Backend.
- Office.
- Website.

Work:

- Knowledge source inventory.
- Source attribution.
- Office channel adapter.
- Website conversational handoff model.

Tests:

- Privacy boundaries.
- Office does not see resident-private memory.
- Website does not expose internal claims.

Rollback:

- Keep Office lead-agent knowledge local.

## Phase 7 - Hardening / Observability / Release Cleanup

Objective:

- Remove stale checkouts, rotate exposed local secrets, migrate `aws-sdk` v2, centralize contract generation, and finish release automation.

Repositories:

- All active repos.

Work:

- Clean active Consumer checkout strategy.
- Secret scanning and rotation.
- Dependency hardening.
- Deployment docs.
- Observability dashboards.

Must not change:

- Runtime semantics except as covered by tests.

## Implementation Progress — 2026-08-11

Completed or in progress on working branches:

- Active Consumer repository ambiguity resolved locally by excluding nested active repositories from the parent workspace without deleting the stale checkout.
- Phase 1 boundary contract implemented in Backend code with a release smoke.
- Office extracted into a new private standalone repository and validated independently.
- Edge cleaned toward an Edge-only runtime and validated independently.
- Website lead/deployment server routes submit canonical Office CRM intake envelopes while preserving email/fallback behavior.
- Conversation monolith responsibilities for time/freshness labels and structured answer/table presentation extracted into dedicated presentation modules.
- Office deployment cutover is prepared with a deployment config validator and approval-gated cutover plan.

Remaining before broad production adoption:

- apply additive Office CRM schema in a controlled environment;
- wire optional Office material-event publishing into Backend/Oyi Core;
- continue conversation modularization through focused responsibility migrations;
- rotate/replace credentials listed in each rotation checklist;
- run full cross-repository release validation after branch review.
