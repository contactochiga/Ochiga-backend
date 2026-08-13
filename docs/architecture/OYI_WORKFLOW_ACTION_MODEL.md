# Oyi Workflow And Action Model

Status: Phase C durable conversation workflow/action foundation.

## Distinction

Conversation workflow and operational workflow remain separate:

- Conversation workflow tracks user interaction state, clarification, review, approval, execution and response.
- Operational workflow tracks business or operational responsibility such as maintenance escalation, deployment or corporate handoff.

They may link by IDs, but they are not the same status model.

## Contract Owners

- `src/oyi-core/contracts/workflow.ts`
- `src/oyi-core/workflows/WorkflowStateMachine.ts`
- `src/oyi-core/workflows/WorkflowRepository.ts`
- `src/oyi-core/workflows/WorkflowService.ts`
- `src/oyi-core/contracts/action.ts`
- `src/oyi-core/actions/ActionStateMachine.ts`
- `src/oyi-core/actions/ActionRepository.ts`
- `src/oyi-core/actions/ActionService.ts`

## Persistence

Conversation workflow/action state is durable backend state, not UI memory:

- `oyi_conversation_workflows` stores the active workflow, status, actor/surface/scope, capability, target, revision, expiry and safe metadata.
- `oyi_conversation_workflow_inputs` stores validated structured inputs separately from the workflow row.
- `oyi_actions` stores the pending or executed conversation action with idempotency key, revision, target, requested operation/state, executor reference and terminal result.
- `oyi_action_events` stores safe action audit events.
- `oyi_action_evidence` stores evidence references for action verification.

These tables are separate from `oyi_conversation_threads/messages`, which remain canonical chat history, and separate from operational `ochiga_workflows`, which remain organisational workflow state.

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

## Concurrency And Idempotency

- Workflows and actions carry `revision`.
- Service-layer transitions validate legal state changes before persistence.
- Repository updates support expected-revision checks; stale confirmations must reload current state instead of overwriting.
- Equivalent active actions reuse the same `idempotency_key`.
- Terminal actions cannot be reapproved or re-executed.

## Device First Integration

Devices are the first action domain wired to durable conversation actions:

- `devices.power.control` creates a durable workflow/action and requires explicit confirmation.
- Confirmation restores the active workflow from backend state and binds to `workflow_id`, `action_id`, target, requested state and revision.
- Execution uses the existing `executeDeviceCommandForActor(...)` device command pipeline.
- The durable action records orchestration truth; `ai_execution_ledger` remains the existing device execution truth.
- Automated tests use fake adapters and do not send physical commands.
