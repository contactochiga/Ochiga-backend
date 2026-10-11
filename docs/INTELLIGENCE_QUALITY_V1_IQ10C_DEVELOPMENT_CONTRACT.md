# IQ-10C frozen development contract

Starting clean HEAD: `a80779256d40594539e5300124b6ea7a06561bf7` on
`codex/intelligence-quality-v1`, origin `contactochiga/Ochiga-backend`.
Frozen before runtime changes. GitHub API was initially unreachable; remote
verification and push remain required before delivery.

## Invariants

1. Entity identity is stable within an owned, surface-scoped conversation.
   Introduction of another entity appends, never overwrites the earlier entity.
2. Facts belong to an entity, not a globally last-mentioned field. Caller facts
   remain unverified assertions; no canonical business record is changed.
3. Corrections supersede only the selected entity's value; provenance retains
   the old value as historical, never simultaneously current. A correction is
   not an action cancellation. Ambiguous corrections change nothing.
4. Explicit identity or a uniquely matching qualified reference precedes
   ordinals; valid derived assessment references retain IQ-5 precedence over
   raw result sets. Selection must not destroy the source candidate population.
   An ambiguous reference asks which of the bounded candidates was intended.
5. Multiple referents are not silently reduced to one. An unsupported plural
   action remains clarification, not an implicit batch command.
6. Retrieval, fact update, comparison, explanation, advice and reassessment are
   separate operations. Fact updates do not authorize assessment or execution.
7. Topic switching preserves per-domain candidates but does not inherit an
   unrelated objective. Return uses explicit subject before recency.
8. Context expires after the existing 30-minute conversational TTL. Invalid,
   future or expired timestamps are not permission to restore state.
9. Context is never authority. Fresh actor/surface/scope admission and capability
   checks precede hydration/read/action. Revoked access and cancellation remain
   terminal regardless of retained labels, references or asserted ownership.
10. IQ-10A scope, hazard and cancellation gates and IQ-10B atomic save, retries,
    trace correlation and honest failure reporting remain unchanged contracts.
    Only structural transition metadata may enter durable trace.

## Existing owners and bounded changes

- SemanticFrameParser/conceptBridge and AnswerTarget retain interpretation.
- followUpResolver/resultSetContext retain reference selection and per-domain
  candidates. Extend their existing types/helpers, not another parser/store.
- publicOpportunityObjective retains public qualification under canonical thread
  metadata, with bounded entity records and an active-entity compatibility view.
- ConversationAssessmentContext retains assessment facts/rankings and TTL.
- Canonical conversation persistence is the only durable writer. No schema or
  provider change is planned. Public facts never become Office access.

Observed source defects: flat public known_facts merge; narrowedResultSetContext
throws away unselected candidates; public TTL accepts invalid dates; natural
explicit-name/qualified selection is not consistently represented. A shared
database client is not authority proof. Each capability must still authorize.

## Frozen scenarios and gates

The adjacent JSON development corpus defines new synthetic semantic families
and a pre-implementation paraphrase partition. These are maintainer-authored
development tests, not independent blinded certification. No sealed IQ-9B
utterance or result is used for tuning or replay.

Required gates: 100% mandatory entity/fact/correction/reference/expiry/authority
assertions; zero new P0; no defensible regression; full chain reported including
known failures. All frozen-280 answer changes require individual review, and
previously passing answers must not be weakened. Tests blocked by unavailable
infrastructure remain BLOCKED. Unsupported capabilities are not execution
passes. A partial implementation cannot claim this slice certified.

No merge, production access, physical execution, IQ-10D–F or Initiative.
