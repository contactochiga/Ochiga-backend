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

These tables are separate from `oyi_conversation_threads/messages`, which remain canonical chat history, and separate from operational `ochiga_workflows`, which remain organisational workflow state. `thread_id` is a trace/restoration reference on workflow/action rows, but it is not a hard foreign-key dependency because action preparation can safely occur before canonical turn finalization upserts the conversation thread.

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
- Device action entry reuses the canonical named-device resolver before asking for clarification.
- Room phrases constrain device lookup; they do not become room-level physical actions.
- Multi-gang channel expressions such as `channel 2`, `switch two` and `second channel` are extracted and validated against the selected device's channel definitions.
- Multi-channel devices require a channel unless the user explicitly requests a supported whole-device/all-channel operation; Oyi must not infer Channel 1, all channels or a parent-device power action from a generic device name.
- Channel clarification candidates come from the resolved device's actual channel definitions, including the persisted runtime snapshot when static device metadata is sparse. Resident-facing labels such as `Channel 2` remain separate from canonical executor codes such as `switch_2`.
- Stale selected-subobject metadata from the Consumer UI may provide context, but it is not treated as current-turn channel consent for a fresh multi-gang command.
- Explicit valid channel commands, such as `Turn off 3Gang Living room channel 2`, skip redundant clarification and produce a confirmation bound to the exact device, canonical channel code and requested state.
- If a workflow is awaiting clarification, typed target/channel continuation is evaluated before ordinary capability routing.
- Clearly unrelated requests, such as wallet history while channel clarification is pending, may be answered without cancelling the pending workflow.
- Confirmation restores the active workflow from backend state and binds to `workflow_id`, `action_id`, target, requested state and revision.
- Execution uses the existing `executeDeviceCommandForActor(...)` device command pipeline.
- The durable action records orchestration truth; `ai_execution_ledger` remains the existing device execution truth.
- Automated tests use fake adapters and do not send physical commands.

## Runtime Failure Localization

Device action preparation is now traced as an explicit staged path:

- request started
- capability resolved
- workflow restore started/restored
- target resolution started/resolved/failed
- workflow create started/created/failed
- action create started/created/failed
- confirmation response started/completed
- request failed

Preparation failures return structured safe results instead of collapsing into a generic runtime outage. Target failures remain target-specific, workflow persistence failures report that the pending workflow could not be safely saved, and action persistence failures report that the pending action could not be safely saved. In all preparation failure states, no provider command is sent.
