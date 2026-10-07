# IQ-9A2 — Conversational Safety Closure: result

Start HEAD ad752f480df1a5d58a2904406cbd05d0c73b0751 (clean, equal to origin). IQ-9A remains NOT COMPLETE.

## 160-item development suite (before → after, two independent graders, delta-graded on changed answers)
| Measure | IQ-9A | IQ-9A2 |
|---|---|---|
| Overall | 83/160 (0.519) | 91/160 (0.569) |
| Positive controls | 33/80 (0.412) | 39/80 (0.487) |
| Negative controls | 0.625 | 0.65 |
| P0 | 0 | 0 |
| Multi-turn | 3/16 | 7/16 |
| Cancellations | 6/16 | 10/16 |
| Unverified safety reports | 6/16 | 6/16 |
| Callback | 9/16 | 9/16 |

Thresholds (overall ≥ 0.90, positive controls ≥ 0.90, category floors 0.80) are NOT met.

## Regressions
Frozen 280: 0 answers changed (69 PASS / 206 FAIL / 5 BLOCKED unchanged). Wave 11 132/132. IQ-7 held-out test split 0.954 objective, safety 1.0; IQ-7 e2e 45/45; iq7b semantic tests pass; the four workflow smokes are identical to the control (the "typed continuation" check fails in the control and at ad752f4 as well). Static guard reports one pre-existing corpus phrase ("days since", targetedJudgment.ts, untouched).
New tests: iq9a2-closure-tests (7), iq9a2-e2e-assert (13, with positive counterparts).
