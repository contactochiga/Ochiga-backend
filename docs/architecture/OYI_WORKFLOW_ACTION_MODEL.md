# Oyi Workflow And Action Model

Status: Phase A foundation.

## Distinction

Conversation workflow and operational workflow remain separate:

- Conversation workflow tracks user interaction state, clarification, review, approval, execution and response.
- Operational workflow tracks business or operational responsibility such as maintenance escalation, deployment or corporate handoff.

They may link by IDs, but they are not the same status model.

## Contract Owners

- `src/oyi-core/contracts/workflow.ts`
- `src/oyi-core/workflows/WorkflowStateMachine.ts`
- `src/oyi-core/contracts/action.ts`
- `src/oyi-core/actions/ActionStateMachine.ts`

## Action Lifecycle

Canonical action statuses:

`draft -> awaiting_confirmation -> approved -> queued -> sent -> provider_accepted -> verifying -> confirmed`

Terminal statuses include:

- `confirmed`
- `unobservable`
- `timed_out`
- `failed`
- `cancelled`
- `superseded`
- `provider_rejected`

Terminal actions are non-reusable.

## Next Required Slice

Durable workflow/action repositories and migrations are not completed by this Phase A contract slice. The next implementation slice should persist conversation workflows and actions with revision/idempotency guarantees, then wire Devices first.
