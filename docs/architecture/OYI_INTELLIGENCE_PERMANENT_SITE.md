# Oyi Intelligence Permanent-Site Architecture

Status: Phase C durable conversation workflow/action foundation.

## Target Lifecycle

Input / signal -> canonical evidence -> operational knowledge -> awareness -> reasoning -> anomaly / prediction -> recommendation -> capability -> workflow -> authority -> action -> verification -> outcome -> learning -> proactive intelligence.

## Conversation Lifecycle

Request -> normalize / interpret -> assemble context -> assemble candidates -> resolve target -> hydrate object -> resolve active workflow -> decide authority -> determine capability -> plan/load authorized evidence -> invoke domain intelligence -> compose read/draft/action response -> execute only when explicitly approved and allowed -> verify -> persist canonical turn/workflow/action -> adapt response to surface.

## Current Architecture Preserved

- One canonical conversation runtime in `src/oyi-core/runtime/canonicalConversationRuntime.ts`.
- Thin adapters in `src/oyi-core/runtime/canonicalConversationAdapters.ts`.
- Domain-specific behavior in `src/oyi-core/domains/*`.
- Target assembly, resolution and hydration remain separate.
- Office/Public, Consumer and Facility remain surfaces over one Oyi Core.
- Existing device command truth, Smart Access, wallet idempotency, communications handoff and conversation persistence remain protected.

## Phase A Implemented

- Enriched canonical evidence hierarchy.
- Final capability definition shape.
- Stronger enabled-capability executable guard.
- Home/Room contributor contracts.
- Prediction, anomaly and outcome contracts.
- Required conversation trace event vocabulary.
- Domain maturity matrix.

## Phase B Implemented

- `CapabilityService` evaluates capability rollout, surface, actor, permissions and scope before evidence loading.
- Enabled read capabilities now route through registry-owned handlers before legacy fallback.
- Capability-owned read responses now finalize through canonical conversation persistence and can appear in Oyi History/thread restoration.
- `What can you do?` is generated from `CapabilityService.listForActor(...)` and only advertises enabled, authorised capabilities.
- Internal/admin capability introspection is available at `GET /oyi/runtime/internal/capabilities`.
- Structured production traces are emitted for capability resolution, authority, evidence loading, handler completion and legacy fallback.
- Enabled read outcomes preserve distinct `answered`, `empty`, `unavailable`, `unsupported` and `permission_restricted` states.
- Wallet transaction evidence has parity with the existing home wallet relationship path and avoids raw internal references in resident-facing labels.
- Capability resolution no longer chooses the nearest enabled capability in the same domain when the exact semantic capability is not enabled.
- Resolved-but-not-enabled capabilities now return safe canonical fallback responses with explicit rollout/fallback metadata rather than generic runtime failure wording.
- Capability advertising no longer emits unrelated Home update presentation artifacts, and capability source metadata is deduplicated into useful resident-facing provenance labels.

## Phase B Enabled Scope

- Devices: status, availability, activity, failures, diagnosis, relationships and capabilities.
- Wallet: consumer home transaction history.
- Utilities: consumer home utility spending derived from wallet/service transaction evidence.
- Maintenance: consumer/facility maintenance request reads.
- Visitors: consumer/facility visitor access reads (access codes redacted).
- Global: capability/help advertising from the registry.

Security, Services, Community, Messages, Scenes, Automations, Reports, Home and Rooms remain registered below enabled until direct evidence ownership is complete.

## Direct Evidence — Maintenance & Visitors

- `loadMaintenanceRequestFacts`/`loadVisitorAccessFacts` (`src/oyi-core/domains/*/*.Evidence.ts`) query `maintenance_requests`/`visitor_access` directly via `supabaseAdmin`, modelled on the existing wallet transaction loader — never the client-supplied `input.relationships` the two domains previously read from.
- Scope is resolved server-side per surface: `home_id` for the consumer surface, `estate_id` for the facility surface, so a facility-wide read is never rejected for lacking a resident's home.
- A query failure returns an explicit `unavailable` fact (never a silent empty array), so "no open requests" and "could not check" remain distinguishable at every layer, including the final response.
- Visitor access codes are redacted (`redactAccessCredentialForConversation`) before they ever become conversation evidence.
- `maintenance.requests.read` and `visitors.pending.read` are now `enabled` `readModule`s in `ReadCapabilityModules.ts`, replacing their `declaredModule` stubs.
- Two previously-declared, zero-call-site Phase A safety guards are now real:
  - `assertEnabledCapabilityHasAdapter` (`CapabilityRollout.ts`) rejects registration of any capability marked `enabled` whose evidence collector is still the `declaredModule` placeholder (tagged via an `__isDeclaredStub` sentinel), catching a mis-flipped rollout status at startup rather than silently advertising a capability that loads nothing.
  - `assertClaimDoesNotPromoteUnavailable` (`contracts/evidence.ts`) is now called for every enabled read capability's response in `ConversationOrchestrator.ts`. A violation is caught and the result is downgraded to an honest `unavailable` answer rather than thrown raw, since nothing upstream of the canonical runtime currently guarantees an uncaught rejection here becomes a clean HTTP error.

