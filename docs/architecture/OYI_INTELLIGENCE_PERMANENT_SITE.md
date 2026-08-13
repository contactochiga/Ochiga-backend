# Oyi Intelligence Permanent-Site Architecture

Status: Phase B executable read-capability foundation.

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
- Global: capability/help advertising from the registry.

Maintenance, Visitors, Security, Services, Community, Messages, Scenes, Automations, Reports, Home and Rooms remain registered below enabled until direct evidence ownership is complete.

## Not Completed In This Slice

- Durable conversation workflow/action persistence migrations.
- Direct evidence completion for all domains.
- Room aggregator implementation.
- Home aggregator implementation.
- Forecasting and prediction evaluation persistence.
- Proactive notification integration.

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

Phase B is intended for production observation of read-only capability routing. It does not include production migrations, physical actions, financial mutations, access mutations, message send, scene execution, automation execution, Home aggregation, Room aggregation, forecasting or learning.
