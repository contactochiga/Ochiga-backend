# IQ-3B — Governed multi-domain evidence planner

Starting HEAD: `e00efb499a651a9746a53407e2c8803cab8ad44b` (IQ-3A certified). Branch `codex/intelligence-quality-v1`.
No production, schema, merge or deployment operation. IQ-4 (ranking, materiality, judgment) has not begun.

## What IQ-3B is

```
IQ-2 assessment context (objective, subject, surface, scope, known facts, prior plan)
 + IQ-3A source certification (opt-in per collector x surface x scope)
  -> deterministic EvidencePlan
  -> authorised pure reads (bounded, parallel, isolated)
  -> compact EvidenceBundle (inside the existing ephemeral assessment context)
  -> an honest evidence-readiness statement
```

It answers one question: *can Core safely gather the relevant authorised evidence across several existing read
capabilities?* It does not rank, score, prioritise or judge. A turn that needs judgment keeps its bundle and stays IQ-4-bound.
Only assessment turns pay for it: the planner is referenced from exactly one place, the assessment terminal branch.

## 1. Dedicated pure-read execution context

IQ-3A enforced purity by wrapping the shared Supabase client on first use. IQ-3B does not carry that forward.

`evidence/ReadOnlyEvidenceDb.ts` returns a frozen object whose only table operation is `select`. There is **no**
`insert/update/upsert/delete` and **no** `rpc`: a source cannot mutate state by construction, and nothing is patched. It is
created fresh per read, shares no mutable state (parallel reads cannot affect each other or any unrelated request) and wraps
`supabaseAdmin` only by reference, so the ordinary conversation/runtime client is untouched. It rides on the capability
context (`evidence_db`); the certified loaders take it as an optional last parameter with the ordinary client as default, so
non-planner callers are unchanged. Tests inject a controlled client to simulate failures, truncation and timeouts without a
database, and prove that every DB-backed certified source reads **only** through the injected dependency (the module-level
client is made to throw and nothing reaches it).
`evidence/PureReadGuard.ts` keeps the static layer: adapters under `evidence/sources` may import only an allowlist of readers
and pure helpers; deny-listed writer/dispatcher modules are rejected.

## 2. Planner contract

Input: only fields the IQ-2 assessment context already holds (objective, subject domains, subject label, selected-record id,
surface, effective estate/home, a resolved room, material facts, the prior plan state). The prompt is not re-interpreted;
the single piece of text consulted is a narrow explicit-refresh request (`refresh`, `check again`, `right now`, `latest`, ...).

Output: `CompactEvidencePlanState` (`evidence/planner/types.ts`), persisted only inside the existing
`conversation_assessment` thread metadata, 30-minute TTL unchanged. It holds: plan id and version, scope/subject keys (hashes,
not ids), the classes requested with their status, one contribution per source attempted, the missing mandatory classes, what
cannot be concluded, requested-but-not-honoured scope, limits, stats and invalidation reasons. Hard size budget (20 KB):
the optional material projection is dropped first.

## 3. Deterministic source selection

