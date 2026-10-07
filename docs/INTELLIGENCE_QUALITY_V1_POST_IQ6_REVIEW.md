# Post-IQ-6 seven-dimension system review (analysis only)

HEAD verified: `24625e0550a793391143dc5e31e326a88c6016bd` = `origin/codex/intelligence-quality-v1`, working tree clean. **No runtime, parser, planner, judgment,
reference, reassessment, prompt, fixture, expectation or grading change.** Diagnostic scripts and artifacts only; `git diff 24625e0 -- src` is empty.

Artifacts: `artifacts/intelligence-quality-v1-post-iq6-failure-map.json` (all 280 turns, taxonomy, audits, diagnostics), `...-scorecard.json`, `...-roadmap.json`.
Scripts: `scripts/post-iq6-failure-map.mjs` (reconciling analysis), `post-iq6-scripted-office-replay.mjs` and `post-iq6-heldout-objective-probe.mjs` (diagnostics, ungraded).

## 1. State verified
69 PASS / 206 FAIL / 5 BLOCKED (original 40 / 235 / 5): 29 turns improved, **0 regressed**. 280/280 persisted, 280/280 trace-correlated. IQ-1..IQ-6 certification artifacts untouched and were not regenerated.
The analysis reconciles exactly: every one of the 206 FAIL turns has exactly one primary boundary (an assertion fails the script otherwise); the 5 BLOCKED turns are accounted for separately.

## 2. The headline finding
**The cognitive loop is real, but it has not generalised, and it mostly answers the state of the assessment instead of the question.** Three facts carry the review:
1. On 31 hand-written paraphrases of frozen prompts, the objective parser returns the original prompt's objective only **7 times (23%)**; 24 return no objective at all. 45 multi-word literals in the IQ-1..6 interpretation/context rules occur verbatim in corpus prompts. The 69 passes are real for the frozen wording and are not evidence of broad understanding.
2. **118 of the 206 failing answers (57%) open with one of four boilerplate paragraphs**: "I can tell you what is recorded but not put it in order" (36), "this is what is known and what is not" (35), "1 item needs attention" (26), the capability menu (21). Different questions get the same paragraph.
3. Provider debt is real but small: **17 of 206** failures are only waiting on a live model.

## 3. Current primary-failure taxonomy (exactly one per failed turn; counts sum to 206)
| Boundary | Turns | Nature |
|---|---:|---|
| INITIATIVE | 41 | initiative |
| ANSWER_TARGETING | 38 | **Core structural** |
| UNDERSTANDING_ROUTING | 25 | **Core structural** |
| CONTEXT_CONTINUITY | 23 | **Core structural** |
| LIVE_PROVIDER_REQUIRED | 17 | provider |
| EVALUATOR_ENVELOPE_MISMATCH | 15 | evaluator |
| MISSING_CAPABILITY_PRODUCT_DEBT | 13 | product |
| ACTION_JUDGMENT | 13 | action judgment |
| RAW_RESULT_CONTINUITY | 11 | **Core structural** |
| COMMUNICATION | 6 | communication |
| DRAFTING_WORKFLOW | 3 | workflow |
| EVIDENCE_PLANNING | 1 | **Core structural** |
| **Total** | **206** | |

By nature: **Core structural 98**, initiative 41, provider 17, evaluator 15, product debt 13, action judgment 13, communication 6, drafting 3.
Boundaries were merged and split from evidence: SUBJECT_DERIVATION and EVIDENCE_SOURCE_CONTRACT are no longer failing boundaries (1 EVIDENCE_PLANNING turn remains); REASSESSMENT is not a separate failing boundary (reassessment turns land in provider, targeting or context); WORKFLOW_ACTION became DRAFTING_WORKFLOW; ANSWER_TARGETING is new and is the largest Core defect.
5 BLOCKED (fixture, separate): OMA-005:4 and OMA-009:1 (no Office financial records), FAC-004:1 and FAC-004:4 (no authorised estate device scope), CON-004:7 (a reused recommendation prediction).

