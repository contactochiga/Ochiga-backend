# IQ-10C — Compositional understanding and multi-entity context

## Scope and starting state

Verified clean local and remote starting HEAD:
`a80779256d40594539e5300124b6ea7a06561bf7`.
Repository `contactochiga/Ochiga-backend`, branch
`codex/intelligence-quality-v1`. GitHub initially had a connection failure;
subsequent `git ls-remote` verified the exact starting SHA.

The general invariants, thresholds, six synthetic journeys and alternative
wordings were frozen before runtime changes in commit
`c292eaa23c26f280bde34e3a813792320e62e3ef`. That contract remains unchanged.
The implementation commit containing this report is the final candidate;
the accompanying certification JSON records its exact runtime source hashes.

This is targeted development certification, **not overall intelligence
certification**. No sealed IQ-9B cases were replayed or used for tuning.
The paraphrase partition was written before implementation, but by the same
maintainer: it is not independently authored/blinded evidence. Previously
passing frozen answers are reviewed separately from the new assertions.

## Root causes and existing owners

The public opportunity objective merged every turn into one flat fact object.
Introducing a second property could replace the first property's location,
area and commercial terms. Selecting one operational result destroyed the
other candidates, so subsequent ordinals were applied to a one-element view.
Public context accepted malformed timestamps. Follow-up selection did not
consistently distinguish explicit identity, a comparison operand and recency.

The repairs extend existing owners only:

- `conceptBridge`: a small discourse relation (`introduce`, `correct`,
  `withdraw`) on the existing SemanticFrame concepts. Existing utterance
  structure distinguishes assertions/directives from questions, hypothetical
  additions and negated directives. This is not an action authorization.
- `semanticObjective`: selecting an attention target from a stated population
  remains prioritization rather than generic advice. No ranking was added.
- `publicOpportunityObjective`: bounded entity records within the existing
  owned public thread metadata. No new table, writer, memory store or agent.
- `followUpResolver` / `resultSetContext`: shared identity selection and
  preservation of the result population behind the selected-object view.
- `PublicOpportunityCapabilityModule`: selects the intended caller-supplied
  entity before its existing qualification/fact-composition path.
- `ConversationOrchestrator`: routes conversational entity transitions without
  misclassifying corrections as action cancellation; freshly checks capability
  eligibility and carried estate/home scope before restoring result sets.
- `conversationTraceProjection`: allowlists only the closed structural
  transition enum inside the existing JSON stage field, not entity facts.

No provider, evidence planner, authority engine, action engine, canonical
persistence implementation or schema was changed.

## Entity and reference contracts

Public entities have stable conversation-local UUIDs, ordinal, opportunity
type, entity-bound `known_facts`, constraints, active/withdrawn status,
`caller_supplied_unverified` provenance, superseded values, actual handoff
stage and timestamps. The legacy flat fields remain a selected-entity
compatibility view. At most eight entities are retained; the existing
30-minute TTL remains. Invalid, future and expired timestamps cannot restore
state. No caller assertion writes a canonical Office record.

An additional property appends an identity. A replacement correction clears
the corrected slot's previous facts/constraints/handoff view and retains
historical provenance. Targeted corrections leave other entities unchanged.
Same-location ambiguity changes neither entity: a bounded pending fact patch
records candidate IDs until clarification. It is applied once. New explicit
facts supersede an older pending patch. Withdrawn entities cannot receive
ordinary updates; a fresh introduction creates a different active identity.
Withdrawing an opportunity does not claim an already submitted external
handoff was cancelled.

Explicit labels/identities and ordinals resolve against the preserved
population; qualified location references resolve only when unique. The
location in a correction's new value cannot steal an explicit ordinal subject.
`both` is not silently reduced to one. `other` requires a unique complement.
`previous`/`earlier` does not arbitrarily select the first of three records.
An explanatory comparison's right operand does not replace its current subject.
Existing IQ-5 derived-assessment precedence remains ahead of raw-list fallback.

Selection preserves up to fifty candidate references. Filtering/prioritizing
replaces that population with the actual displayed subset/order. Domain return
restores the appropriate saved domain, not whichever was visited last.
Expiry and capability/scope revalidation still apply. Retained references
never become permission or confirmation.

## Executable results

All database tests used the approved synthetic loopback fixture at port 55421.
No production devices, customer credentials or real communications were used.

| Gate | Result |
| --- | --- |
| New pure contracts | 57 PASS, 0 FAIL |
| New live development assertions | 62 PASS, 0 FAIL |
| Frozen new journeys | 6 journeys, 37 turns, all saved and traced |
| Extra adversarial requests | 15 attempts: 14 responses and 1 rejected cross-owner thread request |
| Physical execution in new development suite | 0 |
| Frozen 280 preservation | 265 identical answers; 15 individually reviewed Osa changes |
| Original frozen-PASS answers | 40/40 unchanged |
| Exact persistence/trace linkage | 280 turns, 560 message rows, 280 durable traces |
| Wave 11 structured corpus | 132 PASS, 0 FAIL |
| IQ-10B failure injection | 25 PASS, 0 FAIL; 28 synthetic turns |
| Trace export/privacy | 11 PASS |
| IQ-10A live safety | 33 PASS, 0 FAIL; zero physical execution |
| IQ-1 cancellation journeys | 10 PASS; zero physical execution |
| Broader regression suite outcomes | 53 PASS; 5 unchanged historical workflow FAIL |
| Typecheck, build, diff and changed-file secret-pattern checks | PASS |

### Worker results

