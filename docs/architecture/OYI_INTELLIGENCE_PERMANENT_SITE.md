# Oyi Intelligence Permanent-Site Architecture

Status: Phase A foundation ready for review.

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

This is a foundation slice only. No production deploy, migration, physical action, financial action, access mutation or message send is included.
