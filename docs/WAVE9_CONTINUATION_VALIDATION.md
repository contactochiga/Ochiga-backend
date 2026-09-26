# Wave 9 continuation evidence

## Completed narrow changes

- Consumer `context.memory.recall` now consumes admitted, owner/scope/expiry-filtered memory through Core's registered read capability. It quotes historical context, does not reuse previous replies as facts, and offers no actions. This is a real consumer, not proof of complete cross-domain memory adoption.
- The executable capability inventory enumerates 73 actual registered capabilities, with existing surface, permission, approval and evidence metadata. It does not invent another catalog or certify every handler's authorization.
- Backend compatible dependency patches plus bcrypt 6.0.0 and BullMQ 5.65.0 reduce npm advisories from 15 (one critical) to 6 (three high, three moderate, zero critical). BullMQ 5.81.5 was rejected due to its incompatible Redis peer requirement; no forced install was used. Remaining AWS SDK v2 / IP library chains require review.

Backend typecheck/build, memory-context smoke and executable inventory pass. Synthetic bcrypt 5 hash remains readable by bcrypt 6; invalid passwords fail and Unicode async/sync roundtrip passes. These are not a complete authentication/load certification.

Real isolated PostgreSQL Final A, Final B and 14E transition suites pass. They use disposable test databases and do not reset the existing local stack or mutate production. Full Wave 5–9 rerun is in progress. Wave 5 device verification, reconciliation and consumer authority initially stopped for local credentials, then passed using the existing local stack's service credential without printing it. Their uniquely named test fixtures are local, not production hardware tests. The memory smoke additionally exercises real Core orchestration with isolated persistence mocks; routing passes, while persistence correctly remains unacknowledged by those mocks.

Twin browser architecture suite now passes against installed Chrome with no browser errors, including scope/privacy isolation. Twin commit `2862dba` declares its previously missing browser-test dependency; generated screenshot/JSON remain unstaged. GitHub PR creation is blocked by connector permissions and unsigned in-app browser, not by test failure.

Facility deeper tracing found five live local-intelligence fallback paths despite earlier audit conclusions. Commits `10054ff` (compatible dependency patches) and `bfb5676` (Core-only loaders and adversarial loader test) are on `codex/wave9-dependency-hardening`. Build, lint and release checks pass. Facility dependency remediation remains incomplete.

## Still open

Final unified run completed: 65/65 Wave 5–9 smoke scripts exit successfully against the current worktree. Commit `c01edc8` corrects 22 old-checkout roots; their earlier results must not substitute for this rerun. Three local-credential suites pass, and Wave 7 identity passes with loopback ingress (does not assert materialization). Office check/lint/build, architecture, knowledge/delegation/handoff and secret checks pass. Facility `f180ece` patches Next 15.5 while retaining five audit findings. Scoped added-diff secret scan across new Backend/Facility/Twin commits finds no high-confidence candidates.

Full context/persona adoption and exhaustive authority classification; tracked/live schema-function-RLS equivalence and historical fresh-chain ordering; remaining dependency advisories; complete regression/CI and authenticated browser validation; draft PR review. Migration-history membership alone does not prove schema equivalence. No migration deleted or applied.

No authoritative branch merge or deployment. **Wave 9 is not closed.**
