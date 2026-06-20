# Ochiga Unified Intelligence Fabric: Phase 1

Phase 1 establishes a canonical event contract without replacing existing domain writes or Oyi conversations.

## Write-time event contract

Source systems publish through `publishSourceIntelligenceEvent`. The publisher is best effort: domain writes, notifications, and device commands remain successful even when Intelligence persistence is unavailable. The event table remains idempotent through `source_table` and `source_event_id`.

Canonical fields not represented by a top-level `ochiga_intelligence_events` column are retained under `metadata`: `organization_id`, `entity_type`, `entity_id`, `entity_label`, `severity`, and `payload`.

## Current publishers

- Consumer and Facility visitor access lifecycle.
- Consumer maintenance creation and Facility maintenance updates.
- Device state/command recorder.
- Notification persistence.
- Service registry changes and wallet-backed service payments.
- Community posts and reports.

## Office lead-agent bridge

Office/Edge lead agents remain operationally separate in Phase 1. When they are ready to emit events, map their payload to `publishOfficeLeadIntelligenceEvent`:

```ts
publishOfficeLeadIntelligenceEvent({
  event_type: "lead.qualified",
  lead_id: lead.id,
  organization_id: lead.organization_id,
  actor_id: agentUserId,
  title: "Lead qualified",
  summary: "A commercial opportunity is ready for discovery.",
  payload: { source: lead.source, score: lead.score },
});
```

This creates a canonical `lead` or `sales` Intelligence event while preserving Office lead memory boundaries. It does not expose resident, home, or Facility memory to OMA/OSA.

## Surface policy

`surfaceRegistry.ts` is the source of truth for each Oyi surface's memory scopes, allowed domains/actions, event categories, response tone, and fallback behavior. It is additive; existing `/oyi/chat` and `/ai/chat` behavior remains unchanged.
