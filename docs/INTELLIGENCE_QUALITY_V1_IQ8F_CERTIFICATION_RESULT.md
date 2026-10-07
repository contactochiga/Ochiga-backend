# IQ-8F — Independent answer-targeting certification: result

**Verdict: IQ-8 CERTIFICATION FAILED — REMEDIATION REQUIRED.** Implementation unchanged at `ec23ec4`; no runtime code was modified.

| Gate | Required | Actual |
|---|---|---|
| Overall (320 primary) | >= 0.85 | **0.359** (115/320) |
| Oma / Osa / Facility / Consumer | >= 0.80 each | 0.425 / 0.200 / 0.412 / 0.400 |
| Answer intents >= 0.75 | 16 of 16 | **0 of 16** (best REFUSAL 0.65; DISCOVERY 0.05, SAFETY_RISK 0.05, CLARIFICATION 0.10, CONSTRAINT 0.15) |
| P0 | 0 | 10 primary (15 in all sets) |

Companions (separately scored): paraphrase 0.30 (threshold 0.80), operation-flip 0.44 (0.75); only 69 of 100 paraphrase pairs kept their success class and 62 of 100 flips changed the route.

Integrity: four independent authors (transcripts show only a read of the spec and a write of their file), 520 items, overlap with earlier suites 1.35% exact (limit 2%), hashes frozen before the single first-contact run, 0 evaluator defects, two independent graders per worker (96.2% agreement), a third adjudicator for the 20 disagreements and a 40-item check of agreed grades (1 success-class difference, 0 P0 differences). Disclosed deviations: two graders used a script to emit verdicts and several wrote generic reasons.

Failure classes (205 failing primary items): 127 expected a real answer, 38 an honest limitation, 18 a clarification, 13 a not-executed statement, 9 a refusal. 72 were served by the menu fallback, the unsupported fallback, the out-of-scope fallback or the capabilities list. The assessment-planner path wrote 44 of the failures (generic ranking/evidence text for non-judgment asks). Osa (public) is the weakest: held-fact questions, constraints, submission and discovery frequently get the capability menu or the "Understood" acknowledgement.

P0 findings: invented judgment/ranking without a provider (Facility and Consumer, 7 items); an action implied executed ("Yes" to "has anybody emailed the plumber"); a "Yes, the visitor is at the house" from a permission record; a "Yes" to "have you told someone" with no receipt; and five contested privacy items where a neighbour/all-residents request was answered with the resident's own wallet figures instead of a refusal.

Regression (unchanged implementation): frozen 280 unchanged (69/206/5, 0 audit failures); Wave 11 132/132 harness with `utilities.usage.read` unavailable (an honest limitation, not a capability success); IQ-1..IQ-6, authority/privacy, device truth and One-Core all exit 0; the four legacy workflow smokes still fail identically to the unmodified-Core control; no device command was executed.

Recommended next slice (separate remediation cycle, then a newly commissioned independent suite — this corpus must not be used as a tuning set): (1) judgment boundary — no ranking or verdict without a provider on any surface, including the assessment planner path; (2) discovery, constraint and clarification ownership for informal phrasings (the menu fallback must never answer a request); (3) Osa held-fact, submission, constraint and refusal handling (acknowledgement template must not win); (4) read-vs-act and "did you do X" questions (never "Yes" without evidence); (5) privacy: wrong-scope person/estate requests refuse instead of returning the resident's own data; (6) safety/worry statements on all surfaces; (7) follow-up referent preservation; (8) paraphrase robustness of the concept vocabulary; (9) fix the four legacy workflow failures against the control.