## Phase C Implemented

- Conversation workflows and actions are durable backend records rather than thread metadata or process memory.
- `WorkflowService` owns create, restore, input save, transition, cancel, expire, supersede and action attachment.
- `ActionService` owns create, idempotent reuse, approve, transition, cancel, supersede, execution adapter invocation and verification recording.
- Supabase repositories provide production persistence; in-memory repositories remain test-only.
- Workflows/actions carry optimistic `revision` fields to prevent last-write-wins corruption.
- Device power/channel control is the first action capability integrated with the durable path.
- Device execution still goes through the existing device command pipeline and `ai_execution_ledger`; Oyi conversation actions do not call providers directly.
- Confirmation/cancellation turns restore active workflow state before creating any new action.
- Phase C correction makes workflow continuation first-class before ordinary capability routing: pending target/channel clarifications cannot fall through to device availability reads.
- Device action commands now extract exact named device, requested state and requested channel in one turn when all evidence is present.
- Pending workflow continuation is typed by missing input; target, channel, confirmation and cancellation replies are not interpreted by one generic fallback parser.
- Unrelated reads can still be served while a workflow remains pending, preserving durable continuation for the next compatible reply.
- Device action preparation now has stage-level production tracing from capability resolution through target resolution, durable workflow persistence, durable action persistence and confirmation response composition.
- Workflow/action thread references are treated as restoration/trace references rather than hard ordering dependencies on canonical conversation thread persistence.
- Preparation failures are localized as `target_resolution`, `workflow_persistence`, `action_persistence` or `action_preparation`, and all failure responses preserve the no-execution boundary.
- Final Phase C multi-gang correction enforces: multi-channel target plus unspecified channel means durable channel clarification; exact target plus explicit valid channel means exact durable confirmation. Oyi must not silently default to Channel 1 or all channels.
- Automated validation uses a fake device adapter and stops before physical execution.

## Not Completed In This Slice

- Direct evidence completion for the remaining domains (security, services, community, messages, scenes, automations, reports, home, rooms) — maintenance and visitors are done.
- Room aggregator implementation.
- Home aggregator implementation.
- Forecasting and prediction evaluation persistence.
- Proactive notification integration.
- Durable action execution for wallet, visitors/access, maintenance, community, scenes, automations and other sensitive domains.

## Extension Pattern

To add or mature a domain:

1. Add direct evidence loader using `OyiEvidence`.
2. Define capability metadata using `OyiCapabilityDefinition`.
3. Implement deterministic authority and required permissions.
4. Add read/draft/execute/verify handlers as needed.
5. Add Home/Room contributors only when direct evidence exists.
6. Add prediction/anomaly/outcome hooks only when measurable evidence exists.
7. Add tests before moving rollout status to `enabled`.

## Production Enablement

Phase C introduces production migrations for durable conversation workflow/action state and a device-first explicit-confirmation action path. The production runtime correction adds a migration that relaxes workflow/action `thread_id` foreign keys so action preparation can occur before canonical turn persistence upserts the conversation thread, while preserving the `thread_id` value for trace and restoration. The final multi-gang correction requires explicit channel binding before confirmation for independently controllable multi-channel devices and does not require a new database migration.

The reload-durability correction makes restored thread state explicit: thread/message APIs expose a normalized `active_workflow` summary, and canonical chat requests can include that workflow reference as a continuity hint. The backend still reloads authoritative workflow state from durable storage and only accepts the reference when authenticated actor, surface, estate/home scope and canonical `thread_id` match. It deliberately does not restore physical-action workflows by broad actor/home scope.

Phase C does not include automated physical acceptance, financial mutations, access mutations, message send, scene execution, automation execution, Home aggregation, Room aggregation, forecasting or learning.
