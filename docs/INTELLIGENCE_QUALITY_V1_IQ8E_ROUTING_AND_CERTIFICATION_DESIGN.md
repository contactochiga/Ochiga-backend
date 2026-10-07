# IQ-8E — Governed capability routing closure

Baseline (frozen before any runtime change): `artifacts/intelligence-quality-v1-iq8e-routing-baseline.json` — 24 candidates classified: 8 operation mismatch, 8 semantic domain interpretation, 2 capability matching, 2 evidence-planning selection, 2 authority denial, 1 scope mismatch, 1 ambiguity.

Routing is by structured concepts (IQ-7 vocabulary → `frame.concepts` → capability `supports()` contracts → surface/authority via `CapabilityService`). Changes: noun-compound head resolution; age / top-up / bal / consumption concepts; the lexical label `transactions` no longer counts as a domain; development, financial and portfolio contracts; selected-record readers hand over to their query sibling when nothing is selected; unclaimed imperative actions are stated as not done (never answered by a read); public-surface governed refusals (internal criteria, valuation/commitment); reason-specific authority denials that keep the established safe-denial sentence; measurement asks are limitations; a state word with no object is a clarification; `kill/cut/shut` aimed at a device is a power-off; past-tense questions never carry mutation intent; the evidence planner head-noun fix and a direct state read for wallet/utility records.

Authority is never widened: Facility `devices.status.read` stays home-scoped (test: `facility-authority-preserved`).

Carried debt: 029/036/038/049 passed in substance but were scored on the capability key (now `business_surface.refusal|clarification`); 046 premise-denial composition; 051 honest-unknown submission state; 115 device confirmation wording; 123 correct "nothing pending"; OSA-010:7 handoff-detail; 007 units-sold not exposed by the capability; 126 `utilities.purchases.read` store is empty while the purchase is a wallet transaction; 070/071 legitimate denial (no estate-wide device read for Facility).

## Recommended design for the new independent first-contact certification suite (not generated here)
- Authored by an independent process with no repository access, from fixture facts only; frozen (hash) before any run; run once at first contact; never edited after results.
- Size: at least 240 items, balanced across the four workers (Oma, Osa, Facility, Consumer; 60 each) and across answer intents (LIST, COUNT, STATUS, DETAIL, VALUE/SUM, YES_NO, EXPLANATION, COMPARISON, LIMITATION, REFUSAL, CONSTRAINT, CLARIFICATION, ACTION/CONFIRMATION, SAFETY, DISCOVERY), at least 12 per intent.
- Language: informal, abbreviated, mixed-register and multi-sentence variants; no overlap with the 126 or earlier suites (n-gram overlap check).
- Frozen thresholds before the run: overall >= 0.85; each worker >= 0.80; each answer intent >= 0.75; zero P0 (action executed without confirmation, authority widened, fabricated fact, safety all-clear); honest-unavailable capabilities (e.g. utilities.usage.read) must score by structured `response_contract`, not by wording.
- Independent grading of the full set by a second independent process using the frozen expectation; disagreements adjudicated by a third; harness bug classes (wording-keyed checks) listed and excluded up front, not after.
- Metamorphic companion: each item has a paraphrase and an operation-flip; the route must be stable under paraphrase and change under the flip.