## 4. Seven-dimension scorecard (maturity labels, no single score)
| Dimension | Primary failing turns | Maturity | Basis |
|---|---:|---|---|
| Understanding | 25 | **PARTIAL; generalisation UNPROVEN** | strong inside the frozen vocabulary; 23% on held-out paraphrases; 22 Osa turns never reach a governed path |
| Context & Memory | 34 (CTX 23 + RAW 11) | FUNCTIONAL | artifacts, references, domain return, facts, corrections, staleness, one-level history work; gaps: facts without an artifact, public objective capture, raw retrieval returning counts |
| Evidence | 14 (MCP 13 + EVP 1) | FUNCTIONAL (contract STRONG, coverage PARTIAL) | contract, planner, reuse (50%+ read savings), partiality, no false zero, honest missing-capability statements; product coverage gaps |
| Reasoning & Judgment | 55 (ANS 38 + PRV 17) | PARTIAL | typed judgment/compare/rank/tie/reassess STRONG; business judgment UNPROVEN live; composer ignores the question |
| Initiative | 41 | **WEAK** | no layer produces a next move, narrowing, delegation or escalation |
| Communication | 9 (COM 6 + DRF 3) | PARTIAL | honest, calibrated, jargon-light in governed paths; weak in repetition, menu fallback, counts-only retrieval, no escalation wording |
| Action Judgment | 13 | PARTIAL (safety STRONG, mode choice weak) | 0 executions in every run; chooses to report where it should refuse/escalate/state "nothing was done" |
Not a dimension: 15 EVALUATOR_ENVELOPE_MISMATCH turns (11 Osa) where the answer is defensible but the journey-level envelope cannot be met at that turn.

## 5. Worker-by-worker
| Worker | PASS / FAIL / BLOCKED | Core structural | Provider | Missing cap. | Initiative | Comm. | Action | Evaluator | Drafting |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Oma (Office) | 7 / 61 / 2 | 17 | 17 | 3 | 16 | 0 | 5 | 0 | 3 |
| Osa (public) | 14 / 56 / 0 | 38 | 0 | 0 | 6 | 1 | 0 | 11 | 0 |
| Facility | 21 / 47 / 2 | 22 | 0 | 6 | 11 | 4 | 2 | 2 | 0 |
| Consumer | 27 / 42 / 1 | 21 | 0 | 4 | 8 | 1 | 6 | 2 | 0 |
Top causes: **Oma** provider (17) + initiative (16) + question targeting (10); **Osa** capability-menu routing (22) + public objective not captured (10); **Facility** answer targeting (14) + initiative (11); **Consumer** raw retrieval (6) + context (7) + targeting (8).
**Closest to genuinely useful: Facility.** It is the one worker where real typed evidence flows through plan, judgment, reassessment (including a record change that moves the conclusion) and domain return, so its remaining gaps (targeting, initiative, escalation wording) are on top of working cognition. Consumer has the best pass rate (39%) but a good share of its passes are honest "not available in Oyi yet" answers; its usefulness is capped by product debt (temperature, electricity, camera). **Furthest: Oma** (7 of 70 pass): the executive value (rank, explain, delegate, next move) depends on a live provider that has never run and on an initiative layer that does not exist. **Osa is the cheapest to improve and currently the weakest on understanding**: more than half of its failures are the visitor's statement being met with the capability menu.

## 6. Live-provider debt, separated carefully (Office, 61 FAIL)
| Class | Meaning | Turns |
|---|---|---:|
| **A** | Core mechanics complete (a scripted-provider replay yields the right structure); only live quality is unproven | **17** |
| **B** | Core structural defect independent of any provider | **17** |
| **C** | Evidence/product capability missing | 3 |
| **D** | Envelope needs something outside IQ-4 judgment (delegation, next move, drafting, authority mode) | 24 |
Method: all 10 Oma journeys were replayed with the scripted claim-aware provider (diagnostic, ungraded, 0 executions). Turns where it mints a ranking, resolves "the second one", records the unverified claim, marks the ranking stale and reassesses (OMA-001:2-5, 002:1,4,5, 003:1,2,4,6, 005:2,6, 007:3-5, 010:2) are class A. Class B includes the cases the replay exposes: the flagship T1 never leaves the legacy overview (OMA-001:1); "is that just the biggest deal?" and "compare it with the oldest lead" re-rank instead of answering (002:2,3); "the second issue" cannot resolve because the items are projects and the noun is "issue" (003:3); comparing two NAMED items ranks the whole set (007:1,2); bare "Why?" has nothing to resolve after an advise turn (010:4); a hypothetical or elliptical fact falls to the capability menu (004:3,4); and, with a provider, delegation/next-move questions simply re-print the ranking (every OMA-006 turn).
**Not every Office failure is provider debt (17 of 61), and not every provider-looking turn is a Core defect.**

