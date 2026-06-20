# Ochiga Unified Intelligence Fabric: Phase 2

Phase 2 extends the Phase 1 event fabric with workflow orchestration, registered execution, verification, and workflow-first awareness.

## Safety boundary

All registered actions require explicit confirmation. Device commands continue through the existing command router. Visitor access and maintenance state changes are scope-checked against the authenticated actor and emit canonical events after success. Wallet actions remain deliberately unavailable through this registry.

## Workflow lifecycle

`created → assigned/accepted → in_progress → completed → verified`

Terminal alternatives are `cancelled` and `failed`. Every transition writes `ochiga_workflow_events`, agent observability, and an Intelligence event.

## Automatic workflow rules

- Visitor access created, used, or approved creates/updates `visitor_access` workflows.
- Maintenance creation, assignment, completion, and cancellation create/update `maintenance` workflows.
- Offline or failed device events create `security_incident` workflows.
- Community reports create `community_moderation` workflows.
- Office lead/support source events create Office workflows through the Phase 1 bridge.

The orchestrator is best effort and idempotent by a stable source key. It never affects a completed source write.

## Verification

`verificationService` reads authoritative tables for device, visitor, maintenance, service, and workflow completion. Each outcome is persisted as a workflow transition and published as an Intelligence event.

## DLQ intelligence

Failed BullMQ intents remain in `failed_intents` and additionally publish a canonical `execution.failed` event. This enables later retry, dismiss, and investigation surfaces without changing the current queue behavior.
