# Wave 10 Slice 1 — Legacy General-Intelligence Migration

## Canonical fallback retirement

`ConversationOrchestrator` and `canonicalConversationRuntime` no longer invoke
`LegacyConversationAdapter`, `runCanonicalConversation`, or
`runOyiUnifiedChat` for unmatched turns. Their canonical replacement is an
observable governed unsupported result. This preserves scope, capability and
action authority rather than allowing legacy interpretation to re-enter after
canonical selection failed.

## Legacy responsibility matrix

| Legacy responsibility | Canonical owner | Status |
| --- | --- | --- |
| Semantic framing and governed context | `ConversationOrchestrator` + `assembleGovernedContext` | Complete |
| Capability selection and evidence/privacy gate | `CapabilityService` + registry | Complete |
| Workflow/action confirmation | `WorkflowService` + `ActionService` | Complete |
| Canonical turn persistence | `canonicalConversationPersistence` | Complete |
| Generic legacy answer composition | No replacement by design | Retired from canonical fallback; unsupported is explicit |
| Legacy thread/history compatibility reads | `oyiUnifiedIntelligenceService` | Compatibility bridge retained |
| Legacy AI execution ledger/confirmation records | `commandRouter` | Compatibility bridge retained for `/ai/*` ledger APIs and Watch |

## commandRouter boundary

`commandRouter` is no longer reachable from canonical conversation. Its active
callers are restricted to historical `/ai` ledger/confirmation compatibility,
and the Watch adapter. The dormant general-chat export was removed in Slice
10.2A. Office's server-side operations dashboard still reads `/ai/executions`
and `/ai/confirmations`; these are `ai_execution_ledger` records, not aliases
of canonical workflow/action records. Watch likewise still receives legacy
ledger IDs for confirm/cancel. `commandRouter` therefore remains a narrow
compatibility bridge until those record identities have a reviewed migration
and deployed callers move. New canonical code must not import it or use it for
tool selection.

| Remaining caller | Contract | Why it cannot be silently remapped | Retirement prerequisite |
| --- | --- | --- | --- |
| `watchAdapterService` | `routeAiCommand` and confirmation by legacy ledger ID | Watch quick actions return those IDs to deployed clients | Canonical action receipt/confirmation adapter with stable compatibility IDs |
| `/ai/executions`, `/ai/confirmations` | Read `ai_execution_ledger` records | Office dashboard consumes the ledger's historical execution/confirmation view | Read-model migration and Office client cutover |
| `/ai/confirmations/:id/*` | Confirm/cancel legacy ledger record | Deployed clients may hold an existing ledger ID | Canonical confirmation lookup keyed by a compatibility receipt |

## Automation proposal boundary

`POST /automations/ai-suggest` now enters the registered
`automations.suggest` Core capability. The model-backed `nluToAutomation`
function is a bounded domain parser beneath that capability. The route derives
estate scope from the authenticated actor, supplies only server-loaded device
context, returns a review draft, and does not save or execute an automation.

The existing manual automation write path remains its own governed operational
API; converting proposal acceptance into a durable Core workflow is a later
explicit migration, not an implicit side effect of suggestion parsing.

## Direct provider-call inventory

| File | Caller/role | Classification | Authority boundary |
| --- | --- | --- | --- |
| `src/utils/ai.ts` | `automations.suggest` capability | Core subsystem — bounded domain parser | Server-scoped context only; produces a review draft and cannot persist or execute. |
| `src/oyi-core/capabilities/PlanStudioCapability.ts` | Registered Core capability | Canonical Core capability | Read-only, governed capability contract and Core context. |
| `src/services/communicationRuntime/replyClassifier.ts` | Communications runtime | Domain engine | Classifies an inbound communication outcome; it is not conversation orchestration or action authority. |
| `src/services/communications/communicationsMediaAdapters.ts` | Communications media adapters | Domain adapter | Transcription, speech and multimodal transforms; no general reasoning authority. |
| `src/language-teacher/providerRegistry.ts` | Language-teacher feature | Bounded specialist domain engine | Feature-specific instruction; does not select Oyi capabilities or own cross-domain conversation. |

No Office, Facility, Twin or Edge source path in the Slice 1 provider sweep
instantiates a general model client. Office and Facility delegate governed
conversation to Core; Edge remains hardware execution. Twin has no model client.

## Named-agent and Twin handoff disposition

| Role/path | Runtime owner | Scope | Status |
| --- | --- | --- | --- |
| Oma | Backend Core with Office identity/permissions | Office staff, CRM evidence and authorised capabilities | Role around Core; no Office-local model runtime. |
| Osa | Backend Core with public identity/audience | Public knowledge and commercial discovery only | Role around Core; no public-surface model runtime. |
| Twin spatial controller | Twin Engine | Resolved spatial navigation, simulation and asset commands | Deterministic domain runtime; no provider or general reasoning runtime. |

The Twin controller currently responds locally to an unknown/non-spatial phrase
with a spatial-help message. It has no authenticated Core transport/configured
backend endpoint to which it can safely hand the turn off. That is a concrete
handoff integration gap, not a basis for adding an unauthenticated URL or a
second brain. A later Slice must supply the existing Core identity/transport
contract and make unknown Twin turns delegate through it.
