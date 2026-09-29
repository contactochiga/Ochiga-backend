# Plan Studio Core delegation

Office owns stored draft plans, authenticated project access, image/geometry extraction and deterministic geometry. It no longer generates a local planning answer or fallback assessment at `/api/plan-studio/agent`.

The authenticated Office server loads the project and sends a bounded projection to the existing internal Core bridge. Browser-supplied project evidence, staff permissions, image bytes and unrelated CRM snapshots are not forwarded. Core normalizes the projection and selects `office.plan_studio.review` through its existing capability registry, permission service and evidence pipeline. `planstudio.read` and `office_internal` are required. This is an advisory read capability, with no executable actions, no compliance certification and no claim that draft devices are installed.

Core's existing provider adapter supplies the advisory answer. Provider failures return unavailable. No live provider quality test has been performed: deterministic tests inject an answer/failure and verify routing and authorization, not model factual accuracy.

The response acknowledges the **actually executed** capability and result in `safe_metadata.plan_review` (version 1). Office accepts only `answered`, advisory-only responses from that capability. Missing acknowledgement, including an older Backend, yields 503 without local reasoning. Deploy Backend support before Office adoption; no database migration is required. No deployment was performed.

Tests: Backend `wave9-plan-review-smoke.mjs`; Office `test-wave9-plan-core.js` and `test-office-intelligence-architecture-guard.js`. Tests cover bounded evidence, public/permission denial, absent evidence, provider outage, actual orchestration selection, authenticated server-loaded project identity, no image/CRM leakage, no local provider calls, and old-Core rejection. The orchestration test mocks persistence and does not certify database persistence.

This closes this specific independent reasoning path, not the entire Wave 9 audit.
