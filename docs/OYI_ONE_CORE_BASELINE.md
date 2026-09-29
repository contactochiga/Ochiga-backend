# Oyi One-Core Baseline

**Frozen:** 2026-09-29

This is the authoritative post-landing record for the Oyi intelligence
architecture. It records the merged state; it does not introduce a new
intelligence subsystem or change runtime authority.

## Authoritative repository heads

| Repository | Authoritative branch | Head |
| --- | --- | --- |
| Ochiga Backend | `main` | `4db95a66b6a8689dc967f884ddb9a70fad10402d` |
| Ochiga Office | `codex/office-extraction` | `de392d8aa19d06bb7e61af60b771f3a5264adf91` |
| Oyi Twin Engine | `main` | `0f7ee6c1c6b5a2d1cf62fd32e09d77f9ddef653c` |
| Facility Oyi | `main` | `fb093fdacfbbcbb37bd49d4bb2c1c1e37480fe6c` |
| Oyi Edge Agent | `main` | `d2715f1cef7d9291c0ec1cda546551d91e1d2562` |

Backend PRs #90 and #91, Office PR #85, Twin PRs #1 and #2, and Facility
PR #38 are included in these heads. The duplicate Office provenance branch
containing `b071f23` is intentionally not part of the baseline.

## Canonical authority map

```text
signal or request
  -> governed identity, scope and canonical context
  -> authorised knowledge, governed memory and live evidence
  -> Backend ConversationOrchestrator and CapabilityService
  -> proposal, confirmation and Action/Workflow authority
  -> domain execution, verification, audit, outcome and learning
```

| Responsibility | Canonical owner | Boundary |
| --- | --- | --- |
| General reasoning, intent/objective and response move | Backend Oyi Core | Surfaces cannot install a fallback general chat path. |
| Knowledge, memory and context | Backend governed contracts | Audience, identity, scope and server-owned permissions apply before retrieval. |
| Capability selection and action authority | Backend registry, CapabilityService and Action/Workflow contracts | Interpretation can propose; it cannot self-authorise or execute. |
| Office CRM and Plan Studio records | Office operational owner | Office transports authorised evidence to Core; it does not own general reasoning. |
| Facility operations | Facility domain runtime | Facility has no local general-provider fallback. |
| Spatial simulation/navigation | Twin deterministic domain runtime | Unknown/non-spatial turns use `CoreConversationHandoff` or return `handoff_required`. |
| Device telemetry and execution | Edge/domain runtimes | Hardware execution is not general conversation authority. |

The executable capability inventory contains **74** registered capabilities.
Oma and Osa are roles around this shared Core: persona, audience, objective,
knowledge/memory scope and permitted capabilities do not create separate model
runtimes.

## Retained compatibility, deliberately fenced

| Component | Retained responsibility | Non-authority guarantee |
| --- | --- | --- |
| `commandRouter` | Watch and historical `/ai` receipt/confirmation compatibility | Canonical runtime and orchestrator cannot import it as conversation or capability authority. |
| `ai_execution_ledger` | Physical execution/verification and historical receipt continuity | It is not Action/Workflow planning truth. |
| `oyiUnifiedIntelligenceService` | Narrow context, history and disclosed-awareness compatibility | `runOyiUnifiedChat` is deleted; no general chat/model authority remains. |
| Automation suggestion parser | Bounded proposal interpretation under `automations.suggest` | A proposal cannot persist or execute without canonical authority and confirmation. |

## Domain-system and provider boundary

The final cross-repository sweep found no active provider-backed general Oyi
brain outside Backend Core. Remaining direct provider uses are bounded
canonical/specialist functions: Core Plan Studio capability, communications
media/classification, language-teacher functionality, Office transcription
and structured plan-image geometry extraction. They do not own general
conversation, knowledge, memory, capability selection or action authority.

Twin remains a deterministic spatial engine. Facility remains an operational
domain host. Edge remains a hardware runtime. Consumer is a surface/domain
experience. Each contributes facts, receives governed capabilities, or presents
Core results; none replaces Oyi Core.

## Landing and validation evidence

- Backend #90 CI: quality, runtime-smoke and ecosystem-smoke passed; Supabase
  Preview was skipped.
- Backend #91 exact-head CI: quality, runtime-smoke and ecosystem-smoke
  passed; Supabase Preview was skipped.
- Backend `main` post-merge: typecheck, build, Wave 10 fallback/router/
  automation guards, authority, conversation, memory/context, capability,
  security and runtime-isolation checks passed.
- Render `Oyi-os` deployed Backend `4db95a6` and is live; `/health` reports
  HTTP 200 with Supabase and Redis healthy.
- Office #85 checks, Office Core-delegation and Plan Studio boundary checks
  passed before landing.
- Facility #38 lint, production build and Core-only loader guard passed before
  landing.
- Twin Core-handoff, deterministic architecture and representation suites
  passed before landing.

## Known non-blocking debt

- Twin's unrelated full TypeScript build errors in `ExploreController.tsx` and
  `TopCommandBar.tsx` remain outside the intelligence boundary; deterministic
  handoff and architecture tests pass.
- Database-backed local smoke groups require local Supabase test credentials
  and are not a substitute for the successful production/CI verification.
- The compatibility bridges above remain only until deployed receipt/Watch
  consumers can be migrated through a separately reviewed projection.

## Production schema note

The forward camera and production-contract migration versions
`20260926205543`, `20260926211819`, `20260926212124` and `20260928090000`
were physically applied and their production ledger entries aligned before this
landing. This baseline does not rerun or alter them.

**ONE-CORE BASELINE LANDED AND FROZEN**