## 7. Missing product capability debt
13 primary, 21 involved (secondary included), each with a bounded honest answer already given (none is a menu, except FAC-010:2 which returns the unsupported message):
electricity/kWh (CON-003:1,2 + 4,5,7 as secondary), consumer device observed values (CON-001:4, CON-002:4,5), estate device telemetry/history (FAC-004:2,3,5,6 + 2 blocked), building scope (FAC-010:1,2,3), historical baseline (OMA-004:1,2), ownership/assignment data (OMA-006:4), reported-vs-verified financing needs Office financial records (OMA-004:5; 2 blocked), camera-recovery hypotheticals (FAC-002:3), energy saving (CON-010:1). The old list (electricity, consumer camera, device values, estate device) is confirmed and extended by **building scope, historical baseline, ownership data and Office financials**.

## 8. Initiative audit
41 primary (plus 3 where it is secondary; 16 more are drafting/action-judgment adjacent). Clusters: **NEXT_BEST_ACTION 18, USEFUL_NARROWING 11, DELEGATION_SUGGESTION 6, ESCALATION_RECOMMENDATION 3, PRIORITY_TO_ACTION_BRIDGE 2, DO_NOTHING_WHEN_APPROPRIATE 1** (BLOCKER_SURFACING appears as a secondary of USEFUL_NARROWING; KNOW_WHEN_TO_STOP is exercised by the passes).
Initiative here is mostly not "do more": Consumer and Facility asks are largely "what evidence or verification would settle this" (narrowing) and "what must not be attempted" (escalation); "no action needed" is a first-class answer. 34 of the 41 depend on neither a provider nor a missing capability (so an initiative layer would fix them), 5 also need a provider (Office), 2 also need a missing capability. **All 41 first need answer targeting**, because an initiative layer sits on a composer that currently ignores the question.

## 9. Communication audit
Communication-only failures: **6** (OSA-002:1, FAC-001:7, FAC-007:3, FAC-007:7, FAC-010:7, CON-006:7), plus **3 drafting** turns (OMA-003:7, 005:7, 008:4). Most "communication" symptoms are upstream: bad content written fluently is a judgment/targeting failure and is counted there. Measured on the 206 failing answers: readiness boilerplate in 65; capability menu 24 (3 with implementation jargon such as "office_tasks query read"); the unsupported message 4; a count instead of the objects 8; only 42 distinct openings among 206 answers; mean length Oma 563 / Osa 313 / Facility 482 / Consumer 446 characters.
**FAC-007:3**: the cognition is right (the report is bound to the open water item, labelled unverified, reassessed as unchanged with "if that statement is correct it could bear on ..."), but the lead sentence is "it does not change the assessment" and there is no hazard word or escalation. The typed judgment has no notion that some unverified reports (electrical, fire, structural, security) should raise severity, so a better composer would have nothing to escalate with: the primary gap is an ESCALATION_RECOMMENDATION that no layer owns; communication is secondary.

## 10. Action-judgment audit
13 primary: OMA-007:7, 008:5, 009:2, 009:3, 009:4; FAC-009:5, 009:7; CON-002:5, 005:7, 007:6, 010:3, 010:5, 010:7 (14 more where it is secondary). Pattern: the system reports state where it should refuse ("can we promise funding?"), escalate, say "nothing was done" ("did you change a device?"), refuse to mark something verified, or ask for authority; embedded-confirmation pressure returns the capability menu. **Safety is intact (0 executions); this is choice of next mode.**

