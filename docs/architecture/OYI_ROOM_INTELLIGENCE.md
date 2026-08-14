# Oyi Room Intelligence (Programme 2 / Phase F)

Status: implemented, deployed, behaviorally tested end-to-end.

## What Room Intelligence is

Not a room entity lookup ("here is a row from the `rooms` table"). It answers
*"what is operationally true and relevant inside this room right now?"* by
composing the mature Programme 1 domain evidence loaders that have a REAL
room relationship, then reasoning over the result the same way a resident
would.

## Architecture

```
DOMAIN SOURCE (devices, maintenance_requests, facility_incidents)
  -> DOMAIN EVIDENCE (existing Programme 1 loaders, unmodified)
  -> ROOM CONTRIBUTOR (thin wrapper: run the loader, filter/scope to this
     room, convert to ContributorSummary)
  -> ROOM AGGREGATOR (runContributors + composeAggregateResult)
  -> COVERAGE + ATTENTION + SEVERITY (generic, contributorSummary.ts /
     aggregateContract.ts)
  -> DETERMINISTIC SUMMARY (roomHomeAnswers.ts)
  -> PER-DOMAIN RESULT SETS (Programme 1 reuse — no separate Room follow-up
     system)
```

No second evidence system, no Room-truth table, no duplicated domain
queries. `src/oyi-core/domains/roomHome/roomContributors.ts` calls the exact
same `loadHomeDeviceInventoryFacts`, `loadMaintenanceRequestFacts`,
`loadSecurityIncidentFacts` that Programme 1 already built and tested.

## Room target resolution

`src/oyi-core/domains/roomHome/roomTargetResolution.ts`:

- `roomPhraseForIntelligence(message)` — a NEW, additive phrase extractor
  scoped only to Room Intelligence routing. The existing
  `roomPhraseFromMessage` (`conversationTargetResolver.ts`) requires a
  leading preposition ("in the living room") and is built for device-action
  commands — it does not match "How is the living room?" or "Anything wrong
  in the kitchen?" at all for the "How is X" phrasing. This function is
  deliberately separate so it can never change existing device-command room
  matching behavior.
- `resolveRoomTargetFromMessage` calls the existing, real
  `resolveRoomForRead` (fuzzy name/alias match, home-scoped, ambiguity
  detection with a score-gap threshold) — reused verbatim, not
  reimplemented.
- Two real, previously-undiscovered bugs were fixed as part of wiring this
  up: `resolveRoomForRead` selected a `rooms.metadata` column that does not
  exist (the real jsonb column is `ai_profile`) — every natural-language
  room resolution was silently failing in production before this fix. The
  canonical hydration registry's `room`/`home` entries also selected a
  nonexistent `updated_at` column on both tables (neither `rooms` nor
  `homes` has one) — every direct room/home object hydration was failing
  too. Both are fixed with regression coverage.

## Room contributors (only real relationships)

| Contributor | Table | Room relationship |
| --- | --- | --- |
| devices | `devices` | Real FK `room_id`, already indexed and used elsewhere |
| maintenance | `maintenance_requests` | Real `room_id` column — existed in schema but the Programme 1 evidence loader never selected it; now does |
| security | `facility_incidents` | Real `room_id` column, already selected by the Programme 1 loader |

Deliberately **not** built as Room contributors, per the explicit
instruction not to force a relationship that doesn't exist: visitors,
wallet, utilities, services, community (no room relationship in the
schema — these are Home-level), and scenes/automations (`consumer_scenes`/
`consumer_automations` have `estate_id`/`home_id` only, no `room_id` column
at all — deriving relevance from parsing each scene/automation's `actions`
JSON against device room membership was judged out of scope for this pass;
this is a documented, honest gap, not a fabricated relationship).

## Room capabilities

- `room.status.read` — "How is the living room?" / "What's happening in the
  kitchen?"
- `room.attention.read` — "Anything wrong in the kitchen?" / "What needs
  attention in the living room?"
- `room.activity.read` — "What changed in the bedroom today?"
- `rooms.inventory.read` (promoted from a `declared`/`shadow` stub) — "What
  rooms do I have?"

All routing predicates require `roomPhraseForIntelligence` to actually
extract a room noun — this is the same guard `supports()` and `collect()`
both use, so a bare "How is my home?" can never accidentally route to a
Room capability just because both use a loose "how is" pattern.

## Failure modes handled truthfully

- Room not found: `"I could not find a room called \"garage\" in this
  home."` — never silently falls back to a home-wide answer.
- Ambiguous room name: lists up to 5 candidates, asks the user to specify.
- A contributor's own query throwing (e.g. a transient DB error): isolated
  by `runContributors` — the other contributors still answer, and the
  coverage gap is stated honestly in the summary (see
  `OYI_HOME_INTELLIGENCE.md`'s coverage model, shared by both).

## Drill-down

"Tell me more about the maintenance issue" after a Room Intelligence answer
resolves through the **exact same** Programme 1 generic follow-up resolver
used everywhere else — Room Intelligence produces a per-domain
`ResultSetContext` for each contributor that had something to report, and
that's the whole integration. No Room-specific "tell me more" logic exists
anywhere.

## Privacy

Every contributor re-derives scope (`estate_id`/`home_id`/`room_id`) from
the current turn's authenticated actor/oisContext on every call — a
previously-resolved room reference is never treated as authorization on its
own. A resident's Room Intelligence query can only ever see their own
home's rooms (`resolveRoomForRead` scopes by `home_id`).
