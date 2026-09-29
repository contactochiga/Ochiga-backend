# Wave 10 — One-Core Convergence Certification

## Scope and evidence

This certification covers intelligence authority, not the separate operational
database deployment debt listed at the end of this document. It is based on
the Wave 10 retirement branch, the explicit Office Core-delegation change, and
the architecture guards and smoke tests named below. No production change,
historical migration rewrite, or new intelligence framework was introduced.

## Canonical authority map

```text
signal / request
  -> governed identity, scope and context assembly
  -> canonical knowledge + governed memory + authorised live evidence
  -> ConversationOrchestrator + registered CapabilityService
  -> proposal / confirmation / ActionService or domain execution authority
  -> execution result, verification, audit and outcome feedback
```

| Stage | Authoritative owner | Boundary |
| --- | --- | --- |
| Conversation, intent/objective and response move | Backend `ConversationOrchestrator` and canonical runtime | No legacy general-chat fallback. |
| Context and identity | Backend governed context assembly and surface policy | Surfaces provide bounded inputs; they do not assert authority. |
| Knowledge and memory | Backend knowledge contracts/retrieval and governed memory contracts | Audience and agent visibility filter before use. |
| Capability selection | Backend registered capability registry and `CapabilityService` | Capability evidence, permission and rollout gates apply. |
| Mutation authority | Backend Action/Workflow and domain execution authorities | Knowledge or recommendation never grants execution. |
| Physical execution | Domain execution/verification stores, including `ai_execution_ledger` where applicable | Execution verification is not conversational/action-planning truth. |
| Outcome/learning | Canonical signal, intelligence, goal and outcome services | Domain engines provide evidence rather than general conversation authority. |

## Retirement and compatibility disposition

| Former path | Final status | Evidence |
| --- | --- | --- |
| `runOyiUnifiedChat` | Deleted | `wave10-canonical-fallback-retirement-smoke.mjs` and legacy-awareness narrowing guard reject reintroduction. |
| Canonical runtime fallback to legacy chat | Retired | `ConversationOrchestrator` and canonical runtime cannot invoke the legacy general-chat function. |
| `oyiUnifiedIntelligenceService` | Narrow compatibility/data module retained | It exports `OyiSurface`, context/history readers and explicitly disclosed awareness presentation only; it has no general-chat export. |
| `commandRouter` | Narrow legacy Watch and `/ai` receipt compatibility bridge | Canonical runtime and orchestrator cannot import it. It has no provider-backed general conversation path. |
| `ai_execution_ledger` | Retained canonical physical-execution/verification record plus historical receipt compatibility | It is not interchangeable with Action/Workflow state. Device execution, verification and outcome contracts still use it. |
| `/automations/ai-suggest` | Canonical Core capability | Registered `automations.suggest` returns a non-executing proposal; the bounded parser cannot persist or execute. |
| Office Plan Studio agent answer | Delegated to Core | Office sends only server-loaded `plan_review_context` through the authenticated Office-internal conversation transport to `office.plan_studio.review`; Core unavailability returns an honest error. |

The remaining `commandRouter` callers are deliberately constrained: Watch
compatibility and historical `/ai/executions` and `/ai/confirmations` receipt
contracts. Their final removal requires a separately reviewed stable receipt
and confirmation projection for deployed Watch and Office consumers. They do
not exercise a provider-backed general reasoning or capability-selection path.

## Surfaces, agents and domain runtimes

| Surface/role | Authority classification | Scope |
| --- | --- | --- |
| Oma | Role around Backend Core | Office audience, CRM evidence and authorised Office capabilities. |
| Osa | Role around Backend Core | Public audience, public/commercial knowledge and discovery constraints. |
| Office | Operational owner and Core adapter | Owns CRM/Plan Studio records and bounded media/geometry tools; delegates general responses and planning to Core. |
| Facility | Domain runtime | Facility operations/UI; no direct general-provider client found. |
| Twin | Deterministic spatial/domain runtime | `CoreConversationHandoff` delegates unknown/non-spatial requests when a host supplies authenticated transport; otherwise returns explicit `handoff_required`, never a fabricated general answer. |
| Edge | Hardware/device runtime | Produces observations and executes device domain work; no general conversation/provider runtime found. |

The remaining Office provider calls are classified as bounded domain tools:
audio transcription and structured plan-image geometry extraction. The latter
does not answer planning questions, select capabilities, grant permissions or
perform actions. Backend provider calls are either canonical Core capabilities
(`office.plan_studio.review`), Core-bounded proposal parsing, communications
media/classification, or the language-teacher specialist. No active
Backend/Office/Facility/Twin/Edge provider-backed general second brain was
found in the final source sweep.

## Final guards and validation

Passed on the Wave 10 candidate:

- Backend `npm run typecheck` and `npm run build`.
- Wave 10 canonical fallback, command-router and automation-authority guards.
- Legacy general-chat/awareness narrowing guard.
- Canonical intelligence authority, conversation foundation, memory/context,
  capability inventory (74 capabilities), conversation, security/adversarial
  and physical action-authority smokes.
- Office `check`, `lint`, `build`, Core delegation, internal contextual
  delegation, public intelligence and Office architecture guard. The Office
  guard now proves Plan Studio answers cross the Core gateway and cannot make a
  local provider response.
- Facility lint and production build.
- Twin Core handoff guard and deterministic architecture/representation runs.

Two database-backed local smoke groups were **BLOCKED**, not failed, because
this checkout lacks `OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL`.
Twin's full TypeScript build remains separately **BLOCKED** by pre-existing
errors in `ExploreController.tsx` and `TopCommandBar.tsx` (`Property 'src'
does not exist on type 'never'`); the deterministic handoff/architecture
boundary checks are independent and passed. These are not evidence of a second
intelligence authority.

## Certification

**WAVE 10 ONE-CORE CONVERGENCE CERTIFIED** for the intelligence architecture:
there is one canonical general Oyi Core; agents are roles around that Core;
surfaces and domain engines do not retain an active general-purpose second
brain; and the retained compatibility paths are fenced from canonical
conversation and capability authority.

## Inherited Wave 9 operational debt — untouched

- `20260926205543`
- `20260926212124`

These camera scope/DVR production migrations are separate operational database
work. This certification neither applies nor represents them as resolved.
