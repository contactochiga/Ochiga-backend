# IQ-5 — Derived assessment reference continuity

Starting HEAD: `cfd7074f84b7b0e35dd5d6b4c40fb50de7662c91` (IQ-4 certified). Branch `codex/intelligence-quality-v1`.
No production, schema, merge or deployment operation. Reassessment, initiative and communication have not begun.

## What this slice does
When Oyi derives something (a ranking, a compared pair, a listed assessment), the next turn can point at *that* ("the second
one", "the other one", "why not the third", "go back to those priorities") and the pointer resolves deterministically against the
derived artifact, without retrieval, without a model, and without an older raw list stealing the reference.

## Candidate set (frozen before any runtime change)
`scripts/iq5-candidate-freeze.mjs` -> `artifacts/intelligence-quality-v1-iq5-candidates.json`, committed once (`5e076cc`) before the
first `src` change. It does **not** assume IQ-4's "20" were the set. All 280 post-IQ-4 turns were inspected for a reference form, the
previous turn's derived artifact, any raw result set, and the mechanism by which the answer picked its referent.

| | Turns |
|---|---:|
| Turns with any reference form | 45 |
| Failing turns carrying a **genuine** reference form (ordinal, other-one, demonstrative, return, comparison referent, bare "why") | **14** |
| Failing turns IQ-4 handed over by its recorded prior boundary but that carry **no** reference form | 15 |
| **Frozen candidate set** | **29** |

**IQ-4's hand-over was partly mislabelled.** 15 of the 29 are not reference turns at all ("I am going to bed.", "Do not promise
financing.", "The bedroom feels too hot."); they were labelled by an earlier recorded boundary. They are classified by what they
really are below, not forced into this slice. Only 14 genuine reference failures existed, and none had a derived artifact behind
it after IQ-4, because no benchmark turn had *named* items for a later turn to point at (see "What the corpus can and cannot show").

## IQ-4 artifact audit (before design)
IQ-4's `DerivedRanking` was minted only for `prioritize` or an explicit top-N, held ranked items only, and was carried unchanged.
Gaps: (a) comparisons and plain assessments that **name** items minted nothing, so "the other one" / "the second issue" had no
referent; (b) no place to say what was *presented* (the human referent) as opposed to ranked; (c) a topic switch dropped it, so
"go back" could not restore it; (d) no staleness; (e) no authority/scope binding to check on dereference.

## Derived-artifact contract (one state, extended; no second ranking state)
`assessment_context.derived_ranking` keeps its name and now carries `artifact_type`:

| `artifact_type` | Minted when | `ordered` | Items |
|---|---|---|---|
| `ranking` | `prioritize` or an explicit top-N, validated | **true** | ranked items (+ items the answer named as able to wait) |
| `comparison` | `compare` | false | the pair taken (no order claimed) |
| `assessment_set` | any other judged answer that **names** items | false | items needing attention, in the order named (+ resolved/past ones) |

Each item stores a safe reference (`{t, id, label}`), a short evidence-linked rationale, compact typed factors, `group`
(ranked / compared / attention / past / wait), `state`, `kind`, `source_key` and evidence refs. The artifact also stores
`assessment_id` (evidence bundle version), `objective`, `basis`, `scope_key`, `scope_binding`, `surface`, `source_keys`,
`created_at`, `updated_at`, `expires_at`, and reference state: `focus`, `parked`, `stale`. It never stores raw evidence, a
`result_set_id`, or a reasoning chain; it is under 6 KB at 6 items. A bounded business answer that names nothing mints nothing.
The IQ-4 rule that **a comparison never mints a ranking** still holds: it now mints a distinct unordered `comparison` artifact.

## Reference precedence (deterministic; `evidence/reference/derivedReference.ts`)
1. Expired / out of scope / authority revoked → the artifact is not used and is dropped from state; the answer says so.
2. An explicit type noun naming raw domain objects ("the second lead") belongs to the raw result set, unless no item of that type
   exists in the artifact (then it defers anyway). "The second *priority*" is the artifact.
3. A raw result set presented **after** the artifact owns a bare pointer ("the second one"); explicit derived wording
   (priority, ranking, top-N, "the other one", a named item, "go back to…", "those") wins the artifact back.
4. A **parked** artifact (another topic is active) is restored only by a return cue, derived wording or a named item; a bare
   pointer is clarified.
5. A **stale** artifact answers history ("why was number two there?") with a note, and refuses "what is number one **now**".
6. Resolution: named item → position(s) → top-N / last / bottom → "the other one" → which-can-wait → return → focus/demonstrative.
An ordinal counts only in nominal position ("the second one", "second issue"), never adverbially ("what should I do first?");
a demonstrative counts only in explicit forms ("that one", "why that", "is that dangerous"), so "Does that change your priority?"
and "Is this confirmed by your systems?" are not references. This precision was added after the first corpus run, which showed
false positives; a wrong referent is worse than a missed one.

## Ordinals and unordered artifacts
first … tenth, last, bottom, `#2`, `number 2`, `number two`, `2nd`, "the top two", not hard-coded to three. Out of range says so
("only has 1 item, so there is no number 5") and never falls through to another list. On an **unordered** artifact positions mean
"item N of those I listed (a listing, not a priority order)" and "top"/"bottom" are refused ("I did not rank these"). A comparison
pair's "other one" defaults to the item not led with and says so.

## Explanation, domain switch, expiry, authority, material facts
- **Explanation** reuses the stored rationale; no evidence re-read, no provider call. A provider-ranked item is explained from its
  own recorded rationale and described as a comparative judgment; Core never invents a typed difference (the first draft said
  "equal on everything I recorded" for provider-ranked items, which was wrong and was fixed and tested).
- **Domain switch and return**: an unrelated turn parks the artifact (nothing else of the assessment survives); a bare pointer is
  clarified; "go back to those priorities" restores it. (Previously a non-assessment turn dropped it.)
- **Expiry**: the artifact keeps its own 30-minute expiry. **Scope**: a hash of surface + estate + home is stored and compared on
  every dereference. **Authority**: `capabilityService.canUse` is re-checked for each source key on every dereference. A failure
  states why, repeats no item, and drops the artifact.
- **Material fact**: new information that concerns the artifact (a reference cue, an item name, or a shared content word) marks it
  **stale and preserves it**; the answer binds the item ("I am treating it as being about …"), says it does not change any record
  by itself, and that nothing was reassessed. Unrelated information does not touch it. The normal flow never silently re-mints a
  ranking after new information. **No reassessment is implemented.**
- **No pointer resolution calls a model.** The two reference modules import no provider, database, capability service or fetch
  (tested); the conversation test confirms the provider is called once (for the ranking itself) across five reference turns.
  Honest note: `derivedReferenceTurn.ts` imports `conversationAssessmentContext.ts`, which constructs the shared Supabase client at
  module load (pre-existing; IQ-4's judge does the same); no query runs.

## Surfaces
- **Oma**: with a (scripted) provider ranking, "why is the second one more important?" resolves to **priority #2** and uses its
  recorded rationale, not lead row #2 (a raw CRM list was presented earlier in the same thread and did not steal it).
- **Osa**: no derived referent exists on the public path (qualification is not a judgment candidate producer), and the tested
  public answers expose no internal criteria and make no promise. **Osa gap:** "Which concern matters more?" still reaches the
  pre-existing business fallback menu; making the known/missing list referenceable is not done (P1 below).
- **Facility**: references resolve against what was named; "Why the fifth one?" says there is no number 5; a Tower B scope is not invented.
- **Consumer**: "Is that dangerous?" says the records do not establish danger or safety; "Can the last one wait?" says nothing
  recorded shows it can; unknown is never turned into safe.

## Results
### Tests (52 new)
- **42 reference tests** (`scripts/iq5-reference-tests.mjs`): artifact types and contents, ordinals (1st–5th, last, bottom, numeric
  forms, out of range, top-N), why-not, bare why, which-can-wait, named items, type nouns vs raw sets, raw/derived precedence both
  ways, comparison pair and "other one", unordered sets, parked/return, expired, scope-changed, authority-revoked, cross-surface,
  material fact (stale, history kept, "now" refused), provider-ranked explanation, no-I/O static check, no promise/all-clear/
  action in composed text, severity wording, precision (adverbial "first", reassess questions, unrelated information).
- **10 conversation tests** on the loopback fixture with the real orchestrator and persistence
  (`scripts/iq5-conversation-tests.mjs`): OMA-001 provider off and scripted, raw-result regression ("Show me today's leads" →
  "Open the second one" still opens the second **lead**), raw list after ranking, explicit "second priority" winning back,
  another actor/surface on the same thread (the platform returns `conversation_access_denied`), Facility, Consumer, Osa, and
  "no reference turn calls the provider". **0 device executions.**
- Three IQ-4 assertions were **deliberately superseded** by this design and updated in `iq4-judgment-tests.mjs`: a comparison now
  mints an unordered `comparison` artifact; a top-3 artifact also records the named can-wait item; a non-ranking question mints
  an `assessment_set`. All 57 IQ-4 tests pass. The committed IQ-4 artifact is the original IQ-4 record (unchanged).
### 280-turn corpus (expectations unchanged)
Retained post-IQ-4 **65 PASS / 210 FAIL / 5 BLOCKED** -> **66 / 209 / 5**; 280/280 persisted and trace-correlated. **Only 2 answers
changed** (FAC-002:5, CON-007:3), both previously FAIL; no previously passing turn changed. **One promotion, CON-007:3 ("The water
leak has got worse."), is self-graded** by an explicit check from its envelope ("New leak report changes recommendation but not
database resolution state automatically"); independent review recommended.

### Frozen candidates (29): before -> after
| After | Turns |
|---|---:|
| PASS | 1 |
| JUDGMENT_PROVIDER_REQUIRED | 7 |
| REASSESSMENT_LATER | 7 |
| COMMUNICATION_LATER | 2 |
| UPSTREAM_SUBJECT_GAP | 1 |
| MISSING_CAPABILITY | 1 |
| OTHER | 10 |
| INITIATIVE_LATER | 0 |

The 14 **genuine** reference failures: 1 resolved against a derived artifact (FAC-002:5; still FAIL on its envelope, which asks for
camera/recovery handling), 7 **provider-required** (Office: with no provider the business records were counted, not ordered, so
nothing was named to point at; the answer says no ordering exists and asks which item is meant, and does not substitute a list),
1 is really a new fact (OMA-001:4, reassessment), and 5 more point at an earlier **raw list, overview answer or clarification**
(existing result-set/selection mechanism; not a derived artifact, and left untouched by design). **Reference-continuity failures
remaining where a derived referent existed and was missed or stolen: 0.** Reference-form failures remaining in total: 13.

### What the corpus can and cannot show
The benchmark has few derived referents: Office turns are bounded without a provider, and Facility/Consumer overview turns
present items through the existing overview path (a raw result set, not an artifact). So the benchmark moves by **one** turn while the
mechanism is proven in the 52 purpose-built tests. That gap is real and is reported as such; it is not padded.
### OMA-001
Provider off (the real environment): T2 ranks nothing, T3 says it has not ordered these so there is no earlier ordering to explain,
T4 and T5 do not claim an ordering. Scripted provider: T2 mints a ranking; T3 resolves to **priority #2** from its recorded
rationale; T4 marks the ranking stale and preserved; T5 "what is number one now?" refuses to present it as current; T6 "why was number two
there?" still explains the historical ranking with the stale note. **This proves reference handling and discipline, not
live-model quality.**
### Performance
Pure reference resolution p95: 0.018 ms (3 items), 0.016 ms (10), 0.059 ms (64); parsing 0.004 ms. Corpus turn latency is
dominated by the shared turn pipeline: derived-reference turns p50 77 ms (n=2) vs 76 ms for turns that re-plan (n=141), so IQ-5 saves
evidence reads (zero) but not wall-clock time. A reference turn does one extra thread read (the newest raw result set) to apply precedence.
### Observability
Log `oyi_derived_reference` and counter `oyi_derived_references_total` carry surface, outcome, artifact type and item count only.
Trace `canonical_terminal_response` reason is the outcome code. No labels, evidence, prompts or reasoning; no trace migration.

## Validation (v3 run on the final build)
Wave 11 131 PASS / 1 known FAIL; IQ-1 adversarial 10 PASS, 0 execution attempts; IQ-2 objective PASS; 23-suite matrix 19 PASS / 4
known FAIL identical to the stored pre-IQ-1 controls; IQ-3A 255 source + 129 benchmark tests and live isolation PASS; IQ-3B 48 planner
tests PASS; IQ-4 57 judgment tests PASS; typecheck, diff check and secret scan clean. Frozen IQ-1/2/3/4 artifacts are byte-identical to `cfd7074`.

## Remaining debt
- **P0:** none known.
- **P1:** (1) Office comparative judgment still needs a live provider; 7 Office reference turns wait on it. (2) Osa: no derived
  referent for the qualification known/missing list, and "Which concern matters more?" reaches the old fallback menu. (3) Overview
  answers (Facility/Consumer) present items through a raw result set, so ordinals there rely on the existing mechanism, not the artifact.
- **P2:** the single promotion is self-graded; comparison pairs are "the pair I took", not necessarily the user's pair; one artifact
  slot (a new derived answer replaces a parked one); a conversation that moves to an unrelated assessment loses the parked artifact
  once its 30-minute expiry passes.
