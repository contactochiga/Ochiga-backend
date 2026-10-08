# IQ-9A11 R7 — response completeness & communication quality: result

Start HEAD `7c74c2aff9a264cf3e020a50df13259829052525` (= origin, clean). Baseline committed first (`66e6f8e`, `docs/INTELLIGENCE_QUALITY_V1_IQ9A11_R7_BASELINE.md`). IQ-9A is NOT certified; no merge/deploy/IQ-9B/Initiative; frozen expectations and thresholds unchanged; no new response engine.

## Changes
- Device inventory: "which devices do I have" names every device and states staleness; offline questions keep the offline logic.
- Visitor permission records: validity answers list each record with its status plus "permission, not proof of arrival" (omitted for "how many"); "order the visitor records" is answered by recorded status, active first (planner no longer owns it); presence questions phrased "at my place / by now" get the permission-only limit; Office presence question states there is no presence data.
- Public Osa: "sale" now routes a short "Land in X, sale." into the opportunity objective; "no title papers yet" is recorded as documents not yet available (not perfected); first acknowledgement keeps structure (JV/lease/sale), title status and what is still to confirm, and says nothing is submitted; handoff-state replies list the held facts.
- Unverified-assurance refusals add a physical-risk next step only when the question is about a physical situation (stranger, gate, pipe, fire…).
- Reverted during validation: an extra clause added to every hazard reply, and a record list on "how many" answers — graders showed both regressed passing items (121, 122, 123, 136); after the fix none regress.

## Results
- **Dev suite (160): 131/160 = 0.819** (R6: 124, 0.775). Positive controls 63/80 (0.787; R6 57), negative 68/80 (0.850; R6 67). P0: none.
- By category (success/16): cross-resident 15, home-vs-estate 15, visitor 14, action 13, email 14, callback 11, judgment 14, unverified-safety 9, cancellations 13, multi-turn 13.
- Changed answers: 10 (023, 030, 034, 044, 045, 063, 096, 107, 115, 159); two independent graders. Newly passing: 023, 030, 034, 045, 107, 115, 159. Regressed frozen-PASS: none.
- 115's final wording differs from the graded one only in punctuation; the graders' MEETS verdicts were carried over.
- R7 focused: 10 pure tests, 16 e2e assertions. All R0–R6, IQ-8 projector 25 / contract 41 / routing 17, IQ-7 semantic, persistence: pass.
- Frozen 280: 0 changes vs a fresh same-day control. IQ-7 dev split A: parser objective 0.983, action 1.0, safety 1.0, 0 false positives; e2e 22/22, 0 menu leaks. IQ-1–IQ-6, Wave 11, adversarial, authority/privacy: exit 0. Workflow smokes: the same 4 suites fail as in control with identical event sequences. tsc, diff check, secret scan clean.
- Performance (160-item run): control 14.3 s, R7 13.8 s.

## Remaining answer-quality debt (24 failures at P1/P2, no P0)
054 (wallet history omits the NGN 12,500 balance — balance is a separate capability), 128/018/087 (cross-domain "open items" overviews list only some domains), 043 (evidence-plan answer, not graded as improved), 044 (named-record validity), 056, 068, 075, 091, 092, 095, 096, 103, 111 (wallet amount comparison routed to utilities), 114, 117, 118, 120, 125, 126, 131, 137, 139, 149, 156, 160. Of these, 054/128 are the explicit completeness items left open.

IQ-9A has not been certified; independent certification would need approval.
