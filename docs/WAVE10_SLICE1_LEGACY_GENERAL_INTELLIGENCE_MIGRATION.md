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
the Watch adapter, and the dormant legacy unified service. It remains a
retirement candidate until those record contracts are migrated to canonical
workflow/action read adapters. New canonical code must not import it.

## Automation proposal boundary

`POST /automations/ai-suggest` now enters the registered
`automations.suggest` Core capability. The model-backed `nluToAutomation`
function is a bounded domain parser beneath that capability. The route derives
estate scope from the authenticated actor, supplies only server-loaded device
context, returns a review draft, and does not save or execute an automation.

The existing manual automation write path remains its own governed operational
API; converting proposal acceptance into a durable Core workflow is a later
explicit migration, not an implicit side effect of suggestion parsing.