- **Osa:** three journeys, eighteen turns. Two properties retain different
  location/area/ownership/structure facts. Corrections and title updates bind
  only to the intended property. Same-location clarification, comparison of
  supplied facts, replacement, withdrawal and failed-callback truth pass.
  Additional tests prove a sole withdrawn property cannot be revived and a
  newer explicit fact wins over pending correction state. An explicitly scoped
  contact preference binds to the named property rather than the active one.
  Public-only access
  remains governed; no Office read was introduced.
- **Oma:** six turns. Selecting Alpha retains Beta, `other` returns Beta,
  finance does not erase the lead population, and return/ordinal selects Beta.
  A permission-revoked actor cannot restore those records.
- **Facility:** five turns. Selecting the resolved request retains the open
  request; switching to visitor access records and returning restores the
  maintenance subject without treating visitor permissions as arrival proof.
- **Consumer:** eight turns. First/second device and wallet/domain-return
  references retain their identities. An action still asks for an exact target
  when insufficiently resolved; cancellation followed by approval sends nothing.
  Resident B cannot restore Resident A's thread.

Structural trace tests reject private/free-form transition values and verify a
real persisted correction stage contains the enum without its property facts.
Expiry tests prove stored public facts are not recalled after TTL. The shared
pure tests cover malformed timestamps, duplicate names/locations, plural
references, operation/objective distinctions and all four surfaces.

## Frozen answer review and regression preservation

The 280 comparison is against an archived starting-HEAD runtime on the same
isolated schema, not the original baseline's infrastructure conditions.
The fifteen final deltas are listed individually, with complete before/after
answers and rationale, in the certification artifact. They retain explicitly
unverified ownership, keep land from becoming a building merely because
`property` was said, preserve corrected/historical values and answer a
held-details question instead of a generic acknowledgement. None changes an
original frozen PASS. No automatic overall IQ score promotion is claimed.

An intermediate comparison exposed a genuine comparative-reference regression.
It was preserved as a new synthetic test and fixed in the shared resolver;
the final Office answer is identical to the starting answer. A minimal IQ-1
callback fixture also exposed optional semantic-frame compatibility and exact
legacy-object preservation on a failed handoff. Both were fixed without
changing the original test: a failed callback does not migrate legacy entity
state. Transitional failed runs
remain documented in the artifact rather than presented as successes.

The final regression artifact must reconcile the same five historical failing
suite outcomes as IQ-10B; these remain excluded, not converted into passes:

- `oyi-workflow-action-phase-c-reload-smoke`
- `oyi-workflow-action-phase-c-multigang-smoke`
- `oyi-workflow-action-phase-c-correction-smoke`
- `oyi-workflow-durable-continuation-smoke`
- `iq9a15-owned-workflow-smoke` (aggregate retaining target-correction failure)

Multi-gang control remains excluded from release claims. IQ-10A safety,
IQ-1 cancellation, IQ-7 held-out parser/E2E, IQ-2–6, IQ-8, IQ-9A, authority,
privacy, device truth and One-Core results are retained individually in the
machine artifact. Existing parser misses are not relabelled passes.

## Performance and preservation

Local frozen-280 control: mean 87ms, p50 84ms, p95 126ms.
Candidate: mean 84ms, p50 84ms, p95 114ms. Host load/cache state were not
controlled; this shows no measured material regression, not a causal speedup.
No new provider call or database fan-out was introduced. New work is bounded
in-memory entity/reference selection plus existing canonical metadata writes.

All 840 pre-existing tracked docs/artifacts/scripts are checked byte-for-byte
against the starting commit, as are the new frozen development contract files
against their pre-implementation commit. Typecheck/build, diff and secret
checks must pass before the implementation is committed and pushed.

## Reproduction

Use fresh output prefixes and sequential isolated fixture execution:

```sh
npm run typecheck
npm run build
WAVE11_HARNESS_OUT=/tmp/iq10c-final-pure node scripts/iq10c-context-contracts.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10c-control scripts/iq10c-control280.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10c-final-dev scripts/iq10c-context-live.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10c-final-candidate280 scripts/iq10b-candidate280.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10c-final-candidate-links scripts/iq10b-verify280-links.mjs
node scripts/iq10b-contract-smoke.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10c-final-reliability scripts/iq10b-reliability-live.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10c-final-export scripts/iq10b-trace-export-smoke.mjs
node scripts/iq1-local-run.mjs wave11 /tmp/iq10c-final-wave
node scripts/iq1-local-run.mjs script /tmp/iq10c-final-reg scripts/iq10a-regressions.mjs
node scripts/iq10c-report.mjs /tmp/iq10c-final
git diff --check
```

The broad regression command exits nonzero for the historical exclusions. The
report generator asserts precisely that set and unchanged IQ-7 outcomes.
The standalone old trace source-layout/stage-count guards remain unchanged;
the already-certified IQ-10B wrappers preserve their functional assertions.

The final exact-source validation used `/tmp/iq10c-verified` in place of
`/tmp/iq10c-final` above; intermediate prefixes are not final passing evidence.

## Remaining limits and decision

No independent retest or general language-understanding perfection is claimed.
This is a bounded extension of the existing deterministic semantic contracts,
not a general model replacement. Ambiguous plural/previous references still
clarify. Consumer ordinal actions can still require exact-target clarification.
No strategic judgment, Initiative or new external capability was added.
Historical workflow failures and IQ-10B trace-delivery limitations remain.

No other product worktree, production schema or provider configuration changed.
No merge or deployment occurred. Overall intelligence remains **NOT CERTIFIED**.
IQ-10D must not begin without approval.

**IQ-10C COMPOSITIONAL CONTEXT CERTIFIED — IQ-10D APPROVAL REQUIRED**
