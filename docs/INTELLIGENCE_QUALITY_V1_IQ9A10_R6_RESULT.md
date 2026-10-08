# IQ-9A10 R6 — governed action & operation selection: result

Start HEAD `697048b2100dddd92a354c739076bf94fd0543d2` (= origin, clean). Baseline committed first: `792a7ff` (`docs/INTELLIGENCE_QUALITY_V1_IQ9A10_R6_BASELINE.md`). IQ-9A is NOT certified; no merge, deploy, IQ-9B or Initiative. Sealed IQ-8F corpus not used. Frozen thresholds unchanged. No second parser, no new action engine.

## Changes (operation selection only)
- `normalizeIndirectCommand` (answerTarget.ts): "Would you mind turning X off?" / "I'd like the X off" become the imperative before the one parser; still a governed, confirmation-gated proposal.
- Polite/indirect requests for non-device mutations ("Can you mark Lead Alpha as contacted?", "Could you tell my visitor…", "What can you do about getting a note out to…") are action requests: nothing done, nothing pending (consumer/facility/office; public surface unchanged; "…me/us" requests stay reads).
- "Which light did you turn off?" / "What did you send?" → ACTION_RESULT (truth of what was done), with a caveat that changes made outside the conversation cannot be seen.
- Named-device state question ("Is the Living Light on?") answered from that device's own availability record; availability is never reported as power state.
- Approval paraphrase with no pending workflow ("ok do it") → nothing pending; canonical confirmation-guidance text is no longer overwritten by a clarification.
- Choice questions ("sale or lease?", "open or resolved?") answer with the recorded alternative, or say neither is recorded; never a bare Yes. Single-fact questions still answer Yes.
Confirmation, cancellation (terminal), compound withdrawal + independent new proposal, and hazard-plus-named-device behaviour are unchanged and re-verified (R6-A01/A02/A07/A08/C01–C05/H01–H03).

## Results
- R6 corpus (31): all baseline defects fixed except Q02 ("Is it in Kano?" → "Understood"). 0 executed device commands. Pure tests 25, e2e 33.
- Prior suites unchanged: IQ-9A, 9A2 (13), R0 (21), R2 (26), R1 (22), R3 (20), R4 (19, persistence ok), R5 (35); IQ-8 projector 25 / contract 41 / routing 17; IQ-7 semantic pass.
- Dev suite (160): 4 answers changed (051, 059, 068, 072); 0 errors. Independent graders A and B agree: 051, 059, 072 MEETS_TARGET; 068 DOES_NOT_MEET (says nothing was sent but omits Lead Beta's recorded facts; its prior answer also failed — not a regression). Net: 3 dev items improved to pass, none regressed.
- Frozen 280: 0 answers changed against a fresh same-day control; no preservation review needed.
- IQ-7 (dev split, suite A): parser objective 0.983, action 1.0, safety 1.0, 0 false positives; e2e 22/22, 0 menu leaks, 0 executed. (Measured on the dev split; not compared to R5's aggregate.)
- IQ-1–IQ-6 chain, Wave 11, adversarial (0 execution attempts), objective, authority/privacy isolation: exit 0. Workflow smokes: the same 4 suites fail as at R5 and in the control, with identical event sequences.
- typecheck, `git diff --check`, secret scan: clean.

## Remaining operation failures
Q02 fact-check "Is it in Kano?" ("Understood"); dev 056 (hypothetical "what would happen if I asked…"), 068 (no recorded facts), 092 (callback "both with the team"), 131 ("forget the AC but do the kitchen one" does not resolve "the kitchen one"), 137, 139, 096, and the other non-action dev failures from R5.

R7 may begin only on approval.