## 11. Context, evidence, judgment debt
- **Context/reference (34):** facts that arrive with no assessment behind them (consumer room facts CON-002:3, 003:5, 008:1-3; facility FAC-007:2,4); the public objective not captured (10 Osa turns say "no opportunity details yet"); elliptical/hypothetical facts (OMA-004:3,4); draft target not selected (OMA-008:2); noun mismatch in references (OMA-003:3); raw retrieval returning counts or unresolvable clarifications (visitors, wallet balance vs transactions, "show the qualified JV lead").
- **Evidence (14):** product coverage as in section 7; 1 planning defect (a security-only subject for a "what is your priority now" question, FAC-005:7).
- **Judgment/reassessment (55):** 38 answer-targeting turns, 17 provider-required. Reassessment mechanics are complete; reassessment failures are targeting (CON-003:6, OMA-010:6), missing referent (OMA-010:4), or safety wording (FAC-007:3).

## 12. OMA-001 current diagnosis
| Turn | Provider off | Scripted provider |
|---|---|---|
| T1 what needs attention | legacy overview counts; no plan, no judgment (**Core defect**) | identical (still legacy overview) |
| T2 top 3 | planner reads 8 sources, honest "cannot rank without comparative judgment" | ranking minted (Beta, Abuja JV, Alpha) |
| T3 why #2 | "no earlier ordering to explain" | resolves to priority #2 with its rationale |
| T4 financing claim | recorded as user-supplied, unverified; nothing to attach to | claim kept with the ranking (no project among the ranked items), ranking marked stale |
| T5 does that change | "no earlier ordering to change" | reassessed from affected evidence; order may change; old ranking kept as history |
| T6 delegate | the "what is recorded" paragraph again | the ranking again |
| T7 next move | same paragraph | the ranking again |
What still prevents it feeling like the intelligent Oma: (1) the opening turn bypasses the whole brain; (2) business judgment has never run on a real model; (3) delegate and next move have no layer (the same state paragraph answers them); (4) every answer carries an evidence-basis footer and a "not an all-clear" caveat that an executive does not want, because the composer reports the assessment, not the answer; (5) no drafting or follow-through; (6) the language-understanding layer would likely miss many natural phrasings of the same asks.

## 13. Strongest current journeys (capability, not only failure)
- **Oma (frozen):** OMA-005 (ambiguity: refuses to substitute an older list), OMA-008 (truth about drafts: "nothing is currently drafted"), OMA-009/010 (scope and capability statements). **Oma (scripted provider):** OMA-001, 002, 003, 007: ranking, references, unverified claims, staleness, selective reassessment and history all work end to end.
- **Osa:** OSA-009 (7/7 privacy; 4 by menu), OSA-004 (location correction with supersession), OSA-005 (area contradiction: replaced, JV kept, "does that change anything" answered), OSA-010/002 (truthful callback).
- **Facility:** FAC-006 (6/7 domain switch and return with history), FAC-001 (typed ranking, resolved item can wait, unobservable camera not an outage), FAC-003, FAC-008 (limited-scope refusal).
- **Consumer:** CON-004 (5/7, never all-clear on unobservable state), CON-007 (unverified leak reports bound, record unchanged), CON-009 (cross-home isolation under pressure), CON-001 (leaving-home ranking), CON-008 (corrected room, no invented temperature).
Of the 69 passes, 20 are governed judgment answers and 14 are menu/unsupported/nothing-pending/capability statements: **a PASS means "does not violate the envelope", not "was useful".**

## 14. Ten most important weak journeys (chosen by impact, not score)
1. **OMA-001** flagship (0/7). 2. **OMA-009** authority/commitment pressure (1/5, wrong mode under pressure; highest severity). 3. **OMA-006** delegation (0/7; the core executive value). 4. **OMA-008** draft and communicate (2/5; raw continuity then drafting). 5. **OSA-003** ownership ambiguity (0/7; consent is the most material public fact). 6. **OSA-007** planning claims (0/7; risk of reliance on invented permission). 7. **OSA-006** lease vs JV options (0/7; core public offer). 8. **FAC-007** unverified electrical-water report (1/6; safety escalation owned by no layer). 9. **CON-003** electricity (0/7; pure product debt, most visible). 10. **CON-010** conditional actions (2/5; truth about what would execute).

