# IQ-9A10 R6 — Operation-selection baseline (frozen before runtime changes)

Starting HEAD 697048b2100dddd92a354c739076bf94fd0543d2. Corpus: `artifacts/intelligence-quality-v1-iq9a10-r6-corpus.json` (31 synthetic cases, none from the sealed IQ-8F corpus). Raw: `artifacts/intelligence-quality-v1-iq9a10-operation-baseline.json`. Executed device commands: 0 (trap).

Classes: READ, EXPLAIN, PROPOSE_ACTION, ACTION_RESULT_QUERY, CONFIRM, CANCEL, CLARIFY, CORRECT, CHOICE_QUESTION (conceptual; not authorization grants).

## Defects (observed vs expected)
| id | utterance | observed | expected |
|---|---|---|---|
| A03 | Would you mind turning the Bedroom Light off? | evidence-plan assessment | PROPOSE_ACTION (confirmation pending) |
| A04 | I'd like the Kitchen Light off | offline-device status read | PROPOSE_ACTION |
| A05 | Is the Living Light on? | aggregate offline/stale summary | named-device state read (stale/unknown stated for that device) |
| A06 | Which light did you turn off? | garbled "Which Which light did should I use?" | ACTION_RESULT_QUERY: nothing turned off through chat |
| A09 | Did the bedroom light get turned off earlier? | bare "No" | scoped: nothing done via Oyi; cannot see other changes |
| C02 | ok do it (after cancel) | "Which one do you mean?" | nothing pending; nothing executed |
| H03 | Something is sparking, turn it off | precaution, no target question | precaution + ask which device |
| O01 | Can you mark Lead Alpha as contacted? | lead summary | not executed; needs governed confirmation |
| O02 | Could you update Lead Beta to qualified? | status read | not executed |
| O04 | Can you notify my expected visitor that the gate code changed? | evidence-plan assessment | nothing sent |
| O05/O06 | Could you tell my expected visitor I will be late? | visitor read | nothing sent |
| Q01 | Is it for sale or lease? (held: sale) | "Yes — structure offered: sale" | "Sale, as you told me" (no bare Yes) |
| Q02 | Is it in Kano? | "Understood" | Yes — Kano |
| Q03 | open or resolved? | "Yes — still open" | "Open" (no bare Yes) |
| Q05 | sale or lease? (held: JV) | "Yes — structure: JV" | not recorded as sale or lease; recorded JV |

## Already correct (must be preserved)
A01, A02 (proposal, not executed), A07, A08 (pending, nothing sent), C01, C03, C04, C05 (cancellation terminal, independent new proposal), H01, H02 (precaution + named proposal), M01, M03 (no completed-contact claim), M04 (phone constraint), Q04 (Yes, open).
Open to inspect: M02 (fixture handoff failure message is truthful: callback not confirmed).