1. **Requirements** (`policy.ts`). A *broad* subject (the surface's default subject) uses a per-surface table; an *explicit*
   subject makes each named domain mandatory. Optional companions are objective-gated and domain-keyed, never prompt-keyed:
   Office tasks/support/meetings for assess/prioritise/advise; approved partnership guidance for public opportunity framing;
   visitors/devices/cameras for a security subject; a disclosure companion for device assessments. The public development
   listing is a network source and is gathered only when the subject names developments.
2. **Classes** (`evidenceClasses.ts`). Each class lists its certified sources in precedence order. `first`: the first source
   that is registered, IQ-3A-certified for this surface x scope and currently authorised (later entries are fallbacks only).
   `all`: every admissible source (a union of distinct populations, e.g. leads + opportunities).
3. **Admission** (`planning.ts`). Certification is read from the capability itself (`evidence_read` present and its declared scope
   classes include the request's). Authority is checked against the request's effective scope. A source that fails is recorded
   (`not_authorised`, `scope_unsupported`, `no_certified_source`, `known_product_debt`, `room_unresolved`) and never replaced by a
   substitute.
4. **Direct over composite.** `home.summary/attention/activity`, `room.*` and `facility.overview` are never class sources. A
   composite `home` subject expands to its direct components; alongside explicit subjects those components are optional context,
   so a composite and its parts are never both independent mandatory truth. An explicitly requested composite is answered by its
   own existing capability, outside the planner.
5. **Bound.** At most 8 sources; mandatory steps are kept first and optional ones dropped first (`fan_out_bound`).

Scope is never widened silently. A building label reads estate-level evidence only and says so; an unresolved room reads nothing
instead of the whole home; client building/room hints and a stale selected record are stripped from each read.

## 4. Mandatory vs optional, and partial evidence

Class statuses are deliberately distinct and never collapsed:
`MANDATORY_COMPLETE_ENOUGH`, `MANDATORY_PARTIAL`, `MANDATORY_UNAVAILABLE` (a source exists but failed, timed out or was denied),
`MANDATORY_MISSING_CAPABILITY` (known product debt or no certified source), `OPTIONAL_GATHERED`, `OPTIONAL_UNAVAILABLE`.
Optional evidence never blocks. Partial evidence is first-class: Office snapshots are always partial, a camera whose state is
unobserved makes its class partial (population complete, state unknown), truncation and stale device state are carried, and the
plan lists what it cannot conclude. Record age (an old ticket) is lifecycle, not a stale read; only device and camera *state*
can be stale.

## 5. Limits (set from measurement; see Performance)

| Limit | Value |
|---|---|
| Sources per assessment | 8 |
| Records per source accepted | 50 (IQ-3A bound) |
| Material items per source in the bundle | 8 (references: 10) |
| Per-source deadline | 1500 ms |
| Overall deadline (parallel wall time) | 3000 ms |
| Persisted state | 20 KB |

## 6. Execution

Reads run in parallel through the real `CapabilityService.readEvidence`, which **re-checks authority, scope and certification at
execution time** (IQ-3A certification is not a permanent grant; permission is never cached beyond the governed turn). Each
source gets its own context. Results are ordered by plan, never by completion. A failure, denial or timeout is isolated to its
source; after the overall deadline the run is closed, unfinished sources are reported as timeouts and late results are discarded.

## 7. Evidence bundle

Per source: capability, evidence class, necessity, outcome status, availability, completeness (`complete`/`partial`/
`zero_proven`/`unknown`), freshness, scope class (and room label), lifecycle counts, record count, source total, truncation,
degraded sub-sources, safe references, an allowlisted field projection, canonical provenance for governed knowledge, timings.
Confidence is never invented. Third-party visitor names, access codes, contact details and free text are not projectable;
visitor references carry type and id only.

## 8. Reuse and invalidation

Evidence for the same active assessment is reused (no read) when the scope key, subject key and supplied-snapshot fingerprint are
unchanged, no new material fact arrived, the user did not ask to refresh, the contribution is within its freshness window
(devices/cameras 2 min, operational records 10 min, Office snapshot 5 min, governed knowledge 30 min, all capped by the assessment
TTL), authority still holds, and the earlier read succeeded. Failed, denied or timed-out reads are retried, never reused as
evidence. Cosmetic wording changes ("Why?", "What would you do?") invalidate nothing. Invalidation reasons recorded:
`scope_change`, `subject_change`, `explicit_refresh`, `material_fact_changed`, `supplied_snapshot_changed`,
`source_freshness_expired:*`, `authority_changed:*`, `retry_*`; the assessment TTL ends the whole state.

## 9. Observability

Existing trace stages `evidence_planned` and `evidence_loaded` carry only allowlisted scalars (status, evidence count, outcome), so
no trace schema change is needed. A structured `oyi_assessment_evidence_plan` log line and the counters
`oyi_assessment_evidence_plans_total`, `oyi_assessment_evidence_sources_total` and histogram
`oyi_assessment_evidence_plan_latency_ms` record plan status, source counts by outcome, reuse and latency. No evidence content,
identifiers or labels appear in any of them.

## 10. Response behaviour

The planner states what was checked, what was partial, what could not be read, what Oyi cannot see at all, and what cannot be
concluded, then says it has not yet drawn conclusions or ranked anything. It never says it still needs to check after having
checked (a corpus-wide gate enforces this). The existing IQ-2 caveat clauses (unverified claims, unresolved references, building
labels, policy) are retained after the evidence statement.

## Results

### Tests
- **48 planner tests** (`scripts/iq3b-planner-tests.mjs`): single/multi-source plans; mandatory vs optional; partial-only plans;
  missing mandatory capability; authority changed after planning (real `CapabilityService`); one source denied / unavailable /
  timed out / stale / truncated; deterministic ordering; fan-out bound; overall deadline and late-result discard; reuse; subject,
  scope, refresh, material-fact, freshness and supplied-snapshot invalidation; cosmetic follow-ups invalidate nothing; no action
  capability can ever be planned (every policy x surface x objective); pure-read dependency; no composite/direct double count;
  compact state bounds and sensitive-field exclusion. Cross-surface real runs for Oma, Osa, Facility and Consumer, plus the privacy
  torture cases (Consumer cross-home incl. a forged request home and an erroring source, Facility building scope, Osa
  reaching for Office evidence, Office permission restriction).
- **IQ-3A regression:** 255 source tests, 129 benchmark-source tests (225-row surface x scope matrix) and the live cross-home
  isolation run all pass; 10 synthetic rows inserted and removed. The IQ-3A certification artifacts are unchanged.

### 280-turn corpus (frozen runner, unchanged expectations)
Retained: **51 PASS / 224 FAIL / 5 BLOCKED**, 280/280 persisted and trace-correlated. **No turn newly passes**: the planner states
evidence readiness; it does not judge, and no per-turn promotion check was added. 144 answers changed (138 FAIL, 4 PASS, 2 BLOCKED).
The 4 previously-PASS turns that changed (OMA-005:3, CON-002:6, CON-008:5, CON-008:6) each have an explicit preservation check that
encodes why it passed (a clarification kept; no execution claim; the Study identified with no temperature claim); the review fails
if any is missing or fails. 11 changed turns were outside the 133 (the 4 above and 7 Facility device turns, which now say plainly
that Facility has no estate-wide device read).

### The 133 evidence-planning turns
Evidence outcome: **101 PLANNER_PARTIAL_SUCCESS, 6 PLANNER_SUCCESS, 11 MISSING_CAPABILITY_PRODUCT_DEBT, 4 no evidence required,
10 evidence gaps, 1 no plan.** Where they now fail:

| Now fails at | Turns |
|---|---:|
| Judgment / ranking (IQ-4) | 32 |
| Reference continuity (later) | 39 |
| Initiative (later) | 35 |
| Reassessment (later) | 5 |
| Proven missing capability (product debt) | 11 |
| Still evidence planning | 11 |

**122 of 133 leave evidence planning; 32 move cleanly to judgment.** Caveat that matters: the destination is the *secondary boundary the
frozen review recorded behind evidence planning* for each turn; it is not a re-grade, and it does not show those turns would pass if
that boundary were fixed. The 69 turns with an IQ-3A mandatory judgment are scored against it; the other 64 (marked ready by coverage
only in IQ-3A, never judged mandatory) are scored against what IQ-2 recorded as required. A stricter measure, "every class the
benchmark says to *consider* was gathered or disclosed", holds for **72 of 133**; the other 61 name classes the IQ-2 subject never
requested (documents 17, devices 10, security 7, partnerships 7, CRM 7, development 6, ...).

The 11 remaining (OSA-007 x4, FAC-002 x5, FAC-009:7, CON-006:7) are all requirement-derivation limits, none an execution defect: the
public development listing is not requested because the IQ-2 subject is the opportunity (it is gathered only when named);
FAC-002 follow-ups retain a single-domain subject; FAC-009:7's device-history gap is real product debt but the IQ-2 subject was
maintenance; CON-006:7 is answered by an existing certified path.

Plan status over all gathered plans: 109 `MANDATORY_PARTIAL`, 16 `MANDATORY_COMPLETE_ENOUGH`, 6 `MANDATORY_MISSING_CAPABILITY`,
1 `MANDATORY_UNAVAILABLE`. Partial is the normal case, as designed.

### IQ-EVAL-OMA-001
T1 is answered by the existing certified Office overview path (unchanged; it does not persist a plan). **T2** ("which three...") gathers
8 sources in parallel (5 mandatory + tasks/support/meetings) and says it has not ranked anything, so no top three is manufactured.
**T3, T5, T7** reuse (0 reads). **T4** (the Chairman's financing claim) invalidates on the new material fact and re-reads 5.
**T6** reuses 5 and fetches only the 3 newly required. Ranking, the priority change and reassessment remain IQ-4.

### Performance (isolated local fixture, real queries, 15 runs per scenario after warm-up)
| Plan | Sources | Queries | Planner wall p95 | Sum of source latencies | Reuse |
|---|---:|---:|---:|---:|---|
| single source | 1 | 1 | 4.2 ms | 3.1 ms | 0 queries |
| two sources | 2 | 2 | 4.3 ms | 6.5 ms | 0 queries |
| three sources | 3 | 4 | 6.3 ms | 11.4 ms | 0 queries |
| security + companions | 3 | 4 | 5.9 ms | 10.7 ms | 0 queries |
| Facility broad | 4 | 5 | 6.2 ms | 15.1 ms | 0 queries |
| Consumer broad | 5 | 6 | 6.2 ms | 19.7 ms | 0 queries |
| largest plan (Office, 8 sources) | 8 | 0 (supplied snapshot) | 1.2 ms | 2.7 ms | 0 queries |

Wall time tracks the slowest source, not the sum. In the corpus, planner latency was 0.1 ms (reuse only) to 16 ms (4-5 sources); mean
turn latency over the 133 is 74.5 ms against a 76.9 ms baseline (p95 102 vs 115 ms; local, so within noise: no measurable planner overhead) and **51.3% of source reads were avoided by reuse** (183 of 357).
The limits (1500 ms per source, 3000 ms overall) are deliberately conservative upper bounds, roughly two orders above the local p95;
they are **not** production-measured, and the metrics above exist to re-tune them.

### Remaining P0 / P1 / P2
- **P0:** none known.
- **P1:** evidence coverage is bounded by IQ-2 subject derivation (61 turns list classes the subject never named; Office documents is
  the largest). IQ-2 owns that; the planner deliberately does not re-read the prompt. Limits need re-tuning from production latency.
- **P2:** a reused-evidence turn repeats the full readiness statement (verbose); T1 does not persist a plan so T2 re-gathers; the
  classification of the 133 relies on the frozen secondary boundary; the device-runtime state cache is shared process state the planner
  only reads; governed-knowledge failure is proven by injection, not by breaking the real index.

**IQ-3B GOVERNED EVIDENCE PLANNER CERTIFIED — IQ-4 APPROVAL REQUIRED**
