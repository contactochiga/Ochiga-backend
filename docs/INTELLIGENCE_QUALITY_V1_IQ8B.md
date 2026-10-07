# Intelligence Quality V1 — IQ-8B Routing-to-Target Generalisation

Status: **IQ-8 NOT YET CERTIFIED.** Branch `codex/intelligence-quality-v1`. No merge, no deploy, Initiative not started.

## Diagnosis (done before runtime change)
First-contact misses of the contaminated fresh suites C–F (82): semantics-correct but routing wrong 31, semantics wrong 13, routing correct but target wrong 32, composition wrong 6. So routing/domain interpretation explains ~54% and the answer-target layer ~46%: the routing hypothesis is **only partly** right. Artifact: `intelligence-quality-v1-iq8b-first-contact-diagnosis.json`; routing-stack audit: `…-iq8b-routing-audit.json` (123 lexical rules; 35 structured domain checks, 14 + 30 phrase-shaped, 12 + 28 duplicate semantic interpretations).

## Bridge built
`interpretation/conceptBridge.ts` adds `frame.concepts` (IQ-7 domain nouns by position, head domain, object class, facet balance / transactions / spending / usage / history / status, quantity, state) on the existing semantic frame. `reconcileDomain` fills a missing domain from the vocabulary and lets a hard head domain override a soft legacy one (billing words keep utilities). Capability predicates now consume it: wallet balance vs transactions by facet, utilities spending vs usage by facet, CRM leads/opportunities by object, visitors/security accept `inform`/`summarize` reads. The earlier vocabulary fallback inside `classifyDomain` was removed (the bridge owns it). "deal" as a verb is no longer a CRM noun. Surfaces and authority are untouched: a concept match never selects a capability the actor is not eligible for.

## Evidence
| Gate | Result |
|---|---|
| **Fresh independent suite (126 items, authored by a subagent with no repository access, frozen before the work) — first contact, overall ≥ 0.85** | **0.484 — NOT MET** |
| Worker floors ≥ 0.80 | Oma 0.438, Osa 0.370, Facility 0.629, Consumer 0.469 — NOT MET |
| Independent review of the 64 self-graded leads | 42 MEETS, 18 PARTIAL, 4 DOES_NOT_MEET (the self-grade overstated) |
| Metamorphic routing | preserve 34/34, change 9/9 (implementer-authored) |
| Frozen 280 | 69 PASS preserved; 111 answers changed (90 FAIL, 21 PASS; same 21 as IQ-8); no promotion claimed |
| IQ-7 | DEV 0.983 / safety 1.0, closure 1.0, objective parity 0 changes, no widened execution intent, e2e 45/45, guard 0 |
| Wave 11 | harness 132/0, but see below |
| IQ-1..IQ-6 | all pass (4 `oyi-workflow-*` suites fail identically at the IQ-6 baseline) |
| Performance | concept bridge p95 40 µs; targeting p95 71 µs; no extra provider call |

## Wave 11 "132/132"
The one previously failing turn ("How much electricity have I used?") reaches the declared `utilities.usage.read` both before and after and answers with an honest unavailability. The harness fails any answer containing "is not available" / "can't confirm" / "does not have an enabled"; the IQ-8 targeted limitation wording avoids those substrings. This is an evaluator-wording artefact — a false promotion of the capability — not a routing improvement. The true state is 131 PASS + 1 honest-limitation (utilities usage unavailable). The harness was not changed.

## Why not certified
The independently authored suite, run once at first contact, scored 0.484. Its misses are ~half routing (fallbacks, unsupported ownership of office finance / meetings / portfolio reads, public-conversation recall, ambiguous or action-like commands answered as reads) and ~half target/composition (Osa recall and yes/no, wallet facets for informal wording, tag/short forms). The routing work reduced misses on earlier suites but did not close the gap on unseen wording. No tuning against the fresh suite was done.