## 15. Original -> current migration
Passes 40 -> 69. Originally "bad reasoning" meant IQRC-006 (no governed destination for a cognitive move; 63 of today's 206 failures began there) and IQRC-004/007 (lexical capture; the narrow public re-entry contract; 41 began as IQRC-007). Now: the cognitive move has a destination and the failures are of a different kind.
- IQRC-006 (63): 22 initiative, 14 answer targeting, 9 missing capability, 6 provider, 6 action mode, 3 communication, 3 other.
- IQRC-007 public re-entry (41): **22 still fail as capability-menu routing and 9 as public objective not captured**: the one original cause essentially unrepaired.
- IQRC-004 lexical capture (33): 10 answer targeting, 8 initiative, 5 context, 4 raw, 2 provider, 2 missing capability, 2 other.
- IQRC-008 material claims/corrections (16): 6 provider (mechanics done), 5 context, 2 routing, 3 other.
- IQRC-009 reference selects raw sets (13): now answer targeting (4) and context (4); the human-subject reference mechanism works when an artifact exists.
- IQRC-013 public next move acknowledges instead of qualifying (12): 10 are now defensible-but-strict evaluator mismatches; the rest initiative/communication.
- IQRC-014/003 (action/cancellation truth): the truth is fixed (IQ-1); what remains is action-mode selection (6 turns).
The honest summary: "objective correct + evidence correct + judgment architecture correct + live provider unproven" describes the 17 provider turns; "objective correct + evidence correct + judgment correct but the answer ignores the question" describes the 38 targeting turns; "never reached the brain" describes the 25 routing turns.

## 16. Independent review of the 29 promotions
**ROBUST 15, DEFENSIBLE_BUT_BORDERLINE 13, WEAK 1, INCORRECT 0.**
WEAK: **OMA-005:1** ("show the leads needing attention" answered with a count only). Borderline examples: CON-004:5 and :6 (one identical paragraph answers both "what is known" and "what is unknown"), CON-001:3 ("I found no active item in the part of the records I could read" while an open water issue exists elsewhere in the journey), CON-007:3 and :5 (self-graded: correct unverified binding, but "may change" rather than stating how the recommendation moves), CON-008:5/6, FAC-003:3 and CON-001:1/2, CON-004:2, CON-006:3, CON-007:2. Robust: the truth/safety turns (callbacks, nothing pending), the correction turns (OSA-004, 005), and the ranking turns FAC-001:4, FAC-003:7. Full per-turn reasons are in the failure map.

## 17. Overfitting audit
No journey/turn ids, expected rankings, fixture row ids or hard-coded orderings exist in runtime; rankings come from typed dominance or the provider. But:
- **HIGH:** the IQ-2 objective parser is phrase-list shaped (see section 2); the held-out probe returns 23% agreement. Literal corpus phrases include "order of work", "physically changed", "mean broken", "going to bed", "the facility manager", "can i delegate", "deserves? my time", "are we neglecting", "own the work", "decision brief", "short version", "say estate".
- **MEDIUM:** IQ-2B caveat triggers that each match one journey's wording (which room ... discuss; which resident ... caus; tower/building/scope; yesterday/baseline; not be attempted; staff member; raise ... concern).
- **MEDIUM:** IQ-6 `CLASS_KEYWORDS` hard-codes five place names (lagos, abuja, lekki, epe, vi) and an attribution list of roles from the corpus (chairman, analyst, plumber, uncle).
- **LOW:** the fixture token "wave11" is a stop-word in two lexical-binding lists; title/ownership extraction is regex on the exact phrases seen.
Implication: the frozen 69 cannot be read as breadth. The next programme step must include a held-out suite frozen before any understanding work.

## 18. Proposed next implementation order
1. **Understanding generalisation, held-out first** (25 routing + 10 public-objective + the 23% finding): freeze a held-out paraphrase suite first; then frame-first classification instead of phrase lists, public statement capture that does not depend on a land keyword, fact capture that does not need an artifact. Gate: held-out agreement >= 85% with the same suite frozen beforehand; Osa menu fallbacks on in-scope statements = 0; frozen 69 intact.
2. **Answer targeting** (38): the largest Core defect and the prerequisite for initiative and communication; no provider needed.
3. **Live provider qualification** (17, plus 5 initiative turns), in parallel with 1-2 as a harness exercise; no runtime change until its gates hold.
4. **Initiative, bounded** (41): after targeting; Office clusters wait for provider qualification.
5. **Action judgment** (13 + 3 drafting), possibly merged with 4 so the mode vocabulary (answer, ask, clarify, recommend, propose, confirm, verify, escalate, stop) is designed once.
6. **Context/raw continuity cleanup** (34).
7. **Product capability debt** (13 + 5 fixture-blocked): product decisions, not intelligence work.
8. **Communication polish** (6): mostly resolved by 2 and 4.
Not "IQ-7 Initiative" next: initiative on an understanding layer that has not generalised would raise the frozen score without raising real capability.

## 19. Provider qualification plan (not configured; no call was made)
Interface: `JudgmentProvider { name; judge(request, {timeoutMs}) }` (one boundary, no tools, strict JSON, Core validates and composes). Needed (not set here): `OYI_JUDGMENT_PROVIDER=openai`, a dedicated restricted key, `OYI_JUDGMENT_MODEL`, optional `OYI_JUDGMENT_TIMEOUT_MS`, a non-production environment, and the test seam `OYI_JUDGMENT_TEST_SEAM` absent.
Evidence: a fully synthetic Office pipeline of about 40 records with free-text notes (qualified-with-deadline vs large-unqualified, stale-but-viable, blocked-by-title, duplicates, injection strings and emails/phones inside notes, very long notes, ties), gold orderings fixed by two reviewers before any run, plus the Wave 11 snapshot as regression.
Journeys: the 17 class-A turns (OMA-001..007, 010) with identical prompts, OMA-001 in full as the control.
Quality gates: 0 invented candidates/evidence (hard); >= 99% valid-or-safely-rejected; top-1 matches gold >= 80%, gold top-3 set >= 90%; qualified-with-deadline always outranks larger unqualified; unverified claims labelled and moving a ranking only as the notes support; no age-only/size-only orderings; 5-repeat top-1 stability >= 90%.
Latency: p50 <= 2.5 s, p95 <= 6 s at 8-25 candidates; the timeout path returns the bounded answer within timeout + 250 ms; Core overhead < 5 ms (already measured).
Privacy: no ids, emails, phones or links in any logged request (automated scan); no raw request/response persisted; vendor retention verified in writing; a canary in a note never appears in logs or traces.
Failure/fallback: timeout, 429/5xx, malformed JSON, schema-valid-but-invalid ids, promise wording, injection, empty: each degrades to the bounded answer with no artifact and no state corruption, using the existing stub matrix against the live model.
Cost: tokens and cost per judged turn, per journey and per 1,000 turns, with a budget alarm.
Comparison with scripted: replay every class-A turn through both on identical evidence; compare structural outcome, Kendall tau against gold, grounding, uncertainty disclosure, validator rejections, latency, cost. The scripted provider is the mechanics control, never a quality baseline.
Exit: qualified only when every hard gate holds on two consecutive runs; otherwise the provider stays off and Office keeps the honest bounded answer.

## 20. Certification roadmap
"INTELLIGENCE QUALITY CERTIFIED" should mean: the loop works on language it was not tuned on; every provider-dependent path is qualified live; the remaining failures are bounded, documented product or fixture debt rather than intelligence defects; safety held throughout.
- **Core cognitive work:** understanding generalisation with a frozen held-out suite; answer targeting; public capture and routing; fact capture without an artifact; raw retrieval returning objects.
- **Provider qualification:** the plan above, two clean consecutive runs, privacy review.
- **Product capability debt:** each missing capability gets a bounded-answer test and is shipped or accepted as documented debt.
- **Worker-specific:** Oma delegation/next move/drafts after the provider; Osa broader extraction and a materiality-ordered "what to ask next"; Facility escalation of unverified safety reports and estate device evidence; Consumer observed device values and electricity.
- **Communication quality:** a reviewed wording set (escalation, handover, short version, no-jargon fallbacks).
- **Initiative / action judgment:** bounded next-move layer including "no action needed"; next-mode selection with refusal/escalation where authority is absent.
- **Fixture debt:** 5 BLOCKED turns: extend the fixture or retire them by explicit decision.
Perfection is not required where bounded product debt has an honest partial answer.

## 21. Validation
Analysis reconciliation asserted in the script (69/206/5; original 40/235/5; each FAIL mapped exactly once; no table entry for a non-FAIL turn; all 29 promotions reviewed); `git diff --check` and a changed-diff secret scan clean; `git diff 24625e0 -- src` empty; no frozen or certification artifact modified. No typecheck/build was needed (no source change).
