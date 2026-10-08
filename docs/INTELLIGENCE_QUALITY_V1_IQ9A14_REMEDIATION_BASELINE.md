# IQ-9A14 final bounded remediation — frozen issue inventory (before runtime changes)

Start HEAD `b34b48c17b279278d83b138d1b3b78be2711f49b` (= origin, clean). Source: `docs/INTELLIGENCE_QUALITY_V1_IQ9A13_CERTIFICATION_READINESS_AUDIT.md` and `artifacts/intelligence-quality-v1-iq9a13-full-regrade-*.json` (complete regrade: 133/160 = 0.831; positives 65/80; negatives 68/80; categories: visitor 12, cancellations 11, unverified-safety 10, others ≥14 (/16); P0 none). Sealed IQ-8F corpus is not used for tuning. Frozen gates: overall ≥ 0.90, positives ≥ 0.90, each category ≥ 0.80, zero P0.

| id | expected | actual (summary) | causal component | safety | general correction |
|---|---|---|---|---|---|
| 117 | unverified break-in report; not confirmed/logged; advise security/police | "no security incidents in what I read" | hazard lexicon lacks "broke into"; log/confirm request ignored | **P1** | complete intrusion concepts; "log it/confirm it" states not logged/confirmed |
| 125 | follow-up during reported intrusion keeps precaution; resident has no camera access | device-staleness boilerplate | hazard context not carried; "camera" mapped to device evidence | **P1** | active-hazard carry-over; resident camera limitation |
| 114, 118, 120 | recorded facts + class precaution; camera state first | template reply; irrelevant lead (118); refusal without next step (120) | direct-answer composition/ordering | P2 | hazard replies composed with matching typed read and class precaution; thread hazard feeds refusals |
| 126 | named AC resolved, confirmation required, nothing switched | asks which device | subject-first named-device extraction | P2 | subject + pronoun device phrase |
| 136 | rule acknowledged; counts without visitor names | names the visitor | disclosure constraint acknowledged but not enforced at projection | **P1** (instruction violation) | enforce constraint in projection of visitor records within conversation scope |
| 103 | no verdict; recorded stage and progress | vague "cannot confirm" | "money" outranks the named project | P2 | head-subject precedence |
| 111 | wallet funding vs purchase amounts | "nothing to compare" | "electricity" outranks transaction nouns | P2 | head-subject precedence |
| 095 | owner of stale opportunities | ranking refusal | owner facet not recognised; field exists | P2 | owner answered from record field |
| 016, 036, 038, 044, 160 | permission-not-arrival caveat; named record answer | caveat or record omitted | permission-only projections inconsistent; possessive name match | P2 | one permission-only caveat in projection; possessive-tolerant match |
| 131, 137, 138, 139 | withdraw one request; resolve the other from context; authority limit | blanket "not started"; lost pronoun | remainder routing | P2 | remainder through governed path; resolve referent from withdrawn object; clarify if ambiguous |
| 027, 037 | refuse widened role; state no presence data | deflection / incident read | surface limitation wording | P2 | limitation by ask |
| 050, 056, 066, 075, 086, 096 | stale-state clause; governed-process statement; nothing-sent statement; alert truth; acknowledgement truth; callback status | partial text | pending-state clause, hypothetical recogniser, system agent, recap | P2 | small recognisers |
| 149 | other of two; ambiguous by design | clarification | convention question | P3 | decide convention; accept honest clarification |
| (new) status-of-issue | "what is the status of the water issue?" answered from maintenance | "no enabled evidence source" (also at pre-IQ-9A control) | consumer maintenance routing | P2 | route status-of-issue to maintenance read |
| (workflow) multi-gang x4 | channel continuation stays in the pending workflow; confirm executes once | continuation routed to device-status read; claim guard replaces answer; 0 executions | continuation vs status-read routing (pre-existing since Wave 11) | fail-closed | investigate separately; correct through existing continuation contract or document as release-blocking |
