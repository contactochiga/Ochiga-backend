# IQ-9A12 R7 completeness closure: result

Start HEAD `d27c75eeb8ccc1ecc2530442d4c07bd7f9d163ea` (= origin, clean). Baseline committed first (`632517e`). IQ-9A is NOT certified; no merge/deploy/IQ-9B/Initiative; frozen expectations/thresholds unchanged; no new engine.

## Fixes
- **054 wallet:** `wallet.transactions.read` also reads the canonical balance source (same `wallet.read` authority and home scope) only when the request names history or balance. The projector states rows, then "Current wallet balance: <currency> <amount> (as of <date>)", or says the balance could not be read. The balance is never derived from the rows. Facility surface still refused; plain "recent transactions" does not read the balance. No fixture value is hardcoded.
- **018/087/128 open items:** the estate overview now also covers visitor permission records and camera state, but only for actors holding `visitors.read` / `cameras.view`; otherwise it says they were not checked. "Open items" no longer routes to the device inventory, and the planner shortcut for it is bypassed. For Office, "anything open that needs urgent attention" goes to the bounded evidence plan and leads with a Yes plus "can't rank urgency".
- **068/092:** a truthful not-done / not-passed-on answer is followed by what the thread's governed records show about the named subject (a separate governed read turn). "Has anyone rung back" is a communication result question and says a callback was only proposed.
- **156:** "the first/second one" resolves to the entry of the thread's result set; if no contact exists the answer names the entry and states nothing was sent or proposed.
- **160:** visitor follow-ups keep the permission-not-arrival caveat.

## Results
- Dev suite: **139/160 = 0.869** (R7 start 131). Positive 69/80, negative 70/80. P0: none. Changed answers graded by two independent graders; **no frozen-PASS regression** (two transient regressions found during grading, 069 and 088, were corrected: the extra sentence now applies only to "can you…" requests; 088 gained the proposal-only statement).
- Categories (/16): cross-resident 15, home-vs-estate 16, visitor 14, action 14, email 15, callback 13, judgment 14, unverified-safety 10, cancellations 13, multi-turn 15.
- Four R7 areas: `artifacts/intelligence-quality-v1-iq9a12-r7-closure-corpus.json` (21 cases) and `scripts/iq9a12-r7-closure-e2e-assert.mjs` (18 assertions): structured records (6), multi-part/multi-source (5), explanation (2), action-result and communication truth (7), each with an authorised counterpart (facility wallet denial, history without balance).
- All R0–R7 pure and e2e suites, IQ-8 projector 25 / contract 41 / routing 17, IQ-7 semantic, persistence pass. IQ-7 dev A: objective 0.983, action 1.0, safety 1.0, no false positives; e2e 22/22.
- Frozen 280: 0 changes vs a fresh control. IQ-1–IQ-6, Wave 11, adversarial, authority/privacy: exit 0. Workflow smokes: same 4 suites fail as in control with identical event sequences. tsc, diff check, secret scan clean.
- Performance (160-item run): control 13.6 s, now 13.9 s.

## Remaining completeness debt (21 items, no P0)
016, 043, 044 (visitor wording), 050 (stale-state statement), 056, 075, 091, 095 (owner), 096, 103 and 111 (comparison/verdict routing), 114, 117, 118, 120, 125, 126 (safety reports lack recorded facts or log-request handling), 131, 137, 139, 149. The Office urgent-attention answer covers leads, opportunities, projects and reports; tasks and meetings have no evidence class in the planner and are not listed. The explanation/comparison area has only one solid positive case.

R7 implementation criteria are met. IQ-9A certification is not claimed; an independent review would still weigh the 21 open items.
