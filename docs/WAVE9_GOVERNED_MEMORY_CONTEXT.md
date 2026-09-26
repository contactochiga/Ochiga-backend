# Governed memory/context increment

Canonical contract: src/oyi-core/contracts/memory.ts. The existing Core owns admission and interpretation; storage remains domain-owned. No new memory database, model or reasoning engine.

Kinds distinguish conversation, knowledge references, actor context, authorized relationship context and operational references. A memory value is never a present operational fact or a permission grant. Institution knowledge remains knowledgeRetrieval; CRM facts remain Office; domain live evidence remains its frozen authority.

The first executable adapter reads existing resident_memory: exact actor + estate + home, maximum 20 candidate rows / 8 admitted records, deduplicated keys, restricted value fields, source-row provenance and 30-day context-use expiry from last_seen_at. This is a new conservative context retention policy, NOT a device/camera freshness threshold or a physical data-deletion policy. Owner-write RLS means values remain untrusted context. Legacy rows are not labeled verified facts. Future timestamps and expired rows are excluded. No public or Office surface loads resident memory.

The existing writer now propagates resolved Supabase errors and uses stable primary-key identity (or a pre-existing row ID) so null home values no longer evade conflict identity. Scope lookup includes explicit nulls rather than broadening. No schema change.

assembleGovernedContext is invoked before orchestration: thread ownership, authenticated identity/permissions, authorized scope and admitted resident memories occupy a server-owned slot that replaces client lookalikes. Context does not select/execute tools or reinterpret operational evidence. Existing thread proposal/result-set lifecycle remains the authoritative session mechanism.

Important remaining integration work: the generic contract declares relationship/knowledge/operational reference kinds but does not yet provide every domain adapter; existing Office authorized context still uses its established bridge shape. Resident memory is supplied as context, not a promise that every capability uses it to alter its answer. Full Wave 9 context/memory convergence must be validated before closure.

Validation: typecheck/build, wave9-memory-context-smoke (scope, expiry, bounds, public exclusion, forged fields, DB errors, stable null-home ID), conversation ownership, corporate public integration, canonical runtime structure and security adversarial pass. No production write or migration.
