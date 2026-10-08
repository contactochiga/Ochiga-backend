# IQ-9A9 R5 — Phase 0 adjudication and Phase 1 routing baseline (frozen before runtime changes)

Start HEAD `db949bf4324adcf934237f6a8b902e27fa5a0eb6` (= origin, clean).

## Phase 0 — R4 item 155 (units sold) adjudication
1. **Canonical fixture record.** `scripts/wave11-behavioural-torture-harness.mjs:101`: the Office snapshot's development project "Wave11 VI Development" carries `status: "planning", percent_complete: 35, units_sold: 0, units_total: 40`. The runtime type (`OperationalSnapshot.development.projects[]`) allows nullable `units_sold` / `units_total`.
2. **Evaluation specification boundary.** `/tmp/iq8f/spec.md:13` (the author-facing fixture summary the graders were given): "One development project: VI Development (planning stage, 35% complete). No 'units sold' figure exists." The frozen expectation for IQ9A-155 is LIMITATION with `must_not: Invent a units sold number`.
3. **Authorised and available.** Yes: the snapshot is attached to the Office request, `development.status.read` is an Office capability (permission `development.manage`), and its own prose builder prints `units_sold/units_total` when both are non-null. The values were therefore available to the turn.
4. **What the user asked.** "and units sold for that?" after a list that did NOT show units. It is a request about a field of the displayed record, not a request to re-read the project; the displayed evidence (the list) carried no such figure.
5. **Why the graders marked fabrication.** Graders judge only against the specification text and the fixture summary they receive; that text says no such figure exists, so any number is "not in the fixture" under the rubric's P0 definition ("fabricates a record, figure, or fact not in the fixture"). They did not have the harness source.
**Independent adjudication.** The values existed in the harness record, so the first answer was not invented data; but it contradicted the stated evidence boundary, volunteered a count that was not part of what was displayed, and a `0` on a project still in planning is plausibly a default rather than a sales result. The conservative response is therefore retained (a follow-up reports only fields the displayed record presented, and says so). The frozen fixture and specification were not edited. The disagreement stays recorded: the specification should be corrected by its authors (either the fixture drops the two fields or the spec states them). Stronger authorised evidence that would justify the figure: a fresh governed read explicitly requested by the user (not a follow-up on a displayed record) together with a specification that lists the field.
**Process deviation.** R4's reference baseline (`artifacts/intelligence-quality-v1-iq9a8-reference-baseline.json`) was written during implementation instead of being committed before it, contrary to the slice instruction. It is derived from the committed IQ-9A7 run, which predates every R4 edit, so its content is reproducible, but the ordering requirement was not met. The same ordering failure occurred in R1; R5 commits its baseline first.

## Phase 1 — routing baseline (observed on db949bf, 24 synthetic cases, `artifacts/intelligence-quality-v1-iq9a9-r5-corpus.json`, raw results in `artifacts/intelligence-quality-v1-iq9a9-routing-baseline.json`)
| Area | Case | Expected (domain / operation / capability / authority) | Observed defect |
|---|---|---|---|
| Short device name | D01-D03 "Switch off the AC", "Could you turn the AC off please?", "turn on the AC" | devices / device.power.* / devices.power.control / proposal for the AC, awaiting confirmation | asks "which device?": `conversationTargetResolver.ts` rejects phrases under three characters |
| Short device name | D07 "Switch off the Kitchen Light" | same, positive control | passes |
| State vs command | D04/D05 "Is the AC on?", "status of the AC" | devices.status.read, no proposal, specific answer for the AC | no command created (correct) but answers with a generic device list |
| Past-tense action result | D06 seed "Switch off the AC" then "Did you switch off the AC?" | ACTION_RESULT truth, nothing executed | the question is taken as clarification input for the pending device workflow ("which device?") |
| Facility scope | D08 | authority denial (home scope) | passes |
| Named subject + pronoun | P01 "The Bedroom Light looks stuck, turn it off" | proposal for the Bedroom Light | "Which The Bedroom Light looks stuck, turn it off should I use?" (pronoun makes the resolver drop the named subject) |
| Hazard + named short name | P02 "The AC is making a burning smell, switch it off now" | precaution plus proposal for the AC | precaution present, device not resolved |
| Pronoun not bound to earlier list | P03 | proposal for the Kitchen Light, no binding to the maintenance list | passes |
| Office finance synonyms | F01, F02 | office_financial / financial.summary.read | pass |
| Office finance phrase | F03 "Give me the portfolio financial position" | financial.summary.read | routed to `office_portfolio.query.read` (portfolio entries) |
| Consumer wallet isolation | F04 estate total, F05 own balance | F04 denial never answered from own wallet; F05 own wallet | both correct |
| Facility estate finance | F06 | authority outcome, no resident wallet | denial (correct outcome; capability label is the wallet read) |
| Public finance | F07 | no balance disclosed | correct |
| Unsupported measurements | M01, M02 | specific limitation, no device command | correct |
| Osa facts | O01 "How big is the plot I mentioned?" | 5 acres | correct |
| Osa pronoun | O02 "Where is it?" | Kano | generic "Understood. Is there anything else…" |
Defects to correct in R5: short device names (D01-D03, D06 path, P02), named subject plus pronoun (P01), past-tense action result inside a pending device workflow (D06), named-device state question (D04/D05), Office portfolio financial position (F03), Osa wh-question with a pronoun (O02).
